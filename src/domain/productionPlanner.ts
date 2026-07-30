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

export type ProductionPlanCostState = RecipeGraphCostState | "partial";
export type ProductionPlanLotKind = "ingredient" | "product";
export type ProductionPlanAllocationMode =
  | "legacy_selected"
  | "manual"
  | "recommended_fefo"
  | "recommended_fifo"
  | "legacy_balance";

type ExactLotSnapshot = {
  lotKind?: ProductionPlanLotKind;
  lotId?: string;
  allocationMode?: ProductionPlanAllocationMode;
  normalizedQuantity?: number;
  normalizedUnit?: string;
  conversionId?: string | null;
  conversionFactorSnapshot?: number;
};

export type PreparedStockSnapshot = {
  itemId: string;
  quantity: number;
  unit: string;
  costState: RecipeGraphCostState;
  authoritativeUnitCost: number | null;
} & ExactLotSnapshot;

export type RawStockSnapshot = {
  itemId: string;
  stockScope?: string;
  quantity: number;
  unit: string;
  costState?: RecipeGraphCostState;
  authoritativeUnitCost?: number | null;
} & ExactLotSnapshot;

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
  calculationVersion?: number;
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
  costState: ProductionPlanCostState;
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
  costState: ProductionPlanCostState;
  costComplete: boolean;
  expectedCost: number | null;
  knownCostSubtotal: number;
  allocations: readonly ProductionPlanLotAllocation[];
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
  costState: ProductionPlanCostState;
  costComplete: boolean;
  expectedCost: number | null;
  knownCostSubtotal: number;
  allocations: readonly ProductionPlanLotAllocation[];
};

export type ProductionPlanLotAllocation = {
  lotKind: ProductionPlanLotKind;
  lotId: string;
  allocationMode: ProductionPlanAllocationMode;
  quantity: number;
  unit: string;
  normalizedQuantity: number;
  normalizedUnit: string;
  conversionId: string | null;
  conversionFactorSnapshot: number;
  costState: RecipeGraphCostState;
  unitCostSnapshot: number | null;
  costContribution: number | null;
};

/**
 * Assigns exact lot segments to ordered requirement quantities without
 * spreading every lot proportionally across every requirement. An allocation
 * is split only when one requirement ends inside that exact lot segment.
 */
export function partitionProductionPlanLotAllocations(
  allocations: readonly ProductionPlanLotAllocation[],
  normalizedRequirementQuantities: readonly number[],
): readonly (readonly ProductionPlanLotAllocation[])[] {
  const partitions: ProductionPlanLotAllocation[][] = [];
  let allocationIndex = 0;
  let consumedFromAllocation = 0;

  for (const requiredQuantity of normalizedRequirementQuantities) {
    if (!isNonNegativeFinite(requiredQuantity)) {
      throw new Error(
        "Production requirement quantities must be finite and non-negative.",
      );
    }

    const partition: ProductionPlanLotAllocation[] = [];
    let remainingRequirement = requiredQuantity;
    while (
      remainingRequirement > QUANTITY_EPSILON &&
      allocationIndex < allocations.length
    ) {
      const allocation = allocations[allocationIndex];
      if (
        !isPositiveFinite(allocation.quantity) ||
        !isPositiveFinite(allocation.normalizedQuantity)
      ) {
        throw new Error(
          "Production lot allocations must contain positive quantities.",
        );
      }

      const availableNormalized =
        allocation.normalizedQuantity - consumedFromAllocation;
      if (availableNormalized <= QUANTITY_EPSILON) {
        allocationIndex += 1;
        consumedFromAllocation = 0;
        continue;
      }

      const usedNormalized = Math.min(
        availableNormalized,
        remainingRequirement,
      );
      const allocationRatio =
        usedNormalized / allocation.normalizedQuantity;
      partition.push({
        ...allocation,
        quantity: allocation.quantity * allocationRatio,
        normalizedQuantity: usedNormalized,
        costContribution:
          allocation.costContribution === null
            ? null
            : allocation.costContribution * allocationRatio,
      });

      consumedFromAllocation += usedNormalized;
      remainingRequirement -= usedNormalized;
      if (
        allocation.normalizedQuantity - consumedFromAllocation <=
        QUANTITY_EPSILON
      ) {
        allocationIndex += 1;
        consumedFromAllocation = 0;
      }
    }
    partitions.push(partition);
  }

  return partitions;
}

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
  calculationVersion: number;
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
  costState: ProductionPlanCostState;
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
  "allocations" | "provenance"
