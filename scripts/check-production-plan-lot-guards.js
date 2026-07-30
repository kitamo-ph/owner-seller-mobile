/**
 * Focused structural checks for persistence guards that cannot run in the
 * pure-domain planner harness.
 */

const fs = require("node:fs");
const path = require("node:path");

let failures = 0;

function check(name, condition) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${name}: ${ok ? "OK" : "FAIL"}`);
}

function source(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const plans = source("src/db/repositories/productionPlans.ts");
const planService = source("src/services/productionPlanner.ts");
const planDomain = source("src/domain/productionPlanner.ts");
const productLots = source("src/db/repositories/productStockLots.ts");
const ingredientLots = source("src/db/repositories/ingredientLots.ts");

check(
  "planner replaces detached recipe versions with persisted graph",
  planService.includes("loadRecipeVersionGraph(") &&
    planService.includes("versions,") &&
    planService.includes("const trustedPlanner"),
);
check(
  "planner requires exact caller stock evidence",
  planService.includes("assertExactStockEvidence(input.planner)") &&
    planService.includes("Persisted production plans require exact lot"),
);
check(
  "plan repository validates exact persisted evidence before write",
  plans.includes("await validatePersistedPlanEvidence(input, versionById, txn)"),
);
check(
  "plan recalculation is sequential and replaces child snapshots",
  plans.includes("existingPlan.calculation_version + 1") &&
    plans.includes("DELETE FROM production_plan_allocations") &&
    plans.includes("UPDATE production_plans"),
);
check(
  "plan recalculation rejects execution evidence",
  plans.includes("Production-plan execution evidence blocks recalculation") &&
    plans.includes("production_input_allocations"),
);
check(
  "ready plan requires complete exact stock allocations",
  plans.includes("Ready production plan lacks complete exact stock allocation"),
);
check(
  "raw plan cost is derived from allocated lot evidence",
  planDomain.includes("exactKnownCostSubtotal") &&
    planDomain.includes("allocation.knownCostSubtotal") &&
    planDomain.includes("knownCostSubtotal: exactKnownCostSubtotal"),
);
check(
  "stage persistence partitions exact lots without proportional spreading",
  planService.includes("partitionProductionPlanLotAllocations(") &&
    planService.includes("allocations: groupAllocations.map(mapAllocation)") &&
    !planService.includes("mapAllocation(allocation, ratio)"),
);
check(
  "repository rejects requirement cost detached from exact lots",
  plans.includes(
    "Production requirement cost does not match exact lot allocations.",
  ) &&
    plans.includes(
      "Production-plan cost does not match persisted requirement evidence.",
    ),
);
check(
  "superseded pinned child versions remain plannable",
  plans.includes('["published", "superseded"].includes(version.status)') &&
    plans.includes('rootVersion.status !== "published"'),
);
check(
  "Product lot unit is tied to Product stock unit",
  productLots.includes("input.unit.trim() !== product.unit_type") &&
    productLots.includes("Product lots contain contradictory stock units"),
);
check(
  "Product lot known cost arithmetic is validated",
  productLots.includes("totalCost - unitCost * quantity") &&
    productLots.includes("consistent non-negative values"),
);
check(
  "Product lot origin references are tenant and subject checked",
  productLots.includes("validateProductLotOrigin") &&
    productLots.includes("batch.business_id !== input.businessId") &&
    productLots.includes("batch.output_product_id !== input.productId") &&
    productLots.includes("receipt.business_id !== input.businessId"),
);
check(
  "Ingredient lot accepts explicit non-known and known-zero cost states",
  ingredientLots.includes("z.number().nonnegative().nullable().optional()") &&
    ingredientLots.includes('"legacy_zero_unresolved"') &&
    ingredientLots.includes("recordedTotalCost === null"),
);
check(
  "Ingredient lot exposes authoritative cost and provenance columns",
  ingredientLots.includes("recordedTotalCost: row.recorded_total_cost") &&
    ingredientLots.includes("costState: row.cost_state") &&
    ingredientLots.includes("purchaseReceiptId: row.purchase_receipt_id"),
);
check(
  "Ingredient non-known costs persist NULL authoritative evidence",
  ingredientLots.includes("recordedTotalCost ?? 0") &&
    ingredientLots.includes("costState === \"known\" ?") &&
    ingredientLots.includes("lot.recordedCostPerUnit"),
);

if (failures === 0) {
  console.log("ALL PRODUCTION PLAN AND LOT GUARD CHECKS PASSED");
  process.exit(0);
}

console.error(`${failures} PRODUCTION PLAN AND LOT GUARD CHECKS FAILED`);
process.exit(1);
