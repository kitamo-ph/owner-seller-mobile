/**
 * Pure nested-production planning and expected/actual yield math.
 *
 * Planning reads a caller-provided graph/stock snapshot and returns a detached
 * plan. It never reserves, deducts, or writes stock, lots, movements, batches,
 * COGS, or recipe versions.
 */

import {
  normalizeRecipeGraphLeafLine,
  validateRecipeGraph,
  type RecipeGraphCatalogLine,
  type RecipeGraphCostState,
  type RecipeGraphCustomCostLine,
  type RecipeGraphLimits,
  type RecipeGraphVersion,
} from "./recipeGraph";

const QUANTITY_EPSILON = 1e-9;

export type ProductionPreparationMode =
  | "use_prepared_stock_first"
  | "prepare_fresh";

export type ProductionPlanStatus =
  | "draft"
  | "ready"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "stale";

export type PreparedStockSnapshot = {
  itemId: string;
  quantity: number;
  unit: string;
  costState: RecipeGraphCostState;
  authoritativeUnitCost: number | null;
};

export type RawStockSnapshot = {
  itemId: string;
  stockScope?: string;
  quantity: number;
  unit: string;
};

export type ProductionPlannerInput = {
  planId: string;
  rootVersionId: string;
  targetQuantity: number;
  targetUnit: string;
  mode: ProductionPreparationMode;
  versions: readonly RecipeGraphVersion[];
  preparedStock: readonly PreparedStockSnapshot[];
  rawStock: readonly RawStockSnapshot[];
  observedAt: string;
  limits?: Partial<RecipeGraphLimits>;
  originalTargetQuantity?: number;
  revision?: number;
  actualStageOutputs?: Readonly<Record<string, number>>;
};

export type ProductionStageDependency = {
  childVersionId: string;
  childOutputItemId: string;
  requiredQuantity: number;
  unit: string;
};

export type ProductionPlanStage = {
  id: string;
  sequence: number;
  versionId: string;
  familyId: string;
  outputItemId: string;
  label: string;
  unit: string;
  requiredOutputQuantity: number;
  preparedStockUsed: number;
  expectedFreshOutput: number;
  actualOutput: number | null;
  availableOutput: number;
  fulfillmentRatio: number;
  shortfallQuantity: number;
  expectedDirectCost: number | null;
  knownDirectCostSubtotal: number;
  costComplete: boolean;
  dependencies: readonly ProductionStageDependency[];
  yieldVariance: YieldVariance | null;
};

export type ProductionRawRequirement = {
  key: string;
  itemId: string | null;
  label: string;
  stockScope: string;
  quantity: number;
  unit: string;
  availableQuantity: number;
  missingQuantity: number;
  costComplete: boolean;
  expectedCost: number | null;
  knownCostSubtotal: number;
  provenance: readonly {
    versionId: string;
    versionLabel: string;
    lineId: string;
    lineLabel: string;
    quantity: number;
  }[];
};

export type ProductionPreparedStockUse = {
  itemId: string;
  versionId: string;
  quantity: number;
  unit: string;
  costComplete: boolean;
  expectedCost: number | null;
  knownCostSubtotal: number;
};

export type YieldVariance = {
  expectedOutput: number;
  actualOutput: number;
  absoluteVariance: number;
  percentageVariance: number;
  shortfallQuantity: number;
  surplusQuantity: number;
};

export type ProductionPlan = {
  id: string;
  status: ProductionPlanStatus;
  revision: number;
  calculationVersion: 1;
  rootVersionId: string;
  targetQuantity: number;
  originalTargetQuantity: number;
  targetUnit: string;
  mode: ProductionPreparationMode;
  observedAt: string;
  updatedAt: string;
  stages: readonly ProductionPlanStage[];
  rawRequirements: readonly ProductionRawRequirement[];
  preparedStockUses: readonly ProductionPreparedStockUse[];
  preparationOrder: readonly string[];
  costComplete: boolean;
  expectedCost: number | null;
  knownCostSubtotal: number;
  missingCostCount: number;
  missingStockCount: number;
  targetShortfallQuantity: number;
};

