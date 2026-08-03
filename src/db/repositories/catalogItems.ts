import type {
  CatalogClassification,
  CatalogCompatibilityMode,
  CatalogLifecycle,
  CatalogSourceType,
} from "@/domain/catalogItems";
import type { CostState } from "@/domain/costState";
import type { Product } from "@/domain/types";

import {
  getRepositoryDatabase,
  toBoolean,
  type RepositoryDatabase,
} from "./shared";

export type CatalogStockPolicy =
  | "untracked"
  | "ingredient_lots"
  | "product_scalar"
  | "product_lots";

export type CatalogItemRecord = {
  id: string;
  businessId: string;
  branchId: string | null;
  name: string;
  normalizedName: string;
  classification: CatalogClassification;
  lifecycle: CatalogLifecycle;
  sourceType: CatalogSourceType;
  readinessState: "incomplete" | "ready" | "blocked" | "legacy_review";
  classificationReviewRequired: boolean;
  sellable: boolean;
  kioskEnabled: boolean;
  purchaseCostState: CostState;
  sellingPriceState: CostState;
  stockPolicy: CatalogStockPolicy;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  syncStatus: "local" | "pending" | "synced" | "failed";
  deletedAt: string | null;
};

export type LegacyProjectionRole =
  | "legacy_product"
  | "legacy_ingredient"
  | "sale_product"
  | "recipe_output"
  | "stock_ingredient"
  | "supply_ingredient";

export type LegacyItemBindingRecord = {
  id: string;
  businessId: string;
  catalogItemId: string;
  entityKind: "product" | "ingredient";
  legacyEntityId: string;
  projectionRole: LegacyProjectionRole;
  compatibilityMode: CatalogCompatibilityMode;
  bindingStatus: "active" | "archived";
  migrationProvenance: "migration_011" | "native";
  reviewRequired: boolean;
  legacyActiveSnapshot: boolean | null;
  legacyDeletedAtSnapshot: string | null;
  reviewedAt: string | null;
  nativeActivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type CatalogItemRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  normalized_name: string;
  classification: CatalogClassification;
  lifecycle_status: CatalogLifecycle;
  source_type: CatalogSourceType;
  readiness_state: CatalogItemRecord["readinessState"];
  classification_review_required: number;
  sellable: number;
  kiosk_enabled: number;
  purchase_cost_state: CostState;
  selling_price_state: CostState;
  stock_policy: CatalogStockPolicy;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: CatalogItemRecord["syncStatus"];
  deleted_at: string | null;
};

