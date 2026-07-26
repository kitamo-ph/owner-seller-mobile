import type { CostState } from "@/domain/costState";
import {
  makeProductionPlanAllocationId,
  makeProductionPlanId,
  makeProductionPlanRequirementId,
  makeProductionPlanStageId,
} from "@/domain/ids";

import {
  getRepositoryDatabase,
  nowIso,
  toInteger,
  type RepositoryDatabase,
} from "./shared";

export type PlanCostState = CostState | "partial";
export type ProductionPlanMode =
  | "use_prepared_stock_first"
  | "prepare_fresh";
export type ProductionPlanStatus =
  | "draft"
  | "ready"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "stale";
export type ProductionPlanStageStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "stale"
  | "short";
export type ProductionRequirementKind =
  | "ingredient"
  | "supply"
  | "prepared_product"
  | "custom";
export type PlannedLotKind = "ingredient" | "product";
export type PlannedAllocationMode =
  | "legacy_selected"
  | "manual"
  | "recommended_fefo"
  | "recommended_fifo"
  | "legacy_balance";

export type SaveProductionPlanAllocationInput = {
  id?: string;
  lotKind: PlannedLotKind;
  ingredientLotId?: string | null;
  productStockLotId?: string | null;
  allocationMode: PlannedAllocationMode;
  quantity: number;
  unit: string;
  normalizedQuantity?: number | null;
  normalizedUnit?: string | null;
  conversionId?: string | null;
  conversionFactorSnapshot?: number | null;
  unitCostSnapshot?: number | null;
  costContribution?: number | null;
  costState: PlanCostState;
  selectionState?: "recommended" | "manual" | "committed" | "stale";
};

export type SaveProductionPlanRequirementInput = {
  id?: string;
  catalogItemId?: string | null;
  requirementKind: ProductionRequirementKind;
  rawQuantity: number;
  rawUnit: string;
  normalizedQuantity?: number | null;
  normalizedUnit?: string | null;
  provenanceJson: string;
  isRequired?: boolean;
  expectedCost?: number | null;
  costState: PlanCostState;
  allocations: SaveProductionPlanAllocationInput[];
};

export type SaveProductionPlanStageInput = {
  id?: string;
  key: string;
  parentKey?: string | null;
  recipeVersionId: string;
  topologicalOrder: number;
  expectedInputMultiplier: number;
  expectedOutputQuantity: number;
  expectedOutputUnit: string;
  preparedStockQuantity: number;
  freshPrepareQuantity: number;
  status?: ProductionPlanStageStatus;
  shortageState?: "none" | "short" | "stale";
  varianceState?: "pending" | "within_tolerance" | "over" | "under";
  requirements: SaveProductionPlanRequirementInput[];
};

export type SaveProductionPlanInput = {
  id?: string;
  businessId: string;
  branchId?: string | null;
  rootRecipeId: string;
  rootRecipeVersionId: string;
  targetQuantity: number;
  targetUnit: string;
  preparationMode: ProductionPlanMode;
  status?: Extract<ProductionPlanStatus, "draft" | "ready">;
  calculationVersion: number;
  stockObservedAt: string;
  expectedTotalCost?: number | null;
  costState: PlanCostState;
  missingCostCount: number;
  stages: SaveProductionPlanStageInput[];
};

