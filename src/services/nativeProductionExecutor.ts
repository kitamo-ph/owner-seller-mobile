import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  addProductStockLotWithScalarProjection,
  getProductionPlanById,
  type ProductionPlanSnapshot,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  makeIngredientMovementId,
  makeProductionBatchId,
  makeProductionInputAllocationId,
  makeProductStockLotId,
} from "@/domain/ids";

const QUANTITY_TOLERANCE = 1e-9;

export type SimpleNativeProductionResult = {
  outcome: "executed" | "already_completed";
  planId: string;
  stageId: string;
  productionBatchId: string;
  outputProductId: string;
  outputCatalogItemId: string;
  outputQuantity: number;
  outputUnit: string;
  totalCost: number;
  productStockLotId: string | null;
};

type StageRow = {
  id: string;
  business_id: string;
  production_plan_id: string;
  recipe_version_id: string;
  parent_stage_id: string | null;
  topological_order: number;
  expected_output_quantity: number;
  expected_output_unit: string;
  status: string;
  shortage_state: string;
  variance_state: string;
  actual_output_quantity: number | null;
  production_batch_id: string | null;
};

type RequirementRow = {
  id: string;
  business_id: string;
  production_plan_stage_id: string;
  catalog_item_id: string | null;
  requirement_kind: string;
  raw_quantity: number;
  raw_unit: string;
  provenance_json: string;
  is_required: number;
  expected_cost: number | null;
  cost_state: string;
};

type AllocationRow = {
  id: string;
  business_id: string;
  production_plan_requirement_id: string;
  lot_kind: string;
  ingredient_lot_id: string | null;
  product_stock_lot_id: string | null;
  allocation_mode: string;
  quantity: number;
  unit: string;
  normalized_quantity: number | null;
  normalized_unit: string | null;
  conversion_id: string | null;
  conversion_factor_snapshot: number | null;
  unit_cost_snapshot: number | null;
  cost_contribution: number | null;
  cost_state: string;
  selection_state: string;
};

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= QUANTITY_TOLERANCE;
}

function asStage(row: Record<string, unknown>): StageRow {
  return row as unknown as StageRow;
}

function asRequirement(row: Record<string, unknown>): RequirementRow {
  return row as unknown as RequirementRow;
}

function asAllocation(row: Record<string, unknown>): AllocationRow {
  return row as unknown as AllocationRow;
}

type ProvenanceEntry = {
  versionId: string;
  lineId: string;
};

function parseStrictRecipeLineProvenance(provenanceJson: string): ProvenanceEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(provenanceJson) as unknown;
  } catch {
    throw new Error(
      "Ingredient requirement provenance is malformed and cannot be executed.",
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      "Ingredient requirement provenance must be a non-empty array.",
    );
  }
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(
        `Ingredient requirement provenance entry ${index} is invalid.`,
      );
    }
    const entry = value as Record<string, unknown>;
    const versionId =
      typeof entry.versionId === "string" ? entry.versionId.trim() : "";
    const lineId = typeof entry.lineId === "string" ? entry.lineId.trim() : "";
    if (!versionId || !lineId) {
      throw new Error(
        "Ingredient requirement provenance must include versionId and lineId.",
      );
    }
    return { versionId, lineId };
  });
}

/**
 * First simple executor requires exactly one attributable Recipe version line
 * per ingredient requirement. Multi-line aggregation fails closed.
 */
