import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  createIngredient,
  createIngredientLot,
  createIngredientMovement,
  archiveCatalogItemInTransaction,
  completeIngredientLotCost,
  compareAndSetIngredientLotRemainingQuantity,
  findIngredientByName,
  getIngredientLotById,
  listIngredientLotsForBusiness,
  listIngredientLotsForIngredient,
  listIngredientsForBusiness,
  listRecipeLinesForBusiness,
  searchIngredientLots,
  updateIngredient,
  updateIngredientLotMetadata,
  type IngredientLotWithName,
  type IngredientLotCostRecord,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  buildRecipeConversionChain,
  normalizePracticalRecipeUnit,
  recipeUnitStandard,
  serializeRecipeConversionChain,
  standardRecipeUnitFactor,
} from "@/domain/recipeConversionChains";
import type { Ingredient, IngredientUnit } from "@/domain/types";

import { loadOwnerSetupStatus } from "./ownerSetup";
import {
  listGroceryMissingPrices,
  type GroceryMissingPriceEntry,
} from "./groceryRequirements";

export const groceryPurchaseUnits = [
  "g",
  "kg",
  "ml",
  "L",
  "pcs",
  "pack",
  "metric_cup",
  "us_cup",
  "custom_cup",
  "us_gallon",
  "imperial_gallon",
] as const;

export type GroceryPurchaseUnit = (typeof groceryPurchaseUnits)[number];

export type AddGroceryPurchaseInput = {
  ingredientName: string;
  brandName?: string | null;
  sourceName?: string | null;
  quantity: number;
  unit: GroceryPurchaseUnit;
  customCupMilliliters?: number | null;
  totalCost: number | null;
  purchaseDate?: string | null;
  lowStockThreshold?: number | null;
  category?: string | null;
  notes?: string | null;
};

export type AddGroceryPurchaseResult = {
  ingredient: Ingredient;
  lot: IngredientLotCostRecord;
  costPerUnit: number | null;
  createdNewIngredient: boolean;
};

export type LowStockIngredientSummary = {
  ingredient: Ingredient;
  remainingInDefaultUnit: number;
};

export type GroceryPoolSnapshot = {
  hasBusiness: boolean;
  ingredientCount: number;
  lotCount: number;
  recentLotCount: number;
  totalRemainingValue: number;
  missingPriceLotCount: number;
  missingPrices: GroceryMissingPriceEntry[];
  lowStockIngredients: LowStockIngredientSummary[];
  recipeUsageCountByLot: Record<string, number>;
  lots: IngredientLotWithName[];
};

export type IngredientCostHistoryEntry = {
  lotId: string;
  purchaseDate: string;
  brandName: string | null;
  sourceName: string | null;
  unit: IngredientUnit;
  costState: IngredientLotCostRecord["costState"];
  costPerUnit: number | null;
  totalCost: number | null;
  purchasedQuantity: number;
};

/**
 * Converts between trivially compatible units only (kg<->g, L<->ml).
 * Returns null when the conversion needs owner-defined sizing (e.g. pack -> g),
 * which is deferred to the recipe costing phase.
 */
export function convertIngredientQuantity(quantity: number, fromUnit: IngredientUnit, toUnit: IngredientUnit): number | null {
  if (fromUnit === toUnit) {
    return quantity;
  }

  if (fromUnit === "kg" && toUnit === "g") {
    return quantity * 1000;
  }

  if (fromUnit === "g" && toUnit === "kg") {
    return quantity / 1000;
  }

  if (fromUnit === "L" && toUnit === "ml") {
    return quantity * 1000;
  }

  if (fromUnit === "ml" && toUnit === "L") {
    return quantity / 1000;
  }

  return null;
}

type NormalizedGroceryPurchase = {
  quantity: number;
  unit: IngredientUnit;
  enteredQuantity: number;
  enteredUnit: GroceryPurchaseUnit;
  unitStandardSnapshot: string;
  conversionChainJson: string | null;
};

