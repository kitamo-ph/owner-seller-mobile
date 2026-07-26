import {
  aggregateCosts,
  type AggregatedCost,
  type CostEvidence,
  type CostState,
  knownCost,
  notApplicableCost,
  validateCostEvidence,
} from "./costState";
import { INVENTORY_QUANTITY_TOLERANCE } from "./stockAuthority";

export type AllocationMode =
  | "legacy_selected"
  | "manual"
  | "recommended_fefo"
  | "recommended_fifo"
  | "legacy_balance";

export type LotAllocationCandidate = {
  lotId: string;
  itemId: string;
  remainingQuantity: number;
  unit: string;
  status: "active" | "depleted" | "archived";
  isUsable: boolean;
  expiryDate: string | null;
  purchaseDate: string;
  createdAt: string;
  costPerLotUnit: CostEvidence;
  /**
   * Number of request units represented by one lot unit.
   * Omit only when the lot and request units are identical.
   */
  requestUnitsPerLotUnit?: number;
  conversionVersionId?: string | null;
};

export type ManualLotSelection = {
  lotId: string;
  quantityInLotUnit: number;
};

export type LotAllocationContribution = {
  lotId: string;
  mode: AllocationMode;
  quantityInLotUnit: number;
  lotUnit: string;
  normalizedQuantity: number;
  requestUnit: string;
  costPerLotUnitSnapshot: number | null;
  costState: CostState;
  costContribution: number | null;
  conversionFactorSnapshot: number;
  conversionVersionId: string | null;
};

export type LotAllocationPlan = {
  ok: boolean;
  mode: AllocationMode;
  requiredQuantity: number;
  allocatedQuantity: number;
  shortageQuantity: number;
  requestUnit: string;
  contributions: LotAllocationContribution[];
  cost: AggregatedCost;
  reason:
    | null
    | "invalid_request"
    | "legacy_selected_lot_required"
    | "manual_selection_required"
    | "duplicate_candidate"
    | "duplicate_manual_selection"
    | "lot_not_found"
    | "lot_not_eligible"
    | "item_mismatch"
    | "incompatible_unit"
    | "invalid_cost_evidence"
    | "manual_total_mismatch"
    | "insufficient_stock";
};

export type LotAllocationRequest = {
  itemId: string;
  requiredQuantity: number;
  requestUnit: string;
  mode: "legacy_selected" | "manual" | "automatic";
  candidates: readonly LotAllocationCandidate[];
  legacySelectedLotId?: string | null;
  manualSelections?: readonly ManualLotSelection[];
  tolerance?: number;
};

function emptyAggregatedCost(): AggregatedCost {
  return {
    complete: true,
    state: "not_applicable",
    total: null,
    knownSubtotal: 0,
    unresolvedStates: [],
    applicableCount: 0,
  };
}

function failedPlan(
  mode: AllocationMode,
  request: LotAllocationRequest,
  reason: Exclude<LotAllocationPlan["reason"], null>,
  contributions: LotAllocationContribution[] = [],
): LotAllocationPlan {
  const allocatedQuantity = contributions.reduce(
    (total, contribution) => total + contribution.normalizedQuantity,
    0,
  );
  const aggregated = aggregateCosts(
    contributions.map((contribution) =>
      contribution.costState === "known"
        ? knownCost(contribution.costContribution as number)
        : contribution.costState === "not_applicable"
          ? notApplicableCost()
          : {
              state: contribution.costState,
              amount: null,
              legacyValue:
                contribution.costState === "legacy_zero_unresolved" ? 0 : null,
            },
    ),
  );

  return {
    ok: false,
    mode,
    requiredQuantity: request.requiredQuantity,
    allocatedQuantity,
    shortageQuantity: Math.max(0, request.requiredQuantity - allocatedQuantity),
    requestUnit: request.requestUnit,
    contributions,
    cost: aggregated.ok ? aggregated.cost : emptyAggregatedCost(),
    reason,
  };
}

function resolveConversionFactor(
  candidate: LotAllocationCandidate,
  requestUnit: string,
): number | null {
  if (candidate.unit === requestUnit) {
    return 1;
  }
  const factor = candidate.requestUnitsPerLotUnit;
  return factor !== undefined && Number.isFinite(factor) && factor > 0
    ? factor
    : null;
}

function validIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function eligibleCandidate(
  candidate: LotAllocationCandidate,
  request: LotAllocationRequest,
): LotAllocationPlan["reason"] {
  if (candidate.itemId !== request.itemId) return "item_mismatch";
  if (
    candidate.status !== "active" ||
    !candidate.isUsable ||
    !candidate.lotId.trim() ||
    !Number.isFinite(candidate.remainingQuantity) ||
    candidate.remainingQuantity <= 0
  ) {
    return "lot_not_eligible";
  }
  if (resolveConversionFactor(candidate, request.requestUnit) === null) {
    return "incompatible_unit";
  }
  if (!validateCostEvidence(candidate.costPerLotUnit).ok) {
    return "invalid_cost_evidence";
  }
  return null;
}

function contributionFor(
  candidate: LotAllocationCandidate,
  quantityInLotUnit: number,
  requestUnit: string,
  mode: AllocationMode,
): LotAllocationContribution {
  const conversionFactor = resolveConversionFactor(candidate, requestUnit) as number;
  const costContribution =
    candidate.costPerLotUnit.state === "known"
      ? quantityInLotUnit * (candidate.costPerLotUnit.amount as number)
      : null;

  return {
    lotId: candidate.lotId,
    mode,
    quantityInLotUnit,
    lotUnit: candidate.unit,
    normalizedQuantity: quantityInLotUnit * conversionFactor,
    requestUnit,
    costPerLotUnitSnapshot:
      candidate.costPerLotUnit.state === "known"
        ? candidate.costPerLotUnit.amount
        : null,
    costState: candidate.costPerLotUnit.state,
    costContribution,
    conversionFactorSnapshot: conversionFactor,
    conversionVersionId: candidate.conversionVersionId ?? null,
  };
}

function successPlan(
  mode: AllocationMode,
  request: LotAllocationRequest,
  contributions: LotAllocationContribution[],
): LotAllocationPlan {
  const costs: CostEvidence[] = contributions.map((contribution) => ({
    state: contribution.costState,
    amount: contribution.costContribution,
    legacyValue:
      contribution.costState === "legacy_zero_unresolved" ? 0 : null,
  }));
  const aggregated = aggregateCosts(costs);
  if (!aggregated.ok) {
    return failedPlan(mode, request, "invalid_cost_evidence", contributions);
  }

  return {
    ok: true,
    mode,
    requiredQuantity: request.requiredQuantity,
    allocatedQuantity: contributions.reduce(
      (total, contribution) => total + contribution.normalizedQuantity,
      0,
    ),
    shortageQuantity: 0,
    requestUnit: request.requestUnit,
    contributions,
    cost: aggregated.cost,
    reason: null,
  };
}

function automaticCandidates(
  request: LotAllocationRequest,
): { mode: "recommended_fefo" | "recommended_fifo"; candidates: LotAllocationCandidate[] } {
  const candidates = request.candidates.filter(
    (candidate) => eligibleCandidate(candidate, request) === null,
  );
  const hasValidExpiry = candidates.some((candidate) =>
    validIsoDate(candidate.expiryDate),
  );
  candidates.sort((left, right) => {
    const leftHasExpiry = validIsoDate(left.expiryDate);
    const rightHasExpiry = validIsoDate(right.expiryDate);

    if (leftHasExpiry !== rightHasExpiry) return leftHasExpiry ? -1 : 1;
    if (leftHasExpiry && rightHasExpiry && left.expiryDate !== right.expiryDate) {
      return (left.expiryDate as string).localeCompare(
        right.expiryDate as string,
      );
    }

    const purchaseComparison = left.purchaseDate.localeCompare(right.purchaseDate);
    if (purchaseComparison !== 0) return purchaseComparison;
    const createdComparison = left.createdAt.localeCompare(right.createdAt);
    if (createdComparison !== 0) return createdComparison;
    return left.lotId.localeCompare(right.lotId);
  });

  return {
    mode: hasValidExpiry ? "recommended_fefo" : "recommended_fifo",
    candidates,
  };
}

/**
 * Produces explicit, immutable allocation contributions but does not mutate
 * inventory. Execution must re-read and guard every selected lot.
 */
