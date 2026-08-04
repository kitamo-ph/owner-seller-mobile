import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  activateCatalogCostProfileInTransaction,
  archiveCatalogItem,
  createItemUnitConversion,
  createItemUnitConversionInTransaction,
  createRecipeVersionCostSummary,
  getActiveCatalogCostProfile,
  getCatalogCostProfileByRequestToken,
  getCatalogItemReferenceCounts,
  getRecipeDraftById,
  getRecipeVersionById,
  getRecipeVersionCostSummary,
  listCatalogCostProfileHistory,
  listRecipeDraftLines,
  listRecipeVersionLines,
  saveRecipeDraft,
  type CatalogCostProfileRecord,
  type RecipeDraftLineRecord,
  type RecipeDraftRecord,
  type RecipeLineCostSource,
  type RecipeVersionCostSummaryStatus,
  type RecipeVersionLineRecord,
  type RecipeVersionRecord,
  type RepositoryDatabase,
  type SaveRecipeDraftInput,
} from "@/db/repositories";
import {
  makeCatalogCostProfileId,
  makeCatalogItemId,
  makeLegacyBindingId,
  makeProductId,
  makeRecipeDraftId,
  makeRecipeDraftLineId,
  makeRecipeId,
  makeRecipeVersionCostSummaryId,
  makeRecipeVersionId,
  makeUnitConversionId,
} from "@/domain/ids";
import type {
  RecipeVersionDraft,
  RecipeVersionDraftInput,
  VersionCostState,
} from "@/domain/recipeVersioning";
import {
  standardRecipeUnitFactor,
  validateRecipeConversionSnapshotEvidence,
} from "@/domain/recipeConversionChains";
import { resolvePublishedReadinessState } from "@/domain/panindaListing";
import {
  mapLibraryEntryToPickerEntry,
  type RecipeIngredientPickerEntry,
  type RecipeIngredientPickerGroup,
} from "@/domain/recipeIngredientPickerView";

import { publishValidatedRecipeDraftInTransaction } from "./recipeVersioning";

export type { RecipeIngredientPickerEntry, RecipeIngredientPickerGroup };

export type RecipeFirstMode =
  | "finished_per_unit"
  | "prepared_batch"
  | "unsure";

export type RecipeFirstIdentityIds = {
  catalogItemId?: string;
  productId?: string;
  bindingId?: string;
  draftId?: string;
};

export type StartRecipeFirstDraftInput = {
  businessId: string;
  branchId?: string | null;
  name: string;
  category?: string | null;
  notes?: string | null;
  mode: RecipeFirstMode;
  ids?: RecipeFirstIdentityIds;
};

export type RecipeFirstDraftSnapshot = {
  draft: RecipeDraftRecord;
  lines: RecipeDraftLineRecord[];
  resolvedLines: RecipeFirstResolvedLine[];
  output: {
    catalogItemId: string;
    productId: string | null;
    name: string;
    classification: string;
    lifecycle: string;
    readinessState: string;
    sellable: boolean;
    kioskEnabled: boolean;
    productActive: boolean | null;
  };
  costProfiles: CatalogCostProfileRecord[];
};

export type RecipeFirstResolvedLine = {
  lineId: string;
  displayName: string;
  classification: string | null;
  category: string | null;
  sourceLabel: string;
  sourceDetail: string | null;
  costLabel: "Actual cost" | "Estimated cost" | "No price yet" | "Cost incomplete";
  conversionSummary: string | null;
  childLifecycle: string | null;
  missingReason: string | null;
  profileTotalCost: number | null;
  profileReferenceQuantity: number | null;
  profileReferenceUnit: string | null;
  sourceCatalogItemId?: string | null;
  pinnedRecipeVersionId?: string | null;
  pinnedOutputQuantity?: number | null;
  pinnedOutputUnit?: string | null;
};

export type RecipeFirstLibraryEntry = {
  catalogItemId: string;
  productId: string | null;
  ingredientId: string | null;
  name: string;
  sourceType: string;
  classification: string;
  lifecycle: string;
  readinessState: string;
  compatibilityMode: string | null;
  reviewRequired: boolean;
  sellable: boolean;
  kioskEnabled: boolean;
  purchaseCostState: string;
  sellingPriceState: string;
  sellingPrice: number | null;
  legacyProductCost: number | null;
  latestIngredientUnitCost: number | null;
  displayCostPerUnit: number | null;
  productActive: boolean | null;
  draftId: string | null;
  draftLifecycle: string | null;
  activeRecipeId: string | null;
  activeVersionId: string | null;
  activeVersionOutputQuantity: number | null;
  activeVersionOutputUnit: string | null;
  activeVersionCostStatus: RecipeVersionCostSummaryStatus | null;
  activeVersionTotalCost: number | null;
  activeVersionCostPerOutputUnit: number | null;
  activeCostProfileId: string | null;
  activeCostSource: "owner_estimate" | "recipe_version" | null;
  activeCostTotal: number | null;
  activeCostReferenceQuantity: number | null;
  activeCostReferenceUnit: string | null;
};

type OutputRow = {
  id: string;
  business_id: string;
  name: string;
  classification: string;
  lifecycle_status: string;
  readiness_state: string;
  sellable: number;
  kiosk_enabled: number;
  product_id: string | null;
  product_active: number | null;
};

type Identity = {
  catalogItemId: string;
  productId: string;
  bindingId: string;
  draftId: string;
};

function requireText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function timestamp() {
  return new Date().toISOString();
}