function normalizeGroceryPurchase(input: {
  quantity: number;
  unit: GroceryPurchaseUnit;
  customCupMilliliters?: number | null;
}): NormalizedGroceryPurchase {
  const practical = normalizePracticalRecipeUnit(input.unit);
  if (!practical) throw new Error("Purchase unit is unavailable.");
  const standard = recipeUnitStandard(practical);
  if (
    input.unit !== "metric_cup" &&
    input.unit !== "us_cup" &&
    input.unit !== "custom_cup" &&
    input.unit !== "us_gallon" &&
    input.unit !== "imperial_gallon"
  ) {
    return {
      quantity: input.quantity,
      unit: input.unit,
      enteredQuantity: input.quantity,
      enteredUnit: input.unit,
      unitStandardSnapshot: standard,
      conversionChainJson: null,
    };
  }

  const factor =
    input.unit === "custom_cup"
      ? input.customCupMilliliters ?? null
      : standardRecipeUnitFactor(input.unit, "ml");
  if (!Number.isFinite(factor) || (factor as number) <= 0) {
    throw new Error("Enter the exact milliliters used by your business cup.");
  }
  const meaning =
    input.unit === "custom_cup"
      ? `Business cup = ${factor} mL`
      : `${input.unit} converted to milliliters using ${standard}`;
  const chain = buildRecipeConversionChain([
    {
      fromQuantity: 1,
      fromUnit: input.unit,
      toQuantity: factor as number,
      toUnit: "ml",
      standard,
      meaning,
    },
  ]);
  if (!chain.ok) {
    throw new Error(`Purchase-unit conversion is invalid: ${chain.reason}.`);
  }
  return {
    quantity: input.quantity * (factor as number),
    unit: "ml",
    enteredQuantity: input.quantity,
    enteredUnit: input.unit,
    unitStandardSnapshot: chain.snapshot.unitStandardSummary,
    conversionChainJson: serializeRecipeConversionChain(chain.snapshot),
  };
}

function toLocalIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIsoDate() {
  return toLocalIsoDate(new Date());
}

async function requireActiveBusiness(db: RepositoryDatabase) {
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    throw new Error("Create your business profile in Owner Settings first.");
  }
  return status.activeBusiness;
}

