/**
 * Focused pure-domain check for nested planning and expected/actual yield.
 *
 * Compile first:
 * tsc src/domain/productionPlanner.ts --outDir node_modules/.cache/kitamo-production-planner-check
 */

const {
  applyActualStageYield,
  calculateProductionPlan,
  calculateYieldVariance,
  recalculateProductionPlan,
  transitionProductionPlanStatus,
} = require("../node_modules/.cache/kitamo-production-planner-check/productionPlanner.js");

let failures = 0;

function check(name, condition, details = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${name}: ${ok ? "OK" : "FAIL"}${details ? ` (${details})` : ""}`);
}

const leaf = (id, itemId, label, quantity, unit, costState, cost) => ({
  id,
  sourceKind: "catalog_item",
  itemId,
  label,
  quantity,
  unit,
  role: "main",
  optional: false,
  costState,
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

const base = {
  id: "base-v1",
  familyId: "base-family",
  outputItemId: "prepared-base",
  label: "Prepared Base v1",
  businessId: "business-1",
  expectedOutputQuantity: 10,
  outputUnit: "serving",
  status: "published",
  lines: [leaf("base-rice", "raw-rice", "Raw Rice", 100, "g", "known", 0.1)],
};

const filling = {
  id: "filling-v1",
  familyId: "filling-family",
  outputItemId: "prepared-filling",
  label: "Prepared Filling v1",
  businessId: "business-1",
  expectedOutputQuantity: 10,
  outputUnit: "serving",
  status: "published",
  lines: [
    child("filling-base", "base-v1", "Prepared Base", 10, "serving"),
    leaf("filling-sugar", "sugar", "Sugar", 20, "g", "known", 0.2),
  ],
};

const finalProduct = {
  id: "final-v1",
  familyId: "final-family",
  outputItemId: "musubi",
  label: "Musubi v1",
  businessId: "business-1",
  expectedOutputQuantity: 10,
  outputUnit: "pcs",
  status: "published",
  lines: [
    child("final-filling", "filling-v1", "Prepared Filling", 10, "serving"),
    leaf("final-nori", "nori", "Nori", 10, "pcs", "known", 1),
  ],
};

const versions = [finalProduct, filling, base];
const preparedStock = [
  {
    itemId: "prepared-base",
    quantity: 5,
    unit: "serving",
    costState: "known",
    authoritativeUnitCost: 0.4,
  },
  {
    itemId: "prepared-base",
    quantity: 5,
    unit: "serving",
    costState: "known",
    authoritativeUnitCost: 0.6,
  },
  {
    itemId: "prepared-filling",
    quantity: 5,
    unit: "serving",
    costState: "known",
    authoritativeUnitCost: 1,
  },
];
const rawStock = [
  { itemId: "raw-rice", quantity: 1000, unit: "g" },
  { itemId: "sugar", quantity: 1000, unit: "g" },
  { itemId: "nori", quantity: 100, unit: "pcs" },
];

const input = {
  planId: "plan-30",
  rootVersionId: "final-v1",
  targetQuantity: 30,
  targetUnit: "pcs",
  mode: "use_prepared_stock_first",
  versions,
  preparedStock,
  rawStock,
  observedAt: "2026-07-26T00:00:00.000Z",
};
const inputBefore = JSON.stringify(input);
const planned = calculateProductionPlan(input);
check("30-unit nested plan calculates", planned.ok);
check("planning mutates no caller input", JSON.stringify(input) === inputBefore);

if (planned.ok) {
  const plan = planned.plan;
  const baseStage = plan.stages.find((stage) => stage.versionId === "base-v1");
  const fillingStage = plan.stages.find((stage) => stage.versionId === "filling-v1");
  const finalStage = plan.stages.find((stage) => stage.versionId === "final-v1");
  const rice = plan.rawRequirements.find((item) => item.itemId === "raw-rice");
  const sugar = plan.rawRequirements.find((item) => item.itemId === "sugar");
  const nori = plan.rawRequirements.find((item) => item.itemId === "nori");

  check(
    "preparation order is child before parent",
    plan.preparationOrder.join(",") === "base-v1,filling-v1,final-v1",
    plan.preparationOrder.join(","),
  );
  check(
    "prepared filling reduces only filling preparation",
    fillingStage?.requiredOutputQuantity === 30 &&
      fillingStage.preparedStockUsed === 5 &&
      fillingStage.expectedFreshOutput === 25,
  );
  check(
    "prepared base reduces nested raw expansion once",
    baseStage?.requiredOutputQuantity === 25 &&
      baseStage.preparedStockUsed === 10 &&
      baseStage.expectedFreshOutput === 15 &&
      rice?.quantity === 150,
    `rice=${rice?.quantity}`,
  );
  check("scaled sugar requirement is exact", sugar?.quantity === 50);
  check("root target remains 30", finalStage?.expectedFreshOutput === 30);
  check("raw requirements remain distinguishable", nori?.quantity === 30);
  check("complete expected cost includes prepared stock", plan.expectedCost === 65, `${plan.expectedCost}`);
  check("sufficient plan reports no stock shortage", plan.missingStockCount === 0);

  const ready = transitionProductionPlanStatus(
    plan,
    "ready",
    "2026-07-26T00:01:00.000Z",
  );
  check("complete plan can become ready", ready.ok && ready.plan.status === "ready");

  const yielded = applyActualStageYield(
    plan,
    "base-v1",
    7,
    "2026-07-26T00:02:00.000Z",
  );
  check("actual intermediate yield records", yielded.ok);
  if (yielded.ok) {
    const actualBase = yielded.plan.stages.find(
      (stage) => stage.versionId === "base-v1",
    );
    check(
      "expected and actual yield stay separate",
      actualBase?.expectedFreshOutput === 15 &&
        actualBase.actualOutput === 7 &&
        actualBase.yieldVariance?.absoluteVariance === -8,
    );
    check(
      "short actual yield propagates to final target",
      Math.abs(yielded.plan.targetShortfallQuantity - 8) < 1e-9,
      `${yielded.plan.targetShortfallQuantity}`,
    );
    check(
      "recipe expected yield was not overwritten",
      base.expectedOutputQuantity === 10,
    );

    const reduced = recalculateProductionPlan(yielded.plan, {
      rootVersionId: "final-v1",
      targetQuantity: 22,
      targetUnit: "pcs",
      mode: "use_prepared_stock_first",
      versions,
      preparedStock,
      rawStock,
      observedAt: "2026-07-26T00:03:00.000Z",
    });
    check("lower target recalculates", reduced.ok);
    if (reduced.ok) {
      check(
        "original target remains traceable",
        reduced.plan.originalTargetQuantity === 30 &&
          reduced.plan.targetQuantity === 22,
      );
      check(
        "recorded actual yield survives recalculation",
        reduced.plan.stages.find((stage) => stage.versionId === "base-v1")
          ?.actualOutput === 7,
      );
      check(
        "lower feasible target clears yield shortfall",
        reduced.plan.targetShortfallQuantity < 1e-9,
        `${reduced.plan.targetShortfallQuantity}`,
      );
    }
  }

  const cancelled = transitionProductionPlanStatus(
    plan,
    "cancelled",
    "2026-07-26T00:04:00.000Z",
  );
  check(
    "cancellation changes status without changing requirements",
    cancelled.ok &&
      cancelled.plan.rawRequirements[0].quantity ===
      plan.rawRequirements[0].quantity,
  );
  const zeroActual = applyActualStageYield(
    plan,
    "base-v1",
    0,
    "2026-07-26T00:05:00.000Z",
  );
  check(
    "zero actual output cannot complete a stage",
    !zeroActual.ok && zeroActual.code === "invalid_actual_output",
  );
}

const fresh = calculateProductionPlan({
  ...input,
  planId: "plan-fresh",
  mode: "prepare_fresh",
});
check("prepare-fresh plan calculates", fresh.ok);
if (fresh.ok) {
  const rice = fresh.plan.rawRequirements.find((item) => item.itemId === "raw-rice");
  check("prepare-fresh ignores prepared stock", fresh.plan.preparedStockUses.length === 0);
  check("prepare-fresh expands all raw input", rice?.quantity === 300);
  check("prepare-fresh expected cost excludes prepared stock", fresh.plan.expectedCost === 72);
}

const unknownVersions = [
  finalProduct,
  {
    ...filling,
    lines: filling.lines.map((line) =>
      line.id === "filling-sugar"
        ? { ...line, costState: "unknown", authoritativeUnitCost: null }
        : line,
    ),
  },
  base,
];
const unknownCost = calculateProductionPlan({
  ...input,
  planId: "plan-unknown",
  versions: unknownVersions,
});
check(
  "one unknown required cost propagates incomplete costing",
  unknownCost.ok &&
    !unknownCost.plan.costComplete &&
    unknownCost.plan.expectedCost === null &&
    unknownCost.plan.missingCostCount === 1 &&
    unknownCost.plan.knownCostSubtotal > 0,
);

const missingStock = calculateProductionPlan({
  ...input,
  planId: "plan-short-stock",
  rawStock: rawStock.map((stock) =>
    stock.itemId === "raw-rice" ? { ...stock, quantity: 100 } : stock,
  ),
});
check(
  "missing raw stock is reported without mutation",
  missingStock.ok &&
    missingStock.plan.missingStockCount === 1 &&
    missingStock.plan.rawRequirements.find((item) => item.itemId === "raw-rice")
      ?.missingQuantity === 50,
);

const variance = calculateYieldVariance(10, 8);
check(
  "yield variance preserves sign and percentage",
  variance?.absoluteVariance === -2 &&
    variance.percentageVariance === -20 &&
    variance.shortfallQuantity === 2,
);

const customCostPlan = calculateProductionPlan({
  planId: "plan-custom-cost",
  rootVersionId: "custom-v1",
  targetQuantity: 20,
  targetUnit: "pcs",
  mode: "prepare_fresh",
  versions: [
    {
      id: "custom-v1",
      familyId: "custom-family",
      outputItemId: "custom-output",
      label: "Custom v1",
      businessId: "business-1",
      expectedOutputQuantity: 10,
      outputUnit: "pcs",
      status: "published",
      lines: [
        {
          id: "custom-preparation",
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
  preparedStock: [],
  rawStock: [],
  observedAt: "2026-07-26T02:00:00.000Z",
});
check(
  "custom override scales as one line cost per recipe batch",
  customCostPlan.ok && customCostPlan.plan.expectedCost === 30,
  customCostPlan.ok
    ? `${customCostPlan.plan.expectedCost}`
    : customCostPlan.message,
);

if (failures === 0) {
  console.log("ALL PRODUCTION PLANNER CHECKS PASSED");
  process.exit(0);
}

console.error(`${failures} PRODUCTION PLANNER CHECKS FAILED`);
process.exit(1);
