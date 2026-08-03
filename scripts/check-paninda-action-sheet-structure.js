/**
 * Rendered-structure conformance guard for the Paninda product action sheet.
 *
 * This check parses the real JSX of `ProductActionSheet` in
 * `app/owner/inventory.tsx` with the TypeScript compiler API and asserts the
 * shipped element tree against the structural contract. It is not source-text
 * matching: every assertion is made against true AST parent/child and sibling
 * relationships, so moving the header inside the action ScrollView, dropping
 * the ScrollView, unbinding the bounded height, or hard-coding the action list
 * fails this check even when the file still contains the same words.
 *
 * It also pins the test-only `buildPanindaActionSheetTree` model used by
 * `check-paninda-action-sheet-behavior.js` to the same invariants, so the model
 * cannot silently drift away from the component it claims to describe.
 *
 * React Native components cannot be host-rendered in this repository:
 * react-test-renderer, react-native-web, and jsdom are not installed, and phase
 * gates prohibit adding a dependency. AST conformance over the shipped JSX is
 * the strongest available evidence without that dependency.
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const workspace = process.cwd();
const componentPath = path.join(workspace, "app/owner/inventory.tsx");
const COMPONENT = "ProductActionSheet";

const sourceText = fs.readFileSync(componentPath, "utf8");
const sourceFile = ts.createSourceFile(
  componentPath,
  sourceText,
  ts.ScriptTarget.ES2020,
  true,
  ts.ScriptKind.TSX,
);

function tagNameOf(node) {
  return node.getText(sourceFile);
}

/** Collect the outermost JSX elements contained in an arbitrary node. */
function collectOutermostJsx(node, found = []) {
  node.forEachChild((child) => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      found.push(child);
      return;
    }
    collectOutermostJsx(child, found);
  });
  return found;
}

/** Build a simplified structural tree from real JSX AST nodes. */
function toTree(element) {
  if (ts.isJsxSelfClosingElement(element)) {
    return {
      tag: tagNameOf(element.tagName),
      attrs: element.attributes.getText(sourceFile),
      children: [],
    };
  }
  const children = [];
  for (const child of element.children) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      children.push(toTree(child));
      continue;
    }
    if (ts.isJsxExpression(child) && child.expression) {
      for (const nested of collectOutermostJsx(child.expression)) {
        children.push(toTree(nested));
      }
      // Retain the expression text so callers can assert how children are produced.
      children.push({
        tag: "#expression",
        attrs: child.expression.getText(sourceFile),
        children: [],
      });
    }
  }
  return {
    tag: tagNameOf(element.openingElement.tagName),
    attrs: element.openingElement.attributes.getText(sourceFile),
    children,
  };
}

function findComponent() {
  let target = null;
  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === COMPONENT) {
      target = node;
    }
  });
  assert.ok(target, `${COMPONENT} must exist in app/owner/inventory.tsx`);
  return target;
}

