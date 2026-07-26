/**
 * Focused Phase B checks for explicit optional/unknown cost semantics.
 */
const {
  aggregateCosts,
  knownCost,
  legacyZeroUnresolvedCost,
  notApplicableCost,
  unknownCost,
  validateCostEvidence,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/costState.js");

let failures = 0;
function check(name, condition) {
  if (!condition) failures += 1;
  console.log(`${name}: ${condition ? "OK" : "FAIL"}`);
}

check(
  "known positive cost is authoritative",
  validateCostEvidence(knownCost(12.5)).ok,
);
const zero = knownCost(0);
check(
  "known zero remains explicit and complete",
  zero.state === "known" && zero.amount === 0,
);
const unknown = unknownCost(0);
check(
  "native unknown ignores compatibility zero",
  unknown.state === "unknown" &&
    unknown.amount === null &&
    unknown.legacyValue === 0,
);
const legacyZero = legacyZeroUnresolvedCost();
check(
  "legacy zero remains preserved but unresolved",
  legacyZero.amount === null && legacyZero.legacyValue === 0,
);
check(
  "legacy unresolved cannot carry nonzero evidence",
  !validateCostEvidence({
    state: "legacy_zero_unresolved",
    amount: null,
    legacyValue: 1,
  }).ok,
);

const knownTotal = aggregateCosts([knownCost(10), knownCost(0), knownCost(2.5)]);
check(
  "known aggregation includes known zero",
  knownTotal.ok &&
    knownTotal.cost.complete &&
    knownTotal.cost.total === 12.5,
);
const incomplete = aggregateCosts([
  knownCost(10),
  unknownCost(),
  legacyZeroUnresolvedCost(),
]);
check(
  "one unknown makes required total incomplete, never zero-filled",
  incomplete.ok &&
    !incomplete.cost.complete &&
    incomplete.cost.total === null &&
    incomplete.cost.knownSubtotal === 10 &&
    incomplete.cost.unresolvedStates.includes("unknown") &&
    incomplete.cost.unresolvedStates.includes("legacy_zero_unresolved"),
);
const notApplicable = aggregateCosts([
  notApplicableCost(),
  notApplicableCost(),
]);
check(
  "not-applicable costs do not fabricate a zero total",
  notApplicable.ok &&
    notApplicable.cost.state === "not_applicable" &&
    notApplicable.cost.total === null,
);

const historical = { cogsTotal: 123.45, evidence: legacyZero };
aggregateCosts([historical.evidence]);
check(
  "cost-state calculations do not rewrite historical COGS",
  historical.cogsTotal === 123.45 && historical.evidence.legacyValue === 0,
);

if (failures === 0) {
  console.log("ALL COST STATE CHECKS PASSED");
  process.exit(0);
}
console.error(`${failures} COST STATE CHECKS FAILED`);
process.exit(1);
