import {
  aggregateCosts,
  type AggregatedCost,
  type CostEvidence,
  type CostState,
  validateCostEvidence,
} from "./costState";
import { INVENTORY_QUANTITY_TOLERANCE } from "./stockAuthority";

export const STOCK_ADJUSTMENT_REASONS = [
  "personal_household_use",
  "spoilage",
  "damaged",
  "expired",
  "promotion",
  "counting_correction",
  "lost_missing",
  "returned_to_supplier",
  "other",
] as const;

export type StockAdjustmentReason =
  (typeof STOCK_ADJUSTMENT_REASONS)[number];

export type AdjustmentAccountingClass =
  | "owner_withdrawal"
  | "inventory_loss_spoilage"
  | "inventory_loss_damage"
  | "inventory_loss_expiry"
  | "promotional_usage"
  | "stock_variance"
  | "review_required_variance"
  | "supplier_return"
  | "owner_selected_review";

export type AdjustmentReasonPolicy = {
  reason: StockAdjustmentReason;
  accountingClass: AdjustmentAccountingClass;
  productCogs: false;
  noteRequired: boolean;
};

export type StockAdjustmentOperation =
  | { kind: "delta"; quantity: number }
  | { kind: "set_count"; quantity: number }
  | { kind: "mark_empty" };

export type StockAdjustmentPlan = {
  ok: boolean;
  reason:
    | null
    | "owner_authorization_required"
    | "note_required"
    | "invalid_quantity"
    | "no_quantity_change"
    | "stock_overdraw"
    | "quantity_above_allowed_maximum"
    | "positive_adjustment_reason_not_supported";
  beforeQuantity: number;
  afterQuantity: number;
  adjustmentQuantity: number;
  policy: AdjustmentReasonPolicy;
};

export type MarkEmptyBalance = {
  recordId: string;
  remainingQuantity: number;
  unit: string;
  status: "active" | "depleted" | "archived";
  normalizedUnitsPerRecordUnit?: number;
  costPerUnit: CostEvidence;
};

export type MarkEmptyContribution = {
  recordId: string;
  beforeQuantity: number;
  adjustmentQuantity: number;
  afterQuantity: 0;
  unit: string;
  normalizedQuantity: number;
  costState: CostState;
  costContribution: number | null;
};

export type MarkEmptyPlan = {
  ok: boolean;
  reason:
    | null
    | "owner_authorization_required"
    | "note_required"
    | "invalid_balance"
    | "duplicate_record"
    | "stale_total"
    | "nothing_to_empty";
  policy: AdjustmentReasonPolicy;
  beforeQuantity: number;
  adjustmentQuantity: number;
  afterQuantity: 0;
  contributions: MarkEmptyContribution[];
  cost: AggregatedCost;
};

const REASON_POLICIES: Record<
  StockAdjustmentReason,
  Omit<AdjustmentReasonPolicy, "reason">
> = {
  personal_household_use: {
    accountingClass: "owner_withdrawal",
    productCogs: false,
    noteRequired: false,
  },
  spoilage: {
    accountingClass: "inventory_loss_spoilage",
    productCogs: false,
    noteRequired: false,
  },
  damaged: {
    accountingClass: "inventory_loss_damage",
    productCogs: false,
    noteRequired: false,
  },
  expired: {
    accountingClass: "inventory_loss_expiry",
    productCogs: false,
    noteRequired: false,
  },
  promotion: {
    accountingClass: "promotional_usage",
    productCogs: false,
    noteRequired: false,
  },
  counting_correction: {
    accountingClass: "stock_variance",
    productCogs: false,
    noteRequired: false,
  },
  lost_missing: {
    accountingClass: "review_required_variance",
    productCogs: false,
    noteRequired: true,
  },
  returned_to_supplier: {
    accountingClass: "supplier_return",
    productCogs: false,
    noteRequired: false,
  },
  other: {
    accountingClass: "owner_selected_review",
    productCogs: false,
    noteRequired: true,
  },
};

export function adjustmentPolicyForReason(
  reason: StockAdjustmentReason,
): AdjustmentReasonPolicy {
  return { reason, ...REASON_POLICIES[reason] };
}

function noteIsPresent(note: string | null | undefined) {
  return Boolean(note?.trim());
}

/**
 * Pure quantity planning. The service still owns owner-context verification,
 * stale-database re-read, idempotency, guarded writes, and movement insertion.
 */
