/**
 * Focused Phase B checks for adjustment policy, bounds, and mark-empty math.
 */
const {
  knownCost,
  unknownCost,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/costState.js");
const {
  adjustmentPolicyForReason,
  planMarkStockEmpty,
  planStockAdjustment,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/stockAdjustments.js");

let failures = 0;
function check(name, condition) {
  if (!condition) failures += 1;
  console.log(`${name}: ${condition ? "OK" : "FAIL"}`);
}

const reasons = [
  "personal_household_use",
  "spoilage",
  "damaged",
  "expired",
  "promotion",
  "counting_correction",
  "lost_missing",
  "returned_to_supplier",
  "other",
];
check(
  "all adjustment reasons stay outside Product COGS",
  reasons.every(
    (reason) => adjustmentPolicyForReason(reason).productCogs === false,
  ),
);
check(
  "personal use is owner withdrawal",
  adjustmentPolicyForReason("personal_household_use").accountingClass ===
    "owner_withdrawal",
);
check(
  "spoilage remains separately identifiable",
  adjustmentPolicyForReason("spoilage").accountingClass ===
    "inventory_loss_spoilage",
);
check(
  "promotion remains separate",
  adjustmentPolicyForReason("promotion").accountingClass ===
    "promotional_usage",
);

const personal = planStockAdjustment({
  ownerAuthorized: true,
  beforeQuantity: 30,
  operation: { kind: "delta", quantity: -6 },
  reason: "personal_household_use",
});
check(
  "personal-use adjustment calculates before/delta/after",
  personal.ok &&
    personal.beforeQuantity === 30 &&
    personal.adjustmentQuantity === -6 &&
    personal.afterQuantity === 24,
);
check(
  "positive personal-use correction is rejected",
  !planStockAdjustment({
    ownerAuthorized: true,
    beforeQuantity: 30,
    operation: { kind: "delta", quantity: 1 },
    reason: "personal_household_use",
  }).ok,
);
check(
  "counting correction may set a higher count",
  planStockAdjustment({
    ownerAuthorized: true,
    beforeQuantity: 30,
    operation: { kind: "set_count", quantity: 31 },
    reason: "counting_correction",
  }).ok,
);
check(
  "overdraw is rejected",
  planStockAdjustment({
    ownerAuthorized: true,
    beforeQuantity: 3,
    operation: { kind: "delta", quantity: -4 },
    reason: "damaged",
  }).reason === "stock_overdraw",
);
check(
  "review-required loss requires note",
  planStockAdjustment({
    ownerAuthorized: true,
    beforeQuantity: 3,
    operation: { kind: "delta", quantity: -1 },
    reason: "lost_missing",
  }).reason === "note_required",
);

const markEmpty = planMarkStockEmpty({
  ownerAuthorized: true,
  reason: "spoilage",
  balances: [
    {
      recordId: "lot-a",
      remainingQuantity: 2,
      unit: "kg",
      status: "active",
      costPerUnit: knownCost(10),
    },
    {
      recordId: "lot-b",
      remainingQuantity: 3,
      unit: "kg",
      status: "active",
      costPerUnit: unknownCost(0),
    },
    {
      recordId: "lot-empty",
      remainingQuantity: 0,
      unit: "kg",
      status: "depleted",
      costPerUnit: knownCost(5),
    },
  ],
  expectedNormalizedTotal: 5,
});
check(
  "mark-empty allocates exact remaining quantity across positive lots",
  markEmpty.ok &&
    markEmpty.beforeQuantity === 5 &&
    markEmpty.adjustmentQuantity === -5 &&
    markEmpty.contributions.length === 2 &&
    markEmpty.contributions.every(
      (contribution) => contribution.afterQuantity === 0,
    ),
);
check(
  "mark-empty preserves incomplete cost rather than zero-filling",
  markEmpty.ok &&
    !markEmpty.cost.complete &&
    markEmpty.cost.total === null &&
    markEmpty.cost.knownSubtotal === 20,
);
check(
  "stale mark-empty total fails before mutations",
  planMarkStockEmpty({
    ownerAuthorized: true,
    reason: "counting_correction",
    balances: [
      {
        recordId: "lot-a",
        remainingQuantity: 2,
        unit: "kg",
        status: "active",
        costPerUnit: knownCost(10),
      },
    ],
    expectedNormalizedTotal: 3,
  }).reason === "stale_total",
);
check(
  "mark-empty requires owner authorization",
  planMarkStockEmpty({
    ownerAuthorized: false,
    reason: "spoilage",
    balances: [],
  }).reason === "owner_authorization_required",
);

if (failures === 0) {
  console.log("ALL STOCK ADJUSTMENT CHECKS PASSED");
  process.exit(0);
}
console.error(`${failures} STOCK ADJUSTMENT CHECKS FAILED`);
process.exit(1);
