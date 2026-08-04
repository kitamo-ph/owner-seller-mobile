/**
 * Atomic Paninda listing transitions.
 *
 * These are the only writers that may set an item into the Kiosk-eligible
 * combination (`lifecycle_status='active'`, `sellable=1`, `kiosk_enabled=1`,
 * `selling_price_state='known'`, `products.active=1`). Every transition is
 * fail-closed: eligibility is re-checked inside the transaction against the
 * persisted row, never against caller-supplied state, and a row-count guard
 * rejects concurrent modification.
 */
import {
  evaluateListingEligibility,
  evaluateUnlistEligibility,
  type ListingBlocker,
} from "@/domain/panindaListing";
import type {
  CatalogClassification,
  CatalogLifecycle,
} from "@/domain/catalogItems";
import type { CostState } from "@/domain/costState";

import {
  getRepositoryDatabase,
  nowIso,
  type RepositoryDatabase,
} from "./shared";

export type ListingOutcome =
  | { outcome: "listed"; productId: string; sellingPrice: number }
  | { outcome: "blocked"; blockers: ListingBlocker[]; requiresSellingPrice: boolean };

type ListingRow = {
  classification: CatalogClassification;
  lifecycle_status: CatalogLifecycle;
  selling_price_state: CostState;
  binding_status: "active" | "archived" | null;
  binding_review_required: number | null;
  product_id: string | null;
  product_price: number | null;
  has_published_recipe: number;
  has_any_recipe: number;
};