export function planStockAdjustment(input: {
  ownerAuthorized: boolean;
  beforeQuantity: number;
  operation: StockAdjustmentOperation;
  reason: StockAdjustmentReason;
  note?: string | null;
  maximumQuantity?: number | null;
  tolerance?: number;
}): StockAdjustmentPlan {
  const policy = adjustmentPolicyForReason(input.reason);
  const tolerance = input.tolerance ?? INVENTORY_QUANTITY_TOLERANCE;
  const base = {
    beforeQuantity: input.beforeQuantity,
    afterQuantity: input.beforeQuantity,
    adjustmentQuantity: 0,
    policy,
  };

  if (!input.ownerAuthorized) {
    return { ok: false, reason: "owner_authorization_required", ...base };
  }
  if (policy.noteRequired && !noteIsPresent(input.note)) {
    return { ok: false, reason: "note_required", ...base };
  }
  if (
    !Number.isFinite(input.beforeQuantity) ||
    input.beforeQuantity < -tolerance ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  ) {
    return { ok: false, reason: "invalid_quantity", ...base };
  }

  let afterQuantity: number;
  if (input.operation.kind === "mark_empty") {
    afterQuantity = 0;
  } else if (input.operation.kind === "set_count") {
    afterQuantity = input.operation.quantity;
  } else {
    afterQuantity = input.beforeQuantity + input.operation.quantity;
  }

  if (!Number.isFinite(afterQuantity)) {
    return { ok: false, reason: "invalid_quantity", ...base };
  }
  if (afterQuantity < -tolerance) {
    return { ok: false, reason: "stock_overdraw", ...base };
  }

  const normalizedAfter = Math.abs(afterQuantity) <= tolerance ? 0 : afterQuantity;
  const adjustmentQuantity = normalizedAfter - input.beforeQuantity;
  if (Math.abs(adjustmentQuantity) <= tolerance) {
    return { ok: false, reason: "no_quantity_change", ...base };
  }

  if (
    adjustmentQuantity > tolerance &&
    input.reason !== "counting_correction" &&
    input.reason !== "other"
  ) {
    return {
      ok: false,
      reason: "positive_adjustment_reason_not_supported",
      ...base,
    };
  }

  if (
    input.maximumQuantity !== undefined &&
    input.maximumQuantity !== null &&
    (!Number.isFinite(input.maximumQuantity) ||
      normalizedAfter > input.maximumQuantity + tolerance)
  ) {
    return {
      ok: false,
      reason: "quantity_above_allowed_maximum",
      ...base,
    };
  }

  return {
    ok: true,
    reason: null,
    beforeQuantity: input.beforeQuantity,
    afterQuantity: normalizedAfter,
    adjustmentQuantity,
    policy,
  };
}

function emptyCost(): AggregatedCost {
  return {
    complete: true,
    state: "not_applicable",
    total: null,
    knownSubtotal: 0,
    unresolvedStates: [],
    applicableCount: 0,
  };
}

/**
 * Allocates mark-empty across the exact positive records supplied by the
 * repository. It never archives or deletes a record.
 */
export function planMarkStockEmpty(input: {
  ownerAuthorized: boolean;
  reason: StockAdjustmentReason;
  note?: string | null;
  balances: readonly MarkEmptyBalance[];
  expectedNormalizedTotal?: number | null;
  tolerance?: number;
}): MarkEmptyPlan {
  const policy = adjustmentPolicyForReason(input.reason);
  const tolerance = input.tolerance ?? INVENTORY_QUANTITY_TOLERANCE;
  const failure = (
    reason: Exclude<MarkEmptyPlan["reason"], null>,
  ): MarkEmptyPlan => ({
    ok: false,
    reason,
    policy,
    beforeQuantity: 0,
    adjustmentQuantity: 0,
    afterQuantity: 0,
    contributions: [],
    cost: emptyCost(),
  });

  if (!input.ownerAuthorized) return failure("owner_authorization_required");
  if (policy.noteRequired && !noteIsPresent(input.note)) {
    return failure("note_required");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    return failure("invalid_balance");
  }

  const seen = new Set<string>();
  const contributions: MarkEmptyContribution[] = [];
  const contributionCosts: CostEvidence[] = [];

  for (const balance of input.balances) {
    if (seen.has(balance.recordId)) return failure("duplicate_record");
    seen.add(balance.recordId);

    const factor = balance.normalizedUnitsPerRecordUnit ?? 1;
    if (
      !balance.recordId.trim() ||
      !Number.isFinite(balance.remainingQuantity) ||
      balance.remainingQuantity < -tolerance ||
      !Number.isFinite(factor) ||
      factor <= 0 ||
      !validateCostEvidence(balance.costPerUnit).ok
    ) {
      return failure("invalid_balance");
    }

    if (balance.status !== "active" && balance.remainingQuantity > tolerance) {
      return failure("invalid_balance");
    }
    if (balance.status !== "active" || balance.remainingQuantity <= tolerance) {
      continue;
    }

    const costContribution =
      balance.costPerUnit.state === "known"
        ? balance.remainingQuantity * (balance.costPerUnit.amount as number)
        : null;
    contributions.push({
      recordId: balance.recordId,
      beforeQuantity: balance.remainingQuantity,
      adjustmentQuantity: -balance.remainingQuantity,
      afterQuantity: 0,
      unit: balance.unit,
      normalizedQuantity: balance.remainingQuantity * factor,
      costState: balance.costPerUnit.state,
      costContribution,
    });
    contributionCosts.push({
      state: balance.costPerUnit.state,
      amount: costContribution,
      legacyValue:
        balance.costPerUnit.state === "legacy_zero_unresolved" ? 0 : null,
    });
  }

  if (contributions.length === 0) return failure("nothing_to_empty");

  const beforeQuantity = contributions.reduce(
    (sum, contribution) => sum + contribution.normalizedQuantity,
    0,
  );
  if (
    input.expectedNormalizedTotal !== undefined &&
    input.expectedNormalizedTotal !== null &&
    (!Number.isFinite(input.expectedNormalizedTotal) ||
      Math.abs(input.expectedNormalizedTotal - beforeQuantity) > tolerance)
  ) {
    return failure("stale_total");
  }

  const aggregated = aggregateCosts(contributionCosts);
  if (!aggregated.ok) return failure("invalid_balance");

  return {
    ok: true,
    reason: null,
    policy,
    beforeQuantity,
    adjustmentQuantity: -beforeQuantity,
    afterQuantity: 0,
    contributions,
    cost: aggregated.cost,
  };
}
