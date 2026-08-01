import { makeUnitConversionId } from "@/domain/ids";

import {
  getRepositoryDatabase,
  nowIso,
  type RepositoryDatabase,
} from "./shared";

export type ItemUnitConversionRecord = {
  id: string;
  businessId: string;
  catalogItemId: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
  version: number;
  status: "active" | "superseded" | "archived";
  supersedesConversionId: string | null;
  effectiveAt: string;
};

export type CreateItemUnitConversionInput = {
  id?: string;
  businessId: string;
  catalogItemId: string;
  fromUnit: string;
  toUnit: string;
  factor: number;
};

type ItemUnitConversionRow = {
  id: string;
  business_id: string;
  catalog_item_id: string;
  from_unit: string;
  to_unit: string;
  factor: number;
  version: number;
  status: ItemUnitConversionRecord["status"];
  supersedes_conversion_id: string | null;
  effective_at: string;
};

function mapConversion(
  row: ItemUnitConversionRow,
): ItemUnitConversionRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    catalogItemId: row.catalog_item_id,
    fromUnit: row.from_unit,
    toUnit: row.to_unit,
    factor: row.factor,
    version: row.version,
    status: row.status,
    supersedesConversionId: row.supersedes_conversion_id,
    effectiveAt: row.effective_at,
  };
}

export async function createItemUnitConversionInTransaction(
  input: CreateItemUnitConversionInput,
  database: RepositoryDatabase,
): Promise<ItemUnitConversionRecord> {
  const fromUnit = input.fromUnit.trim();
  const toUnit = input.toUnit.trim();
  if (
    !fromUnit ||
    !toUnit ||
    fromUnit === toUnit ||
    !Number.isFinite(input.factor) ||
    input.factor <= 0
  ) {
    throw new Error("Item-specific unit conversion is invalid.");
  }
  const id = input.id ?? makeUnitConversionId();
  const item = await database.getFirstAsync<{ business_id: string }>(
    `
      SELECT business_id
      FROM catalog_items
      WHERE id = ? AND deleted_at IS NULL
    `,
    [input.catalogItemId],
  );
  if (!item || item.business_id !== input.businessId) {
    throw new Error("Catalog item is unavailable for conversion.");
  }
  const active = await database.getFirstAsync<ItemUnitConversionRow>(
    `
      SELECT *
      FROM item_unit_conversions
      WHERE catalog_item_id = ? AND from_unit = ? AND to_unit = ?
        AND status = 'active' AND deleted_at IS NULL
    `,
    [input.catalogItemId, fromUnit, toUnit],
  );
  const versionRow = await database.getFirstAsync<{ next_version: number }>(
    `
      SELECT COALESCE(MAX(version), 0) + 1 AS next_version
      FROM item_unit_conversions
      WHERE catalog_item_id = ? AND from_unit = ? AND to_unit = ?
    `,
    [input.catalogItemId, fromUnit, toUnit],
  );
  const timestamp = nowIso();
  if (active) {
    const superseded = await database.runAsync(
      `
        UPDATE item_unit_conversions
        SET status = 'superseded', updated_at = ?, sync_status = 'local'
        WHERE id = ? AND status = 'active'
      `,
      [timestamp, active.id],
    );
    if (superseded.changes !== 1) {
      throw new Error("Unit conversion changed before supersession.");
    }
  }
  await database.runAsync(
    `
      INSERT INTO item_unit_conversions (
        id, business_id, catalog_item_id, from_unit, to_unit, factor,
        version, status, supersedes_conversion_id, effective_at, created_at,
        updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'local', NULL)
    `,
    [
      id,
      input.businessId,
      input.catalogItemId,
      fromUnit,
      toUnit,
      input.factor,
      versionRow?.next_version ?? 1,
      active?.id ?? null,
      timestamp,
      timestamp,
      timestamp,
    ],
  );
  const row = await database.getFirstAsync<ItemUnitConversionRow>(
    "SELECT * FROM item_unit_conversions WHERE id = ?",
    [id],
  );
  if (!row) throw new Error("Unit conversion could not be reloaded.");
  return mapConversion(row);
}

export async function createItemUnitConversion(
  input: CreateItemUnitConversionInput,
  db?: RepositoryDatabase,
): Promise<ItemUnitConversionRecord> {
  const database = getRepositoryDatabase(db);
  let record: ItemUnitConversionRecord | null = null;
  await database.withExclusiveTransactionAsync(async (txn) => {
    record = await createItemUnitConversionInTransaction(input, txn);
  });
  if (!record) throw new Error("Unit conversion creation failed.");
  return record as ItemUnitConversionRecord;
}

export async function getActiveItemUnitConversion(
  catalogItemId: string,
  fromUnit: string,
  toUnit: string,
  db?: RepositoryDatabase,
) {
  const row =
    await getRepositoryDatabase(db).getFirstAsync<ItemUnitConversionRow>(
      `
        SELECT *
        FROM item_unit_conversions
        WHERE catalog_item_id = ? AND from_unit = ? AND to_unit = ?
          AND status = 'active' AND deleted_at IS NULL
      `,
      [catalogItemId, fromUnit, toUnit],
    );
  return row ? mapConversion(row) : null;
}
