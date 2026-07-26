import { type CatalogLifecycle } from "./catalogItems";

export const PROTECTED_ITEM_REFERENCE_KINDS = [
  "purchase",
  "lot",
  "movement",
  "recipe_reference",
  "recipe_version_reference",
  "production",
  "sale",
  "bundle_reference",
  "supply_rule_reference",
  "order_supply_usage",
  "adjustment",
  "historical_report_dependency",
] as const;

export type ProtectedItemReferenceKind =
  (typeof PROTECTED_ITEM_REFERENCE_KINDS)[number];

export type ItemReferenceCounts = Record<
  ProtectedItemReferenceKind,
  number | null
>;

export type PermanentDeleteEligibility =
  | { outcome: "allowed"; blockingReferences: [] }
  | {
      outcome: "owner_authorization_required";
      blockingReferences: [];
    }
  | {
      outcome: "archive_required";
      blockingReferences: ProtectedItemReferenceKind[];
    }
  | {
      outcome: "denied_fail_closed";
      blockingReferences: ProtectedItemReferenceKind[];
    };

/**
 * Permanent delete is fail-closed. Missing, invalid, or failed reference checks
 * deny deletion; cascade behavior is never interpreted as authorization.
 */
export function evaluatePermanentDeleteEligibility(input: {
  ownerAuthorized: boolean;
  referenceCounts: Partial<ItemReferenceCounts>;
}): PermanentDeleteEligibility {
  if (!input.ownerAuthorized) {
    return {
      outcome: "owner_authorization_required",
      blockingReferences: [],
    };
  }

  const uncertain: ProtectedItemReferenceKind[] = [];
  const present: ProtectedItemReferenceKind[] = [];

  for (const kind of PROTECTED_ITEM_REFERENCE_KINDS) {
    const count = input.referenceCounts[kind];
    if (
      count === undefined ||
      count === null ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      uncertain.push(kind);
    } else if (count > 0) {
      present.push(kind);
    }
  }

  if (uncertain.length > 0) {
    return {
      outcome: "denied_fail_closed",
      blockingReferences: uncertain,
    };
  }
  if (present.length > 0) {
    return {
      outcome: "archive_required",
      blockingReferences: present,
    };
  }
  return { outcome: "allowed", blockingReferences: [] };
}

export function evaluateArchiveEligibility(input: {
  ownerAuthorized: boolean;
  lifecycle: CatalogLifecycle;
}):
  | { allowed: true; alreadyArchived: boolean }
  | { allowed: false; reason: "owner_authorization_required" } {
  if (!input.ownerAuthorized) {
    return { allowed: false, reason: "owner_authorization_required" };
  }
  return {
    allowed: true,
    alreadyArchived: input.lifecycle === "archived",
  };
}

export function itemVisibilityForLifecycle(
  lifecycle: CatalogLifecycle,
): {
  normalSelection: boolean;
  historicalLookup: true;
  kioskCandidate: boolean;
} {
  const normallyVisible = lifecycle === "ready" || lifecycle === "active";
  return {
    normalSelection: normallyVisible,
    historicalLookup: true,
    kioskCandidate: lifecycle === "active",
  };
}