function requiredReferenceCount(
  value: number | null | undefined,
  label: string,
) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} reference count is unavailable.`);
  }
  return value as number;
}

function modeDefinition(mode: RecipeFirstMode) {
  if (mode === "finished_per_unit") {
    return {
      classification: "finished_product" as const,
      classificationProposal: "finished_product" as const,
      expectedOutputQuantity: 1,
      expectedOutputUnit: "pcs",
      sellingPriceState: "unknown" as const,
      productUnit: "piece",
      productType: "cooked food",
      reviewRequired: 0,
    };
  }
  return {
    classification:
      mode === "prepared_batch"
        ? ("prepared_base" as const)
        : ("legacy_unclassified" as const),
    classificationProposal:
      mode === "prepared_batch" ? ("prepared_base" as const) : null,
    expectedOutputQuantity: null,
    expectedOutputUnit: null,
    sellingPriceState: "not_applicable" as const,
    productUnit: "other",
    productType: "ingredient-based item",
    reviewRequired: mode === "unsure" ? 1 : 0,
  };
}

async function assertBusinessAndBranch(
  businessId: string,
  branchId: string | null,
  db: RepositoryDatabase,
) {
  const business = await db.getFirstAsync<{ id: string }>(
    `
      SELECT id
      FROM businesses
      WHERE id = ? AND deleted_at IS NULL
    `,
    [businessId],
  );
  if (!business) throw new Error("Business is unavailable.");
  if (!branchId) return;
  const branch = await db.getFirstAsync<{ business_id: string }>(
    `
      SELECT business_id
      FROM branches
      WHERE id = ? AND deleted_at IS NULL
    `,
    [branchId],
  );
  if (branch?.business_id !== businessId) {
    throw new Error("Branch belongs to another business.");
  }
}

async function insertRecipeFirstIdentity(
  input: StartRecipeFirstDraftInput,
  db: RepositoryDatabase,
  nested?: {
    parentDraftId: string;
    parentLineId: string;
    returnRoute: string;
  },
) {
  const businessId = requireText(input.businessId, "Business");
  const name = requireText(input.name, "Recipe item name");
  const branchId = input.branchId ?? null;
  await assertBusinessAndBranch(businessId, branchId, db);
  const definition = modeDefinition(input.mode);
  const ids: Identity = {
    catalogItemId: input.ids?.catalogItemId ?? makeCatalogItemId(),
    productId: input.ids?.productId ?? makeProductId(),
    bindingId: input.ids?.bindingId ?? makeLegacyBindingId(),
    draftId: input.ids?.draftId ?? makeRecipeDraftId(),
  };
  const createdAt = timestamp();
  const category = input.category?.trim() || "General";

  await db.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, source_type,
        classification, lifecycle_status, readiness_state,
        classification_review_required, sellable, kiosk_enabled,
        purchase_cost_state, selling_price_state, stock_policy, archived_at,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 'native', ?, 'draft', 'incomplete', ?, 0, 0,
        'not_applicable', ?, 'product_lots', NULL, ?, ?, 'local', NULL)
    `,
    [
      ids.catalogItemId,
      businessId,
      branchId,
      name,
      name.toLocaleLowerCase().trim(),
      definition.classification,
      definition.reviewRequired,
      definition.sellingPriceState,
      createdAt,
      createdAt,
    ],
  );
  await db.runAsync(
    `
      INSERT INTO products (
        id, business_id, branch_id, name, category, price, cost, stock_qty,
        unit_type, low_stock_threshold, bundle_quantity, bundle_price,
        bundle_label, active, product_type, created_at, updated_at,
        sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 0, NULL, NULL, NULL, 0, ?, ?, ?,
        'local', NULL)
    `,
    [
      ids.productId,
      businessId,
      branchId,
      name,
      category,
      definition.productUnit,
      definition.productType,
      createdAt,
      createdAt,
    ],
  );
  await db.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, legacy_deleted_at_snapshot,
        migration_provenance, reviewed_at, native_activated_at, created_at,
        updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, 'product', ?, 'recipe_output', 'active', 'native', ?,
        0, NULL, 'native', NULL, NULL, ?, ?, 'local', NULL)
    `,
    [
      ids.bindingId,
      businessId,
      ids.catalogItemId,
      ids.productId,
      definition.reviewRequired,
      createdAt,
      createdAt,
    ],
  );
  await db.runAsync(
    `
      INSERT INTO recipe_drafts (
        id, business_id, branch_id, recipe_id, source_version_id,
        output_catalog_item_id, name, category, notes,
        expected_output_quantity,
        expected_output_unit, production_mode, suggested_selling_price,
        classification_proposal, selling_price_state, sellable, kiosk_enabled,
        editor_step, lifecycle_status, autosave_revision, last_saved_at,
        unresolved_requirement_count, parent_draft_id, parent_line_id,
        return_route, published_version_id, created_at, updated_at, sync_status,
        deleted_at
      ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?,
        'prepared_before_selling', NULL, ?, ?, 0, 0, 'definition', 'editing',
        0, ?, 0, ?, ?, ?, NULL, ?, ?, 'local', NULL)
    `,
    [
      ids.draftId,
      businessId,
      branchId,
      ids.catalogItemId,
      name,
      category,
      input.notes?.trim() || null,
      definition.expectedOutputQuantity,
      definition.expectedOutputUnit,
      definition.classificationProposal,
      definition.sellingPriceState,
      createdAt,
      nested?.parentDraftId ?? null,
      nested?.parentLineId ?? null,
      nested?.returnRoute ?? null,
      createdAt,
      createdAt,
    ],
  );
  return ids;
}

async function loadOutputRow(
  catalogItemId: string,
  db: RepositoryDatabase,
) {
  return db.getFirstAsync<OutputRow>(
    `
      SELECT item.id, item.business_id, item.name, item.classification,
        item.lifecycle_status, item.readiness_state, item.sellable,
        item.kiosk_enabled,
        binding.legacy_entity_id AS product_id,
        product.active AS product_active
      FROM catalog_items item
      LEFT JOIN legacy_item_bindings binding
        ON binding.catalog_item_id = item.id
        AND binding.entity_kind = 'product'
        AND binding.deleted_at IS NULL
      LEFT JOIN products product
        ON product.id = binding.legacy_entity_id
        AND product.deleted_at IS NULL
      WHERE item.id = ? AND item.deleted_at IS NULL
    `,
    [catalogItemId],
  );
}

async function resolveRecipeFirstLines(
  lines: RecipeDraftLineRecord[],
  db: RepositoryDatabase,
): Promise<RecipeFirstResolvedLine[]> {
  const resolved: RecipeFirstResolvedLine[] = [];
  for (const line of lines) {
    const costLabel: RecipeFirstResolvedLine["costLabel"] =
      line.costState !== "known"
        ? line.costState === "unknown"
          ? "No price yet"
          : "Cost incomplete"
        : line.costSource === "purchase_lot" || line.costSource === "recipe_version"
          ? "Actual cost"
          : "Estimated cost";
    const conversionSummary = line.conversionChainJson
      ? (() => {
          try {
            const parsed = JSON.parse(line.conversionChainJson) as {
              steps?: { fromQuantity: number; fromUnit: string; toQuantity: number; toUnit: string }[];
            };
            return (parsed.steps ?? [])
              .map(
                (step) =>
                  `${step.fromQuantity} ${step.fromUnit} = ${step.toQuantity} ${step.toUnit}`,
              )
              .join(" · ") || null;
          } catch {
            return "Saved conversion unavailable";
          }
        })()
      : line.normalizedUnit && line.conversionFactorSnapshot
        ? `1 ${line.unit ?? "unit"} = ${line.conversionFactorSnapshot} ${line.normalizedUnit}`
        : null;

    if (line.sourceKind === "catalog_item" && line.catalogItemId) {
      const item = await db.getFirstAsync<{
        name: string;
        classification: string;
        ingredient_name: string | null;
        ingredient_category: string | null;
        lot_brand: string | null;
        lot_source: string | null;
        lot_status: string | null;
        profile_total_cost: number | null;
        profile_reference_quantity: number | null;
        profile_reference_unit: string | null;
      }>(
        `
          SELECT item.name, item.classification,
            ingredient.name AS ingredient_name,
            ingredient.category AS ingredient_category,
            lot.brand_name AS lot_brand, lot.source_name AS lot_source,
            lot.status AS lot_status, profile.total_cost AS profile_total_cost,
            profile.reference_quantity AS profile_reference_quantity,
            profile.reference_unit AS profile_reference_unit
          FROM catalog_items item
          LEFT JOIN legacy_item_bindings binding
            ON binding.catalog_item_id = item.id
            AND binding.entity_kind = 'ingredient'
            AND binding.deleted_at IS NULL
          LEFT JOIN ingredients ingredient
            ON ingredient.id = binding.legacy_entity_id
            AND ingredient.deleted_at IS NULL
          LEFT JOIN ingredient_lots lot
            ON lot.id = ? AND lot.ingredient_id = ingredient.id
            AND lot.deleted_at IS NULL
          LEFT JOIN catalog_cost_profiles profile
            ON profile.id = ? AND profile.catalog_item_id = item.id
            AND profile.deleted_at IS NULL
          WHERE item.id = ? AND item.deleted_at IS NULL
        `,
        [line.legacyIngredientLotId, line.costProfileId, line.catalogItemId],
      );
      const name = item?.ingredient_name ?? item?.name;
      if (!name?.trim() && line.customName?.trim()) {
        console.warn(
          "[recipeFirst] catalog ingredient identity missing; customName used only as last-resort diagnostic fallback",
        );
      }
      resolved.push({
        lineId: line.id,
        displayName:
          name?.trim() ||
          line.customName?.trim() ||
          "Ingredient information unavailable",
        classification: item?.classification ?? null,
        category: item?.ingredient_category ?? null,
        sourceLabel:
          line.costSource === "owner_estimate"
            ? "Estimated prepared item"
            : line.legacyIngredientLotId
              ? "Exact Grocery lot"
              : "Catalog ingredient",
        sourceDetail: [item?.lot_brand, item?.lot_source, item?.lot_status]
          .filter(Boolean)
          .join(" · ") || null,
        costLabel,
        conversionSummary,
        childLifecycle: null,
        missingReason: item ? null : "The linked catalog item is unavailable.",
        profileTotalCost: item?.profile_total_cost ?? null,
        profileReferenceQuantity: item?.profile_reference_quantity ?? null,
        profileReferenceUnit: item?.profile_reference_unit ?? null,
      });
      continue;
    }
    if (line.sourceKind === "child_recipe_version" && line.childRecipeVersionId) {
      const child = await db.getFirstAsync<{
        name_snapshot: string;
        classification: string;
        category_snapshot: string | null;
        status: string;
        cost_summary_status: RecipeVersionCostSummaryStatus | null;
        output_catalog_item_id: string;
        expected_output_quantity: number;
        expected_output_unit: string;
        profile_total_cost: number | null;
        profile_reference_quantity: number | null;
        profile_reference_unit: string | null;
      }>(
        `
          SELECT version.name_snapshot, item.classification,
            version.category_snapshot, version.status,
            version.output_catalog_item_id, version.expected_output_quantity,
            version.expected_output_unit,
            summary.status AS cost_summary_status,
            profile.total_cost AS profile_total_cost,
            profile.reference_quantity AS profile_reference_quantity,
            profile.reference_unit AS profile_reference_unit
          FROM recipe_versions version
          INNER JOIN catalog_items item
            ON item.id = version.output_catalog_item_id
            AND item.deleted_at IS NULL
          LEFT JOIN recipe_version_cost_summaries summary
            ON summary.recipe_version_id = version.id
            AND summary.deleted_at IS NULL
          LEFT JOIN catalog_cost_profiles profile
            ON profile.id = ? AND profile.source_recipe_version_id = version.id
            AND profile.deleted_at IS NULL
          WHERE version.id = ? AND version.deleted_at IS NULL
        `,
        [line.costProfileId, line.childRecipeVersionId],
      );
      const pinnedCostLabel: RecipeFirstResolvedLine["costLabel"] =
        child?.cost_summary_status === "actual"
          ? "Actual cost"
          : child?.cost_summary_status === "estimated"
            ? "Estimated cost"
            : child?.cost_summary_status === "no_price"
              ? "No price yet"
              : child?.cost_summary_status === "incomplete"
                ? "Cost incomplete"
                : costLabel;
      if (!child?.name_snapshot?.trim() && line.customName?.trim()) {
        console.warn(
          "[recipeFirst] pinned prepared Recipe identity missing; falling back to saved label",
        );
      }
      resolved.push({
        lineId: line.id,
        displayName:
          child?.name_snapshot?.trim() ||
          line.customName?.trim() ||
          "Ingredient information unavailable",
        classification: child?.classification ?? null,
        category: child?.category_snapshot ?? null,
        sourceLabel: "Pinned prepared Recipe version",
        sourceDetail: child?.status ? `Version status: ${child.status}` : null,
        costLabel: pinnedCostLabel,
        conversionSummary,
        childLifecycle: child?.status ?? null,
        missingReason: child
          ? null
          : "Ingredient information unavailable",
        profileTotalCost: child?.profile_total_cost ?? null,
        profileReferenceQuantity: child?.profile_reference_quantity ?? null,
        profileReferenceUnit: child?.profile_reference_unit ?? null,
        sourceCatalogItemId: child?.output_catalog_item_id ?? null,
        pinnedRecipeVersionId: line.childRecipeVersionId,
        pinnedOutputQuantity: child?.expected_output_quantity ?? null,
        pinnedOutputUnit: child?.expected_output_unit ?? null,
      });
      continue;
    }
    if (line.sourceKind === "child_draft" && line.childDraftId) {
      const child = await db.getFirstAsync<{
        name: string | null;
        category: string | null;
        classification_proposal: string | null;
        lifecycle_status: string;
      }>(
        `
          SELECT name, category, classification_proposal, lifecycle_status
          FROM recipe_drafts
          WHERE id = ? AND deleted_at IS NULL
        `,
        [line.childDraftId],
      );
      resolved.push({
        lineId: line.id,
        displayName:
          child?.name?.trim() ||
          line.customName?.trim() ||
          "Ingredient information unavailable",
        classification: child?.classification_proposal ?? null,
        category: child?.category ?? null,
        sourceLabel: "Prepared Recipe draft",
        sourceDetail: child ? `Draft status: ${child.lifecycle_status}` : null,
        costLabel,
        conversionSummary,
        childLifecycle: child?.lifecycle_status ?? null,
        missingReason: child
          ? "Complete this prepared Recipe before publishing."
          : "Ingredient information unavailable",
        profileTotalCost: null,
        profileReferenceQuantity: null,
        profileReferenceUnit: null,
      });
      continue;
    }
    resolved.push({
      lineId: line.id,
      displayName: line.customName?.trim() || "Ingredient information unavailable",
      classification: null,
      category: null,
      sourceLabel:
        line.sourceKind === "custom_cost" ? "Custom ingredient cost" : "Unresolved ingredient",
      sourceDetail: null,
      costLabel,
      conversionSummary,
      childLifecycle: null,
      missingReason:
        line.sourceKind === "unresolved" ? "Choose or complete an ingredient source." : null,
      profileTotalCost: null,
      profileReferenceQuantity: null,
      profileReferenceUnit: null,
    });
  }
  return resolved;
}

export async function loadRecipeFirstDraft(
  draftId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<RecipeFirstDraftSnapshot | null> {
  await runMigrations(db);
  const draft = await getRecipeDraftById(draftId, db);
  if (!draft?.outputCatalogItemId) return null;
  const output = await loadOutputRow(draft.outputCatalogItemId, db);
  if (!output || output.business_id !== draft.businessId) {
    throw new Error("Recipe-first draft output identity is unavailable.");
  }
  const lines = await listRecipeDraftLines(draftId, db);
  return {
    draft,
    lines,
    resolvedLines: await resolveRecipeFirstLines(lines, db),
    output: {
      catalogItemId: output.id,
      productId: output.product_id,
      name: output.name,
      classification: output.classification,
      lifecycle: output.lifecycle_status,
      readinessState: output.readiness_state,
      sellable: output.sellable === 1,
      kioskEnabled: output.kiosk_enabled === 1,
      productActive:
        output.product_active === null ? null : output.product_active === 1,
    },
    costProfiles: await listCatalogCostProfileHistory(output.id, db),
  };
}

export async function startRecipeFirstDraft(
  input: StartRecipeFirstDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const identityIds: Required<RecipeFirstIdentityIds> = {
    catalogItemId: input.ids?.catalogItemId ?? makeCatalogItemId(),
    productId: input.ids?.productId ?? makeProductId(),
    bindingId: input.ids?.bindingId ?? makeLegacyBindingId(),
    draftId: input.ids?.draftId ?? makeRecipeDraftId(),
  };
  await db.withExclusiveTransactionAsync(async (txn) => {
    await insertRecipeFirstIdentity(
      { ...input, ids: identityIds },
      txn,
    );
  });
  const snapshot = await loadRecipeFirstDraft(identityIds.draftId, db);
  if (!snapshot) throw new Error("Recipe-first draft could not be loaded.");
  return snapshot;
}

export async function saveRecipeFirstDraftSnapshot(
  input: SaveRecipeDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  await saveRecipeDraft(input, db);
  const snapshot = await loadRecipeFirstDraft(input.draftId, db);
  if (!snapshot) throw new Error("Saved Recipe-first draft is unavailable.");
  return snapshot;
}

export async function createRecipeFirstUnitConversion(
  input: {
    id?: string;
    businessId: string;
    catalogItemId: string;
    fromUnit: string;
    toUnit: string;
    factor: number;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return createItemUnitConversion(input, db);
}

export async function loadRecipeLibrary(
  businessId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<RecipeFirstLibraryEntry[]> {
  await runMigrations(db);
  const rows = await db.getAllAsync<{
    catalog_item_id: string;
    product_id: string | null;
    ingredient_id: string | null;
    name: string;
    source_type: string;
    classification: string;
    lifecycle_status: string;
    readiness_state: string;
    compatibility_mode: string | null;
    review_required: number;
    sellable: number;
    kiosk_enabled: number;
    purchase_cost_state: string;
    selling_price_state: string;
    selling_price: number | null;
    legacy_product_cost: number | null;
    latest_ingredient_unit_cost: number | null;
    product_active: number | null;
    draft_id: string | null;
    draft_lifecycle: string | null;
    active_recipe_id: string | null;
    active_version_id: string | null;
    active_version_output_quantity: number | null;
    active_version_output_unit: string | null;
    version_cost_status: RecipeVersionCostSummaryStatus | null;
    version_total_cost: number | null;
    version_cost_per_output_unit: number | null;
    active_cost_profile_id: string | null;
    active_cost_source: "owner_estimate" | "recipe_version" | null;
    active_cost_total: number | null;
    active_cost_reference_quantity: number | null;
    active_cost_reference_unit: string | null;
  }>(
    `
      SELECT item.id AS catalog_item_id,
        product_binding.legacy_entity_id AS product_id,
        ingredient_binding.legacy_entity_id AS ingredient_id,
        item.name, item.source_type, item.classification,
        item.lifecycle_status, item.readiness_state,
        COALESCE(
          product_binding.compatibility_mode,
          ingredient_binding.compatibility_mode
        ) AS compatibility_mode,
        CASE
          WHEN item.classification_review_required = 1
            OR COALESCE(product_binding.review_required, 0) = 1
            OR COALESCE(ingredient_binding.review_required, 0) = 1
          THEN 1 ELSE 0
        END AS review_required,
        item.sellable, item.kiosk_enabled, item.purchase_cost_state,
        item.selling_price_state, product.price AS selling_price,
        product.cost AS legacy_product_cost,
        (
          SELECT lot.recorded_cost_per_unit
          FROM ingredient_lots lot
          WHERE lot.ingredient_id = ingredient_binding.legacy_entity_id
            AND lot.cost_state = 'known'
            AND lot.recorded_cost_per_unit IS NOT NULL
            AND lot.deleted_at IS NULL
          ORDER BY lot.purchase_date DESC, lot.created_at DESC, lot.id DESC
          LIMIT 1
        ) AS latest_ingredient_unit_cost,
        product.active AS product_active,
        (
          SELECT draft.id
          FROM recipe_drafts draft
          WHERE draft.output_catalog_item_id = item.id
            AND draft.lifecycle_status IN ('editing', 'ready')
            AND draft.deleted_at IS NULL
          ORDER BY draft.updated_at DESC, draft.id DESC
          LIMIT 1
        ) AS draft_id,
        (
          SELECT draft.lifecycle_status
          FROM recipe_drafts draft
          WHERE draft.output_catalog_item_id = item.id
            AND draft.lifecycle_status IN ('editing', 'ready')
            AND draft.deleted_at IS NULL
          ORDER BY draft.updated_at DESC, draft.id DESC
          LIMIT 1
        ) AS draft_lifecycle,
        (
          SELECT recipe.id
          FROM catalog_item_recipe_roles role
          INNER JOIN recipes recipe
            ON recipe.id = role.recipe_id
            AND recipe.is_active = 1
            AND recipe.deleted_at IS NULL
          INNER JOIN recipe_versions active_version
            ON active_version.id = recipe.active_version_id
            AND active_version.status = 'published'
            AND active_version.deleted_at IS NULL
          WHERE role.output_catalog_item_id = item.id
            AND role.status = 'active'
            AND role.deleted_at IS NULL
          ORDER BY CASE role.role
            WHEN 'primary' THEN 0
            WHEN 'kiosk_cook_upon_order' THEN 1
            ELSE 2
          END, role.effective_at DESC, role.id DESC
          LIMIT 1
        ) AS active_recipe_id,
        (
          SELECT recipe.active_version_id
          FROM catalog_item_recipe_roles role
          INNER JOIN recipes recipe
            ON recipe.id = role.recipe_id
            AND recipe.is_active = 1
            AND recipe.deleted_at IS NULL
          INNER JOIN recipe_versions active_version
            ON active_version.id = recipe.active_version_id
            AND active_version.status = 'published'
            AND active_version.deleted_at IS NULL
          WHERE role.output_catalog_item_id = item.id
            AND role.status = 'active'
            AND role.deleted_at IS NULL
          ORDER BY CASE role.role
            WHEN 'primary' THEN 0
            WHEN 'kiosk_cook_upon_order' THEN 1
            ELSE 2
          END, role.effective_at DESC, role.id DESC
          LIMIT 1
        ) AS active_version_id,
        (
          SELECT active_version.expected_output_quantity
          FROM catalog_item_recipe_roles role
          INNER JOIN recipes recipe
            ON recipe.id = role.recipe_id AND recipe.is_active = 1
            AND recipe.deleted_at IS NULL
          INNER JOIN recipe_versions active_version
            ON active_version.id = recipe.active_version_id
            AND active_version.status = 'published'
            AND active_version.deleted_at IS NULL
          WHERE role.output_catalog_item_id = item.id
            AND role.status = 'active' AND role.deleted_at IS NULL
          ORDER BY CASE role.role WHEN 'primary' THEN 0 WHEN 'kiosk_cook_upon_order' THEN 1 ELSE 2 END,
            role.effective_at DESC, role.id DESC
          LIMIT 1
        ) AS active_version_output_quantity,
        (
          SELECT active_version.expected_output_unit
          FROM catalog_item_recipe_roles role
          INNER JOIN recipes recipe
            ON recipe.id = role.recipe_id AND recipe.is_active = 1
            AND recipe.deleted_at IS NULL
          INNER JOIN recipe_versions active_version
            ON active_version.id = recipe.active_version_id
            AND active_version.status = 'published'
            AND active_version.deleted_at IS NULL
          WHERE role.output_catalog_item_id = item.id
            AND role.status = 'active' AND role.deleted_at IS NULL
          ORDER BY CASE role.role WHEN 'primary' THEN 0 WHEN 'kiosk_cook_upon_order' THEN 1 ELSE 2 END,
            role.effective_at DESC, role.id DESC
          LIMIT 1
        ) AS active_version_output_unit,
        summary.status AS version_cost_status,
        summary.total_cost AS version_total_cost,
        summary.cost_per_output_unit AS version_cost_per_output_unit,
        profile.id AS active_cost_profile_id,
        profile.source_kind AS active_cost_source,
        profile.total_cost AS active_cost_total,
        profile.reference_quantity AS active_cost_reference_quantity,
        profile.reference_unit AS active_cost_reference_unit
      FROM catalog_items item
      LEFT JOIN legacy_item_bindings product_binding
        ON product_binding.catalog_item_id = item.id
        AND product_binding.entity_kind = 'product'
        AND product_binding.deleted_at IS NULL
      LEFT JOIN legacy_item_bindings ingredient_binding
        ON ingredient_binding.catalog_item_id = item.id
        AND ingredient_binding.entity_kind = 'ingredient'
        AND ingredient_binding.deleted_at IS NULL
      LEFT JOIN products product
        ON product.id = product_binding.legacy_entity_id
        AND product.deleted_at IS NULL
      LEFT JOIN recipe_version_cost_summaries summary
        ON summary.recipe_version_id = (
          SELECT recipe.active_version_id
          FROM catalog_item_recipe_roles role
          INNER JOIN recipes recipe
            ON recipe.id = role.recipe_id
            AND recipe.is_active = 1
            AND recipe.deleted_at IS NULL
          INNER JOIN recipe_versions active_version
            ON active_version.id = recipe.active_version_id
            AND active_version.status = 'published'
            AND active_version.deleted_at IS NULL
          WHERE role.output_catalog_item_id = item.id
            AND role.status = 'active'
            AND role.deleted_at IS NULL
          ORDER BY CASE role.role
            WHEN 'primary' THEN 0
            WHEN 'kiosk_cook_upon_order' THEN 1
            ELSE 2
          END, role.effective_at DESC, role.id DESC
          LIMIT 1
        )
        AND summary.deleted_at IS NULL
      LEFT JOIN catalog_cost_profiles profile
        ON profile.catalog_item_id = item.id
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
      WHERE item.business_id = ?
        AND item.deleted_at IS NULL
      ORDER BY
        CASE WHEN item.lifecycle_status = 'archived' THEN 1 ELSE 0 END,
        item.normalized_name ASC,
        item.id ASC
    `,
    [businessId],
  );
  return rows.map((row) => ({
    catalogItemId: row.catalog_item_id,
    productId: row.product_id,
    ingredientId: row.ingredient_id,
    name: row.name,
    sourceType: row.source_type,
    classification: row.classification,
    lifecycle: row.lifecycle_status,
    readinessState: row.readiness_state,
    compatibilityMode: row.compatibility_mode,
    reviewRequired: row.review_required === 1,
    sellable: row.sellable === 1,
    kioskEnabled: row.kiosk_enabled === 1,
    purchaseCostState: row.purchase_cost_state,
    sellingPriceState: row.selling_price_state,
    sellingPrice:
      row.selling_price_state === "known" ? row.selling_price : null,
    legacyProductCost: row.legacy_product_cost,
    latestIngredientUnitCost: row.latest_ingredient_unit_cost,
    displayCostPerUnit:
      row.active_cost_total !== null &&
      row.active_cost_reference_quantity !== null
        ? row.active_cost_total / row.active_cost_reference_quantity
        : row.version_cost_per_output_unit ??
          row.latest_ingredient_unit_cost ??
          (row.purchase_cost_state === "known"
            ? row.legacy_product_cost
            : null),
    productActive:
      row.product_active === null ? null : row.product_active === 1,
    draftId: row.draft_id,
    draftLifecycle: row.draft_lifecycle,
    activeRecipeId: row.active_recipe_id,
    activeVersionId: row.active_version_id,
    activeVersionOutputQuantity: row.active_version_output_quantity,
    activeVersionOutputUnit: row.active_version_output_unit,
    activeVersionCostStatus: row.version_cost_status,
    activeVersionTotalCost: row.version_total_cost,
    activeVersionCostPerOutputUnit: row.version_cost_per_output_unit,
    activeCostProfileId: row.active_cost_profile_id,
    activeCostSource: row.active_cost_source,
    activeCostTotal: row.active_cost_total,
    activeCostReferenceQuantity: row.active_cost_reference_quantity,
    activeCostReferenceUnit: row.active_cost_reference_unit,
  }));
}

export async function loadRecipeIngredientPicker(
  businessId: string,
  currentOutputCatalogItemId?: string | null,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<RecipeIngredientPickerEntry[]> {
  const library = await loadRecipeLibrary(businessId, db);
  return library.flatMap((entry) => {
    const mapped = mapLibraryEntryToPickerEntry(
      entry,
      currentOutputCatalogItemId,
    );
    return mapped ? [mapped] : [];
  });
}

/**
 * Reconciles mutable identities after a parent line was removed or replaced.
 * Estimate-only identities are deleted only through the existing strict
 * reference audit. Nested drafts are detached into ordinary resumable drafts
 * so a failed cleanup can never hide or strand owner work.
 */
export async function reconcileRemovedRecipeLineSource(
  input: {
    businessId: string;
    parentDraftId: string;
    line: Pick<
      RecipeDraftLineRecord,
      "id" | "sourceKind" | "catalogItemId" | "childDraftId" | "costSource"
    >;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const parent = await db.getFirstAsync<{ business_id: string }>(
    `
      SELECT business_id
      FROM recipe_drafts
      WHERE id = ? AND deleted_at IS NULL
    `,
    [input.parentDraftId],
  );
  if (parent?.business_id !== input.businessId) {
    throw new Error("Recipe line cleanup parent is unavailable.");
  }
  const current = await db.getFirstAsync<{
    source_kind: RecipeDraftLineRecord["sourceKind"];
    catalog_item_id: string | null;
    child_draft_id: string | null;
    cost_source: RecipeDraftLineRecord["costSource"];
  }>(
    `
      SELECT source_kind, catalog_item_id, child_draft_id, cost_source
      FROM recipe_draft_lines
      WHERE recipe_draft_id = ? AND id = ? AND deleted_at IS NULL
    `,
    [input.parentDraftId, input.line.id],
  );
  if (
    current &&
    current.source_kind === input.line.sourceKind &&
    current.catalog_item_id === input.line.catalogItemId &&
    current.child_draft_id === input.line.childDraftId &&
    current.cost_source === input.line.costSource
  ) {
    throw new Error("Recipe line cleanup requires the saved replacement first.");
  }
  if (
    input.line.costSource === "owner_estimate" &&
    input.line.catalogItemId
  ) {
    const item = await db.getFirstAsync<{ business_id: string }>(
      `
        SELECT business_id
        FROM catalog_items
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.line.catalogItemId],
    );
    if (!item) {
      return {
        reconciled: "already_reconciled" as const,
        catalogItemId: input.line.catalogItemId,
      };
    }
    if (item.business_id !== input.businessId) {
      throw new Error("Estimate cleanup identity belongs to another business.");
    }
    const resultHolder: {
      current:
        | { deleted: true; catalogItemId: string }
        | { deleted: false; catalogItemId: string }
        | null;
    } = { current: null };
    await db.withExclusiveTransactionAsync(async (txn) => {
      resultHolder.current = await deleteRecipeFirstItemInTransaction(
        {
          businessId: input.businessId,
          catalogItemId: input.line.catalogItemId as string,
          ownerAuthorized: true,
        },
        txn,
        { retainWhenProtected: true },
      );
    });
    const result = resultHolder.current;
    if (!result) throw new Error("Estimate source cleanup did not complete.");
    return {
      reconciled: result.deleted ? ("deleted" as const) : ("retained" as const),
      catalogItemId: input.line.catalogItemId,
    };
  }
  if (input.line.sourceKind === "child_draft" && input.line.childDraftId) {
    let alreadyDetached = false;
    await db.withExclusiveTransactionAsync(async (txn) => {
      const detachedAt = timestamp();
      const detached = await txn.runAsync(
        `
          UPDATE recipe_drafts
          SET parent_draft_id = NULL, parent_line_id = NULL,
            return_route = NULL, autosave_revision = autosave_revision + 1,
            last_saved_at = ?, updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND parent_draft_id = ?
            AND parent_line_id = ? AND lifecycle_status IN ('editing', 'ready')
            AND deleted_at IS NULL
        `,
        [
          detachedAt,
          detachedAt,
          input.line.childDraftId,
          input.businessId,
          input.parentDraftId,
          input.line.id,
        ],
      );
      if (detached.changes !== 1) {
        const child = await txn.getFirstAsync<{
          business_id: string;
          parent_draft_id: string | null;
          parent_line_id: string | null;
          return_route: string | null;
        }>(
          `
            SELECT business_id, parent_draft_id, parent_line_id, return_route
            FROM recipe_drafts
            WHERE id = ? AND deleted_at IS NULL
          `,
          [input.line.childDraftId],
        );
        if (
          child?.business_id === input.businessId &&
          child.parent_draft_id === null &&
          child.parent_line_id === null &&
          child.return_route === null
        ) {
          alreadyDetached = true;
          return;
        }
        throw new Error("Nested Recipe draft changed before source cleanup.");
      }
    });
    return {
      reconciled: alreadyDetached
        ? ("already_reconciled" as const)
        : ("detached" as const),
      detachedDraftId: input.line.childDraftId,
    };
  }
  return { reconciled: "retained" as const };
}