type LegacyItemBindingRow = {
  id: string;
  business_id: string;
  catalog_item_id: string;
  entity_kind: LegacyItemBindingRecord["entityKind"];
  legacy_entity_id: string;
  projection_role: LegacyProjectionRole;
  compatibility_mode: CatalogCompatibilityMode;
  binding_status: LegacyItemBindingRecord["bindingStatus"];
  migration_provenance: LegacyItemBindingRecord["migrationProvenance"];
  review_required: number;
  legacy_active_snapshot: number | null;
  legacy_deleted_at_snapshot: string | null;
  reviewed_at: string | null;
  native_activated_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type KioskCatalogProduct = CatalogItemRecord & {
  productId: string;
  compatibilityMode: CatalogCompatibilityMode;
};

type KioskCatalogProductRow = CatalogItemRow & {
  product_id: string;
  compatibility_mode: CatalogCompatibilityMode;
};

export type PanindaCatalogProductRecord = {
  item: CatalogItemRecord;
  product: Product;
  compatibilityMode: CatalogCompatibilityMode;
  bindingStatus: "active" | "archived";
  projectionRole: LegacyProjectionRole;
  bindingReviewRequired: boolean;
  draftId: string | null;
  activeRecipeId: string | null;
  activeVersionId: string | null;
};

type PanindaCatalogProductRow = CatalogItemRow & {
  compatibility_mode: CatalogCompatibilityMode;
  binding_status: "active" | "archived";
  projection_role: LegacyProjectionRole;
  binding_review_required: number;
  product_id: string;
  product_business_id: string;
  product_branch_id: string | null;
  product_name: string;
  product_category: string;
  product_price: number;
  product_cost: number;
  product_stock_qty: number;
  product_unit_type: Product["unitType"];
  product_low_stock_threshold: number;
  product_bundle_quantity: number | null;
  product_bundle_price: number | null;
  product_bundle_label: string | null;
  product_active: number;
  product_type: Product["productType"];
  product_created_at: string;
  product_updated_at: string;
  product_sync_status: Product["syncStatus"];
  product_deleted_at: string | null;
  draft_id: string | null;
  active_recipe_id: string | null;
  active_version_id: string | null;
};

function mapCatalogItem(row: CatalogItemRow): CatalogItemRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    name: row.name,
    normalizedName: row.normalized_name,
    classification: row.classification,
    lifecycle: row.lifecycle_status,
    sourceType: row.source_type,
    readinessState: row.readiness_state,
    classificationReviewRequired: toBoolean(row.classification_review_required),
    sellable: toBoolean(row.sellable),
    kioskEnabled: toBoolean(row.kiosk_enabled),
    purchaseCostState: row.purchase_cost_state,
    sellingPriceState: row.selling_price_state,
    stockPolicy: row.stock_policy,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

function mapBinding(row: LegacyItemBindingRow): LegacyItemBindingRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    catalogItemId: row.catalog_item_id,
    entityKind: row.entity_kind,
    legacyEntityId: row.legacy_entity_id,
    projectionRole: row.projection_role,
    compatibilityMode: row.compatibility_mode,
    bindingStatus: row.binding_status,
    migrationProvenance: row.migration_provenance,
    reviewRequired: toBoolean(row.review_required),
    legacyActiveSnapshot:
      row.legacy_active_snapshot === null
        ? null
        : toBoolean(row.legacy_active_snapshot),
    legacyDeletedAtSnapshot: row.legacy_deleted_at_snapshot,
    reviewedAt: row.reviewed_at,
    nativeActivatedAt: row.native_activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function getCatalogItemById(
  id: string,
  db?: RepositoryDatabase,
) {
  const row = await getRepositoryDatabase(db).getFirstAsync<CatalogItemRow>(
    "SELECT * FROM catalog_items WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return row ? mapCatalogItem(row) : null;
}

export async function listCatalogItemsForBusiness(
  businessId: string,
  db?: RepositoryDatabase,
) {
  const rows = await getRepositoryDatabase(db).getAllAsync<CatalogItemRow>(
    `
      SELECT *
      FROM catalog_items
      WHERE business_id = ? AND deleted_at IS NULL
      ORDER BY normalized_name ASC, id ASC
    `,
    [businessId],
  );
  return rows.map(mapCatalogItem);
}

export async function getLegacyItemBinding(
  entityKind: LegacyItemBindingRecord["entityKind"],
  legacyEntityId: string,
  db?: RepositoryDatabase,
) {
  const row =
    await getRepositoryDatabase(db).getFirstAsync<LegacyItemBindingRow>(
      `
        SELECT *
        FROM legacy_item_bindings
        WHERE entity_kind = ? AND legacy_entity_id = ? AND deleted_at IS NULL
      `,
      [entityKind, legacyEntityId],
    );
  return row ? mapBinding(row) : null;
}

export async function listLegacyBindingsForCatalogItem(
  catalogItemId: string,
  db?: RepositoryDatabase,
) {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<LegacyItemBindingRow>(
      `
        SELECT *
        FROM legacy_item_bindings
        WHERE catalog_item_id = ? AND deleted_at IS NULL
        ORDER BY entity_kind ASC, legacy_entity_id ASC
      `,
      [catalogItemId],
    );
  return rows.map(mapBinding);
}

export async function listCatalogItemsMissingPrices(
  businessId: string,
  db?: RepositoryDatabase,
) {
  const rows = await getRepositoryDatabase(db).getAllAsync<CatalogItemRow>(
    `
      SELECT *
      FROM catalog_items
      WHERE business_id = ?
        AND deleted_at IS NULL
        AND lifecycle_status <> 'archived'
        AND (
          purchase_cost_state IN ('unknown', 'legacy_zero_unresolved')
          OR (
            sellable = 1
            AND selling_price_state IN ('unknown', 'legacy_zero_unresolved')
          )
        )
      ORDER BY normalized_name ASC, id ASC
    `,
    [businessId],
  );
  return rows.map(mapCatalogItem);
}

/**
 * Catalog-aware Paninda reader. The legacy Product reader deliberately remains
 * unchanged because reports, transfer compatibility, and Kiosk migration paths
 * still consume it.
 */
export async function listPanindaCatalogProductsForBusiness(
  businessId: string,
  db?: RepositoryDatabase,
): Promise<PanindaCatalogProductRecord[]> {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<PanindaCatalogProductRow>(
      `
        SELECT item.*,
          binding.compatibility_mode,
          binding.binding_status,
          binding.projection_role,
          binding.review_required AS binding_review_required,
          product.id AS product_id,
          product.business_id AS product_business_id,
          product.branch_id AS product_branch_id,
          product.name AS product_name,
          product.category AS product_category,
          product.price AS product_price,
          product.cost AS product_cost,
          product.stock_qty AS product_stock_qty,
          product.unit_type AS product_unit_type,
          product.low_stock_threshold AS product_low_stock_threshold,
          product.bundle_quantity AS product_bundle_quantity,
          product.bundle_price AS product_bundle_price,
          product.bundle_label AS product_bundle_label,
          product.active AS product_active,
          product.product_type,
          product.created_at AS product_created_at,
          product.updated_at AS product_updated_at,
          product.sync_status AS product_sync_status,
          product.deleted_at AS product_deleted_at,
          (
            SELECT draft.id
            FROM recipe_drafts draft
            WHERE draft.output_catalog_item_id = item.id
              AND draft.lifecycle_status IN ('editing', 'ready')
              AND draft.deleted_at IS NULL
            ORDER BY draft.updated_at DESC, draft.id DESC
            LIMIT 1
          ) AS draft_id,
          COALESCE(
            (
              SELECT recipe.id
              FROM catalog_item_recipe_roles role
              INNER JOIN recipes recipe
                ON recipe.id = role.recipe_id
                AND recipe.is_active = 1
                AND recipe.deleted_at IS NULL
              WHERE role.output_catalog_item_id = item.id
                AND role.status = 'active'
                AND role.deleted_at IS NULL
              ORDER BY CASE role.role
                WHEN 'primary' THEN 0
                WHEN 'kiosk_cook_upon_order' THEN 1
                ELSE 2
              END, role.effective_at DESC, role.id DESC
              LIMIT 1
            ),
            (
              SELECT recipe.id
              FROM recipes recipe
              WHERE recipe.output_product_id = product.id
                AND recipe.is_active = 1
                AND recipe.deleted_at IS NULL
              ORDER BY recipe.updated_at DESC, recipe.id DESC
              LIMIT 1
            )
          ) AS active_recipe_id,
          COALESCE(
            (
              SELECT recipe.active_version_id
              FROM catalog_item_recipe_roles role
              INNER JOIN recipes recipe
                ON recipe.id = role.recipe_id
                AND recipe.is_active = 1
                AND recipe.deleted_at IS NULL
              INNER JOIN recipe_versions version
                ON version.id = recipe.active_version_id
                AND version.status = 'published'
                AND version.deleted_at IS NULL
              WHERE role.output_catalog_item_id = item.id
                AND role.status = 'active'
                AND role.deleted_at IS NULL
              ORDER BY CASE role.role
                WHEN 'primary' THEN 0
                WHEN 'kiosk_cook_upon_order' THEN 1
                ELSE 2
              END, role.effective_at DESC, role.id DESC
              LIMIT 1
            ),
            (
              SELECT recipe.active_version_id
              FROM recipes recipe
              INNER JOIN recipe_versions version
                ON version.id = recipe.active_version_id
                AND version.status = 'published'
                AND version.deleted_at IS NULL
              WHERE recipe.output_product_id = product.id
                AND recipe.is_active = 1
                AND recipe.deleted_at IS NULL
              ORDER BY recipe.updated_at DESC, recipe.id DESC
              LIMIT 1
            )
          ) AS active_version_id
        FROM catalog_items item
        INNER JOIN legacy_item_bindings binding
          ON binding.catalog_item_id = item.id
          AND binding.entity_kind = 'product'
          AND binding.deleted_at IS NULL
        INNER JOIN products product
          ON product.id = binding.legacy_entity_id
          AND product.business_id = item.business_id
          AND product.deleted_at IS NULL
        WHERE item.business_id = ?
          AND item.deleted_at IS NULL
        ORDER BY item.normalized_name ASC, item.id ASC
      `,
      [businessId],
    );

  return rows.map((row) => ({
    item: mapCatalogItem(row),
    compatibilityMode: row.compatibility_mode,
    bindingStatus: row.binding_status,
    projectionRole: row.projection_role,
    bindingReviewRequired: toBoolean(row.binding_review_required),
    draftId: row.draft_id,
    activeRecipeId: row.active_recipe_id,
    activeVersionId: row.active_version_id,
    product: {
      id: row.product_id,
      businessId: row.product_business_id,
      branchId: row.product_branch_id,
      name: row.product_name,
      category: row.product_category,
      price: row.product_price,
      cost: row.product_cost,
      stockQty: row.product_stock_qty,
      unitType: row.product_unit_type,
      lowStockThreshold: row.product_low_stock_threshold,
      bundleQuantity: row.product_bundle_quantity,
      bundlePrice: row.product_bundle_price,
      bundleLabel: row.product_bundle_label,
      active: toBoolean(row.product_active),
      productType: row.product_type,
      createdAt: row.product_created_at,
      updatedAt: row.product_updated_at,
      syncStatus: row.product_sync_status,
      deletedAt: row.product_deleted_at,
    },
  }));
}

/**
 * Compatibility-aware Product reader used by the Phase C1 Kiosk safety gate.
 *
 * Unreviewed legacy Products retain the exact prior business/branch/shared
 * predicate. Native and reviewed rows must satisfy explicit catalog readiness
 * and, when producible, have an active exact recipe role.
 */
export async function listKioskEligibleCatalogProducts(
  businessId: string,
  branchId: string,
  db?: RepositoryDatabase,
): Promise<KioskCatalogProduct[]> {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<KioskCatalogProductRow>(
      `
        SELECT
          ci.*,
          p.id AS product_id,
          b.compatibility_mode
        FROM catalog_items ci
        INNER JOIN legacy_item_bindings b
          ON b.catalog_item_id = ci.id
          AND b.entity_kind = 'product'
          AND b.deleted_at IS NULL
        INNER JOIN products p
          ON p.id = b.legacy_entity_id
          AND p.deleted_at IS NULL
        WHERE ci.business_id = ?
          AND ci.deleted_at IS NULL
          AND (p.branch_id = ? OR p.branch_id IS NULL)
          AND (
            (
              b.compatibility_mode = 'legacy_unclassified'
              AND ci.classification = 'legacy_unclassified'
              AND b.review_required = 1
            )
            OR
            (
              b.compatibility_mode IN ('reviewed_legacy', 'native')
              AND b.review_required = 0
              AND ci.lifecycle_status = 'active'
              AND ci.classification IN (
                'prepared_base',
                'finished_product',
                'direct_resale_product',
                'bundle_combo'
              )
              AND ci.sellable = 1
              AND ci.kiosk_enabled = 1
              AND ci.selling_price_state = 'known'
              AND p.active = 1
              AND (
                ci.classification IN ('direct_resale_product', 'bundle_combo')
                OR EXISTS (
                  SELECT 1
                  FROM catalog_item_recipe_roles role
                  INNER JOIN recipes r
                    ON r.id = role.recipe_id
                    AND r.active_version_id IS NOT NULL
                    AND r.is_active = 1
                    AND r.deleted_at IS NULL
                  WHERE role.output_catalog_item_id = ci.id
                    AND role.status = 'active'
                    AND role.deleted_at IS NULL
                    AND role.role IN ('primary', 'kiosk_cook_upon_order')
                )
              )
            )
          )
        ORDER BY p.created_at ASC
      `,
      [businessId, branchId],
    );

  return rows.map((row) => ({
    ...mapCatalogItem(row),
    productId: row.product_id,
    compatibilityMode: row.compatibility_mode,
  }));
}
