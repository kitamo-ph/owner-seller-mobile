const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(workspace, relativePath), "utf8");
}

function assertOrdered(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${message}: missing ${first}`);
  assert.notEqual(secondIndex, -1, `${message}: missing ${second}`);
  assert.ok(firstIndex < secondIndex, message);
}

const recipeService = read("src/services/recipeFirst.ts");
assert.match(recipeService, /export type RecipeFirstResolvedLine = \{/);
assert.match(recipeService, /resolvedLines: RecipeFirstResolvedLine\[\]/);
assert.match(recipeService, /async function resolveRecipeFirstLines/);
assert.match(recipeService, /Ingredient information unavailable/);
assert.match(recipeService, /export async function loadRecipeIngredientPicker/);
assert.match(recipeService, /mapLibraryEntryToPickerEntry/);
const pickerDomain = read("src/domain/recipeIngredientPickerView.ts");
for (const group of ["purchased", "prepared", "estimated", "drafts", "legacy"]) {
  assert.match(
    pickerDomain,
    new RegExp(`"${group}"`),
    `the unified Recipe picker must retain its ${group} group`,
  );
}
assertOrdered(
  pickerDomain.slice(pickerDomain.indexOf("export function mapLibraryEntryToPickerEntry")),
  "if (entry.activeVersionId)",
  'entry.activeCostSource === "owner_estimate"',
  "a published Recipe version must take precedence over a retained estimate",
);
assert.match(
  recipeService,
  /export async function reconcileRemovedRecipeLineSource/,
);
assert.match(recipeService, /deleteRecipeFirstItem/);
assert.match(recipeService, /UPDATE recipe_drafts[\s\S]*?parent_draft_id = NULL/);
const archiveRecipeSlice = recipeService.slice(
  recipeService.indexOf("export async function archiveRecipeFirstItem"),
  recipeService.indexOf("export type DeleteRecipeFirstItemInput"),
);
assert.match(
  archiveRecipeSlice,
  /SELECT business_id[\s\S]*?archiveCatalogItem\(input\.catalogItemId, input\.ownerAuthorized, db\)/,
  "Recipe-first archive must retain business ownership validation and delegate lifecycle mutation",
);
assert.doesNotMatch(
  archiveRecipeSlice,
  /UPDATE catalog_items/,
  "Recipe-first archive must not maintain a second catalog archive transaction",
);

const quickEstimateSlice = recipeService.slice(
  recipeService.indexOf("export async function addQuickEstimatedPreparedInput"),
  recipeService.indexOf("export type BeginNestedPreparedRecipeDraftInput"),
);
assert.match(
  recipeService,
  /parentLineId = input\.parentLineId[\s\S]*?UPDATE recipe_draft_lines[\s\S]*?WHERE id = \? AND recipe_draft_id = \? AND business_id = \?/,
  "estimate edits must update the existing parent line under its draft/business guard",
);
assert.match(
  recipeService,
  /line\.is_optional AS usage_optional[\s\S]*?row\.usage_optional !== \(input\.isOptional \? 1 : 0\)/,
  "quick-estimate replay validation must preserve Required/Optional status",
);
assert.match(
  quickEstimateSlice,
  /deleteRecipeFirstItemInTransaction\([\s\S]*?retainWhenProtected: true/,
  "replaced owner estimates must be reconciled inside the coordinated transaction",
);
assert.match(
  quickEstimateSlice,
  /child_draft_id = NULL[\s\S]*?parent_draft_id = NULL, parent_line_id = NULL/,
  "replacing a nested draft must detach its return context after the line update",
);

const deleteRecipeSlice = recipeService.slice(
  recipeService.indexOf("async function deleteRecipeFirstItemInTransaction"),
  recipeService.indexOf("export async function deleteRecipeFirstItem"),
);
assert.match(deleteRecipeSlice, /ownedProfiles\.length \+ ownedConversions\.length/);
assert.match(deleteRecipeSlice, /conversionReferences\?\.count !== 0/);
assert.match(deleteRecipeSlice, /DELETE FROM item_unit_conversions/);
assert.match(
  deleteRecipeSlice,
  /source_kind !== "owner_estimate"[\s\S]*?source_recipe_version_id !== null/,
  "permanent estimate cleanup must reject non-estimate or version-derived evidence",
);
assert.match(recipeService, /LEFT JOIN recipe_version_cost_summaries summary/);
assert.match(recipeService, /summary\.status AS cost_summary_status/);
for (const status of ["actual", "estimated", "no_price", "incomplete"]) {
  assert.match(
    recipeService,
    new RegExp(`cost_summary_status === "${status}"`),
    `pinned child version must map exact ${status} summary status`,
  );
}

const editor = read("app/owner/recipe-editor.tsx");
assert.match(editor, /function replaceOrAppendLine\(/);
assert.match(editor, /id: editingLineId \?\? makeRecipeDraftLineId\(\)/);
assert.match(editor, /id: existing\.id,[\s\S]*?sortOrder: existing\.sortOrder/);
assert.match(editor, /expectedRevision: base\.draft\.autosaveRevision/);
assert.match(editor, /label="Edit"/);
assert.match(editor, /label="Replace source"/);
assert.match(editor, /accessibilityLabel=\{`Remove /);
assert.match(editor, /resolved=\{resolvedLineFor\(snapshot, line\.id\)\}/);
assert.ok(
  (editor.match(/resolved=\{resolvedLineFor\(snapshot, line\.id\)\}/g) ?? [])
    .length >= 2,
  "Step 2 and Step 3 must share the resolved ingredient presentation",
);
assert.match(editor, /presentRecipeLineIdentity\(/);
assert.match(editor, /buildRecipeIngredientPickerViewModel\(/);
assert.match(editor, /preparedPickerEmptyState/);
assert.match(editor, /setStep\(2\);[\s\S]*?editLine\(line\);/);
assert.match(editor, /lineRole/);
assert.match(editor, /label="Ingredient status"/);
assert.match(editor, /const LINE_REQUIREMENTS = \["Required", "Optional"\]/);
assert.match(editor, /isOptional: lineRequirement === "Optional"/);
assert.match(editor, /conversionChainJson/);
assert.match(editor, /unitStandardSnapshot/);
assert.match(editor, /Custom business cup/);
assert.match(editor, /requireCompleteCost: false/);
assert.match(editor, /publishedItemId: published\.version\.outputCatalogItemId/);
assert.match(editor, /group,[\s\S]*?pathname: "\/owner\/recipes"|pathname: "\/owner\/recipes"[\s\S]*?group,/);
assert.doesNotMatch(editor, /Advanced details/);
assert.match(editor, /label="How is this cost measured\?"/);
for (const measurement of [
  "Price per amount",
  "Package breakdown",
  "Prepared batch recipe",
  "Custom conversion",
]) {
  assert.match(editor, new RegExp(`"${measurement}"`));
}
assert.match(editor, /label="From quantity"/);
assert.match(editor, /label="To quantity"/);
assert.match(editor, /label="Conversion meaning"/);
assert.match(editor, /standard: "item_specific"/);
assert.match(editor, /never infers a universal mass-to-volume/);
assert.match(editor, /if \(!usageToPurchaseFactor\) return standard/);
assert.match(
  editor,
  /\(input\.purchaseCost \/ input\.purchasedQuantity\) \* usageToPurchaseFactor/,
  "a validated item-specific factor must drive the live cost even when a standard preview exists",
);
assert.match(editor, /setEstimateNotes\(line\.notes \?\? ""\)/);
assert.match(editor, /originalConversionEvidence\.inputSignature === signature/);
assert.match(editor, /conversionChainJson:\s*originalConversionEvidence\.conversionChainJson/);
assert.match(editor, /Save Pinned Version Usage/);
assert.match(editor, /pinned version preserved/);
const pinnedEditSlice = editor.slice(
  editor.indexOf("if (pinnedPrepared && quantity !== null)"),
  editor.indexOf("if (\n      !entry ||", editor.indexOf("if (pinnedPrepared && quantity !== null)")),
);
assert.match(pinnedEditSlice, /const updated: DraftLine = \{[\s\S]*?\.\.\.existing/);
assert.doesNotMatch(
  pinnedEditSlice,
  /childRecipeVersionId:\s*entry\.activeVersionId/,
  "editing a pinned historical version must not silently switch to the active version",
);
assert.match(editor, /Save Parent Usage/);
assert.match(editor, /Continue Prepared Recipe/);
assert.match(editor, /replaceOrAppendLine\(base\.lines, placeholder, editingLineId\)/);
assert.match(editor, /label="Open Ingredient in Grocery"/);
assert.match(editor, /lotId: selectedLot\.id/);
assert.match(editor, /ingredientId: selectedLot\.ingredientId/);
assert.match(editor, /<KeyboardAvoidingView/);
assert.match(editor, /onRequestClose=\{props\.onClose\}/);
assert.match(editor, /maxHeight: "92%"/);
assert.match(editor, /keyboardShouldPersistTaps="handled"/);
const ingredientModalSlice = editor.slice(editor.indexOf("function IngredientModal"));
assertOrdered(
  ingredientModalSlice,
  "styles.modalHeader",
  "<ScrollView",
  "the ingredient header and close action must remain fixed above scrollable form content",
);
assert.match(editor, /usablePortions/);
assert.match(editor, /approximately \$\{formatPeso\(costPerPortion\)\}/);

const editorUi = read("src/components/owner/RecipeFirstEditorUI.tsx");
for (const label of [
  "Metric cup — 250 mL",
  "US cup — approximately 236.588 mL",
  "Custom business cup",
  "US gallon — approximately 3,785.412 mL",
  "Imperial gallon — 4,546.09 mL",
]) {
  assert.match(editorUi, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}
assert.match(editorUi, /RECIPE_CHOICE_LABELS\[option\] \?\? option\.replaceAll/);

const recipeLibrary = read("app/owner/recipes.tsx");
assertOrdered(
  recipeLibrary.slice(recipeLibrary.indexOf("function sectionKey")),
  'entry.classification === "prepared_base"',
  "if (entry.activeVersionId)",
  "Recipe Library grouping must remain classification-first",
);
assert.match(recipeLibrary, /prepared: "Tinimplang Recipe"/);
assert.match(recipeLibrary, /selling: "Handang ibenta"/);
assert.match(recipeLibrary, /recipes: "May kailangang suriin"/);
assertOrdered(
  recipeLibrary.slice(recipeLibrary.indexOf("const order: RecipeLibraryGroup[]")),
  '"selling"',
  '"prepared"',
  '"drafts"',
  "Finished/Prepared/Drafts must lead the Recipe Book",
);
assert.match(recipeLibrary, /setSearch\(""\)/);
assert.match(recipeLibrary, /setCostFilter\("all"\)/);
assert.match(recipeLibrary, /setSnackbar\("Recipe ready/);
assert.match(recipeLibrary, /highlighted=\{entry\.catalogItemId === publishedItemId\}/);

const libraryFilters = read("src/components/owner/RecipeLibraryFilters.tsx");
assert.match(libraryFilters, /label: "Handa ibenta"/);
assert.match(libraryFilters, /label: "Tinimpla"/);
assert.match(libraryFilters, /label: "May kulang"/);

const recipeCard = read("src/components/owner/RecipeLibraryCard.tsx");
assert.match(recipeCard, /Handa na ang Recipe/);

const versioningService = read("src/services/recipeVersioning.ts");
assert.match(
  versioningService,
  /allocationMode: evidence\?\.allocationMode \?\? "none"/,
);
assert.match(
  versioningService,
  /legacyIngredientLotId: evidence\?\.legacyIngredientLotId \?\? null/,
);
assert.match(
  versioningService,
  /conversionChainJson: evidence\?\.conversionChainJson \?\? null/,
);

const draftRepository = read("src/db/repositories/recipeDrafts.ts");
const versionRepository = read("src/db/repositories/recipeVersions.ts");
for (const source of [draftRepository, versionRepository]) {
  assert.match(source, /conversion_chain_json/);
  assert.match(source, /unit_standard_snapshot/);
  assert.match(source, /validateRecipeConversionSnapshotEvidence/);
  assert.match(source, /conversionFactorSnapshot/);
  assert.match(source, /unitStandardSnapshot/);
}

console.log(
  "RECIPE STABILIZATION SOURCE-CONTRACT GUARDS PASSED: deliberate accessibility labels, required user-facing copy, prohibited unsafe labels, safe-area/modal structure contracts, and no claim of rendered scrolling or interaction behavior",
);
