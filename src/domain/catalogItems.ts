import {
  type CostEvidence,
  type CostState,
  validateCostEvidence,
} from "./costState";

export const CATALOG_CLASSIFICATIONS = [
  "purchased_ingredient",
  "prepared_base",
  "finished_product",
  "direct_resale_product",
  "bundle_combo",
  "supply_packaging",
  "legacy_unclassified",
] as const;

export type CatalogClassification = (typeof CATALOG_CLASSIFICATIONS)[number];

export type CatalogLifecycle = "draft" | "ready" | "active" | "archived";
export type CatalogReadinessState =
  | "incomplete"
  | "ready"
  | "blocked"
  | "legacy_review";
export type CatalogCompatibilityMode = "native" | "reviewed_legacy" | "legacy_unclassified";
export type CatalogSourceType = "native" | "legacy_product" | "legacy_ingredient";
export type CatalogProjectionKind = "product" | "ingredient";

export type PanindaSection =
  | "active"
  | "needs_setup"
  | "archived"
  | "excluded";

export type PanindaCatalogPolicyInput = {
  classification: CatalogClassification;
  lifecycle: CatalogLifecycle;
  readinessState: CatalogReadinessState;
  compatibilityMode: CatalogCompatibilityMode;
  sourceType: CatalogSourceType;
  bindingStatus: "active" | "archived";
  stockPolicy: "untracked" | "ingredient_lots" | "product_scalar" | "product_lots";
  productActive: boolean;
  hasDraft: boolean;
  hasRecipe: boolean;
  hasPublishedRecipe: boolean;
};

export type PanindaActionPolicy = {
  openRecipe: boolean;
  produceFromRecipe: boolean;
  editSellingItem: boolean;
  addPurchasedStock: boolean;
  manualCompatibilityStockIn: boolean;
  recordSpoilage: boolean;
  transferStock: boolean;
  /** Put a ready item on sale — the transition that completes publication. */
  listForSale: boolean;
  /** Take an item off sale without touching history, stock, or its Recipe. */
  unlistFromSale: boolean;
  /** Reprice a listed item whose legacy edit form is withheld. */
  changeSellingPrice: boolean;
  archive: boolean;
  /** Return an archived item to `ready` so archiving is not a one-way trap. */
  restoreFromArchive: boolean;
  requestPermanentDelete: boolean;
};

export type ProductionSuccessContinuation =
  | "open_kiosk"
  | "list_for_sale"
  | "open_paninda";

/**
 * Chooses the post-Production action from existing authoritative decisions.
 * It deliberately does not reproduce listing or Kiosk eligibility rules:
 * callers supply the Paninda action policy and CatalogReadiness result.
 */
export function resolveProductionSuccessContinuation(input: {
  producedCatalogItemId: string;
  producedProductId: string;
  panindaCatalogItemId: string | null;
  panindaProductId: string | null;
  readinessProductId: string | null;
  availableInKiosk: boolean;
  listForSale: boolean;
}): ProductionSuccessContinuation {
  const exactProductResolved =
    input.panindaCatalogItemId === input.producedCatalogItemId &&
    input.panindaProductId === input.producedProductId &&
    input.readinessProductId === input.producedProductId;

  if (!exactProductResolved) return "open_paninda";

  // These authoritative results cannot both describe the same valid state.
  // Fail closed instead of guessing which one is stale or contradictory.
  if (input.availableInKiosk && input.listForSale) return "open_paninda";
  if (input.availableInKiosk) return "open_kiosk";
  if (input.listForSale) return "list_for_sale";
  return "open_paninda";
}

/** Returns only an authoritative, positive selling price for presentation. */
export function resolveKnownSellingPrice(input: {
  sellingPriceState: CostState;
  legacyPrice: number;
}): number | null {
  return input.sellingPriceState === "known" &&
    Number.isFinite(input.legacyPrice) &&
    input.legacyPrice > 0
    ? input.legacyPrice
    : null;
}

/** Classifications the owner may put on sale from Paninda. */
export const LISTABLE_CLASSIFICATIONS: readonly CatalogClassification[] = [
  "finished_product",
  "direct_resale_product",
  "bundle_combo",
  "legacy_unclassified",
] as const;