export type ProductionPlannerErrorCode =
  | "invalid_target_quantity"
  | "target_unit_mismatch"
  | "invalid_prepared_stock"
  | "invalid_raw_stock"
  | "graph_invalid";

export type ProductionPlannerResult =
  | { ok: true; plan: ProductionPlan }
  | {
      ok: false;
      code: ProductionPlannerErrorCode;
      message: string;
      graphError?: {
        code: string;
        path: readonly string[];
      };
    };

type MutableStage = Omit<
  ProductionPlanStage,
  "dependencies" | "yieldVariance"
> & {
  dependencies: ProductionStageDependency[];
  yieldVariance: YieldVariance | null;
};

type MutableRawRequirement = Omit<
  ProductionRawRequirement,
  "provenance"
> & {
  provenance: {
    versionId: string;
    versionLabel: string;
    lineId: string;
    lineLabel: string;
    quantity: number;
  }[];
};

type PreparedPool = {
  itemId: string;
  unit: string;
  segments: {
    remaining: number;
    costState: RecipeGraphCostState;
    authoritativeUnitCost: number | null;
  }[];
};

const isNonNegativeFinite = (value: number) =>
  Number.isFinite(value) && value >= 0;

const isPositiveFinite = (value: number) =>
  Number.isFinite(value) && value > 0;

function costIsComplete(state: RecipeGraphCostState, cost: number | null) {
  if (state === "not_applicable") return true;
  return (
    state === "known" &&
    cost !== null &&
    Number.isFinite(cost) &&
    cost >= 0
  );
}

function stockKey(itemId: string, unit: string, stockScope = "default") {
  return `${itemId}\u0000${unit}\u0000${stockScope}`;
}

function indexVersions(versions: readonly RecipeGraphVersion[]) {
  return new Map(versions.map((version) => [version.id, version]));
}

function buildPreparedPools(
  stocks: readonly PreparedStockSnapshot[],
): { ok: true; pools: Map<string, PreparedPool> } | { ok: false } {
  const pools = new Map<string, PreparedPool>();
  for (const stock of stocks) {
    if (
      !stock.itemId.trim() ||
      !stock.unit.trim() ||
      !isNonNegativeFinite(stock.quantity) ||
      (stock.costState === "known" &&
        (stock.authoritativeUnitCost === null ||
          !isNonNegativeFinite(stock.authoritativeUnitCost)))
    ) {
      return { ok: false };
    }

    const key = stockKey(stock.itemId, stock.unit);
    const existing = pools.get(key);
    if (existing) {
      existing.segments.push({
        remaining: stock.quantity,
        costState: stock.costState,
        authoritativeUnitCost: stock.authoritativeUnitCost,
      });
    } else {
      pools.set(key, {
        itemId: stock.itemId,
        unit: stock.unit,
        segments: [
          {
            remaining: stock.quantity,
            costState: stock.costState,
            authoritativeUnitCost: stock.authoritativeUnitCost,
          },
        ],
      });
    }
  }
  return { ok: true, pools };
}

function buildRawAvailability(
  stocks: readonly RawStockSnapshot[],
): { ok: true; availability: Map<string, number> } | { ok: false } {
  const availability = new Map<string, number>();
  for (const stock of stocks) {
    if (
      !stock.itemId.trim() ||
      !stock.unit.trim() ||
      !isNonNegativeFinite(stock.quantity)
    ) {
      return { ok: false };
    }
    const key = stockKey(stock.itemId, stock.unit, stock.stockScope);
    availability.set(key, (availability.get(key) ?? 0) + stock.quantity);
  }
  return { ok: true, availability };
}