export async function addGroceryPurchase(
  input: AddGroceryPurchaseInput,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<AddGroceryPurchaseResult> {
  await runMigrations(db);

  const name = input.ingredientName.trim();
  if (!name) {
    throw new Error("Ingredient name is required.");
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  if (
    input.totalCost !== null &&
    (!Number.isFinite(input.totalCost) || input.totalCost < 0)
  ) {
    throw new Error("Total cost must be zero or higher when entered.");
  }

  const business = await requireActiveBusiness(db);
  const existingIngredient = await findIngredientByName(business.id, name, db);
  if (existingIngredient && !existingIngredient.isActive) {
    throw new Error(
      "This Grocery ingredient is archived. Restore it before adding another purchase.",
    );
  }
  const purchaseDate = input.purchaseDate?.trim() || todayIsoDate();
  const normalized = normalizeGroceryPurchase(input);
  const costPerUnit =
    input.totalCost === null ? null : input.totalCost / normalized.quantity;

  let ingredient: Ingredient | null = null;
  let lot: IngredientLotCostRecord | null = null;

  await db.withExclusiveTransactionAsync(async (txn) => {
    if (existingIngredient) {
      ingredient =
        input.lowStockThreshold !== null && input.lowStockThreshold !== undefined
          ? await updateIngredient(existingIngredient.id, { lowStockThreshold: input.lowStockThreshold }, txn)
          : existingIngredient;
    } else {
      ingredient = await createIngredient(
        {
          businessId: business.id,
          name,
          defaultUnit: normalized.unit,
          category: input.category?.trim() || "General",
          lowStockThreshold: input.lowStockThreshold ?? 0,
        },
        txn,
      );
    }

    lot = await createIngredientLot(
      {
        businessId: business.id,
        ingredientId: ingredient.id,
        brandName: input.brandName ?? null,
        sourceName: input.sourceName ?? null,
        purchaseDate,
        purchasedQuantity: normalized.quantity,
        unit: normalized.unit,
        totalCost: input.totalCost,
        costState: input.totalCost === null ? "unknown" : "known",
        enteredQuantity: normalized.enteredQuantity,
        enteredUnit: normalized.enteredUnit,
        unitStandardSnapshot: normalized.unitStandardSnapshot,
        conversionChainJson: normalized.conversionChainJson,
        notes: input.notes ?? null,
      },
      txn,
    );

    await createIngredientMovement(
      {
        businessId: business.id,
        ingredientId: ingredient.id,
        lotId: lot.id,
        movementType: "purchase",
        quantity: normalized.quantity,
        unit: normalized.unit,
        unitCost: costPerUnit,
        totalCost: input.totalCost,
        reason: [
          "Grocery purchase",
          input.brandName?.trim() ? `- ${input.brandName.trim()}` : null,
          input.sourceName?.trim() ? `(${input.sourceName.trim()})` : null,
        ]
          .filter(Boolean)
          .join(" "),
      },
      txn,
    );

    await txn.runAsync(
      `
        UPDATE catalog_items
        SET purchase_cost_state = CASE
          WHEN EXISTS (
            SELECT 1
            FROM legacy_item_bindings binding
            INNER JOIN ingredient_lots known_lot
              ON known_lot.ingredient_id = binding.legacy_entity_id
              AND known_lot.deleted_at IS NULL
              AND known_lot.status <> 'archived'
              AND known_lot.cost_state = 'known'
              AND known_lot.recorded_cost_per_unit IS NOT NULL
            WHERE binding.catalog_item_id = catalog_items.id
              AND binding.entity_kind = 'ingredient'
              AND binding.deleted_at IS NULL
          ) THEN 'known'
          ELSE 'unknown'
        END,
        updated_at = ?, sync_status = 'local'
        WHERE id = (
          SELECT catalog_item_id
          FROM legacy_item_bindings
          WHERE entity_kind = 'ingredient' AND legacy_entity_id = ?
            AND deleted_at IS NULL
        ) AND business_id = ? AND deleted_at IS NULL
      `,
      [new Date().toISOString(), ingredient.id, business.id],
    );
  });

  if (!ingredient || !lot) {
    throw new Error("Could not save the grocery purchase.");
  }

  return {
    ingredient,
    lot,
    costPerUnit,
    createdNewIngredient: !existingIngredient,
  };
}

async function loadGroceryPoolSnapshotInternal(
  db: RepositoryDatabase,
  includeRecipeUsage: boolean,
): Promise<GroceryPoolSnapshot> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);

  if (!status.activeBusiness) {
    return {
      hasBusiness: false,
      ingredientCount: 0,
      lotCount: 0,
      recentLotCount: 0,
      totalRemainingValue: 0,
      missingPriceLotCount: 0,
      missingPrices: [],
      lowStockIngredients: [],
      recipeUsageCountByLot: {},
      lots: [],
    };
  }

  const businessId = status.activeBusiness.id;
  const ingredients = await listIngredientsForBusiness(businessId, db);
  const lots = await listIngredientLotsForBusiness(businessId, db);
  const recipeLines = includeRecipeUsage ? await listRecipeLinesForBusiness(businessId, db) : [];
  const activeIngredients = ingredients.filter((ingredient) => ingredient.isActive);
  const activeIngredientIds = new Set(
    activeIngredients.map((ingredient) => ingredient.id),
  );
  const visibleLots = lots.filter(
    (lot) => lot.status !== "archived" && activeIngredientIds.has(lot.ingredientId),
  );
  const missingPrices = await listGroceryMissingPrices(businessId, db);

  const recipeIdsByLot = new Map<string, Set<string>>();
  for (const line of recipeLines) {
    if (!line.ingredientLotId) {
      continue;
    }

    const recipeIds = recipeIdsByLot.get(line.ingredientLotId) ?? new Set<string>();
    recipeIds.add(line.recipeId);
    recipeIdsByLot.set(line.ingredientLotId, recipeIds);
  }
  const recipeUsageCountByLot = Object.fromEntries(
    [...recipeIdsByLot.entries()].map(([lotId, recipeIds]) => [lotId, recipeIds.size]),
  );

  const totalRemainingValue = visibleLots.reduce(
    (total, lot) =>
      lot.costState === "known" && lot.recordedCostPerUnit !== null
        ? total + lot.remainingQuantity * lot.recordedCostPerUnit
        : total,
    0,
  );
  const missingPriceLotCount = visibleLots.filter(
    (lot) => lot.costState !== "known",
  ).length;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = toLocalIsoDate(sevenDaysAgo);
  const recentLotCount = visibleLots.filter((lot) => lot.purchaseDate >= sevenDaysAgoIso).length;

  const lowStockIngredients: LowStockIngredientSummary[] = [];
  for (const ingredient of activeIngredients) {
    if (!ingredient.isActive || ingredient.lowStockThreshold <= 0) {
      continue;
    }

    let remainingInDefaultUnit = 0;
    for (const lot of visibleLots) {
      if (lot.ingredientId !== ingredient.id) {
        continue;
      }

      const converted = convertIngredientQuantity(lot.remainingQuantity, lot.unit, ingredient.defaultUnit);
      if (converted !== null) {
        remainingInDefaultUnit += converted;
      }
    }

    if (remainingInDefaultUnit <= ingredient.lowStockThreshold) {
      lowStockIngredients.push({ ingredient, remainingInDefaultUnit });
    }
  }

  return {
    hasBusiness: true,
    ingredientCount: activeIngredients.length,
    lotCount: visibleLots.length,
    recentLotCount,
    totalRemainingValue,
    missingPriceLotCount,
    missingPrices,
    lowStockIngredients,
    recipeUsageCountByLot,
    lots: visibleLots,
  };
}

export async function loadGroceryPoolSnapshot(db: RepositoryDatabase = openKitamoDatabase()): Promise<GroceryPoolSnapshot> {
  return loadGroceryPoolSnapshotInternal(db, false);
}

export async function loadGroceryPoolScreenSnapshot(db: RepositoryDatabase = openKitamoDatabase()): Promise<GroceryPoolSnapshot> {
  return loadGroceryPoolSnapshotInternal(db, true);
}

