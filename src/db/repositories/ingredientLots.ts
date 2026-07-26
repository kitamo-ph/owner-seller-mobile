import { z } from "zod";

import { makeIngredientLotId, makeIngredientMovementId } from "@/domain/ids";
import type {
  IngredientLot,
  IngredientLotStatus,
  IngredientMovement,
  IngredientMovementType,
  IngredientUnit,
  SyncStatus,
} from "@/domain/types";

import { getRepositoryDatabase, nowIso, type RepositoryDatabase } from "./shared";

const createIngredientLotSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  ingredientId: z.string().min(1),
  brandName: z.string().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  purchaseDate: z.string().min(1),
  purchasedQuantity: z.number().positive(),
  unit: z.enum(["g", "kg", "ml", "L", "pcs", "pack"]),
  totalCost: z.number().positive(),
  expiryDate: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  purchaseReceiptId: z.string().nullable().optional(),
  sourceMetadataJson: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateIngredientLotInput = z.input<typeof createIngredientLotSchema>;

const createIngredientMovementSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  ingredientId: z.string().min(1),
  lotId: z.string().nullable().optional(),
  movementType: z.enum(["purchase", "adjustment", "recipe_usage", "spoilage"]),
  quantity: z.number(),
  unit: z.enum(["g", "kg", "ml", "L", "pcs", "pack"]),
  unitCost: z.number().nullable().optional(),
  totalCost: z.number().nullable().optional(),
  reason: z.string().min(1),
});

export type CreateIngredientMovementInput = z.input<typeof createIngredientMovementSchema>;