export type CatalogReadinessInput = {
  classification: CatalogClassification;
  lifecycle: CatalogLifecycle;
  readinessState: CatalogReadinessState;
  compatibilityMode: CatalogCompatibilityMode;
  sourceType: CatalogSourceType;
  reviewRequired: boolean;
  sellable: boolean;
  kioskEnabled: boolean;
  branchApplicable: boolean;
  sellingPrice: CostEvidence;
  hasPublishedRecipe: boolean;
  productionConfigurationComplete: boolean;
  saleConfigurationComplete: boolean;
  legacyVisibleUnderExistingPredicate: boolean;
  explicitlyBlocked: boolean;
};

export type CatalogReadinessIssue =
  | "draft"
  | "archived"
  | "classification_review_required"
  | "readiness_not_ready"
  | "classification_not_producible"
  | "missing_published_recipe"
  | "production_configuration_incomplete"
  | "classification_not_sellable"
  | "not_marked_sellable"
  | "selling_price_unknown"
  | "selling_price_legacy_unresolved"
  | "sale_configuration_incomplete"
  | "not_active"
  | "not_kiosk_enabled"
  | "branch_not_applicable"
  | "explicitly_blocked";

export type CatalogReadiness = {
  readyForProduction: boolean;
  readyForSale: boolean;
  availableInKiosk: boolean;
  kioskPolicy: "legacy_compatibility" | "native_readiness";
  issues: CatalogReadinessIssue[];
};

export type LegacyBinding = {
  catalogItemId: string;
  entityKind: CatalogProjectionKind;
  legacyEntityId: string;
  bindingStatus: "active" | "archived";
  compatibilityMode: CatalogCompatibilityMode;
  reviewState: "pending" | "reviewed";
  migrationProvenance: string;
};

export type BindingSetIssue = {
  index: number;
  reason:
    | "missing_identifier"
    | "missing_migration_provenance"
    | "duplicate_legacy_source"
    | "contradictory_catalog_binding";
  conflictingIndex: number | null;
};

const PRODUCT_CLASSIFICATIONS: readonly CatalogClassification[] = [
  "prepared_base",
  "finished_product",
  "direct_resale_product",
  "bundle_combo",
];

const INGREDIENT_CLASSIFICATIONS: readonly CatalogClassification[] = [
  "purchased_ingredient",
  "supply_packaging",
];

const NORMALLY_SELLABLE_CLASSIFICATIONS: readonly CatalogClassification[] = [
  "prepared_base",
  "finished_product",
  "direct_resale_product",
  "bundle_combo",
];

const PRODUCIBLE_CLASSIFICATIONS: readonly CatalogClassification[] = [
  "prepared_base",
  "finished_product",
];

export function isLegacyPanindaCompatibility(
  input: Pick<
    PanindaCatalogPolicyInput,
    "classification" | "compatibilityMode" | "sourceType"
  >,
) {
  return (
    input.sourceType === "legacy_product" &&
    input.classification === "legacy_unclassified" &&
    input.compatibilityMode === "legacy_unclassified"
  );
}

/**
 * Keeps the legacy Product list intact while applying catalog lifecycle rules
 * to native and owner-reviewed records. Recipe drafts and prepared bases remain
 * in Recipe Book, never in ordinary Paninda management.
 */
export function resolvePanindaSection(
  input: PanindaCatalogPolicyInput,
): PanindaSection {
  const productOwnedClassification =
    input.classification === "legacy_unclassified" ||
    input.classification === "direct_resale_product" ||
    input.classification === "finished_product" ||
    input.classification === "bundle_combo";

  if (
    input.lifecycle === "archived" ||
    input.bindingStatus === "archived"
  ) {
    return productOwnedClassification ? "archived" : "excluded";
  }

  if (isLegacyPanindaCompatibility(input)) {
    return "active";
  }

  if (input.classification === "direct_resale_product") {
    return input.lifecycle === "active" && input.productActive
      ? "active"
      : "needs_setup";
  }

  if (input.classification === "bundle_combo") {
    return input.lifecycle === "active" && input.productActive
      ? "active"
      : "needs_setup";
  }

  if (input.classification === "finished_product") {
    if (input.hasDraft && !input.hasPublishedRecipe) return "excluded";
    if (!input.hasPublishedRecipe) return "excluded";
    return input.lifecycle === "active" &&
      input.readinessState === "ready" &&
      input.productActive
      ? "active"
      : "needs_setup";
  }

  return "excluded";
}

/**
 * Native lot-tracked Products never receive a legacy scalar-stock action.
 * Those records navigate to Recipe/Production until exact lot mutation exists.
 */
