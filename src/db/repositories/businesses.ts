import { z } from "zod";

import { makeBusinessId } from "@/domain/ids";
import {
  createTypedLocationRef,
  locationRefSchema,
  normalizeLocationRef,
  parseLocationRefJson,
  serializeLocationRef,
} from "@/domain/onboarding";
import type { Business, BusinessType, LanguagePreference, SyncStatus } from "@/domain/types";

import { getRepositoryDatabase, nowIso, type RepositoryDatabase } from "./shared";

const businessFieldsSchema = z.object({
  id: z.string().optional(),
  businessName: z.string().trim().min(1),
  businessType: z.string().trim().min(1),
  businessTypeCustom: z.string().trim().min(1).nullable().optional(),
  ownerName: z.string().trim().min(1),
  barangay: z.string().trim().min(1).optional(),
  locationRef: locationRefSchema.optional(),
  contactNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  preferredLanguage: z.enum(["Taglish", "Filipino", "English"]).default("Taglish"),
  currency: z.literal("PHP").default("PHP"),
});

const createBusinessSchema = businessFieldsSchema.superRefine((input, context) => {
  if (!input.locationRef && !input.barangay) {
    context.addIssue({
      code: "custom",
      message: "Business location is required.",
      path: ["locationRef"],
    });
  }
  if (input.businessType === "Other" && !input.businessTypeCustom) {
    context.addIssue({
      code: "custom",
      message: "Custom business type is required when Other is selected.",
      path: ["businessTypeCustom"],
    });
  }
});

const updateBusinessSchema = businessFieldsSchema.partial().omit({ id: true });

export type CreateBusinessInput = z.input<typeof createBusinessSchema>;
export type UpdateBusinessInput = Partial<Omit<CreateBusinessInput, "id">>;

type BusinessRow = {
  id: string;
  business_name: string;
  business_type: BusinessType;
  business_type_custom: string | null;
  owner_name: string;
  barangay: string;
  location_ref_json: string | null;
  contact_number: string | null;
  notes: string | null;
  preferred_language: LanguagePreference;
  currency: "PHP";
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

function mapBusiness(row: BusinessRow): Business {
  const locationRef = parseLocationRefJson(row.location_ref_json, row.barangay);
  if (!locationRef) {
    throw new Error("Stored business is missing its required location.");
  }

  return {
    id: row.id,
    businessName: row.business_name,
    businessType: row.business_type,
    businessTypeCustom: row.business_type_custom ?? null,
    ownerName: row.owner_name,
    barangay: row.barangay,
    locationRef,
    contactNumber: row.contact_number,
    notes: row.notes ?? null,
    preferredLanguage: row.preferred_language,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

export async function createBusiness(input: CreateBusinessInput, db?: RepositoryDatabase) {
  const parsed = createBusinessSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const createdAt = nowIso();
  const locationRef = parsed.locationRef
    ? normalizeLocationRef(parsed.locationRef)
    : createTypedLocationRef(parsed.barangay as string);
  const business: Business = {
    id: parsed.id ?? makeBusinessId(),
    businessName: parsed.businessName,
    businessType: parsed.businessType as BusinessType,
    businessTypeCustom: parsed.businessTypeCustom ?? null,
    ownerName: parsed.ownerName,
    barangay: locationRef.formattedAddress,
    locationRef,
    contactNumber: parsed.contactNumber ?? null,
    notes: parsed.notes ?? null,
    preferredLanguage: parsed.preferredLanguage,
    currency: parsed.currency,
    createdAt,
    updatedAt: createdAt,
    syncStatus: "local",
    deletedAt: null,
  };

  await database.runAsync(
    `
      INSERT INTO businesses (
        id, business_name, business_type, business_type_custom, owner_name,
        barangay, location_ref_json, contact_number, notes, preferred_language,
        currency, created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      business.id,
      business.businessName,
      business.businessType,
      business.businessTypeCustom,
      business.ownerName,
      business.barangay,
      serializeLocationRef(business.locationRef),
      business.contactNumber,
      business.notes,
      business.preferredLanguage,
      business.currency,
      business.createdAt,
      business.updatedAt,
      business.syncStatus,
      business.deletedAt,
    ],
  );

  return business;
}

export async function updateBusiness(id: string, input: UpdateBusinessInput, db?: RepositoryDatabase) {
  const existing = await getBusinessById(id, db);
  if (!existing) {
    throw new Error("Business not found.");
  }

  const parsed = updateBusinessSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const updatedAt = nowIso();
  const locationChanged = parsed.locationRef !== undefined || parsed.barangay !== undefined;
  const locationRef = parsed.locationRef
    ? normalizeLocationRef(parsed.locationRef)
    : parsed.barangay !== undefined
      ? createTypedLocationRef(parsed.barangay)
      : existing.locationRef;
  const businessType = (parsed.businessType as BusinessType | undefined) ?? existing.businessType;
  const businessTypeCustom =
    parsed.businessTypeCustom !== undefined
      ? parsed.businessTypeCustom
      : parsed.businessType !== undefined && businessType !== "Other"
        ? null
        : existing.businessTypeCustom;
  if (businessType === "Other" && !businessTypeCustom) {
    throw new Error("Custom business type is required when Other is selected.");
  }
  const business: Business = {
    ...existing,
    businessName: parsed.businessName ?? existing.businessName,
    businessType,
    businessTypeCustom,
    ownerName: parsed.ownerName ?? existing.ownerName,
    barangay: locationChanged ? locationRef.formattedAddress : existing.barangay,
    locationRef,
    contactNumber: parsed.contactNumber === undefined ? existing.contactNumber : parsed.contactNumber,
    notes: parsed.notes === undefined ? existing.notes : parsed.notes,
    preferredLanguage: parsed.preferredLanguage ?? existing.preferredLanguage,
    currency: parsed.currency ?? existing.currency,
    updatedAt,
    syncStatus: "local",
  };

  await database.runAsync(
    `
      UPDATE businesses
      SET business_name = ?, business_type = ?, business_type_custom = ?,
        owner_name = ?, barangay = ?,
        location_ref_json = CASE WHEN ? = 1 THEN ? ELSE location_ref_json END,
        contact_number = ?, notes = ?, preferred_language = ?, currency = ?,
        updated_at = ?, sync_status = ?
      WHERE id = ? AND deleted_at IS NULL
    `,
    [
      business.businessName,
      business.businessType,
      business.businessTypeCustom,
      business.ownerName,
      business.barangay,
      locationChanged ? 1 : 0,
      locationChanged ? serializeLocationRef(business.locationRef) : null,
      business.contactNumber,
      business.notes,
      business.preferredLanguage,
      business.currency,
      business.updatedAt,
      business.syncStatus,
      business.id,
    ],
  );

  return business;
}

export async function getBusinessById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<BusinessRow>("SELECT * FROM businesses WHERE id = ? AND deleted_at IS NULL", [id]);
  return row ? mapBusiness(row) : null;
}

export async function listBusinesses(db?: RepositoryDatabase) {
  const rows = await getRepositoryDatabase(db).getAllAsync<BusinessRow>(
    "SELECT * FROM businesses WHERE deleted_at IS NULL ORDER BY created_at ASC",
  );
  return rows.map(mapBusiness);
}

export async function countBusinesses(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM businesses WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
