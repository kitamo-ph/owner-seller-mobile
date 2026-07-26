export const SUPPLY_CATEGORIES = [
  "packaging",
  "utensil",
  "condiment",
  "disposable",
  "cleaning_supply",
  "other_consumable",
] as const;

export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number];

export type SupplyRuleScope = "per_product" | "per_quantity" | "per_order";
export type SupplyRuleBehavior =
  | "required"
  | "default_editable"
  | "suggested_optional"
  | "requested_only";
export type SupplyConsumptionStage = "production" | "checkout";
export type SupplyRoundingRule =
  | "multiply_each"
  | "ceiling_groups"
  | "once_per_order";

export type SupplyUsageRule = {
  id: string;
  supplyItemId: string;
  supplyCategory: SupplyCategory;
  supplyUnit: string;
  scope: SupplyRuleScope;
  behavior: SupplyRuleBehavior;
  consumptionStage: SupplyConsumptionStage;
  roundingRule: SupplyRoundingRule;
  targetProductId: string | null;
  targetRecipeVersionId: string | null;
  triggerQuantity: number;
  supplyQuantity: number;
  active: boolean;
};

export type SupplyRuleContextLine = {
  productId: string | null;
  recipeVersionId: string | null;
  quantity: number;
};

export type SupplyRuleContribution = {
  ruleId: string;
  supplyItemId: string;
  supplyCategory: SupplyCategory;
  supplyUnit: string;
  consumptionStage: SupplyConsumptionStage;
  behavior: SupplyRuleBehavior;
  calculatedQuantity: number;
  requiredMinimum: number;
  defaultIncludedQuantity: number;
  suggestedOptionalQuantity: number;
};

export type AggregatedSupplySuggestion = {
  supplyItemId: string;
  supplyCategory: SupplyCategory;
  supplyUnit: string;
  consumptionStage: SupplyConsumptionStage;
  requiredMinimum: number;
  defaultIncludedQuantity: number;
  suggestedOptionalQuantity: number;
  initialReviewedQuantity: number;
  contributionIds: string[];
  contributions: SupplyRuleContribution[];
};

export type SupplyRuleValidationIssue =
  | "missing_identifier"
  | "invalid_quantity"
  | "scope_rounding_mismatch"
  | "target_required"
  | "per_order_target_forbidden"
  | "ambiguous_target"
  | "conflicting_supply_category";

export type SupplySuggestionResult =
  | { ok: true; suggestions: AggregatedSupplySuggestion[] }
  | {
      ok: false;
      ruleId: string;
      issues: SupplyRuleValidationIssue[];
    };

export type ReviewedSupplyLine = {
  supplyItemId: string;
  supplyUnit: string;
  consumptionStage: SupplyConsumptionStage;
  quantity: number;
};

export type SupplyUsageEvidence = {
  usageId: string;
  consumptionStage: SupplyConsumptionStage;
  ruleContributionIds: readonly string[];
};

export function validateSupplyRule(
  rule: SupplyUsageRule,
): SupplyRuleValidationIssue[] {
  const issues: SupplyRuleValidationIssue[] = [];
  if (
    !rule.id.trim() ||
    !rule.supplyItemId.trim() ||
    !rule.supplyUnit.trim()
  ) {
    issues.push("missing_identifier");
  }
  if (
    !Number.isFinite(rule.triggerQuantity) ||
    rule.triggerQuantity <= 0 ||
    !Number.isFinite(rule.supplyQuantity) ||
    rule.supplyQuantity < 0
  ) {
    issues.push("invalid_quantity");
  }

  const expectedRounding: Record<SupplyRuleScope, SupplyRoundingRule> = {
    per_product: "multiply_each",
    per_quantity: "ceiling_groups",
    per_order: "once_per_order",
  };
  if (rule.roundingRule !== expectedRounding[rule.scope]) {
    issues.push("scope_rounding_mismatch");
  }

  const hasProductTarget = Boolean(rule.targetProductId);
  const hasRecipeTarget = Boolean(rule.targetRecipeVersionId);
  if (hasProductTarget && hasRecipeTarget) issues.push("ambiguous_target");

  if (rule.scope === "per_order") {
    if (hasProductTarget || hasRecipeTarget) {
      issues.push("per_order_target_forbidden");
    }
  } else if (!hasProductTarget && !hasRecipeTarget) {
    issues.push("target_required");
  }

  return issues;
}

