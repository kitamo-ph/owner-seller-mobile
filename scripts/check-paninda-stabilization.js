const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();
const domain = require("../node_modules/.cache/kitamo-paninda-check/catalogItems.js");

const base = {
  classification: "legacy_unclassified",
  lifecycle: "draft",
  readinessState: "legacy_review",
  compatibilityMode: "legacy_unclassified",
  sourceType: "legacy_product",
  bindingStatus: "active",
  stockPolicy: "product_scalar",
  productActive: false,
  hasDraft: false,
  hasRecipe: false,
  hasPublishedRecipe: false,
};

assert.equal(
  domain.resolvePanindaSection(base),
  "active",
  "unreviewed legacy Products must retain Paninda compatibility",
);
assert.equal(
  domain.resolvePanindaSection({
    ...base,
    classification: "prepared_base",
    compatibilityMode: "native",
    sourceType: "native",
    readinessState: "ready",
    lifecycle: "active",
    productActive: true,
    hasRecipe: true,
    hasPublishedRecipe: true,
    stockPolicy: "product_lots",
  }),
  "excluded",
  "prepared bases belong in Recipe Book rather than Paninda",
);
assert.equal(
  domain.resolvePanindaSection({
    ...base,
    classification: "finished_product",
    compatibilityMode: "native",
    sourceType: "native",
    readinessState: "incomplete",
    hasDraft: true,
    stockPolicy: "product_lots",
  }),
  "excluded",
  "unfinished native Recipe projections must not pollute Paninda",
);
assert.equal(
  domain.resolvePanindaSection({
    ...base,
    classification: "finished_product",
    compatibilityMode: "native",
    sourceType: "native",
    readinessState: "incomplete",
    lifecycle: "ready",
    hasPublishedRecipe: true,
    stockPolicy: "product_lots",
  }),
  "needs_setup",
  "published native finished items remain discoverable while setup is incomplete",
);
assert.equal(
  domain.resolvePanindaSection({
    ...base,
    classification: "finished_product",
    compatibilityMode: "native",
    sourceType: "native",
    readinessState: "ready",
    lifecycle: "active",
    productActive: true,
    hasRecipe: true,
    hasPublishedRecipe: true,
    stockPolicy: "product_lots",
  }),
  "active",
  "ready active finished items belong in Active Paninda",
);
assert.equal(
  domain.resolvePanindaSection({
    ...base,
    lifecycle: "archived",
    bindingStatus: "archived",
  }),
  "archived",
  "archived legacy records remain available only through Archived",
);

const recipeActions = domain.resolvePanindaActionPolicy({
  ...base,
  classification: "finished_product",
  compatibilityMode: "native",
  sourceType: "native",
  readinessState: "ready",
  lifecycle: "active",
  productActive: true,
  hasRecipe: true,
  hasPublishedRecipe: true,
  stockPolicy: "product_lots",
});
assert.equal(recipeActions.openRecipe, true);
assert.equal(recipeActions.produceFromRecipe, true);
assert.equal(recipeActions.editSellingItem, false);
assert.equal(recipeActions.manualCompatibilityStockIn, false);
assert.equal(recipeActions.recordSpoilage, false);
assert.equal(recipeActions.transferStock, false);

const resaleActions = domain.resolvePanindaActionPolicy({
  ...base,
  classification: "direct_resale_product",
  compatibilityMode: "native",
  sourceType: "native",
  readinessState: "ready",
  lifecycle: "active",
  productActive: true,
  stockPolicy: "product_lots",
});
assert.equal(resaleActions.addPurchasedStock, true);
assert.equal(resaleActions.editSellingItem, true);
assert.equal(resaleActions.openRecipe, false);
assert.equal(resaleActions.recordSpoilage, false);
assert.equal(resaleActions.requestPermanentDelete, true);

const legacyRecipeActions = domain.resolvePanindaActionPolicy({
  ...base,
  hasRecipe: true,
  hasPublishedRecipe: true,
});
assert.equal(legacyRecipeActions.openRecipe, true);
assert.equal(legacyRecipeActions.produceFromRecipe, true);
assert.equal(
  legacyRecipeActions.editSellingItem,
  true,
  "legacy Recipe Products must retain their existing selling-item edit action",
);
assert.equal(legacyRecipeActions.manualCompatibilityStockIn, true);

