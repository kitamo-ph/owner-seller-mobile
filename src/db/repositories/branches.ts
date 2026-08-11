import { z } from "zod";

import { makeBranchId } from "@/domain/ids";
import {
  createTypedLocationRef,
  locationRefSchema,
  normalizeLocationRef,
  parseLocationRefJson,
  serializeLocationRef,
} from "@/domain/onboarding";
import type { Branch, SyncStatus } from "@/domain/types";

import { getRepositoryDatabase, nowIso, toBoolean, toInteger, type RepositoryDatabase } from "./shared";

const branchFieldsSchema = z.object({
  id: z.string().optional(),
  businessId: z.string().min(1),
  branchName: z.string().trim().min(1),
  location: z.string().nullable().optional(),
  locationRef: locationRefSchema.nullable().optional(),
  inheritsBusinessLocation: z.boolean().default(false),
  branchType: z.enum(["stall", "branch", "kiosk", "booth", "home kitchen", "pop-up"]).default("stall"),
  active: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

const createBranchSchema = branchFieldsSchema;
const updateBranchSchema = branchFieldsSchema.partial().omit({ id: true, businessId: true });

export type CreateBranchInput = z.input<typeof createBranchSchema>;
export type UpdateBranchInput = Partial<Omit<CreateBranchInput, "id" | "businessId">>;

type BranchRow = {
  id: string;
  business_id: string;
  branch_name: string;
  location: string | null;
  location_ref_json: string | null;
  inherits_business_location: number;
  branch_type: Branch["branchType"];
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

function mapBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    businessId: row.business_id,
    branchName: row.branch_name,
    location: row.location,
    locationRef: parseLocationRefJson(row.location_ref_json, row.location),
    inheritsBusinessLocation: toBoolean(row.inherits_business_location),
    branchType: row.branch_type,
    active: toBoolean(row.active),
    notes: row.notes ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

export async function createBranch(input: CreateBranchInput, db?: RepositoryDatabase) {
  const parsed = createBranchSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const locationRef =
    parsed.locationRef !== undefined
      ? parsed.locationRef
        ? normalizeLocationRef(parsed.locationRef)
        : null
      : parsed.location?.trim()
        ? createTypedLocationRef(parsed.location)
        : null;
  const branch: Branch = {
    id: parsed.id ?? makeBranchId(),
    businessId: parsed.businessId,
    branchName: parsed.branchName,
    location: locationRef?.formattedAddress ?? null,
    locationRef,
    inheritsBusinessLocation: parsed.inheritsBusinessLocation,
    branchType: parsed.branchType,
    active: parsed.active,
    notes: parsed.notes ?? null,
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  await database.runAsync(
    `
      INSERT INTO branches (
        id, business_id, branch_name, location, location_ref_json,
        inherits_business_location, branch_type, active, notes,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      branch.id,
      branch.businessId,
      branch.branchName,
      branch.location,
      branch.locationRef ? serializeLocationRef(branch.locationRef) : null,
      toInteger(branch.inheritsBusinessLocation),
      branch.branchType,
      toInteger(branch.active),
      branch.notes,
      branch.createdAt,
      branch.updatedAt,
      branch.syncStatus,
      branch.deletedAt,
    ],
  );

  return branch;
}

export async function getBranchById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<BranchRow>("SELECT * FROM branches WHERE id = ? AND deleted_at IS NULL", [id]);
  return row ? mapBranch(row) : null;
}

export async function updateBranch(id: string, input: UpdateBranchInput, db?: RepositoryDatabase) {
  const existing = await getBranchById(id, db);
  if (!existing) {
    throw new Error("Stall or branch not found.");
  }

  const parsed = updateBranchSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const updatedAt = nowIso();
  const locationChanged = parsed.locationRef !== undefined || parsed.location !== undefined;
  const locationRef =
    parsed.locationRef !== undefined
      ? parsed.locationRef
        ? normalizeLocationRef(parsed.locationRef)
        : null
      : parsed.location !== undefined
        ? parsed.location?.trim()
          ? createTypedLocationRef(parsed.location)
          : null
        : existing.locationRef;
  const inheritsBusinessLocation =
    parsed.inheritsBusinessLocation ?? (locationChanged ? false : existing.inheritsBusinessLocation);
  const branch: Branch = {
    ...existing,
    branchName: parsed.branchName ?? existing.branchName,
    location: locationChanged ? locationRef?.formattedAddress ?? null : existing.location,
    locationRef,
    inheritsBusinessLocation,
    branchType: parsed.branchType ?? existing.branchType,
    active: parsed.active ?? existing.active,
    notes: parsed.notes === undefined ? existing.notes : parsed.notes,
    updatedAt,
    syncStatus: "local",
  };

  await database.runAsync(
    `
      UPDATE branches
      SET branch_name = ?, location = ?,
        location_ref_json = CASE WHEN ? = 1 THEN ? ELSE location_ref_json END,
        inherits_business_location = ?, branch_type = ?, active = ?, notes = ?,
        updated_at = ?, sync_status = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
    [
      branch.branchName,
      branch.location,
      locationChanged ? 1 : 0,
      locationChanged && branch.locationRef ? serializeLocationRef(branch.locationRef) : null,
      toInteger(branch.inheritsBusinessLocation),
      branch.branchType,
      toInteger(branch.active),
      branch.notes,
      branch.updatedAt,
      branch.syncStatus,
      branch.id,
    ],
  );

  return branch;
}

export async function listBranchesForBusiness(businessId: string, db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<BranchRow>(
    "SELECT * FROM branches WHERE business_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
    [businessId],
  );
  return rows.map(mapBranch);
}

export async function countBranches(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM branches WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
