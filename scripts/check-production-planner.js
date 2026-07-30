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
  partitionProductionPlanLotAllocations,
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
    lotKind: "product",
    lotId: "prepared-base-lot-1",
    allocationMode: "recommended_fifo",
    quantity: 5,
    unit: "serving",
    costState: "known",
    authoritativeUnitCost: 0.4,
  },
  {
    itemId: "prepared-base",
    lotKind: "product",
    lotId: "prepared-base-lot-2",
    allocationMode: "recommended_fifo",
    quantity: 5,
    unit: "serving",
    costState: "known",
    authoritativeUnitCost: 0.6,
  },
  {
    itemId: "prepared-filling",
    lotKind: "product",
    lotId: "prepared-filling-lot-1",
    allocationMode: "recommended_fefo",
    quantity: 5,
    unit: "serving",
    costState: "known",
    authoritativeUnitCost: 1,
  },
];
const rawStock = [
  {
    itemId: "raw-rice",
    lotKind: "ingredient",
    lotId: "raw-rice-lot-1",
    allocationMode: "recommended_fifo",
    quantity: 1000,
    unit: "g",
    costState: "known",
    authoritativeUnitCost: 0.1,
  },
  {
    itemId: "sugar",
    lotKind: "ingredient",
    lotId: "sugar-lot-1",
    allocationMode: "manual",
    quantity: 1000,
    unit: "g",
    costState: "known",
    authoritativeUnitCost: 0.2,
  },
  {
    itemId: "nori",
    lotKind: "ingredient",
    lotId: "nori-lot-1",
    allocationMode: "recommended_fefo",
    quantity: 100,
    unit: "pcs",
    costState: "known",
    authoritativeUnitCost: 1,
  },
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
  check(
    "prepared-stock use retains exact lot evidence",
    plan.preparedStockUses.some(
      (usage) =>
        usage.itemId === "prepared-base" &&
        usage.allocations.length === 2 &&
        usage.allocations.every(
          (allocation) =>
            allocation.lotKind === "product" &&
            allocation.lotId.startsWith("prepared-base-lot-"),
        ),
    ),
  );
  check(
    "raw requirement retains exact lot evidence",
    rice?.allocations.length === 1 &&
      rice.allocations[0].lotId === "raw-rice-lot-1" &&
      rice.allocations[0].normalizedQuantity === 150,
  );
  check("complete expected cost includes prepared stock", plan.expectedCost === 65, `${plan.expectedCost}`);
  check("known aggregate cost state is preserved", plan.costState === "known");
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
        "recalculation increments only the calculation version",
        reduced.plan.calculationVersion ===
          yielded.plan.calculationVersion + 1,
        `${reduced.plan.calculationVersion}`,
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

const unknownCost = calculateProductionPlan({
  ...input,
  planId: "plan-unknown",
  rawStock: rawStock.map((stock) =>
    stock.itemId === "sugar"
      ? {
          ...stock,
          costState: "unknown",
          authoritativeUnitCost: null,
        }
      : stock,
  ),
});
check(
  "one unknown exact lot cost propagates incomplete costing",
  unknownCost.ok &&
    !unknownCost.plan.costComplete &&
    unknownCost.plan.expectedCost === null &&
    unknownCost.plan.missingCostCount === 1 &&
    unknownCost.plan.knownCostSubtotal > 0,
);

const exactLotCostPlan = calculateProductionPlan({
  planId: "plan-exact-lot-cost",
  rootVersionId: "exact-lot-cost-v1",
  targetQuantity: 2,
  targetUnit: "pcs",
  mode: "prepare_fresh",
  versions: [
    {
      id: "exact-lot-cost-v1",
      familyId: "exact-lot-cost-family",
      outputItemId: "exact-lot-output",
      label: "Exact lot cost v1",
      businessId: "business-1",
      expectedOutputQuantity: 2,
      outputUnit: "pcs",
      status: "published",
      lines: [
        leaf(
          "exact-lot-line",
          "exact-lot-input",
          "Exact lot input",
          2,
          "pcs",
          "unknown",
          null,
        ),
      ],
    },
  ],
  preparedStock: [],
  rawStock: [
    {
      itemId: "exact-lot-input",
      lotKind: "ingredient",
      lotId: "exact-lot-a",
      allocationMode: "recommended_fifo",
      quantity: 1,
      unit: "pcs",
      costState: "known",
      authoritativeUnitCost: 2,
    },
    {
      itemId: "exact-lot-input",
      lotKind: "ingredient",
      lotId: "exact-lot-b",
      allocationMode: "recommended_fifo",
      quantity: 1,
      unit: "pcs",
      costState: "known",
      authoritativeUnitCost: 5,
    },
  ],
  observedAt: "2026-07-26T00:30:00.000Z",
});
check(
  "raw expected cost comes from exact selected lots",
  exactLotCostPlan.ok &&
    exactLotCostPlan.plan.costState === "known" &&
    exactLotCostPlan.plan.expectedCost === 7 &&
    exactLotCostPlan.plan.knownCostSubtotal === 7 &&
    exactLotCostPlan.plan.missingCostCount === 0,
  exactLotCostPlan.ok ? `${exactLotCostPlan.plan.expectedCost}` : "",
);

if (exactLotCostPlan.ok) {
  const exactAllocations =
    exactLotCostPlan.plan.rawRequirements[0].allocations;
  const partitions = partitionProductionPlanLotAllocations(
    exactAllocations,
    [1.5, 0.5],
  );
  check(
    "exact lots are assigned sequentially without proportional spreading",
    partitions[0].length === 2 &&
      partitions[0][0].lotId === "exact-lot-a" &&
      partitions[0][0].normalizedQuantity === 1 &&
      partitions[0][1].lotId === "exact-lot-b" &&
      partitions[0][1].normalizedQuantity === 0.5 &&
      partitions[1].length === 1 &&
      partitions[1][0].lotId === "exact-lot-b" &&
      partitions[1][0].normalizedQuantity === 0.5 &&
      !partitions[1].some(
        (allocation) => allocation.lotId === "exact-lot-a",
      ),
  );
  check(
    "partitioned exact-lot costs retain their contributions",
    partitions[0].reduce(
      (sum, allocation) => sum + allocation.costContribution,
      0,
    ) === 4.5 &&
      partitions[1].reduce(
        (sum, allocation) => sum + allocation.costContribution,
        0,
      ) === 2.5,
  );
}

const mixedExactLotCostPlan = calculateProductionPlan({
  planId: "plan-mixed-exact-lot-cost",
  rootVersionId: "mixed-exact-lot-cost-v1",
  targetQuantity: 2,
  targetUnit: "pcs",
  mode: "prepare_fresh",
  versions: [
    {
      id: "mixed-exact-lot-cost-v1",
      familyId: "mixed-exact-lot-cost-family",
      outputItemId: "mixed-exact-lot-output",
      label: "Mixed exact lot cost v1",
      businessId: "business-1",
      expectedOutputQuantity: 2,
      outputUnit: "pcs",
      status: "published",
      lines: [
        leaf(
          "mixed-exact-lot-line",
          "mixed-exact-lot-input",
          "Mixed exact lot input",
          2,
          "pcs",
          "known",
          99,
        ),
      ],
    },
  ],
  preparedStock: [],
  rawStock: [
    {
      itemId: "mixed-exact-lot-input",
      lotKind: "ingredient",
      lotId: "mixed-exact-lot-known",
      allocationMode: "manual",
      quantity: 1,
      unit: "pcs",
      costState: "known",
      authoritativeUnitCost: 2,
    },
    {
      itemId: "mixed-exact-lot-input",
      lotKind: "ingredient",
      lotId: "mixed-exact-lot-unknown",
      allocationMode: "manual",
      quantity: 1,
      unit: "pcs",
      costState: "unknown",
      authoritativeUnitCost: null,
    },
  ],
  observedAt: "2026-07-26T00:45:00.000Z",
});
check(
  "unknown selected lot cannot inherit a known Recipe snapshot",
  mixedExactLotCostPlan.ok &&
    mixedExactLotCostPlan.plan.costState === "partial" &&
    mixedExactLotCostPlan.plan.expectedCost === null &&
    mixedExactLotCostPlan.plan.knownCostSubtotal === 2 &&
    mixedExactLotCostPlan.plan.missingCostCount === 1,
);

const notApplicablePlan = calculateProductionPlan({
  planId: "plan-not-applicable",
  rootVersionId: "not-applicable-v1",
  targetQuantity: 10,
  targetUnit: "pcs",
  mode: "prepare_fresh",
  versions: [
    {
      id: "not-applicable-v1",
      familyId: "not-applicable-family",
      outputItemId: "not-applicable-output",
      label: "Not applicable v1",
      businessId: "business-1",
      expectedOutputQuantity: 10,
      outputUnit: "pcs",
      status: "published",
      lines: [
        leaf(
          "not-applicable-line",
          "free-input",
          "Free input",
          10,
          "pcs",
          "not_applicable",
          null,
        ),
      ],
    },
  ],
  preparedStock: [],
  rawStock: [
    {
      itemId: "free-input",
      lotKind: "ingredient",
      lotId: "free-input-lot",
      allocationMode: "manual",
      quantity: 10,
      unit: "pcs",
      costState: "not_applicable",
      authoritativeUnitCost: null,
    },
  ],
  observedAt: "2026-07-26T01:00:00.000Z",
});
check(
  "not-applicable cost is not rewritten as known zero",
  notApplicablePlan.ok &&
    notApplicablePlan.plan.costState === "not_applicable" &&
    notApplicablePlan.plan.expectedCost === null &&
    notApplicablePlan.plan.costComplete &&
    notApplicablePlan.plan.missingCostCount === 0,
);

const legacyCostPlan = calculateProductionPlan({
  planId: "plan-legacy-cost",
  rootVersionId: "legacy-cost-v1",
  targetQuantity: 10,
  targetUnit: "pcs",
  mode: "prepare_fresh",
  versions: [
    {
      id: "legacy-cost-v1",
      familyId: "legacy-cost-family",
      outputItemId: "legacy-cost-output",
      label: "Legacy cost v1",
      businessId: "business-1",
      expectedOutputQuantity: 10,
      outputUnit: "pcs",
      status: "published",
      lines: [
        leaf(
          "legacy-cost-line",
          "legacy-input",
          "Legacy input",
          10,
          "pcs",
          "legacy_zero_unresolved",
          null,
        ),
      ],
    },
  ],
  preparedStock: [],
  rawStock: [
    {
      itemId: "legacy-input",
      lotKind: "ingredient",
      lotId: "legacy-input-lot",
      allocationMode: "legacy_balance",
      quantity: 10,
      unit: "pcs",
      costState: "legacy_zero_unresolved",
      authoritativeUnitCost: null,
    },
  ],
  observedAt: "2026-07-26T01:30:00.000Z",
});
check(
  "legacy unresolved cost state remains explicit",
  legacyCostPlan.ok &&
    legacyCostPlan.plan.costState === "legacy_zero_unresolved" &&
    legacyCostPlan.plan.expectedCost === null &&
    !legacyCostPlan.plan.costComplete &&
    legacyCostPlan.plan.missingCostCount === 1,
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
