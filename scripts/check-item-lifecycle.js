/**
 * Focused Phase B checks for fail-closed permanent-delete and archive behavior.
 */
const {
  PROTECTED_ITEM_REFERENCE_KINDS,
  evaluateArchiveEligibility,
  evaluatePermanentDeleteEligibility,
  itemVisibilityForLifecycle,
} = require("../node_modules/.cache/kitamo-inventory-domain-check/itemLifecycle.js");

let failures = 0;
function check(name, condition) {
  if (!condition) failures += 1;
  console.log(`${name}: ${condition ? "OK" : "FAIL"}`);
}

const noReferences = Object.fromEntries(
  PROTECTED_ITEM_REFERENCE_KINDS.map((kind) => [kind, 0]),
);
check(
  "provably unused owner record may be permanently deleted",
  evaluatePermanentDeleteEligibility({
    ownerAuthorized: true,
    referenceCounts: noReferences,
  }).outcome === "allowed",
);
check(
  "seller cannot permanently delete",
  evaluatePermanentDeleteEligibility({
    ownerAuthorized: false,
    referenceCounts: noReferences,
  }).outcome === "owner_authorization_required",
);

const used = evaluatePermanentDeleteEligibility({
  ownerAuthorized: true,
  referenceCounts: { ...noReferences, sale: 1, adjustment: 2 },
});
check(
  "any protected history requires archive",
  used.outcome === "archive_required" &&
    used.blockingReferences.includes("sale") &&
    used.blockingReferences.includes("adjustment"),
);

const incompleteCheck = evaluatePermanentDeleteEligibility({
  ownerAuthorized: true,
  referenceCounts: { ...noReferences, production: null },
});
check(
  "uncertain reference check fails closed",
  incompleteCheck.outcome === "denied_fail_closed" &&
    incompleteCheck.blockingReferences.includes("production"),
);
check(
  "missing reference category fails closed",
  evaluatePermanentDeleteEligibility({
    ownerAuthorized: true,
    referenceCounts: {},
  }).outcome === "denied_fail_closed",
);
check(
  "cascade metadata is irrelevant to eligibility",
  !PROTECTED_ITEM_REFERENCE_KINDS.includes("cascade_delete"),
);

check(
  "archive requires owner boundary",
  !evaluateArchiveEligibility({
    ownerAuthorized: false,
    lifecycle: "active",
  }).allowed,
);
const archived = evaluateArchiveEligibility({
  ownerAuthorized: true,
  lifecycle: "archived",
});
check(
  "repeat archive is safe and explicit",
  archived.allowed && archived.alreadyArchived,
);

const archivedVisibility = itemVisibilityForLifecycle("archived");
check(
  "archived item leaves normal/Kiosk selection but remains historical",
  !archivedVisibility.normalSelection &&
    !archivedVisibility.kioskCandidate &&
    archivedVisibility.historicalLookup,
);
const draftVisibility = itemVisibilityForLifecycle("draft");
check(
  "draft stays outside production/Kiosk selectors",
  !draftVisibility.normalSelection && !draftVisibility.kioskCandidate,
);

if (failures === 0) {
  console.log("ALL ITEM LIFECYCLE CHECKS PASSED");
  process.exit(0);
}
console.error(`${failures} ITEM LIFECYCLE CHECKS FAILED`);
process.exit(1);
