/**
 * Focused pure-domain check for persisted draft revision and nested return rules.
 *
 * Compile first:
 * tsc src/domain/recipeDrafts.ts --outDir node_modules/.cache/kitamo-recipe-draft-check
 */

const {
  acceptDraftAutosave,
  applyDraftUpdate,
  assessDraftCompleteness,
  assessDraftDiscard,
  beginNestedDraft,
  createInventoryDraft,
  discardDraft,
  getDraftChannelEligibility,
  resolveNestedDraftReturn,
  restoreDraftSnapshot,
} = require("../node_modules/.cache/kitamo-recipe-draft-check/recipeDrafts.js");

let failures = 0;

function check(name, condition, details = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${name}: ${ok ? "OK" : "FAIL"}${details ? ` (${details})` : ""}`);
}

const parent = createInventoryDraft({
  id: "draft-parent",
  kind: "recipe_version",
  businessId: "business-1",
  branchId: "branch-1",
  payload: {
    name: "Musubi",
    classification: null,
    outputCatalogItemId: "item-musubi",
    expectedOutputQuantity: 10,
    outputUnit: "pcs",
    sellingPriceState: "unknown",
    sellingPrice: null,
    purchaseCostState: "not_applicable",
    requestedProductionReady: false,
    requestedReadyForSale: false,
    notes: "Keep this through nested editing",
  },
  lines: [
    {
      id: "parent-placeholder",
      label: "Cooked Rice",
      sourceKind: "unresolved",
      sourceId: null,
      quantity: 500,
      unit: "g",
      costState: "unknown",
      optional: false,
    },
  ],
  now: "2026-07-26T00:00:00.000Z",
});

const incomplete = assessDraftCompleteness(parent);
check("incomplete recipe draft can exist", parent.status === "editing");
check(
  "classification and placeholder remain explicit",
  incomplete.unresolved.some((issue) => issue.code === "unresolved_classification") &&
    incomplete.unresolved.some((issue) => issue.code === "unresolved_input"),
);
check(
  "unknown input cost is warning, not fabricated zero",
  incomplete.warnings.some((warning) => warning.code === "unknown_input_cost") &&
    parent.lines[0].costState === "unknown",
);

const firstSave = applyDraftUpdate(parent, {
  expectedRevision: 0,
  updatedAt: "2026-07-26T00:01:00.000Z",
  editorStep: "ingredients",
  payload: { classification: "finished_product" },
});
check("compare-and-save succeeds at expected revision", firstSave.ok);

if (firstSave.ok) {
  check("save preserves stable draft ID", firstSave.draft.id === parent.id);
  check("save increments revision exactly once", firstSave.draft.revision === 1);
  check("input snapshot is not mutated", parent.revision === 0 && parent.payload.classification === null);

  const stale = applyDraftUpdate(firstSave.draft, {
    expectedRevision: 0,
    updatedAt: "2026-07-26T00:02:00.000Z",
    payload: { name: "Stale edit" },
  });
  check(
    "stale save is rejected",
    !stale.ok && stale.code === "revision_conflict" && stale.storedRevision === 1,
  );

  const idempotent = acceptDraftAutosave(firstSave.draft, firstSave.draft);
  check(
    "same autosave snapshot is idempotent",
    idempotent.ok && idempotent.outcome === "idempotent",
  );

  const coalesced = {
    ...firstSave.draft,
    revision: 4,
    updatedAt: "2026-07-26T00:04:00.000Z",
    payload: { ...firstSave.draft.payload, name: "Musubi Updated" },
  };
  const coalescedSave = acceptDraftAutosave(firstSave.draft, coalesced);
  check(
    "coalesced keystroke revisions save once",
    coalescedSave.ok &&
      coalescedSave.outcome === "saved" &&
      coalescedSave.draft.revision === 4,
  );

  const nested = beginNestedDraft({
    parent: firstSave.draft,
    parentExpectedRevision: firstSave.draft.revision,
    parentLineId: "parent-placeholder",
    childDraftId: "draft-child",
    childKind: "recipe_version",
    returnRoute: "/owner/paluto/draft-parent",
    now: "2026-07-26T00:05:00.000Z",
  });
  check("nested draft begins from stable IDs", nested.ok);

  const staleNested = beginNestedDraft({
    parent: firstSave.draft,
    parentExpectedRevision: 0,
    parentLineId: "parent-placeholder",
    childDraftId: "draft-stale-child",
    childKind: "recipe_version",
    returnRoute: "/owner/paluto/draft-parent",
    now: "2026-07-26T00:05:00.000Z",
  });
  check(
    "stale nested begin leaves parent placeholder unchanged",
    !staleNested.ok &&
      staleNested.code === "parent_revision_conflict" &&
      firstSave.draft.lines[0].sourceKind === "unresolved" &&
      firstSave.draft.lines[0].sourceId === null,
  );

  if (nested.ok) {
    check(
      "parent placeholder points to child draft",
      nested.parent.lines[0].sourceKind === "child_draft" &&
        nested.parent.lines[0].sourceId === nested.child.id,
    );
    check(
      "child persists exact return context",
      nested.child.nestedReturn?.parentDraftId === parent.id &&
        nested.child.nestedReturn?.parentLineId === "parent-placeholder",
    );
    check(
      "parent entered fields survive nested navigation",
      nested.parent.payload.notes === "Keep this through nested editing",
    );

    const serialized = JSON.stringify(nested.child);
    const restored = restoreDraftSnapshot(serialized);
    check(
      "restart restores same child draft ID and revision",
      restored.ok &&
        restored.draft.id === nested.child.id &&
        restored.draft.revision === nested.child.revision,
    );

    const resolved = resolveNestedDraftReturn({
      parent: nested.parent,
      child: nested.child,
      publishedChildVersionId: "cooked-rice-v1",
      now: "2026-07-26T00:06:00.000Z",
    });
    check("published child resolves persisted return", resolved.ok);
    if (resolved.ok) {
      check(
        "parent pins exact published child version",
        resolved.parent.lines[0].sourceKind === "recipe_version" &&
          resolved.parent.lines[0].sourceId === "cooked-rice-v1",
      );
      check(
        "return resolution is restart-safe",
        resolved.child.nestedReturn?.state === "resolved" &&
          resolved.child.publishedResultId === "cooked-rice-v1",
      );
    }
  }
}

const eligibility = getDraftChannelEligibility(parent);
check(
  "draft is excluded from production and Kiosk",
  !eligibility.productionEligible && !eligibility.kioskEligible,
);

const blockedDiscard = assessDraftDiscard(parent, {
  hasPublishedResult: false,
  parentDraftIds: [],
  childDraftIds: ["draft-child"],
  externalReferenceIds: [],
});
check(
  "referenced draft cannot be permanently discarded",
  !blockedDiscard.allowed &&
    blockedDiscard.references.includes("child_draft:draft-child"),
);

const disposable = createInventoryDraft({
  id: "draft-disposable",
  kind: "catalog_item",
  businessId: "business-1",
  now: "2026-07-26T01:00:00.000Z",
});
const discarded = discardDraft(
  disposable,
  {
    hasPublishedResult: false,
    parentDraftIds: [],
    childDraftIds: [],
    externalReferenceIds: [],
  },
  "2026-07-26T01:01:00.000Z",
);
check(
  "provably unused draft can be explicitly discarded",
  discarded.ok &&
    discarded.draft.status === "discarded" &&
    discarded.draft.revision === 1,
);

check(
  "invalid restart snapshot fails closed",
  !restoreDraftSnapshot('{"id":"partial"}').ok,
);

if (failures === 0) {
  console.log("ALL RECIPE DRAFT CHECKS PASSED");
  process.exit(0);
}

console.error(`${failures} RECIPE DRAFT CHECKS FAILED`);
process.exit(1);