async function loadListingRow(
  catalogItemId: string,
  db: RepositoryDatabase,
): Promise<ListingRow> {
  const row = await db.getFirstAsync<ListingRow>(
    `
      SELECT item.classification, item.lifecycle_status, item.selling_price_state,
        binding.binding_status, binding.review_required AS binding_review_required,
        product.id AS product_id, product.price AS product_price,
        EXISTS (
          SELECT 1 FROM catalog_item_recipe_roles role
          INNER JOIN recipes recipe
            ON recipe.id = role.recipe_id
            AND recipe.active_version_id IS NOT NULL
            AND recipe.is_active = 1
            AND recipe.deleted_at IS NULL
          WHERE role.output_catalog_item_id = item.id
            AND role.status = 'active'
            AND role.deleted_at IS NULL
        ) AS has_published_recipe,
        EXISTS (
          SELECT 1 FROM catalog_item_recipe_roles role
          WHERE role.output_catalog_item_id = item.id
            AND role.deleted_at IS NULL
        ) AS has_any_recipe
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
  if (!row) throw new Error("Catalog item is unavailable.");
  return row;
}

export async function listCatalogItemForSaleInTransaction(
  input: {
    catalogItemId: string;
    ownerAuthorized: boolean;
    sellingPrice: number | null;
  },
  db: RepositoryDatabase,
): Promise<ListingOutcome> {
  const row = await loadListingRow(input.catalogItemId, db);

  const eligibility = evaluateListingEligibility({
    ownerAuthorized: input.ownerAuthorized,
    classification: row.classification,
    lifecycle: row.lifecycle_status,
    bindingStatus: row.binding_status ?? "archived",
    bindingReviewRequired: row.binding_review_required === 1,
    hasProductProjection: row.product_id !== null,
    hasPublishedRecipe: row.has_published_recipe === 1,
    recipeBacked: row.has_any_recipe === 1,
    sellingPriceState: row.selling_price_state,
    submittedSellingPrice: input.sellingPrice,
    existingSellingPrice: row.product_price,
  });

  if (!eligibility.allowed || eligibility.resolvedSellingPrice === null) {
    return {
      outcome: "blocked",
      blockers: eligibility.blockers,
      requiresSellingPrice: eligibility.requiresSellingPrice,
    };
  }

  const timestamp = nowIso();
  const itemResult = await db.runAsync(
    `
      UPDATE catalog_items
      SET lifecycle_status = 'active', readiness_state = 'ready',
        sellable = 1, kiosk_enabled = 1, selling_price_state = 'known',
        archived_at = NULL, updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL AND lifecycle_status <> 'archived'
    `,
    [timestamp, input.catalogItemId],
  );
  if (itemResult.changes !== 1) {
    throw new Error("Catalog item changed before it could be listed.");
  }

  const productResult = await db.runAsync(
    `
      UPDATE products
      SET active = 1, price = ?, updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL
    `,
    [eligibility.resolvedSellingPrice, timestamp, row.product_id],
  );
  if (productResult.changes !== 1) {
    throw new Error("Paninda record changed before it could be listed.");
  }

  return {
    outcome: "listed",
    productId: row.product_id as string,
    sellingPrice: eligibility.resolvedSellingPrice,
  };
}

export async function listCatalogItemForSale(
  input: {
    catalogItemId: string;
    ownerAuthorized: boolean;
    sellingPrice: number | null;
  },
  db?: RepositoryDatabase,
): Promise<ListingOutcome> {
  const database = getRepositoryDatabase(db);
  let result: ListingOutcome = {
    outcome: "blocked",
    blockers: ["owner_authorization_required"],
    requiresSellingPrice: false,
  };
  await database.withExclusiveTransactionAsync(async (txn) => {
    result = await listCatalogItemForSaleInTransaction(input, txn);
  });
  return result;
}

export async function unlistCatalogItemFromSaleInTransaction(
  input: { catalogItemId: string; ownerAuthorized: boolean },
  db: RepositoryDatabase,
): Promise<{ outcome: "unlisted" | "already_unlisted" | "blocked"; blockers: ListingBlocker[] }> {
  const row = await loadListingRow(input.catalogItemId, db);
  const eligibility = evaluateUnlistEligibility({
    ownerAuthorized: input.ownerAuthorized,
    lifecycle: row.lifecycle_status,
  });
  if (!eligibility.allowed) {
    return { outcome: "blocked", blockers: eligibility.blockers };
  }
  if (eligibility.alreadyUnlisted) {
    return { outcome: "already_unlisted", blockers: [] };
  }

  const timestamp = nowIso();
  const itemResult = await db.runAsync(
    `
      UPDATE catalog_items
      SET lifecycle_status = 'ready', sellable = 0, kiosk_enabled = 0,
        updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL AND lifecycle_status = 'active'
    `,
    [timestamp, input.catalogItemId],
  );
  if (itemResult.changes !== 1) {
    throw new Error("Catalog item changed before it could be unlisted.");
  }

  if (row.product_id) {
    await db.runAsync(
      `
        UPDATE products
        SET active = 0, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND deleted_at IS NULL
      `,
      [timestamp, row.product_id],
    );
  }

  return { outcome: "unlisted", blockers: [] };
}

export async function unlistCatalogItemFromSale(
  input: { catalogItemId: string; ownerAuthorized: boolean },
  db?: RepositoryDatabase,
): Promise<{
  outcome: "unlisted" | "already_unlisted" | "blocked";
  blockers: ListingBlocker[];
}> {
  const database = getRepositoryDatabase(db);
  let result: {
    outcome: "unlisted" | "already_unlisted" | "blocked";
    blockers: ListingBlocker[];
  } = { outcome: "blocked", blockers: ["owner_authorization_required"] };
  await database.withExclusiveTransactionAsync(async (txn) => {
    result = await unlistCatalogItemFromSaleInTransaction(input, txn);
  });
  return result;
}

/**
 * Restores an archived item to `ready`.
 *
 * Archiving previously had no inverse, so it was itself a one-way trap. A
 * restored item is deliberately NOT put back on sale: it returns to `ready`
 * and the owner must list it explicitly, which keeps listing a single
 * auditable decision.
 */
export async function restoreArchivedCatalogItemInTransaction(
  input: { catalogItemId: string; ownerAuthorized: boolean },
  db: RepositoryDatabase,
): Promise<{ outcome: "restored" | "not_archived" | "blocked" }> {
  if (!input.ownerAuthorized) return { outcome: "blocked" };
  const row = await loadListingRow(input.catalogItemId, db);
  if (row.lifecycle_status !== "archived") return { outcome: "not_archived" };

  const timestamp = nowIso();
  const result = await db.runAsync(
    `
      UPDATE catalog_items
      SET lifecycle_status = 'ready', readiness_state = 'incomplete',
        archived_at = NULL, updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL AND lifecycle_status = 'archived'
    `,
    [timestamp, input.catalogItemId],
  );
  if (result.changes !== 1) {
    throw new Error("Catalog item changed before it could be restored.");
  }
  return { outcome: "restored" };
}

export async function restoreArchivedCatalogItem(
  input: { catalogItemId: string; ownerAuthorized: boolean },
  db?: RepositoryDatabase,
): Promise<{ outcome: "restored" | "not_archived" | "blocked" }> {
  const database = getRepositoryDatabase(db);
  let result: { outcome: "restored" | "not_archived" | "blocked" } = {
    outcome: "blocked",
  };
  await database.withExclusiveTransactionAsync(async (txn) => {
    result = await restoreArchivedCatalogItemInTransaction(input, txn);
  });
  return result;
}
