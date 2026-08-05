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
// Archived records stay read-only with respect to stock, sales, and Recipe
// history. Restore is the single deliberate exception: archiving without an
// inverse was itself a one-way trap, and restoring mutates no history — it
// returns the item to `ready`, where listing remains a separate explicit act.
assert.deepEqual(
  Object.entries(archivedActions)
    .filter(([, allowed]) => allowed)
    .map(([key]) => key),
  ["restoreFromArchive"],
  "an archived record must offer restore and nothing else",
);

const inventorySource = fs.readFileSync(
  path.join(workspace, "app/owner/inventory.tsx"),
  "utf8",
);
for (const required of [
  /useSafeAreaInsets/,
  /useWindowDimensions/,
  /buildPanindaActionSheetLayout/,
  /buildPanindaActionDescriptors/,
  /maxHeight:\s*layout\.maxHeight/,
  /paddingBottom:\s*layout\.paddingBottom/,
  /<ScrollView[\s\S]*?sheetScrollContent/,
  /sheetScroll:\s*\{[\s\S]*?flexShrink:\s*1/,
  /onRequestClose=\{onClose\}/,
  /Needs Setup/,
  /Niluluto o hinahanda\? Buksan ang Recipe Book/,
  /catalogMode:\s*"direct_resale"/,
  /if \(entry\.stockPolicy !== "product_lots"\)[\s\S]*?editProduct\(entry\.product\)/,
  /await addDirectResalePurchase\(/,
]) {
  assert.match(inventorySource, required);
}

const actionSheetDomain = fs.readFileSync(
  path.join(workspace, "src/domain/panindaActionSheet.ts"),
  "utf8",
);
for (const required of [
  /label: "Record spoilage"/,
  /label: "Delete permanently"/,
  /label: "Archive"/,
  /type: "ScrollView"/,
  /testID: "sheet-header"/,
  /onRequestClose: true/,
]) {
  assert.match(actionSheetDomain, required);
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

// --- Listing lifecycle: publication must not be a terminal state ----------
// A published Recipe used to land in needs_setup with no action that could
// ever move it to active. These assertions pin the escape hatch open.
const publishedUnlisted = {
  ...base,
  classification: "finished_product",
  compatibilityMode: "native",
  sourceType: "native",
  readinessState: "ready",
  lifecycle: "ready",
  productActive: false,
  hasRecipe: true,
  hasPublishedRecipe: true,
  stockPolicy: "product_scalar",
};
assert.equal(
  domain.resolvePanindaSection(publishedUnlisted),
  "needs_setup",
  "a published but unlisted Recipe waits in Needs Setup",
);
const unlistedActions = domain.resolvePanindaActionPolicy(publishedUnlisted);
assert.equal(
  unlistedActions.listForSale,
  true,
  "a published unlisted item must offer the listing transition",
);
assert.equal(unlistedActions.unlistFromSale, false);
assert.equal(unlistedActions.changeSellingPrice, false);

const listedActions = domain.resolvePanindaActionPolicy({
  ...publishedUnlisted,
  lifecycle: "active",
  productActive: true,
});
assert.equal(
  listedActions.listForSale,
  false,
  "an already listed item must not offer listing again",
);
assert.equal(
  listedActions.unlistFromSale,
  true,
  "listing must be reversible",
);
assert.equal(
  listedActions.changeSellingPrice,
  true,
  "a listed Recipe-backed item must remain repriceable without the legacy edit form",
);

// An unpublished draft output is not listable: listing requires a definition.
assert.equal(
  domain.resolvePanindaActionPolicy({
    ...publishedUnlisted,
    hasPublishedRecipe: false,
    hasDraft: true,
  }).listForSale,
  false,
  "a draft-only item must not be listable",
);

// Archiving must not be a one-way trap.
const archivedRecipeActions = domain.resolvePanindaActionPolicy({
  ...publishedUnlisted,
  lifecycle: "archived",
});
assert.equal(
  archivedRecipeActions.restoreFromArchive,
  true,
  "an archived item must offer a restore path",
);
assert.equal(archivedRecipeActions.listForSale, false);

const listingRepositorySource = fs.readFileSync(
  path.join(workspace, "src/db/repositories/panindaListing.ts"),
  "utf8",
);
assert.match(
  listingRepositorySource,
  /lifecycle_status = 'active', readiness_state = 'ready',\s*\n\s*sellable = 1, kiosk_enabled = 1, selling_price_state = 'known'/,
  "listing must set every Kiosk-eligibility column together in one statement",
);
assert.match(
  listingRepositorySource,
  /if \(itemResult\.changes !== 1\)/,
  "listing must guard against concurrent modification",
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