const legacyRetailActions = domain.resolvePanindaActionPolicy(base);
assert.equal(
  legacyRetailActions.addPurchasedStock,
  true,
  "legacy retail Products must expose the additive purchase action",
);
assert.equal(
  legacyRetailActions.editSellingItem,
  true,
  "legacy retail Products must retain selling-item edit compatibility",
);

const archivedActions = domain.resolvePanindaActionPolicy({
  ...base,
  bindingStatus: "archived",
  lifecycle: "archived",
  hasRecipe: true,
  hasPublishedRecipe: true,
});
assert.equal(
  Object.values(archivedActions).some(Boolean),
  false,
  "archived Paninda records must remain read-only",
);

const inventorySource = fs.readFileSync(
  path.join(workspace, "app/owner/inventory.tsx"),
  "utf8",
);
for (const required of [
  /useSafeAreaInsets/,
  /useWindowDimensions/,
  /maxHeight:/,
  /<ScrollView[\s\S]*?sheetScrollContent/,
  /sheetScroll:\s*\{[\s\S]*?flexShrink:\s*1/,
  /onRequestClose=\{onClose\}/,
  /Record spoilage/,
  /Delete permanently/,
  /Archive/,
  /Needs Setup/,
  /Cooking or preparing this item\? Create it in Recipe Book/,
  /catalogMode:\s*"direct_resale"/,
  /if \(entry\.stockPolicy !== "product_lots"\)[\s\S]*?editProduct\(entry\.product\)/,
  /await addDirectResalePurchase\(/,
]) {
  assert.match(inventorySource, required);
}

const productsRepositorySource = fs.readFileSync(
  path.join(workspace, "src/db/repositories/products.ts"),
  "utf8",
);
assert.match(
  productsRepositorySource,
  /catalogMode: z\.enum\(\["legacy_unclassified", "direct_resale"\]\)/,
);
assert.match(
  productsRepositorySource,
  /directResale \? "direct_resale_product" : "legacy_unclassified"/,
);
assert.match(
  productsRepositorySource,
  /directResale \? "sale_product" : "legacy_product"/,
);
assert.doesNotMatch(
  inventorySource,
  /icon="trash-outline"\s+label="(?:Nasayang|Record spoilage)"/,
  "spoilage must not use the permanent-delete icon",
);

const catalogRepositorySource = fs.readFileSync(
  path.join(workspace, "src/db/repositories/catalogItems.ts"),
  "utf8",
);
assert.match(
  catalogRepositorySource,
  /export async function listPanindaCatalogProductsForBusiness/,
);
assert.match(catalogRepositorySource, /INNER JOIN legacy_item_bindings binding/);
assert.match(catalogRepositorySource, /INNER JOIN products product/);
assert.match(catalogRepositorySource, /AS draft_id/);
assert.match(catalogRepositorySource, /AS active_version_id/);

const catalogServiceSource = fs.readFileSync(
  path.join(workspace, "src/services/catalogItems.ts"),
  "utf8",
);
assert.match(catalogServiceSource, /export async function loadPanindaCatalog/);
assert.match(catalogServiceSource, /if \(section === "excluded"\) return \[\]/);

const lifecycleRepositorySource = fs.readFileSync(
  path.join(workspace, "src/db/repositories/itemLifecycle.ts"),
  "utf8",
);
assert.match(lifecycleRepositorySource, /FROM product_transfers transfer/);
assert.match(
  lifecycleRepositorySource,
  /export async function permanentlyDeleteCatalogItem/,
);
assert.match(
  lifecycleRepositorySource,
  /withExclusiveTransactionAsync[\s\S]*?getCatalogItemReferenceCounts[\s\S]*?DELETE FROM legacy_item_bindings[\s\S]*?DELETE FROM catalog_items/,
  "permanent deletion must recheck and delete in one exclusive transaction",
);
assert.match(
  lifecycleRepositorySource,
  /UPDATE products[\s\S]*?SET active = 0/,
  "archive must deactivate an exact Product projection",
);

const { runPanindaLifecycleTransactions } = require(
  "./check-paninda-lifecycle-transactions",
);

runPanindaLifecycleTransactions()
  .then(() => {
    console.log(
      "PANINDA STABILIZATION CHECKS PASSED: catalog grouping, action policy, safe-area sheet, direct-resale boundary, archive, and fail-closed delete",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