function addRawRequirement(
  aggregate: Map<string, MutableRawRequirement>,
  version: RecipeGraphVersion,
  line: RecipeGraphCatalogLine | RecipeGraphCustomCostLine,
  scaledQuantity: number,
) {
  const normalized = normalizeRecipeGraphLeafLine(line);
  const normalizationFactor = normalized.quantity / line.quantity;
  const quantity = scaledQuantity * normalizationFactor;
  const itemId = line.sourceKind === "catalog_item" ? line.itemId : null;
  const stockScope =
    line.sourceKind === "catalog_item" ? line.stockScope ?? "default" : "custom_cost";
  const key =
    itemId === null
      ? `custom:${version.id}:${line.id}`
      : stockKey(itemId, normalized.unit, stockScope);
  const complete = costIsComplete(
    line.costState,
    line.authoritativeUnitCost ?? null,
  );
  const knownCost =
    line.costState === "not_applicable"
      ? 0
      : complete
        ? line.sourceKind === "custom_cost" &&
          (line.costBasis ?? "per_recipe_line") === "per_recipe_line"
          ? (scaledQuantity / line.quantity) *
            (line.authoritativeUnitCost as number)
          : quantity * (line.authoritativeUnitCost as number)
        : 0;
  const existing = aggregate.get(key);
  const provenance = {
    versionId: version.id,
    versionLabel: version.label,
    lineId: line.id,
    lineLabel: line.label,
    quantity,
  };

  if (existing) {
    existing.quantity += quantity;
    existing.costComplete = existing.costComplete && complete;
    existing.knownCostSubtotal += knownCost;
    existing.provenance.push(provenance);
  } else {
    aggregate.set(key, {
      key,
      itemId,
      label: line.label,
      stockScope,
      quantity,
      unit: normalized.unit,
      availableQuantity: 0,
      missingQuantity: 0,
      costComplete: complete,
      expectedCost: null,
      knownCostSubtotal: knownCost,
      provenance: [provenance],
    });
  }

  return { complete, knownCost };
}

function cloneStage(stage: ProductionPlanStage): MutableStage {
  return {
    ...stage,
    dependencies: stage.dependencies.map((dependency) => ({ ...dependency })),
    yieldVariance: stage.yieldVariance ? { ...stage.yieldVariance } : null,
  };
}

/**
 * Computes expected/actual variance without changing the configured yield.
 */
export function calculateYieldVariance(
  expectedOutput: number,
  actualOutput: number,
): YieldVariance | null {
  if (!isPositiveFinite(expectedOutput) || !isNonNegativeFinite(actualOutput)) {
    return null;
  }
  const absoluteVariance = actualOutput - expectedOutput;
  return {
    expectedOutput,
    actualOutput,
    absoluteVariance,
    percentageVariance: (absoluteVariance / expectedOutput) * 100,
    shortfallQuantity: Math.max(0, expectedOutput - actualOutput),
    surplusQuantity: Math.max(0, actualOutput - expectedOutput),
  };
}

/**
 * Recomputes downstream feasibility from actual intermediate yields. Short
 * supply is proportionally propagated; no recipe yield or original plan target
 * is overwritten.
 */
function recomputeStageAvailability(
  stages: readonly ProductionPlanStage[],
  preparationOrder: readonly string[],
): ProductionPlanStage[] {
  const byVersion = new Map(stages.map((stage) => [stage.versionId, cloneStage(stage)]));

  for (const versionId of preparationOrder) {
    const stage = byVersion.get(versionId);
    if (!stage) continue;

    let dependencyRatio = 1;
    for (const dependency of stage.dependencies) {
      const child = byVersion.get(dependency.childVersionId);
      if (child) dependencyRatio = Math.min(dependencyRatio, child.fulfillmentRatio);
    }

    const freshAvailable =
      stage.actualOutput !== null
        ? stage.actualOutput
        : stage.expectedFreshOutput * dependencyRatio;
    stage.availableOutput = stage.preparedStockUsed + freshAvailable;
    stage.fulfillmentRatio =
      stage.requiredOutputQuantity <= QUANTITY_EPSILON
        ? 1
        : Math.min(1, stage.availableOutput / stage.requiredOutputQuantity);
    stage.shortfallQuantity = Math.max(
      0,
      stage.requiredOutputQuantity - stage.availableOutput,
    );
    stage.yieldVariance =
      stage.actualOutput === null
        ? null
        : calculateYieldVariance(stage.expectedFreshOutput, stage.actualOutput);
  }

  return stages.map((stage) => byVersion.get(stage.versionId) as ProductionPlanStage);
}