> & {
  costStates: RecipeGraphCostState[];
  allocations: ProductionPlanLotAllocation[];
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
    lotUnit: string;
    normalizedRemaining: number;
    normalizedUnit: string;
    conversionFactor: number;
    costState: RecipeGraphCostState;
    authoritativeUnitCost: number | null;
    exactLot: {
      lotKind: ProductionPlanLotKind;
      lotId: string;
      allocationMode: ProductionPlanAllocationMode;
      conversionId: string | null;
    } | null;
  }[];
};

type RawPool = {
  itemId: string;
  unit: string;
  stockScope: string;
  totalNormalizedQuantity: number;
  segments: PreparedPool["segments"];
};

const isNonNegativeFinite = (value: number) =>
  Number.isFinite(value) && value >= 0;

const isPositiveFinite = (value: number) =>
  Number.isFinite(value) && value > 0;

function costEvidenceIsValid(
  state: RecipeGraphCostState,
  cost: number | null,
) {
  return state === "known"
    ? cost !== null && Number.isFinite(cost) && cost >= 0
    : cost === null;
}

function costIsComplete(state: RecipeGraphCostState, cost: number | null) {
  return (
    costEvidenceIsValid(state, cost) &&
    (state === "known" || state === "not_applicable")
  );
}

function aggregateCostState(
  states: readonly RecipeGraphCostState[],
): ProductionPlanCostState {
  const applicable = states.filter((state) => state !== "not_applicable");
  if (applicable.length === 0) return "not_applicable";

  const hasKnown = applicable.includes("known");
  const hasUnknown = applicable.includes("unknown");
  const hasLegacyUnresolved = applicable.includes("legacy_zero_unresolved");
  if (!hasUnknown && !hasLegacyUnresolved) return "known";
  if (hasKnown) return "partial";
  return hasUnknown ? "unknown" : "legacy_zero_unresolved";
}

function stockKey(itemId: string, unit: string, stockScope = "default") {
  return `${itemId}\u0000${unit}\u0000${stockScope}`;
}

function indexVersions(versions: readonly RecipeGraphVersion[]) {
  return new Map(versions.map((version) => [version.id, version]));
}

function resolveStockSnapshot(
  stock: PreparedStockSnapshot | RawStockSnapshot,
): {
  normalizedQuantity: number;
  normalizedUnit: string;
  conversionFactor: number;
  costState: RecipeGraphCostState;
  authoritativeUnitCost: number | null;
  exactLot: PreparedPool["segments"][number]["exactLot"];
} | null {
  if (
    !stock.itemId.trim() ||
    !stock.unit.trim() ||
    !isNonNegativeFinite(stock.quantity)
  ) {
    return null;
  }

  const normalizedUnit = stock.normalizedUnit?.trim() || stock.unit;
  const conversionFactor = stock.conversionFactorSnapshot ?? 1;
  const normalizedQuantity =
    stock.normalizedQuantity ?? stock.quantity * conversionFactor;
  if (
    !normalizedUnit ||
    !isPositiveFinite(conversionFactor) ||
    !isNonNegativeFinite(normalizedQuantity) ||
    Math.abs(normalizedQuantity - stock.quantity * conversionFactor) >
      QUANTITY_EPSILON
  ) {
    return null;
  }
  if (
    (normalizedUnit === stock.unit &&
      (stock.conversionId ||
        Math.abs(conversionFactor - 1) > QUANTITY_EPSILON)) ||
    (normalizedUnit !== stock.unit && !stock.conversionId)
  ) {
    return null;
  }

  const exactFields = [
    stock.lotKind,
    stock.lotId?.trim() || undefined,
    stock.allocationMode,
  ];
  const exactFieldCount = exactFields.filter(Boolean).length;
  if (exactFieldCount !== 0 && exactFieldCount !== exactFields.length) {
    return null;
  }

  const costState = stock.costState ?? "unknown";
  const authoritativeUnitCost = stock.authoritativeUnitCost ?? null;
  if (!costEvidenceIsValid(costState, authoritativeUnitCost)) {
    return null;
  }

  return {
    normalizedQuantity,
    normalizedUnit,
    conversionFactor,
    costState,
    authoritativeUnitCost,
    exactLot:
      exactFieldCount === exactFields.length
        ? {
            lotKind: stock.lotKind as ProductionPlanLotKind,
            lotId: stock.lotId?.trim() as string,
            allocationMode:
              stock.allocationMode as ProductionPlanAllocationMode,
            conversionId: stock.conversionId ?? null,
          }
        : null,
  };
}