function matchingQuantity(
  rule: SupplyUsageRule,
  contexts: readonly SupplyRuleContextLine[],
): number {
  if (rule.scope === "per_order") {
    return contexts.some(
      (context) => Number.isFinite(context.quantity) && context.quantity > 0,
    )
      ? 1
      : 0;
  }

  return contexts.reduce((sum, context) => {
    const matchesProduct =
      rule.targetProductId !== null &&
      context.productId === rule.targetProductId;
    const matchesRecipe =
      rule.targetRecipeVersionId !== null &&
      context.recipeVersionId === rule.targetRecipeVersionId;
    return matchesProduct || matchesRecipe ? sum + context.quantity : sum;
  }, 0);
}

function calculatedRuleQuantity(
  rule: SupplyUsageRule,
  matchedQuantity: number,
): number {
  if (matchedQuantity <= 0) return 0;
  if (rule.scope === "per_order") return rule.supplyQuantity;
  if (rule.scope === "per_product") {
    return matchedQuantity * rule.supplyQuantity;
  }
  return (
    Math.ceil(matchedQuantity / rule.triggerQuantity) * rule.supplyQuantity
  );
}

/**
 * Calculates each rule independently, then aggregates by supply/unit/stage
 * while retaining exact rule contributions and required minima.
 */
export function calculateSupplySuggestions(input: {
  rules: readonly SupplyUsageRule[];
  contexts: readonly SupplyRuleContextLine[];
  consumptionStage: SupplyConsumptionStage;
}): SupplySuggestionResult {
  if (
    input.contexts.some(
      (context) =>
        !Number.isFinite(context.quantity) || context.quantity < 0,
    )
  ) {
    return {
      ok: false,
      ruleId: "",
      issues: ["invalid_quantity"],
    };
  }

  const contributions: SupplyRuleContribution[] = [];
  for (const rule of input.rules) {
    if (!rule.active || rule.consumptionStage !== input.consumptionStage) {
      continue;
    }
    const issues = validateSupplyRule(rule);
    if (issues.length > 0) return { ok: false, ruleId: rule.id, issues };

    const quantity = calculatedRuleQuantity(
      rule,
      matchingQuantity(rule, input.contexts),
    );
    if (quantity <= 0) continue;

    contributions.push({
      ruleId: rule.id,
      supplyItemId: rule.supplyItemId,
      supplyCategory: rule.supplyCategory,
      supplyUnit: rule.supplyUnit,
      consumptionStage: rule.consumptionStage,
      behavior: rule.behavior,
      calculatedQuantity: quantity,
      requiredMinimum: rule.behavior === "required" ? quantity : 0,
      defaultIncludedQuantity:
        rule.behavior === "required" ||
        rule.behavior === "default_editable"
          ? quantity
          : 0,
      suggestedOptionalQuantity:
        rule.behavior === "suggested_optional" ? quantity : 0,
    });
  }

  const grouped = new Map<string, AggregatedSupplySuggestion>();
  for (const contribution of contributions) {
    const key = [
      contribution.supplyItemId,
      contribution.supplyUnit,
      contribution.consumptionStage,
    ].join("\u0000");
    const existing = grouped.get(key);
    if (existing) {
      if (existing.supplyCategory !== contribution.supplyCategory) {
        return {
          ok: false,
          ruleId: contribution.ruleId,
          issues: ["conflicting_supply_category"],
        };
      }
      existing.requiredMinimum += contribution.requiredMinimum;
      existing.defaultIncludedQuantity +=
        contribution.defaultIncludedQuantity;
      existing.suggestedOptionalQuantity +=
        contribution.suggestedOptionalQuantity;
      existing.initialReviewedQuantity = existing.defaultIncludedQuantity;
      existing.contributionIds.push(contribution.ruleId);
      existing.contributions.push(contribution);
    } else {
      grouped.set(key, {
        supplyItemId: contribution.supplyItemId,
        supplyCategory: contribution.supplyCategory,
        supplyUnit: contribution.supplyUnit,
        consumptionStage: contribution.consumptionStage,
        requiredMinimum: contribution.requiredMinimum,
        defaultIncludedQuantity: contribution.defaultIncludedQuantity,
        suggestedOptionalQuantity: contribution.suggestedOptionalQuantity,
        initialReviewedQuantity: contribution.defaultIncludedQuantity,
        contributionIds: [contribution.ruleId],
        contributions: [contribution],
      });
    }
  }

  return {
    ok: true,
    suggestions: [...grouped.values()].sort((left, right) =>
      `${left.supplyItemId}:${left.supplyUnit}`.localeCompare(
        `${right.supplyItemId}:${right.supplyUnit}`,
      ),
    ),
  };
}