export function planLotAllocation(
  request: LotAllocationRequest,
): LotAllocationPlan {
  const tolerance = request.tolerance ?? INVENTORY_QUANTITY_TOLERANCE;
  if (
    !request.itemId.trim() ||
    !request.requestUnit.trim() ||
    !Number.isFinite(request.requiredQuantity) ||
    request.requiredQuantity <= tolerance ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    return failedPlan("manual", request, "invalid_request");
  }

  const candidateIds = new Set<string>();
  for (const candidate of request.candidates) {
    if (candidateIds.has(candidate.lotId)) {
      const duplicateMode =
        request.mode === "legacy_selected"
          ? "legacy_selected"
          : request.mode === "manual"
            ? "manual"
            : automaticCandidates(request).mode;
      return failedPlan(duplicateMode, request, "duplicate_candidate");
    }
    candidateIds.add(candidate.lotId);
  }

  if (request.mode === "legacy_selected") {
    if (!request.legacySelectedLotId) {
      return failedPlan(
        "legacy_selected",
        request,
        "legacy_selected_lot_required",
      );
    }
    const candidate = request.candidates.find(
      (lot) => lot.lotId === request.legacySelectedLotId,
    );
    if (!candidate) {
      return failedPlan("legacy_selected", request, "lot_not_found");
    }
    const eligibility = eligibleCandidate(candidate, request);
    if (eligibility) {
      return failedPlan("legacy_selected", request, eligibility);
    }
    const conversionFactor = resolveConversionFactor(
      candidate,
      request.requestUnit,
    ) as number;
    const neededInLotUnit = request.requiredQuantity / conversionFactor;
    if (candidate.remainingQuantity + tolerance < neededInLotUnit) {
      const availableContribution = contributionFor(
        candidate,
        candidate.remainingQuantity,
        request.requestUnit,
        "legacy_selected",
      );
      return failedPlan(
        "legacy_selected",
        request,
        "insufficient_stock",
        [availableContribution],
      );
    }
    return successPlan("legacy_selected", request, [
      contributionFor(
        candidate,
        neededInLotUnit,
        request.requestUnit,
        "legacy_selected",
      ),
    ]);
  }

  if (request.mode === "manual") {
    if (!request.manualSelections || request.manualSelections.length === 0) {
      return failedPlan("manual", request, "manual_selection_required");
    }
    const seen = new Set<string>();
    const contributions: LotAllocationContribution[] = [];

    for (const selection of request.manualSelections) {
      if (seen.has(selection.lotId)) {
        return failedPlan(
          "manual",
          request,
          "duplicate_manual_selection",
          contributions,
        );
      }
      seen.add(selection.lotId);

      const candidate = request.candidates.find(
        (lot) => lot.lotId === selection.lotId,
      );
      if (!candidate) {
        return failedPlan("manual", request, "lot_not_found", contributions);
      }
      const eligibility = eligibleCandidate(candidate, request);
      if (eligibility) {
        return failedPlan("manual", request, eligibility, contributions);
      }
      if (
        !Number.isFinite(selection.quantityInLotUnit) ||
        selection.quantityInLotUnit <= tolerance ||
        selection.quantityInLotUnit > candidate.remainingQuantity + tolerance
      ) {
        return failedPlan(
          "manual",
          request,
          "lot_not_eligible",
          contributions,
        );
      }
      contributions.push(
        contributionFor(
          candidate,
          selection.quantityInLotUnit,
          request.requestUnit,
          "manual",
        ),
      );
    }

    const total = contributions.reduce(
      (sum, contribution) => sum + contribution.normalizedQuantity,
      0,
    );
    if (Math.abs(total - request.requiredQuantity) > tolerance) {
      return failedPlan(
        "manual",
        request,
        "manual_total_mismatch",
        contributions,
      );
    }
    return successPlan("manual", request, contributions);
  }

  const automatic = automaticCandidates(request);
  const contributions: LotAllocationContribution[] = [];
  let remaining = request.requiredQuantity;

  for (const candidate of automatic.candidates) {
    if (remaining <= tolerance) break;
    const conversionFactor = resolveConversionFactor(
      candidate,
      request.requestUnit,
    ) as number;
    const availableInRequestUnit =
      candidate.remainingQuantity * conversionFactor;
    const allocatedInRequestUnit = Math.min(remaining, availableInRequestUnit);
    const quantityInLotUnit = allocatedInRequestUnit / conversionFactor;
    contributions.push(
      contributionFor(
        candidate,
        quantityInLotUnit,
        request.requestUnit,
        automatic.mode,
      ),
    );
    remaining -= allocatedInRequestUnit;
  }

  if (remaining > tolerance) {
    return failedPlan(
      automatic.mode,
      request,
      "insufficient_stock",
      contributions,
    );
  }

  return successPlan(automatic.mode, request, contributions);
}