export type AddQuickEstimatedPreparedInputInput = {
  requestToken: string;
  businessId: string;
  branchId?: string | null;
  parentDraftId: string;
  parentExpectedRevision: number;
  parentLineId?: string;
  preparedDraftId?: string;
  catalogItemId?: string;
  costProfileId?: string;
  name: string;
  totalCost: number;
  referenceQuantity: number;
  referenceUnit: string;
  usageQuantity: number;
  usageUnit: string;
  role?: RecipeDraftLineRecord["role"];
  isOptional?: boolean;
  notes?: string | null;
  conversionChainJson?: string | null;
  unitStandardSnapshot?: string | null;
  usageUnitFactorToReference?: number | null;
};

export type QuickEstimatedPreparedInputResult = {
  repeated: boolean;
  catalogItemId: string;
  preparedDraftId: string;
  parentLineId: string;
  parentRevision: number;
  costProfile: CatalogCostProfileRecord;
};

function unitFactor(fromUnit: string, toUnit: string) {
  const practical = standardRecipeUnitFactor(fromUnit, toUnit);
  if (practical !== null) return practical;
  const from = fromUnit.trim().toLocaleLowerCase();
  const to = toUnit.trim().toLocaleLowerCase();
  if (from === to) return 1;
  const grams: Record<string, number> = { g: 1, kg: 1000 };
  const milliliters: Record<string, number> = { ml: 1, l: 1000 };
  if (from in grams && to in grams) return grams[from] / grams[to];
  if (from in milliliters && to in milliliters) {
    return milliliters[from] / milliliters[to];
  }
  throw new Error(
    `No safe unit conversion exists from ${from || "blank"} to ${to || "blank"}.`,
  );
}

function unitFactorWithSnapshot(
  fromUnit: string,
  referenceUnit: string,
  conversion: {
    id: string | null;
    normalizedUnit: string | null;
    factor: number | null;
  },
) {
  try {
    return unitFactor(fromUnit, referenceUnit);
  } catch (error) {
    if (
      !conversion.id ||
      !conversion.normalizedUnit ||
      conversion.factor === null ||
      !Number.isFinite(conversion.factor) ||
      conversion.factor <= 0
    ) {
      throw error;
    }
    return (
      conversion.factor *
      unitFactor(conversion.normalizedUnit, referenceUnit)
    );
  }
}

function unitFactorForVersionLine(
  line: RecipeVersionLineRecord,
  referenceUnit: string,
) {
  return unitFactorWithSnapshot(line.unit, referenceUnit, {
    id: line.conversionId,
    normalizedUnit: line.normalizedUnit,
    factor: line.conversionFactorSnapshot,
  });
}

async function createConversionSnapshotInTransaction(
  input: {
    businessId: string;
    catalogItemId: string;
    quantity: number;
    fromUnit: string;
    toUnit: string;
    factor: number;
    existing?: {
      normalizedQuantity: number | null;
      normalizedUnit: string | null;
      conversionId: string | null;
      conversionFactorSnapshot: number | null;
    };
  },
  db: RepositoryDatabase,
) {
  if (input.fromUnit.trim() === input.toUnit.trim()) {
    return {
      normalizedQuantity: null,
      normalizedUnit: null,
      conversionId: null,
      conversionFactorSnapshot: null,
    };
  }
  if (
    input.existing?.conversionId &&
    input.existing.normalizedUnit?.trim() === input.toUnit.trim() &&
    input.existing.normalizedQuantity !== null &&
    input.existing.conversionFactorSnapshot !== null &&
    Math.abs(input.existing.conversionFactorSnapshot - input.factor) <=
      1e-9 * Math.max(1, Math.abs(input.factor)) &&
    Math.abs(
      input.existing.normalizedQuantity - input.quantity * input.factor,
    ) <=
      1e-9 *
        Math.max(1, Math.abs(input.quantity * input.factor))
  ) {
    return input.existing;
  }
  const conversion = await createItemUnitConversionInTransaction(
    {
      id: makeUnitConversionId(),
      businessId: input.businessId,
      catalogItemId: input.catalogItemId,
      fromUnit: input.fromUnit,
      toUnit: input.toUnit,
      factor: input.factor,
    },
    db,
  );
  return {
    normalizedQuantity: input.quantity * conversion.factor,
    normalizedUnit: conversion.toUnit,
    conversionId: conversion.id,
    conversionFactorSnapshot: conversion.factor,
  };
}

