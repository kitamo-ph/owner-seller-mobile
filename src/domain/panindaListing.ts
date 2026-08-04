/**
 * Paninda listing transitions — the missing link between "Recipe ready" and
 * "sellable in Kiosk".
 *
 * Publishing a Recipe deliberately leaves its Product projection unlisted: a
 * published definition is not automatically something the owner wants on sale.
 * Before this module existed there was no transition out of that state, so a
 * published Recipe could never reach Paninda `Active`, never be produced, and
 * never appear in Kiosk. Listing is the explicit owner act that completes it,
 * and unlisting reverses it so the decision is never one-way.
 *
 * Kiosk eligibility (see `listKioskEligibleCatalogProducts`) requires ALL of:
 *   binding.review_required = 0 · lifecycle_status = 'active' · sellable = 1
 *   kiosk_enabled = 1 · selling_price_state = 'known' · products.active = 1
 * This module is the single place that decides when those may be set together.
 */
import {
  LISTABLE_CLASSIFICATIONS,
  type CatalogClassification,
  type CatalogLifecycle,
  type CatalogReadinessState,
} from "./catalogItems";
import type { CostState } from "./costState";

export { LISTABLE_CLASSIFICATIONS };

export type ListingBlocker =
  | "owner_authorization_required"
  | "item_archived"
  | "classification_not_listable"
  | "recipe_not_published"
  | "missing_product_projection"
  | "binding_review_required"
  | "binding_archived"
  | "selling_price_required";

export type ListingEligibilityInput = {
  ownerAuthorized: boolean;
  classification: CatalogClassification;
  lifecycle: CatalogLifecycle;
  bindingStatus: "active" | "archived";
  bindingReviewRequired: boolean;
  hasProductProjection: boolean;
  /** True when a published Recipe version backs this item. */
  hasPublishedRecipe: boolean;
  /** True when the item is Recipe-backed at all (draft or published). */
  recipeBacked: boolean;
  sellingPriceState: CostState;
  /** Price the owner is submitting with this action, when supplying one. */
  submittedSellingPrice: number | null;
  /** Price already stored on the legacy Product projection. */
  existingSellingPrice: number | null;
};

export type ListingEligibility = {
  allowed: boolean;
  blockers: ListingBlocker[];
  /** The owner must supply a price before this item can be listed. */
  requiresSellingPrice: boolean;
  /** Price that will be persisted when the transition runs. */
  resolvedSellingPrice: number | null;
};

function hasUsablePrice(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Decides whether an item may move to `lifecycle_status = 'active'` and become
 * Kiosk-eligible. Fail-closed: any unmet requirement is reported as a blocker
 * rather than being silently repaired.
 */
export function evaluateListingEligibility(
  input: ListingEligibilityInput,
): ListingEligibility {
  const blockers: ListingBlocker[] = [];

  if (!input.ownerAuthorized) blockers.push("owner_authorization_required");
  if (input.lifecycle === "archived") blockers.push("item_archived");
  if (!LISTABLE_CLASSIFICATIONS.includes(input.classification)) {
    blockers.push("classification_not_listable");
  }
  if (!input.hasProductProjection) blockers.push("missing_product_projection");
  if (input.bindingStatus === "archived") blockers.push("binding_archived");
  if (input.bindingReviewRequired) blockers.push("binding_review_required");
  if (input.recipeBacked && !input.hasPublishedRecipe) {
    blockers.push("recipe_not_published");
  }

  const resolvedSellingPrice = hasUsablePrice(input.submittedSellingPrice)
    ? input.submittedSellingPrice
    : input.sellingPriceState === "known" &&
        hasUsablePrice(input.existingSellingPrice)
      ? input.existingSellingPrice
      : null;

  const requiresSellingPrice = resolvedSellingPrice === null;
  if (requiresSellingPrice) blockers.push("selling_price_required");

  return {
    allowed: blockers.length === 0,
    blockers,
    requiresSellingPrice,
    resolvedSellingPrice,
  };
}

export type UnlistEligibilityInput = {
  ownerAuthorized: boolean;
  lifecycle: CatalogLifecycle;
};

/**
 * Unlisting only needs owner authorization and a non-archived item. It never
 * removes history, stock, or the Recipe — it returns the item to `ready`.
 */
export function evaluateUnlistEligibility(input: UnlistEligibilityInput): {
  allowed: boolean;
  blockers: ListingBlocker[];
  alreadyUnlisted: boolean;
} {
  const blockers: ListingBlocker[] = [];
  if (!input.ownerAuthorized) blockers.push("owner_authorization_required");
  if (input.lifecycle === "archived") blockers.push("item_archived");
  return {
    allowed: blockers.length === 0,
    blockers,
    alreadyUnlisted: input.lifecycle !== "active",
  };
}

/**
 * Readiness a published Recipe output should carry.
 *
 * Publication previously hard-coded `incomplete`, which no writer could ever
 * clear. Readiness is now derived from the published definition itself.
 */
export function resolvePublishedReadinessState(input: {
  graphState: "complete" | "incomplete" | "legacy_review";
  hasInputLines: boolean;
}): CatalogReadinessState {
  if (input.graphState === "legacy_review") return "legacy_review";
  if (input.graphState !== "complete") return "incomplete";
  if (!input.hasInputLines) return "incomplete";
  return "ready";
}

/** Owner-facing Taglish copy. Every blocker states what to do next. */
export function describeListingBlocker(blocker: ListingBlocker): string {
  switch (blocker) {
    case "owner_authorization_required":
      return "Kailangan ng owner confirmation bago ilagay sa Tindahan.";
    case "item_archived":
      return "Naka-archive ang item. Ibalik muna ito bago ilagay sa Tindahan.";
    case "classification_not_listable":
      return "Ang uri ng item na ito ay hindi direktang binebenta sa Kiosk.";
    case "recipe_not_published":
      return "Tapusin at i-Mark Ready muna ang Recipe bago ito ibenta.";
    case "missing_product_projection":
      return "Walang Paninda record ang item na ito. Buksan ang Recipe at i-publish ulit.";
    case "binding_review_required":
      return "Kailangan pang i-review ang item bago ito ibenta.";
    case "binding_archived":
      return "Naka-archive ang Paninda record ng item na ito.";
    case "selling_price_required":
      return "Maglagay ng presyo bago ilagay sa Tindahan.";
    default:
      return "May kulang pang detalye bago ito maibenta.";
  }
}

/** Short reason for the Needs Setup row, so the owner sees the next action. */
export function summarizeListingBlockers(blockers: ListingBlocker[]): string {
  if (blockers.length === 0) return "Handa nang ilagay sa Tindahan.";
  return describeListingBlocker(blockers[0]);
}
