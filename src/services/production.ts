import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  getProductById,
  getRecipeById,
  getTodayProductionTotals,
  listIngredientLotsForBusiness,
  listRecentProductionBatches,
  listRecipeLinesForRecipe,
  type ProductionBatchWithNames,
  type RepositoryDatabase,
} from "@/db/repositories";
import { makeIngredientMovementId, makeMovementId, makeProductionBatchId, makeProductionUsageId } from "@/domain/ids";
import { planProduction, type ProductionPlan, type ProductionShortfall } from "@/domain/productionMath";
import type { Branch, Product, Recipe } from "@/domain/types";

import { loadOwnerSetupStatus } from "./ownerSetup";
import { buildCostingLines } from "./recipes";

const LOW_STOCK_ALERT_TYPE = "low_stock";

export type RecordProductionInput = {
  recipeId: string;
  branchId: string;
  producedQuantity: number;
  notes?: string | null;
};

export type ProductionResult = {
  batchId: string;
  recipeName: string;
  productName: string;
  branchName: string;
  producedQuantity: number;
  totalCost: number;
  costPerOutputUnit: number;
  newStockQty: number;
};

export type TodayProductionSummary = {
  batchCount: number;
  totalCost: number;
  totalOutput: number;
};

function formatQuantity(value: number) {
  return value.toLocaleString("en-PH", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

export function formatShortfallMessage(shortfall: ProductionShortfall) {
  return `Not enough ${shortfall.label}. Need ${formatQuantity(shortfall.neededQuantity)} ${shortfall.unit}, available ${formatQuantity(shortfall.availableQuantity)} ${shortfall.unit}.`;
}

function getTodayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function requireContext(db: RepositoryDatabase) {
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    throw new Error("Create your business profile in Owner Settings first.");
  }
  return status;
}

async function assertLegacyFlatProductionBoundary(
  recipeId: string,
  businessId: string,
  db: RepositoryDatabase,
) {
  const boundary = await db.getFirstAsync<{
    versioning_state: "legacy_compat" | "native" | "review_required";
    active_version_id: string | null;
  }>(
    `
      SELECT versioning_state, active_version_id
      FROM recipes
      WHERE id = ? AND business_id = ? AND is_active = 1
        AND deleted_at IS NULL
    `,
    [recipeId, businessId],
  );
  if (!boundary || boundary.versioning_state !== "legacy_compat") {
    throw new Error(
      "Native and review-required Recipes cannot use the protected legacy flat production executor.",
    );
  }
}

async function buildPlanForRecipe(
  recipe: Recipe,
  producedQuantity: number,
  businessId: string,
  db: RepositoryDatabase,
): Promise<{ plan: ProductionPlan; lineDetails: ReturnType<typeof buildCostingLines>; usagesInput: UsageInput[] }> {
  const lines = await listRecipeLinesForRecipe(recipe.id, db);
  if (lines.length === 0) {
    throw new Error("This recipe has no ingredient lines yet. Open Recipes and add them first.");
  }

  const lots = await listIngredientLotsForBusiness(businessId, db);
  const lotMap = new Map(lots.map((lot) => [lot.id, lot]));
  const costingLines = buildCostingLines(lines, lotMap);
  const plan = planProduction(costingLines, recipe.outputQuantity, producedQuantity);

  const usagesInput: UsageInput[] = plan.lines.map((planLine, index) => {
    const source = lines[index];
    return {
      ingredientId: source?.ingredientId ?? null,
      ingredientLotId: planLine.lotId,
      quantityUsed: planLine.requiredQuantity,
      unit: planLine.unit,
      lineCost: planLine.lineCost,
      sourceLabelSnapshot: planLine.label,
      isCustom: planLine.isCustom,
    };
  });

  return { plan, lineDetails: costingLines, usagesInput };
}

type UsageInput = {
  ingredientId: string | null;
  ingredientLotId: string | null;
  quantityUsed: number;
  unit: string;
  lineCost: number;
  sourceLabelSnapshot: string;
  isCustom: boolean;
};

export async function recordProduction(
  input: RecordProductionInput,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<ProductionResult> {
  await runMigrations(db);

  if (!Number.isFinite(input.producedQuantity) || input.producedQuantity <= 0) {
    throw new Error("Ilagay kung ilang piraso ang na-produce. Example: 12.");
  }

  const status = await requireContext(db);
  const business = status.activeBusiness as NonNullable<typeof status.activeBusiness>;

  const branch: Branch | undefined = status.branches.find((candidate) => candidate.id === input.branchId);
  if (!branch) {
    throw new Error("Piliin kung saang stall ang production na ito.");
  }

  const recipe = await getRecipeById(input.recipeId, db);
  if (!recipe || recipe.businessId !== business.id || !recipe.isActive) {
    throw new Error("Recipe not found. Refresh and try again.");
  }
  await assertLegacyFlatProductionBoundary(recipe.id, business.id, db);

  const product: Product | null = recipe.outputProductId ? await getProductById(recipe.outputProductId, db) : null;
  if (!product || product.businessId !== business.id) {
    throw new Error("The recipe's output paninda is missing. Check Owner Inventory.");
  }

  const { plan, usagesInput } = await buildPlanForRecipe(recipe, input.producedQuantity, business.id, db);

  if (plan.incompatibleLabels.length > 0) {
    throw new Error(
      `${plan.incompatibleLabels[0]}: hindi ma-convert ang units. I-check ang recipe at grocery units (g/kg o ml/L lang ang puwede).`,
    );
  }

  if (plan.shortfalls.length > 0) {
    throw new Error(formatShortfallMessage(plan.shortfalls[0]));
  }

  const timestamp = new Date().toISOString();
  const batchId = makeProductionBatchId();
  const notes = input.notes?.trim() || null;
  const restockedAboveThreshold = product.stockQty + input.producedQuantity > product.lowStockThreshold;

  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync(
      `
        INSERT INTO production_batches (
          id, business_id, branch_id, recipe_id, output_product_id, recipe_name,
          output_quantity, output_unit, batch_multiplier, total_batch_cost,
          cost_per_output_unit, notes, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        batchId,
        business.id,
        branch.id,
        recipe.id,
        product.id,
        recipe.name,
        input.producedQuantity,
        recipe.outputUnit,
        plan.batchMultiplier,
        plan.totalCost,
        plan.costPerOutputUnit,
        notes,
        timestamp,
        timestamp,
        "local",
        null,
      ],
    );

    for (const deduction of plan.deductions) {
      const updateResult = await txn.runAsync(
        `
          UPDATE ingredient_lots
          SET remaining_quantity = remaining_quantity - ?,
            status = CASE WHEN remaining_quantity - ? <= 0.000000001 THEN 'depleted' ELSE status END,
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL AND status != 'archived'
            AND remaining_quantity + 0.000000001 >= ?
        `,
        [deduction.quantity, deduction.quantity, timestamp, deduction.lotId, business.id, deduction.quantity],
      );

      if (updateResult.changes !== 1) {
        throw new Error(`Not enough ${deduction.label} sa Grocery Pool. Refresh and try again.`);
      }

      await txn.runAsync(
        `
          INSERT INTO ingredient_movements (
            id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
            unit_cost, total_cost, reason, created_at, updated_at, sync_status, deleted_at
          ) VALUES (
            ?, ?, (SELECT ingredient_id FROM ingredient_lots WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          )
        `,
        [
          makeIngredientMovementId(),
          business.id,
          deduction.lotId,
          deduction.lotId,
          "recipe_usage",
          deduction.quantity,
          deduction.unit,
          deduction.quantity > 0 ? deduction.cost / deduction.quantity : 0,
          deduction.cost,
          `Production: ${recipe.name}`,
          timestamp,
          timestamp,
          "local",
          null,
        ],
      );
    }

    for (const usage of usagesInput) {
      await txn.runAsync(
        `
          INSERT INTO production_ingredient_usages (
            id, business_id, production_batch_id, ingredient_id, ingredient_lot_id,
            quantity_used, unit, line_cost, source_label_snapshot, is_custom,
            created_at, updated_at, sync_status, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          makeProductionUsageId(),
          business.id,
          batchId,
          usage.ingredientId,
          usage.ingredientLotId,
          usage.quantityUsed,
          usage.unit,
          usage.lineCost,
          usage.sourceLabelSnapshot,
          usage.isCustom ? 1 : 0,
          timestamp,
          timestamp,
          "local",
          null,
        ],
      );
    }

    const stockResult = await txn.runAsync(
      `
        UPDATE products
        SET stock_qty = stock_qty + ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
      `,
      [input.producedQuantity, timestamp, product.id, business.id],
    );

    if (stockResult.changes !== 1) {
      throw new Error("Could not update product stock.");
    }

    await txn.runAsync(
      `
        INSERT INTO inventory_movements (
          id, business_id, branch_id, product_id, movement_type, quantity, reason,
          linked_sale_id, unit_cost, total_cost, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        makeMovementId(),
        business.id,
        branch.id,
        product.id,
        "cooked",
        input.producedQuantity,
        `Niluto / Production: ${recipe.name}`,
        null,
        plan.costPerOutputUnit,
        plan.totalCost,
        timestamp,
        timestamp,
        "local",
        null,
      ],
    );

    if (restockedAboveThreshold) {
      await txn.runAsync(
        `
          UPDATE owner_alerts
          SET status = 'resolved', updated_at = ?, sync_status = 'local'
          WHERE product_id = ? AND business_id = ? AND alert_type = ?
            AND status IN ('active', 'open') AND deleted_at IS NULL
        `,
        [timestamp, product.id, business.id, LOW_STOCK_ALERT_TYPE],
      );
    }
  });

  return {
    batchId,
    recipeName: recipe.name,
    productName: product.name,
    branchName: branch.branchName,
    producedQuantity: input.producedQuantity,
    totalCost: plan.totalCost,
    costPerOutputUnit: plan.costPerOutputUnit,
    newStockQty: product.stockQty + input.producedQuantity,
  };
}

export async function listRecentProduction(
  limit = 5,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<ProductionBatchWithNames[]> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    return [];
  }

  return listRecentProductionBatches(status.activeBusiness.id, limit, db);
}

export async function getTodayProductionSummary(
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<TodayProductionSummary> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    return { batchCount: 0, totalCost: 0, totalOutput: 0 };
  }

  const { startIso, endIso } = getTodayBounds();
  return getTodayProductionTotals(status.activeBusiness.id, startIso, endIso, db);
}