function validateQuickEstimateInput(input: AddQuickEstimatedPreparedInputInput) {
  requireText(input.requestToken, "Estimate request token");
  requireText(input.businessId, "Business");
  requireText(input.parentDraftId, "Parent draft");
  requireText(input.name, "Prepared item name");
  const referenceUnit = requireText(input.referenceUnit, "Reference unit");
  const usageUnit = requireText(input.usageUnit, "Usage unit");
  if (
    !Number.isInteger(input.parentExpectedRevision) ||
    input.parentExpectedRevision < 0
  ) {
    throw new Error("Parent Recipe revision is invalid.");
  }
  if (!Number.isFinite(input.totalCost) || input.totalCost < 0) {
    throw new Error("Estimated prepared-item cost must be zero or higher.");
  }
  if (
    !Number.isFinite(input.referenceQuantity) ||
    input.referenceQuantity <= 0 ||
    !Number.isFinite(input.usageQuantity) ||
    input.usageQuantity <= 0
  ) {
    throw new Error("Estimated prepared-item quantities must be positive.");
  }
  const usageFactor =
    input.usageUnitFactorToReference ?? unitFactor(usageUnit, referenceUnit);
  if (!Number.isFinite(usageFactor) || usageFactor <= 0) {
    throw new Error("Estimated prepared-item conversion must be positive.");
  }
  const conversionChainJson = input.conversionChainJson?.trim() || null;
  if (conversionChainJson) {
    const validation = validateRecipeConversionSnapshotEvidence({
      conversionChainJson,
      unitStandardSnapshot: input.unitStandardSnapshot,
      expectedInputUnit: usageUnit,
      expectedOutputUnit: referenceUnit,
      expectedOutputQuantityPerInputUnit: usageFactor,
    });
    if (!validation.ok) {
      throw new Error(
        `Estimated prepared-item conversion evidence is inconsistent (${validation.reason}).`,
      );
    }
  } else {
    if (input.unitStandardSnapshot?.trim()) {
      throw new Error(
        "Estimated prepared-item unit standard requires a conversion chain.",
      );
    }
    const standardFactor = standardRecipeUnitFactor(usageUnit, referenceUnit);
    if (
      input.usageUnitFactorToReference !== null &&
      input.usageUnitFactorToReference !== undefined &&
      (standardFactor === null ||
        Math.abs(standardFactor - usageFactor) >
          1e-9 * Math.max(1, Math.abs(standardFactor), Math.abs(usageFactor)))
    ) {
      throw new Error(
        "An item-specific estimate conversion requires its exact conversion chain.",
      );
    }
  }
  return {
    referenceUnit,
    usageUnit,
    usageFactor,
    authoritativeUsageUnitCost:
      (input.totalCost / input.referenceQuantity) * usageFactor,
  };
}

async function loadRepeatedEstimate(
  input: AddQuickEstimatedPreparedInputInput,
  validated: ReturnType<typeof validateQuickEstimateInput>,
  db: RepositoryDatabase,
): Promise<QuickEstimatedPreparedInputResult | null> {
  const profile = await getCatalogCostProfileByRequestToken(
    input.businessId,
    input.requestToken,
    db,
  );
  if (!profile) return null;
  if (
    Math.abs(profile.totalCost - input.totalCost) > 1e-9 ||
    Math.abs(profile.referenceQuantity - input.referenceQuantity) > 1e-9 ||
    profile.referenceUnit !== input.referenceUnit.trim()
  ) {
    throw new Error(
      "Estimate request token was already used for different evidence.",
    );
  }
  const row = await db.getFirstAsync<{
    prepared_draft_id: string;
    parent_line_id: string;
    parent_revision: number;
    parent_draft_id: string;
    prepared_name: string | null;
    prepared_branch_id: string | null;
    prepared_notes: string | null;
    catalog_name: string;
    usage_quantity: number | null;
    usage_unit: string | null;
    usage_role: RecipeDraftLineRecord["role"];
    usage_optional: number;
    usage_cost_override: number | null;
    usage_notes: string | null;
  }>(
    `
      SELECT child.id AS prepared_draft_id, line.id AS parent_line_id,
        parent.autosave_revision AS parent_revision,
        parent.id AS parent_draft_id, child.name AS prepared_name,
        child.branch_id AS prepared_branch_id, child.notes AS prepared_notes,
        item.name AS catalog_name, line.quantity AS usage_quantity,
        line.unit AS usage_unit, line.role AS usage_role,
        line.is_optional AS usage_optional,
        line.cost_override AS usage_cost_override,
        line.notes AS usage_notes
      FROM recipe_drafts child
      INNER JOIN catalog_items item
        ON item.id = child.output_catalog_item_id
        AND item.deleted_at IS NULL
      INNER JOIN recipe_draft_lines line
        ON line.catalog_item_id = child.output_catalog_item_id
        AND line.cost_profile_id = ?
        AND line.cost_source = 'owner_estimate'
        AND line.deleted_at IS NULL
      INNER JOIN recipe_drafts parent
        ON parent.id = line.recipe_draft_id
        AND parent.deleted_at IS NULL
      WHERE child.output_catalog_item_id = ?
        AND child.deleted_at IS NULL
      ORDER BY child.created_at ASC
      LIMIT 1
    `,
    [profile.id, profile.catalogItemId],
  );
  const expectedNotes = input.notes?.trim() || null;
  const changedPayload =
    !row ||
    row.parent_draft_id !== input.parentDraftId ||
    (input.catalogItemId !== undefined &&
      input.catalogItemId !== profile.catalogItemId) ||
    (input.costProfileId !== undefined &&
      input.costProfileId !== profile.id) ||
    (input.preparedDraftId !== undefined &&
      input.preparedDraftId !== row.prepared_draft_id) ||
    (input.parentLineId !== undefined &&
      input.parentLineId !== row.parent_line_id) ||
    row.prepared_name?.trim() !== input.name.trim() ||
    row.catalog_name.trim() !== input.name.trim() ||
    (input.branchId !== undefined &&
      input.branchId !== row.prepared_branch_id) ||
    row.usage_quantity === null ||
    Math.abs(row.usage_quantity - input.usageQuantity) > 1e-9 ||
    row.usage_unit?.trim() !== validated.usageUnit ||
    row.usage_role !== (input.role ?? "supporting") ||
    row.usage_optional !== (input.isOptional ? 1 : 0) ||
    row.usage_cost_override === null ||
    Math.abs(
      row.usage_cost_override - validated.authoritativeUsageUnitCost,
    ) > 1e-9 ||
    row.prepared_notes !== expectedNotes ||
    row.usage_notes !== expectedNotes ||
    row.parent_revision < input.parentExpectedRevision + 1;
  if (changedPayload) {
    throw new Error(
      "Estimate request token was replayed with changed coordinated evidence.",
    );
  }
  return {
    repeated: true,
    catalogItemId: profile.catalogItemId,
    preparedDraftId: row.prepared_draft_id,
    parentLineId: row.parent_line_id,
    parentRevision: row.parent_revision,
    costProfile: profile,
  };
}

export async function addQuickEstimatedPreparedInput(
  input: AddQuickEstimatedPreparedInputInput,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<QuickEstimatedPreparedInputResult> {
  await runMigrations(db);
  const validated = validateQuickEstimateInput(input);
  const prior = await loadRepeatedEstimate(input, validated, db);
  if (prior) return prior;

  let result: QuickEstimatedPreparedInputResult | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const repeated = await loadRepeatedEstimate(input, validated, txn);
    if (repeated) {
      result = repeated;
      return;
    }
    await assertBusinessAndBranch(
      input.businessId,
      input.branchId ?? null,
      txn,
    );
    const parent = await txn.getFirstAsync<{
      business_id: string;
      branch_id: string | null;
      lifecycle_status: string;
      autosave_revision: number;
    }>(
      `
        SELECT business_id, branch_id, lifecycle_status, autosave_revision
        FROM recipe_drafts
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.parentDraftId],
    );
    if (
      parent?.business_id !== input.businessId ||
      !["editing", "ready"].includes(parent.lifecycle_status) ||
      parent.autosave_revision !== input.parentExpectedRevision
    ) {
      throw new Error("Parent Recipe draft changed before estimate insertion.");
    }

    const createdAt = timestamp();
    const catalogItemId = input.catalogItemId ?? makeCatalogItemId();
    const preparedDraftId = input.preparedDraftId ?? makeRecipeDraftId();
    const parentLineId = input.parentLineId ?? makeRecipeDraftLineId();
    const replacedLine = input.parentLineId
      ? await txn.getFirstAsync<{
          id: string;
          recipe_draft_id: string;
          source_kind: RecipeDraftLineRecord["sourceKind"];
          catalog_item_id: string | null;
          child_draft_id: string | null;
          cost_source: RecipeDraftLineRecord["costSource"];
        }>(
          `
            SELECT id, recipe_draft_id, source_kind, catalog_item_id,
              child_draft_id, cost_source
            FROM recipe_draft_lines
            WHERE id = ? AND deleted_at IS NULL
          `,
          [input.parentLineId],
        )
      : null;
    if (
      replacedLine &&
      replacedLine.recipe_draft_id !== input.parentDraftId
    ) {
      throw new Error("Only this draft's ingredient can be replaced in place.");
    }
    if (
      replacedLine?.cost_source === "owner_estimate" &&
      replacedLine.catalog_item_id === catalogItemId
    ) {
      throw new Error("Estimate replacement requires a new catalog identity.");
    }
    await txn.runAsync(
      `
        INSERT INTO catalog_items (
          id, business_id, branch_id, name, normalized_name, source_type,
          classification, lifecycle_status, readiness_state,
          classification_review_required, sellable, kiosk_enabled,
          purchase_cost_state, selling_price_state, stock_policy, archived_at,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, 'native', 'prepared_base', 'draft',
          'incomplete', 0, 0, 0, 'not_applicable', 'not_applicable',
          'product_lots', NULL, ?, ?, 'local', NULL)
      `,
      [
        catalogItemId,
        input.businessId,
        input.branchId ?? parent.branch_id,
        input.name.trim(),
        input.name.toLocaleLowerCase().trim(),
        createdAt,
        createdAt,
      ],
    );
    await txn.runAsync(
      `
        INSERT INTO recipe_drafts (
          id, business_id, branch_id, recipe_id, source_version_id,
          output_catalog_item_id, name, category, notes,
          expected_output_quantity,
          expected_output_unit, production_mode, suggested_selling_price,
          classification_proposal, selling_price_state, sellable,
          kiosk_enabled, editor_step, lifecycle_status, autosave_revision,
          last_saved_at, unresolved_requirement_count, parent_draft_id,
          parent_line_id, return_route, published_version_id, created_at,
          updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, 'Prepared item', ?, NULL, NULL,
          'prepared_before_selling', NULL, 'prepared_base', 'not_applicable',
          0, 0, 'inputs', 'editing', 0, ?, 0, NULL, NULL, NULL, NULL, ?, ?,
          'local', NULL)
      `,
      [
        preparedDraftId,
        input.businessId,
        input.branchId ?? parent.branch_id,
        catalogItemId,
        input.name.trim(),
        input.notes?.trim() || null,
        createdAt,
        createdAt,
        createdAt,
      ],
    );
    const profile = await activateCatalogCostProfileInTransaction(
      {
        id: input.costProfileId ?? makeCatalogCostProfileId(),
        businessId: input.businessId,
        catalogItemId,
        sourceKind: "owner_estimate",
        requestToken: input.requestToken,
        totalCost: input.totalCost,
        referenceQuantity: input.referenceQuantity,
        referenceUnit: validated.referenceUnit,
        expectedActiveProfileId: null,
        notes: input.notes,
      },
      txn,
    );
    const conversion = await createConversionSnapshotInTransaction(
      {
        businessId: input.businessId,
        catalogItemId,
        quantity: input.usageQuantity,
        fromUnit: validated.usageUnit,
        toUnit: validated.referenceUnit,
        factor: validated.usageFactor,
      },
      txn,
    );
    const nextSort = await txn.getFirstAsync<{ value: number }>(
      `
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
        FROM recipe_draft_lines
        WHERE recipe_draft_id = ? AND deleted_at IS NULL
      `,
      [input.parentDraftId],
    );
    if (replacedLine) {
      const lineUpdate = await txn.runAsync(
        `
          UPDATE recipe_draft_lines
          SET source_kind = 'catalog_item', catalog_item_id = ?,
            child_recipe_version_id = NULL, child_draft_id = NULL,
            custom_name = ?, quantity = ?, unit = ?, normalized_quantity = ?,
            normalized_unit = ?, conversion_id = ?,
            conversion_factor_snapshot = ?, conversion_chain_json = ?,
            unit_standard_snapshot = ?, role = ?, is_optional = ?,
            cost_override = ?,
            cost_state = 'known', allocation_mode = 'none',
            legacy_ingredient_lot_id = NULL, notes = ?, updated_at = ?,
            sync_status = 'local', cost_source = 'owner_estimate',
            cost_profile_id = ?
          WHERE id = ? AND recipe_draft_id = ? AND business_id = ?
            AND deleted_at IS NULL
        `,
        [
          catalogItemId,
          input.name.trim(),
          input.usageQuantity,
          validated.usageUnit,
          conversion.normalizedQuantity,
          conversion.normalizedUnit,
          conversion.conversionId,
          conversion.conversionFactorSnapshot,
          input.conversionChainJson?.trim() || null,
          input.unitStandardSnapshot?.trim() || null,
          input.role ?? "supporting",
          input.isOptional ? 1 : 0,
          validated.authoritativeUsageUnitCost,
          input.notes?.trim() || null,
          createdAt,
          profile.id,
          parentLineId,
          input.parentDraftId,
          input.businessId,
        ],
      );
      if (lineUpdate.changes !== 1) {
        throw new Error("Owner-estimate line changed before replacement.");
      }
    } else {
      await txn.runAsync(
        `
          INSERT INTO recipe_draft_lines (
            id, business_id, recipe_draft_id, sort_order, source_kind,
            catalog_item_id, child_recipe_version_id, child_draft_id,
            custom_name, quantity, unit, normalized_quantity, normalized_unit,
            conversion_id, conversion_factor_snapshot, conversion_chain_json,
            unit_standard_snapshot, role, is_optional,
            cost_override, cost_state, allocation_mode,
            legacy_ingredient_lot_id, notes, created_at, updated_at, sync_status,
            deleted_at, cost_source, cost_profile_id
          ) VALUES (?, ?, ?, ?, 'catalog_item', ?, NULL, NULL, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, 'known', 'none', NULL, ?, ?, ?,
            'local', NULL, 'owner_estimate', ?)
        `,
        [
          parentLineId,
          input.businessId,
          input.parentDraftId,
          nextSort?.value ?? 0,
          catalogItemId,
          input.name.trim(),
          input.usageQuantity,
          validated.usageUnit,
          conversion.normalizedQuantity,
          conversion.normalizedUnit,
          conversion.conversionId,
          conversion.conversionFactorSnapshot,
          input.conversionChainJson?.trim() || null,
          input.unitStandardSnapshot?.trim() || null,
          input.role ?? "supporting",
          input.isOptional ? 1 : 0,
          validated.authoritativeUsageUnitCost,
          input.notes?.trim() || null,
          createdAt,
          createdAt,
          profile.id,
        ],
      );
    }
    const parentUpdate = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET autosave_revision = autosave_revision + 1,
          last_saved_at = ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND autosave_revision = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND deleted_at IS NULL
      `,
      [
        createdAt,
        createdAt,
        input.parentDraftId,
        input.businessId,
        input.parentExpectedRevision,
      ],
    );
    if (parentUpdate.changes !== 1) {
      throw new Error("Parent Recipe draft changed before estimate save.");
    }
    if (
      replacedLine?.cost_source === "owner_estimate" &&
      replacedLine.catalog_item_id
    ) {
      await deleteRecipeFirstItemInTransaction(
        {
          businessId: input.businessId,
          catalogItemId: replacedLine.catalog_item_id,
          ownerAuthorized: true,
        },
        txn,
        { retainWhenProtected: true },
      );
    }
    if (
      replacedLine?.source_kind === "child_draft" &&
      replacedLine.child_draft_id
    ) {
      const detachedAt = timestamp();
      const detached = await txn.runAsync(
        `
          UPDATE recipe_drafts
          SET parent_draft_id = NULL, parent_line_id = NULL,
            return_route = NULL, autosave_revision = autosave_revision + 1,
            last_saved_at = ?, updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND parent_draft_id = ?
            AND parent_line_id = ? AND lifecycle_status IN ('editing', 'ready')
            AND deleted_at IS NULL
        `,
        [
          detachedAt,
          detachedAt,
          replacedLine.child_draft_id,
          input.businessId,
          input.parentDraftId,
          parentLineId,
        ],
      );
      if (detached.changes !== 1) {
        throw new Error("Nested Recipe draft changed before replacement.");
      }
    }
    result = {
      repeated: false,
      catalogItemId,
      preparedDraftId,
      parentLineId,
      parentRevision: input.parentExpectedRevision + 1,
      costProfile: profile,
    };
  });
  if (!result) throw new Error("Quick prepared-item estimate failed.");
  return result;
}