export function resolvePanindaActionPolicy(
  input: PanindaCatalogPolicyInput,
): PanindaActionPolicy {
  const section = resolvePanindaSection(input);
  const legacyCompatibility = isLegacyPanindaCompatibility(input);
  const recipeBacked =
    (input.classification === "finished_product" || legacyCompatibility) &&
    (input.hasDraft || input.hasRecipe);
  const scalarCompatibility =
    legacyCompatibility || input.stockPolicy === "product_scalar";
  const normalItem = section === "active" || section === "needs_setup";

  // Listing is the transition that completes Recipe publication. An item that
  // is `needs_setup` only because it was never listed must be able to reach
  // `active`; without this the lifecycle terminates at publication.
  const listable =
    LISTABLE_CLASSIFICATIONS.includes(input.classification) &&
    (!recipeBacked || input.hasPublishedRecipe);

  return {
    openRecipe: normalItem && recipeBacked,
    produceFromRecipe: normalItem && recipeBacked && input.hasRecipe,
    // Recipe-backed items deliberately keep the legacy edit form withheld:
    // that form also renames the Product, which would desync from the Recipe
    // name snapshot on the next publish. Their price is set through the
    // dedicated listing/price transition instead.
    editSellingItem:
      normalItem &&
      (legacyCompatibility ||
        (!recipeBacked &&
          (input.classification === "direct_resale_product" ||
            input.classification === "bundle_combo"))),
    addPurchasedStock:
      normalItem &&
      !recipeBacked &&
      (legacyCompatibility || input.classification === "direct_resale_product"),
    manualCompatibilityStockIn: normalItem && legacyCompatibility,
    recordSpoilage: normalItem && scalarCompatibility,
    transferStock: normalItem && scalarCompatibility,
    listForSale: normalItem && listable && !input.productActive,
    unlistFromSale: normalItem && listable && input.productActive,
    // Without this a listed Recipe-backed item could never be repriced:
    // the legacy edit form is withheld and listing is already satisfied.
    changeSellingPrice: normalItem && listable && input.productActive,
    archive: section !== "archived" && section !== "excluded",
    restoreFromArchive: section === "archived",
    requestPermanentDelete:
      normalItem && !input.hasDraft && !input.hasRecipe,
  };
}

export function requiredProjectionForClassification(
  classification: CatalogClassification,
): CatalogProjectionKind | null {
  if (PRODUCT_CLASSIFICATIONS.includes(classification)) {
    return "product";
  }
  if (INGREDIENT_CLASSIFICATIONS.includes(classification)) {
    return "ingredient";
  }
  return null;
}

export function nativeCatalogDefaults(
  classification: CatalogClassification,
): Pick<
  CatalogReadinessInput,
  | "classification"
  | "lifecycle"
  | "readinessState"
  | "compatibilityMode"
  | "sourceType"
  | "reviewRequired"
  | "sellable"
  | "kioskEnabled"
  | "legacyVisibleUnderExistingPredicate"
  | "explicitlyBlocked"
> {
  return {
    classification,
    lifecycle: "draft",
    readinessState: "incomplete",
    compatibilityMode: "native",
    sourceType: "native",
    reviewRequired: classification === "legacy_unclassified",
    sellable: false,
    kioskEnabled: false,
    legacyVisibleUnderExistingPredicate: false,
    explicitlyBlocked: false,
  };
}

/**
 * Evaluates native readiness without tightening the migrated Kiosk predicate.
 *
 * `legacy_unclassified` Products remain on their exact compatibility predicate
 * until owner review. Draft/archived/explicitly blocked catalog state is still
 * an approved way to prevent visibility.
 */
