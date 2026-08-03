import type { RepositoryDatabase } from "@/db/repositories";

export type GroceryMissingPriceKind =
  | "ingredient_lot"
  | "ingredient"
  | "purchase_cost"
  | "selling_price"
  | "recipe_cost"
  | "production_plan";

export type GroceryMissingPriceEntry = {
  id: string;
  kind: GroceryMissingPriceKind;
  name: string;
  detail: string;
  catalogItemId: string | null;
  ingredientId: string | null;
  lotId: string | null;
  recipeId: string | null;
};

type MissingPriceRow = {
  id: string;
  kind: GroceryMissingPriceKind;
  name: string;
  detail: string;
  catalog_item_id: string | null;
  ingredient_id: string | null;
  lot_id: string | null;
  recipe_id: string | null;
};

/**
 * Read-only Missing Prices projection. The owning tables remain authoritative;
 * this query creates no price record and never converts a legacy zero into
 * known evidence.
 */
export async function listGroceryMissingPrices(
  businessId: string,
  db: RepositoryDatabase,
): Promise<GroceryMissingPriceEntry[]> {
  const rows = await db.getAllAsync<MissingPriceRow>(
    `
      SELECT 'lot:' || lot.id AS id, 'ingredient_lot' AS kind,
        ingredient.name AS name,
        'Purchase lot has no authoritative price' AS detail,
        binding.catalog_item_id, ingredient.id AS ingredient_id,
        lot.id AS lot_id, NULL AS recipe_id
      FROM ingredient_lots lot
      INNER JOIN ingredients ingredient
        ON ingredient.id = lot.ingredient_id
        AND ingredient.deleted_at IS NULL
        AND ingredient.is_active = 1
      LEFT JOIN legacy_item_bindings binding
        ON binding.entity_kind = 'ingredient'
        AND binding.legacy_entity_id = ingredient.id
        AND binding.deleted_at IS NULL
      WHERE lot.business_id = ? AND lot.deleted_at IS NULL
        AND lot.status <> 'archived'
        AND lot.cost_state IN ('unknown', 'legacy_zero_unresolved')

      UNION ALL

      SELECT 'ingredient:' || ingredient.id, 'ingredient', ingredient.name,
        'No usable known purchase-cost evidence', binding.catalog_item_id,
        ingredient.id, NULL, NULL
      FROM ingredients ingredient
      LEFT JOIN legacy_item_bindings binding
        ON binding.entity_kind = 'ingredient'
        AND binding.legacy_entity_id = ingredient.id
        AND binding.deleted_at IS NULL
      WHERE ingredient.business_id = ? AND ingredient.deleted_at IS NULL
        AND ingredient.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM ingredient_lots visible_lot
          WHERE visible_lot.ingredient_id = ingredient.id
            AND visible_lot.deleted_at IS NULL
            AND visible_lot.status <> 'archived'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ingredient_lots known_lot
          WHERE known_lot.ingredient_id = ingredient.id
            AND known_lot.deleted_at IS NULL
            AND known_lot.status <> 'archived'
            AND known_lot.cost_state = 'known'
            AND known_lot.recorded_cost_per_unit IS NOT NULL
        )

      UNION ALL

      SELECT 'purchase:' || item.id, 'purchase_cost', item.name,
        'Purchase cost belongs to this direct-resale item', item.id,
        NULL, NULL, NULL
      FROM catalog_items item
      WHERE item.business_id = ? AND item.deleted_at IS NULL
        AND item.lifecycle_status <> 'archived'
        AND item.classification = 'direct_resale_product'
        AND item.purchase_cost_state IN ('unknown', 'legacy_zero_unresolved')

      UNION ALL

      SELECT 'selling:' || item.id, 'selling_price', item.name,
        'Selling price must be completed in Paninda or Recipe Book', item.id,
        NULL, NULL, NULL
      FROM catalog_items item
      WHERE item.business_id = ? AND item.deleted_at IS NULL
        AND item.lifecycle_status <> 'archived'
        AND item.classification IN ('finished_product', 'direct_resale_product')
        AND item.selling_price_state IN ('unknown', 'legacy_zero_unresolved')

      UNION ALL

      SELECT 'recipe:' || version.id, 'recipe_cost', version.name_snapshot,
        CASE summary.status
          WHEN 'no_price' THEN 'Published Recipe has no price evidence'
          ELSE 'Published Recipe cost is incomplete'
        END,
        version.output_catalog_item_id, NULL, NULL, version.recipe_id
      FROM recipe_versions version
      INNER JOIN recipes recipe
        ON recipe.id = version.recipe_id
        AND recipe.active_version_id = version.id
        AND recipe.is_active = 1
        AND recipe.deleted_at IS NULL
      LEFT JOIN recipe_version_cost_summaries summary
        ON summary.recipe_version_id = version.id
        AND summary.deleted_at IS NULL
      WHERE version.business_id = ? AND version.status = 'published'
        AND version.deleted_at IS NULL
        AND (summary.status IS NULL OR summary.status IN ('incomplete', 'no_price'))

      UNION ALL

      SELECT 'plan:' || plan.id, 'production_plan', version.name_snapshot,
        'Saved production plan has incomplete expected cost',
        version.output_catalog_item_id, NULL, NULL, plan.root_recipe_id
      FROM production_plans plan
      INNER JOIN recipe_versions version
        ON version.id = plan.root_recipe_version_id
        AND version.deleted_at IS NULL
      WHERE plan.business_id = ? AND plan.deleted_at IS NULL
        AND plan.status IN ('draft', 'ready', 'in_progress')
        AND plan.cost_state IN ('unknown', 'partial', 'legacy_zero_unresolved')

      ORDER BY name COLLATE NOCASE ASC, id ASC
    `,
    [businessId, businessId, businessId, businessId, businessId, businessId],
  );

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    detail: row.detail,
    catalogItemId: row.catalog_item_id,
    ingredientId: row.ingredient_id,
    lotId: row.lot_id,
    recipeId: row.recipe_id,
  }));
}
