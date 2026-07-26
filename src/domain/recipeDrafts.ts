/**
 * Pure draft state and optimistic-revision rules.
 *
 * SQLite remains authoritative. These helpers model the compare-and-save,
 * restart recovery, and nested-return transitions that repositories perform in
 * one transaction. Every successful operation returns a new snapshot.
 */

export type InventoryDraftKind =
  | "catalog_item"
  | "recipe_family"
  | "recipe_version";

export type InventoryDraftStatus =
  | "editing"
  | "published"
  | "discarded";

export type DraftCostState =
  | "known"
  | "unknown"
  | "legacy_zero_unresolved"
  | "not_applicable";

export type DraftLineSourceKind =
  | "catalog_item"
  | "recipe_version"
  | "child_draft"
  | "unresolved";

export type InventoryDraftLine = {
  id: string;
  label: string;
  sourceKind: DraftLineSourceKind;
  sourceId: string | null;
  quantity: number | null;
  unit: string | null;
  costState: DraftCostState;
  optional: boolean;
};

export type DraftNestedReturn = {
  parentDraftId: string;
  parentLineId: string;
  returnRoute: string;
  state: "pending" | "resolved";
};

export type InventoryDraftPayload = {
  name: string | null;
  classification: string | null;
  outputCatalogItemId: string | null;
  expectedOutputQuantity: number | null;
  outputUnit: string | null;
  purchaseCost: number | null;
  purchaseCostState: DraftCostState;
  sellingPrice: number | null;
  sellingPriceState: DraftCostState;
  requestedProductionReady: boolean;
  requestedReadyForSale: boolean;
  notes: string | null;
};