export function evaluateCatalogReadiness(input: CatalogReadinessInput): CatalogReadiness {
  if (
    input.classification === "legacy_unclassified" &&
    input.compatibilityMode === "legacy_unclassified" &&
    input.sourceType === "legacy_product"
  ) {
    const issues: CatalogReadinessIssue[] = ["classification_review_required"];
    if (input.explicitlyBlocked) issues.push("explicitly_blocked");

    return {
      readyForProduction: false,
      readyForSale: false,
      availableInKiosk:
        input.legacyVisibleUnderExistingPredicate && !input.explicitlyBlocked,
      kioskPolicy: "legacy_compatibility",
      issues,
    };
  }

  const productionIssues: CatalogReadinessIssue[] = [];
  const saleIssues: CatalogReadinessIssue[] = [];
  const kioskIssues: CatalogReadinessIssue[] = [];

  if (input.lifecycle === "draft") {
    productionIssues.push("draft");
    saleIssues.push("draft");
  }
  if (input.lifecycle === "archived") {
    productionIssues.push("archived");
    saleIssues.push("archived");
  }
  if (input.classification === "legacy_unclassified" || input.reviewRequired) {
    productionIssues.push("classification_review_required");
    saleIssues.push("classification_review_required");
  }
  if (input.readinessState !== "ready") {
    productionIssues.push("readiness_not_ready");
    saleIssues.push("readiness_not_ready");
  }

  if (!PRODUCIBLE_CLASSIFICATIONS.includes(input.classification)) {
    productionIssues.push("classification_not_producible");
  }
  if (!input.hasPublishedRecipe) {
    productionIssues.push("missing_published_recipe");
  }
  if (!input.productionConfigurationComplete) {
    productionIssues.push("production_configuration_incomplete");
  }

  if (!NORMALLY_SELLABLE_CLASSIFICATIONS.includes(input.classification)) {
    saleIssues.push("classification_not_sellable");
  }
  if (!input.sellable) {
    saleIssues.push("not_marked_sellable");
  }

  const sellingPriceValidation = validateCostEvidence(input.sellingPrice);
  if (!sellingPriceValidation.ok || input.sellingPrice.state === "unknown") {
    saleIssues.push("selling_price_unknown");
  } else if (input.sellingPrice.state === "legacy_zero_unresolved") {
    saleIssues.push("selling_price_legacy_unresolved");
  } else if (input.sellingPrice.state === "not_applicable") {
    saleIssues.push("selling_price_unknown");
  }

  if (!input.saleConfigurationComplete) {
    saleIssues.push("sale_configuration_incomplete");
  }

  const readyForProduction = productionIssues.length === 0;
  const readyForSale = saleIssues.length === 0;

  if (!readyForSale) {
    kioskIssues.push(...saleIssues);
  }
  if (input.lifecycle !== "active") {
    kioskIssues.push("not_active");
  }
  if (!input.kioskEnabled) {
    kioskIssues.push("not_kiosk_enabled");
  }
  if (!input.branchApplicable) {
    kioskIssues.push("branch_not_applicable");
  }
  if (input.explicitlyBlocked) {
    kioskIssues.push("explicitly_blocked");
  }

  return {
    readyForProduction,
    readyForSale,
    availableInKiosk: kioskIssues.length === 0,
    kioskPolicy: "native_readiness",
    issues: [...new Set([...productionIssues, ...saleIssues, ...kioskIssues])],
  };
}

/**
 * Exact binding validation is deliberately name-blind.
 *
 * One source row can bind to only one catalog item, and one catalog item can
 * bind to only one legacy source row. A failure is returned for the caller to
 * reject transactionally; no binding is guessed or replaced.
 */
export function validateLegacyBindingSet(
  bindings: readonly LegacyBinding[],
): { ok: true } | { ok: false; issues: BindingSetIssue[] } {
  const issues: BindingSetIssue[] = [];
  const sourceIndexes = new Map<string, number>();
  const catalogIndexes = new Map<string, number>();

  bindings.forEach((binding, index) => {
    if (!binding.catalogItemId.trim() || !binding.legacyEntityId.trim()) {
      issues.push({
        index,
        reason: "missing_identifier",
        conflictingIndex: null,
      });
    }
    if (!binding.migrationProvenance.trim()) {
      issues.push({
        index,
        reason: "missing_migration_provenance",
        conflictingIndex: null,
      });
    }

    const sourceKey = `${binding.entityKind}:${binding.legacyEntityId}`;
    const priorSourceIndex = sourceIndexes.get(sourceKey);
    if (priorSourceIndex !== undefined) {
      issues.push({
        index,
        reason: "duplicate_legacy_source",
        conflictingIndex: priorSourceIndex,
      });
    } else {
      sourceIndexes.set(sourceKey, index);
    }

    const priorCatalogIndex = catalogIndexes.get(binding.catalogItemId);
    if (priorCatalogIndex !== undefined) {
      const prior = bindings[priorCatalogIndex];
      if (
        prior.entityKind !== binding.entityKind ||
        prior.legacyEntityId !== binding.legacyEntityId
      ) {
        issues.push({
          index,
          reason: "contradictory_catalog_binding",
          conflictingIndex: priorCatalogIndex,
        });
      }
    } else {
      catalogIndexes.set(binding.catalogItemId, index);
    }
  });

  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
