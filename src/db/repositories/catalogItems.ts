import type {
  CatalogClassification,
  CatalogCompatibilityMode,
  CatalogLifecycle,
  CatalogSourceType,
} from "@/domain/catalogItems";
import type { CostState } from "@/domain/costState";

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
 * Compatibility-aware Product reader for later Kiosk integration.
 *
 * This repository is intentionally not wired into the current Kiosk service
 * in Phase B. Unreviewed legacy Products retain the exact current
 * business/branch/shared predicate. Native and reviewed rows must satisfy the
 * explicit catalog readiness gate and, when producible, have an active exact
 * recipe role.
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
