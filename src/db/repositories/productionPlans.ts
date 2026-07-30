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

type PersistedPlanVersion = {
  id: string;
  business_id: string;
  recipe_id: string;
  status: string;
  output_catalog_item_id: string;
  expected_output_quantity: number;
  expected_output_unit: string;
};

const PLAN_QUANTITY_TOLERANCE = 1e-9;

function approximatelyEqual(left: number, right: number) {
  return Math.abs(left - right) <= PLAN_QUANTITY_TOLERANCE;
}

function validateCostEvidence(
  state: PlanCostState,
  amount: number | null | undefined,
  label: string,
) {
  if (
    (state === "known" &&
      (amount === null ||
        amount === undefined ||
        !Number.isFinite(amount) ||
        amount < 0)) ||
    (state !== "known" && amount !== null && amount !== undefined)
  ) {
    throw new Error(`${label} cost evidence is inconsistent.`);
  }
}

function aggregatePlanCostState(
  states: readonly PlanCostState[],
): PlanCostState {
  const applicable = states.filter((state) => state !== "not_applicable");
  if (applicable.length === 0) return "not_applicable";
  if (applicable.includes("partial")) return "partial";

  const hasKnown = applicable.includes("known");
  const hasUnknown = applicable.includes("unknown");
  const hasLegacy = applicable.includes("legacy_zero_unresolved");
  if (!hasUnknown && !hasLegacy) return "known";
  if (hasKnown) return "partial";
  return hasUnknown ? "unknown" : "legacy_zero_unresolved";
}

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
  if (
    !input.businessId.trim() ||
    !input.rootRecipeId.trim() ||
    !input.rootRecipeVersionId.trim() ||
    !input.targetUnit.trim() ||
    !input.stockObservedAt.trim() ||
    !Number.isFinite(input.targetQuantity) ||
    input.targetQuantity <= 0
  ) {
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
  validateCostEvidence(
    input.costState,
    input.expectedTotalCost,
    "Production-plan",
  );
  const keys = new Set<string>();
  const orders = new Set<number>();
  input.stages.forEach((stage) => {
    if (
      !stage.key.trim() ||
      !stage.recipeVersionId.trim() ||
      !stage.expectedOutputUnit.trim() ||
      keys.has(stage.key) ||
      orders.has(stage.topologicalOrder)
    ) {
      throw new Error("Production-plan stage keys/order must be unique.");
    }
    keys.add(stage.key);
    orders.add(stage.topologicalOrder);
    if (
      !Number.isInteger(stage.topologicalOrder) ||
      stage.topologicalOrder < 0 ||
      !Number.isFinite(stage.expectedInputMultiplier) ||
      stage.expectedInputMultiplier < 0 ||
      !Number.isFinite(stage.expectedOutputQuantity) ||
      stage.expectedOutputQuantity <= 0 ||
      !Number.isFinite(stage.preparedStockQuantity) ||
      stage.preparedStockQuantity < 0 ||
      !Number.isFinite(stage.freshPrepareQuantity) ||
      stage.freshPrepareQuantity < 0 ||
      !approximatelyEqual(
        stage.preparedStockQuantity + stage.freshPrepareQuantity,
        stage.expectedOutputQuantity,
      )
    ) {
      throw new Error("Production-plan stage quantities/order are invalid.");
    }

    for (const requirement of stage.requirements) {
      if (
        !requirement.rawUnit.trim() ||
        !Number.isFinite(requirement.rawQuantity) ||
        requirement.rawQuantity < 0 ||
        (requirement.requirementKind === "custom"
          ? Boolean(requirement.catalogItemId)
          : !requirement.catalogItemId)
      ) {
        throw new Error("Production-plan requirement is invalid.");
      }
      validateCostEvidence(
        requirement.costState,
        requirement.expectedCost,
        "Production-plan requirement",
      );
      try {
        const provenance = JSON.parse(requirement.provenanceJson) as unknown;
        if (!Array.isArray(provenance) || provenance.length === 0) {
          throw new Error();
        }
      } catch {
        throw new Error("Production-plan provenance must be a non-empty JSON array.");
      }

      let normalizedAllocationTotal = 0;
      const exactLots = new Set<string>();
      for (const allocation of requirement.allocations) {
        const exactLotCount = [
          allocation.ingredientLotId,
          allocation.productStockLotId,
        ].filter(Boolean).length;
        const lotId =
          allocation.ingredientLotId ?? allocation.productStockLotId ?? "";
        if (
          exactLotCount !== 1 ||
          (allocation.lotKind === "ingredient" &&
            !allocation.ingredientLotId) ||
          (allocation.lotKind === "product" &&
            !allocation.productStockLotId) ||
          exactLots.has(`${allocation.lotKind}:${lotId}`) ||
          !allocation.unit.trim() ||
          !allocation.normalizedUnit?.trim() ||
          !Number.isFinite(allocation.quantity) ||
          allocation.quantity <= 0 ||
          !Number.isFinite(allocation.normalizedQuantity) ||
          (allocation.normalizedQuantity as number) <= 0 ||
          !Number.isFinite(allocation.conversionFactorSnapshot) ||
          (allocation.conversionFactorSnapshot as number) <= 0 ||
          !approximatelyEqual(
            allocation.quantity *
              (allocation.conversionFactorSnapshot as number),
            allocation.normalizedQuantity as number,
          )
        ) {
          throw new Error("Plan allocation requires consistent exact lot evidence.");
        }
        exactLots.add(`${allocation.lotKind}:${lotId}`);
        validateCostEvidence(
          allocation.costState,
          allocation.costContribution,
          "Production-plan allocation",
        );
        if (
          (allocation.costState === "known" &&
            (allocation.unitCostSnapshot === null ||
              allocation.unitCostSnapshot === undefined ||
              !Number.isFinite(allocation.unitCostSnapshot) ||
              allocation.unitCostSnapshot < 0 ||
              !approximatelyEqual(
                allocation.quantity * allocation.unitCostSnapshot,
                allocation.costContribution as number,
              ))) ||
          (allocation.costState !== "known" &&
            allocation.unitCostSnapshot !== null &&
            allocation.unitCostSnapshot !== undefined)
        ) {
          throw new Error("Production-plan allocation unit cost is inconsistent.");
        }
        normalizedAllocationTotal += allocation.normalizedQuantity as number;
      }
      if (
        normalizedAllocationTotal >
        requirement.rawQuantity + PLAN_QUANTITY_TOLERANCE
      ) {
        throw new Error("Production-plan allocations exceed their requirement.");
      }
      if (
        requirement.requirementKind === "prepared_product" &&
        !approximatelyEqual(
          normalizedAllocationTotal,
          requirement.rawQuantity,
        )
      ) {
        throw new Error("Prepared-stock use requires complete exact allocation.");
      }
    }
  });
  for (const stage of input.stages) {
    const parent = stage.parentKey
      ? input.stages.find((candidate) => candidate.key === stage.parentKey)
      : null;
    if (
      stage.parentKey &&
      (!parent ||
        parent.key === stage.key ||
        parent.topologicalOrder <= stage.topologicalOrder)
    ) {
      throw new Error("Production-plan parent stage is missing or misordered.");
    }
  }
}

