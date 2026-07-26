import { z } from "zod";

import { makeIngredientId } from "@/domain/ids";
import type { Ingredient, IngredientUnit, SyncStatus } from "@/domain/types";

import { getRepositoryDatabase, nowIso, toBoolean, toInteger, type RepositoryDatabase } from "./shared";

export const ingredientUnits: IngredientUnit[] = ["g", "kg", "ml", "L", "pcs", "pack"];

const createIngredientSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  name: z.string().min(1),
  defaultUnit: z.enum(["g", "kg", "ml", "L", "pcs", "pack"]).default("pcs"),
  category: z.string().default("General"),
  lowStockThreshold: z.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
});

// Separate schema without .default() values: zod v4 .partial() re-applies field
// defaults for missing keys, which would silently overwrite existing columns.
const updateIngredientSchema = z.object({
  name: z.string().min(1).optional(),
  defaultUnit: z.enum(["g", "kg", "ml", "L", "pcs", "pack"]).optional(),
  category: z.string().optional(),
  lowStockThreshold: z.number().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export type CreateIngredientInput = z.input<typeof createIngredientSchema>;
export type UpdateIngredientInput = z.input<typeof updateIngredientSchema>;

type IngredientRow = {
  id: string;
  business_id: string;
  name: string;
  default_unit: IngredientUnit;
  category: string;
  low_stock_threshold: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

function mapIngredient(row: IngredientRow): Ingredient {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    defaultUnit: row.default_unit,
    category: row.category,
    lowStockThreshold: row.low_stock_threshold,
    isActive: toBoolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

export async function createIngredient(input: CreateIngredientInput, db?: RepositoryDatabase) {
  const parsed = createIngredientSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const ingredient: Ingredient = {
    id: parsed.id ?? makeIngredientId(),
    businessId: parsed.businessId,
    name: parsed.name.trim(),
    defaultUnit: parsed.defaultUnit,
    category: parsed.category,
    lowStockThreshold: parsed.lowStockThreshold,
    isActive: parsed.isActive,
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  const insert = async (txn: RepositoryDatabase) => {
    await txn.runAsync(
      `
        INSERT INTO ingredients (
          id, business_id, name, default_unit, category, low_stock_threshold,
          is_active, created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ingredient.id,
        ingredient.businessId,
        ingredient.name,
        ingredient.defaultUnit,
        ingredient.category,
        ingredient.lowStockThreshold,
        toInteger(ingredient.isActive),
        ingredient.createdAt,
        ingredient.updatedAt,
        ingredient.syncStatus,
        ingredient.deletedAt,
      ],
    );
    const catalogItemId = `legacy:ingredient:${ingredient.id}`;
    await txn.runAsync(
      `
        INSERT INTO catalog_items (
          id, business_id, branch_id, name, normalized_name, source_type,
          classification, lifecycle_status, readiness_state,
          classification_review_required, sellable, kiosk_enabled,
          purchase_cost_state, selling_price_state, stock_policy, archived_at,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, NULL, ?, ?, 'legacy_ingredient', 'legacy_unclassified', 'draft', 'legacy_review', 1, 0, 0, 'legacy_zero_unresolved', 'not_applicable', 'ingredient_lots', NULL, ?, ?, 'local', NULL)
      `,
      [
        catalogItemId,
        ingredient.businessId,
        ingredient.name,
        ingredient.name.toLocaleLowerCase().trim(),
        ingredient.createdAt,
        ingredient.updatedAt,
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
        ) VALUES (?, ?, ?, 'ingredient', ?, 'legacy_ingredient', 'active', 'legacy_unclassified', 1, ?, NULL, 'migration_011', NULL, NULL, ?, ?, 'local', NULL)
      `,
      [
        `binding:ingredient:${ingredient.id}`,
        ingredient.businessId,
        catalogItemId,
        ingredient.id,
        toInteger(ingredient.isActive),
        ingredient.createdAt,
        ingredient.updatedAt,
      ],
    );
  };

  if (db) {
    await insert(database);
  } else {
    await database.withExclusiveTransactionAsync(insert);
  }

  return ingredient;
}

export async function getIngredientById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<IngredientRow>(
    "SELECT * FROM ingredients WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return row ? mapIngredient(row) : null;
}

export async function findIngredientByName(businessId: string, name: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<IngredientRow>(
    `
      SELECT * FROM ingredients
      WHERE business_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
      LIMIT 1
    `,
    [businessId, name.trim()],
  );
  return row ? mapIngredient(row) : null;
}

export async function listIngredientsForBusiness(businessId: string, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<IngredientRow>(
    "SELECT * FROM ingredients WHERE business_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE ASC",
    [businessId],
  );
  return rows.map(mapIngredient);
}

export async function searchIngredientsByName(businessId: string, query: string, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<IngredientRow>(
    `
      SELECT * FROM ingredients
      WHERE business_id = ? AND deleted_at IS NULL AND name LIKE ? COLLATE NOCASE
      ORDER BY name COLLATE NOCASE ASC
    `,
    [businessId, `%${query.trim()}%`],
  );
  return rows.map(mapIngredient);
}

export async function updateIngredient(id: string, input: UpdateIngredientInput, db?: RepositoryDatabase) {
  const existing = await getIngredientById(id, db);
  if (!existing) {
    throw new Error("Ingredient not found.");
  }

  const parsed = updateIngredientSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const updatedAt = nowIso();
  const ingredient: Ingredient = {
    ...existing,
    name: parsed.name?.trim() || existing.name,
    defaultUnit: parsed.defaultUnit ?? existing.defaultUnit,
    category: parsed.category ?? existing.category,
    lowStockThreshold: parsed.lowStockThreshold ?? existing.lowStockThreshold,
    isActive: parsed.isActive ?? existing.isActive,
    updatedAt,
    syncStatus: "local",
  };

  const applyUpdate = async (txn: RepositoryDatabase) => {
    await txn.runAsync(
    `
      UPDATE ingredients
      SET name = ?, default_unit = ?, category = ?, low_stock_threshold = ?,
        is_active = ?, updated_at = ?, sync_status = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
    [
      ingredient.name,
      ingredient.defaultUnit,
      ingredient.category,
      ingredient.lowStockThreshold,
      toInteger(ingredient.isActive),
      ingredient.updatedAt,
      ingredient.syncStatus,
      ingredient.id,
    ],
  );
    await txn.runAsync(
    `
      UPDATE catalog_items
      SET name = ?, normalized_name = ?, updated_at = ?, sync_status = 'local'
      WHERE id = (
        SELECT catalog_item_id
        FROM legacy_item_bindings
        WHERE entity_kind = 'ingredient' AND legacy_entity_id = ?
          AND deleted_at IS NULL
      )
        AND deleted_at IS NULL
    `,
    [
      ingredient.name,
      ingredient.name.toLocaleLowerCase().trim(),
      ingredient.updatedAt,
      ingredient.id,
    ],
  );
    await txn.runAsync(
    `
      UPDATE legacy_item_bindings
      SET legacy_active_snapshot = ?, updated_at = ?, sync_status = 'local'
      WHERE entity_kind = 'ingredient' AND legacy_entity_id = ?
        AND deleted_at IS NULL
    `,
    [toInteger(ingredient.isActive), ingredient.updatedAt, ingredient.id],
    );
  };

  if (db) {
    await applyUpdate(database);
  } else {
    await database.withExclusiveTransactionAsync(applyUpdate);
  }

  return ingredient;
}

export async function countIngredients(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM ingredients WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
