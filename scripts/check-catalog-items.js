/**
 * Focused Phase B checks for catalog readiness, exact legacy bindings, and
 * stock-authority/reconciliation contracts.
 */
const {
  evaluateCatalogReadiness,
  nativeCatalogDefaults,
  requiredProjectionForClassification,
  validateLegacyBindingSet,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/catalogItems.js");
const {
  knownCost,
  unknownCost,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/costState.js");
const {
  reconcileProductStock,
  resolveStockAuthority,
  validateLotBackedMutation,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/stockAuthority.js");

let failures = 0;

function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${name}: ${condition ? "OK" : `FAIL ${detail}`}`);
}

check(
  "purchased ingredient projects to Ingredient",
  requiredProjectionForClassification("purchased_ingredient") === "ingredient",
);
check(
  "prepared base projects to Product",
  requiredProjectionForClassification("prepared_base") === "product",
);
check(
  "legacy unclassified has no guessed projection",
  requiredProjectionForClassification("legacy_unclassified") === null,
);

const defaults = nativeCatalogDefaults("finished_product");
check(
  "new native item starts draft and Kiosk-disabled",
  defaults.lifecycle === "draft" &&
    defaults.readinessState === "incomplete" &&
    defaults.sellable === false &&
    defaults.kioskEnabled === false,
);
const unresolvedNativeDefaults = nativeCatalogDefaults("legacy_unclassified");
check(
  "native unresolved draft is review-required without legacy compatibility",
  unresolvedNativeDefaults.reviewRequired &&
    unresolvedNativeDefaults.compatibilityMode === "native",
);

const legacyReadiness = evaluateCatalogReadiness({
  classification: "legacy_unclassified",
  lifecycle: "draft",
  readinessState: "legacy_review",
  compatibilityMode: "legacy_unclassified",
  sourceType: "legacy_product",
  reviewRequired: true,
  sellable: false,
  kioskEnabled: false,
  branchApplicable: false,
  sellingPrice: unknownCost(0),
  hasPublishedRecipe: false,
  productionConfigurationComplete: false,
  saleConfigurationComplete: false,
  legacyVisibleUnderExistingPredicate: true,
  explicitlyBlocked: false,
});
check(
  "unreviewed imported Product keeps exact legacy visibility",
  legacyReadiness.availableInKiosk &&
    legacyReadiness.kioskPolicy === "legacy_compatibility" &&
    !legacyReadiness.readyForSale,
);
check(
  "approved explicit block hides legacy compatibility Product",
  !evaluateCatalogReadiness({
    ...{
      classification: "legacy_unclassified",
      lifecycle: "draft",
      readinessState: "legacy_review",
      compatibilityMode: "legacy_unclassified",
      sourceType: "legacy_product",
      reviewRequired: true,
      sellable: false,
      kioskEnabled: false,
      branchApplicable: false,
      sellingPrice: unknownCost(0),
      hasPublishedRecipe: false,
      productionConfigurationComplete: false,
      saleConfigurationComplete: false,
      legacyVisibleUnderExistingPredicate: true,
      explicitlyBlocked: true,
    },
  }).availableInKiosk,
);

const nativeReady = evaluateCatalogReadiness({
  classification: "finished_product",
  lifecycle: "active",
  readinessState: "ready",
  compatibilityMode: "native",
  sourceType: "native",
  reviewRequired: false,
  sellable: true,
  kioskEnabled: true,
  branchApplicable: true,
  sellingPrice: knownCost(0),
  hasPublishedRecipe: true,
  productionConfigurationComplete: true,
  saleConfigurationComplete: true,
  legacyVisibleUnderExistingPredicate: false,
  explicitlyBlocked: false,
});
check(
  "explicit known-zero price satisfies price completeness",
  nativeReady.readyForSale && nativeReady.availableInKiosk,
);
check(
  "explicit incomplete readiness blocks an otherwise configured native item",
  !evaluateCatalogReadiness({
    ...{
      classification: "finished_product",
      lifecycle: "active",
      readinessState: "incomplete",
      compatibilityMode: "native",
      sourceType: "native",
      reviewRequired: false,
      sellable: true,
      kioskEnabled: true,
      branchApplicable: true,
      sellingPrice: knownCost(50),
      hasPublishedRecipe: true,
      productionConfigurationComplete: true,
      saleConfigurationComplete: true,
      legacyVisibleUnderExistingPredicate: false,
      explicitlyBlocked: false,
    },
  }).availableInKiosk,
);

const nativeUnknownPrice = evaluateCatalogReadiness({
  ...{
    classification: "finished_product",
    lifecycle: "active",
    readinessState: "ready",
    compatibilityMode: "native",
    sourceType: "native",
    reviewRequired: false,
    sellable: true,
    kioskEnabled: true,
    branchApplicable: true,
    sellingPrice: unknownCost(),
    hasPublishedRecipe: true,
    productionConfigurationComplete: true,
    saleConfigurationComplete: true,
    legacyVisibleUnderExistingPredicate: false,
    explicitlyBlocked: false,
  },
});
check(
  "unknown selling price blocks native Kiosk readiness",
  !nativeUnknownPrice.readyForSale &&
    !nativeUnknownPrice.availableInKiosk &&
    nativeUnknownPrice.issues.includes("selling_price_unknown"),
);

const supplyReadiness = evaluateCatalogReadiness({
  classification: "supply_packaging",
  lifecycle: "active",
  readinessState: "ready",
  compatibilityMode: "native",
  sourceType: "native",
  reviewRequired: false,
  sellable: true,
  kioskEnabled: true,
  branchApplicable: true,
  sellingPrice: knownCost(10),
  hasPublishedRecipe: false,
  productionConfigurationComplete: true,
  saleConfigurationComplete: true,
  legacyVisibleUnderExistingPredicate: false,
  explicitlyBlocked: false,
});
check(
  "supply cannot become an independent native Kiosk product",
  !supplyReadiness.readyForSale && !supplyReadiness.availableInKiosk,
);

const binding = {
  catalogItemId: "catalog-1",
  entityKind: "product",
  legacyEntityId: "product-1",
  bindingStatus: "active",
  compatibilityMode: "legacy_unclassified",
  reviewState: "pending",
  migrationProvenance: "011:products",
};
check(
  "one exact binding is valid",
  validateLegacyBindingSet([binding]).ok,
);
const duplicateSource = validateLegacyBindingSet([
  binding,
  { ...binding, catalogItemId: "catalog-2" },
]);
check(
  "duplicate source binding rejected",
  !duplicateSource.ok &&
    duplicateSource.issues.some(
      (issue) => issue.reason === "duplicate_legacy_source",
    ),
);
const contradictory = validateLegacyBindingSet([
  binding,
  {
    ...binding,
    entityKind: "ingredient",
    legacyEntityId: "ingredient-1",
  },
]);
check(
  "contradictory catalog binding rejected",
  !contradictory.ok &&
    contradictory.issues.some(
      (issue) => issue.reason === "contradictory_catalog_binding",
    ),
);

check(
  "legacy Product authority remains scalar",
  resolveStockAuthority({
    classification: "legacy_unclassified",
    compatibilityMode: "legacy_unclassified",
    bindingKind: "product",
    stockTrackingEnabled: true,
  }).authority === "legacy_product_scalar",
);
check(
  "legacy Ingredient authority remains lots",
  resolveStockAuthority({
    classification: "legacy_unclassified",
    compatibilityMode: "legacy_unclassified",
    bindingKind: "ingredient",
    stockTrackingEnabled: true,
  }).authority === "ingredient_lots",
);
check(
  "native prepared output authority is Product lots plus scalar projection",
  resolveStockAuthority({
    classification: "prepared_base",
    compatibilityMode: "native",
    bindingKind: "product",
    stockTrackingEnabled: true,
  }).authority === "product_lots_with_scalar_projection",
);
check(
  "reviewed legacy finished output transitions to lot authority",
  resolveStockAuthority({
    classification: "finished_product",
    compatibilityMode: "reviewed_legacy",
    bindingKind: "product",
    stockTrackingEnabled: true,
  }).authority === "product_lots_with_scalar_projection",
);
check(
  "native direct-resale Product uses purchase lots",
  resolveStockAuthority({
    classification: "direct_resale_product",
    compatibilityMode: "native",
    bindingKind: "product",
    stockTrackingEnabled: true,
  }).authority === "product_lots_with_scalar_projection",
);
check(
  "tracked supply authority is Ingredient lots",
  resolveStockAuthority({
    classification: "supply_packaging",
    compatibilityMode: "native",
    bindingKind: "ingredient",
    stockTrackingEnabled: true,
  }).authority === "ingredient_lots",
);
check(
  "untracked supply has no fabricated stock authority",
  resolveStockAuthority({
    classification: "supply_packaging",
    compatibilityMode: "native",
    bindingKind: "ingredient",
    stockTrackingEnabled: false,
  }).authority === "none",
);

const balanced = reconcileProductStock(5, [
  { lotId: "a", remainingQuantity: 2, status: "active" },
  { lotId: "b", remainingQuantity: 3, status: "active" },
]);
check("scalar/lot agreement reconciles", balanced.status === "balanced");
const drift = reconcileProductStock(6, [
  { lotId: "a", remainingQuantity: 2, status: "active" },
  { lotId: "b", remainingQuantity: 3, status: "active" },
]);
check(
  "drift is reported and blocks allocation without correction",
  drift.status === "drift" && !drift.canAllocate && drift.difference === 1,
);

const validMutation = validateLotBackedMutation({
  beforeScalarQuantity: 5,
  afterScalarQuantity: 3,
  beforeLots: [
    { lotId: "a", remainingQuantity: 2, status: "active" },
    { lotId: "b", remainingQuantity: 3, status: "active" },
  ],
  afterLots: [
    { lotId: "a", remainingQuantity: 0, status: "depleted" },
    { lotId: "b", remainingQuantity: 3, status: "active" },
  ],
  movementQuantity: -2,
});
check("one-transaction projection mutation accepted", validMutation.ok);
const partialProjection = validateLotBackedMutation({
  beforeScalarQuantity: 5,
  afterScalarQuantity: 5,
  beforeLots: [
    { lotId: "a", remainingQuantity: 2, status: "active" },
    { lotId: "b", remainingQuantity: 3, status: "active" },
  ],
  afterLots: [
    { lotId: "a", remainingQuantity: 0, status: "depleted" },
    { lotId: "b", remainingQuantity: 3, status: "active" },
  ],
  movementQuantity: -2,
});
check(
  "lot-only partial projection update rejected",
  !partialProjection.ok,
);

if (failures === 0) {
  console.log("ALL CATALOG AND STOCK AUTHORITY CHECKS PASSED");
  process.exit(0);
}
console.error(`${failures} CATALOG AND STOCK AUTHORITY CHECKS FAILED`);
process.exit(1);
