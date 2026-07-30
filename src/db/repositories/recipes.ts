import { z } from "zod";

import { makeRecipeId } from "@/domain/ids";
import type { IngredientUnit, Recipe, RecipeProductionMode, SyncStatus } from "@/domain/types";

import { getRepositoryDatabase, nowIso, toBoolean, toInteger, type RepositoryDatabase } from "./shared";

const createRecipeSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  outputProductId: z.string().min(1),
  name: z.string().min(1),
  outputQuantity: z.number().positive(),
  outputUnit: z.enum(["g", "kg", "ml", "L", "pcs", "pack"]).default("pcs"),
  productionMode: z.enum(["prepared_before_selling", "cook_upon_order"]).default("prepared_before_selling"),
  suggestedSellingPrice: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

// Defaults-free update schema: zod v4 .partial() re-applies .default() values
// for missing keys, which would silently overwrite existing columns.
const updateRecipeSchema = z.object({
  name: z.string().min(1).optional(),
  outputQuantity: z.number().positive().optional(),
  outputUnit: z.enum(["g", "kg", "ml", "L", "pcs", "pack"]).optional(),
  productionMode: z.enum(["prepared_before_selling", "cook_upon_order"]).optional(),
  suggestedSellingPrice: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type CreateRecipeInput = z.input<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.input<typeof updateRecipeSchema>;

type RecipeRow = {
  id: string;
  business_id: string;
  output_product_id: string;
  name: string;
  output_quantity: number;
  output_unit: IngredientUnit;
  production_mode: RecipeProductionMode;
  suggested_selling_price: number | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

export type RecipeWithProduct = Recipe & {
  outputProductName: string;
};

type RecipeWithProductRow = RecipeRow & {
  output_product_name: string | null;
};

function mapRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    businessId: row.business_id,
    outputProductId: row.output_product_id,
    name: row.name,
    outputQuantity: row.output_quantity,
    outputUnit: row.output_unit,
    productionMode: row.production_mode,
    suggestedSellingPrice: row.suggested_selling_price,
    notes: row.notes,
    isActive: toBoolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

export async function createRecipe(input: CreateRecipeInput, db?: RepositoryDatabase) {
  const parsed = createRecipeSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const recipe: Recipe = {
    id: parsed.id ?? makeRecipeId(),
    businessId: parsed.businessId,
    outputProductId: parsed.outputProductId,
    name: parsed.name.trim(),
    outputQuantity: parsed.outputQuantity,
    outputUnit: parsed.outputUnit,
    productionMode: parsed.productionMode,
    suggestedSellingPrice: parsed.suggestedSellingPrice ?? null,
    notes: parsed.notes?.trim() || null,
    isActive: parsed.isActive,
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  const output = await database.getFirstAsync<{
    business_id: string;
    catalog_item_id: string;
    binding_status: string;
  }>(
    `
      SELECT product.business_id, binding.catalog_item_id,
        binding.binding_status
      FROM products product
      INNER JOIN legacy_item_bindings binding
        ON binding.entity_kind = 'product'
        AND binding.legacy_entity_id = product.id
        AND binding.deleted_at IS NULL
      WHERE product.id = ? AND product.deleted_at IS NULL
    `,
    [recipe.outputProductId],
  );
  if (
    output?.business_id !== recipe.businessId ||
    output.binding_status !== "active" ||
    !output.catalog_item_id
  ) {
    throw new Error("Recipe output requires an exact active Product binding.");
  }

  await database.runAsync(
    `
      INSERT INTO recipes (
        id, business_id, output_product_id, name, output_quantity, output_unit,
        production_mode, suggested_selling_price, notes, is_active,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      recipe.id,
      recipe.businessId,
      recipe.outputProductId,
      recipe.name,
      recipe.outputQuantity,
      recipe.outputUnit,
      recipe.productionMode,
      recipe.suggestedSellingPrice,
      recipe.notes,
      toInteger(recipe.isActive),
      recipe.createdAt,
      recipe.updatedAt,
      recipe.syncStatus,
      recipe.deletedAt,
    ],
  );

  return recipe;
}

export async function getRecipeById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<RecipeRow>(
    "SELECT * FROM recipes WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return row ? mapRecipe(row) : null;
}

export async function listRecipesForBusiness(businessId: string, db?: RepositoryDatabase): Promise<RecipeWithProduct[]> {
  const rows = await getRepositoryDatabase(db).getAllAsync<RecipeWithProductRow>(
    `
      SELECT r.*, p.name AS output_product_name
      FROM recipes r
      LEFT JOIN products p ON p.id = r.output_product_id AND p.deleted_at IS NULL
      WHERE r.business_id = ? AND r.deleted_at IS NULL
      ORDER BY r.created_at DESC
    `,
    [businessId],
  );

  return rows.map((row) => ({
    ...mapRecipe(row),
    outputProductName: row.output_product_name ?? "Unknown product",
  }));
}

export async function updateRecipe(id: string, input: UpdateRecipeInput, db?: RepositoryDatabase) {
  const existing = await getRecipeById(id, db);
  if (!existing) {
    throw new Error("Recipe not found.");
  }

  const parsed = updateRecipeSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const updatedAt = nowIso();
  const recipe: Recipe = {
    ...existing,
    name: parsed.name?.trim() || existing.name,
    outputQuantity: parsed.outputQuantity ?? existing.outputQuantity,
    outputUnit: parsed.outputUnit ?? existing.outputUnit,
    productionMode: parsed.productionMode ?? existing.productionMode,
    suggestedSellingPrice:
      parsed.suggestedSellingPrice === undefined ? existing.suggestedSellingPrice : parsed.suggestedSellingPrice,
    notes: parsed.notes === undefined ? existing.notes : parsed.notes?.trim() || null,
    isActive: parsed.isActive ?? existing.isActive,
    updatedAt,
    syncStatus: "local",
  };

  await database.runAsync(
    `
      UPDATE recipes
      SET name = ?, output_quantity = ?, output_unit = ?, production_mode = ?,
        suggested_selling_price = ?, notes = ?, is_active = ?, updated_at = ?, sync_status = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
    [
      recipe.name,
      recipe.outputQuantity,
      recipe.outputUnit,
      recipe.productionMode,
      recipe.suggestedSellingPrice,
      recipe.notes,
      toInteger(recipe.isActive),
      recipe.updatedAt,
      recipe.syncStatus,
      recipe.id,
    ],
  );

  return recipe;
}

export async function countRecipes(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM recipes WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
