const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();
const outDir = path.join(
  workspace,
  "node_modules/.cache/kitamo-recipe-ingredient-picker-behavior",
);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  path.join(workspace, "node_modules/.bin/tsc"),
  [
    "src/domain/recipeIngredientPickerView.ts",
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
  mapLibraryEntryToPickerEntry,
  buildRecipeIngredientPickerViewModel,
  buildRecipeIngredientPickerTree,
  findPickerNodes,
  RECIPE_INGREDIENT_PICKER_GROUPS,
} = require(path.join(outDir, "recipeIngredientPickerView.js"));

function seed(overrides) {
  return {
    catalogItemId: "catalog-default",
    name: "Default",
    sourceType: "native",
    classification: "prepared_base",
    lifecycle: "active",
    ingredientId: null,
    draftId: null,
    activeVersionId: null,
    activeVersionOutputQuantity: null,
    activeVersionOutputUnit: null,
    activeVersionCostStatus: null,
    activeCostProfileId: null,
    activeCostSource: null,
    activeCostTotal: null,
    activeCostReferenceQuantity: null,
    activeCostReferenceUnit: null,
    ...overrides,
  };
}

const fixtures = [
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-seasoning",
      name: "Sushi Seasoning",
      classification: "prepared_base",
      activeVersionId: "version-seasoning",
      activeVersionOutputQuantity: 400,
      activeVersionOutputUnit: "ml",
      activeVersionCostStatus: "actual",
      activeCostSource: "recipe_version",
      activeCostProfileId: "profile-seasoning",
      activeCostTotal: 20,
      activeCostReferenceQuantity: 400,
      activeCostReferenceUnit: "ml",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-rice-estimate",
      name: "Sushi Rice",
      classification: "prepared_base",
      activeCostSource: "owner_estimate",
      activeCostProfileId: "profile-rice-estimate",
      activeCostTotal: 80,
      activeCostReferenceQuantity: 1,
      activeCostReferenceUnit: "kg",
      activeVersionCostStatus: "estimated",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-incomplete",
      name: "Incomplete Sauce",
      classification: "prepared_base",
      activeVersionId: "version-incomplete",
      activeVersionOutputQuantity: 1,
      activeVersionOutputUnit: "l",
      activeVersionCostStatus: "incomplete",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-draft",
      name: "Cooked Rice Draft",
      classification: "prepared_base",
      draftId: "draft-cooked-rice",
      lifecycle: "draft",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-apple",
      name: "Apple Cider",
      classification: "purchased_ingredient",
      ingredientId: "ingredient-apple",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-legacy",
      name: "Legacy Soy",
      sourceType: "legacy_product",
      classification: "legacy_unclassified",
      activeVersionId: "legacy-version",
      activeVersionOutputQuantity: 1,
      activeVersionOutputUnit: "pcs",
      activeVersionCostStatus: "actual",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-archived",
      name: "Archived Base",
      lifecycle: "archived",
      activeVersionId: "version-archived",
      activeVersionOutputUnit: "kg",
    }),
  ),
  mapLibraryEntryToPickerEntry(
    seed({
      catalogItemId: "catalog-invalid",
      name: "Broken Output",
      activeVersionId: "version-broken",
      activeVersionOutputQuantity: 1,
      activeVersionOutputUnit: null,
    }),
  ),
].filter(Boolean);

assert.equal(
  fixtures.some((entry) => entry.name === "Archived Base"),
  false,
  "archived items must not enter the picker library",
);

const model = buildRecipeIngredientPickerViewModel({
  libraryEntries: fixtures,
  query: "",
});
assert.deepEqual(
  model.groups.map((group) => group.label),
  RECIPE_INGREDIENT_PICKER_GROUPS.map(([, label]) => label).filter((label) =>
    model.groups.some((group) => group.label === label),
  ),
);
assert.ok(model.groups.some((group) => group.group === "prepared"));
assert.ok(model.groups.some((group) => group.group === "estimated"));
assert.ok(model.groups.some((group) => group.group === "drafts"));
assert.ok(model.groups.some((group) => group.group === "purchased"));
assert.ok(model.groups.some((group) => group.group === "legacy"));

const tree = buildRecipeIngredientPickerTree(model);
const estimate = findPickerNodes(
  tree,
  (node) => node.props.name === "Sushi Rice",
)[0];
assert.ok(estimate, "estimates must remain visible");
assert.equal(estimate.props.action, "select_estimate");
assert.equal(estimate.props.selectable, true);

const incomplete = findPickerNodes(
  tree,
  (node) => node.props.name === "Incomplete Sauce",
)[0];
assert.ok(incomplete, "incomplete-cost prepared items must remain visible");
assert.equal(incomplete.props.selectable, true);

const draft = findPickerNodes(
  tree,
  (node) => node.props.name === "Cooked Rice Draft",
)[0];
assert.equal(draft.props.continueLabel, "Continue Recipe");
assert.equal(draft.props.selectable, false);

const disabled = findPickerNodes(
  tree,
  (node) => node.props.name === "Broken Output",
)[0];
assert.equal(disabled.props.selectable, false);
assert.match(String(disabled.props.disabledReason), /no usable output/i);

const searchModel = buildRecipeIngredientPickerViewModel({
  libraryEntries: fixtures,
  query: "Sushi Rice",
});
assert.equal(searchModel.groups.flatMap((group) => group.entries).length, 1);
assert.equal(
  searchModel.groups.flatMap((group) => group.entries)[0].name,
  "Sushi Rice",
);

const noMatch = buildRecipeIngredientPickerViewModel({
  libraryEntries: fixtures,
  query: "zzzz-missing",
});
assert.equal(noMatch.emptyState?.kind, "search_empty");

const emptyLibrary = buildRecipeIngredientPickerViewModel({
  libraryEntries: [],
  query: "",
});
assert.equal(emptyLibrary.emptyState?.kind, "library_empty");
assert.notEqual(
  emptyLibrary.emptyState?.title,
  noMatch.emptyState?.title,
  "empty library and filtered no-match must use different empty states",
);

const selected = fixtures.find((entry) => entry.name === "Sushi Seasoning");
assert.equal(selected.action, "select_version");
assert.equal(selected.selectable, true);
const estimated = fixtures.find((entry) => entry.name === "Sushi Rice");
assert.equal(estimated.action, "select_estimate");

for (const entry of findPickerNodes(tree, (node) => node.type === "Entry")) {
  assert.equal(entry.props.showsInternalId, false);
  assert.ok(entry.props.name);
  assert.ok(entry.props.classification);
  assert.doesNotMatch(String(entry.props.name), /^catalog-/);
}

console.log(
  "RECIPE INGREDIENT PICKER BEHAVIOR PASSED: grouped visibility, estimates, incomplete cost, drafts, search, distinct empty states, no internal IDs",
);
