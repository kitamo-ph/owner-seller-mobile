import {
  evaluateArchiveEligibility,
  evaluatePermanentDeleteEligibility,
  type ItemReferenceCounts,
  type PermanentDeleteEligibility,
} from "@/domain/itemLifecycle";

import {
  getRepositoryDatabase,
  nowIso,
  type RepositoryDatabase,
} from "./shared";

async function count(
  db: RepositoryDatabase,
  statement: string,
  parameters: (string | number | null)[],
) {
  const row = await db.getFirstAsync<{ count: number }>(statement, parameters);
  if (
    !row ||
    !Number.isSafeInteger(row.count) ||
    row.count < 0
  ) {
    throw new Error("Reference count is unavailable.");
  }
  return row.count;
}

/**
 * Executes every protected reference query. Any missing table, SQL failure, or
 * invalid result is allowed to throw so the caller can deny deletion
 * fail-closed; no partial count object is presented as complete.
 */
export async function getCatalogItemReferenceCounts(
  catalogItemId: string,
  db?: RepositoryDatabase,
): Promise<ItemReferenceCounts> {
  const database = getRepositoryDatabase(db);
  const itemCount = await count(
    database,
    `
      SELECT COUNT(*) AS count
      FROM catalog_items
      WHERE id = ? AND deleted_at IS NULL
    `,
    [catalogItemId],
  );
  if (itemCount !== 1) {
    throw new Error("Catalog item is unavailable for reference checks.");
  }
  const parameter = [catalogItemId];
  const [
    purchase,
    lot,
    movement,
    recipeReference,
    recipeVersionReference,
    production,
    sale,
    supplyRuleReference,
    orderSupplyUsage,
    adjustment,
    configurationReference,
    transferReference,
    alertReference,
  ] = await Promise.all([
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT receipt.id
          FROM purchase_receipts receipt
          INNER JOIN ingredient_lots lot ON lot.purchase_receipt_id = receipt.id
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = lot.ingredient_id
          WHERE binding.catalog_item_id = ?
          UNION ALL
          SELECT receipt.id
          FROM purchase_receipts receipt
          INNER JOIN product_stock_lots lot ON lot.purchase_receipt_id = receipt.id
          WHERE lot.catalog_item_id = ?
        )
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*)
          FROM ingredient_lots lot
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = lot.ingredient_id
          WHERE binding.catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM product_stock_lots
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM products product
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'product'
            AND binding.legacy_entity_id = product.id
          WHERE binding.catalog_item_id = ?
            AND ABS(product.stock_qty) > 0.000001
        ) AS count
      `,
      [catalogItemId, catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*)
          FROM ingredient_movements movement
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = movement.ingredient_id
          WHERE binding.catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM inventory_movements movement
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'product'
            AND binding.legacy_entity_id = movement.product_id
          WHERE binding.catalog_item_id = ?
        ) AS count
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*)
          FROM recipes recipe
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'product'
            AND binding.legacy_entity_id = recipe.output_product_id
          WHERE binding.catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM recipe_ingredient_lines line
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = line.ingredient_id
          WHERE binding.catalog_item_id = ?
        ) AS count
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*) FROM recipe_versions
          WHERE output_catalog_item_id = ?
        ) + (
          SELECT COUNT(*) FROM recipe_version_lines
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*) FROM catalog_item_recipe_roles
          WHERE output_catalog_item_id = ?
        ) + (
          SELECT COUNT(*) FROM recipe_drafts
          WHERE output_catalog_item_id = ?
        ) + (
          SELECT COUNT(*) FROM recipe_draft_lines
          WHERE catalog_item_id = ?
        ) AS count
      `,
      [
        catalogItemId,
        catalogItemId,
        catalogItemId,
        catalogItemId,
        catalogItemId,
      ],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*) FROM production_input_allocations
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*) FROM production_plan_requirements
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM production_batches batch
          WHERE batch.output_product_id IN (
            SELECT legacy_entity_id
            FROM legacy_item_bindings
            WHERE catalog_item_id = ? AND entity_kind = 'product'
          ) OR batch.recipe_id IN (
            SELECT recipe.id
            FROM recipes recipe
            INNER JOIN legacy_item_bindings binding
              ON binding.entity_kind = 'product'
              AND binding.legacy_entity_id = recipe.output_product_id
            WHERE binding.catalog_item_id = ?
          )
        ) + (
          SELECT COUNT(*)
          FROM production_ingredient_usages usage
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = usage.ingredient_id
          WHERE binding.catalog_item_id = ?
        ) AS count
      `,
      [
        catalogItemId,
        catalogItemId,
        catalogItemId,
        catalogItemId,
        catalogItemId,
      ],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*) FROM sale_product_lot_usages
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM sale_items item
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'product'
            AND binding.legacy_entity_id = item.product_id
          WHERE binding.catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM sale_ingredient_usages usage
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'ingredient'
            AND binding.legacy_entity_id = usage.ingredient_id
          WHERE binding.catalog_item_id = ?
        ) AS count
      `,
      [catalogItemId, catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM supply_usage_rules
        WHERE supply_catalog_item_id = ?
          OR target_product_id IN (
            SELECT legacy_entity_id
            FROM legacy_item_bindings
            WHERE catalog_item_id = ? AND entity_kind = 'product'
          )
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM sale_supply_usages
        WHERE supply_catalog_item_id = ?
      `,
      parameter,
    ),
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM stock_adjustments
        WHERE catalog_item_id = ?
      `,
      parameter,
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*) FROM item_unit_conversions
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*) FROM catalog_cost_profiles
          WHERE catalog_item_id = ?
        ) AS count
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM product_transfers transfer
        WHERE transfer.from_product_id IN (
          SELECT legacy_entity_id
          FROM legacy_item_bindings
          WHERE catalog_item_id = ? AND entity_kind = 'product'
        ) OR transfer.to_product_id IN (
          SELECT legacy_entity_id
          FROM legacy_item_bindings
          WHERE catalog_item_id = ? AND entity_kind = 'product'
        )
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM owner_alerts alert
        WHERE alert.product_id IN (
          SELECT legacy_entity_id
          FROM legacy_item_bindings
          WHERE catalog_item_id = ? AND entity_kind = 'product'
        )
      `,
      parameter,
    ),
  ]);

  // The current schema has no normalized bundle-component relationship. This
  // zero records the completed schema check; it is not a missing result.
  const bundleReference = 0;
  const historicalReportDependency =
    movement +
    recipeReference +
    recipeVersionReference +
    production +
    sale +
    configurationReference +
    transferReference +
    alertReference;

  return {
    purchase,
    lot,
    movement,
    recipe_reference: recipeReference,
    recipe_version_reference: recipeVersionReference,
    production,
    sale,
    bundle_reference: bundleReference,
    supply_rule_reference: supplyRuleReference,
    order_supply_usage: orderSupplyUsage,
    adjustment,
    historical_report_dependency: historicalReportDependency,
  };
}

export async function evaluateCatalogItemPermanentDelete(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db?: RepositoryDatabase,
): Promise<PermanentDeleteEligibility> {
  if (!ownerAuthorized) {
    return evaluatePermanentDeleteEligibility({
      ownerAuthorized: false,
      referenceCounts: {},
    });
  }
  try {
    const referenceCounts = await getCatalogItemReferenceCounts(
      catalogItemId,
      db,
    );
    return evaluatePermanentDeleteEligibility({
      ownerAuthorized,
      referenceCounts,
    });
  } catch {
    return evaluatePermanentDeleteEligibility({
      ownerAuthorized,
      referenceCounts: {},
    });
  }
}

export type CatalogItemPermanentDeleteResult =
  | { outcome: "deleted"; catalogItemId: string }
  | Exclude<PermanentDeleteEligibility, { outcome: "allowed" }>;

/**
 * Rechecks every protected reference and removes the catalog identity plus its
 * exact unused legacy projection in one exclusive transaction. Any audit or
 * write uncertainty fails closed and leaves the item available for Archive.
 */
export async function permanentlyDeleteCatalogItem(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db?: RepositoryDatabase,
): Promise<CatalogItemPermanentDeleteResult> {
  if (!ownerAuthorized) {
    return {
      outcome: "owner_authorization_required",
      blockingReferences: [],
    };
  }

  const database = getRepositoryDatabase(db);
  let result: CatalogItemPermanentDeleteResult = {
    outcome: "denied_fail_closed",
    blockingReferences: [],
  };

  try {
    await database.withExclusiveTransactionAsync(async (txn) => {
      const item = await txn.getFirstAsync<{
        business_id: string;
      }>(
        `
          SELECT business_id
          FROM catalog_items
          WHERE id = ? AND deleted_at IS NULL
        `,
        [catalogItemId],
      );
      if (!item) {
        throw new Error("Catalog item is unavailable for permanent delete.");
      }

      const referenceCounts = await getCatalogItemReferenceCounts(
        catalogItemId,
        txn,
      );
      const eligibility = evaluatePermanentDeleteEligibility({
        ownerAuthorized: true,
        referenceCounts,
      });
      if (eligibility.outcome !== "allowed") {
        result = eligibility;
        return;
      }

      const bindings = await txn.getAllAsync<{
        entity_kind: "product" | "ingredient";
        legacy_entity_id: string;
      }>(
        `
          SELECT entity_kind, legacy_entity_id
          FROM legacy_item_bindings
          WHERE catalog_item_id = ? AND deleted_at IS NULL
        `,
        [catalogItemId],
      );
      if (bindings.length !== 1) {
        throw new Error("Catalog projection identity is not exact.");
      }

      const binding = bindings[0];
      const bindingRemoval = await txn.runAsync(
        "DELETE FROM legacy_item_bindings WHERE catalog_item_id = ?",
        [catalogItemId],
      );
      if (bindingRemoval.changes !== 1) {
        throw new Error("Catalog binding changed before permanent delete.");
      }

      const projectionRemoval = await txn.runAsync(
        binding.entity_kind === "product"
          ? "DELETE FROM products WHERE id = ? AND business_id = ?"
          : "DELETE FROM ingredients WHERE id = ? AND business_id = ?",
        [binding.legacy_entity_id, item.business_id],
      );
      if (projectionRemoval.changes !== 1) {
        throw new Error("Catalog projection changed before permanent delete.");
      }

      const itemRemoval = await txn.runAsync(
        "DELETE FROM catalog_items WHERE id = ? AND business_id = ?",
        [catalogItemId, item.business_id],
      );
      if (itemRemoval.changes !== 1) {
        throw new Error("Catalog item changed before permanent delete.");
      }
      result = { outcome: "deleted", catalogItemId };
    });
  } catch {
    return { outcome: "denied_fail_closed", blockingReferences: [] };
  }

  return result;
}

/**
 * Archive is the normal lifecycle action and retains every projection and
 * historical reference. Moving an unreviewed legacy binding out of
 * compatibility mode prevents the exact legacy Kiosk bypass from ignoring the
 * explicit archive.
 */
export async function archiveCatalogItemInTransaction(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase,
) {
  const item = await db.getFirstAsync<{
    lifecycle_status: "draft" | "ready" | "active" | "archived";
  }>(
    `
      SELECT lifecycle_status
      FROM catalog_items
      WHERE id = ? AND deleted_at IS NULL
    `,
    [catalogItemId],
  );
  if (!item) throw new Error("Catalog item is unavailable.");
  const eligibility = evaluateArchiveEligibility({
    ownerAuthorized,
    lifecycle: item.lifecycle_status,
  });
  if (!eligibility.allowed) {
    throw new Error("Owner authorization is required to archive an item.");
  }
  if (eligibility.alreadyArchived) return;

  const timestamp = nowIso();
  const result = await db.runAsync(
    `
      UPDATE catalog_items
      SET lifecycle_status = 'archived', readiness_state = 'blocked',
        sellable = 0, kiosk_enabled = 0, archived_at = ?,
        updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL
    `,
    [timestamp, timestamp, catalogItemId],
  );
  if (result.changes !== 1) {
    throw new Error("Catalog item changed before archive.");
  }
  await db.runAsync(
    `
      UPDATE products
      SET active = 0, updated_at = ?, sync_status = 'local'
      WHERE id IN (
        SELECT legacy_entity_id
        FROM legacy_item_bindings
        WHERE catalog_item_id = ? AND entity_kind = 'product'
          AND deleted_at IS NULL
      ) AND deleted_at IS NULL
    `,
    [timestamp, catalogItemId],
  );
  await db.runAsync(
    `
      UPDATE legacy_item_bindings
      SET compatibility_mode = CASE
            WHEN compatibility_mode = 'legacy_unclassified'
              THEN 'reviewed_legacy'
            ELSE compatibility_mode
          END,
        binding_status = 'archived',
        legacy_active_snapshot = 0,
        reviewed_at = COALESCE(reviewed_at, ?),
        updated_at = ?, sync_status = 'local'
      WHERE catalog_item_id = ? AND deleted_at IS NULL
    `,
    [timestamp, timestamp, catalogItemId],
  );
  await db.runAsync(
    `
      UPDATE recipes
      SET is_active = 0, updated_at = ?, sync_status = 'local'
      WHERE output_product_id IN (
        SELECT legacy_entity_id
        FROM legacy_item_bindings
        WHERE catalog_item_id = ? AND entity_kind = 'product'
          AND deleted_at IS NULL
      ) AND deleted_at IS NULL
    `,
    [timestamp, catalogItemId],
  );
  await db.runAsync(
    `
      UPDATE catalog_item_recipe_roles
      SET status = 'archived', archived_at = ?, updated_at = ?,
        sync_status = 'local'
      WHERE output_catalog_item_id = ? AND status = 'active'
        AND deleted_at IS NULL
    `,
    [timestamp, timestamp, catalogItemId],
  );
  await db.runAsync(
    `
      UPDATE recipe_drafts
      SET lifecycle_status = 'abandoned',
        autosave_revision = autosave_revision + 1,
        last_saved_at = ?, updated_at = ?, sync_status = 'local'
      WHERE output_catalog_item_id = ?
        AND lifecycle_status IN ('editing', 'ready')
        AND deleted_at IS NULL
    `,
    [timestamp, timestamp, catalogItemId],
  );
  await db.runAsync(
    `
      UPDATE catalog_cost_profiles
      SET status = 'archived', updated_at = ?, sync_status = 'local'
      WHERE catalog_item_id = ? AND status = 'active'
        AND deleted_at IS NULL
    `,
    [timestamp, catalogItemId],
  );
}

export async function archiveCatalogItem(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db?: RepositoryDatabase,
) {
  const database = getRepositoryDatabase(db);
  await database.withExclusiveTransactionAsync((txn) =>
    archiveCatalogItemInTransaction(catalogItemId, ownerAuthorized, txn),
  );
}