export type InventoryDraft = {
  id: string;
  kind: InventoryDraftKind;
  businessId: string;
  branchId: string | null;
  sourceFamilyId: string | null;
  sourceVersionId: string | null;
  status: InventoryDraftStatus;
  revision: number;
  editorStep: string;
  payload: InventoryDraftPayload;
  lines: readonly InventoryDraftLine[];
  nestedReturn: DraftNestedReturn | null;
  publishedResultId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateInventoryDraftInput = {
  id: string;
  kind: InventoryDraftKind;
  businessId: string;
  branchId?: string | null;
  sourceFamilyId?: string | null;
  sourceVersionId?: string | null;
  editorStep?: string;
  payload?: Partial<InventoryDraftPayload>;
  lines?: readonly InventoryDraftLine[];
  nestedReturn?: DraftNestedReturn | null;
  now: string;
};

export type DraftUpdate = {
  expectedRevision: number;
  updatedAt: string;
  editorStep?: string;
  payload?: Partial<InventoryDraftPayload>;
  lines?: readonly InventoryDraftLine[];
};

export type DraftUpdateResult =
  | { ok: true; draft: InventoryDraft }
  | {
      ok: false;
      code: "revision_conflict" | "draft_not_editable";
      storedRevision: number;
    };

export type DraftAutosaveResult =
  | { ok: true; outcome: "saved" | "idempotent"; draft: InventoryDraft }
  | {
      ok: false;
      code: "wrong_draft" | "stale_revision" | "revision_collision" | "draft_not_editable";
      storedRevision: number;
    };

export type DraftCompletenessIssueCode =
  | "missing_name"
  | "unresolved_classification"
  | "missing_output_item"
  | "missing_expected_output"
  | "missing_output_unit"
  | "no_inputs"
  | "unresolved_input"
  | "invalid_input_quantity"
  | "missing_input_unit"
  | "missing_selling_price";

export type DraftCompleteness = {
  unresolved: readonly {
    code: DraftCompletenessIssueCode;
    lineId?: string;
  }[];
  warnings: readonly {
    code: "unknown_purchase_cost" | "unknown_input_cost";
    lineId?: string;
  }[];
  structurallyComplete: boolean;
  productionReady: boolean;
  saleReady: boolean;
};

export type DraftDiscardReferences = {
  hasPublishedResult: boolean;
  parentDraftIds: readonly string[];
  childDraftIds: readonly string[];
  externalReferenceIds: readonly string[];
};

export type DraftDiscardAssessment =
  | { allowed: true }
  | {
      allowed: false;
      code: "archive_or_resolve_required";
      references: readonly string[];
    };

const EMPTY_PAYLOAD: InventoryDraftPayload = {
  name: null,
  classification: null,
  outputCatalogItemId: null,
  expectedOutputQuantity: null,
  outputUnit: null,
  purchaseCost: null,
  purchaseCostState: "unknown",
  sellingPrice: null,
  sellingPriceState: "unknown",
  requestedProductionReady: false,
  requestedReadyForSale: false,
  notes: null,
};

function cloneLine(line: InventoryDraftLine): InventoryDraftLine {
  return { ...line };
}

function cloneDraft(draft: InventoryDraft): InventoryDraft {
  return {
    ...draft,
    payload: { ...draft.payload },
    lines: draft.lines.map(cloneLine),
    nestedReturn: draft.nestedReturn ? { ...draft.nestedReturn } : null,
  };
}

function snapshotsEqual(left: InventoryDraft, right: InventoryDraft) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createInventoryDraft(
  input: CreateInventoryDraftInput,
): InventoryDraft {
  return {
    id: input.id,
    kind: input.kind,
    businessId: input.businessId,
    branchId: input.branchId ?? null,
    sourceFamilyId: input.sourceFamilyId ?? null,
    sourceVersionId: input.sourceVersionId ?? null,
    status: "editing",
    revision: 0,
    editorStep: input.editorStep ?? "details",
    payload: { ...EMPTY_PAYLOAD, ...input.payload },
    lines: (input.lines ?? []).map(cloneLine),
    nestedReturn: input.nestedReturn ? { ...input.nestedReturn } : null,
    publishedResultId: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Compare-and-save transition for a repository `WHERE revision = ?` update.
 */
export function applyDraftUpdate(
  stored: InventoryDraft,
  update: DraftUpdate,
): DraftUpdateResult {
  if (stored.status !== "editing") {
    return {
      ok: false,
      code: "draft_not_editable",
      storedRevision: stored.revision,
    };
  }
  if (update.expectedRevision !== stored.revision) {
    return {
      ok: false,
      code: "revision_conflict",
      storedRevision: stored.revision,
    };
  }

  return {
    ok: true,
    draft: {
      ...stored,
      revision: stored.revision + 1,
      updatedAt: update.updatedAt,
      editorStep: update.editorStep ?? stored.editorStep,
      payload: { ...stored.payload, ...update.payload },
      lines: update.lines
        ? update.lines.map(cloneLine)
        : stored.lines.map(cloneLine),
      nestedReturn: stored.nestedReturn ? { ...stored.nestedReturn } : null,
    },
  };
}

/**
 * Applies a debounced local snapshot only when the stored revision is not
 * newer. Revision gaps are valid because multiple keystrokes may coalesce into
 * one SQLite write.
 */
export function acceptDraftAutosave(
  stored: InventoryDraft,
  incoming: InventoryDraft,
): DraftAutosaveResult {
  if (stored.id !== incoming.id) {
    return {
      ok: false,
      code: "wrong_draft",
      storedRevision: stored.revision,
    };
  }
  if (stored.status !== "editing" || incoming.status !== "editing") {
    return {
      ok: false,
      code: "draft_not_editable",
      storedRevision: stored.revision,
    };
  }
  if (incoming.revision < stored.revision) {
    return {
      ok: false,
      code: "stale_revision",
      storedRevision: stored.revision,
    };
  }
  if (incoming.revision === stored.revision) {
    if (snapshotsEqual(stored, incoming)) {
      return { ok: true, outcome: "idempotent", draft: cloneDraft(stored) };
    }
    return {
      ok: false,
      code: "revision_collision",
      storedRevision: stored.revision,
    };
  }

  return { ok: true, outcome: "saved", draft: cloneDraft(incoming) };
}

export function beginNestedDraft(input: {
  parent: InventoryDraft;
  parentExpectedRevision: number;
  parentLineId: string;
  childDraftId: string;
  childKind: InventoryDraftKind;
  returnRoute: string;
  now: string;
}):
  | {
      ok: true;
      parent: InventoryDraft;
      child: InventoryDraft;
    }
  | {
      ok: false;
      code: "parent_revision_conflict" | "parent_not_editable" | "parent_line_missing";
    } {
  const parentLine = input.parent.lines.find(
    (line) => line.id === input.parentLineId,
  );
  if (!parentLine) return { ok: false, code: "parent_line_missing" };

  const updatedLines = input.parent.lines.map((line) =>
    line.id === input.parentLineId
      ? {
          ...line,
          sourceKind: "child_draft" as const,
          sourceId: input.childDraftId,
        }
      : cloneLine(line),
  );
  const updatedParent = applyDraftUpdate(input.parent, {
    expectedRevision: input.parentExpectedRevision,
    updatedAt: input.now,
    lines: updatedLines,
  });

  if (!updatedParent.ok) {
    return {
      ok: false,
      code:
        updatedParent.code === "revision_conflict"
          ? "parent_revision_conflict"
          : "parent_not_editable",
    };
  }

  const child = createInventoryDraft({
    id: input.childDraftId,
    kind: input.childKind,
    businessId: input.parent.businessId,
    branchId: input.parent.branchId,
    nestedReturn: {
      parentDraftId: input.parent.id,
      parentLineId: input.parentLineId,
      returnRoute: input.returnRoute,
      state: "pending",
    },
    now: input.now,
  });

  return { ok: true, parent: updatedParent.draft, child };
}

/**
 * Models the atomic child-publication return update: the parent's stable
 * placeholder is replaced by the exact published child version.
 */
export function resolveNestedDraftReturn(input: {
  parent: InventoryDraft;
  child: InventoryDraft;
  publishedChildVersionId: string;
  now: string;
}):
  | { ok: true; parent: InventoryDraft; child: InventoryDraft }
  | {
      ok: false;
      code:
        | "return_context_missing"
        | "return_parent_mismatch"
        | "parent_not_editable"
        | "parent_placeholder_missing";
    } {
  const returnContext = input.child.nestedReturn;
  if (!returnContext) return { ok: false, code: "return_context_missing" };
  if (returnContext.parentDraftId !== input.parent.id) {
    return { ok: false, code: "return_parent_mismatch" };
  }
  if (input.parent.status !== "editing") {
    return { ok: false, code: "parent_not_editable" };
  }

  let replaced = false;
  const parentLines = input.parent.lines.map((line) => {
    if (
      line.id === returnContext.parentLineId &&
      line.sourceKind === "child_draft" &&
      line.sourceId === input.child.id
    ) {
      replaced = true;
      return {
        ...line,
        sourceKind: "recipe_version" as const,
        sourceId: input.publishedChildVersionId,
      };
    }
    return cloneLine(line);
  });
  if (!replaced) return { ok: false, code: "parent_placeholder_missing" };

  return {
    ok: true,
    parent: {
      ...input.parent,
      revision: input.parent.revision + 1,
      updatedAt: input.now,
      payload: { ...input.parent.payload },
      lines: parentLines,
      nestedReturn: input.parent.nestedReturn
        ? { ...input.parent.nestedReturn }
        : null,
    },
    child: {
      ...input.child,
      status: "published",
      revision: input.child.revision + 1,
      updatedAt: input.now,
      publishedResultId: input.publishedChildVersionId,
      payload: { ...input.child.payload },
      lines: input.child.lines.map(cloneLine),
      nestedReturn: { ...returnContext, state: "resolved" },
    },
  };
}

export function assessDraftCompleteness(
  draft: InventoryDraft,
): DraftCompleteness {
  const unresolved: {
    code: DraftCompletenessIssueCode;
    lineId?: string;
  }[] = [];
  const warnings: {
    code: "unknown_purchase_cost" | "unknown_input_cost";
    lineId?: string;
  }[] = [];

  if (!draft.payload.name?.trim()) unresolved.push({ code: "missing_name" });
  if (!draft.payload.classification?.trim()) {
    unresolved.push({ code: "unresolved_classification" });
  }

  if (draft.kind === "recipe_family" || draft.kind === "recipe_version") {
    if (!draft.payload.outputCatalogItemId?.trim()) {
      unresolved.push({ code: "missing_output_item" });
    }
    if (
      draft.payload.expectedOutputQuantity === null ||
      !Number.isFinite(draft.payload.expectedOutputQuantity) ||
      draft.payload.expectedOutputQuantity <= 0
    ) {
      unresolved.push({ code: "missing_expected_output" });
    }
    if (!draft.payload.outputUnit?.trim()) {
      unresolved.push({ code: "missing_output_unit" });
    }
    if (draft.lines.length === 0) unresolved.push({ code: "no_inputs" });
  }

  for (const line of draft.lines) {
    if (line.sourceKind === "unresolved" || !line.sourceId) {
      unresolved.push({ code: "unresolved_input", lineId: line.id });
    }
    if (
      line.quantity === null ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0
    ) {
      unresolved.push({ code: "invalid_input_quantity", lineId: line.id });
    }
    if (!line.unit?.trim()) {
      unresolved.push({ code: "missing_input_unit", lineId: line.id });
    }
    if (
      line.costState === "unknown" ||
      line.costState === "legacy_zero_unresolved"
    ) {
      warnings.push({ code: "unknown_input_cost", lineId: line.id });
    }
  }

  if (
    draft.payload.purchaseCostState === "unknown" ||
    draft.payload.purchaseCostState === "legacy_zero_unresolved"
  ) {
    warnings.push({ code: "unknown_purchase_cost" });
  }

  const sellingPriceKnown =
    draft.payload.sellingPriceState === "known" &&
    draft.payload.sellingPrice !== null &&
    Number.isFinite(draft.payload.sellingPrice) &&
    draft.payload.sellingPrice >= 0;
  if (draft.payload.requestedReadyForSale && !sellingPriceKnown) {
    unresolved.push({ code: "missing_selling_price" });
  }

  const structurallyComplete = unresolved.every(
    (issue) => issue.code === "missing_selling_price",
  );
  const productionReady =
    draft.status === "published" &&
    structurallyComplete &&
    draft.payload.requestedProductionReady;
  const saleReady =
    draft.status === "published" &&
    structurallyComplete &&
    sellingPriceKnown &&
    draft.payload.requestedReadyForSale;

  return {
    unresolved,
    warnings,
    structurallyComplete,
    productionReady,
    saleReady,
  };
}

/**
 * Draft records are never eligible for production or Kiosk selection,
 * regardless of how many fields happen to be filled.
 */
export function getDraftChannelEligibility(_draft: InventoryDraft): {
  kioskEligible: false;
  productionEligible: false;
  reasons: readonly ["draft_not_published"];
} {
  return {
    kioskEligible: false,
    productionEligible: false,
    reasons: ["draft_not_published"],
  };
}

export function assessDraftDiscard(
  draft: InventoryDraft,
  references: DraftDiscardReferences,
): DraftDiscardAssessment {
  const blocking = [
    ...(references.hasPublishedResult || draft.publishedResultId
      ? ["published_result"]
      : []),
    ...references.parentDraftIds.map((id) => `parent_draft:${id}`),
    ...references.childDraftIds.map((id) => `child_draft:${id}`),
    ...references.externalReferenceIds.map((id) => `external:${id}`),
  ];

  return blocking.length === 0
    ? { allowed: true }
    : {
        allowed: false,
        code: "archive_or_resolve_required",
        references: blocking,
      };
}

export function discardDraft(
  draft: InventoryDraft,
  references: DraftDiscardReferences,
  now: string,
):
  | { ok: true; draft: InventoryDraft }
  | { ok: false; assessment: DraftDiscardAssessment } {
  const assessment = assessDraftDiscard(draft, references);
  if (!assessment.allowed) return { ok: false, assessment };

  return {
    ok: true,
    draft: {
      ...cloneDraft(draft),
      status: "discarded",
      revision: draft.revision + 1,
      updatedAt: now,
    },
  };
}

function isRestorableDraft(value: unknown): value is InventoryDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InventoryDraft>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.businessId === "string" &&
    typeof candidate.revision === "number" &&
    Number.isInteger(candidate.revision) &&
    candidate.revision >= 0 &&
    Array.isArray(candidate.lines) &&
    Boolean(candidate.payload) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

export function restoreDraftSnapshot(
  serialized: string,
):
  | { ok: true; draft: InventoryDraft }
  | { ok: false; code: "invalid_json" | "invalid_snapshot" } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, code: "invalid_json" };
  }

  if (!isRestorableDraft(parsed)) {
    return { ok: false, code: "invalid_snapshot" };
  }

  return { ok: true, draft: cloneDraft(parsed) };
}