function buildPreparedPools(
  stocks: readonly PreparedStockSnapshot[],
): { ok: true; pools: Map<string, PreparedPool> } | { ok: false } {
  const pools = new Map<string, PreparedPool>();
  for (const stock of stocks) {
    const resolved = resolveStockSnapshot(stock);
    if (!resolved) return { ok: false };
    const key = stockKey(stock.itemId, resolved.normalizedUnit);
    const segment: PreparedPool["segments"][number] = {
      remaining: stock.quantity,
      lotUnit: stock.unit,
      normalizedRemaining: resolved.normalizedQuantity,
      normalizedUnit: resolved.normalizedUnit,
      conversionFactor: resolved.conversionFactor,
      costState: resolved.costState,
      authoritativeUnitCost: resolved.authoritativeUnitCost,
      exactLot: resolved.exactLot,
    };
    const existing = pools.get(key);
    if (existing) {
      existing.segments.push(segment);
    } else {
      pools.set(key, {
        itemId: stock.itemId,
        unit: resolved.normalizedUnit,
        segments: [segment],
      });
    }
  }
  return { ok: true, pools };
}

function buildRawPools(
  stocks: readonly RawStockSnapshot[],
): { ok: true; pools: Map<string, RawPool> } | { ok: false } {
  const pools = new Map<string, RawPool>();
  for (const stock of stocks) {
    const resolved = resolveStockSnapshot(stock);
    if (!resolved) return { ok: false };
    const stockScope = stock.stockScope ?? "default";
    const key = stockKey(
      stock.itemId,
      resolved.normalizedUnit,
      stockScope,
    );
    const segment: PreparedPool["segments"][number] = {
      remaining: stock.quantity,
      lotUnit: stock.unit,
      normalizedRemaining: resolved.normalizedQuantity,
      normalizedUnit: resolved.normalizedUnit,
      conversionFactor: resolved.conversionFactor,
      costState: resolved.costState,
      authoritativeUnitCost: resolved.authoritativeUnitCost,
      exactLot: resolved.exactLot,
    };
    const existing = pools.get(key);
    if (existing) {
      existing.totalNormalizedQuantity += resolved.normalizedQuantity;
      existing.segments.push(segment);
    } else {
      pools.set(key, {
        itemId: stock.itemId,
        unit: resolved.normalizedUnit,
        stockScope,
        totalNormalizedQuantity: resolved.normalizedQuantity,
        segments: [segment],
      });
    }
  }
  return { ok: true, pools };
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
    existing.costStates.push(line.costState);
    existing.costState = aggregateCostState(existing.costStates);
    existing.costComplete =
      existing.costState === "known" ||
      existing.costState === "not_applicable";
    existing.knownCostSubtotal += knownCost;
    existing.provenance.push(provenance);
  } else {
    const costState = aggregateCostState([line.costState]);
    aggregate.set(key, {
      key,
      itemId,
      label: line.label,
      stockScope,
      quantity,
      unit: normalized.unit,
      availableQuantity: 0,
      missingQuantity: 0,
      costState,
      costStates: [line.costState],
      costComplete:
        costState === "known" || costState === "not_applicable",
      expectedCost: null,
      knownCostSubtotal: knownCost,
      allocations: [],
      provenance: [provenance],
    });
  }

  return { complete, knownCost };
}

