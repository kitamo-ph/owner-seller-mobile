import { z } from "zod";

import type { CostState } from "@/domain/costState";
import { makeIngredientLotId, makeIngredientMovementId } from "@/domain/ids";
import {
  normalizePracticalRecipeUnit,
  recipeUnitStandard,
  validateRecipeConversionSnapshotEvidence,
} from "@/domain/recipeConversionChains";
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
  totalCost: z.number().nonnegative().nullable().optional(),
  costState: z
    .enum(["known", "unknown", "legacy_zero_unresolved", "not_applicable"])
    .optional(),
  expiryDate: z.string().nullable().optional(),
  supplierId: z.string().nullable().optional(),
  purchaseReceiptId: z.string().nullable().optional(),
  sourceMetadataJson: z.string().nullable().optional(),
  enteredQuantity: z.number().positive().nullable().optional(),
  enteredUnit: z.string().trim().min(1).nullable().optional(),
  unitStandardSnapshot: z.string().trim().min(1).nullable().optional(),
  conversionChainJson: z.string().trim().min(1).nullable().optional(),
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
  expiry_date: string | null;
  supplier_id: string | null;
  purchase_receipt_id: string | null;
  provenance_state: IngredientLotProvenanceState;
  cost_state: CostState;
  recorded_total_cost: number | null;
  recorded_cost_per_unit: number | null;
  source_metadata_json: string | null;
  entered_quantity: number | null;
  entered_unit: string | null;
  unit_standard_snapshot: string | null;
  conversion_chain_json: string | null;
  notes: string | null;
  status: IngredientLotStatus;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

export type IngredientLotProvenanceState =
  | "legacy_unknown"
  | "purchase_recorded"
  | "review_required";

export type IngredientLotCostRecord = IngredientLot & {
  expiryDate: string | null;
  supplierId: string | null;
  purchaseReceiptId: string | null;
  provenanceState: IngredientLotProvenanceState;
  costState: CostState;
  recordedTotalCost: number | null;
  recordedCostPerUnit: number | null;
  sourceMetadataJson: string | null;
  enteredQuantity: number;
  enteredUnit: string;
  unitStandardSnapshot: string | null;
  conversionChainJson: string | null;
};

export type IngredientLotWithName = IngredientLotCostRecord & {
  ingredientName: string;
  ingredientLowStockThreshold: number;
  ingredientDefaultUnit: IngredientUnit;
};

type IngredientLotWithNameRow = IngredientLotRow & {
  ingredient_name: string;
  ingredient_low_stock_threshold: number;
  ingredient_default_unit: IngredientUnit;
};