export type BeginNestedPreparedRecipeDraftInput = {
  businessId: string;
  branchId?: string | null;
  parentDraftId: string;
  parentLineId: string;
  parentExpectedRevision: number;
  returnRoute: string;
  name: string;
  category?: string | null;
  notes?: string | null;
  ids?: RecipeFirstIdentityIds;
};

export async function beginNestedPreparedRecipeDraft(
  input: BeginNestedPreparedRecipeDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  if (
    !Number.isInteger(input.parentExpectedRevision) ||
    input.parentExpectedRevision < 0
  ) {
    throw new Error("Parent Recipe revision is invalid.");
  }
  const returnRoute = requireText(input.returnRoute, "Nested return route");
  const identityIds: Required<RecipeFirstIdentityIds> = {
    catalogItemId: input.ids?.catalogItemId ?? makeCatalogItemId(),
    productId: input.ids?.productId ?? makeProductId(),
    bindingId: input.ids?.bindingId ?? makeLegacyBindingId(),
    draftId: input.ids?.draftId ?? makeRecipeDraftId(),
  };
  await db.withExclusiveTransactionAsync(async (txn) => {
    const parent = await txn.getFirstAsync<{
      business_id: string;
      lifecycle_status: string;
      autosave_revision: number;
    }>(
      `
        SELECT business_id, lifecycle_status, autosave_revision
        FROM recipe_drafts
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.parentDraftId],
    );
    const line = await txn.getFirstAsync<{
      source_kind: string;
      catalog_item_id: string | null;
      child_recipe_version_id: string | null;
      child_draft_id: string | null;
    }>(
      `
        SELECT source_kind, catalog_item_id, child_recipe_version_id,
          child_draft_id
        FROM recipe_draft_lines
        WHERE id = ? AND recipe_draft_id = ? AND deleted_at IS NULL
      `,
      [input.parentLineId, input.parentDraftId],
    );
    if (
      parent?.business_id !== input.businessId ||
      !["editing", "ready"].includes(parent.lifecycle_status) ||
      parent.autosave_revision !== input.parentExpectedRevision ||
      !line ||
      line.source_kind !== "unresolved" ||
      line.catalog_item_id !== null ||
      line.child_recipe_version_id !== null ||
      line.child_draft_id !== null
    ) {
      throw new Error("Nested Recipe placeholder changed before start.");
    }
    await insertRecipeFirstIdentity(
      {
        businessId: input.businessId,
        branchId: input.branchId,
        name: input.name,
        category: input.category,
        notes: input.notes,
        mode: "prepared_batch",
        ids: identityIds,
      },
      txn,
      {
        parentDraftId: input.parentDraftId,
        parentLineId: input.parentLineId,
        returnRoute,
      },
    );
    const changedLine = await txn.runAsync(
      `
        UPDATE recipe_draft_lines
        SET source_kind = 'child_draft', child_draft_id = ?,
          cost_source = 'unknown', cost_profile_id = NULL,
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND recipe_draft_id = ?
          AND source_kind = 'unresolved'
          AND catalog_item_id IS NULL
          AND child_recipe_version_id IS NULL
          AND child_draft_id IS NULL
          AND deleted_at IS NULL
      `,
      [
        identityIds.draftId,
        timestamp(),
        input.parentLineId,
        input.parentDraftId,
      ],
    );
    if (changedLine.changes !== 1) {
      throw new Error("Nested Recipe placeholder changed before save.");
    }
    const changedParent = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET autosave_revision = autosave_revision + 1,
          last_saved_at = ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND autosave_revision = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND deleted_at IS NULL
      `,
      [
        timestamp(),
        timestamp(),
        input.parentDraftId,
        input.businessId,
        input.parentExpectedRevision,
      ],
    );
    if (changedParent.changes !== 1) {
      throw new Error("Parent Recipe changed before nested save.");
    }
  });
  const snapshot = await loadRecipeFirstDraft(identityIds.draftId, db);
  if (!snapshot) throw new Error("Nested Recipe-first draft is unavailable.");
  return snapshot;
}

export type PublishRecipeFirstDraftInput = {
  businessId: string;
  draftId: string;
  expectedRevision: number;
  role?: "default" | "alternative";
  expectedActiveCostProfileId?: string | null;
  requireCompleteCost?: boolean;
  requirePreparedProduction?: boolean;
  requirePreparedClassification?: boolean;
  ids?: {
    productId?: string;
    bindingId?: string;
    recipeId?: string;
    versionId?: string;
    costSummaryId?: string;
    recipeCostProfileId?: string;
  };
};

export type RecipeFirstPublicationResult = {
  repeated: boolean;
  version: RecipeVersionRecord;
  summary: Awaited<ReturnType<typeof getRecipeVersionCostSummary>>;
  activeCostProfile: CatalogCostProfileRecord | null;
  saleActivationState:
    | "inactive_pending_readiness"
    | "active_state_preserved";
};

function persistenceCostToVersionCost(
  state: RecipeDraftLineRecord["costState"],
): VersionCostState {
  if (
    state === "known" ||
    state === "unknown" ||
    state === "legacy_zero_unresolved" ||
    state === "not_applicable"
  ) {
    return state;
  }
  return "unknown";
}

async function buildDomainDraft(
  draft: RecipeDraftRecord,
  familyId: string,
  lines: RecipeDraftLineRecord[],
  db: RepositoryDatabase,
  duplicatedFromVersionId: string | null,
): Promise<{
  draft: RecipeVersionDraft;
  evidence: Record<
    string,
    {
      costSource: RecipeLineCostSource;
      costProfileId: string | null;
      allocationMode: RecipeDraftLineRecord["allocationMode"];
      legacyIngredientLotId: string | null;
      customName: string | null;
      conversionChainJson: string | null;
      unitStandardSnapshot: string | null;
    }
  >;
}> {
  if (!draft.outputCatalogItemId) {
    throw new Error("Recipe draft has no output catalog identity.");
  }
  const inputs: RecipeVersionDraftInput[] = [];
  const evidence: Record<
    string,
    {
      costSource: RecipeLineCostSource;
      costProfileId: string | null;
      allocationMode: RecipeDraftLineRecord["allocationMode"];
      legacyIngredientLotId: string | null;
      customName: string | null;
      conversionChainJson: string | null;
      unitStandardSnapshot: string | null;
    }
  > = {};
  for (const line of lines) {
    evidence[line.id] = {
      costSource: line.costSource,
      costProfileId: line.costProfileId,
      allocationMode: line.allocationMode,
      legacyIngredientLotId: line.legacyIngredientLotId,
      customName: line.customName,
      conversionChainJson: line.conversionChainJson,
      unitStandardSnapshot: line.unitStandardSnapshot,
    };
    const base = {
      id: line.id,
      quantity: line.quantity,
      unit: line.unit,
      role: line.role,
      optional: line.isOptional,
      costState: persistenceCostToVersionCost(line.costState),
      authoritativeUnitCost: line.costOverride,
    };
    if (line.sourceKind === "unresolved" || line.sourceKind === "child_draft") {
      inputs.push({
        id: line.id,
        sourceKind: "unresolved",
        label: line.customName?.trim() || "Unresolved input",
        quantity: line.quantity,
        unit: line.unit,
        role: line.role,
        optional: line.isOptional,
        costState: persistenceCostToVersionCost(line.costState),
        authoritativeUnitCost: line.costOverride,
      });
      continue;
    }
    if (line.sourceKind === "custom_cost") {
      inputs.push({
        ...base,
        sourceKind: "custom_cost",
        label: line.customName?.trim() || "Custom cost",
        quantity: line.quantity ?? 0,
        unit: line.unit ?? "",
      });
      continue;
    }
    if (line.sourceKind === "catalog_item") {
      const item = await db.getFirstAsync<{
        business_id: string;
        name: string;
      }>(
        `
          SELECT business_id, name
          FROM catalog_items
          WHERE id = ? AND deleted_at IS NULL
        `,
        [line.catalogItemId],
      );
      if (item?.business_id !== draft.businessId) {
        throw new Error("Recipe input item is unavailable.");
      }
      inputs.push({
        ...base,
        sourceKind: "catalog_item",
        catalogItemId: line.catalogItemId as string,
        label: item.name,
        quantity: line.quantity ?? 0,
        unit: line.unit ?? "",
        normalizedQuantity: line.normalizedQuantity ?? undefined,
        normalizedUnit: line.normalizedUnit ?? undefined,
        conversionId: line.conversionId ?? undefined,
        conversionFactorSnapshot:
          line.conversionFactorSnapshot ?? undefined,
      });
      continue;
    }
    const child = await db.getFirstAsync<{
      business_id: string;
      output_catalog_item_id: string;
      name_snapshot: string;
    }>(
      `
        SELECT business_id, output_catalog_item_id, name_snapshot
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
      `,
      [line.childRecipeVersionId],
    );
    if (child?.business_id !== draft.businessId) {
      throw new Error("Nested Recipe version is unavailable.");
    }
    inputs.push({
      ...base,
      sourceKind: "child_recipe_version",
      childVersionId: line.childRecipeVersionId as string,
      childOutputItemId: child.output_catalog_item_id,
      label: child.name_snapshot,
      quantity: line.quantity ?? 0,
      unit: line.unit ?? "",
      normalizedQuantity: line.normalizedQuantity ?? undefined,
      normalizedUnit: line.normalizedUnit ?? undefined,
      conversionId: line.conversionId ?? undefined,
      conversionFactorSnapshot:
        line.conversionFactorSnapshot ?? undefined,
    });
  }

  return {
    draft: {
      id: draft.id,
      familyId,
      businessId: draft.businessId,
      basedOnVersionId: draft.sourceVersionId,
      duplicatedFromVersionId,
      name: draft.name ?? "",
      category: draft.category,
      outputCatalogItemId: draft.outputCatalogItemId,
      expectedOutputQuantity: draft.expectedOutputQuantity,
      outputUnit: draft.expectedOutputUnit,
      productionMode:
        draft.productionMode ?? "prepared_before_selling",
      suggestedSellingPrice: draft.suggestedSellingPrice,
      sellingPriceState: persistenceCostToVersionCost(
        draft.sellingPriceState,
      ),
      requestedReadyForSale: false,
      notes: draft.notes,
      inputs,
      revision: draft.autosaveRevision,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    },
    evidence,
  };
}