export function calculateProductionPlan(
  input: ProductionPlannerInput,
): ProductionPlannerResult {
  if (!isPositiveFinite(input.targetQuantity)) {
    return {
      ok: false,
      code: "invalid_target_quantity",
      message: "Production target must be a positive quantity.",
    };
  }

  const graph = validateRecipeGraph(input.versions, input.rootVersionId, {
    purpose: "authoring",
    limits: input.limits,
  });
  if (!graph.ok) {
    return {
      ok: false,
      code: "graph_invalid",
      message: graph.error.message,
      graphError: { code: graph.error.code, path: graph.error.path },
    };
  }

  const versionsById = indexVersions(input.versions);
  const root = versionsById.get(input.rootVersionId) as RecipeGraphVersion;
  if (root.outputUnit !== input.targetUnit) {
    return {
      ok: false,
      code: "target_unit_mismatch",
      message: `Target uses ${input.targetUnit}, but ${root.label} outputs ${root.outputUnit}.`,
    };
  }

  const prepared = buildPreparedPools(input.preparedStock);
  if (!prepared.ok) {
    return {
      ok: false,
      code: "invalid_prepared_stock",
      message: "Prepared-stock snapshot contains an invalid quantity, unit, or cost.",
    };
  }
  const raw = buildRawAvailability(input.rawStock);
  if (!raw.ok) {
    return {
      ok: false,
      code: "invalid_raw_stock",
      message: "Raw-stock snapshot contains an invalid quantity or unit.",
    };
  }

  const parentBeforeChild = [...graph.preparationOrder].reverse();
  const requiredByVersion = new Map<string, number>([
    [input.rootVersionId, input.targetQuantity],
  ]);
  const mutableStages = new Map<string, MutableStage>();
  const rawAggregate = new Map<string, MutableRawRequirement>();
  const preparedUses: ProductionPreparedStockUse[] = [];
  let preparedKnownCostSubtotal = 0;
  let preparedCostsComplete = true;

  for (const versionId of parentBeforeChild) {
    const version = versionsById.get(versionId) as RecipeGraphVersion;
    const requiredOutput = requiredByVersion.get(versionId) ?? 0;
    if (requiredOutput <= QUANTITY_EPSILON) continue;

    let preparedStockUsed = 0;
    if (
      input.mode === "use_prepared_stock_first" &&
      versionId !== input.rootVersionId
    ) {
      const pool = prepared.pools.get(
        stockKey(version.outputItemId, version.outputUnit),
      );
      if (pool) {
        let remainingNeed = requiredOutput;
        let complete = true;
        let knownCost = 0;

        for (const segment of pool.segments) {
          if (remainingNeed <= QUANTITY_EPSILON) break;
          const used = Math.min(segment.remaining, remainingNeed);
          if (used <= QUANTITY_EPSILON) continue;

          segment.remaining -= used;
          remainingNeed -= used;
          preparedStockUsed += used;
          const segmentComplete = costIsComplete(
            segment.costState,
            segment.authoritativeUnitCost,
          );
          complete = complete && segmentComplete;
          if (
            segmentComplete &&
            segment.costState !== "not_applicable"
          ) {
            knownCost += used * (segment.authoritativeUnitCost as number);
          }
        }

        preparedKnownCostSubtotal += knownCost;
        preparedCostsComplete = preparedCostsComplete && complete;
        if (preparedStockUsed > QUANTITY_EPSILON) {
          preparedUses.push({
            itemId: version.outputItemId,
            versionId,
            quantity: preparedStockUsed,
            unit: version.outputUnit,
            costComplete: complete,
            expectedCost: complete ? knownCost : null,
            knownCostSubtotal: knownCost,
          });
        }
      }
    }

    const expectedFreshOutput = Math.max(0, requiredOutput - preparedStockUsed);
    const multiplier = expectedFreshOutput / version.expectedOutputQuantity;
    const dependencies = new Map<string, ProductionStageDependency>();
    let knownDirectCostSubtotal = 0;
    let directCostComplete = true;

    for (const line of version.lines) {
      const scaledQuantity = line.quantity * multiplier;
      if (line.sourceKind === "child_recipe_version") {
        const child = versionsById.get(line.childVersionId) as RecipeGraphVersion;
        requiredByVersion.set(
          child.id,
          (requiredByVersion.get(child.id) ?? 0) + scaledQuantity,
        );
        const existing = dependencies.get(child.id);
        if (existing) existing.requiredQuantity += scaledQuantity;
        else {
          dependencies.set(child.id, {
            childVersionId: child.id,
            childOutputItemId: child.outputItemId,
            requiredQuantity: scaledQuantity,
            unit: line.unit,
          });
        }
      } else {
        const cost = addRawRequirement(
          rawAggregate,
          version,
          line,
          scaledQuantity,
        );
        directCostComplete = directCostComplete && cost.complete;
        knownDirectCostSubtotal += cost.knownCost;
      }
    }

    const actualOutput = input.actualStageOutputs?.[versionId];
    const safeActual =
      actualOutput !== undefined && isNonNegativeFinite(actualOutput)
        ? actualOutput
        : null;

    mutableStages.set(versionId, {
      id: `${input.planId}:stage:${versionId}`,
      sequence: 0,
      versionId,
      familyId: version.familyId,
      outputItemId: version.outputItemId,
      label: version.label,
      unit: version.outputUnit,
      requiredOutputQuantity: requiredOutput,
      preparedStockUsed,
      expectedFreshOutput,
      actualOutput: safeActual,
      availableOutput: requiredOutput,
      fulfillmentRatio: 1,
      shortfallQuantity: 0,
      expectedDirectCost: directCostComplete ? knownDirectCostSubtotal : null,
      knownDirectCostSubtotal,
      costComplete: directCostComplete,
      dependencies: [...dependencies.values()],
      yieldVariance:
        safeActual === null
          ? null
          : calculateYieldVariance(expectedFreshOutput, safeActual),
    });
  }

  const orderedStages = graph.preparationOrder
    .map((versionId) => mutableStages.get(versionId))
    .filter((stage): stage is MutableStage => Boolean(stage))
    .map((stage, index) => ({ ...stage, sequence: index + 1 }));
  const stages = recomputeStageAvailability(orderedStages, graph.preparationOrder);

  const rawRequirements = [...rawAggregate.values()].map((requirement) => {
    const availableQuantity =
      requirement.itemId === null
        ? requirement.quantity
        : raw.availability.get(requirement.key) ?? 0;
    const missingQuantity =
      requirement.itemId === null
        ? 0
        : Math.max(0, requirement.quantity - availableQuantity);
    return {
      ...requirement,
      availableQuantity,
      missingQuantity,
      expectedCost: requirement.costComplete
        ? requirement.knownCostSubtotal
        : null,
    };
  });
  const rawKnownCostSubtotal = rawRequirements.reduce(
    (sum, requirement) => sum + requirement.knownCostSubtotal,
    0,
  );
  const rawCostsComplete = rawRequirements.every(
    (requirement) => requirement.costComplete,
  );
  const costComplete = rawCostsComplete && preparedCostsComplete;
  const knownCostSubtotal =
    rawKnownCostSubtotal + preparedKnownCostSubtotal;
  const rootStage = stages.find(
    (stage) => stage.versionId === input.rootVersionId,
  );

  return {
    ok: true,
    plan: {
      id: input.planId,
      status: "draft",
      revision: input.revision ?? 0,
      calculationVersion: 1,
      rootVersionId: input.rootVersionId,
      targetQuantity: input.targetQuantity,
      originalTargetQuantity:
        input.originalTargetQuantity ?? input.targetQuantity,
      targetUnit: input.targetUnit,
      mode: input.mode,
      observedAt: input.observedAt,
      updatedAt: input.observedAt,
      stages,
      rawRequirements,
      preparedStockUses: preparedUses,
      preparationOrder: graph.preparationOrder,
      costComplete,
      expectedCost: costComplete ? knownCostSubtotal : null,
      knownCostSubtotal,
      missingCostCount:
        rawRequirements.filter((requirement) => !requirement.costComplete)
          .length +
        preparedUses.filter((usage) => !usage.costComplete).length,
      missingStockCount: rawRequirements.filter(
        (requirement) => requirement.missingQuantity > QUANTITY_EPSILON,
      ).length,
      targetShortfallQuantity: rootStage?.shortfallQuantity ?? input.targetQuantity,
    },
  };
}