async function resolveSingleRecipeVersionLineId(input: {
  requirement: RequirementRow;
  businessId: string;
  pinnedRecipeVersionId: string;
  txn: RepositoryDatabase;
}): Promise<string> {
  const { requirement, businessId, pinnedRecipeVersionId, txn } = input;
  if (!requirement.catalog_item_id) {
    throw new Error("Ingredient requirement is missing catalog identity.");
  }
  const provenance = parseStrictRecipeLineProvenance(requirement.provenance_json);
  for (const entry of provenance) {
    if (entry.versionId !== pinnedRecipeVersionId) {
      throw new Error(
        "Ingredient requirement provenance is detached from the pinned Recipe version.",
      );
    }
  }

  const distinctLineIds = [...new Set(provenance.map((entry) => entry.lineId))];
  if (distinctLineIds.length !== 1) {
    throw new Error(
      "This executor does not support requirements aggregated from multiple Recipe version lines.",
    );
  }
  const lineId = distinctLineIds[0];

  for (const entry of provenance) {
    const line = await txn.getFirstAsync<{
      id: string;
      business_id: string;
      recipe_version_id: string;
      source_kind: string;
      catalog_item_id: string | null;
    }>(
      `
        SELECT id, business_id, recipe_version_id, source_kind, catalog_item_id
        FROM recipe_version_lines
        WHERE id = ? AND deleted_at IS NULL
      `,
      [entry.lineId],
    );
    if (
      !line ||
      line.business_id !== businessId ||
      line.recipe_version_id !== pinnedRecipeVersionId ||
      line.source_kind !== "catalog_item" ||
      line.catalog_item_id !== requirement.catalog_item_id
    ) {
      throw new Error(
        "Ingredient requirement provenance is detached from persisted Recipe content.",
      );
    }
  }

  return lineId;
}

async function resolveLotBackedOutputProduct(input: {
  businessId: string;
  branchId: string | null;
  outputCatalogItemId: string;
  expectedOutputUnit: string;
  txn: RepositoryDatabase;
}): Promise<{
  product: {
    id: string;
    business_id: string;
    branch_id: string | null;
    unit_type: string;
  };
  catalogItemId: string;
}> {
  const catalogItem = await input.txn.getFirstAsync<{
    id: string;
    business_id: string;
    classification: string;
    source_type: string;
    lifecycle_status: string;
    stock_policy: string;
  }>(
    `
      SELECT id, business_id, classification, source_type, lifecycle_status,
        stock_policy
      FROM catalog_items
      WHERE id = ? AND deleted_at IS NULL
    `,
    [input.outputCatalogItemId],
  );
  if (
    !catalogItem ||
    catalogItem.business_id !== input.businessId ||
    catalogItem.classification !== "finished_product" ||
    catalogItem.source_type !== "native" ||
    catalogItem.lifecycle_status === "archived" ||
    catalogItem.stock_policy !== "product_lots"
  ) {
    throw new Error(
      "Output catalog item must be a native lot-backed finished product.",
    );
  }

  const binding = await input.txn.getFirstAsync<{
    legacy_entity_id: string;
  }>(
    `
      SELECT binding.legacy_entity_id
      FROM legacy_item_bindings binding
      INNER JOIN products product
        ON product.id = binding.legacy_entity_id
        AND product.business_id = binding.business_id
        AND product.deleted_at IS NULL
      WHERE binding.catalog_item_id = ?
        AND binding.business_id = ?
        AND binding.entity_kind = 'product'
        AND binding.binding_status = 'active'
        AND binding.deleted_at IS NULL
      LIMIT 1
    `,
    [catalogItem.id, input.businessId],
  );
  if (!binding) {
    throw new Error(
      "Finished product is missing its lot-backed Product projection.",
    );
  }

  const product = await input.txn.getFirstAsync<{
    id: string;
    business_id: string;
    branch_id: string | null;
    unit_type: string;
  }>(
    `
      SELECT id, business_id, branch_id, unit_type
      FROM products
      WHERE id = ? AND deleted_at IS NULL
    `,
    [binding.legacy_entity_id],
  );
  if (!product || product.business_id !== input.businessId) {
    throw new Error("Product projection is unavailable for this Recipe.");
  }
  if ((input.branchId ?? null) !== (product.branch_id ?? null)) {
    throw new Error("Plan branch does not match the Product projection branch.");
  }
  if (product.unit_type !== input.expectedOutputUnit) {
    throw new Error("Product stock unit does not match the Recipe output unit.");
  }

  return { product, catalogItemId: catalogItem.id };
}

