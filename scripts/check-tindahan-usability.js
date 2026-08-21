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
  resolveKnownSellingPrice,
  resolvePanindaActionPolicy,
  resolvePanindaSection,
  resolveProductionSuccessContinuation,
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

// Reference/Purchase is free: changing reference away from g is never ghosted
// by the current usage unit. Usage remains constrained by reference.
assert.equal(
  classifyRecipeUnitCompatibility("pcs", null),
  "enabled",
  "Reference with no opposite stays freely selectable (g → pcs)",
);
assert.equal(
  classifyRecipeUnitCompatibility("ml", null),
  "enabled",
  "Reference with no opposite stays freely selectable (g → mL)",
);
assert.equal(
  classifyRecipeUnitCompatibility("pcs", "g"),
  "ghosted",
  "Usage pcs remains ghosted when Reference is g",
);
assert.equal(
  classifyRecipeUnitCompatibility("ml", "g"),
  "ghosted",
  "Usage mL remains ghosted when Reference is g",
);
assert.equal(
  classifyRecipeUnitCompatibility("g", "g"),
  "enabled",
  "Usage g stays enabled when Reference is g",
);

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

// Editor wiring: Reference/Purchase must not pass oppositeUnit; Usage must.
const editorSource = fs.readFileSync(
  path.join(workspace, "app/owner/recipe-editor.tsx"),
  "utf8",
);
const estimateReferenceBlock = editorSource.match(
  /label="Reference unit"[\s\S]*?selected=\{props\.estimateReferenceUnit\}/,
);
assert.ok(estimateReferenceBlock, "estimate Reference selector present");
assert.doesNotMatch(
  estimateReferenceBlock[0],
  /oppositeUnit/,
  "Estimate Reference must not be constrained by Usage",
);
const estimateUsageBlock = editorSource.match(
  /label="Usage unit"[\s\S]*?selected=\{props\.estimateUsageUnit\}/,
);
assert.ok(estimateUsageBlock, "estimate Usage selector present");
assert.match(
  estimateUsageBlock[0],
  /oppositeUnit=\{props\.estimateReferenceUnit\}/,
  "Estimate Usage must stay constrained by Reference",
);
const purchaseBlock = editorSource.match(
  /label="Purchase unit"[\s\S]*?selected=\{props\.newPurchaseUnit\}/,
);
assert.ok(purchaseBlock, "new-raw Purchase selector present");
assert.doesNotMatch(
  purchaseBlock[0],
  /oppositeUnit/,
  "Purchase/Reference must not be constrained by Usage",
);
const newUsageBlock = editorSource.match(
  /label="Usage unit"[\s\S]*?selected=\{props\.newUsageUnit\}/,
);
assert.ok(newUsageBlock, "new-raw Usage selector present");
assert.match(
  newUsageBlock[0],
  /oppositeUnit=\{props\.newPurchaseUnit\}/,
  "new-raw Usage must stay constrained by Purchase unit",
);
assert.match(
  editorSource,
  /oppositeUnit=\{selectedLot\?\.unit \?\? null\}/,
  "Grocery-lot Usage remains constrained by the lot unit",
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
  /presentPanindaEntry\(entry\)\.reason/,
);
assert.match(inventorySource, /May kulang bago maibenta/);
assert.match(inventorySource, /sectionBanner/);
assert.match(inventorySource, /borderRadius: 20/);
assert.match(inventorySource, /sellingPrice === null \? "Walang presyo"/);
assert.doesNotMatch(
  inventorySource.slice(
    inventorySource.indexOf("function InventoryProductRow"),
    inventorySource.indexOf("function ProductActionSheet"),
  ),
  /\{formatPeso\(product\.price\)\}/,
);

const productionSource = fs.readFileSync(
  path.join(workspace, "app/owner/production.tsx"),
  "utf8",
);
assert.match(productionSource, /loadCatalogReadiness\(result\.outputCatalogItemId/);
assert.match(productionSource, /resolveProductionSuccessContinuation/);
assert.match(productionSource, /"Ilagay sa Tindahan"/);
assert.match(productionSource, /"Benta na — buksan ang Kiosk"/);
assert.doesNotMatch(
  productionSource,
  /listInventoryCatalogItemForSale/,
  "Production must not list a Product without the explicit Paninda action",
);

const productDetailSource = fs.readFileSync(
  path.join(workspace, "app/owner/product-detail.tsx"),
  "utf8",
);
assert.match(productDetailSource, /loadCatalogReadiness/);
assert.match(productDetailSource, /readiness\.readiness\.availableInKiosk/);
assert.match(productDetailSource, /label="Benta na — buksan ang Kiosk"/);

const checkoutSource = fs.readFileSync(
  path.join(workspace, "app/kiosk/checkout.tsx"),
  "utf8",
);
assert.match(checkoutSource, /label="Bagong benta"/);
assert.match(checkoutSource, /label="Owner Home \/ Kita"/);

// Defect 6 branch (a): native Recipe routes to Produce, not manual cook
const recipeActions = resolvePanindaActionPolicy(policyBase);
assert.equal(recipeActions.produceFromRecipe, true);
assert.equal(recipeActions.manualCompatibilityStockIn, false);
assert.equal(recipeActions.listForSale, true);

// Production success derives its CTA from authoritative Paninda policy and
// CatalogReadiness results for the exact produced Product.
const productionIdentity = {
  producedCatalogItemId: "catalog-finished",
  producedProductId: "product-finished",
  panindaCatalogItemId: "catalog-finished",
  panindaProductId: "product-finished",
  readinessProductId: "product-finished",
};
assert.equal(
  resolveProductionSuccessContinuation({
    ...productionIdentity,
    availableInKiosk: false,
    listForSale: true,
  }),
  "list_for_sale",
  "an unlisted produced Product continues to explicit listing",
);
assert.equal(
  resolveProductionSuccessContinuation({
    ...productionIdentity,
    availableInKiosk: true,
    listForSale: false,
  }),
  "open_kiosk",
  "a listed and eligible produced Product may continue to Kiosk",
);
assert.equal(
  resolveProductionSuccessContinuation({
    ...productionIdentity,
    availableInKiosk: true,
    listForSale: true,
  }),
  "open_paninda",
  "contradictory authoritative states fail closed",
);
assert.equal(
  resolveProductionSuccessContinuation({
    ...productionIdentity,
    readinessProductId: "different-product",
    availableInKiosk: true,
    listForSale: false,
  }),
  "open_paninda",
  "a mismatched Product binding never exposes Kiosk",
);

assert.equal(
  resolveKnownSellingPrice({ sellingPriceState: "unknown", legacyPrice: 0 }),
  null,
  "unknown selling price never presents the legacy zero scalar",
);
assert.equal(
  resolveKnownSellingPrice({ sellingPriceState: "known", legacyPrice: 120 }),
  120,
  "known positive selling price remains visible",
);

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
assert.match(recipesSource, /Mag-production mula sa Recipe/);
assert.match(
  recipesSource,
  /params:\s*\{\s*recipeId:\s*entry\.activeRecipeId/,
);

// Turn 7: a countable ingredient can be saved without inventing a zero price.
assert.match(editorSource, /label="Tantiyang presyo \(optional\)"/);
assert.match(editorSource, /sourceKind: "custom_cost"/);
assert.match(editorSource, /costState: "unknown"/);
assert.match(editorSource, /costOverride: null/);
assert.match(editorSource, /unit: estimateUsageUnit/);
assert.match(editorSource, /Presyo hindi pa inilagay/);

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