async function validatePersistedPlanEvidence(
  input: SaveProductionPlanInput,
  versionById: ReadonlyMap<string, PersistedPlanVersion>,
  txn: RepositoryDatabase,
) {
  const requirements = input.stages.flatMap((stage) =>
    stage.requirements.map((requirement) => ({ stage, requirement })),
  );
  const catalogItemIds = [
    ...new Set(
      requirements
        .map(({ requirement }) => requirement.catalogItemId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const catalogRows =
    catalogItemIds.length === 0
      ? []
      : await txn.getAllAsync<{
          id: string;
          business_id: string;
          stock_policy: string;
        }>(
          `
            SELECT id, business_id, stock_policy
            FROM catalog_items
            WHERE id IN (${catalogItemIds.map(() => "?").join(", ")})
              AND deleted_at IS NULL
              AND lifecycle_status <> 'archived'
          `,
          catalogItemIds,
        );
  if (
    catalogRows.length !== catalogItemIds.length ||
    catalogRows.some((item) => item.business_id !== input.businessId)
  ) {
    throw new Error("Production plan contains unavailable catalog evidence.");
  }
  const catalogById = new Map(catalogRows.map((item) => [item.id, item]));

  const versionIds = [...versionById.keys()];
  const lineRows = await txn.getAllAsync<{
    id: string;
    business_id: string;
    recipe_version_id: string;
    source_kind: string;
    catalog_item_id: string | null;
    cost_state: string;
  }>(
    `
      SELECT id, business_id, recipe_version_id, source_kind, catalog_item_id,
        cost_state
      FROM recipe_version_lines
      WHERE recipe_version_id IN (${versionIds.map(() => "?").join(", ")})
        AND deleted_at IS NULL
    `,
    versionIds,
  );
  const lineById = new Map(lineRows.map((line) => [line.id, line]));
  const allocatedByLot = new Map<
    string,
    { allocated: number; remaining: number }
  >();
  const persistedRequirementCostStates: PlanCostState[] = [];
  let persistedKnownCostTotal = 0;

  for (const { stage, requirement } of requirements) {
    const version = versionById.get(stage.recipeVersionId);
    if (!version) {
      throw new Error("Production requirement has no pinned Recipe version.");
    }
    const provenance = JSON.parse(requirement.provenanceJson) as unknown[];
    let provenanceQuantity = 0;
    const provenanceLineCostStates: string[] = [];
    for (const value of provenance) {
      if (!value || typeof value !== "object") {
        throw new Error("Production-plan provenance entry is invalid.");
      }
      const entry = value as Record<string, unknown>;
      const quantity = Number(entry.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error("Production-plan provenance quantity is invalid.");
      }
      provenanceQuantity += quantity;
      if (entry.kind === "prepared_stock") {
        if (
          requirement.requirementKind !== "prepared_product" ||
          entry.versionId !== stage.recipeVersionId ||
          requirement.catalogItemId !== version.output_catalog_item_id
        ) {
          throw new Error("Prepared-stock provenance is detached from its Recipe version.");
        }
        continue;
      }

      const lineId =
        typeof entry.lineId === "string" ? entry.lineId : "";
      const line = lineById.get(lineId);
      if (
        !line ||
        line.business_id !== input.businessId ||
        line.recipe_version_id !== stage.recipeVersionId ||
        entry.versionId !== stage.recipeVersionId ||
        (requirement.requirementKind === "custom"
          ? line.source_kind !== "custom_cost" ||
            requirement.catalogItemId !== null
          : line.source_kind !== "catalog_item" ||
            line.catalog_item_id !== requirement.catalogItemId)
      ) {
        throw new Error("Production requirement is detached from persisted Recipe content.");
      }
      provenanceLineCostStates.push(line.cost_state);
    }
    if (!approximatelyEqual(provenanceQuantity, requirement.rawQuantity)) {
      throw new Error("Production requirement quantity differs from its provenance.");
    }

    const catalogItem = requirement.catalogItemId
      ? catalogById.get(requirement.catalogItemId)
      : null;
    let normalizedAllocationTotal = 0;
    let knownAllocationCost = 0;
    const allocationCostStates: CostState[] = [];
    for (const allocation of requirement.allocations) {
      if (allocation.costState === "partial") {
        throw new Error("Exact lot allocation cannot have a partial cost state.");
      }
      allocationCostStates.push(allocation.costState);
      const lot =
        allocation.lotKind === "ingredient"
          ? await txn.getFirstAsync<{
              business_id: string;
              branch_id: null;
              remaining_quantity: number;
              unit: string;
              status: string;
              cost_state: CostState;
              recorded_cost_per_unit: number | null;
              catalog_item_id: string;
            }>(
              `
                SELECT lot.business_id, NULL AS branch_id,
                  lot.remaining_quantity, lot.unit, lot.status,
                  lot.cost_state, lot.recorded_cost_per_unit,
                  binding.catalog_item_id
                FROM ingredient_lots lot
                INNER JOIN legacy_item_bindings binding
                  ON binding.entity_kind = 'ingredient'
                  AND binding.legacy_entity_id = lot.ingredient_id
                  AND binding.binding_status = 'active'
                  AND binding.deleted_at IS NULL
                WHERE lot.id = ? AND lot.deleted_at IS NULL
              `,
              [allocation.ingredientLotId as string],
            )
          : await txn.getFirstAsync<{
              business_id: string;
              branch_id: string | null;
              remaining_quantity: number;
              unit: string;
              status: string;
              cost_state: CostState;
              recorded_cost_per_unit: number | null;
              catalog_item_id: string;
            }>(
              `
                SELECT business_id, branch_id, remaining_quantity, unit,
                  status, cost_state, recorded_cost_per_unit, catalog_item_id
                FROM product_stock_lots
                WHERE id = ? AND deleted_at IS NULL
              `,
              [allocation.productStockLotId as string],
            );
      if (
        !lot ||
        !catalogItem ||
        lot.business_id !== input.businessId ||
        lot.catalog_item_id !== requirement.catalogItemId ||
        lot.status !== "active" ||
        lot.unit !== allocation.unit ||
        (input.branchId &&
          lot.branch_id !== null &&
          lot.branch_id !== input.branchId) ||
        lot.cost_state !== allocation.costState ||
        (lot.cost_state === "known" &&
          !approximatelyEqual(
            lot.recorded_cost_per_unit as number,
            allocation.unitCostSnapshot as number,
          )) ||
        (requirement.requirementKind === "prepared_product" &&
          allocation.lotKind !== "product") ||
        ((requirement.requirementKind === "ingredient" ||
          requirement.requirementKind === "supply") &&
          allocation.lotKind !== "ingredient")
      ) {
        throw new Error("Production-plan allocation is detached from its exact stock lot.");
      }
      if (allocation.normalizedUnit !== requirement.rawUnit) {
        throw new Error("Production-plan allocation unit does not match its requirement.");
      }

      if (allocation.unit === requirement.rawUnit) {
        if (
          allocation.conversionId ||
          !approximatelyEqual(
            allocation.conversionFactorSnapshot as number,
            1,
          )
        ) {
          throw new Error("Same-unit allocation has invalid conversion evidence.");
        }
      } else {
        const conversion = await txn.getFirstAsync<{ factor: number }>(
          `
            SELECT factor
            FROM item_unit_conversions
            WHERE id = ? AND business_id = ? AND catalog_item_id = ?
              AND from_unit = ? AND to_unit = ?
              AND status = 'active' AND deleted_at IS NULL
          `,
          [
            allocation.conversionId ?? null,
            input.businessId,
            requirement.catalogItemId,
            allocation.unit,
            requirement.rawUnit,
          ],
        );
        if (
          !conversion ||
          !approximatelyEqual(
            conversion.factor,
            allocation.conversionFactorSnapshot as number,
          )
        ) {
          throw new Error("Production-plan unit conversion is unavailable or stale.");
        }
      }

      const lotId = (
        allocation.ingredientLotId ?? allocation.productStockLotId
      ) as string;
      const lotKey = `${allocation.lotKind}:${lotId}`;
      const usage = allocatedByLot.get(lotKey) ?? {
        allocated: 0,
        remaining: lot.remaining_quantity,
      };
      usage.allocated += allocation.quantity;
      if (
        usage.allocated >
        usage.remaining + PLAN_QUANTITY_TOLERANCE
      ) {
        throw new Error("Production plan allocates more than the lot balance.");
      }
      allocatedByLot.set(lotKey, usage);
      normalizedAllocationTotal += allocation.normalizedQuantity as number;
      knownAllocationCost += allocation.costContribution ?? 0;
    }

    if (
      requirement.requirementKind !== "custom" &&
      catalogItem &&
      catalogItem.stock_policy !== "untracked"
    ) {
      const exactCostStates: PlanCostState[] = [...allocationCostStates];
      const definitionIsNotApplicable =
        provenanceLineCostStates.length > 0 &&
        provenanceLineCostStates.every(
          (state) => state === "not_applicable",
        );
      if (
        normalizedAllocationTotal + PLAN_QUANTITY_TOLERANCE <
          requirement.rawQuantity &&
        !definitionIsNotApplicable
      ) {
        exactCostStates.push("unknown");
      }
      if (exactCostStates.length === 0) {
        exactCostStates.push(
          definitionIsNotApplicable ? "not_applicable" : "unknown",
        );
      }
      const exactCostState = aggregatePlanCostState(exactCostStates);
      if (
        requirement.costState !== exactCostState ||
        (exactCostState === "known" &&
          !approximatelyEqual(
            requirement.expectedCost as number,
            knownAllocationCost,
          ))
      ) {
        throw new Error(
          "Production requirement cost does not match exact lot allocations.",
        );
      }
    }

    persistedRequirementCostStates.push(requirement.costState);
    persistedKnownCostTotal += requirement.expectedCost ?? 0;

    if (
      (input.status ?? "draft") === "ready" &&
      catalogItem &&
      catalogItem.stock_policy !== "untracked" &&
      !approximatelyEqual(
        normalizedAllocationTotal,
        requirement.rawQuantity,
      )
    ) {
      throw new Error("Ready production plan lacks complete exact stock allocation.");
    }
  }

  const persistedPlanCostState = aggregatePlanCostState(
    persistedRequirementCostStates,
  );
  if (
    input.costState !== persistedPlanCostState ||
    (persistedPlanCostState === "known" &&
      !approximatelyEqual(
        input.expectedTotalCost as number,
        persistedKnownCostTotal,
      ))
  ) {
    throw new Error(
      "Production-plan cost does not match persisted requirement evidence.",
    );
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
      status: string;
      expected_output_unit: string;
    }>(
      `
        SELECT recipe_id, business_id, status, expected_output_unit
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.rootRecipeVersionId],
    );
    if (
      !rootVersion ||
      rootVersion.recipe_id !== input.rootRecipeId ||
      rootVersion.business_id !== input.businessId ||
      rootVersion.status !== "published" ||
      rootVersion.expected_output_unit !== input.targetUnit
    ) {
      throw new Error("Production-plan root Recipe/version is inconsistent.");
    }
    if (input.branchId) {
      const branch = await txn.getFirstAsync<{ business_id: string }>(
        "SELECT business_id FROM branches WHERE id = ? AND deleted_at IS NULL",
        [input.branchId],
      );
      if (!branch || branch.business_id !== input.businessId) {
        throw new Error("Production-plan branch belongs to another business.");
      }
    }
    const uniqueVersionIds = [
      ...new Set(input.stages.map((stage) => stage.recipeVersionId)),
    ];
    const stageVersions = await txn.getAllAsync<PersistedPlanVersion>(
      `
        SELECT id, business_id, recipe_id, status, output_catalog_item_id,
          expected_output_quantity, expected_output_unit
        FROM recipe_versions
        WHERE id IN (${uniqueVersionIds.map(() => "?").join(", ")})
          AND deleted_at IS NULL
      `,
      uniqueVersionIds,
    );
    if (
      uniqueVersionIds.length !== input.stages.length ||
      stageVersions.length !== uniqueVersionIds.length ||
      stageVersions.some(
        (version) =>
          version.business_id !== input.businessId ||
          !["published", "superseded"].includes(version.status),
      )
    ) {
      throw new Error("Production plan contains unavailable Recipe versions.");
    }
    const versionById = new Map(
      stageVersions.map((version) => [version.id, version]),
    );
    for (const stage of input.stages) {
      const version = versionById.get(stage.recipeVersionId);
      if (
        !version ||
        version.expected_output_unit !== stage.expectedOutputUnit ||
        !approximatelyEqual(
          stage.expectedInputMultiplier,
          stage.freshPrepareQuantity / version.expected_output_quantity,
        )
      ) {
        throw new Error("Production stage does not match its pinned Recipe version.");
      }
    }

    await validatePersistedPlanEvidence(input, versionById, txn);

    const existingPlan = await txn.getFirstAsync<{
      business_id: string;
      branch_id: string | null;
      root_recipe_id: string;
      root_recipe_version_id: string;
      status: ProductionPlanStatus;
      calculation_version: number;
    }>(
      `
        SELECT business_id, branch_id, root_recipe_id, root_recipe_version_id,
          status, calculation_version
        FROM production_plans
        WHERE id = ? AND deleted_at IS NULL
      `,
      [planId],
    );

    if (existingPlan) {
      if (
        existingPlan.business_id !== input.businessId ||
        existingPlan.branch_id !== (input.branchId ?? null) ||
        existingPlan.root_recipe_id !== input.rootRecipeId ||
        existingPlan.root_recipe_version_id !== input.rootRecipeVersionId
      ) {
        throw new Error("Production-plan recalculation changed pinned identity.");
      }
      if (!["draft", "ready", "stale"].includes(existingPlan.status)) {
        throw new Error("An executing or closed production plan cannot be recalculated.");
      }
      if (
        input.calculationVersion !==
        existingPlan.calculation_version + 1
      ) {
        throw new Error("Production-plan calculation version is not sequential.");
      }

      const executionEvidence = await txn.getFirstAsync<{ count: number }>(
        `
          SELECT COUNT(*) AS count
          FROM production_plan_stages stage
          LEFT JOIN production_batches batch
            ON batch.production_plan_stage_id = stage.id
            AND batch.deleted_at IS NULL
          LEFT JOIN production_plan_requirements requirement
            ON requirement.production_plan_stage_id = stage.id
          LEFT JOIN production_input_allocations allocation
            ON allocation.production_plan_requirement_id = requirement.id
            AND allocation.deleted_at IS NULL
          WHERE stage.production_plan_id = ?
            AND (
              stage.production_batch_id IS NOT NULL
              OR stage.actual_output_quantity IS NOT NULL
              OR stage.status IN ('in_progress', 'completed')
              OR batch.id IS NOT NULL
              OR allocation.id IS NOT NULL
            )
        `,
        [planId],
      );
      if ((executionEvidence?.count ?? 0) > 0) {
        throw new Error("Production-plan execution evidence blocks recalculation.");
      }

      await txn.runAsync(
        `
          DELETE FROM production_plan_allocations
          WHERE production_plan_requirement_id IN (
            SELECT requirement.id
            FROM production_plan_requirements requirement
            INNER JOIN production_plan_stages stage
              ON stage.id = requirement.production_plan_stage_id
            WHERE stage.production_plan_id = ?
          )
        `,
        [planId],
      );
      await txn.runAsync(
        `
          DELETE FROM production_plan_requirements
          WHERE production_plan_stage_id IN (
            SELECT id
            FROM production_plan_stages
            WHERE production_plan_id = ?
          )
        `,
        [planId],
      );
      await txn.runAsync(
        "DELETE FROM production_plan_stages WHERE production_plan_id = ?",
        [planId],
      );
      const update = await txn.runAsync(
        `
          UPDATE production_plans
          SET target_quantity = ?, target_unit = ?, preparation_mode = ?,
            status = ?, calculation_version = ?, stock_observed_at = ?,
            expected_total_cost = ?, cost_state = ?, missing_cost_count = ?,
            started_at = NULL, completed_at = NULL, updated_at = ?,
            sync_status = 'local'
          WHERE id = ? AND calculation_version = ? AND deleted_at IS NULL
        `,
        [
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
          planId,
          existingPlan.calculation_version,
        ],
      );
      if (update.changes !== 1) {
        throw new Error("Production plan changed before recalculation.");
      }
    } else {
      if (input.calculationVersion !== 1) {
        throw new Error("A new production plan must start at calculation version 1.");
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
    }

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
    ready: ["draft", "in_progress", "cancelled", "stale"],
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