async function ensureNativeProductProjection(
  draft: RecipeDraftRecord,
  classification: "prepared_base" | "finished_product",
  ids: { productId: string; bindingId: string },
  db: RepositoryDatabase,
) {
  const existing = await db.getFirstAsync<{
    product_id: string;
    business_id: string;
    compatibility_mode: string;
    projection_role: string;
    product_active: number;
  }>(
    `
      SELECT binding.legacy_entity_id AS product_id, binding.business_id,
        binding.compatibility_mode, binding.projection_role,
        product.active AS product_active
      FROM legacy_item_bindings binding
      INNER JOIN products product
        ON product.id = binding.legacy_entity_id
        AND product.deleted_at IS NULL
      WHERE binding.catalog_item_id = ?
        AND binding.entity_kind = 'product'
        AND binding.binding_status = 'active'
        AND binding.deleted_at IS NULL
    `,
    [draft.outputCatalogItemId],
  );
  if (existing) {
    if (
      existing.business_id !== draft.businessId ||
      existing.compatibility_mode !== "native" ||
      existing.projection_role !== "recipe_output"
    ) {
      throw new Error(
        "Recipe-first output projection is not an exact native Product.",
      );
    }
    return {
      productId: existing.product_id,
      created: false,
      productActive: existing.product_active === 1,
    };
  }
  const createdAt = timestamp();
  await db.runAsync(
    `
      INSERT INTO products (
        id, business_id, branch_id, name, category, price, cost, stock_qty,
        unit_type, low_stock_threshold, bundle_quantity, bundle_price,
        bundle_label, active, product_type, created_at, updated_at,
        sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 0, NULL, NULL, NULL, 0, ?, ?, ?,
        'local', NULL)
    `,
    [
      ids.productId,
      draft.businessId,
      draft.branchId,
      draft.name?.trim() || "Prepared item",
      draft.category?.trim() || "General",
      classification === "finished_product" ? "piece" : "other",
      classification === "finished_product"
        ? "cooked food"
        : "ingredient-based item",
      createdAt,
      createdAt,
    ],
  );
  await db.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, legacy_deleted_at_snapshot,
        migration_provenance, reviewed_at, native_activated_at, created_at,
        updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, 'product', ?, 'recipe_output', 'active', 'native', 0,
        0, NULL, 'native', ?, NULL, ?, ?, 'local', NULL)
    `,
    [
      ids.bindingId,
      draft.businessId,
      draft.outputCatalogItemId,
      ids.productId,
      createdAt,
      createdAt,
      createdAt,
    ],
  );
  return {
    productId: ids.productId,
    created: true,
    productActive: false,
  };
}

function calculateCostSummary(
  lines: RecipeDraftLineRecord[],
  expectedOutputQuantity: number,
) {
  let knownCostSubtotal = 0;
  let monetaryLineCount = 0;
  let missingRequiredCount = 0;
  let estimatedInputCount = 0;
  for (const line of lines) {
    if (line.costState === "known" && line.costOverride !== null) {
      monetaryLineCount += 1;
      if (
        line.costSource !== "purchase_lot" &&
        line.costSource !== "recipe_version"
      ) {
        estimatedInputCount += 1;
      }
      knownCostSubtotal +=
        line.sourceKind === "custom_cost"
          ? line.costOverride
          : line.costOverride * (line.quantity ?? 0);
    } else if (
      !line.isOptional &&
      line.costState !== "not_applicable"
    ) {
      missingRequiredCount += 1;
    }
  }
  const complete = missingRequiredCount === 0;
  const totalCost =
    complete && monetaryLineCount > 0 ? knownCostSubtotal : null;
  const status: RecipeVersionCostSummaryStatus = !complete
    ? "incomplete"
    : totalCost === null
      ? "no_price"
      : estimatedInputCount > 0
        ? "estimated"
        : "actual";
  return {
    status,
    totalCost,
    costPerOutputUnit:
      totalCost === null ? null : totalCost / expectedOutputQuantity,
    knownCostSubtotal,
    missingRequiredCount,
    estimatedInputCount,
  };
}

async function resolveNestedParentInTransaction(
  child: RecipeDraftRecord,
  version: RecipeVersionRecord,
  profile: CatalogCostProfileRecord | null,
  db: RepositoryDatabase,
) {
  if (!child.parentDraftId || !child.parentLineId) return;
  const parentLine = await db.getFirstAsync<{
    source_kind: string;
    child_draft_id: string | null;
    quantity: number | null;
    unit: string | null;
  }>(
    `
      SELECT source_kind, child_draft_id, quantity, unit
      FROM recipe_draft_lines
      WHERE id = ? AND recipe_draft_id = ? AND deleted_at IS NULL
    `,
    [child.parentLineId, child.parentDraftId],
  );
  const parent = await db.getFirstAsync<{
    business_id: string;
    lifecycle_status: string;
    autosave_revision: number;
  }>(
    `
      SELECT business_id, lifecycle_status, autosave_revision
      FROM recipe_drafts
      WHERE id = ? AND deleted_at IS NULL
    `,
    [child.parentDraftId],
  );
  if (
    parent?.business_id !== child.businessId ||
    !["editing", "ready"].includes(parent.lifecycle_status) ||
    parentLine?.source_kind !== "child_draft" ||
    parentLine.child_draft_id !== child.id ||
    !parentLine.unit ||
    parentLine.quantity === null
  ) {
    throw new Error("Nested Recipe return context changed before publication.");
  }
  const referenceUnit = profile?.referenceUnit ?? version.expectedOutputUnit;
  const usageFactor = unitFactor(parentLine.unit, referenceUnit);
  const costPerParentUnit = profile
    ? (profile.totalCost / profile.referenceQuantity) * usageFactor
    : null;
  const conversion = await createConversionSnapshotInTransaction(
    {
      businessId: child.businessId,
      catalogItemId: version.outputCatalogItemId,
      quantity: parentLine.quantity,
      fromUnit: parentLine.unit,
      toUnit: referenceUnit,
      factor: usageFactor,
    },
    db,
  );
  const changedLine = await db.runAsync(
    `
      UPDATE recipe_draft_lines
      SET source_kind = 'child_recipe_version',
        child_recipe_version_id = ?, child_draft_id = NULL,
        normalized_quantity = ?, normalized_unit = ?, conversion_id = ?,
        conversion_factor_snapshot = ?,
        cost_override = ?, cost_state = ?,
        cost_source = ?, cost_profile_id = ?,
        updated_at = ?, sync_status = 'local'
      WHERE id = ? AND recipe_draft_id = ?
        AND source_kind = 'child_draft' AND child_draft_id = ?
        AND deleted_at IS NULL
    `,
    [
      version.id,
      conversion.normalizedQuantity,
      conversion.normalizedUnit,
      conversion.conversionId,
      conversion.conversionFactorSnapshot,
      costPerParentUnit,
      profile ? "known" : "unknown",
      profile ? "recipe_version" : "unknown",
      profile?.id ?? null,
      timestamp(),
      child.parentLineId,
      child.parentDraftId,
      child.id,
    ],
  );
  if (changedLine.changes !== 1) {
    throw new Error("Nested Recipe parent line changed before return.");
  }
  const changedParent = await db.runAsync(
    `
      UPDATE recipe_drafts
      SET autosave_revision = autosave_revision + 1,
        last_saved_at = ?, updated_at = ?, sync_status = 'local'
      WHERE id = ? AND autosave_revision = ?
        AND lifecycle_status IN ('editing', 'ready')
        AND deleted_at IS NULL
    `,
    [
      timestamp(),
      timestamp(),
      child.parentDraftId,
      parent.autosave_revision,
    ],
  );
  if (changedParent.changes !== 1) {
    throw new Error("Nested Recipe parent changed before return.");
  }
}

async function upgradeEstimatedDraftConsumersInTransaction(
  estimateProfileId: string,
  catalogItemId: string,
  version: RecipeVersionRecord,
  recipeProfile: CatalogCostProfileRecord,
  db: RepositoryDatabase,
) {
  const consumers = await db.getAllAsync<{
    line_id: string;
    draft_id: string;
    autosave_revision: number;
    quantity: number | null;
    unit: string | null;
    conversion_id: string | null;
    normalized_quantity: number | null;
    normalized_unit: string | null;
    conversion_factor_snapshot: number | null;
  }>(
    `
      SELECT line.id AS line_id, draft.id AS draft_id,
        draft.autosave_revision, line.quantity, line.unit,
        line.conversion_id, line.normalized_quantity, line.normalized_unit,
        line.conversion_factor_snapshot
      FROM recipe_draft_lines line
      INNER JOIN recipe_drafts draft
        ON draft.id = line.recipe_draft_id
        AND draft.lifecycle_status IN ('editing', 'ready')
        AND draft.deleted_at IS NULL
      WHERE line.source_kind = 'catalog_item'
        AND line.catalog_item_id = ?
        AND line.cost_source = 'owner_estimate'
        AND line.cost_profile_id = ?
        AND line.deleted_at IS NULL
      ORDER BY draft.id ASC, line.id ASC
    `,
    [catalogItemId, estimateProfileId],
  );
  const revisions = new Map<string, number>();
  for (const consumer of consumers) {
    if (!consumer.unit || consumer.quantity === null) {
      throw new Error(
        "Estimated prepared-item consumer is missing its usage unit.",
      );
    }
    const usageFactor = unitFactorWithSnapshot(
      consumer.unit,
      recipeProfile.referenceUnit,
      {
        id: consumer.conversion_id,
        normalizedUnit: consumer.normalized_unit,
        factor: consumer.conversion_factor_snapshot,
      },
    );
    const costPerUsageUnit =
      (recipeProfile.totalCost / recipeProfile.referenceQuantity) *
      usageFactor;
    const conversion = await createConversionSnapshotInTransaction(
      {
        businessId: version.businessId,
        catalogItemId,
        quantity: consumer.quantity,
        fromUnit: consumer.unit,
        toUnit: recipeProfile.referenceUnit,
        factor: usageFactor,
        existing: {
          normalizedQuantity: consumer.normalized_quantity,
          normalizedUnit: consumer.normalized_unit,
          conversionId: consumer.conversion_id,
          conversionFactorSnapshot:
            consumer.conversion_factor_snapshot,
        },
      },
      db,
    );
    const changed = await db.runAsync(
      `
        UPDATE recipe_draft_lines
        SET source_kind = 'child_recipe_version',
          catalog_item_id = NULL, child_recipe_version_id = ?,
          child_draft_id = NULL, normalized_quantity = ?,
          normalized_unit = ?, conversion_id = ?,
          conversion_factor_snapshot = ?, cost_override = ?,
          cost_state = 'known',
          cost_source = 'recipe_version', cost_profile_id = ?,
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND recipe_draft_id = ?
          AND source_kind = 'catalog_item' AND catalog_item_id = ?
          AND cost_source = 'owner_estimate' AND cost_profile_id = ?
          AND deleted_at IS NULL
      `,
      [
        version.id,
        conversion.normalizedQuantity,
        conversion.normalizedUnit,
        conversion.conversionId,
        conversion.conversionFactorSnapshot,
        costPerUsageUnit,
        recipeProfile.id,
        timestamp(),
        consumer.line_id,
        consumer.draft_id,
        catalogItemId,
        estimateProfileId,
      ],
    );
    if (changed.changes !== 1) {
      throw new Error(
        "Estimated prepared-item consumer changed before promotion.",
      );
    }
    revisions.set(consumer.draft_id, consumer.autosave_revision);
  }
  for (const [draftId, revision] of revisions) {
    const changed = await db.runAsync(
      `
        UPDATE recipe_drafts
        SET autosave_revision = autosave_revision + 1,
          last_saved_at = ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND autosave_revision = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND deleted_at IS NULL
      `,
      [timestamp(), timestamp(), draftId, revision],
    );
    if (changed.changes !== 1) {
      throw new Error(
        "Estimated prepared-item parent changed before promotion.",
      );
    }
  }
}

async function loadCompletedPublication(
  draft: RecipeDraftRecord,
  repeated: boolean,
  db: RepositoryDatabase,
): Promise<RecipeFirstPublicationResult> {
  if (!draft.publishedVersionId || !draft.outputCatalogItemId) {
    throw new Error("Published Recipe draft is missing immutable identity.");
  }
  const version = await getRecipeVersionById(draft.publishedVersionId, db);
  if (!version) throw new Error("Published Recipe version is unavailable.");
  const output = await loadOutputRow(draft.outputCatalogItemId, db);
  return {
    repeated,
    version,
    summary: await getRecipeVersionCostSummary(version.id, db),
    activeCostProfile: await getActiveCatalogCostProfile(
      draft.outputCatalogItemId,
      db,
    ),
    saleActivationState:
      output?.lifecycle_status === "active" &&
      output.product_active === 1
        ? "active_state_preserved"
        : "inactive_pending_readiness",
  };
}

export async function publishRecipeFirstDraft(
  input: PublishRecipeFirstDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<RecipeFirstPublicationResult> {
  await runMigrations(db);
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("Recipe publication revision is invalid.");
  }
  const existingDraft = await getRecipeDraftById(input.draftId, db);
  if (!existingDraft || existingDraft.businessId !== input.businessId) {
    throw new Error("Recipe-first draft is unavailable.");
  }
  if (existingDraft.lifecycle === "published") {
    return loadCompletedPublication(existingDraft, true, db);
  }
  const generated = {
    productId: input.ids?.productId ?? makeProductId(),
    bindingId: input.ids?.bindingId ?? makeLegacyBindingId(),
    recipeId: input.ids?.recipeId ?? makeRecipeId(),
    versionId: input.ids?.versionId ?? makeRecipeVersionId(),
    costSummaryId:
      input.ids?.costSummaryId ?? makeRecipeVersionCostSummaryId(),
    recipeCostProfileId:
      input.ids?.recipeCostProfileId ?? makeCatalogCostProfileId(),
  };

  await db.withExclusiveTransactionAsync(async (txn) => {
    const draft = await getRecipeDraftById(input.draftId, txn);
    if (!draft || draft.businessId !== input.businessId) {
      throw new Error("Recipe-first draft is unavailable.");
    }
    if (draft.lifecycle === "published") return;
    if (
      !["editing", "ready"].includes(draft.lifecycle) ||
      draft.autosaveRevision !== input.expectedRevision ||
      !draft.outputCatalogItemId
    ) {
      throw new Error("Recipe-first draft changed before publication.");
    }
    if (
      input.requirePreparedProduction &&
      draft.productionMode !== "prepared_before_selling"
    ) {
      throw new Error(
        "Prepared-item completion requires prepared production.",
      );
    }
    const item = await txn.getFirstAsync<{
      business_id: string;
      source_type: string;
      classification: string;
    }>(
      `
        SELECT business_id, source_type, classification
        FROM catalog_items
        WHERE id = ? AND deleted_at IS NULL
          AND lifecycle_status <> 'archived'
      `,
      [draft.outputCatalogItemId],
    );
    const classification =
      draft.classificationProposal ?? item?.classification;
    if (
      item?.business_id !== input.businessId ||
      item.source_type !== "native" ||
      (classification !== "prepared_base" &&
        classification !== "finished_product")
    ) {
      throw new Error(
        "Recipe-first publication requires an explicit prepared or finished classification.",
      );
    }
    if (
      input.requirePreparedClassification &&
      classification !== "prepared_base"
    ) {
      throw new Error(
        "Prepared-item completion requires prepared-base classification.",
      );
    }
    const priorVersion = await txn.getFirstAsync<{ id: string }>(
      `
        SELECT id
        FROM recipe_versions
        WHERE output_catalog_item_id = ? AND deleted_at IS NULL
        LIMIT 1
      `,
      [draft.outputCatalogItemId],
    );
    const isFirstPublication = !priorVersion;
    const projection = await ensureNativeProductProjection(
      draft,
      classification,
      {
        productId: generated.productId,
        bindingId: generated.bindingId,
      },
      txn,
    );
    const productId = projection.productId;
    const duplicatedFromVersionId =
      draft.sourceVersionId && !draft.recipeId
        ? draft.sourceVersionId
        : null;
    const familyId = draft.recipeId ?? generated.recipeId;
    if (draft.recipeId && input.ids?.recipeId && draft.recipeId !== input.ids.recipeId) {
      throw new Error("Recipe family identity does not match the saved draft.");
    }
    if (!draft.recipeId) {
      await txn.runAsync(
        `
          INSERT INTO recipes (
            id, business_id, output_product_id, name, output_quantity,
            output_unit, production_mode, suggested_selling_price, notes,
            is_active, created_at, updated_at, sync_status, deleted_at,
            active_version_id, versioning_state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, 'local', NULL,
            NULL, 'native')
        `,
        [
          familyId,
          input.businessId,
          productId,
          draft.name?.trim() || "Recipe",
          draft.expectedOutputQuantity ?? 1,
          draft.expectedOutputUnit?.trim() || "pcs",
          draft.productionMode ?? "prepared_before_selling",
          draft.suggestedSellingPrice,
          timestamp(),
          timestamp(),
        ],
      );
      const attached = await txn.runAsync(
        `
          UPDATE recipe_drafts
          SET recipe_id = ?, classification_proposal = ?,
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND recipe_id IS NULL
            AND autosave_revision = ?
            AND lifecycle_status IN ('editing', 'ready')
            AND deleted_at IS NULL
        `,
        [
          familyId,
          classification,
          timestamp(),
          draft.id,
          draft.businessId,
          draft.autosaveRevision,
        ],
      );
      if (attached.changes !== 1) {
        throw new Error("Recipe family attachment lost its revision guard.");
      }
      draft.recipeId = familyId;
      draft.classificationProposal = classification;
    }

    const lines = await listRecipeDraftLines(draft.id, txn);
    const publicationDraft = await buildDomainDraft(
      draft,
      familyId,
      lines,
      txn,
      duplicatedFromVersionId,
    );
    const publication = await publishValidatedRecipeDraftInTransaction(
      {
        draft: publicationDraft.draft,
        versionId: generated.versionId,
        outputProductIdSnapshot: productId,
        expectedStoredDraftRevision: draft.autosaveRevision,
        role: input.role ?? "default",
        lineCostEvidence: publicationDraft.evidence,
      },
      txn,
    );
    if (!publication.ok) {
      const first = publication.validation.errors[0]?.message;
      throw new Error(first ?? "Recipe draft is not publishable.");
    }
    const summary = calculateCostSummary(
      lines,
      publication.version.expectedOutputQuantity,
    );
    if (
      input.requireCompleteCost &&
      summary.missingRequiredCount > 0
    ) {
      throw new Error(
        "Prepared-item completion requires complete required-input cost evidence.",
      );
    }
    await createRecipeVersionCostSummary(
      {
        id: generated.costSummaryId,
        businessId: input.businessId,
        recipeVersionId: publication.version.id,
        ...summary,
      },
      txn,
    );
    let profile: CatalogCostProfileRecord | null = null;
    let supersededEstimateProfileId: string | null = null;
    if (summary.totalCost !== null) {
      const current = await getActiveCatalogCostProfile(
        draft.outputCatalogItemId,
        txn,
      );
      supersededEstimateProfileId =
        current?.sourceKind === "owner_estimate" ? current.id : null;
      const expectedActive =
        input.expectedActiveCostProfileId === undefined
          ? current?.id ?? null
          : input.expectedActiveCostProfileId;
      profile = await activateCatalogCostProfileInTransaction(
        {
          id: generated.recipeCostProfileId,
          businessId: input.businessId,
          catalogItemId: draft.outputCatalogItemId,
          sourceKind: "recipe_version",
          sourceRecipeVersionId: publication.version.id,
          totalCost: summary.totalCost,
          referenceQuantity: publication.version.expectedOutputQuantity,
          referenceUnit: publication.version.expectedOutputUnit,
          expectedActiveProfileId: expectedActive,
        },
        txn,
      );
      if (supersededEstimateProfileId) {
        await upgradeEstimatedDraftConsumersInTransaction(
          supersededEstimateProfileId,
          draft.outputCatalogItemId,
          publication.version,
          profile,
          txn,
        );
      }
    } else if (input.requireCompleteCost) {
      throw new Error(
        "Prepared-item completion requires a recipe-derived total cost.",
      );
    }

    const projectionName = draft.name?.trim() || "Recipe";
    const projectionTimestamp = timestamp();
    // Readiness is derived from the published definition. It used to be
    // hard-coded to 'incomplete', which no writer could ever clear, so a
    // published Recipe could never reach Paninda `Active`. Listing the item
    // for sale remains a separate, explicit owner act (see panindaListing).
    const publishedReadinessState = resolvePublishedReadinessState({
      graphState: publication.version.graphState,
      hasInputLines: lines.length > 0,
    });
    if (isFirstPublication) {
      await txn.runAsync(
        `
          UPDATE catalog_items
          SET name = ?, normalized_name = ?, classification = ?,
            lifecycle_status = 'ready', readiness_state = ?,
            classification_review_required = 0, sellable = 0,
            kiosk_enabled = 0, selling_price_state = ?,
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND source_type = 'native'
            AND deleted_at IS NULL
        `,
        [
          projectionName,
          projectionName.toLocaleLowerCase(),
          classification,
          publishedReadinessState,
          draft.sellingPriceState,
          projectionTimestamp,
          draft.outputCatalogItemId,
          input.businessId,
        ],
      );
    } else {
      await txn.runAsync(
        `
          UPDATE catalog_items
          SET name = ?, normalized_name = ?, classification = ?,
            readiness_state = ?,
            classification_review_required = 0, selling_price_state = ?,
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND source_type = 'native'
            AND deleted_at IS NULL
        `,
        [
          projectionName,
          projectionName.toLocaleLowerCase(),
          classification,
          // Republishing refreshes readiness from the new definition but never
          // changes listing state: an item already on sale stays on sale, and
          // an unlisted one is not silently listed.
          publishedReadinessState,
          draft.sellingPriceState,
          projectionTimestamp,
          draft.outputCatalogItemId,
          input.businessId,
        ],
      );
    }
    const productUnitType =
      classification === "finished_product" ? "piece" : "other";
    const productType =
      classification === "finished_product"
        ? "cooked food"
        : "ingredient-based item";
    if (isFirstPublication) {
      await txn.runAsync(
        `
          UPDATE products
          SET name = ?, category = ?, active = 0, unit_type = ?,
            product_type = ?, price = COALESCE(?, price),
            cost = COALESCE(?, cost), updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
        `,
        [
          projectionName,
          draft.category?.trim() || "General",
          productUnitType,
          productType,
          draft.suggestedSellingPrice,
          summary.costPerOutputUnit,
          projectionTimestamp,
          productId,
          input.businessId,
        ],
      );
    } else {
      await txn.runAsync(
        `
          UPDATE products
          SET name = ?, category = ?, unit_type = ?, product_type = ?,
            price = COALESCE(?, price), cost = COALESCE(?, cost),
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
        `,
        [
          projectionName,
          draft.category?.trim() || "General",
          productUnitType,
          productType,
          draft.suggestedSellingPrice,
          summary.costPerOutputUnit,
          projectionTimestamp,
          productId,
          input.businessId,
        ],
      );
    }
    await txn.runAsync(
      isFirstPublication
        ? `
            UPDATE legacy_item_bindings
            SET review_required = 0, reviewed_at = COALESCE(reviewed_at, ?),
              legacy_active_snapshot = 0, updated_at = ?,
              sync_status = 'local'
            WHERE catalog_item_id = ? AND entity_kind = 'product'
              AND legacy_entity_id = ? AND compatibility_mode = 'native'
              AND deleted_at IS NULL
          `
        : `
            UPDATE legacy_item_bindings
            SET review_required = 0, reviewed_at = COALESCE(reviewed_at, ?),
              updated_at = ?, sync_status = 'local'
            WHERE catalog_item_id = ? AND entity_kind = 'product'
              AND legacy_entity_id = ? AND compatibility_mode = 'native'
              AND deleted_at IS NULL
          `,
      [
        projectionTimestamp,
        projectionTimestamp,
        draft.outputCatalogItemId,
        productId,
      ],
    );
    if (draft.parentDraftId) {
      await resolveNestedParentInTransaction(
        draft,
        publication.version,
        profile,
        txn,
      );
    }
  });

  const publishedDraft = await getRecipeDraftById(input.draftId, db);
  if (!publishedDraft || publishedDraft.lifecycle !== "published") {
    throw new Error("Recipe-first publication did not persist.");
  }
  return loadCompletedPublication(publishedDraft, false, db);
}

export type CompletePreparedItemRecipeInput = Omit<
  PublishRecipeFirstDraftInput,
  | "requireCompleteCost"
  | "requirePreparedProduction"
  | "requirePreparedClassification"
>;

export async function completePreparedItemRecipe(
  input: CompletePreparedItemRecipeInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  const result = await publishRecipeFirstDraft(
    {
      ...input,
      requireCompleteCost: false,
      requirePreparedProduction: true,
      requirePreparedClassification: true,
    },
    db,
  );
  return result;
}

async function insertVersionLinesIntoDraft(
  businessId: string,
  draftId: string,
  lines: RecipeVersionLineRecord[],
  db: RepositoryDatabase,
  options: { refreshPreparedEstimateCosts?: boolean } = {},
) {
  const createdAt = timestamp();
  for (const [sortOrder, line] of lines.entries()) {
    let sourceKind = line.sourceKind;
    let catalogItemId = line.catalogItemId;
    let childRecipeVersionId = line.childRecipeVersionId;
    let costSource = line.costSource;
    let costProfileId = line.costProfileId;
    let costState = line.costState;
    let normalizedQuantity = line.normalizedQuantity;
    let normalizedUnit = line.normalizedUnit;
    let conversionId = line.conversionId;
    let conversionFactorSnapshot = line.conversionFactorSnapshot;
    let costOverride =
      line.sourceKind === "catalog_item"
        ? line.costPerUnitSnapshot
        : line.sourceKind === "child_recipe_version"
          ? line.lineCostSnapshot === null
            ? null
            : line.lineCostSnapshot / line.quantity
          : line.costOverride;
    if (
      options.refreshPreparedEstimateCosts &&
      line.sourceKind === "catalog_item" &&
      line.costSource === "owner_estimate" &&
      line.catalogItemId
    ) {
      const activeProfile = await getActiveCatalogCostProfile(
        line.catalogItemId,
        db,
      );
      const activeVersion = activeProfile?.sourceRecipeVersionId
        ? await getRecipeVersionById(activeProfile.sourceRecipeVersionId, db)
        : null;
      if (
        activeProfile?.sourceKind === "recipe_version" &&
        activeVersion?.businessId === businessId &&
        activeVersion.outputCatalogItemId === line.catalogItemId
      ) {
        const usageFactor = unitFactorForVersionLine(
          line,
          activeProfile.referenceUnit,
        );
        const conversion = await createConversionSnapshotInTransaction(
          {
            businessId,
            catalogItemId: line.catalogItemId,
            quantity: line.quantity,
            fromUnit: line.unit,
            toUnit: activeProfile.referenceUnit,
            factor: usageFactor,
            existing: {
              normalizedQuantity: line.normalizedQuantity,
              normalizedUnit: line.normalizedUnit,
              conversionId: line.conversionId,
              conversionFactorSnapshot:
                line.conversionFactorSnapshot,
            },
          },
          db,
        );
        sourceKind = "child_recipe_version";
        catalogItemId = null;
        childRecipeVersionId = activeVersion.id;
        costSource = "recipe_version";
        costProfileId = activeProfile.id;
        costState = "known";
        costOverride =
          (activeProfile.totalCost / activeProfile.referenceQuantity) *
          usageFactor;
        normalizedQuantity = conversion.normalizedQuantity;
        normalizedUnit = conversion.normalizedUnit;
        conversionId = conversion.conversionId;
        conversionFactorSnapshot =
          conversion.conversionFactorSnapshot;
      }
    }
    await db.runAsync(
      `
        INSERT INTO recipe_draft_lines (
          id, business_id, recipe_draft_id, sort_order, source_kind,
          catalog_item_id, child_recipe_version_id, child_draft_id,
          custom_name, quantity, unit, normalized_quantity, normalized_unit,
          conversion_id, conversion_factor_snapshot, conversion_chain_json,
          unit_standard_snapshot, role, is_optional, cost_override,
          cost_state, allocation_mode,
          legacy_ingredient_lot_id, notes, created_at, updated_at, sync_status,
          deleted_at, cost_source, cost_profile_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, 'local', NULL, ?, ?)
      `,
      [
        line.id,
        businessId,
        draftId,
        sortOrder,
        sourceKind,
        catalogItemId,
        childRecipeVersionId,
        line.customName ?? line.sourceLabelSnapshot,
        line.quantity,
        line.unit,
        normalizedQuantity,
        normalizedUnit,
        conversionId,
        conversionFactorSnapshot,
        line.conversionChainJson,
        line.unitStandardSnapshot,
        line.role,
        line.isOptional ? 1 : 0,
        costOverride,
        costState,
        line.allocationMode,
        line.legacyIngredientLotId,
        line.notes,
        createdAt,
        createdAt,
        costSource,
        costProfileId,
      ],
    );
  }
}

export type DuplicateRecipeFirstItemInput = {
  businessId: string;
  sourceVersionId: string;
  name?: string | null;
  branchId?: string | null;
  ids?: RecipeFirstIdentityIds;
};

export async function duplicateRecipeFirstItem(
  input: DuplicateRecipeFirstItemInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const source = await getRecipeVersionById(input.sourceVersionId, db);
  if (!source || source.businessId !== input.businessId) {
    throw new Error("Recipe version to duplicate is unavailable.");
  }
  const sourceOutput = await loadOutputRow(source.outputCatalogItemId, db);
  if (!sourceOutput) throw new Error("Recipe output to duplicate is unavailable.");
  const mode: RecipeFirstMode =
    sourceOutput.classification === "finished_product"
      ? "finished_per_unit"
      : sourceOutput.classification === "prepared_base"
        ? "prepared_batch"
        : "unsure";
  const identityIds: Required<RecipeFirstIdentityIds> = {
    catalogItemId: input.ids?.catalogItemId ?? makeCatalogItemId(),
    productId: input.ids?.productId ?? makeProductId(),
    bindingId: input.ids?.bindingId ?? makeLegacyBindingId(),
    draftId: input.ids?.draftId ?? makeRecipeDraftId(),
  };
  await db.withExclusiveTransactionAsync(async (txn) => {
    const version = await getRecipeVersionById(input.sourceVersionId, txn);
    if (!version || version.businessId !== input.businessId) {
      throw new Error("Recipe version to duplicate changed.");
    }
    const lines = await listRecipeVersionLines(version.id, txn);
    await insertRecipeFirstIdentity(
      {
        businessId: input.businessId,
        branchId: input.branchId,
        name: input.name?.trim() || `${version.name} copy`,
        category: version.category,
        notes: version.notes,
        mode,
        ids: identityIds,
      },
      txn,
    );
    const updated = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET source_version_id = ?, expected_output_quantity = ?,
          expected_output_unit = ?, production_mode = ?,
          suggested_selling_price = ?, selling_price_state = ?,
          editor_step = 'inputs', updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND autosave_revision = 0
          AND lifecycle_status = 'editing' AND deleted_at IS NULL
      `,
      [
        version.id,
        version.expectedOutputQuantity,
        version.expectedOutputUnit,
        version.productionMode,
        version.suggestedSellingPriceSnapshot,
        version.sellingPriceState,
        timestamp(),
        identityIds.draftId,
        input.businessId,
      ],
    );
    if (updated.changes !== 1) {
      throw new Error("Duplicated Recipe draft changed before copy.");
    }
    await insertVersionLinesIntoDraft(
      input.businessId,
      identityIds.draftId,
      lines,
      txn,
    );
  });
  const snapshot = await loadRecipeFirstDraft(identityIds.draftId, db);
  if (!snapshot) throw new Error("Duplicated Recipe draft is unavailable.");
  return snapshot;
}

