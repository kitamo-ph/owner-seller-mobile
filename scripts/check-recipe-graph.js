/**
 * Focused pure-domain check for immutable nested recipe graph behavior.
 *
 * Compile first:
 * tsc src/domain/recipeGraph.ts --outDir node_modules/.cache/kitamo-recipe-graph-check
 */

const {
  expandRecipeLeaves,
  validateRecipeGraph,
} = require("../node_modules/.cache/kitamo-recipe-graph-check/recipeGraph.js");

let failures = 0;

function check(name, condition, details = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${name}: ${ok ? "OK" : "FAIL"}${details ? ` (${details})` : ""}`);
}

const leaf = (id, itemId, label, quantity, unit, cost = 1, role = "main") => ({
  id,
  sourceKind: "catalog_item",
  itemId,
  label,
  quantity,
  unit,
  role,
  optional: false,
  costState: cost === null ? "unknown" : "known",
  authoritativeUnitCost: cost,
});

const child = (id, childVersionId, label, quantity, unit) => ({
  id,
  sourceKind: "child_recipe_version",
  childVersionId,
  label,
  quantity,
  unit,
  role: "supporting",
  optional: false,
});

const cookedRice = {
  id: "cooked-v4",
  familyId: "cooked-family",
  outputItemId: "cooked-rice",
  label: "Cooked Rice v4",
  businessId: "business-1",
  expectedOutputQuantity: 1000,
  outputUnit: "g",
  status: "published",
  lines: [leaf("cooked-rice-line", "raw-rice", "Raw Rice", 500, "g", 0.08)],
};

const seasoning = {
  id: "seasoning-v1",
  familyId: "seasoning-family",
  outputItemId: "seasoning",
  label: "Sushi Seasoning v1",
  businessId: "business-1",
  expectedOutputQuantity: 100,
  outputUnit: "ml",
  status: "published",
  lines: [leaf("seasoning-sugar", "sugar", "Sugar", 20, "g", 0.1)],
};

const sushiRice = {
  id: "sushi-v2",
  familyId: "sushi-family",
  outputItemId: "sushi-rice",
  label: "Sushi Rice v2",
  businessId: "business-1",
  expectedOutputQuantity: 1000,
  outputUnit: "g",
  status: "published",
  lines: [
    child("sushi-cooked", "cooked-v4", "Cooked Rice", 900, "g"),
    child("sushi-seasoning", "seasoning-v1", "Seasoning", 100, "ml"),
    leaf("sushi-sugar", "sugar", "Sugar", 10, "g", 0.1, "seasoning"),
  ],
};

const musubi = {
  id: "musubi-v3",
  familyId: "musubi-family",
  outputItemId: "musubi",
  label: "Musubi v3",
  businessId: "business-1",
  expectedOutputQuantity: 10,
  outputUnit: "pcs",
  status: "published",
  lines: [
    child("musubi-sushi", "sushi-v2", "Sushi Rice", 500, "g"),
    leaf("musubi-sugar", "sugar", "Sugar", 5, "g", 0.1, "garnish"),
    leaf("musubi-nori", "nori", "Nori", 10, "pcs", 3),
  ],
};

const graph = [musubi, sushiRice, seasoning, cookedRice];
const oneLevel = expandRecipeLeaves([cookedRice], "cooked-v4", 2000);
check(
  "one-level raw dependency scales exactly",
  oneLevel.ok &&
    oneLevel.requirements.length === 1 &&
    oneLevel.requirements[0].quantity === 1000,
);
const valid = validateRecipeGraph(graph, "musubi-v3");
check("multi-level exact graph validates", valid.ok);
if (valid.ok) {
  check(
    "children precede parents",
    valid.preparationOrder.indexOf("cooked-v4") <
      valid.preparationOrder.indexOf("sushi-v2") &&
      valid.preparationOrder.indexOf("sushi-v2") <
        valid.preparationOrder.indexOf("musubi-v3"),
  );
  check("reachable nodes counted once", valid.nodeCount === 4);
}

const expanded = expandRecipeLeaves(graph, "musubi-v3", 20);
check("multi-level expansion succeeds", expanded.ok);
if (expanded.ok) {
  const sugar = expanded.requirements.find((item) => item.itemId === "sugar");
  check(
    "repeated sugar aggregates once",
    expanded.requirements.filter((item) => item.itemId === "sugar").length === 1,
  );
  check("repeated sugar quantity is exact", sugar?.quantity === 40, `${sugar?.quantity}`);
  check("branch provenance is retained", sugar?.provenance.length === 3);
  check("pinned graph has complete cost", expanded.costComplete);
}

const packagedPrepared = {
  ...cookedRice,
  id: "packaged-prepared-v1",
  familyId: "packaged-prepared-family",
  outputItemId: "packaged-prepared-output",
  label: "Packaged Prepared v1",
  expectedOutputQuantity: 1,
  outputUnit: "kg",
  lines: [
    leaf("packaged-prepared-rice", "raw-rice", "Raw Rice", 500, "g", 0.08),
  ],
};
const packagedParent = {
  ...musubi,
  id: "packaged-parent-v1",
  familyId: "packaged-parent-family",
  outputItemId: "packaged-parent-output",
  label: "Packaged Parent v1",
  expectedOutputQuantity: 1,
  outputUnit: "pcs",
  lines: [
    {
      ...child(
        "packaged-parent-child",
        packagedPrepared.id,
        "Prepared package",
        1,
        "pack",
      ),
      canonicalQuantity: 0.5,
      canonicalUnit: "kg",
    },
  ],
};
const packagedExpansion = expandRecipeLeaves(
  [packagedParent, packagedPrepared],
  packagedParent.id,
  2,
);
check(
  "persisted child conversion validates against the child output unit",
  packagedExpansion.ok,
  packagedExpansion.ok ? "" : packagedExpansion.error.code,
);
check(
  "nested expansion scales by the canonical child quantity",
  packagedExpansion.ok &&
    packagedExpansion.requirements[0]?.quantity === 500,
  packagedExpansion.ok
    ? `${packagedExpansion.requirements[0]?.quantity}`
    : packagedExpansion.error.code,
);
const missingChildConversionQuantity = validateRecipeGraph(
  [
    {
      ...packagedParent,
      lines: packagedParent.lines.map(({ canonicalQuantity, ...line }) => line),
    },
    packagedPrepared,
  ],
  packagedParent.id,
);
check(
  "child unit change without a conversion quantity is rejected",
  !missingChildConversionQuantity.ok &&
    missingChildConversionQuantity.error.code ===
      "missing_conversion_snapshot",
);

const sharedPrepared = {
  ...cookedRice,
  id: "shared-v1",
  familyId: "shared-family",
  outputItemId: "shared-output",
  label: "Shared v1",
  expectedOutputQuantity: 1,
  outputUnit: "g",
  lines: [leaf("shared-sugar", "sugar", "Sugar", 2, "g", 0.1)],
};
const diamondLeft = {
  ...cookedRice,
  id: "left-v1",
  familyId: "left-family",
  outputItemId: "left-output",
  label: "Left v1",
  expectedOutputQuantity: 1,
  outputUnit: "serving",
  lines: [child("left-shared", "shared-v1", "Shared", 1, "g")],
};
const diamondRight = {
  ...cookedRice,
  id: "right-v1",
  familyId: "right-family",
  outputItemId: "right-output",
  label: "Right v1",
  expectedOutputQuantity: 1,
  outputUnit: "serving",
  lines: [child("right-shared", "shared-v1", "Shared", 1, "g")],
};
const diamondRoot = {
  ...musubi,
  id: "diamond-v1",
  familyId: "diamond-family",
  outputItemId: "diamond-output",
  label: "Diamond v1",
  expectedOutputQuantity: 1,
  outputUnit: "pcs",
  lines: [
    child("diamond-left", "left-v1", "Left", 1, "serving"),
    child("diamond-right", "right-v1", "Right", 1, "serving"),
  ],
};
const diamond = expandRecipeLeaves(
  [diamondRoot, diamondLeft, diamondRight, sharedPrepared],
  "diamond-v1",
  1,
);
check(
  "diamond reuse counts both real edge contributions",
  diamond.ok &&
    diamond.requirements[0].quantity === 4 &&
    diamond.requirements[0].provenance.length === 2,
);

const customBatchCost = expandRecipeLeaves(
  [
    {
      ...musubi,
      id: "custom-v1",
      familyId: "custom-family",
      outputItemId: "custom-output",
      label: "Custom v1",
      lines: [
        {
          id: "custom-line",
          sourceKind: "custom_cost",
          label: "Secret preparation",
          quantity: 2,
          unit: "pcs",
          costState: "known",
          authoritativeUnitCost: 15,
        },
      ],
    },
  ],
  "custom-v1",
  20,
);
check(
  "custom override remains a per-batch line cost",
  customBatchCost.ok && customBatchCost.expectedCost === 30,
  customBatchCost.ok ? `${customBatchCost.expectedCost}` : customBatchCost.error.code,
);

const roleOnlyChange = {
  ...musubi,
  lines: musubi.lines.map((line) =>
    line.id === "musubi-sugar" ? { ...line, role: "packaging" } : line,
  ),
};
const roleExpansion = expandRecipeLeaves(
  [roleOnlyChange, sushiRice, seasoning, cookedRice],
  "musubi-v3",
  20,
);
check(
  "display role does not change quantity or cost",
  roleExpansion.ok &&
    expanded.ok &&
    JSON.stringify(
      roleExpansion.requirements.map(({ quantity, expectedCost }) => ({
        quantity,
        expectedCost,
      })),
    ) ===
      JSON.stringify(
        expanded.requirements.map(({ quantity, expectedCost }) => ({
          quantity,
          expectedCost,
        })),
      ),
);

const olderSameFamily = {
  ...cookedRice,
  id: "cooked-v3",
  label: "Cooked Rice v3",
};
const directFamilyCycle = validateRecipeGraph(
  [
    {
      ...cookedRice,
      lines: [child("self-old", "cooked-v3", "Older Cooked Rice", 100, "g")],
    },
    olderSameFamily,
  ],
  "cooked-v4",
);
check(
  "new version cannot reference older same-family version",
  !directFamilyCycle.ok &&
    directFamilyCycle.error.code === "recipe_family_cycle" &&
    directFamilyCycle.error.path.length >= 2,
);

const exactA = {
  ...cookedRice,
  id: "exact-a",
  familyId: "exact-family-a",
  outputItemId: "exact-output-a",
  label: "Exact A",
  lines: [child("a-b", "exact-b", "Exact B", 1, "g")],
};
const exactB = {
  ...cookedRice,
  id: "exact-b",
  familyId: "exact-family-b",
  outputItemId: "exact-output-b",
  label: "Exact B",
  lines: [child("b-a", "exact-a", "Exact A", 1, "g")],
};
const exactCycle = validateRecipeGraph([exactA, exactB], "exact-a");
check(
  "exact-version cycle reports path",
  !exactCycle.ok &&
    exactCycle.error.code === "exact_version_cycle" &&
    exactCycle.error.path.join(" -> ") === "Exact A -> Exact B -> Exact A",
);

const familyAOld = {
  ...cookedRice,
  id: "family-a-v1",
  familyId: "family-a",
  outputItemId: "output-a-old",
  label: "Family A v1",
  lines: [leaf("a-old-leaf", "raw-a", "Raw A", 1, "g")],
};
const familyB = {
  ...cookedRice,
  id: "family-b-v1",
  familyId: "family-b",
  outputItemId: "output-b",
  label: "Family B v1",
  lines: [child("b-a-old", "family-a-v1", "A old", 1, "g")],
};
const familyANew = {
  ...cookedRice,
  id: "family-a-v2",
  familyId: "family-a",
  outputItemId: "output-a-new",
  label: "Family A v2",
  lines: [child("a-new-b", "family-b-v1", "B", 1, "g")],
};
const indirectFamilyCycle = validateRecipeGraph(
  [familyANew, familyB, familyAOld],
  "family-a-v2",
);
check(
  "indirect stable-family cycle is rejected",
  !indirectFamilyCycle.ok &&
    indirectFamilyCycle.error.code === "recipe_family_cycle" &&
    indirectFamilyCycle.error.path.length === 3,
);

const sameOutputChild = {
  ...cookedRice,
  id: "other-family",
  familyId: "different-family",
  outputItemId: "musubi",
  label: "Other family same output",
};
const outputCycle = validateRecipeGraph(
  [
    {
      ...musubi,
      lines: [child("same-output", "other-family", "Same output", 1, "g")],
    },
    sameOutputChild,
  ],
  "musubi-v3",
);
check(
  "output-item dependency cycle is rejected",
  !outputCycle.ok && outputCycle.error.code === "output_item_cycle",
);

const missing = validateRecipeGraph(
  [{ ...musubi, lines: [child("missing", "not-loaded", "Missing", 1, "g")] }],
  "musubi-v3",
);
check(
  "missing pinned child fails closed",
  !missing.ok && missing.error.code === "missing_child_version",
);

const archivedChild = { ...cookedRice, status: "archived" };
const archivedParent = {
  ...sushiRice,
  lines: [child("archived", "cooked-v4", "Cooked Rice", 100, "g")],
};
const newUseArchived = validateRecipeGraph(
  [archivedParent, archivedChild],
  "sushi-v2",
);
const historicalArchived = validateRecipeGraph(
  [archivedParent, archivedChild],
  "sushi-v2",
  { purpose: "historical" },
);
check(
  "archived child rejected for authoring",
  !newUseArchived.ok && newUseArchived.error.code === "archived_dependency",
);
check("archived child remains historically readable", historicalArchived.ok);

const depthBound = validateRecipeGraph(graph, "musubi-v3", {
  limits: { maxDepth: 2 },
});
check(
  "depth bound fails without truncation",
  !depthBound.ok &&
    depthBound.error.code === "depth_limit_exceeded" &&
    depthBound.error.configuredLimit === 2,
);

const nodeBound = validateRecipeGraph(graph, "musubi-v3", {
  limits: { maxNodes: 2 },
});
check(
  "node bound fails without truncation",
  !nodeBound.ok && nodeBound.error.code === "node_limit_exceeded",
);

if (failures === 0) {
  console.log("ALL RECIPE GRAPH CHECKS PASSED");
  process.exit(0);
}

console.error(`${failures} RECIPE GRAPH CHECKS FAILED`);
process.exit(1);