/**
 * Recalculates a saved plan from a fresh caller-provided observation while
 * retaining plan identity, original target, and recorded actual stage outputs.
 */
export function recalculateProductionPlan(
  previous: ProductionPlan,
  input: Omit<
    ProductionPlannerInput,
    "planId" | "originalTargetQuantity" | "revision" | "actualStageOutputs"
  >,
): ProductionPlannerResult {
  const actualStageOutputs = Object.fromEntries(
    previous.stages
      .filter((stage) => stage.actualOutput !== null)
      .map((stage) => [stage.versionId, stage.actualOutput as number]),
  );
  const result = calculateProductionPlan({
    ...input,
    planId: previous.id,
    originalTargetQuantity: previous.originalTargetQuantity,
    revision: previous.revision + 1,
    actualStageOutputs,
  });

  if (!result.ok) return result;
  return {
    ok: true,
    plan: {
      ...result.plan,
      status:
        previous.status === "cancelled" || previous.status === "completed"
          ? previous.status
          : "draft",
    },
  };
}

/**
 * Records an actual yield only in the detached plan snapshot, then propagates
 * its availability to downstream stages. Persistence/execution transactions
 * remain separate concerns.
 */
export function applyActualStageYield(
  plan: ProductionPlan,
  versionId: string,
  actualOutput: number,
  updatedAt: string,
):
  | { ok: true; plan: ProductionPlan }
  | {
      ok: false;
      code: "stage_missing" | "invalid_actual_output" | "plan_closed";
    } {
  if (plan.status === "cancelled" || plan.status === "completed") {
    return { ok: false, code: "plan_closed" };
  }
  if (!isPositiveFinite(actualOutput)) {
    return { ok: false, code: "invalid_actual_output" };
  }
  if (!plan.stages.some((stage) => stage.versionId === versionId)) {
    return { ok: false, code: "stage_missing" };
  }

  const withActual = plan.stages.map((stage) =>
    stage.versionId === versionId
      ? { ...cloneStage(stage), actualOutput }
      : cloneStage(stage),
  );
  const stages = recomputeStageAvailability(withActual, plan.preparationOrder);
  const rootStage = stages.find(
    (stage) => stage.versionId === plan.rootVersionId,
  );

  return {
    ok: true,
    plan: {
      ...plan,
      revision: plan.revision + 1,
      updatedAt,
      stages,
      targetShortfallQuantity:
        rootStage?.shortfallQuantity ?? plan.targetQuantity,
    },
  };
}