export type StartRecipeFirstEditInput = {
  businessId: string;
  sourceVersionId: string;
  draftId?: string;
};

export async function startRecipeFirstEdit(
  input: StartRecipeFirstEditInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const draftId = input.draftId ?? makeRecipeDraftId();
  await db.withExclusiveTransactionAsync(async (txn) => {
    const version = await getRecipeVersionById(input.sourceVersionId, txn);
    if (!version || version.businessId !== input.businessId) {
      throw new Error("Recipe version to edit is unavailable.");
    }
    const output = await txn.getFirstAsync<{
      branch_id: string | null;
      classification: string;
    }>(
      `
        SELECT branch_id, classification
        FROM catalog_items
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
          AND lifecycle_status <> 'archived'
      `,
      [version.outputCatalogItemId, input.businessId],
    );
    if (!output) throw new Error("Recipe output to edit is unavailable.");
    const createdAt = timestamp();
    await txn.runAsync(
      `
        INSERT INTO recipe_drafts (
          id, business_id, branch_id, recipe_id, source_version_id,
          output_catalog_item_id, name, category, notes,
          expected_output_quantity, expected_output_unit, production_mode,
          suggested_selling_price, classification_proposal,
          selling_price_state, sellable, kiosk_enabled, editor_step,
          lifecycle_status, autosave_revision, last_saved_at,
          unresolved_requirement_count, parent_draft_id, parent_line_id,
          return_route, published_version_id, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0,
          'inputs', 'editing', 0, ?, 0, NULL, NULL, NULL, NULL, ?, ?, 'local',
          NULL)
      `,
      [
        draftId,
        input.businessId,
        output.branch_id,
        version.recipeId,
        version.id,
        version.outputCatalogItemId,
        version.name,
        version.category,
        version.notes,
        version.expectedOutputQuantity,
        version.expectedOutputUnit,
        version.productionMode,
        version.suggestedSellingPriceSnapshot,
        output.classification === "prepared_base" ||
        output.classification === "finished_product"
          ? output.classification
          : null,
        version.sellingPriceState,
        createdAt,
        createdAt,
        createdAt,
      ],
    );
    await insertVersionLinesIntoDraft(
      input.businessId,
      draftId,
      await listRecipeVersionLines(version.id, txn),
      txn,
      { refreshPreparedEstimateCosts: true },
    );
  });
  const snapshot = await loadRecipeFirstDraft(draftId, db);
  if (!snapshot) throw new Error("Recipe edit draft is unavailable.");
  return snapshot;
}

