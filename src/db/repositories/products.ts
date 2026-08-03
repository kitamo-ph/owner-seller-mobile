import { z } from "zod";

import { makeProductId } from "@/domain/ids";
import type { Product, ProductType, SyncStatus, UnitType } from "@/domain/types";

import { getRepositoryDatabase, nowIso, toBoolean, toInteger, type RepositoryDatabase } from "./shared";

const createProductSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  branchId: z.string().nullable().optional(),
  name: z.string().min(1),
  category: z.string().default("General"),
  price: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  stockQty: z.number().default(0),
  unitType: z.string().default("piece"),
  lowStockThreshold: z.number().nonnegative().default(0),
  bundleQuantity: z.number().positive().nullable().optional(),
  bundlePrice: z.number().nonnegative().nullable().optional(),
  bundleLabel: z.string().nullable().optional(),
  active: z.boolean().default(true),
  productType: z.string().default("retail item"),
  /**
   * Bagong Paninda creates reviewed direct-resale catalog identity.
   * Pilot/transfer helpers keep the legacy unclassified compatibility path.
   */
  catalogMode: z.enum(["legacy_unclassified", "direct_resale"]).default("legacy_unclassified"),
});

// Separate schema without .default() values: zod v4 .partial() re-applies field
// defaults for missing keys, which would zero stock/price on partial updates.
const updateProductSchema = z.object({
  branchId: z.string().nullable().optional(),
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  price: z.number().nonnegative().optional(),
  cost: z.number().nonnegative().optional(),
  stockQty: z.number().optional(),
  unitType: z.string().optional(),
  lowStockThreshold: z.number().nonnegative().optional(),
  bundleQuantity: z.number().positive().nullable().optional(),
  bundlePrice: z.number().nonnegative().nullable().optional(),
  bundleLabel: z.string().nullable().optional(),
  active: z.boolean().optional(),
  productType: z.string().optional(),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
export type UpdateProductInput = z.input<typeof updateProductSchema>;

type ProductRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock_qty: number;
  unit_type: UnitType;
  low_stock_threshold: number;
  bundle_quantity: number | null;
  bundle_price: number | null;
  bundle_label: string | null;
  active: number;
  product_type: ProductType;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    name: row.name,
    category: row.category,
    price: row.price,
    cost: row.cost,
    stockQty: row.stock_qty,
    unitType: row.unit_type,
    lowStockThreshold: row.low_stock_threshold,
    bundleQuantity: row.bundle_quantity,
    bundlePrice: row.bundle_price,
    bundleLabel: row.bundle_label,
    active: toBoolean(row.active),
    productType: row.product_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

export async function createProduct(input: CreateProductInput, db?: RepositoryDatabase) {
  const parsed = createProductSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const product: Product = {
    id: parsed.id ?? makeProductId(),
    businessId: parsed.businessId,
    branchId: parsed.branchId ?? null,
    name: parsed.name,
    category: parsed.category,
    price: parsed.price,
    cost: parsed.cost,
    stockQty: parsed.stockQty,
    unitType: parsed.unitType as UnitType,
    lowStockThreshold: parsed.lowStockThreshold,
    bundleQuantity: parsed.bundleQuantity ?? null,
    bundlePrice: parsed.bundlePrice ?? null,
    bundleLabel: parsed.bundleLabel ?? null,
    active: parsed.active,
    productType: parsed.productType as ProductType,
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  const insert = async (txn: RepositoryDatabase) => {
    await txn.runAsync(
      `
        INSERT INTO products (
          id, business_id, branch_id, name, category, price, cost, stock_qty,
          unit_type, low_stock_threshold, bundle_quantity, bundle_price,
          bundle_label, active, product_type, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        product.id,
        product.businessId,
        product.branchId,
        product.name,
        product.category,
        product.price,
        product.cost,
        product.stockQty,
        product.unitType,
        product.lowStockThreshold,
        product.bundleQuantity,
        product.bundlePrice,
        product.bundleLabel,
        toInteger(product.active),
        product.productType,
        product.createdAt,
        product.updatedAt,
        product.syncStatus,
        product.deletedAt,
      ],
    );

    const catalogItemId = `legacy:product:${product.id}`;
    const directResale = parsed.catalogMode === "direct_resale";
    const sellable = directResale && product.active && product.price > 0 ? 1 : 0;
    await txn.runAsync(
      `
        INSERT INTO catalog_items (
          id, business_id, branch_id, name, normalized_name, source_type,
          classification, lifecycle_status, readiness_state,
          classification_review_required, sellable, kiosk_enabled,
          purchase_cost_state, selling_price_state, stock_policy, archived_at,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'product_scalar', NULL, ?, ?, 'local', NULL)
      `,
      [
        catalogItemId,
        product.businessId,
        product.branchId,
        product.name,
        product.name.toLocaleLowerCase().trim(),
        directResale ? "native" : "legacy_product",
        directResale ? "direct_resale_product" : "legacy_unclassified",
        directResale && product.active ? "active" : "draft",
        directResale
          ? product.price > 0
            ? "ready"
            : "incomplete"
          : "legacy_review",
        directResale ? 0 : 1,
        sellable,
        directResale
          ? product.cost > 0
            ? "known"
            : "unknown"
          : product.cost > 0
            ? "known"
            : "legacy_zero_unresolved",
        directResale
          ? product.price > 0
            ? "known"
            : "unknown"
          : product.price > 0
            ? "known"
            : "legacy_zero_unresolved",
        product.createdAt,
        product.updatedAt,
      ],
    );
    await txn.runAsync(
      `
        INSERT INTO legacy_item_bindings (
          id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
          projection_role, binding_status, compatibility_mode,
          review_required, legacy_active_snapshot,
          legacy_deleted_at_snapshot, migration_provenance, reviewed_at,
          native_activated_at, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, 'product', ?, ?, 'active', ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'local', NULL)
      `,
      [
        `binding:product:${product.id}`,
        product.businessId,
        catalogItemId,
        product.id,
        directResale ? "sale_product" : "legacy_product",
        directResale ? "reviewed_legacy" : "legacy_unclassified",
        directResale ? 0 : 1,
        toInteger(product.active),
        directResale ? "native" : "migration_011",
        directResale ? product.createdAt : null,
        directResale ? product.createdAt : null,
        product.createdAt,
        product.updatedAt,
      ],
    );
  };

  if (db) {
    await insert(database);
  } else {
    await database.withExclusiveTransactionAsync(insert);
  }

  return product;
}

export async function getProductById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<ProductRow>("SELECT * FROM products WHERE id = ? AND deleted_at IS NULL", [id]);
  return row ? mapProduct(row) : null;
}

export async function updateProduct(id: string, input: UpdateProductInput, db?: RepositoryDatabase) {
  const existing = await getProductById(id, db);
  if (!existing) {
    throw new Error("Product not found.");
  }

  const parsed = updateProductSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const changesStockAuthority =
    parsed.stockQty !== undefined ||
    parsed.unitType !== undefined ||
    parsed.cost !== undefined;
  if (changesStockAuthority) {
    const lotTracked = await database.getFirstAsync<{ id: string }>(
      `
        SELECT item.id
        FROM legacy_item_bindings binding
        INNER JOIN catalog_items item ON item.id = binding.catalog_item_id
        WHERE binding.entity_kind = 'product'
          AND binding.legacy_entity_id = ?
          AND binding.compatibility_mode IN ('reviewed_legacy', 'native')
          AND binding.review_required = 0
          AND binding.deleted_at IS NULL
          AND item.stock_policy = 'product_lots'
          AND item.deleted_at IS NULL
      `,
      [id],
    );
    if (lotTracked) {
      throw new Error(
        "Lot-tracked Product stock, unit, and cost must use an atomic lot-backed stock operation.",
      );
    }
  }
  const updatedAt = nowIso();
  const product: Product = {
    ...existing,
    branchId: parsed.branchId === undefined ? existing.branchId : parsed.branchId,
    name: parsed.name ?? existing.name,
    category: parsed.category ?? existing.category,
    price: parsed.price ?? existing.price,
    cost: parsed.cost ?? existing.cost,
    stockQty: parsed.stockQty ?? existing.stockQty,
    unitType: (parsed.unitType as UnitType | undefined) ?? existing.unitType,
    lowStockThreshold: parsed.lowStockThreshold ?? existing.lowStockThreshold,
    bundleQuantity: parsed.bundleQuantity === undefined ? existing.bundleQuantity : parsed.bundleQuantity,
    bundlePrice: parsed.bundlePrice === undefined ? existing.bundlePrice : parsed.bundlePrice,
    bundleLabel: parsed.bundleLabel === undefined ? existing.bundleLabel : parsed.bundleLabel,
    active: parsed.active ?? existing.active,
    productType: (parsed.productType as ProductType | undefined) ?? existing.productType,
    updatedAt,
    syncStatus: "local",
  };

  const applyUpdate = async (txn: RepositoryDatabase) => {
    const result = await txn.runAsync(
    `
      UPDATE products
      SET branch_id = ?, name = ?, category = ?, price = ?,
        cost = CASE WHEN ? = 1 THEN ? ELSE cost END,
        stock_qty = CASE WHEN ? = 1 THEN ? ELSE stock_qty END,
        unit_type = CASE WHEN ? = 1 THEN ? ELSE unit_type END,
        low_stock_threshold = ?, bundle_quantity = ?, bundle_price = ?,
        bundle_label = ?, active = ?, product_type = ?, updated_at = ?, sync_status = ?
      WHERE id = ? AND updated_at = ? AND deleted_at IS NULL
    `,
    [
      product.branchId,
      product.name,
      product.category,
      product.price,
      parsed.cost === undefined ? 0 : 1,
      product.cost,
      parsed.stockQty === undefined ? 0 : 1,
      product.stockQty,
      parsed.unitType === undefined ? 0 : 1,
      product.unitType,
      product.lowStockThreshold,
      product.bundleQuantity,
      product.bundlePrice,
      product.bundleLabel,
      toInteger(product.active),
      product.productType,
      product.updatedAt,
      product.syncStatus,
      product.id,
      existing.updatedAt,
    ],
  );
    if (result.changes !== 1) {
      throw new Error("Product changed before the metadata update.");
    }
    await txn.runAsync(
    `
      UPDATE catalog_items
      SET branch_id = ?, name = ?, normalized_name = ?,
        updated_at = ?, sync_status = 'local'
      WHERE id = (
        SELECT catalog_item_id
        FROM legacy_item_bindings
        WHERE entity_kind = 'product' AND legacy_entity_id = ?
          AND deleted_at IS NULL
      )
        AND deleted_at IS NULL
    `,
    [
      product.branchId,
      product.name,
      product.name.toLocaleLowerCase().trim(),
      product.updatedAt,
      product.id,
    ],
  );
    await txn.runAsync(
    `
      UPDATE legacy_item_bindings
      SET legacy_active_snapshot = ?, updated_at = ?, sync_status = 'local'
      WHERE entity_kind = 'product' AND legacy_entity_id = ?
        AND deleted_at IS NULL
    `,
    [toInteger(product.active), product.updatedAt, product.id],
    );
  };

  if (db) {
    await applyUpdate(database);
  } else {
    await database.withExclusiveTransactionAsync(applyUpdate);
  }

  return product;
}

export async function listProductsForBusiness(businessId: string, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<ProductRow>(
    "SELECT * FROM products WHERE business_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
    [businessId],
  );
  return rows.map(mapProduct);
}

export async function countProducts(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM products WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