export function transitionProductionPlanStatus(
  plan: ProductionPlan,
  nextStatus: ProductionPlanStatus,
  updatedAt: string,
):
  | { ok: true; plan: ProductionPlan }
  | { ok: false; code: "invalid_status_transition" | "plan_not_ready" } {
  if (plan.status === nextStatus) return { ok: true, plan };

  if (
    nextStatus === "ready" &&
    (plan.missingStockCount > 0 || plan.targetShortfallQuantity > QUANTITY_EPSILON)
  ) {
    return { ok: false, code: "plan_not_ready" };
  }

  const allowed: Record<ProductionPlanStatus, readonly ProductionPlanStatus[]> = {
    draft: ["ready", "cancelled", "stale"],
    ready: ["draft", "in_progress", "cancelled", "stale"],
    in_progress: ["completed", "cancelled", "stale"],
    stale: ["draft", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (!allowed[plan.status].includes(nextStatus)) {
    return { ok: false, code: "invalid_status_transition" };
  }

  return {
    ok: true,
    plan: {
      ...plan,
      status: nextStatus,
      revision: plan.revision + 1,
      updatedAt,
      stages: plan.stages.map(cloneStage),
      rawRequirements: plan.rawRequirements.map((requirement) => ({
        ...requirement,
        provenance: requirement.provenance.map((item) => ({ ...item })),
      })),
      preparedStockUses: plan.preparedStockUses.map((usage) => ({ ...usage })),
    },
  };
}
