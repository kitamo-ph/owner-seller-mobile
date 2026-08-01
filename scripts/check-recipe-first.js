/**
 * Focused checks for Recipe-first creation, costing, library, and lifecycle.
 *
 * Compile first:
 * tsc src/domain/recipeFirst.ts --outDir node_modules/.cache/kitamo-recipe-first-check --module commonjs --target es2020 --strict --skipLibCheck
 */

"use strict";

const {
  RECIPE_DELETE_REFERENCE_KINDS,
  RECIPE_FIRST_COST_SOURCES,
  calculatePreparedBatchCost,
  calculateSimpleIngredientCost,
  convertRecipeQuantity,
  decideRecipeArchive,
  decideRecipeDuplicate,
  decideRecipeEdit,
  decideRecipeSafeDelete,
  describeRecipeCreationMode,
  filterRecipeLibraryItems,
  groupRecipeLibraryItems,
  recipeLibraryReadiness,
  summarizeRecipeCosts,
} = require("../node_modules/.cache/kitamo-recipe-first-check/recipeFirst.js");

let failures = 0;

function check(name, condition, details = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${name}: ${ok ? "OK" : "FAIL"}${details ? ` (${details})` : ""}`);
}

function closeTo(actual, expected, tolerance = 1e-9) {
  return Math.abs(actual - expected) <= tolerance;
}

function component(id, cost, extra = {}) {
  return {
    id,
    source: cost.source,
    state: cost.state,
    amount: cost.amount,
    ...extra,
  };
}

const perUnit = describeRecipeCreationMode("finished_per_unit");
const prepared = describeRecipeCreationMode("prepared_batch");
const unsure = describeRecipeCreationMode("unsure");
check(
  "finished creation uses plain language and internal one-piece output",
  perUnit.label === "Finished product sold per piece or serving" &&
    perUnit.classification === "finished_product" &&
    perUnit.internalOutput?.quantity === 1 &&
    perUnit.internalOutput?.unit === "pcs" &&
    perUnit.yieldEntry === "internal_per_unit",
);
check(
  "prepared creation asks for yield only after ingredients",
  prepared.label === "Prepared ingredient or base" &&
    prepared.classification === "prepared_base" &&
    prepared.internalOutput === null &&
    prepared.yieldEntry === "after_ingredients",
);
check(
  "unsure creation preserves classification and yield as unresolved",
  unsure.label === "I am not sure yet" &&
    unsure.classification === null &&
    unsure.internalOutput === null &&
    unsure.yieldEntry === "deferred",
);

const kilogramsToGrams = convertRecipeQuantity(1.25, "kg", "g");
const litersToMilliliters = convertRecipeQuantity(0.5, "L", "mL");
check(
  "mass conversion supports kilograms and grams",
  kilogramsToGrams.ok && kilogramsToGrams.quantity === 1_250,
);
check(
  "volume conversion supports liters and milliliters",
  litersToMilliliters.ok && litersToMilliliters.quantity === 500,
);
check(
  "incompatible unit dimensions fail explicitly",
  !convertRecipeQuantity(1, "kg", "ml").ok,
);

const sausage = calculateSimpleIngredientCost({
  costSource: "purchase_lot",
  purchaseCost: 250,
  purchasedQuantity: 1,
  purchaseUnit: "pack",
  piecesPerPack: 18,
  portionsPerPiece: 4,
  usageQuantity: 1,
  usageUnit: "portion",
});
check(
  "sausage pack and portions calculate 250 divided by 18 times 4",
  sausage.state === "actual" &&
    sausage.availableUsageQuantity === 72 &&
    sausage.amount !== null &&
    closeTo(sausage.amount, 250 / (18 * 4)),
);

const mayonnaise = calculateSimpleIngredientCost({
  costSource: "purchase_lot",
  purchaseCost: 300,
  purchasedQuantity: 500,
  purchaseUnit: "ml",
  usageQuantity: 5,
  usageUnit: "ml",
});
check(
  "mayonnaise usage calculates 300 divided by 500 times 5",
  mayonnaise.state === "actual" &&
    mayonnaise.amount !== null &&
    closeTo(mayonnaise.amount, (300 / 500) * 5),
);

const sushiRiceEstimate = calculateSimpleIngredientCost({
  costSource: "owner_estimate",
  purchaseCost: 80,
  purchasedQuantity: 1,
  purchaseUnit: "kg",
  usageQuantity: 27,
  usageUnit: "g",
});
check(
  "temporary Sushi Rice calculates 80 per kilogram times 27 grams",
  sushiRiceEstimate.state === "estimated" &&
    sushiRiceEstimate.amount !== null &&
    closeTo(sushiRiceEstimate.amount, 2.16),
);

check(
  "all explicit cost-source identities remain available",
  [
    "purchase_lot",
    "prepared_recipe",
    "owner_estimate",
    "custom",
    "unknown",
    "legacy_snapshot",
  ].every((source) => RECIPE_FIRST_COST_SOURCES.includes(source)),
);

const repeated = summarizeRecipeCosts([
  component("mayonnaise", mayonnaise),
  component("mayonnaise", mayonnaise),
  component("sausage", sausage),
]);
check(
  "repeated ingredient lines are summed without deduplication",
  repeated.totalCost !== null &&
    closeTo(repeated.totalCost, mayonnaise.amount * 2 + sausage.amount) &&
    repeated.state === "actual",
);

const unknown = calculateSimpleIngredientCost({
  costSource: "unknown",
  purchaseCost: null,
  purchasedQuantity: 1,
  purchaseUnit: "kg",
  usageQuantity: 27,
  usageUnit: "g",
});
const unknownSummary = summarizeRecipeCosts([
  component("sausage", sausage),
  component("unknown-rice", unknown),
]);
check(
  "unknown ingredient cost propagates without becoming zero",
  unknown.state === "no_price" &&
    unknown.amount === null &&
    unknownSummary.state === "incomplete" &&
    unknownSummary.totalCost === null &&
    unknownSummary.knownSubtotal === sausage.amount,
);

const knownZero = calculateSimpleIngredientCost({
  costSource: "purchase_lot",
  purchaseCost: 0,
  purchasedQuantity: 1,
  purchaseUnit: "kg",
  usageQuantity: 10,
  usageUnit: "g",
});
const zeroSummary = summarizeRecipeCosts([component("free-sample", knownZero)]);
check(
  "known zero remains explicit actual cost",
  knownZero.state === "actual" &&
    knownZero.amount === 0 &&
    zeroSummary.totalCost === 0 &&
    zeroSummary.state === "actual",
);

const noSellingPrice = summarizeRecipeCosts([
  component("sausage", sausage),
  component("rice", sushiRiceEstimate),
]);
const withSellingPrice = summarizeRecipeCosts(
  [
    component("sausage", sausage),
    component("rice", sushiRiceEstimate),
  ],
  25,
);
check(
  "selling price is optional",
  noSellingPrice.sellingPriceState === "not_set" &&
    noSellingPrice.grossProfit === null &&
    noSellingPrice.totalCost !== null,
);
check(
  "gross profit appears only when selling price and cost are known",
  withSellingPrice.sellingPriceState === "known" &&
    withSellingPrice.grossProfit !== null &&
    closeTo(
      withSellingPrice.grossProfit,
      25 - sausage.amount - sushiRiceEstimate.amount,
    ),
);

const batchLines = [
  component(
    "rice",
    calculateSimpleIngredientCost({
      costSource: "purchase_lot",
      purchaseCost: 60,
      purchasedQuantity: 1,
      purchaseUnit: "kg",
      usageQuantity: 750,
      usageUnit: "g",
    }),
    { inputQuantity: 750, inputUnit: "g" },
  ),
  component(
    "seasoning",
    calculateSimpleIngredientCost({
      costSource: "owner_estimate",
      purchaseCost: 25,
      purchasedQuantity: 250,
      purchaseUnit: "g",
      usageQuantity: 50,
      usageUnit: "g",
    }),
    { inputQuantity: 50, inputUnit: "g" },
  ),
];
const deferredBatch = calculatePreparedBatchCost({
  lines: batchLines,
  expectedYieldQuantity: null,
  expectedYieldUnit: null,
});
check(
  "prepared batch can defer expected yield after ingredients are entered",
  deferredBatch.yieldState === "deferred" &&
    deferredBatch.totalBatchCost !== null &&
    deferredBatch.costPerGram === null &&
    !deferredBatch.readyForProduction,
);

const completedBatch = calculatePreparedBatchCost({
  lines: batchLines,
  expectedYieldQuantity: 1,
  expectedYieldUnit: "kg",
});
check(
  "prepared batch reports total and cost per gram and kilogram",
  completedBatch.yieldState === "ready" &&
    closeTo(completedBatch.totalBatchCost, 50) &&
    closeTo(completedBatch.costPerGram, 0.05) &&
    closeTo(completedBatch.costPerKilogram, 50),
);
check(
  "prepared batch reports output-to-input yield ratio",
  completedBatch.yieldRatio !== null &&
    closeTo(completedBatch.yieldRatio, 1_000 / 800),
);

const incompleteBatch = calculatePreparedBatchCost({
  lines: [
    ...batchLines,
    component("unpriced-salt", unknown, {
      inputQuantity: 5,
      inputUnit: "g",
    }),
  ],
  expectedYieldQuantity: 1,
  expectedYieldUnit: "kg",
});
check(
  "missing ingredient price keeps prepared batch cost incomplete",
  incompleteBatch.cost.state === "incomplete" &&
    incompleteBatch.totalBatchCost === null &&
    incompleteBatch.costPerGram === null &&
    !incompleteBatch.readyForProduction,
);

const library = [
  {
    id: "sausage-sushi",
    name: "Sausage Sushi",
    category: "Sushi",
    classification: "finished_recipe",
    lifecycle: "active",
    costState: "actual",
    sellingPrice: 25,
    readyForProduction: true,
    readyForKiosk: true,
    usesEstimatedPreparedIngredient: false,
    missingRequiredInformation: false,
  },
  {
    id: "sushi-rice",
    name: "Sushi Rice",
    category: "Rice",
    classification: "prepared_base",
    lifecycle: "draft",
    costState: "estimated",
    sellingPrice: null,
    readyForProduction: false,
    readyForKiosk: false,
    usesEstimatedPreparedIngredient: false,
    missingRequiredInformation: true,
  },
  {
    id: "raw-rice",
    name: "Raw Rice",
    category: "Dry goods",
    classification: "ingredient",
    lifecycle: "active",
    costState: "no_price",
    sellingPrice: null,
    readyForProduction: false,
    readyForKiosk: false,
    usesEstimatedPreparedIngredient: false,
    missingRequiredInformation: false,
  },
  {
    id: "coke",
    name: "Coke",
    category: "Drinks",
    classification: "resale_product",
    lifecycle: "active",
    costState: "actual",
    sellingPrice: 20,
    readyForProduction: false,
    readyForKiosk: true,
    usesEstimatedPreparedIngredient: false,
    missingRequiredInformation: false,
  },
  {
    id: "archived-roll",
    name: "Old Tuna Roll",
    category: "Sushi",
    classification: "finished_recipe",
    lifecycle: "archived",
    costState: "actual",
    sellingPrice: 30,
    readyForProduction: false,
    readyForKiosk: false,
    usesEstimatedPreparedIngredient: false,
    missingRequiredInformation: false,
  },
  {
    id: "unfinished-sauce",
    name: "Unfinished Sauce",
    category: "Sauce",
    classification: "prepared_base",
    lifecycle: "active",
    costState: "incomplete",
    sellingPrice: null,
    readyForProduction: false,
    readyForKiosk: false,
    usesEstimatedPreparedIngredient: true,
    missingRequiredInformation: true,
  },
];

const grouped = groupRecipeLibraryItems(library);
check(
  "library groups recipes, prepared bases, ingredients, selling items, and resale",
  grouped.recipes.map((item) => item.id).includes("sausage-sushi") &&
    grouped.prepared_bases.map((item) => item.id).includes("sushi-rice") &&
    grouped.ingredients.map((item) => item.id).includes("raw-rice") &&
    grouped.selling_items.map((item) => item.id).includes("coke") &&
    grouped.resale_products.length === 1,
);
check(
  "draft and archive groups are explicit and archive stays out of All",
  grouped.drafts.length === 1 &&
    grouped.archived.length === 1 &&
    !grouped.all.map((item) => item.id).includes("archived-roll"),
);
check(
  "library search matches name or category without case sensitivity",
  filterRecipeLibraryItems(library, { query: "sUsHi" }).length === 3,
);
check(
  "library cost filters distinguish all four display states",
  filterRecipeLibraryItems(library, { costState: "actual" }).length === 3 &&
    filterRecipeLibraryItems(library, { costState: "estimated" }).length === 1 &&
    filterRecipeLibraryItems(library, { costState: "no_price" }).length === 1 &&
    filterRecipeLibraryItems(library, { costState: "incomplete" }).length === 1,
);
check(
  "library group filters select drafts and archived records",
  filterRecipeLibraryItems(library, { group: "drafts" })[0]?.id ===
    "sushi-rice" &&
    filterRecipeLibraryItems(library, { group: "archived" })[0]?.id ===
      "archived-roll",
);
check(
  "readiness filtering and text indicators do not depend on color",
  filterRecipeLibraryItems(library, { readiness: "kiosk_ready" }).length === 2 &&
    filterRecipeLibraryItems(library, { readiness: "needs_attention" })
      .length === 3 &&
    recipeLibraryReadiness(library[1]).labels.includes("Draft") &&
    recipeLibraryReadiness(library[5]).labels.includes(
      "Missing required information",
    ),
);

check(
  "unused draft edits in place",
  decideRecipeEdit({
    lifecycle: "draft",
    hasPublishedVersion: false,
    historicalUseCount: 0,
  }).action === "edit_draft",
);
check(
  "used recipe editing creates an immutable next version",
  decideRecipeEdit({
    lifecycle: "active",
    hasPublishedVersion: true,
    historicalUseCount: 4,
  }).action === "create_new_version",
);
check(
  "duplicate creates a new family draft without changing source",
  decideRecipeDuplicate({ lifecycle: "active" }).action ===
    "create_new_family_draft" &&
    decideRecipeDuplicate({ lifecycle: "active" }).sourceRemainsUnchanged,
);
check(
  "archive preserves history and repeated archive is idempotent",
  decideRecipeArchive("active").action === "archive" &&
    decideRecipeArchive("archived").action === "no_change",
);

const zeroReferences = Object.fromEntries(
  RECIPE_DELETE_REFERENCE_KINDS.map((kind) => [kind, 0]),
);
check(
  "unused draft with complete zero-reference evidence can be deleted",
  decideRecipeSafeDelete({
    ownerAuthorized: true,
    lifecycle: "draft",
    hasPublishedVersion: false,
    referenceCounts: zeroReferences,
  }).action === "delete",
);
check(
  "referenced recipe must archive instead of deleting history",
  decideRecipeSafeDelete({
    ownerAuthorized: true,
    lifecycle: "active",
    hasPublishedVersion: true,
    referenceCounts: { ...zeroReferences, production: 1 },
  }).action === "archive",
);
check(
  "incomplete reference audit blocks permanent delete fail-closed",
  decideRecipeSafeDelete({
    ownerAuthorized: true,
    lifecycle: "draft",
    hasPublishedVersion: false,
    referenceCounts: { ...zeroReferences, sale: null },
  }).action === "blocked",
);

if (failures > 0) {
  console.error(`${failures} Recipe-first check(s) failed.`);
  process.exit(1);
}

console.log("ALL RECIPE-FIRST CHECKS PASSED");
