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
        ) AS count
      `,
      [catalogItemId, catalogItemId],
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
        ) AS count
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT (
          SELECT COUNT(*) FROM production_input_allocations
          WHERE catalog_item_id = ?
        ) + (
          SELECT COUNT(*)
          FROM production_batches batch
          INNER JOIN recipes recipe ON recipe.id = batch.recipe_id
          INNER JOIN legacy_item_bindings binding
            ON binding.entity_kind = 'product'
            AND binding.legacy_entity_id = recipe.output_product_id
          WHERE binding.catalog_item_id = ?
        ) AS count
      `,
      [catalogItemId, catalogItemId],
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
        ) AS count
      `,
      [catalogItemId, catalogItemId],
    ),
    count(
      database,
      `
        SELECT COUNT(*) AS count
        FROM supply_usage_rules
        WHERE supply_catalog_item_id = ?
      `,
      parameter,
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
  ]);

  // The current schema has no normalized bundle-component relationship. This
  // zero records the completed schema check; it is not a missing result.
  const bundleReference = 0;
  const historicalReportDependency =
    movement + recipeReference + recipeVersionReference + production + sale;

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

/**
 * Archive is the normal lifecycle action and retains every projection and
 * historical reference. Moving an unreviewed legacy binding out of
 * compatibility mode prevents the exact legacy Kiosk bypass from ignoring the
 * explicit archive.
 */
export async function archiveCatalogItem(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db?: RepositoryDatabase,
) {
  const database = getRepositoryDatabase(db);
  await database.withExclusiveTransactionAsync(async (txn) => {
    const item = await txn.getFirstAsync<{
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
    const result = await txn.runAsync(
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
    await txn.runAsync(
      `
        UPDATE legacy_item_bindings
        SET compatibility_mode = CASE
              WHEN compatibility_mode = 'legacy_unclassified'
                THEN 'reviewed_legacy'
              ELSE compatibility_mode
            END,
          binding_status = 'archived',
          reviewed_at = COALESCE(reviewed_at, ?),
          updated_at = ?, sync_status = 'local'
        WHERE catalog_item_id = ? AND deleted_at IS NULL
      `,
      [timestamp, timestamp, catalogItemId],
    );
  });
}
