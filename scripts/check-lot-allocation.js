/**
 * Focused Phase B checks for explicit selected-lot, FEFO/FIFO, split, manual,
 * conversion, and exact-cost allocation.
 */
const {
  knownCost,
  unknownCost,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/costState.js");
const {
  planLotAllocation,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/lotAllocation.js");

let failures = 0;
function check(name, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`${name}: ${condition ? "OK" : `FAIL ${detail}`}`);
}

function lot(overrides) {
  return {
    lotId: "lot",
    itemId: "rice",
    remainingQuantity: 10,
    unit: "kg",
    status: "active",
    isUsable: true,
    expiryDate: null,
    purchaseDate: "2026-01-01",
    createdAt: "2026-01-01T00:00:00.000Z",
    costPerLotUnit: knownCost(10),
    ...overrides,
  };
}

const legacy = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 2,
  requestUnit: "kg",
  mode: "legacy_selected",
  legacySelectedLotId: "newer",
  candidates: [
    lot({ lotId: "older", purchaseDate: "2025-01-01" }),
    lot({ lotId: "newer", purchaseDate: "2026-01-01" }),
  ],
});
check(
  "legacy selected lot remains exact rather than FIFO",
  legacy.ok &&
    legacy.mode === "legacy_selected" &&
    legacy.contributions.length === 1 &&
    legacy.contributions[0].lotId === "newer",
);

const fifo = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 12,
  requestUnit: "kg",
  mode: "automatic",
  candidates: [
    lot({ lotId: "new", remainingQuantity: 10, purchaseDate: "2026-02-01" }),
    lot({ lotId: "old", remainingQuantity: 5, purchaseDate: "2026-01-01" }),
  ],
});
check(
  "FIFO recommends oldest purchase and splits",
  fifo.ok &&
    fifo.mode === "recommended_fifo" &&
    fifo.contributions[0].lotId === "old" &&
    fifo.contributions[0].quantityInLotUnit === 5 &&
    fifo.contributions[1].quantityInLotUnit === 7,
);

const fefo = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 7,
  requestUnit: "kg",
  mode: "automatic",
  candidates: [
    lot({
      lotId: "no-expiry",
      remainingQuantity: 10,
      purchaseDate: "2025-01-01",
    }),
    lot({
      lotId: "later-expiry",
      remainingQuantity: 5,
      expiryDate: "2026-08-01",
    }),
    lot({
      lotId: "earlier-expiry",
      remainingQuantity: 5,
      expiryDate: "2026-07-01",
    }),
  ],
});
check(
  "FEFO places valid earliest expiry before FIFO-only stock",
  fefo.ok &&
    fefo.mode === "recommended_fefo" &&
    fefo.contributions[0].lotId === "earlier-expiry" &&
    fefo.contributions[1].lotId === "later-expiry",
);

const manual = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 5,
  requestUnit: "kg",
  mode: "manual",
  candidates: [
    lot({ lotId: "a", costPerLotUnit: knownCost(10) }),
    lot({ lotId: "b", costPerLotUnit: knownCost(20) }),
  ],
  manualSelections: [
    { lotId: "a", quantityInLotUnit: 2 },
    { lotId: "b", quantityInLotUnit: 3 },
  ],
});
check(
  "manual split preserves exact differently priced contributions",
  manual.ok &&
    manual.mode === "manual" &&
    manual.cost.total === 80 &&
    manual.contributions[0].costContribution === 20 &&
    manual.contributions[1].costContribution === 60,
);

const conversion = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 1500,
  requestUnit: "g",
  mode: "automatic",
  candidates: [
    lot({
      lotId: "kg-lot",
      remainingQuantity: 2,
      unit: "kg",
      requestUnitsPerLotUnit: 1000,
      conversionVersionId: "builtin-mass-v1",
    }),
  ],
});
check(
  "conversion snapshot preserves lot and normalized quantities",
  conversion.ok &&
    conversion.contributions[0].quantityInLotUnit === 1.5 &&
    conversion.contributions[0].normalizedQuantity === 1500 &&
    conversion.contributions[0].conversionVersionId === "builtin-mass-v1",
);

const insufficient = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 20,
  requestUnit: "kg",
  mode: "automatic",
  candidates: [lot({ lotId: "only", remainingQuantity: 3 })],
});
check(
  "insufficient total stock returns explicit shortfall",
  !insufficient.ok &&
    insufficient.reason === "insufficient_stock" &&
    insufficient.allocatedQuantity === 3 &&
  insufficient.shortageQuantity === 17,
);

check(
  "duplicate lot candidates fail closed",
  planLotAllocation({
    itemId: "rice",
    requiredQuantity: 1,
    requestUnit: "kg",
    mode: "automatic",
    candidates: [lot({ lotId: "same" }), lot({ lotId: "same" })],
  }).reason === "duplicate_candidate",
);

const unknownCostPlan = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 1,
  requestUnit: "kg",
  mode: "automatic",
  candidates: [lot({ lotId: "unknown", costPerLotUnit: unknownCost(0) })],
});
check(
  "unknown lot cost propagates incomplete costing",
  unknownCostPlan.ok &&
    !unknownCostPlan.cost.complete &&
    unknownCostPlan.cost.total === null,
);

const mutableLot = lot({ lotId: "history", costPerLotUnit: knownCost(15) });
const historicalPlan = planLotAllocation({
  itemId: "rice",
  requiredQuantity: 2,
  requestUnit: "kg",
  mode: "automatic",
  candidates: [mutableLot],
});
mutableLot.costPerLotUnit = knownCost(99);
check(
  "later purchase-data change does not alter allocation snapshot",
  historicalPlan.ok &&
    historicalPlan.contributions[0].costPerLotUnitSnapshot === 15 &&
    historicalPlan.cost.total === 30,
);

if (failures === 0) {
  console.log("ALL LOT ALLOCATION CHECKS PASSED");
  process.exit(0);
}
console.error(`${failures} LOT ALLOCATION CHECKS FAILED`);
process.exit(1);