async function loadExistingBatchForStage(
  stageId: string,
  txn: RepositoryDatabase,
) {
  return txn.getFirstAsync<{
    id: string;
    business_id: string;
    branch_id: string | null;
    recipe_id: string;
    recipe_version_id: string | null;
    production_plan_stage_id: string | null;
    output_product_id: string | null;
    output_quantity: number;
    output_unit: string;
    total_batch_cost: number;
    actual_total_cost: number | null;
    cost_state: string | null;
  }>(
    `
      SELECT id, business_id, branch_id, recipe_id, recipe_version_id,
        production_plan_stage_id, output_product_id, output_quantity,
        output_unit, total_batch_cost, actual_total_cost, cost_state
      FROM production_batches
      WHERE production_plan_stage_id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [stageId],
  );
}

/**
 * First native Recipe production executor.
 *
 * Consumes a persisted ready plan with exact ingredient-lot allocations for a
 * single finished_product stage. Nested/prepared/multi-stage plans fail closed.
 * Inventory is mutated only inside one exclusive transaction, and retries are
 * idempotent via production_batches.production_plan_stage_id.
 */
export async function executeSimpleNativeProductionPlan(
  planId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<SimpleNativeProductionResult> {
  await runMigrations(db);
  if (!planId.trim()) {
    throw new Error("Production plan id is required.");
  }

  let result: SimpleNativeProductionResult | null = null;

  await db.withExclusiveTransactionAsync(async (txn) => {
    const snapshot = await getProductionPlanById(planId, txn);
    if (!snapshot) {
      throw new Error("Production plan was not found.");
    }
    result = await executeInsideTransaction(snapshot, txn);
  });

  if (!result) {
    throw new Error("Native production execution did not return a result.");
  }
  return result;
}

async function executeInsideTransaction(
  snapshot: ProductionPlanSnapshot,
  txn: RepositoryDatabase,
): Promise<SimpleNativeProductionResult> {
  const { plan } = snapshot;
  const stages = snapshot.stages.map(asStage);
  if (stages.length !== 1) {
    throw new Error(
      "This native executor supports exactly one production stage.",
    );
  }
  const stage = stages[0];
  if (stage.production_plan_id !== plan.id) {
    throw new Error("Production stage does not belong to this plan.");
  }
  if (stage.parent_stage_id) {
    throw new Error(
      "Nested/parented production stages are not supported by this executor.",
    );
  }
  if (stage.recipe_version_id !== plan.rootRecipeVersionId) {
    throw new Error(
      "Plan root version and stage version must match for this executor.",
    );
  }

  const existingBatch = await loadExistingBatchForStage(stage.id, txn);
  if (existingBatch) {
    return resolveIdempotentResult(snapshot, stage, existingBatch, txn);
  }

  if (plan.status !== "ready") {
    throw new Error("Only ready production plans can be executed.");
  }
  if (stage.status !== "ready") {
    throw new Error("Only ready production stages can be executed.");
  }
  if (stage.shortage_state !== "none") {
    throw new Error("Production stage has unresolved shortage or stale stock.");
  }
  if (plan.costState !== "known" || plan.expectedTotalCost === null) {
    throw new Error("Production plan cost evidence is incomplete.");
  }
  if (plan.missingCostCount !== 0) {
    throw new Error("Production plan still has missing cost evidence.");
  }
  if (
    !Number.isFinite(stage.expected_output_quantity) ||
    stage.expected_output_quantity <= 0 ||
    !stage.expected_output_unit.trim()
  ) {
    throw new Error("Production stage output quantity/unit is invalid.");
  }

  const requirements = snapshot.requirements
    .map(asRequirement)
    .filter((row) => row.production_plan_stage_id === stage.id);
  const allocations = snapshot.allocations.map(asAllocation);
  if (requirements.length === 0) {
    throw new Error("Production stage has no persisted requirements.");
  }

  for (const requirement of requirements) {
    if (requirement.requirement_kind !== "ingredient") {
      throw new Error(
        "This executor only supports ingredient requirements on finished products.",
      );
    }
    if (!requirement.catalog_item_id) {
      throw new Error("Ingredient requirement is missing catalog identity.");
    }
    if (requirement.cost_state !== "known" || requirement.expected_cost === null) {
      throw new Error("Requirement cost evidence is incomplete.");
    }
    if (requirement.business_id !== plan.businessId) {
      throw new Error("Requirement business identity does not match the plan.");
    }
  }

  for (const allocation of allocations) {
    if (allocation.lot_kind !== "ingredient" || !allocation.ingredient_lot_id) {
      throw new Error(
        "This executor only supports exact ingredient-lot allocations.",
      );
    }
    if (
      allocation.cost_state !== "known" ||
      allocation.unit_cost_snapshot === null ||
      allocation.cost_contribution === null
    ) {
      throw new Error("Allocation cost evidence is incomplete.");
    }
    if (allocation.business_id !== plan.businessId) {
      throw new Error("Allocation business identity does not match the plan.");
    }
    if (
      !Number.isFinite(allocation.quantity) ||
      allocation.quantity <= 0 ||
      !allocation.unit.trim()
    ) {
      throw new Error("Allocation quantity/unit is invalid.");
    }
    if (
      !approximatelyEqual(
        allocation.cost_contribution,
        allocation.unit_cost_snapshot * allocation.quantity,
      )
    ) {
      throw new Error("Allocation cost contribution is inconsistent.");
    }
  }

  const requirementIds = new Set(requirements.map((row) => row.id));
  for (const allocation of allocations) {
    if (!requirementIds.has(allocation.production_plan_requirement_id)) {
      throw new Error("Allocation is not attached to this plan stage.");
    }
  }
  for (const requirement of requirements) {
    const covered = allocations
      .filter((row) => row.production_plan_requirement_id === requirement.id)
      .reduce((sum, row) => sum + row.quantity, 0);
    if (covered + QUANTITY_TOLERANCE < requirement.raw_quantity) {
      throw new Error("Requirement is not fully covered by exact allocations.");
    }
  }

  const recipe = await txn.getFirstAsync<{
    id: string;
    business_id: string;
    active_version_id: string | null;
    is_active: number;
    versioning_state: string;
    name: string;
  }>(
    `
      SELECT id, business_id, active_version_id, is_active, versioning_state, name
      FROM recipes
      WHERE id = ? AND deleted_at IS NULL
    `,
    [plan.rootRecipeId],
  );
  if (
    !recipe ||
    recipe.business_id !== plan.businessId ||
    recipe.is_active !== 1 ||
    recipe.versioning_state !== "native"
  ) {
    throw new Error("Native Recipe identity is unavailable for this plan.");
  }
  if (recipe.active_version_id !== plan.rootRecipeVersionId) {
    throw new Error(
      "Production plan is stale: Recipe active version no longer matches the plan.",
    );
  }

  const version = await txn.getFirstAsync<{
    id: string;
    business_id: string;
    recipe_id: string;
    status: string;
    output_catalog_item_id: string;
    expected_output_quantity: number;
    expected_output_unit: string;
    name_snapshot: string;
  }>(
    `
      SELECT id, business_id, recipe_id, status, output_catalog_item_id,
        expected_output_quantity, expected_output_unit, name_snapshot
      FROM recipe_versions
      WHERE id = ? AND deleted_at IS NULL
    `,
    [plan.rootRecipeVersionId],
  );
  if (
    !version ||
    version.business_id !== plan.businessId ||
    version.recipe_id !== plan.rootRecipeId ||
    version.status !== "published"
  ) {
    throw new Error(
      "Pinned Recipe version is not an active published immutable version.",
    );
  }
  if (
    !approximatelyEqual(
      version.expected_output_quantity,
      stage.expected_output_quantity,
    ) ||
    version.expected_output_unit !== stage.expected_output_unit ||
    version.expected_output_unit !== plan.targetUnit
  ) {
    throw new Error(
      "Plan output quantity/unit no longer matches the pinned Recipe version.",
    );
  }

  const childLines = await txn.getFirstAsync<{ count: number }>(
    `
      SELECT COUNT(*) AS count
      FROM recipe_version_lines
      WHERE recipe_version_id = ?
        AND source_kind = 'child_recipe_version'
        AND deleted_at IS NULL
    `,
    [version.id],
  );
  if ((childLines?.count ?? 0) > 0) {
    throw new Error(
      "Recipes with prepared/child Recipe dependencies are not supported by this executor.",
    );
  }

  const { product, catalogItemId } = await resolveLotBackedOutputProduct({
    businessId: plan.businessId,
    branchId: plan.branchId,
    outputCatalogItemId: version.output_catalog_item_id,
    expectedOutputUnit: stage.expected_output_unit,
    txn,
  });

  const recipeLineIdByRequirement = new Map<string, string>();
  for (const requirement of requirements) {
    const lineId = await resolveSingleRecipeVersionLineId({
      requirement,
      businessId: plan.businessId,
      pinnedRecipeVersionId: version.id,
      txn,
    });
    recipeLineIdByRequirement.set(requirement.id, lineId);
  }

  const timestamp = new Date().toISOString();
  const totalCost = plan.expectedTotalCost;
  const outputQuantity = stage.expected_output_quantity;
  const costPerOutput = totalCost / outputQuantity;
  if (!Number.isFinite(costPerOutput) || costPerOutput < 0) {
    throw new Error("Production cost per output unit is invalid.");
  }

  // Revalidate every persisted exact ingredient allocation against live lots.
  for (const allocation of allocations) {
    const lot = await txn.getFirstAsync<{
      id: string;
      business_id: string;
      ingredient_id: string;
      remaining_quantity: number;
      unit: string;
      status: string;
      cost_state: string | null;
      recorded_cost_per_unit: number | null;
      cost_per_unit: number | null;
    }>(
      `
        SELECT lot.id, lot.business_id, lot.ingredient_id, lot.remaining_quantity,
          lot.unit, lot.status, lot.cost_state, lot.recorded_cost_per_unit,
          lot.cost_per_unit
        FROM ingredient_lots lot
        WHERE lot.id = ? AND lot.deleted_at IS NULL
      `,
      [allocation.ingredient_lot_id],
    );
    if (!lot || lot.business_id !== plan.businessId) {
      throw new Error("Exact ingredient lot is missing for this plan allocation.");
    }
    if (lot.status === "archived") {
      throw new Error("Exact ingredient lot is archived and cannot be used.");
    }
    if (lot.unit !== allocation.unit) {
      throw new Error("Exact ingredient lot unit no longer matches the plan.");
    }
    if (lot.remaining_quantity + QUANTITY_TOLERANCE < allocation.quantity) {
      throw new Error(
        "Exact ingredient lot no longer has enough remaining quantity.",
      );
    }
    if (lot.cost_state !== "known") {
      throw new Error("Exact ingredient lot cost evidence is no longer known.");
    }
    if (
      lot.recorded_cost_per_unit === null ||
      !approximatelyEqual(
        lot.recorded_cost_per_unit,
        allocation.unit_cost_snapshot!,
      )
    ) {
      throw new Error(
        "Exact ingredient lot unit cost no longer matches the plan snapshot.",
      );
    }
    if (allocation.conversion_id || allocation.conversion_factor_snapshot !== null) {
      // Conversion evidence must still resolve to the same snapshot when used.
      if (
        allocation.conversion_factor_snapshot === null ||
        !Number.isFinite(allocation.conversion_factor_snapshot) ||
        allocation.conversion_factor_snapshot <= 0
      ) {
        throw new Error("Allocation conversion evidence is incomplete.");
      }
    }

    const lotBinding = await txn.getFirstAsync<{ catalog_item_id: string }>(
      `
        SELECT catalog_item_id
        FROM legacy_item_bindings
        WHERE business_id = ?
          AND entity_kind = 'ingredient'
          AND legacy_entity_id = ?
          AND binding_status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [plan.businessId, lot.ingredient_id],
    );
    const requirement = requirements.find(
      (row) => row.id === allocation.production_plan_requirement_id,
    );
    if (
      !requirement ||
      !lotBinding ||
      lotBinding.catalog_item_id !== requirement.catalog_item_id
    ) {
      throw new Error(
        "Exact ingredient lot no longer matches the requirement catalog binding.",
      );
    }
  }

  const batchId = makeProductionBatchId();
  const batchInsert = await txn.runAsync(
    `
      INSERT INTO production_batches (
        id, business_id, branch_id, recipe_id, output_product_id, recipe_name,
        output_quantity, output_unit, batch_multiplier, total_batch_cost,
        cost_per_output_unit, notes, created_at, updated_at, sync_status,
        deleted_at, recipe_version_id, production_plan_stage_id,
        expected_output_quantity, actual_output_quantity, expected_total_cost,
        actual_total_cost, cost_state, yield_variance_quantity,
        yield_variance_percent
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'local', NULL,
        ?, ?, ?, ?, ?, ?, 'known', 0, 0
      )
    `,
    [
      batchId,
      plan.businessId,
      plan.branchId,
      plan.rootRecipeId,
      product.id,
      version.name_snapshot || recipe.name,
      outputQuantity,
      stage.expected_output_unit,
      1,
      totalCost,
      costPerOutput,
      timestamp,
      timestamp,
      plan.rootRecipeVersionId,
      stage.id,
      outputQuantity,
      outputQuantity,
      totalCost,
      totalCost,
    ],
  );
  if (batchInsert.changes !== 1) {
    throw new Error("Could not create the production batch.");
  }

  for (const allocation of allocations) {
    const lotId = allocation.ingredient_lot_id!;
    const deduction = await txn.runAsync(
      `
        UPDATE ingredient_lots
        SET remaining_quantity = remaining_quantity - ?,
          status = CASE
            WHEN remaining_quantity - ? <= 0.000000001 THEN 'depleted'
            ELSE status
          END,
          updated_at = ?,
          sync_status = 'local'
        WHERE id = ?
          AND business_id = ?
          AND deleted_at IS NULL
          AND status != 'archived'
          AND remaining_quantity + 0.000000001 >= ?
      `,
      [
        allocation.quantity,
        allocation.quantity,
        timestamp,
        lotId,
        plan.businessId,
        allocation.quantity,
      ],
    );
    if (deduction.changes !== 1) {
      throw new Error(
        "Exact ingredient lot changed before deduction and the plan cannot execute safely.",
      );
    }

    const requirement = requirements.find(
      (row) => row.id === allocation.production_plan_requirement_id,
    )!;
    const recipeVersionLineId = recipeLineIdByRequirement.get(requirement.id);
    if (!recipeVersionLineId) {
      throw new Error(
        "Ingredient allocation is missing attributable Recipe-line provenance.",
      );
    }
    await txn.runAsync(
      `
        INSERT INTO ingredient_movements (
          id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
          unit_cost, total_cost, reason, created_at, updated_at, sync_status,
          deleted_at
        ) VALUES (
          ?, ?, (SELECT ingredient_id FROM ingredient_lots WHERE id = ?), ?,
          'recipe_usage', ?, ?, ?, ?, ?, ?, ?, 'local', NULL
        )
      `,
      [
        makeIngredientMovementId(),
        plan.businessId,
        lotId,
        lotId,
        allocation.quantity,
        allocation.unit,
        allocation.unit_cost_snapshot,
        allocation.cost_contribution,
        `Native production: ${version.name_snapshot || recipe.name}`,
        timestamp,
        timestamp,
      ],
    );

    await txn.runAsync(
      `
        INSERT INTO production_input_allocations (
          id, business_id, production_batch_id, recipe_version_line_id,
          production_plan_requirement_id, catalog_item_id, lot_kind,
          ingredient_lot_id, product_stock_lot_id, quantity_used, unit,
          normalized_quantity, normalized_unit, conversion_id,
          conversion_factor_snapshot, unit_cost_snapshot, cost_contribution,
          cost_state, allocation_mode, source_label_snapshot, created_at,
          updated_at, sync_status, deleted_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 'ingredient', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?,
          'known', ?, ?, ?, ?, 'local', NULL
        )
      `,
      [
        makeProductionInputAllocationId(),
        plan.businessId,
        batchId,
        recipeVersionLineId,
        requirement.id,
        requirement.catalog_item_id,
        lotId,
        allocation.quantity,
        allocation.unit,
        allocation.normalized_quantity,
        allocation.normalized_unit,
        allocation.conversion_id,
        allocation.conversion_factor_snapshot,
        allocation.unit_cost_snapshot,
        allocation.cost_contribution,
        allocation.allocation_mode,
        null,
        timestamp,
        timestamp,
      ],
    );
  }

  const productLotId = makeProductStockLotId();
  await addProductStockLotWithScalarProjection(
    {
      id: productLotId,
      businessId: plan.businessId,
      branchId: plan.branchId,
      productId: product.id,
      catalogItemId,
      originKind: "production",
      productionBatchId: batchId,
      originDate: timestamp.slice(0, 10),
      quantity: outputQuantity,
      unit: stage.expected_output_unit,
      recordedTotalCost: totalCost,
      recordedCostPerUnit: costPerOutput,
      costState: "known",
      provenanceState: "exact",
      movementType: "cooked",
      movementReason: `Native production: ${version.name_snapshot || recipe.name}`,
    },
    txn,
  );

  const stageUpdate = await txn.runAsync(
    `
      UPDATE production_plan_stages
      SET status = 'completed',
        actual_output_quantity = ?,
        production_batch_id = ?,
        shortage_state = 'none',
        variance_state = 'within_tolerance',
        updated_at = ?,
        sync_status = 'local'
      WHERE id = ?
        AND production_plan_id = ?
        AND status = 'ready'
        AND production_batch_id IS NULL
        AND deleted_at IS NULL
    `,
    [outputQuantity, batchId, timestamp, stage.id, plan.id],
  );
  if (stageUpdate.changes !== 1) {
    throw new Error("Production stage could not be marked completed.");
  }

  const planUpdate = await txn.runAsync(
    `
      UPDATE production_plans
      SET status = 'completed',
        started_at = COALESCE(started_at, ?),
        completed_at = ?,
        updated_at = ?,
        sync_status = 'local'
      WHERE id = ?
        AND status = 'ready'
        AND deleted_at IS NULL
    `,
    [timestamp, timestamp, timestamp, plan.id],
  );
  if (planUpdate.changes !== 1) {
    throw new Error("Production plan could not be marked completed.");
  }

  const allocationIds = allocations.map((row) => row.id);
  if (allocationIds.length > 0) {
    const placeholders = allocationIds.map(() => "?").join(", ");
    const committed = await txn.runAsync(
      `
        UPDATE production_plan_allocations
        SET selection_state = 'committed',
          updated_at = ?,
          sync_status = 'local'
        WHERE id IN (${placeholders})
          AND deleted_at IS NULL
      `,
      [timestamp, ...allocationIds],
    );
    if (committed.changes !== allocationIds.length) {
      throw new Error("Could not commit every plan allocation.");
    }
  }

  return {
    outcome: "executed",
    planId: plan.id,
    stageId: stage.id,
    productionBatchId: batchId,
    outputProductId: product.id,
    outputCatalogItemId: catalogItemId,
    outputQuantity,
    outputUnit: stage.expected_output_unit,
    totalCost,
    productStockLotId: productLotId,
  };
}

