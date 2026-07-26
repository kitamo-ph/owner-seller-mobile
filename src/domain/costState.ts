/**
 * Explicit monetary-cost evidence for the inventory redesign.
 *
 * `amount` is the authoritative native value. `legacyValue` is evidence only:
 * callers may preserve an existing non-null column or a compatibility sentinel,
 * but native calculations must never substitute it for a missing `amount`.
 */

export const COST_STATES = [
  "known",
  "unknown",
  "legacy_zero_unresolved",
  "not_applicable",
] as const;

export type CostState = (typeof COST_STATES)[number];

export type CostEvidence = {
  state: CostState;
  amount: number | null;
  legacyValue: number | null;
};

export type CostEvidenceError =
  | "known_cost_requires_non_negative_amount"
  | "non_known_cost_requires_null_amount"
  | "legacy_zero_requires_preserved_zero"
  | "legacy_value_must_be_non_negative";

export type CostEvidenceValidation =
  | { ok: true; evidence: CostEvidence }
  | { ok: false; reason: CostEvidenceError };

export type AggregatedCost = {
  complete: boolean;
  state: CostState;
  total: number | null;
  knownSubtotal: number;
  unresolvedStates: Exclude<CostState, "known" | "not_applicable">[];
  applicableCount: number;
};

export type AggregateCostResult =
  | { ok: true; cost: AggregatedCost }
  | { ok: false; index: number; reason: CostEvidenceError };

export function validateCostEvidence(evidence: CostEvidence): CostEvidenceValidation {
  if (
    evidence.legacyValue !== null &&
    (!Number.isFinite(evidence.legacyValue) || evidence.legacyValue < 0)
  ) {
    return { ok: false, reason: "legacy_value_must_be_non_negative" };
  }

  if (evidence.state === "known") {
    if (evidence.amount === null || !Number.isFinite(evidence.amount) || evidence.amount < 0) {
      return { ok: false, reason: "known_cost_requires_non_negative_amount" };
    }

    return { ok: true, evidence: { ...evidence } };
  }

  if (evidence.amount !== null) {
    return { ok: false, reason: "non_known_cost_requires_null_amount" };
  }

  if (evidence.state === "legacy_zero_unresolved" && evidence.legacyValue !== 0) {
    return { ok: false, reason: "legacy_zero_requires_preserved_zero" };
  }

  return { ok: true, evidence: { ...evidence } };
}

export function knownCost(amount: number, legacyValue: number | null = null): CostEvidence {
  const evidence: CostEvidence = { state: "known", amount, legacyValue };
  const validation = validateCostEvidence(evidence);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  return validation.evidence;
}

export function unknownCost(compatibilityValue: number | null = null): CostEvidence {
  const evidence: CostEvidence = {
    state: "unknown",
    amount: null,
    legacyValue: compatibilityValue,
  };
  const validation = validateCostEvidence(evidence);
  if (!validation.ok) {
    throw new Error(validation.reason);
  }
  return validation.evidence;
}

export function legacyZeroUnresolvedCost(): CostEvidence {
  return {
    state: "legacy_zero_unresolved",
    amount: null,
    legacyValue: 0,
  };
}

export function notApplicableCost(): CostEvidence {
  return {
    state: "not_applicable",
    amount: null,
    legacyValue: null,
  };
}

/**
 * Aggregates required costs without fabricating zero.
 *
 * A single unknown or unresolved legacy cost makes `total` null. The known
 * subtotal is returned for warnings only and must not be presented as a total.
 */
export function aggregateCosts(costs: readonly CostEvidence[]): AggregateCostResult {
  let knownSubtotal = 0;
  let applicableCount = 0;
  const unresolvedStates: AggregatedCost["unresolvedStates"] = [];

  for (let index = 0; index < costs.length; index += 1) {
    const validation = validateCostEvidence(costs[index]);
    if (!validation.ok) {
      return { ok: false, index, reason: validation.reason };
    }

    const cost = validation.evidence;
    if (cost.state === "not_applicable") {
      continue;
    }

    applicableCount += 1;
    if (cost.state === "known") {
      knownSubtotal += cost.amount as number;
    } else if (!unresolvedStates.includes(cost.state)) {
      unresolvedStates.push(cost.state);
    }
  }

  if (applicableCount === 0) {
    return {
      ok: true,
      cost: {
        complete: true,
        state: "not_applicable",
        total: null,
        knownSubtotal: 0,
        unresolvedStates: [],
        applicableCount: 0,
      },
    };
  }

  if (unresolvedStates.length > 0) {
    const state: CostState = unresolvedStates.includes("unknown")
      ? "unknown"
      : "legacy_zero_unresolved";
    return {
      ok: true,
      cost: {
        complete: false,
        state,
        total: null,
        knownSubtotal,
        unresolvedStates,
        applicableCount,
      },
    };
  }

  return {
    ok: true,
    cost: {
      complete: true,
      state: "known",
      total: knownSubtotal,
      knownSubtotal,
      unresolvedStates: [],
      applicableCount,
    },
  };
}