export async function searchGroceryLots(
  query: string,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<IngredientLotWithName[]> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    return [];
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return listIngredientLotsForBusiness(status.activeBusiness.id, db);
  }

  return searchIngredientLots(status.activeBusiness.id, trimmed, db);
}

export async function getIngredientCostHistory(
  ingredientId: string,
  limit = 10,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<IngredientCostHistoryEntry[]> {
  await runMigrations(db);
  const lots = await listIngredientLotsForIngredient(ingredientId, limit, db);
  return lots.map((lot) => ({
    lotId: lot.id,
    purchaseDate: lot.purchaseDate,
    brandName: lot.brandName,
    sourceName: lot.sourceName,
    unit: lot.unit,
    costState: lot.costState,
    costPerUnit:
      lot.costState === "known" ? lot.recordedCostPerUnit : null,
    totalCost: lot.costState === "known" ? lot.recordedTotalCost : null,
    purchasedQuantity: lot.purchasedQuantity,
  }));
}

export async function completeGroceryLotPrice(
  input: { lotId: string; totalCost: number; expectedUpdatedAt: string },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  let completed: IngredientLotCostRecord | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const completedLot = await completeIngredientLotCost(
      input.lotId,
      input.totalCost,
      input.expectedUpdatedAt,
      txn,
    );
    completed = completedLot;
    await txn.runAsync(
      `
        UPDATE catalog_items
        SET purchase_cost_state = 'known', updated_at = ?, sync_status = 'local'
        WHERE id = (
          SELECT catalog_item_id
          FROM legacy_item_bindings
          WHERE entity_kind = 'ingredient' AND legacy_entity_id = ?
            AND deleted_at IS NULL
        ) AND business_id = ? AND deleted_at IS NULL
      `,
      [
        new Date().toISOString(),
        completedLot.ingredientId,
        completedLot.businessId,
      ],
    );
  });
  if (!completed) throw new Error("Missing grocery price was not completed.");
  return completed;
}

export async function updateGroceryLotMetadata(
  input: {
    lotId: string;
    brandName: string | null;
    sourceName: string | null;
    notes: string | null;
    expectedUpdatedAt: string;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return updateIngredientLotMetadata(input.lotId, input, db);
}

export async function markGroceryLotEmpty(
  lotId: string,
  reason: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  const note = reason.trim();
  if (!note) throw new Error("A reason is required to mark a lot empty.");
  return adjustLotRemainingQuantity(
    lotId,
    0,
    `Mark lot empty: ${note}`,
    db,
  );
}

export async function archiveGroceryIngredient(
  ingredientId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  await db.withExclusiveTransactionAsync(async (txn) => {
    const binding = await txn.getFirstAsync<{ catalog_item_id: string }>(
      `
        SELECT catalog_item_id
        FROM legacy_item_bindings
        WHERE entity_kind = 'ingredient' AND legacy_entity_id = ?
          AND binding_status IN ('active', 'archived')
          AND deleted_at IS NULL
      `,
      [ingredientId],
    );
    if (!binding) {
      throw new Error("Grocery ingredient identity is unavailable.");
    }
    await archiveCatalogItemInTransaction(
      binding.catalog_item_id,
      ownerAuthorized,
      txn,
    );
    await updateIngredient(ingredientId, { isActive: false }, txn);
  });
}

export async function adjustLotRemainingQuantity(
  lotId: string,
  newRemainingQuantity: number,
  reason = "Manual stock adjustment",
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const adjustmentReason = reason.trim();
  if (!adjustmentReason) {
    throw new Error("A stock-adjustment reason is required.");
  }

  const lot = await getIngredientLotById(lotId, db);
  if (!lot) {
    throw new Error("Grocery item not found.");
  }

  const delta = newRemainingQuantity - lot.remainingQuantity;
  if (delta === 0) {
    throw new Error("Enter a different remaining quantity for this adjustment.");
  }

  await db.withExclusiveTransactionAsync(async (txn) => {
    await compareAndSetIngredientLotRemainingQuantity(
      lotId,
      newRemainingQuantity,
      lot.updatedAt,
      txn,
    );
    await createIngredientMovement(
      {
        businessId: lot.businessId,
        ingredientId: lot.ingredientId,
        lotId: lot.id,
        movementType: "adjustment",
        quantity: delta,
        unit: lot.unit,
        unitCost:
          lot.costState === "known" ? lot.recordedCostPerUnit : null,
        totalCost:
          lot.costState === "known" && lot.recordedCostPerUnit !== null
            ? lot.recordedCostPerUnit * delta
            : null,
        reason: adjustmentReason,
      },
      txn,
    );
  });

  return {
    lotId,
    previousRemainingQuantity: lot.remainingQuantity,
    newRemainingQuantity,
  };
}
