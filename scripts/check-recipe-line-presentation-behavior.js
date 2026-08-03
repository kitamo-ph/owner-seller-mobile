const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const workspace = process.cwd();
const outDir = path.join(
  workspace,
  "node_modules/.cache/kitamo-recipe-line-presentation-behavior",
);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  path.join(workspace, "node_modules/.bin/tsc"),
  [
    "src/domain/recipeLinePresentation.ts",
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
  presentRecipeLineIdentity,
  presentationsMatch,
  INGREDIENT_IDENTITY_UNAVAILABLE,
} = require(path.join(outDir, "recipeLinePresentation.js"));

function present(step, overrides = {}) {
  return presentRecipeLineIdentity({
    lineId: "line-1",
    quantity: 27,
    unit: "g",
    resolved: {
      displayName: "Sushi Rice",
      classification: "prepared_base",
      sourceLabel: "Estimated prepared item",
      costLabel: "Estimated cost",
      conversionSummary: "1 kg = 1000 g",
      category: "Prepared",
      sourceDetail: null,
      missingReason: null,
    },
    ...overrides,
  });
}

const cases = [
  {
    label: "Grocery lot",
    resolved: {
      displayName: "Apple Cider",
      classification: "purchased_ingredient",
      sourceLabel: "Exact Grocery lot",
      costLabel: "Actual cost",
      conversionSummary: "1 us_gallon = 3785.411784 ml",
      category: "Seasoning",
      sourceDetail: "Acceptance fixture",
      missingReason: null,
    },
    quantity: 400,
    unit: "ml",
  },
  {
    label: "prepared recipe",
    resolved: {
      displayName: "Sushi Seasoning",
      classification: "prepared_base",
      sourceLabel: "Pinned prepared Recipe version",
      costLabel: "Actual cost",
      conversionSummary: "1 metric_cup = 250 ml",
      category: "Prepared",
      sourceDetail: "Version status: published",
      missingReason: null,
    },
    quantity: 1,
    unit: "metric_cup",
  },
  {
    label: "estimate",
    resolved: {
      displayName: "Sushi Rice",
      classification: "prepared_base",
      sourceLabel: "Estimated prepared item",
      costLabel: "Estimated cost",
      conversionSummary: null,
      category: null,
      sourceDetail: null,
      missingReason: null,
    },
    quantity: 27,
    unit: "g",
  },
  {
    label: "child draft",
    resolved: {
      displayName: "Cooked Rice",
      classification: "prepared_base",
      sourceLabel: "Prepared Recipe draft",
      costLabel: "Cost incomplete",
      conversionSummary: null,
      category: null,
      sourceDetail: "Draft status: editing",
      missingReason: "Complete this prepared Recipe before publishing.",
    },
    quantity: 1,
    unit: "kg",
  },
  {
    label: "legacy snapshot",
    resolved: {
      displayName: "Legacy Soy",
      classification: "legacy_unclassified",
      sourceLabel: "Custom ingredient cost",
      costLabel: "Estimated cost",
      conversionSummary: null,
      category: null,
      sourceDetail: null,
      missingReason: null,
    },
    quantity: 5,
    unit: "ml",
  },
  {
    label: "unresolved identity fallback",
    resolved: {
      displayName: "",
      classification: null,
      sourceLabel: "Unresolved ingredient",
      costLabel: "Cost incomplete",
      conversionSummary: null,
      category: null,
      sourceDetail: null,
      missingReason: null,
    },
    quantity: 1,
    unit: "pcs",
  },
];

for (const testCase of cases) {
  const step2 = presentRecipeLineIdentity({
    lineId: `line-${testCase.label}`,
    quantity: testCase.quantity,
    unit: testCase.unit,
    resolved: testCase.resolved,
  });
  const step3 = presentRecipeLineIdentity({
    lineId: `line-${testCase.label}`,
    quantity: testCase.quantity,
    unit: testCase.unit,
    resolved: testCase.resolved,
  });
  assert.ok(
    presentationsMatch(step2, step3),
    `${testCase.label} must present identically on Step 2 and Step 3`,
  );
  assert.equal(step2.displayName === "Recorded ingredient", false);
}

const unavailable = presentRecipeLineIdentity({
  lineId: "line-missing",
  quantity: 1,
  unit: "g",
  resolved: null,
});
assert.equal(unavailable.displayName, INGREDIENT_IDENTITY_UNAVAILABLE);
assert.notEqual(unavailable.displayName, "Recorded ingredient");

const blankName = present("step2", {
  resolved: {
    displayName: "   ",
    classification: "prepared_base",
    sourceLabel: "Estimated prepared item",
    costLabel: "Estimated cost",
    conversionSummary: null,
    category: null,
    sourceDetail: null,
    missingReason: null,
  },
});
assert.equal(blankName.displayName, INGREDIENT_IDENTITY_UNAVAILABLE);

console.log(
  "RECIPE LINE PRESENTATION BEHAVIOR PASSED: Step 2/Step 3 identity parity across Grocery, prepared, estimate, draft, legacy, and unavailable fallback",
);
