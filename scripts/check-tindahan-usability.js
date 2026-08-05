const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();
const outDir = path.join(
  workspace,
  "node_modules/.cache/kitamo-tindahan-usability-check",
);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  path.join(workspace, "node_modules/.bin/tsc"),
  [
    "src/domain/recipeConversionChains.ts",
    "src/domain/recipeUnitPicker.ts",
    "src/domain/recipeConversionDisplay.ts",
    "src/domain/costState.ts",
    "src/domain/recipeFirst.ts",
    "src/domain/catalogItems.ts",
    "src/domain/panindaActionSheet.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--strict",
    "--skipLibCheck",
  ],
  { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

const {
  standardRecipeUnitFactor,
} = require(path.join(outDir, "recipeConversionChains.js"));
const {
  COUNTABLE_MEASURED_CONVERSION_GUIDANCE,
  countableMeasuredConversionGuidance,
  classifyRecipeUnitCompatibility,
  ghostedUnitGuidance,
  partitionRecipeUnitOptions,
  shortRecipeUnitLabel,
  COMMON_RECIPE_UNIT_KEYS,
} = require(path.join(outDir, "recipeUnitPicker.js"));
const {
  buildMeasuredCostDerivationLine,
  formatConversionStepForDisplay,
  presentStoredConversionSummary,
} = require(path.join(outDir, "recipeConversionDisplay.js"));
const {
  calculateSimpleIngredientCost,
  convertRecipeQuantity,
  RECIPE_FIRST_UNITS,
} = require(path.join(outDir, "recipeFirst.js"));
const {
  resolvePanindaActionPolicy,
  resolvePanindaSection,
} = require(path.join(outDir, "catalogItems.js"));
const {
  buildPanindaActionDescriptors,
} = require(path.join(outDir, "panindaActionSheet.js"));

const policyBase = {
  classification: "finished_product",
  lifecycle: "ready",
  readinessState: "ready",
  compatibilityMode: "native",
  sourceType: "native",
  bindingStatus: "active",
  stockPolicy: "product_lots",
  productActive: false,
  hasDraft: false,
  hasRecipe: true,
  hasPublishedRecipe: true,
};

// Unit grouping / common-vs-Iba pa
const partition = partitionRecipeUnitOptions(RECIPE_FIRST_UNITS);
assert.deepEqual(
  partition.common.map((unit) => unit.toLocaleLowerCase()),
  [...COMMON_RECIPE_UNIT_KEYS],
);
assert.ok(
  partition.more.some((group) => group.key === "mass"),
  "imperial mass units belong under Iba pa",
);
assert.ok(partition.more.some((group) => group.key === "volume"));
assert.ok(partition.more.some((group) => group.key === "countable"));
assert.ok(
  partition.more
    .find((group) => group.key === "volume")
    .header.includes("Sukat"),
);
assert.ok(
  partition.more
    .find((group) => group.key === "countable")
    .header.includes("Bilang"),
);
assert.ok(partition.moreFlat.includes("portion"));
assert.ok(partition.moreFlat.includes("serving"));
assert.ok(partition.moreFlat.includes("oz"));
assert.ok(partition.moreFlat.includes("lb"));
assert.ok(partition.moreFlat.includes("floz_us"));
assert.ok(partition.moreFlat.includes("floz_imp"));
assert.ok(!partition.common.includes("portion"));
assert.ok(!partition.common.includes("oz"));
assert.ok(!partition.moreFlat.includes("g"));
assert.equal(shortRecipeUnitLabel("oz"), "oz (timbang)");
assert.equal(shortRecipeUnitLabel("floz_us"), "US fl oz");
assert.notEqual(shortRecipeUnitLabel("oz"), "oz");

const groceryPartition = partitionRecipeUnitOptions([
  "g",
  "kg",
  "ml",
  "L",
  "pcs",
  "pack",
  "metric_cup",
  "custom_cup",
]);
assert.equal(groceryPartition.common.includes("L"), true);
assert.ok(groceryPartition.moreFlat.includes("metric_cup"));

// Countable ↔ measured guidance
const packToGram = countableMeasuredConversionGuidance("pack", "g");
assert.equal(packToGram, COUNTABLE_MEASURED_CONVERSION_GUIDANCE);
assert.ok(
  countableMeasuredConversionGuidance("pcs", "kg")?.includes(
    "Package breakdown",
  ),
);
assert.equal(countableMeasuredConversionGuidance("g", "kg"), null);
assert.equal(countableMeasuredConversionGuidance("ml", "l"), null);

// Fail-closed factors unchanged
assert.equal(standardRecipeUnitFactor("custom_cup", "ml"), null);
assert.equal(standardRecipeUnitFactor("kg", "ml"), null);
assert.equal(standardRecipeUnitFactor("pack", "g"), null);
assert.equal(standardRecipeUnitFactor("oz", "g"), 28.349523125);
assert.equal(standardRecipeUnitFactor("floz_us", "g"), null);

// Ghosted compatibility — derived from factors, not a hard-coded matrix
assert.equal(classifyRecipeUnitCompatibility("g", "kg"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("ml", "kg"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("l", "kg"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("metric_cup", "kg"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("tbsp", "kg"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("tsp", "kg"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("oz", "kg"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("g", "ml"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("kg", "ml"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("l", "ml"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("metric_cup", "ml"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("us_cup", "ml"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("tbsp", "ml"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("tsp", "ml"), "enabled");
assert.equal(classifyRecipeUnitCompatibility("g", "pack"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("ml", "pack"), "ghosted");
assert.equal(classifyRecipeUnitCompatibility("kg", null), "enabled");
assert.equal(classifyRecipeUnitCompatibility("ml", ""), "enabled");

const massVolumeGhost = ghostedUnitGuidance("kg", "metric_cup");
assert.equal(massVolumeGhost.route, "custom_conversion");
assert.match(massVolumeGhost.message, /Custom conversion|itakda ang sukat/i);

const countableGhost = ghostedUnitGuidance("pack", "g");
assert.equal(countableGhost.route, "package_breakdown");
assert.match(countableGhost.message, /binibilang/);

const customCupGhost = ghostedUnitGuidance("ml", "custom_cup");
assert.equal(customCupGhost.route, "custom_cup");
assert.match(customCupGhost.message, /cup sa mL/);

// Selector source keeps ghosted chips actionable (not Pressable disabled)
const selectorSource = fs.readFileSync(
  path.join(workspace, "src/components/owner/RecipeUnitSelector.tsx"),
  "utf8",
);
assert.match(selectorSource, /accessibilityState=\{\{\s*[\s\S]*?disabled:\s*false/);
assert.match(selectorSource, /onGhostedSelect/);
assert.match(selectorSource, /disabledBg/);
assert.doesNotMatch(
  selectorSource,
  /disabled=\{ghosted\}/,
);

// Conversion math still correct; display is reference → usage
const converted = convertRecipeQuantity(1, "kg", "g");
assert.equal(converted.ok, true);
assert.equal(converted.quantity, 1000);

const cost = calculateSimpleIngredientCost({
  purchaseCost: 80,
  purchasedQuantity: 1,
  purchaseUnit: "kg",
  usageQuantity: 200,
  usageUnit: "g",
  costSource: "owner_estimate",
});
assert.equal(cost.state, "estimated");
assert.ok(Math.abs((cost.costPerUsageUnit ?? 0) - 0.08) < 1e-9);
assert.ok(Math.abs((cost.amount ?? 0) - 16) < 1e-9);
assert.equal(cost.availableUsageQuantity, 1000);

assert.equal(
  formatConversionStepForDisplay({
    fromQuantity: 1,
    fromUnit: "g",
    toQuantity: 0.001,
    toUnit: "kg",
  }),
  "1 kg = 1,000 g",
);

assert.equal(
  presentStoredConversionSummary({
    conversionChainJson: JSON.stringify({
      version: 1,
      steps: [
        {
          fromQuantity: 1,
          fromUnit: "g",
          toQuantity: 0.001,
          toUnit: "kg",
          standard: "metric",
          meaning: "Standard unit conversion used by this Recipe",
        },
      ],
      inputUnit: "g",
      outputUnit: "kg",
      outputQuantityPerInputUnit: 0.001,
      costFactorFromOutputToInput: 1000,
      unitStandardSummary: "metric",
    }),
  }),
  "1 kg = 1,000 g",
);

const derivation = buildMeasuredCostDerivationLine({
  referenceQuantity: 1,
  referenceUnit: "kg",
  usageQuantity: 200,
  usageUnit: "g",
  costPerUsageUnit: cost.costPerUsageUnit,
  totalAmount: cost.amount,
});
assert.ok(derivation.includes("1 kg = 1,000 g"));
assert.ok(derivation.includes("200 g bawat serving"));
assert.ok(derivation.includes("₱0.08/g"));
assert.ok(derivation.includes("₱16.00"));

// Package-style steps already reference→usage stay as-is
assert.equal(
  formatConversionStepForDisplay({
    fromQuantity: 1,
    fromUnit: "pack",
    toQuantity: 18,
    toUnit: "pcs",
  }),
  "1 pack = 18 pcs",
);

// Paninda section segmentation + Needs Setup explanation survive restyle contract
assert.equal(resolvePanindaSection(policyBase), "needs_setup");
assert.equal(
  resolvePanindaSection({
    ...policyBase,
    lifecycle: "active",
    productActive: true,
  }),
  "active",
);

const inventorySource = fs.readFileSync(
  path.join(workspace, "app/owner/inventory.tsx"),
  "utf8",
);
assert.match(
  inventorySource,
  /Handa na ito\. Piliin ang Ilagay sa Tindahan para maibenta sa Kiosk\./,
);
assert.match(inventorySource, /Needs Setup/);
assert.match(inventorySource, /sectionBanner/);
assert.match(inventorySource, /borderRadius: 20/);

// Defect 6 branch (a): native Recipe routes to Produce, not manual cook
const recipeActions = resolvePanindaActionPolicy(policyBase);
assert.equal(recipeActions.produceFromRecipe, true);
assert.equal(recipeActions.manualCompatibilityStockIn, false);
assert.equal(recipeActions.listForSale, true);

const descriptors = buildPanindaActionDescriptors({
  actions: recipeActions,
  productType: "cooked food",
});
assert.ok(descriptors.some((entry) => entry.key === "produceFromRecipe"));
assert.ok(
  !descriptors.some((entry) => entry.key === "manualCompatibilityStockIn"),
);

const recipesSource = fs.readFileSync(
  path.join(workspace, "app/owner/recipes.tsx"),
  "utf8",
);
assert.match(recipesSource, /Produce from Recipe/);
assert.match(
  recipesSource,
  /params:\s*\{\s*recipeId:\s*entry\.activeRecipeId/,
);

const plannerSource = fs.readFileSync(
  path.join(workspace, "src/services/productionPlanner.ts"),
  "utf8",
);
assert.doesNotMatch(
  plannerSource.slice(
    plannerSource.indexOf("export async function loadNativeProductionReadiness"),
    plannerSource.indexOf("export async function loadNativeProductionReadiness") +
      2500,
  ),
  /product_projection\.active\s*=\s*1/,
);

console.log("tindahan usability: unit grouping, conversion display, and produce routing checks passed");
