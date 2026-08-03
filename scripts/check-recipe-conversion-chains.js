const assert = require("node:assert/strict");
const path = require("node:path");

const compiledModule = require(path.join(
  process.cwd(),
  "node_modules/.cache/kitamo-recipe-conversion-chain-check/recipeConversionChains.js",
));

const {
  buildRecipeConversionChain,
  calculateConversionChainUsageCost,
  packageBreakdownConversion,
  parseRecipeConversionChain,
  serializeRecipeConversionChain,
  standardRecipeUnitFactor,
  validateRecipeConversionSnapshotEvidence,
} = compiledModule;

function requireSnapshot(result) {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  return result.snapshot;
}

const sausage = requireSnapshot(
  packageBreakdownConversion({
    packagesPurchased: 1,
    piecesPerPackage: 18,
    portionsPerPiece: 4,
  }),
);
assert.equal(sausage.outputQuantityPerInputUnit, 72);
assert.ok(
  Math.abs(
    calculateConversionChainUsageCost({
      totalCost: 250,
      referenceQuantity: 1,
      usageQuantity: 1,
      chain: sausage,
    }) - 250 / 72,
  ) < 1e-9,
);

const editedSausage = requireSnapshot(
  packageBreakdownConversion({
    packagesPurchased: 1,
    piecesPerPackage: 18,
    portionsPerPiece: 2,
  }),
);
assert.equal(editedSausage.outputQuantityPerInputUnit, 36);
assert.notEqual(
  editedSausage.outputQuantityPerInputUnit,
  sausage.outputQuantityPerInputUnit,
);

assert.equal(standardRecipeUnitFactor("US gallon", "ml"), 3_785.411784);
assert.equal(standardRecipeUnitFactor("imperial gallon", "ml"), 4_546.09);
assert.notEqual(
  standardRecipeUnitFactor("US gallon", "ml"),
  standardRecipeUnitFactor("imperial gallon", "ml"),
);
assert.equal(standardRecipeUnitFactor("metric cup", "ml"), 250);
assert.equal(standardRecipeUnitFactor("US cup", "ml"), 236.5882365);
assert.equal(standardRecipeUnitFactor("custom cup", "ml"), null);
assert.equal(standardRecipeUnitFactor("kg", "ml"), null);

const customCup = requireSnapshot(
  buildRecipeConversionChain([
    {
      fromQuantity: 1,
      fromUnit: "custom cup",
      toQuantity: 240,
      toUnit: "ml",
      standard: "business_custom",
      meaning: "Owner-defined 240 mL cup",
    },
  ]),
);
assert.equal(customCup.outputQuantityPerInputUnit, 240);
assert.equal(customCup.unitStandardSummary, "business_custom");

const circular = buildRecipeConversionChain([
  {
    fromQuantity: 1,
    fromUnit: "pack",
    toQuantity: 18,
    toUnit: "pcs",
    standard: "package_breakdown",
    meaning: "18 pieces per pack",
  },
  {
    fromQuantity: 18,
    fromUnit: "pcs",
    toQuantity: 1,
    toUnit: "pack",
    standard: "package_breakdown",
    meaning: "Reverse edge",
  },
]);
assert.deepEqual(circular, {
  ok: false,
  reason: "circular_conversion",
  stepIndex: 1,
});

const contradictoryStandard = buildRecipeConversionChain([
  {
    fromQuantity: 1,
    fromUnit: "us_gallon",
    toQuantity: 4_000,
    toUnit: "ml",
    standard: "us_customary",
    meaning: "Incorrect US gallon definition",
  },
]);
assert.deepEqual(contradictoryStandard, {
  ok: false,
  reason: "contradictory_path",
  stepIndex: 0,
});

const serialized = serializeRecipeConversionChain(sausage);
assert.deepEqual(parseRecipeConversionChain(serialized), sausage);
assert.equal(
  parseRecipeConversionChain(
    serialized.replace('"outputQuantityPerInputUnit":72', '"outputQuantityPerInputUnit":71'),
  ),
  null,
);
assert.equal(
  parseRecipeConversionChain(
    serialized.replace(
      '"unitStandardSummary":"package_breakdown, item_specific"',
      '"unitStandardSummary":"imperial"',
    ),
  ),
  null,
);

assert.deepEqual(
  validateRecipeConversionSnapshotEvidence({
    conversionChainJson: serialized,
    unitStandardSnapshot: sausage.unitStandardSummary,
    expectedInputUnit: "pack",
    expectedOutputUnit: "portion",
    expectedOutputQuantityPerInputUnit: 72,
  }),
  { ok: true, snapshot: sausage },
);
for (const [label, override, reason] of [
  ["unit-standard mismatch", { unitStandardSnapshot: "imperial" }, "unit_standard_mismatch"],
  ["reversed input", { expectedInputUnit: "portion" }, "input_unit_mismatch"],
  ["wrong evidence unit", { expectedOutputUnit: "pcs" }, "output_unit_mismatch"],
  ["wrong factor", { expectedOutputQuantityPerInputUnit: 71 }, "factor_mismatch"],
]) {
  const validation = validateRecipeConversionSnapshotEvidence({
    conversionChainJson: serialized,
    unitStandardSnapshot: sausage.unitStandardSummary,
    expectedInputUnit: "pack",
    expectedOutputUnit: "portion",
    expectedOutputQuantityPerInputUnit: 72,
    ...override,
  });
  assert.deepEqual(validation, { ok: false, reason }, label);
}

const unknownStandard = buildRecipeConversionChain([
  {
    fromQuantity: 1,
    fromUnit: "custom_cup",
    toQuantity: 240,
    toUnit: "ml",
    standard: "unreviewed_standard",
    meaning: "Unreviewed standard must fail closed",
  },
]);
assert.deepEqual(unknownStandard, {
  ok: false,
  reason: "contradictory_path",
  stepIndex: 0,
});

console.log("package breakdown and live recalculation: passed");
console.log("explicit volume standards and custom cup boundary: passed");
console.log("dimension, cycle, and contradiction guards: passed");
console.log("immutable conversion snapshot round trip: passed");
console.log("strict persisted conversion evidence alignment: passed");
console.log("ALL RECIPE CONVERSION CHAIN CHECKS PASSED");