export function validateReviewedSupplyLines(
  suggestions: readonly AggregatedSupplySuggestion[],
  reviewed: readonly ReviewedSupplyLine[],
):
  | { ok: true }
  | {
      ok: false;
      reason:
        | "duplicate_review_line"
        | "invalid_quantity"
        | "required_minimum_not_met";
      supplyItemId: string;
    } {
  const reviewedByKey = new Map<string, ReviewedSupplyLine>();
  for (const line of reviewed) {
    const key = `${line.supplyItemId}\u0000${line.supplyUnit}\u0000${line.consumptionStage}`;
    if (reviewedByKey.has(key)) {
      return {
        ok: false,
        reason: "duplicate_review_line",
        supplyItemId: line.supplyItemId,
      };
    }
    if (!Number.isFinite(line.quantity) || line.quantity < 0) {
      return {
        ok: false,
        reason: "invalid_quantity",
        supplyItemId: line.supplyItemId,
      };
    }
    reviewedByKey.set(key, line);
  }

  for (const suggestion of suggestions) {
    const key = `${suggestion.supplyItemId}\u0000${suggestion.supplyUnit}\u0000${suggestion.consumptionStage}`;
    const reviewedLine = reviewedByKey.get(key);
    const quantity = reviewedLine?.quantity ?? 0;
    if (quantity + 1e-9 < suggestion.requiredMinimum) {
      return {
        ok: false,
        reason: "required_minimum_not_met",
        supplyItemId: suggestion.supplyItemId,
      };
    }
  }
  return { ok: true };
}

/**
 * Each durable usage ID and each rule contribution may belong to one stage
 * only. This prevents a usage from being deducted or costed at production and
 * again at checkout.
 */
export function validateSupplyUsageEvidence(
  usages: readonly SupplyUsageEvidence[],
):
  | { ok: true }
  | {
      ok: false;
      reason:
        | "duplicate_usage"
        | "duplicate_rule_contribution"
        | "cross_stage_rule_contribution";
      id: string;
    } {
  const usageIds = new Set<string>();
  const contributionStage = new Map<string, SupplyConsumptionStage>();
  for (const usage of usages) {
    if (usageIds.has(usage.usageId)) {
      return { ok: false, reason: "duplicate_usage", id: usage.usageId };
    }
    usageIds.add(usage.usageId);

    for (const contributionId of usage.ruleContributionIds) {
      const priorStage = contributionStage.get(contributionId);
      if (priorStage) {
        return {
          ok: false,
          reason:
            priorStage === usage.consumptionStage
              ? "duplicate_rule_contribution"
              : "cross_stage_rule_contribution",
          id: contributionId,
        };
      }
      contributionStage.set(contributionId, usage.consumptionStage);
    }
  }
  return { ok: true };
}