function mapIngredientLot(row: IngredientLotRow): IngredientLotCostRecord {
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
    expiryDate: row.expiry_date,
    supplierId: row.supplier_id,
    purchaseReceiptId: row.purchase_receipt_id,
    provenanceState: row.provenance_state,
    costState: row.cost_state,
    recordedTotalCost: row.recorded_total_cost,
    recordedCostPerUnit: row.recorded_cost_per_unit,
    sourceMetadataJson: row.source_metadata_json,
    enteredQuantity: row.entered_quantity ?? row.purchased_quantity,
    enteredUnit: row.entered_unit ?? row.unit,
    unitStandardSnapshot: row.unit_standard_snapshot,
    conversionChainJson: row.conversion_chain_json,
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

function sameConversionValue(left: number, right: number) {
  return (
    Math.abs(left - right) <=
    1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function validateIngredientLotConversionEvidence(
  lot: IngredientLotCostRecord,
) {
  const inputUnit = normalizePracticalRecipeUnit(lot.enteredUnit);
  const outputUnit = normalizePracticalRecipeUnit(lot.unit);
  const factor = lot.purchasedQuantity / lot.enteredQuantity;
  if (!lot.conversionChainJson) {
    if (
      inputUnit !== outputUnit ||
      !sameConversionValue(factor, 1)
    ) {
      throw new Error(
        "Ingredient-lot normalized quantity requires conversion evidence.",
      );
    }
    if (
      lot.unitStandardSnapshot &&
      (!inputUnit ||
        lot.unitStandardSnapshot !== recipeUnitStandard(inputUnit))
    ) {
      throw new Error("Ingredient-lot unit standard is inconsistent.");
    }
    return;
  }
  const validation = validateRecipeConversionSnapshotEvidence({
    conversionChainJson: lot.conversionChainJson,
    unitStandardSnapshot: lot.unitStandardSnapshot,
    expectedInputUnit: lot.enteredUnit,
    expectedOutputUnit: lot.unit,
    expectedOutputQuantityPerInputUnit: factor,
  });
  if (!validation.ok) {
    throw new Error(
      `Ingredient-lot conversion evidence is inconsistent (${validation.reason}).`,
    );
  }
}

export async function createIngredientLot(input: CreateIngredientLotInput, db?: RepositoryDatabase) {
  const parsed = createIngredientLotSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const costState =
    parsed.costState ?? (parsed.totalCost === null || parsed.totalCost === undefined
      ? "unknown"
      : "known");
  if (
    (costState === "known" &&
      (parsed.totalCost === null || parsed.totalCost === undefined)) ||
    (costState !== "known" &&
      parsed.totalCost !== null &&
      parsed.totalCost !== undefined)
  ) {
    throw new Error("Ingredient-lot cost evidence is inconsistent.");
  }
  const recordedTotalCost =
    costState === "known" ? (parsed.totalCost as number) : null;
  const recordedCostPerUnit =
    recordedTotalCost === null
      ? null
      : recordedTotalCost / parsed.purchasedQuantity;
  const compatibilityTotalCost = recordedTotalCost ?? 0;
  const compatibilityCostPerUnit = recordedCostPerUnit ?? 0;
  const hasEnteredQuantity =
    parsed.enteredQuantity !== null && parsed.enteredQuantity !== undefined;
  const hasEnteredUnit =
    parsed.enteredUnit !== null && parsed.enteredUnit !== undefined;
  if (hasEnteredQuantity !== hasEnteredUnit) {
    throw new Error(
      "Ingredient-lot entered quantity and unit must be recorded together.",
    );
  }
  const lot: IngredientLotCostRecord = {
    id: parsed.id ?? makeIngredientLotId(),
    businessId: parsed.businessId,
    ingredientId: parsed.ingredientId,
    brandName: parsed.brandName?.trim() || null,
    sourceName: parsed.sourceName?.trim() || null,
    purchaseDate: parsed.purchaseDate,
    purchasedQuantity: parsed.purchasedQuantity,
    remainingQuantity: parsed.purchasedQuantity,
    unit: parsed.unit,
    totalCost: compatibilityTotalCost,
    costPerUnit: compatibilityCostPerUnit,
    expiryDate: parsed.expiryDate ?? null,
    supplierId: parsed.supplierId?.trim() || null,
    purchaseReceiptId: parsed.purchaseReceiptId?.trim() || null,
    provenanceState: "purchase_recorded",
    costState,
    recordedTotalCost,
    recordedCostPerUnit,
    sourceMetadataJson: parsed.sourceMetadataJson ?? null,
    enteredQuantity: parsed.enteredQuantity ?? parsed.purchasedQuantity,
    enteredUnit: parsed.enteredUnit?.trim() || parsed.unit,
    unitStandardSnapshot: parsed.unitStandardSnapshot?.trim() || null,
    conversionChainJson: parsed.conversionChainJson?.trim() || null,
    notes: parsed.notes?.trim() || null,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };
  validateIngredientLotConversionEvidence(lot);

  const ingredient = await database.getFirstAsync<{ business_id: string }>(
    `
      SELECT business_id
      FROM ingredients
      WHERE id = ? AND deleted_at IS NULL
    `,
    [lot.ingredientId],
  );
  if (!ingredient || ingredient.business_id !== lot.businessId) {
    throw new Error("Ingredient lot belongs to an unavailable Ingredient.");
  }

  if (lot.supplierId) {
    const supplier = await database.getFirstAsync<{
      business_id: string;
      status: string;
    }>(
      `
        SELECT business_id, status
        FROM suppliers
        WHERE id = ? AND deleted_at IS NULL
      `,
      [lot.supplierId],
    );
    if (
      !supplier ||
      supplier.business_id !== lot.businessId ||
      supplier.status !== "active"
    ) {
      throw new Error("Ingredient-lot supplier is unavailable.");
    }
  }

  if (lot.purchaseReceiptId) {
    const receipt = await database.getFirstAsync<{
      business_id: string;
      supplier_id: string | null;
    }>(
      `
        SELECT business_id, supplier_id
        FROM purchase_receipts
        WHERE id = ? AND deleted_at IS NULL
      `,
      [lot.purchaseReceiptId],
    );
    if (
      !receipt ||
      receipt.business_id !== lot.businessId ||
      receipt.supplier_id !== lot.supplierId
    ) {
      throw new Error("Ingredient lot does not match its purchase receipt.");
    }
  }

  await database.runAsync(
    `
      INSERT INTO ingredient_lots (
        id, business_id, ingredient_id, brand_name, source_name, purchase_date,
        purchased_quantity, remaining_quantity, unit, total_cost, cost_per_unit,
        notes, status, created_at, updated_at, sync_status, deleted_at,
        expiry_date, supplier_id, purchase_receipt_id, provenance_state,
        cost_state, recorded_total_cost, recorded_cost_per_unit,
        source_metadata_json, entered_quantity, entered_unit,
        unit_standard_snapshot, conversion_chain_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      lot.expiryDate,
      lot.supplierId,
      lot.purchaseReceiptId,
      lot.provenanceState,
      lot.costState,
      lot.recordedTotalCost,
      lot.recordedCostPerUnit,
      lot.sourceMetadataJson,
      lot.enteredQuantity,
      lot.enteredUnit,
      lot.unitStandardSnapshot,
      lot.conversionChainJson,
    ],
  );

  return lot;
}

/**
 * Completes previously missing purchase-price evidence. This deliberately is
 * not a general price editor: known evidence and historical snapshots are
 * never rewritten through this boundary.
 */
export async function completeIngredientLotCost(
  lotId: string,
  totalCost: number,
  expectedUpdatedAt: string,
  db?: RepositoryDatabase,
) {
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    throw new Error("Completed purchase cost must be zero or higher.");
  }
  const database = getRepositoryDatabase(db);
  const existing = await getIngredientLotById(lotId, database);
  if (!existing) throw new Error("Grocery lot not found.");
  if (existing.costState === "known") {
    if (existing.recordedTotalCost === totalCost) return existing;
    throw new Error(
      "This lot already has authoritative cost evidence. Record new evidence instead of rewriting history.",
    );
  }

  const costPerUnit = totalCost / existing.purchasedQuantity;
  const updatedAt = nowIso();
  const result = await database.runAsync(
    `
      UPDATE ingredient_lots
      SET total_cost = ?, cost_per_unit = ?, cost_state = 'known',
        recorded_total_cost = ?, recorded_cost_per_unit = ?,
        updated_at = ?, sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL AND updated_at = ?
        AND cost_state IN ('unknown', 'legacy_zero_unresolved')
        AND recorded_total_cost IS NULL AND recorded_cost_per_unit IS NULL
    `,
    [
      totalCost,
      costPerUnit,
      totalCost,
      costPerUnit,
      updatedAt,
      lotId,
      expectedUpdatedAt,
    ],
  );
  if (result.changes !== 1) {
    throw new Error("Grocery lot changed before its missing price was completed.");
  }
  const completed = await getIngredientLotById(lotId, database);
  if (!completed) throw new Error("Completed grocery lot is unavailable.");
  return completed;
}

/**
 * Updates descriptive lot metadata only. Quantity, entered-unit, purchase-cost,
 * and historical calculation evidence are intentionally outside this boundary.
 */
export async function updateIngredientLotMetadata(
  lotId: string,
  input: {
    brandName: string | null;
    sourceName: string | null;
    notes: string | null;
    expectedUpdatedAt: string;
  },
  db?: RepositoryDatabase,
) {
  const database = getRepositoryDatabase(db);
  const updatedAt = nowIso();
  const result = await database.runAsync(
    `
      UPDATE ingredient_lots
      SET brand_name = ?, source_name = ?, notes = ?, updated_at = ?,
        sync_status = 'local'
      WHERE id = ? AND deleted_at IS NULL AND status <> 'archived'
        AND updated_at = ?
    `,
    [
      input.brandName?.trim() || null,
      input.sourceName?.trim() || null,
      input.notes?.trim() || null,
      updatedAt,
      lotId,
      input.expectedUpdatedAt,
    ],
  );
  if (result.changes !== 1) {
    throw new Error("Grocery lot changed before its metadata was saved.");
  }
  const updated = await getIngredientLotById(lotId, database);
  if (!updated) throw new Error("Updated grocery lot is unavailable.");
  return updated;
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

export async function compareAndSetIngredientLotRemainingQuantity(
  lotId: string,
  newRemainingQuantity: number,
  expectedUpdatedAt: string,
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
      WHERE id = ? AND deleted_at IS NULL AND status != 'archived'
        AND purchased_quantity >= ? AND updated_at = ?
    `,
    [
      newRemainingQuantity,
      nextStatus,
      updatedAt,
      lotId,
      newRemainingQuantity,
      expectedUpdatedAt,
    ],
  );
  if (result.changes !== 1) {
    throw new Error("Grocery lot changed before its stock adjustment was saved.");
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
