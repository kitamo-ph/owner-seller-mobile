/**
 * Focused Phase B checks for supply rules, two-stage consumption, and separate
 * order-cost categories.
 */
const {
  knownCost,
  unknownCost,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/costState.js");
const {
  orderCostCategoryForSupply,
  summarizeOrderCosts,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/orderCosts.js");
const {
  calculateSupplySuggestions,
  validateReviewedSupplyLines,
  validateSupplyRule,
  validateSupplyUsageEvidence,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/supplyRules.js");

let failures = 0;
function check(name, condition) {
  if (!condition) failures += 1;
  console.log(`${name}: ${condition ? "OK" : "FAIL"}`);
}

function rule(overrides) {
  return {
    id: "rule",
    supplyItemId: "bag",
    supplyCategory: "packaging",
    supplyUnit: "pcs",
    scope: "per_product",
    behavior: "required",
    consumptionStage: "checkout",
    roundingRule: "multiply_each",
    targetProductId: "musubi",
    targetRecipeVersionId: null,
    triggerQuantity: 1,
    supplyQuantity: 1,
    active: true,
    ...overrides,
  };
}

check("valid per-product rule accepted", validateSupplyRule(rule({})).length === 0);
check(
  "scope/rounding mismatch rejected",
  validateSupplyRule(rule({ roundingRule: "once_per_order" })).includes(
    "scope_rounding_mismatch",
  ),
);

const suggestions = calculateSupplySuggestions({
  consumptionStage: "checkout",
  contexts: [{ productId: "musubi", recipeVersionId: null, quantity: 5 }],
  rules: [
    rule({ id: "wrapper", supplyItemId: "wrapper", behavior: "required" }),
    rule({
      id: "chopsticks",
      supplyItemId: "chopsticks",
      supplyCategory: "utensil",
      scope: "per_quantity",
      roundingRule: "ceiling_groups",
      triggerQuantity: 2,
      supplyQuantity: 1,
      behavior: "default_editable",
    }),
    rule({
      id: "bag",
      supplyItemId: "bag",
      scope: "per_order",
      roundingRule: "once_per_order",
      targetProductId: null,
      supplyQuantity: 1,
      behavior: "suggested_optional",
    }),
    rule({
      id: "ketchup",
      supplyItemId: "ketchup",
      supplyCategory: "condiment",
      behavior: "requested_only",
    }),
  ],
});
check("all checkout rule scopes calculate", suggestions.ok);
if (suggestions.ok) {
  const wrapper = suggestions.suggestions.find(
    (suggestion) => suggestion.supplyItemId === "wrapper",
  );
  const chopsticks = suggestions.suggestions.find(
    (suggestion) => suggestion.supplyItemId === "chopsticks",
  );
  const bag = suggestions.suggestions.find(
    (suggestion) => suggestion.supplyItemId === "bag",
  );
  check(
    "per-product required minimum is exact",
    wrapper.requiredMinimum === 5 && wrapper.initialReviewedQuantity === 5,
  );
  check(
    "per-quantity uses ceiling groups",
    chopsticks.defaultIncludedQuantity === 3,
  );
  check(
    "per-order suggestion applies once",
    bag.suggestedOptionalQuantity === 1,
  );
  check(
    "required supply cannot be reviewed below minimum",
    validateReviewedSupplyLines(suggestions.suggestions, [
      {
        supplyItemId: "wrapper",
        supplyUnit: "pcs",
        consumptionStage: "checkout",
        quantity: 4,
      },
    ]).reason === "required_minimum_not_met",
  );
  check(
    "default and suggested supplies may be removed when minimum is met",
    validateReviewedSupplyLines(suggestions.suggestions, [
      {
        supplyItemId: "wrapper",
        supplyUnit: "pcs",
        consumptionStage: "checkout",
        quantity: 5,
      },
      {
        supplyItemId: "chopsticks",
        supplyUnit: "pcs",
        consumptionStage: "checkout",
        quantity: 0,
      },
      {
        supplyItemId: "bag",
        supplyUnit: "pcs",
        consumptionStage: "checkout",
        quantity: 0,
      },
    ]).ok,
  );
}

const production = calculateSupplySuggestions({
  consumptionStage: "production",
  contexts: [
    { productId: null, recipeVersionId: "bottled-drink-v1", quantity: 10 },
  ],
  rules: [
    rule({
      id: "bottle-production",
      supplyItemId: "bottle",
      targetProductId: null,
      targetRecipeVersionId: "bottled-drink-v1",
      consumptionStage: "production",
    }),
    rule({
      id: "bag-checkout",
      supplyItemId: "bag",
      scope: "per_order",
      roundingRule: "once_per_order",
      targetProductId: null,
      consumptionStage: "checkout",
    }),
  ],
});
check(
  "production and checkout rules are stage-isolated",
  production.ok &&
    production.suggestions.length === 1 &&
    production.suggestions[0].supplyItemId === "bottle",
);

check(
  "same usage ID cannot be costed twice",
  !validateSupplyUsageEvidence([
    {
      usageId: "usage-1",
      consumptionStage: "production",
      ruleContributionIds: ["bottle-rule"],
    },
    {
      usageId: "usage-1",
      consumptionStage: "checkout",
      ruleContributionIds: ["bag-rule"],
    },
  ]).ok,
);
check(
  "one rule contribution cannot cross stages",
  validateSupplyUsageEvidence([
    {
      usageId: "usage-1",
      consumptionStage: "production",
      ruleContributionIds: ["same-contribution"],
    },
    {
      usageId: "usage-2",
      consumptionStage: "checkout",
      ruleContributionIds: ["same-contribution"],
    },
  ]).reason === "cross_stage_rule_contribution",
);
check(
  "one rule contribution cannot be double-counted in one stage",
  validateSupplyUsageEvidence([
    {
      usageId: "usage-1",
      consumptionStage: "checkout",
      ruleContributionIds: ["same-contribution"],
    },
    {
      usageId: "usage-2",
      consumptionStage: "checkout",
      ruleContributionIds: ["same-contribution"],
    },
  ]).reason === "duplicate_rule_contribution",
);

check(
  "supply categories map to separate order-cost categories",
  orderCostCategoryForSupply("packaging") === "packaging" &&
    orderCostCategoryForSupply("disposable") === "packaging" &&
    orderCostCategoryForSupply("utensil") === "utensil_condiment" &&
    orderCostCategoryForSupply("condiment") === "utensil_condiment" &&
    orderCostCategoryForSupply("cleaning_supply") === "other_supply",
);

const costs = summarizeOrderCosts([
  {
    evidenceId: "sale-item-1",
    category: "product_cogs",
    source: "sale_item_cogs",
    consumptionStage: null,
    cost: knownCost(50),
  },
  {
    evidenceId: "bag-usage",
    category: "packaging",
    source: "supply_usage",
    consumptionStage: "checkout",
    cost: knownCost(2),
  },
  {
    evidenceId: "fork-usage",
    category: "utensil_condiment",
    source: "supply_usage",
    consumptionStage: "checkout",
    cost: unknownCost(0),
  },
]);
check(
  "order costs remain separate and unknown propagates to total",
  costs.ok &&
    costs.summary.productCogs.total === 50 &&
    costs.summary.packagingCost.total === 2 &&
    costs.summary.utensilCondimentCost.total === null &&
    costs.summary.totalOrderCost.total === null,
);
check(
  "production supply cannot be double-added as checkout order cost",
  summarizeOrderCosts([
    {
      evidenceId: "production-wrapper",
      category: "packaging",
      source: "supply_usage",
      consumptionStage: "production",
      cost: knownCost(2),
    },
  ]).reason === "invalid_supply_stage",
);

if (failures === 0) {
  console.log("ALL SUPPLY RULE AND ORDER COST CHECKS PASSED");
  process.exit(0);
}
console.error(`${failures} SUPPLY RULE AND ORDER COST CHECKS FAILED`);
process.exit(1);