export type ArchiveRecipeFirstItemInput = {
  businessId: string;
  catalogItemId: string;
  ownerAuthorized: boolean;
};

export async function archiveRecipeFirstItem(
  input: ArchiveRecipeFirstItemInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  if (!input.ownerAuthorized) {
    throw new Error("Owner authorization is required to archive an item.");
  }
  const item = await db.getFirstAsync<{ business_id: string }>(
    `
      SELECT business_id
      FROM catalog_items
      WHERE id = ? AND deleted_at IS NULL
    `,
    [input.catalogItemId],
  );
  if (item?.business_id !== input.businessId) {
    throw new Error("Recipe-first item is unavailable.");
  }
  await archiveCatalogItem(input.catalogItemId, input.ownerAuthorized, db);
  const output = await loadOutputRow(input.catalogItemId, db);
  if (!output || output.lifecycle_status !== "archived") {
    throw new Error("Archived Recipe-first item is unavailable.");
  }
  return output;
}

export type DeleteRecipeFirstItemInput = {
  businessId: string;
  catalogItemId: string;
  ownerAuthorized: boolean;
};

async function deleteRecipeFirstItemInTransaction(
  input: DeleteRecipeFirstItemInput,
  txn: RepositoryDatabase,
  options: { retainWhenProtected?: boolean } = {},
) {
  if (!input.ownerAuthorized) {
    throw new Error("Owner authorization is required to delete an item.");
  }
    const item = await txn.getFirstAsync<{
      business_id: string;
      source_type: string;
      lifecycle_status: string;
    }>(
      `
        SELECT business_id, source_type, lifecycle_status
        FROM catalog_items
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.catalogItemId],
    );
    if (
      item?.business_id !== input.businessId ||
      item.source_type !== "native" ||
      item.lifecycle_status !== "draft"
    ) {
      throw new Error(
        "Only an unused native draft item can be permanently deleted.",
      );
    }
    const counts = await getCatalogItemReferenceCounts(
      input.catalogItemId,
      txn,
    );
    const ownDrafts = await txn.getFirstAsync<{ count: number }>(
      `
        SELECT COUNT(*) AS count
        FROM recipe_drafts
        WHERE output_catalog_item_id = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND published_version_id IS NULL
          AND deleted_at IS NULL
      `,
      [input.catalogItemId],
    );
    const ownedProfiles = await txn.getAllAsync<{
      id: string;
      source_kind: "owner_estimate" | "recipe_version";
      source_recipe_version_id: string | null;
      supersedes_profile_id: string | null;
    }>(
      `
        SELECT id, source_kind, source_recipe_version_id,
          supersedes_profile_id
        FROM catalog_cost_profiles
        WHERE catalog_item_id = ?
      `,
      [input.catalogItemId],
    );
    const ownedConversions = await txn.getAllAsync<{ id: string }>(
      `
        SELECT id
        FROM item_unit_conversions
        WHERE catalog_item_id = ? AND deleted_at IS NULL
      `,
      [input.catalogItemId],
    );
    const conversionReferences = await txn.getFirstAsync<{ count: number }>(
      `
        SELECT (
          SELECT COUNT(*)
          FROM recipe_draft_lines
          WHERE conversion_id IN (
            SELECT id FROM item_unit_conversions
            WHERE catalog_item_id = ? AND deleted_at IS NULL
          ) AND deleted_at IS NULL
        ) + (
          SELECT COUNT(*)
          FROM recipe_version_lines
          WHERE conversion_id IN (
            SELECT id FROM item_unit_conversions
            WHERE catalog_item_id = ? AND deleted_at IS NULL
          ) AND deleted_at IS NULL
        ) AS count
      `,
      [input.catalogItemId, input.catalogItemId],
    );
    const profileReferences = await txn.getFirstAsync<{ count: number }>(
      `
        SELECT (
          SELECT COUNT(*)
          FROM recipe_draft_lines
          WHERE cost_profile_id IN (
            SELECT id FROM catalog_cost_profiles
            WHERE catalog_item_id = ?
          )
        ) + (
          SELECT COUNT(*)
          FROM recipe_version_lines
          WHERE cost_profile_id IN (
            SELECT id FROM catalog_cost_profiles
            WHERE catalog_item_id = ?
          )
        ) + (
          SELECT COUNT(*)
          FROM catalog_cost_profiles
          WHERE supersedes_profile_id IN (
            SELECT id FROM catalog_cost_profiles
            WHERE catalog_item_id = ?
          )
            AND catalog_item_id <> ?
        ) AS count
      `,
      [
        input.catalogItemId,
        input.catalogItemId,
        input.catalogItemId,
        input.catalogItemId,
      ],
    );
    const nestedReferences = await txn.getFirstAsync<{ count: number }>(
      `
        SELECT (
          SELECT COUNT(*)
          FROM recipe_drafts child
          WHERE child.parent_draft_id IN (
            SELECT id FROM recipe_drafts
            WHERE output_catalog_item_id = ? AND deleted_at IS NULL
          ) AND child.deleted_at IS NULL
        ) + (
          SELECT COUNT(*)
          FROM recipe_draft_lines line
          WHERE line.child_draft_id IN (
            SELECT id FROM recipe_drafts
            WHERE output_catalog_item_id = ? AND deleted_at IS NULL
          ) AND line.deleted_at IS NULL
        ) AS count
      `,
      [input.catalogItemId, input.catalogItemId],
    );
    const protectedCount = [
      "purchase",
      "lot",
      "movement",
      "recipe_reference",
      "production",
      "sale",
      "bundle_reference",
      "supply_rule_reference",
      "order_supply_usage",
      "adjustment",
    ].reduce(
      (total, key) =>
        total +
        requiredReferenceCount(
          counts[key as keyof typeof counts],
          key,
        ),
      0,
    );
    const recipeVersionReferences = requiredReferenceCount(
      counts.recipe_version_reference,
      "recipe version",
    );
    const historicalDependencies = requiredReferenceCount(
      counts.historical_report_dependency,
      "historical report",
    );
    if (
      !ownDrafts ||
      ownDrafts.count < 1 ||
      recipeVersionReferences !== ownDrafts.count ||
      protectedCount !== 0 ||
      historicalDependencies !==
        ownDrafts.count + ownedProfiles.length + ownedConversions.length ||
      profileReferences?.count !== 0 ||
      conversionReferences?.count !== 0 ||
      ownedProfiles.some(
        (profile) =>
          profile.source_kind !== "owner_estimate" ||
          profile.source_recipe_version_id !== null,
      ) ||
      nestedReferences?.count !== 0
    ) {
      if (options.retainWhenProtected) {
        return { deleted: false as const, catalogItemId: input.catalogItemId };
      }
      throw new Error(
        "Recipe-first item has protected evidence and must be archived.",
      );
    }
    const projection = await txn.getFirstAsync<{
      product_id: string | null;
      active: number | null;
    }>(
      `
        SELECT binding.legacy_entity_id AS product_id, product.active
        FROM catalog_items item
        LEFT JOIN legacy_item_bindings binding
          ON binding.catalog_item_id = item.id
          AND binding.entity_kind = 'product'
          AND binding.deleted_at IS NULL
        LEFT JOIN products product
          ON product.id = binding.legacy_entity_id
          AND product.deleted_at IS NULL
        WHERE item.id = ? AND item.deleted_at IS NULL
      `,
      [input.catalogItemId],
    );
    if (projection?.active === 1) {
      if (options.retainWhenProtected) {
        return { deleted: false as const, catalogItemId: input.catalogItemId };
      }
      throw new Error("Active Product projections must be archived.");
    }
    await txn.runAsync(
      `
        DELETE FROM recipe_draft_lines
        WHERE recipe_draft_id IN (
          SELECT id FROM recipe_drafts
          WHERE output_catalog_item_id = ?
        )
      `,
      [input.catalogItemId],
    );
    await txn.runAsync(
      "DELETE FROM recipe_drafts WHERE output_catalog_item_id = ?",
      [input.catalogItemId],
    );
    const remainingProfiles = new Map(
      ownedProfiles.map((profile) => [profile.id, profile]),
    );
    while (remainingProfiles.size > 0) {
      const leaves = [...remainingProfiles.values()].filter(
        (candidate) =>
          ![...remainingProfiles.values()].some(
            (profile) =>
              profile.supersedes_profile_id === candidate.id,
          ),
      );
      if (leaves.length === 0) {
        throw new Error(
          "Owner-estimate profile history is cyclic and must be retained.",
        );
      }
      for (const profile of leaves) {
        const removedProfile = await txn.runAsync(
          `
            DELETE FROM catalog_cost_profiles
            WHERE id = ? AND catalog_item_id = ?
              AND source_kind = 'owner_estimate'
              AND source_recipe_version_id IS NULL
          `,
          [profile.id, input.catalogItemId],
        );
        if (removedProfile.changes !== 1) {
          throw new Error(
            "Owner-estimate profile changed before draft deletion.",
          );
        }
        remainingProfiles.delete(profile.id);
      }
    }
    for (const conversion of ownedConversions) {
      const removedConversion = await txn.runAsync(
        `
          DELETE FROM item_unit_conversions
          WHERE id = ? AND catalog_item_id = ? AND deleted_at IS NULL
        `,
        [conversion.id, input.catalogItemId],
      );
      if (removedConversion.changes !== 1) {
        throw new Error(
          "Owner-estimate conversion changed before draft deletion.",
        );
      }
    }
    await txn.runAsync(
      "DELETE FROM legacy_item_bindings WHERE catalog_item_id = ?",
      [input.catalogItemId],
    );
    if (projection?.product_id) {
      await txn.runAsync(
        "DELETE FROM products WHERE id = ? AND active = 0",
        [projection.product_id],
      );
    }
    const removed = await txn.runAsync(
      `
        DELETE FROM catalog_items
        WHERE id = ? AND business_id = ? AND source_type = 'native'
          AND lifecycle_status = 'draft'
      `,
      [input.catalogItemId, input.businessId],
    );
    if (removed.changes !== 1) {
      throw new Error("Recipe-first item changed before permanent deletion.");
    }
  return { deleted: true as const, catalogItemId: input.catalogItemId };
}

export async function deleteRecipeFirstItem(
  input: DeleteRecipeFirstItemInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  let result:
    | { deleted: true; catalogItemId: string }
    | { deleted: false; catalogItemId: string }
    | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    result = await deleteRecipeFirstItemInTransaction(input, txn);
  });
  if (!result) throw new Error("Recipe-first item deletion did not complete.");
  return result;
}