function allocatePoolSegments(
  segments: PreparedPool["segments"],
  requiredNormalizedQuantity: number,
): {
  usedNormalizedQuantity: number;
  costStates: RecipeGraphCostState[];
  knownCostSubtotal: number;
  allocations: ProductionPlanLotAllocation[];
} {
  let remainingNeed = requiredNormalizedQuantity;
  let usedNormalizedQuantity = 0;
  let knownCostSubtotal = 0;
  const costStates: RecipeGraphCostState[] = [];
  const allocations: ProductionPlanLotAllocation[] = [];

  for (const segment of segments) {
    if (remainingNeed <= QUANTITY_EPSILON) break;
    const usedNormalized = Math.min(
      segment.normalizedRemaining,
      remainingNeed,
    );
    if (usedNormalized <= QUANTITY_EPSILON) continue;

    const usedInLotUnit = usedNormalized / segment.conversionFactor;
    segment.normalizedRemaining -= usedNormalized;
    segment.remaining -= usedInLotUnit;
    remainingNeed -= usedNormalized;
    usedNormalizedQuantity += usedNormalized;
    costStates.push(segment.costState);

    const costContribution =
      segment.costState === "known"
        ? usedInLotUnit * (segment.authoritativeUnitCost as number)
        : null;
    knownCostSubtotal += costContribution ?? 0;
    if (segment.exactLot) {
      allocations.push({
        lotKind: segment.exactLot.lotKind,
        lotId: segment.exactLot.lotId,
        allocationMode: segment.exactLot.allocationMode,
        quantity: usedInLotUnit,
        unit: segment.lotUnit,
        normalizedQuantity: usedNormalized,
        normalizedUnit: segment.normalizedUnit,
        conversionId: segment.exactLot.conversionId,
        conversionFactorSnapshot: segment.conversionFactor,
        costState: segment.costState,
        unitCostSnapshot:
          segment.costState === "known"
            ? segment.authoritativeUnitCost
            : null,
        costContribution,
      });
    }
  }

  return {
    usedNormalizedQuantity,
    costStates,
    knownCostSubtotal,
    allocations,
  };
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
  const raw = buildRawPools(input.rawStock);
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
        const allocation = allocatePoolSegments(
          pool.segments,
          requiredOutput,
        );
        preparedStockUsed = allocation.usedNormalizedQuantity;
        if (preparedStockUsed > QUANTITY_EPSILON) {
          const costState = aggregateCostState(allocation.costStates);
          const costComplete =
            costState === "known" || costState === "not_applicable";
          preparedUses.push({
            itemId: version.outputItemId,
            versionId,
            quantity: preparedStockUsed,
            unit: version.outputUnit,
            costState,
            costComplete,
            expectedCost:
              costState === "known"
                ? allocation.knownCostSubtotal
                : null,
            knownCostSubtotal: allocation.knownCostSubtotal,
            allocations: allocation.allocations,
          });
        }
      }
    }

    const expectedFreshOutput = Math.max(0, requiredOutput - preparedStockUsed);
    const multiplier = expectedFreshOutput / version.expectedOutputQuantity;
    const dependencies = new Map<string, ProductionStageDependency>();
    let knownDirectCostSubtotal = 0;
    const directCostStates: RecipeGraphCostState[] = [];

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
        directCostStates.push(line.costState);
        knownDirectCostSubtotal += cost.knownCost;
      }
    }

    const actualOutput = input.actualStageOutputs?.[versionId];
    const safeActual =
      actualOutput !== undefined && isNonNegativeFinite(actualOutput)
        ? actualOutput
        : null;

    const directCostState = aggregateCostState(directCostStates);
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
      expectedDirectCost:
        directCostState === "known" ? knownDirectCostSubtotal : null,
      knownDirectCostSubtotal,
      costState: directCostState,
      costComplete:
        directCostState === "known" ||
        directCostState === "not_applicable",
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
    const pool =
      requirement.itemId === null
        ? null
        : raw.pools.get(requirement.key) ?? null;
    const allocation =
      pool === null
        ? {
            usedNormalizedQuantity: 0,
            costStates: [] as RecipeGraphCostState[],
            knownCostSubtotal: 0,
            allocations: [] as ProductionPlanLotAllocation[],
          }
        : allocatePoolSegments(pool.segments, requirement.quantity);
    const availableQuantity =
      requirement.itemId === null
        ? requirement.quantity
        : pool?.totalNormalizedQuantity ?? 0;
    const missingQuantity =
      requirement.itemId === null
        ? 0
        : Math.max(0, requirement.quantity - availableQuantity);
    const exactCostStates: RecipeGraphCostState[] = [
      ...allocation.costStates,
    ];
    if (
      requirement.itemId !== null &&
      allocation.usedNormalizedQuantity + QUANTITY_EPSILON <
        requirement.quantity &&
      requirement.costState !== "not_applicable"
    ) {
      exactCostStates.push("unknown");
    }
    if (exactCostStates.length === 0) {
      exactCostStates.push(
        requirement.costState === "not_applicable"
          ? "not_applicable"
          : "unknown",
      );
    }
    const exactCostState =
      requirement.itemId === null
        ? requirement.costState
        : aggregateCostState(exactCostStates);
    const exactKnownCostSubtotal =
      requirement.itemId === null
        ? requirement.knownCostSubtotal
        : allocation.knownCostSubtotal;
    const { costStates: _costStates, ...persistable } = requirement;
    return {
      ...persistable,
      availableQuantity,
      missingQuantity,
      costState: exactCostState,
      costComplete:
        exactCostState === "known" ||
        exactCostState === "not_applicable",
      expectedCost:
        exactCostState === "known" ? exactKnownCostSubtotal : null,
      knownCostSubtotal: exactKnownCostSubtotal,
      allocations: allocation.allocations,
    };
  });
  const rawKnownCostSubtotal = rawRequirements.reduce(
    (sum, requirement) => sum + requirement.knownCostSubtotal,
    0,
  );
  const preparedKnownCostSubtotal = preparedUses.reduce(
    (sum, usage) => sum + usage.knownCostSubtotal,
    0,
  );
  const costState = aggregateCostState([
    ...rawRequirements.flatMap((requirement) =>
      requirement.costState === "partial"
        ? (["known", "unknown"] as const)
        : [requirement.costState],
    ),
    ...preparedUses.flatMap((usage) =>
      usage.costState === "partial"
        ? (["known", "unknown"] as const)
        : [usage.costState],
    ),
  ]);
  const costComplete =
    costState === "known" || costState === "not_applicable";
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
      calculationVersion: input.calculationVersion ?? 1,
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
      costState,
      costComplete,
      expectedCost: costState === "known" ? knownCostSubtotal : null,
      knownCostSubtotal,
      missingCostCount:
        rawRequirements.filter(
          (requirement) =>
            requirement.costState !== "known" &&
            requirement.costState !== "not_applicable",
        ).length +
        preparedUses.filter(
          (usage) =>
            usage.costState !== "known" &&
            usage.costState !== "not_applicable",
        ).length,
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
    | "planId"
    | "originalTargetQuantity"
    | "revision"
    | "calculationVersion"
    | "actualStageOutputs"
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
    calculationVersion: previous.calculationVersion + 1,
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
        allocations: requirement.allocations.map((allocation) => ({
          ...allocation,
        })),
        provenance: requirement.provenance.map((item) => ({ ...item })),
      })),
      preparedStockUses: plan.preparedStockUses.map((usage) => ({
        ...usage,
        allocations: usage.allocations.map((allocation) => ({
          ...allocation,
        })),
      })),
    },
  };
}