export type ProductionPlanRecord = {
  id: string;
  businessId: string;
  branchId: string | null;
  rootRecipeId: string;
  rootRecipeVersionId: string;
  targetQuantity: number;
  targetUnit: string;
  preparationMode: ProductionPlanMode;
  status: ProductionPlanStatus;
  calculationVersion: number;
  stockObservedAt: string;
  expectedTotalCost: number | null;
  costState: PlanCostState;
  missingCostCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProductionPlanRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  root_recipe_id: string;
  root_recipe_version_id: string;
  target_quantity: number;
  target_unit: string;
  preparation_mode: ProductionPlanMode;
  status: ProductionPlanStatus;
  calculation_version: number;
  stock_observed_at: string;
  expected_total_cost: number | null;
  cost_state: PlanCostState;
  missing_cost_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionPlanSnapshot = {
  plan: ProductionPlanRecord;
  stages: Record<string, unknown>[];
  requirements: Record<string, unknown>[];
  allocations: Record<string, unknown>[];
};

function mapPlan(row: ProductionPlanRow): ProductionPlanRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    rootRecipeId: row.root_recipe_id,
    rootRecipeVersionId: row.root_recipe_version_id,
    targetQuantity: row.target_quantity,
    targetUnit: row.target_unit,
    preparationMode: row.preparation_mode,
    status: row.status,
    calculationVersion: row.calculation_version,
    stockObservedAt: row.stock_observed_at,
    expectedTotalCost: row.expected_total_cost,
    costState: row.cost_state,
    missingCostCount: row.missing_cost_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePlanInput(input: SaveProductionPlanInput) {
  if (!Number.isFinite(input.targetQuantity) || input.targetQuantity <= 0) {
    throw new Error("Production target must be greater than zero.");
  }
  if (!Number.isInteger(input.missingCostCount) || input.missingCostCount < 0) {
    throw new Error("Missing-cost count must be a non-negative integer.");
  }
  if (
    !Number.isInteger(input.calculationVersion) ||
    input.calculationVersion < 1
  ) {
    throw new Error("Calculation version must be a positive integer.");
  }
  if (input.stages.length === 0) {
    throw new Error("Production plan requires at least one stage.");
  }
  if (
    (input.costState === "known" &&
      (input.expectedTotalCost === null ||
        input.expectedTotalCost === undefined ||
        !Number.isFinite(input.expectedTotalCost) ||
        input.expectedTotalCost < 0)) ||
    (input.costState !== "known" &&
      input.expectedTotalCost !== null &&
      input.expectedTotalCost !== undefined)
  ) {
    throw new Error("Production-plan cost evidence is inconsistent.");
  }
  const keys = new Set<string>();
  input.stages.forEach((stage) => {
    if (!stage.key.trim() || keys.has(stage.key)) {
      throw new Error("Production-plan stage keys must be unique.");
    }
    keys.add(stage.key);
    if (
      !Number.isInteger(stage.topologicalOrder) ||
      stage.topologicalOrder < 0 ||
      !Number.isFinite(stage.expectedOutputQuantity) ||
      stage.expectedOutputQuantity <= 0
    ) {
      throw new Error("Production-plan stage quantities/order are invalid.");
    }
  });
  for (const stage of input.stages) {
    if (stage.parentKey && !keys.has(stage.parentKey)) {
      throw new Error("Production-plan parent stage is missing.");
    }
  }
}

/**
 * Saves a calculation snapshot only. It deliberately contains no UPDATE or
 * INSERT against Product/Ingredient lots, scalar stock, movements, batches,
 * or sales.
 */
export async function saveProductionPlan(
  input: SaveProductionPlanInput,
  db?: RepositoryDatabase,
) {
  validatePlanInput(input);
  const database = getRepositoryDatabase(db);
  const timestamp = nowIso();
  const planId = input.id ?? makeProductionPlanId();
  const stageIds = new Map(
    input.stages.map((stage) => [
      stage.key,
      stage.id ?? makeProductionPlanStageId(),
    ]),
  );

  await database.withExclusiveTransactionAsync(async (txn) => {
    const rootVersion = await txn.getFirstAsync<{
      recipe_id: string;
      business_id: string;
    }>(
      `
        SELECT recipe_id, business_id
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.rootRecipeVersionId],
    );
    if (
      !rootVersion ||
      rootVersion.recipe_id !== input.rootRecipeId ||
      rootVersion.business_id !== input.businessId
    ) {
      throw new Error("Production-plan root Recipe/version is inconsistent.");
    }
    const uniqueVersionIds = [
      ...new Set(input.stages.map((stage) => stage.recipeVersionId)),
    ];
    const stageVersions = await txn.getAllAsync<{
      id: string;
      business_id: string;
    }>(
      `
        SELECT id, business_id
        FROM recipe_versions
        WHERE id IN (${uniqueVersionIds.map(() => "?").join(", ")})
          AND deleted_at IS NULL
      `,
      uniqueVersionIds,
    );
    if (
      stageVersions.length !== uniqueVersionIds.length ||
      stageVersions.some((version) => version.business_id !== input.businessId)
    ) {
      throw new Error("Production plan contains unavailable Recipe versions.");
    }

    await txn.runAsync(
      `
        INSERT INTO production_plans (
          id, business_id, branch_id, root_recipe_id, root_recipe_version_id,
          target_quantity, target_unit, preparation_mode, status,
          calculation_version, stock_observed_at, expected_total_cost,
          cost_state, missing_cost_count, started_at, completed_at, created_at,
          updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'local', NULL)
      `,
      [
        planId,
        input.businessId,
        input.branchId ?? null,
        input.rootRecipeId,
        input.rootRecipeVersionId,
        input.targetQuantity,
        input.targetUnit,
        input.preparationMode,
        input.status ?? "draft",
        input.calculationVersion,
        input.stockObservedAt,
        input.expectedTotalCost ?? null,
        input.costState,
        input.missingCostCount,
        timestamp,
        timestamp,
      ],
    );

    for (const stage of [...input.stages].sort(
      (left, right) => right.topologicalOrder - left.topologicalOrder,
    )) {
      const stageId = stageIds.get(stage.key);
      if (!stageId) throw new Error("Production stage ID allocation failed.");
      await txn.runAsync(
        `
          INSERT INTO production_plan_stages (
            id, business_id, production_plan_id, recipe_version_id,
            parent_stage_id, topological_order, expected_input_multiplier,
            expected_output_quantity, expected_output_unit,
            prepared_stock_quantity, fresh_prepare_quantity, status,
            actual_output_quantity, production_batch_id, shortage_state,
            variance_state, created_at, updated_at, sync_status, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 'local', NULL)
        `,
        [
          stageId,
          input.businessId,
          planId,
          stage.recipeVersionId,
          stage.parentKey ? stageIds.get(stage.parentKey) ?? null : null,
          stage.topologicalOrder,
          stage.expectedInputMultiplier,
          stage.expectedOutputQuantity,
          stage.expectedOutputUnit,
          stage.preparedStockQuantity,
          stage.freshPrepareQuantity,
          stage.status ?? "pending",
          stage.shortageState ?? "none",
          stage.varianceState ?? "pending",
          timestamp,
          timestamp,
        ],
      );
    }

    for (const stage of input.stages) {
      const stageId = stageIds.get(stage.key);
      if (!stageId) throw new Error("Production stage ID allocation failed.");
      for (const requirement of stage.requirements) {
        const requirementId =
          requirement.id ?? makeProductionPlanRequirementId();
        await txn.runAsync(
          `
            INSERT INTO production_plan_requirements (
              id, business_id, production_plan_stage_id, catalog_item_id,
              requirement_kind, raw_quantity, raw_unit, normalized_quantity,
              normalized_unit, provenance_json, is_required, expected_cost,
              cost_state, created_at, updated_at, sync_status, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
          `,
          [
            requirementId,
            input.businessId,
            stageId,
            requirement.catalogItemId ?? null,
            requirement.requirementKind,
            requirement.rawQuantity,
            requirement.rawUnit,
            requirement.normalizedQuantity ?? null,
            requirement.normalizedUnit ?? null,
            requirement.provenanceJson,
            toInteger(requirement.isRequired ?? true),
            requirement.expectedCost ?? null,
            requirement.costState,
            timestamp,
            timestamp,
          ],
        );

        for (const [sortOrder, allocation] of requirement.allocations.entries()) {
          const exactLotCount = [
            allocation.ingredientLotId,
            allocation.productStockLotId,
          ].filter(Boolean).length;
          if (
            exactLotCount !== 1 ||
            (allocation.lotKind === "ingredient" &&
              !allocation.ingredientLotId) ||
            (allocation.lotKind === "product" &&
              !allocation.productStockLotId)
          ) {
            throw new Error("Plan allocation requires one matching exact lot.");
          }

          await txn.runAsync(
            `
              INSERT INTO production_plan_allocations (
                id, business_id, production_plan_requirement_id, lot_kind,
                ingredient_lot_id, product_stock_lot_id, allocation_mode,
                quantity, unit, normalized_quantity, normalized_unit,
                conversion_id, conversion_factor_snapshot, unit_cost_snapshot,
                cost_contribution, cost_state, selection_state, sort_order,
                created_at, updated_at, sync_status, deleted_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
            `,
            [
              allocation.id ?? makeProductionPlanAllocationId(),
              input.businessId,
              requirementId,
              allocation.lotKind,
              allocation.ingredientLotId ?? null,
              allocation.productStockLotId ?? null,
              allocation.allocationMode,
              allocation.quantity,
              allocation.unit,
              allocation.normalizedQuantity ?? null,
              allocation.normalizedUnit ?? null,
              allocation.conversionId ?? null,
              allocation.conversionFactorSnapshot ?? null,
              allocation.unitCostSnapshot ?? null,
              allocation.costContribution ?? null,
              allocation.costState,
              allocation.selectionState ?? "recommended",
              sortOrder,
              timestamp,
              timestamp,
            ],
          );
        }
      }
    }
  });

  const saved = await getProductionPlanById(planId, database);
  if (!saved) throw new Error("Saved production plan is unavailable.");
  return saved;
}

export async function getProductionPlanById(
  id: string,
  db?: RepositoryDatabase,
): Promise<ProductionPlanSnapshot | null> {
  const database = getRepositoryDatabase(db);
  const row = await database.getFirstAsync<ProductionPlanRow>(
    "SELECT * FROM production_plans WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  if (!row) return null;
  const stages = await database.getAllAsync<Record<string, unknown>>(
    `
      SELECT *
      FROM production_plan_stages
      WHERE production_plan_id = ? AND deleted_at IS NULL
      ORDER BY topological_order ASC, id ASC
    `,
    [id],
  );
  const stageIds = stages.map((stage) => String(stage.id));
  if (stageIds.length === 0) {
    return { plan: mapPlan(row), stages, requirements: [], allocations: [] };
  }
  const placeholders = stageIds.map(() => "?").join(", ");
  const requirements = await database.getAllAsync<Record<string, unknown>>(
    `
      SELECT *
      FROM production_plan_requirements
      WHERE production_plan_stage_id IN (${placeholders})
        AND deleted_at IS NULL
      ORDER BY production_plan_stage_id ASC, id ASC
    `,
    stageIds,
  );
  const requirementIds = requirements.map((requirement) =>
    String(requirement.id),
  );
  const allocations =
    requirementIds.length === 0
      ? []
      : await database.getAllAsync<Record<string, unknown>>(
          `
            SELECT *
            FROM production_plan_allocations
            WHERE production_plan_requirement_id IN (${requirementIds
              .map(() => "?")
              .join(", ")})
              AND deleted_at IS NULL
            ORDER BY production_plan_requirement_id ASC, sort_order ASC, id ASC
          `,
          requirementIds,
        );
  return { plan: mapPlan(row), stages, requirements, allocations };
}

export async function transitionProductionPlanStatus(
  planId: string,
  expectedStatus: ProductionPlanStatus,
  nextStatus: ProductionPlanStatus,
  db?: RepositoryDatabase,
) {
  const allowed: Record<ProductionPlanStatus, ProductionPlanStatus[]> = {
    draft: ["ready", "cancelled", "stale"],
    ready: ["in_progress", "cancelled", "stale"],
    in_progress: ["completed", "cancelled", "stale"],
    completed: [],
    cancelled: [],
    stale: ["draft", "cancelled"],
  };
  if (!allowed[expectedStatus].includes(nextStatus)) {
    throw new Error("Invalid production-plan status transition.");
  }
  const timestamp = nowIso();
  const result = await getRepositoryDatabase(db).runAsync(
    `
      UPDATE production_plans
      SET status = ?,
        started_at = CASE
          WHEN ? = 'in_progress' THEN COALESCE(started_at, ?)
          ELSE started_at
        END,
        completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
        updated_at = ?, sync_status = 'local'
      WHERE id = ? AND status = ? AND deleted_at IS NULL
    `,
    [
      nextStatus,
      nextStatus,
      timestamp,
      nextStatus,
      timestamp,
      timestamp,
      planId,
      expectedStatus,
    ],
  );
  if (result.changes !== 1) {
    throw new Error("Production plan changed before the status update.");
  }
}