type IngredientLotRow = {
  id: string;
  business_id: string;
  ingredient_id: string;
  brand_name: string | null;
  source_name: string | null;
  purchase_date: string;
  purchased_quantity: number;
  remaining_quantity: number;
  unit: IngredientUnit;
  total_cost: number;
  cost_per_unit: number;
  notes: string | null;
  status: IngredientLotStatus;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

export type IngredientLotWithName = IngredientLot & {
  ingredientName: string;
  ingredientLowStockThreshold: number;
  ingredientDefaultUnit: IngredientUnit;
};

type IngredientLotWithNameRow = IngredientLotRow & {
  ingredient_name: string;
  ingredient_low_stock_threshold: number;
  ingredient_default_unit: IngredientUnit;
};

function mapIngredientLot(row: IngredientLotRow): IngredientLot {
  return {
    id: row.id,
    businessId: row.business_id,
    ingredientId: row.ingredient_id,
    brandName: row.brand_name,
    sourceName: row.source_name,
    purchaseDate: row.purchase_date,
    purchasedQuantity: row.purchased_quantity,
    remainingQuantity: row.remaining_quantity,
    unit: row.unit,
    totalCost: row.total_cost,
    costPerUnit: row.cost_per_unit,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

function mapIngredientLotWithName(row: IngredientLotWithNameRow): IngredientLotWithName {
  return {
    ...mapIngredientLot(row),
    ingredientName: row.ingredient_name,
    ingredientLowStockThreshold: row.ingredient_low_stock_threshold,
    ingredientDefaultUnit: row.ingredient_default_unit,
  };
}

export async function createIngredientLot(input: CreateIngredientLotInput, db?: RepositoryDatabase) {
  const parsed = createIngredientLotSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const costPerUnit = parsed.totalCost / parsed.purchasedQuantity;
  const lot: IngredientLot = {
    id: parsed.id ?? makeIngredientLotId(),
    businessId: parsed.businessId,
    ingredientId: parsed.ingredientId,
    brandName: parsed.brandName?.trim() || null,
    sourceName: parsed.sourceName?.trim() || null,
    purchaseDate: parsed.purchaseDate,
    purchasedQuantity: parsed.purchasedQuantity,
    remainingQuantity: parsed.purchasedQuantity,
    unit: parsed.unit,
    totalCost: parsed.totalCost,
    costPerUnit,
    notes: parsed.notes?.trim() || null,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  await database.runAsync(
    `
      INSERT INTO ingredient_lots (
        id, business_id, ingredient_id, brand_name, source_name, purchase_date,
        purchased_quantity, remaining_quantity, unit, total_cost, cost_per_unit,
        notes, status, created_at, updated_at, sync_status, deleted_at,
        expiry_date, supplier_id, purchase_receipt_id, provenance_state,
        cost_state, recorded_total_cost, recorded_cost_per_unit,
        source_metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'purchase_recorded', 'known', ?, ?, ?)
    `,
    [
      lot.id,
      lot.businessId,
      lot.ingredientId,
      lot.brandName,
      lot.sourceName,
      lot.purchaseDate,
      lot.purchasedQuantity,
      lot.remainingQuantity,
      lot.unit,
      lot.totalCost,
      lot.costPerUnit,
      lot.notes,
      lot.status,
      lot.createdAt,
      lot.updatedAt,
      lot.syncStatus,
      lot.deletedAt,
      parsed.expiryDate ?? null,
      parsed.supplierId ?? null,
      parsed.purchaseReceiptId ?? null,
      lot.totalCost,
      lot.costPerUnit,
      parsed.sourceMetadataJson ?? null,
    ],
  );

  return lot;
}

export async function createIngredientMovement(input: CreateIngredientMovementInput, db?: RepositoryDatabase) {
  const parsed = createIngredientMovementSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const movement: IngredientMovement = {
    id: parsed.id ?? makeIngredientMovementId(),
    businessId: parsed.businessId,
    ingredientId: parsed.ingredientId,
    lotId: parsed.lotId ?? null,
    movementType: parsed.movementType as IngredientMovementType,
    quantity: parsed.quantity,
    unit: parsed.unit,
    unitCost: parsed.unitCost ?? null,
    totalCost: parsed.totalCost ?? null,
    reason: parsed.reason,
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  await database.runAsync(
    `
      INSERT INTO ingredient_movements (
        id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
        unit_cost, total_cost, reason, created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      movement.id,
      movement.businessId,
      movement.ingredientId,
      movement.lotId,
      movement.movementType,
      movement.quantity,
      movement.unit,
      movement.unitCost,
      movement.totalCost,
      movement.reason,
      movement.createdAt,
      movement.updatedAt,
      movement.syncStatus,
      movement.deletedAt,
    ],
  );

  return movement;
}

const lotWithNameSelect = `
  SELECT
    l.*,
    i.name AS ingredient_name,
    i.low_stock_threshold AS ingredient_low_stock_threshold,
    i.default_unit AS ingredient_default_unit
  FROM ingredient_lots l
  JOIN ingredients i ON i.id = l.ingredient_id AND i.deleted_at IS NULL
`;

export async function getIngredientLotById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<IngredientLotRow>(
    "SELECT * FROM ingredient_lots WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return row ? mapIngredientLot(row) : null;
}

export async function listIngredientLotsForBusiness(businessId: string, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<IngredientLotWithNameRow>(
    `${lotWithNameSelect}
      WHERE l.business_id = ? AND l.deleted_at IS NULL
      ORDER BY l.purchase_date DESC, l.created_at DESC
    `,
    [businessId],
  );
  return rows.map(mapIngredientLotWithName);
}

export async function listActiveIngredientLotsForBusiness(businessId: string, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<IngredientLotWithNameRow>(
    `${lotWithNameSelect}
      WHERE l.business_id = ? AND l.deleted_at IS NULL AND l.status = 'active'
      ORDER BY l.purchase_date DESC, l.created_at DESC
    `,
    [businessId],
  );
  return rows.map(mapIngredientLotWithName);
}

export async function listIngredientLotsForIngredient(ingredientId: string, limit = 20, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<IngredientLotRow>(
    `
      SELECT * FROM ingredient_lots
      WHERE ingredient_id = ? AND deleted_at IS NULL
      ORDER BY purchase_date DESC, created_at DESC
      LIMIT ?
    `,
    [ingredientId, limit],
  );
  return rows.map(mapIngredientLot);
}

export async function searchIngredientLots(businessId: string, query: string, db?: RepositoryDatabase) {
  const like = `%${query.trim()}%`;
  const rows = await getRepositoryDatabase(db).getAllAsync<IngredientLotWithNameRow>(
    `${lotWithNameSelect}
      WHERE l.business_id = ? AND l.deleted_at IS NULL
        AND (i.name LIKE ? COLLATE NOCASE OR l.brand_name LIKE ? COLLATE NOCASE OR l.source_name LIKE ? COLLATE NOCASE)
      ORDER BY l.purchase_date DESC, l.created_at DESC
    `,
    [businessId, like, like, like],
  );
  return rows.map(mapIngredientLotWithName);
}

export async function setIngredientLotRemainingQuantity(
  lotId: string,
  newRemainingQuantity: number,
  db?: RepositoryDatabase,
) {
  if (!Number.isFinite(newRemainingQuantity) || newRemainingQuantity < 0) {
    throw new Error("Remaining stock cannot be negative.");
  }

  const database = getRepositoryDatabase(db);
  const updatedAt = nowIso();
  const nextStatus = newRemainingQuantity <= 0 ? "depleted" : "active";
  const result = await database.runAsync(
    `
      UPDATE ingredient_lots
      SET remaining_quantity = ?, status = ?, updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL AND status != 'archived' AND purchased_quantity >= ?
    `,
    [newRemainingQuantity, nextStatus, updatedAt, lotId, newRemainingQuantity],
  );

  if (result.changes !== 1) {
    throw new Error("Remaining stock cannot be more than the purchased quantity.");
  }

  return true;
}

export async function archiveIngredientLot(lotId: string, db?: RepositoryDatabase) {
  const database = getRepositoryDatabase(db);
  const result = await database.runAsync(
    `
      UPDATE ingredient_lots
      SET status = 'archived', updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL
    `,
    [nowIso(), lotId],
  );
  return result.changes === 1;
}

export async function countIngredientLots(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM ingredient_lots WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
