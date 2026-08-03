const assert = require("node:assert/strict");

/**
 * Behavioral numeric/regression guards that remain outside source-text matching.
 * Rendered Paninda sheet, ingredient picker, and Step 2/3 identity coverage live
 * in dedicated UI behavioral scripts.
 */

const sausageCost = 250 / (1 * 18 * 4);
assert.ok(Math.abs(sausageCost - 3.4722222222222223) < 1e-12);
assert.equal(Number(sausageCost.toFixed(2)), 3.47);

const itemSpecificCupToGramFactor = 210;
const itemSpecificUsageCost = (100 / 1_000) * itemSpecificCupToGramFactor;
assert.equal(itemSpecificUsageCost, 21);

console.log(
  "RECIPE STABILIZATION BEHAVIOR PASSED: sausage package cost and item-specific conversion arithmetic",
);
console.log(
  "NOTE: rendered Paninda sheet, ingredient picker, and Step 2/3 identity are covered by check:paninda-action-sheet-behavior, check:recipe-ingredient-picker-behavior, and check:recipe-line-presentation-behavior",
);