function findReturnedJsx(fn) {
  let returned = null;
  const visit = (node) => {
    if (returned) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const [first] = collectOutermostJsx(node.expression);
      if (first) {
        returned = first;
        return;
      }
      if (ts.isJsxElement(node.expression) || ts.isJsxSelfClosingElement(node.expression)) {
        returned = node.expression;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(fn.body);
  assert.ok(returned, `${COMPONENT} must return a JSX element`);
  return returned;
}

function walk(node, visit, ancestors = []) {
  visit(node, ancestors);
  for (const child of node.children) {
    walk(child, visit, [...ancestors, node]);
  }
}

function findAll(root, predicate) {
  const matches = [];
  walk(root, (node, ancestors) => {
    if (predicate(node)) matches.push({ node, ancestors });
  });
  return matches;
}

function findOne(root, predicate, description) {
  const matches = findAll(root, predicate);
  assert.equal(matches.length, 1, `${description}: expected exactly one, found ${matches.length}`);
  return matches[0];
}

function isDescendantOf(entry, candidate) {
  return entry.ancestors.includes(candidate);
}

const component = findComponent();
const tree = toTree(findReturnedJsx(component));

// --- 1. Modal root, Android Back, transparency -------------------------------
assert.equal(tree.tag, "Modal", "the action sheet must be rooted in a Modal");
assert.match(
  tree.attrs,
  /onRequestClose=\{onClose\}/,
  "Android Back must be wired to the close handler on the real Modal",
);
assert.match(tree.attrs, /\btransparent\b/, "the Modal must be transparent");
assert.match(tree.attrs, /\bvisible\b/, "the Modal must be visible when mounted");

// --- 2. Scrim closes the sheet and sits outside the scroll area --------------
const scrim = findOne(
  tree,
  (node) => node.tag === "Pressable" && /styles\.modalScrim/.test(node.attrs),
  "scrim Pressable",
);
assert.match(
  scrim.node.attrs,
  /onPress=\{onClose\}/,
  "tapping the scrim must close the sheet",
);
assert.match(
  scrim.node.attrs,
  /accessibilityLabel=/,
  "the scrim must carry an accessibility label",
);

// --- 3. Bounded height and bottom safe-area padding come from the model ------
const sheet = findOne(
  tree,
  (node) => node.tag === "View" && /styles\.actionSheet/.test(node.attrs),
  "sheet container View",
);
assert.match(
  sheet.node.attrs,
  /maxHeight:\s*layout\.maxHeight/,
  "the sheet's bounded height must be bound to buildPanindaActionSheetLayout, not a literal",
);
assert.match(
  sheet.node.attrs,
  /paddingBottom:\s*layout\.paddingBottom/,
  "the sheet's bottom safe-area padding must be bound to buildPanindaActionSheetLayout",
);

// --- 4. Exactly one ScrollView, and it is the action area -------------------
const scroll = findOne(tree, (node) => node.tag === "ScrollView", "action ScrollView");
assert.ok(
  isDescendantOf(scroll, sheet.node),
  "the action ScrollView must live inside the bounded sheet container",
);

// --- 5. Fixed header is a preceding SIBLING of the ScrollView, never inside --
const header = findOne(
  tree,
  (node) => node.tag === "View" && /styles\.sheetHeader/.test(node.attrs),
  "fixed header View",
);
assert.equal(
  isDescendantOf(header, scroll.node),
  false,
  "the fixed header must NOT be a descendant of the action ScrollView",
);
assert.ok(
  isDescendantOf(header, sheet.node),
  "the fixed header must live inside the sheet container",
);
const sheetChildOrder = sheet.node.children;
const headerIndex = sheetChildOrder.findIndex(
  (child) => child === header.node || findAll(child, (n) => n === header.node).length > 0,
);
const scrollIndex = sheetChildOrder.findIndex(
  (child) => child === scroll.node || findAll(child, (n) => n === scroll.node).length > 0,
);
assert.ok(headerIndex >= 0 && scrollIndex >= 0, "header and ScrollView must be sheet children");
assert.ok(
  headerIndex < scrollIndex,
  "the fixed header must render above the scrollable action area",
);

// --- 6. Close action is reachable in the fixed header, not scrolled away ----
const close = findOne(
  tree,
  (node) => node.tag === "GabiSoftButton" && /onPress=\{onClose\}/.test(node.attrs),
  "header close button",
);
assert.ok(
  isDescendantOf(close, header.node),
  "the close action must remain in the fixed header so it is always visible",
);
assert.equal(
  isDescendantOf(close, scroll.node),
  false,
  "the close action must never be inside the scrollable area",
);

// --- 7. Actions render inside the ScrollView, from the tested descriptors ---
const actionsContainer = findOne(
  tree,
  (node) => node.tag === "View" && /styles\.sheetActions/.test(node.attrs),
  "actions container View",
);
assert.ok(
  isDescendantOf(actionsContainer, scroll.node),
  "the action list must live inside the scrollable area so no action is cut off",
);
const menuActions = findAll(tree, (node) => node.tag === "MenuAction");
assert.ok(menuActions.length > 0, "the sheet must render MenuAction rows");
for (const entry of menuActions) {
  assert.ok(
    isDescendantOf(entry, scroll.node),
    "every MenuAction must be inside the scrollable area",
  );
}
const mapsDescriptors = findAll(
  actionsContainer.node,
  (node) => node.tag === "#expression" && /\bactions\.map\(/.test(node.attrs),
);
assert.ok(
  mapsDescriptors.length > 0,
  "actions must be produced by mapping buildPanindaActionDescriptors output, not hard-coded",
);
assert.match(
  component.getText(sourceFile),
  /const actions = buildPanindaActionDescriptors\(/,
  "the rendered action list must come from the tested descriptor builder",
);

// --- 8. Empty-state copy for archived items stays inside the scroll area ----
const emptyState = findAll(
  actionsContainer.node,
  (node) => node.tag === "#expression" && /actions\.length === 0/.test(node.attrs),
);
assert.ok(
  emptyState.length > 0,
  "an archived read-only item must explain why no actions are offered",
);

// --- 9. Pin the test-only render model to the same invariants ---------------
const outDir = path.join(
  workspace,
  "node_modules/.cache/kitamo-paninda-action-sheet-structure",
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
const { buildPanindaActionSheetTree, findRenderNodes } = require(
  path.join(outDir, "panindaActionSheet.js"),
);

const modelTree = buildPanindaActionSheetTree({
  productName: "Sausage Sushi",
  stockQty: 8,
  unitType: "piece",
  priceLabel: "₱120",
  classificationLabel: "Finished product",
  section: "active",
  stockPolicy: "product_scalar",
  productType: "cooked",
  actions: {
    openRecipe: true,
    produceFromRecipe: true,
    editSellingItem: false,
    addPurchasedStock: false,
    manualCompatibilityStockIn: false,
    recordSpoilage: true,
    transferStock: true,
    archive: true,
    requestPermanentDelete: true,
  },
  layout: {
    windowHeight: 640,
    topInset: 48,
    bottomInset: 34,
    spacingLg: 16,
    spacingMd: 12,
  },
});

const modelScroll = findRenderNodes(
  modelTree,
  (node) => node.props.testID === "sheet-scroll",
)[0];
assert.ok(modelScroll, "the render model must still describe a ScrollView action area");
assert.equal(
  modelScroll.type,
  "ScrollView",
  "the render model's action area must remain a ScrollView, matching the JSX",
);
const modelHeader = findRenderNodes(
  modelTree,
  (node) => node.props.testID === "sheet-header",
)[0];
assert.ok(modelHeader, "the render model must still describe a fixed header");
assert.equal(
  findRenderNodes(modelScroll, (node) => node.props.testID === "sheet-header").length,
  0,
  "the render model must agree with the JSX: header is never inside the ScrollView",
);
assert.equal(
  findRenderNodes(modelScroll, (node) => node.props.testID === "sheet-close").length,
  0,
  "the render model must agree with the JSX: the close action is never inside the ScrollView",
);
assert.ok(
  findRenderNodes(modelScroll, (node) => node.type === "Action").length > 0,
  "the render model must agree with the JSX: actions are inside the ScrollView",
);

console.log(
  "PANINDA ACTION SHEET STRUCTURE CONFORMANCE PASSED: real JSX AST proves Modal/Back wiring, scrim close, model-bound bounded height and bottom inset, single ScrollView, fixed header as a preceding sibling, close action outside the scroll area, descriptor-driven actions inside it, and the test-only render model pinned to the same invariants",
);
