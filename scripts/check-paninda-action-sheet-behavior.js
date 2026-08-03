const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();
const outDir = path.join(
  workspace,
  "node_modules/.cache/kitamo-paninda-action-sheet-behavior",
);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  path.join(workspace, "node_modules/.bin/tsc"),
  [
    "src/domain/panindaActionSheet.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2020",
    "--strict",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { cwd: workspace, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);

const {
  buildPanindaActionSheetTree,
  findRenderNodes,
  buildPanindaActionDescriptors,
} = require(path.join(outDir, "panindaActionSheet.js"));

const resaleActions = {
  openRecipe: false,
  produceFromRecipe: false,
  editSellingItem: true,
  addPurchasedStock: true,
  manualCompatibilityStockIn: false,
  recordSpoilage: true,
  transferStock: true,
  archive: true,
  requestPermanentDelete: true,
};

const smallTree = buildPanindaActionSheetTree({
  productName: "Bottled Water",
  stockQty: 12,
  unitType: "piece",
  priceLabel: "₱20",
  classificationLabel: "Direct resale",
  section: "active",
  stockPolicy: "product_scalar",
  productType: "retail item",
  actions: resaleActions,
  layout: {
    windowHeight: 640,
    topInset: 48,
    bottomInset: 34,
    spacingLg: 16,
    spacingMd: 12,
  },
});

const sheet = findRenderNodes(
  smallTree,
  (node) => node.props.testID === "action-sheet",
)[0];
assert.ok(sheet, "action sheet container must render");
assert.equal(sheet.props.maxHeight, 640 - 48 - 16);
assert.equal(sheet.props.paddingBottom, 34);

const header = findRenderNodes(
  smallTree,
  (node) => node.props.testID === "sheet-header",
)[0];
const scroll = findRenderNodes(
  smallTree,
  (node) => node.type === "ScrollView",
)[0];
assert.ok(header, "fixed header must render");
assert.equal(header.props.fixed, true);
assert.ok(scroll, "action area must be a ScrollView");
assert.equal(scroll.props.scrollEnabled, true);
assert.ok(
  !header.children.some((child) => child.type === "ScrollView"),
  "fixed header must remain outside the action ScrollView",
);

const actions = findRenderNodes(scroll, (node) => node.type === "Action");
assert.equal(actions.length, 6);
assert.ok(actions.every((action) => action.props.label));
assert.ok(
  actions.some((action) => action.props.label === "Archive"),
);
assert.ok(
  actions.some((action) => action.props.label === "Delete permanently"),
);
assert.ok(
  actions.some((action) => action.props.label === "Record spoilage"),
);
assert.ok(
  !actions.some((action) => action.props.label === "Delete"),
  "spoilage must not be labelled Delete",
);

const close = findRenderNodes(
  smallTree,
  (node) => node.props.testID === "sheet-close",
)[0];
const scrim = findRenderNodes(
  smallTree,
  (node) => node.props.testID === "sheet-scrim",
)[0];
assert.ok(close?.props.onPress);
assert.ok(scrim?.props.onPress);
assert.equal(smallTree.props.onRequestClose, true);

const recipeTree = buildPanindaActionSheetTree({
  productName: "Sausage Sushi",
  stockQty: 0,
  unitType: "piece",
  priceLabel: "₱25",
  classificationLabel: "Finished product",
  section: "active",
  stockPolicy: "product_lots",
  productType: "cooked food",
  actions: {
    openRecipe: true,
    produceFromRecipe: true,
    editSellingItem: false,
    addPurchasedStock: false,
    manualCompatibilityStockIn: false,
    recordSpoilage: false,
    transferStock: false,
    archive: true,
    requestPermanentDelete: false,
  },
  layout: {
    windowHeight: 520,
    topInset: 24,
    bottomInset: 16,
  },
});
const recipeActions = findRenderNodes(
  recipeTree,
  (node) => node.type === "Action",
);
assert.deepEqual(
  recipeActions.map((action) => action.props.label),
  ["Open Recipe", "Produce from Recipe", "Archive"],
);
assert.ok(
  !recipeActions.some((action) => action.props.label === "Delete permanently"),
);

const largeFontTree = buildPanindaActionSheetTree({
  productName: "Very Long Product Name For Large Font Settings",
  stockQty: 3,
  unitType: "piece",
  priceLabel: "₱10",
  classificationLabel: "Direct resale",
  section: "active",
  stockPolicy: "product_scalar",
  productType: "retail item",
  actions: resaleActions,
  layout: {
    windowHeight: 480,
    topInset: 40,
    bottomInset: 28,
  },
});
const title = findRenderNodes(
  largeFontTree,
  (node) => node.props.testID === "sheet-title",
)[0];
assert.equal(title.props.numberOfLines, 2);
assert.ok(
  findRenderNodes(largeFontTree, (node) => node.type === "Action").length >= 6,
  "small viewport must keep eligible actions present inside the scrollable tree",
);

assert.deepEqual(
  buildPanindaActionDescriptors({
    actions: {
      ...resaleActions,
      archive: false,
      requestPermanentDelete: false,
    },
    productType: "retail item",
  }).map((action) => action.key),
  [
    "addPurchasedStock",
    "editSellingItem",
    "recordSpoilage",
    "transferStock",
  ],
);

console.log(
  "PANINDA ACTION SHEET BEHAVIOR PASSED: bounded layout, fixed header, scrollable actions, eligibility, spoilage/archive labels, scrim/Back close wiring",
);