async function resolveIdempotentResult(
  snapshot: ProductionPlanSnapshot,
  stage: StageRow,
  existingBatch: {
    id: string;
    business_id: string;
    branch_id: string | null;
    recipe_id: string;
    recipe_version_id: string | null;
    production_plan_stage_id: string | null;
    output_product_id: string | null;
    output_quantity: number;
    output_unit: string;
    total_batch_cost: number;
    actual_total_cost: number | null;
    cost_state: string | null;
  },
  txn: RepositoryDatabase,
): Promise<SimpleNativeProductionResult> {
  const { plan } = snapshot;
  if (
    existingBatch.business_id !== plan.businessId ||
    existingBatch.recipe_id !== plan.rootRecipeId ||
    existingBatch.recipe_version_id !== plan.rootRecipeVersionId ||
    existingBatch.production_plan_stage_id !== stage.id ||
    (existingBatch.branch_id ?? null) !== (plan.branchId ?? null)
  ) {
    throw new Error(
      "Existing production batch does not match this plan identity.",
    );
  }
  if (plan.status !== "completed" || stage.status !== "completed") {
    throw new Error(
      "Production stage already has a batch but plan/stage are not completed consistently.",
    );
  }
  if (
    stage.production_batch_id &&
    stage.production_batch_id !== existingBatch.id
  ) {
    throw new Error(
      "Production stage points to a different batch than the stage ownership index.",
    );
  }

  const version = await txn.getFirstAsync<{
    id: string;
    business_id: string;
    recipe_id: string;
    output_catalog_item_id: string;
    expected_output_unit: string;
  }>(
    `
      SELECT id, business_id, recipe_id, output_catalog_item_id,
        expected_output_unit
      FROM recipe_versions
      WHERE id = ? AND deleted_at IS NULL
    `,
    [plan.rootRecipeVersionId],
  );
  if (
    !version ||
    version.business_id !== plan.businessId ||
    version.recipe_id !== plan.rootRecipeId
  ) {
    throw new Error(
      "Pinned Recipe version is unavailable for idempotent production identity.",
    );
  }

  const { product, catalogItemId } = await resolveLotBackedOutputProduct({
    businessId: plan.businessId,
    branchId: plan.branchId,
    outputCatalogItemId: version.output_catalog_item_id,
    expectedOutputUnit: version.expected_output_unit,
    txn,
  });
  if (existingBatch.output_product_id !== product.id) {
    throw new Error(
      "Existing production batch output Product does not match the pinned Recipe Product.",
    );
  }

  const outputLot = await txn.getFirstAsync<{
    id: string;
    catalog_item_id: string;
    product_id: string;
    origin_kind: string;
    production_batch_id: string | null;
  }>(
    `
      SELECT id, catalog_item_id, product_id, origin_kind, production_batch_id
      FROM product_stock_lots
      WHERE production_batch_id = ?
        AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `,
    [existingBatch.id],
  );
  if (
    !outputLot ||
    outputLot.origin_kind !== "production" ||
    outputLot.production_batch_id !== existingBatch.id ||
    outputLot.product_id !== product.id ||
    outputLot.catalog_item_id !== catalogItemId
  ) {
    throw new Error(
      "Existing production-origin Product lot does not match the pinned Recipe Product.",
    );
  }

  return {
    outcome: "already_completed",
    planId: plan.id,
    stageId: stage.id,
    productionBatchId: existingBatch.id,
    outputProductId: product.id,
    outputCatalogItemId: catalogItemId,
    outputQuantity: existingBatch.output_quantity,
    outputUnit: existingBatch.output_unit,
    totalCost:
      existingBatch.actual_total_cost ?? existingBatch.total_batch_cost,
    productStockLotId: outputLot.id,
  };
}
