import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  createBranch,
  createBusiness,
  getAppSetting,
  getBusinessById,
  listBranchesForBusiness,
  listBusinesses,
  setAppSetting,
  setBooleanAppSetting,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  inheritLocationRef,
  normalizeLocationRef,
  resolveGuidedSetupDestination,
  validateBusinessSetup,
  validateStallSetup,
  type BusinessSetupValidation,
  type BusinessSetupValues,
  type GuidedSetupDestination,
  type GuidedSetupRole,
  type LocationRef,
  type SellerConnectionState,
  type StallSetupValidation,
  type StallSetupValues,
} from "@/domain/onboarding";
import type { Branch, Business } from "@/domain/types";

import { loadOwnerSetupStatus, type OwnerSetupStatus } from "./ownerSetup";

const SETUP_PERSON_NAME_KEY = "setupPersonName" as const;
const SETUP_ROLE_KEY = "setupRole" as const;
const SELLER_CONNECTION_STATE_KEY = "sellerConnectionState" as const;

function activeBranchSettingKey(businessId: string) {
  return `activeBranchId:${businessId}` as const;
}

export type GuidedSetupStatus = {
  destination: GuidedSetupDestination;
  /** Compact routing category retained for callers that do not render steps. */
  appDestination: "owner" | "owner-stall" | "name" | "seller-limited";
  personName: string;
  role: GuidedSetupRole | null;
  sellerConnectionState: SellerConnectionState;
  existingBusiness: Business | null;
  firstRunComplete: boolean;
  businessCount: number;
  stallCount: number;
  ownerStatus: OwnerSetupStatus;
};

export type GuidedBusinessInput = BusinessSetupValues & {
  contactNumber?: string | null;
  notes?: string | null;
};

export type GuidedStallInput = Omit<StallSetupValues, "businessId"> & {
  inheritsBusinessLocation: boolean;
  branchType?: Branch["branchType"];
  notes?: string | null;
};

export type OwnerGuidedSetupInput = {
  personName: string;
  business: GuidedBusinessInput;
  stall: GuidedStallInput;
};

export type ExistingOwnerFirstStallInput = {
  existingBusinessId: string;
  personName?: string;
  stall: GuidedStallInput;
};

export type CreateGuidedBusinessInput = GuidedBusinessInput & {
  personName?: string;
};

export type CreateGuidedStallInput = GuidedStallInput & {
  businessId: string;
  /** Selection is opt-in so ordinary Add Stall does not silently change context. */
  makeActive?: boolean;
};

export class GuidedSetupValidationError extends Error {
  readonly form: "person" | "business" | "stall";
  readonly fieldErrors: Partial<Record<string, string>>;

  constructor(form: "person" | "business" | "stall", summary: string, fieldErrors: Partial<Record<string, string>>) {
    super(summary);
    this.name = "GuidedSetupValidationError";
    this.form = form;
    this.fieldErrors = fieldErrors;
  }
}

function requirePersonName(value: string) {
  const personName = value.trim();
  if (!personName) {
    throw new GuidedSetupValidationError("person", "Ilagay muna ang pangalan mo.", {
      personName: "Kailangan ang pangalan mo para ma-personalize ang KitaMo.",
    });
  }
  return personName;
}

function requireValidBusiness(values: BusinessSetupValues): BusinessSetupValidation {
  const validation = validateBusinessSetup(values);
  if (!validation.valid) {
    throw new GuidedSetupValidationError(
      "business",
      validation.summary ?? "Kumpletuhin ang mga kailangang field.",
      validation.errors,
    );
  }
  return validation;
}

function requireValidStall(values: StallSetupValues): StallSetupValidation {
  const validation = validateStallSetup(values);
  if (!validation.valid) {
    throw new GuidedSetupValidationError(
      "stall",
      validation.summary ?? "Kumpletuhin ang mga kailangang field.",
      validation.errors,
    );
  }
  return validation;
}

function parseRole(value: string | undefined): GuidedSetupRole | null {
  return value === "owner" || value === "seller" ? value : null;
}

function parseSellerConnectionState(value: string | undefined): SellerConnectionState {
  return value === "unconnected" ? "unconnected" : "not_applicable";
}

async function loadPersistedIdentity(db: RepositoryDatabase) {
  const [personSetting, roleSetting, connectionSetting] = await Promise.all([
    getAppSetting(SETUP_PERSON_NAME_KEY, db),
    getAppSetting(SETUP_ROLE_KEY, db),
    getAppSetting(SELLER_CONNECTION_STATE_KEY, db),
  ]);

  return {
    personName: personSetting?.value.trim() ?? "",
    role: parseRole(roleSetting?.value),
    sellerConnectionState: parseSellerConnectionState(connectionSetting?.value),
  };
}

async function persistIdentity(
  input: {
    personName: string;
    role: GuidedSetupRole;
    sellerConnectionState: SellerConnectionState;
  },
  db: RepositoryDatabase,
) {
  await setAppSetting(SETUP_PERSON_NAME_KEY, input.personName, "string", db);
  await setAppSetting(SETUP_ROLE_KEY, input.role, "string", db);
  await setAppSetting(SELLER_CONNECTION_STATE_KEY, input.sellerConnectionState, "string", db);
}

function resolveDestination(input: {
  personName: string;
  role: GuidedSetupRole | null;
  sellerConnectionState: SellerConnectionState;
  firstRunComplete: boolean;
  businessCount: number;
  stallCount: number;
}): GuidedSetupDestination {
  return resolveGuidedSetupDestination({
    displayName: input.personName,
    role: input.role,
    hasBusiness: input.businessCount > 0,
    hasStall: input.stallCount > 0,
    firstRunComplete: input.firstRunComplete,
    sellerConnectionState: input.sellerConnectionState,
  });
}

function compactDestination(destination: GuidedSetupDestination): GuidedSetupStatus["appDestination"] {
  if (destination === "owner-app") return "owner";
  if (destination === "owner-stall") return "owner-stall";
  if (destination === "seller-limited") return "seller-limited";
  return "name";
}

export async function loadGuidedSetupStatus(
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<GuidedSetupStatus> {
  await runMigrations(db);
  const [identity, ownerStatus] = await Promise.all([
    loadPersistedIdentity(db),
    loadOwnerSetupStatus(db),
  ]);
  const businesses = ownerStatus.businesses;
  const branchGroups = await Promise.all(businesses.map((business) => listBranchesForBusiness(business.id, db)));
  const stallCount = branchGroups.reduce((total, branches) => total + branches.length, 0);
  const existingBusiness = ownerStatus.activeBusiness ?? businesses[0] ?? null;
  const personName = identity.personName || existingBusiness?.ownerName.trim() || "";
  // Existing business records are authoritative legacy-owner evidence. A stale
  // or partial role setting must never hide them behind Seller onboarding.
  const role = existingBusiness ? "owner" : identity.role;
  const sellerConnectionState = role === "seller" ? identity.sellerConnectionState : "not_applicable";
  const destination = resolveDestination({
    personName,
    role,
    sellerConnectionState,
    firstRunComplete: ownerStatus.firstRunComplete,
    businessCount: businesses.length,
    stallCount,
  });

  return {
    destination,
    appDestination: compactDestination(destination),
    personName,
    role,
    sellerConnectionState,
    existingBusiness,
    firstRunComplete: ownerStatus.firstRunComplete,
    businessCount: businesses.length,
    stallCount,
    ownerStatus,
  };
}

export async function saveGuidedPerson(
  personNameInput: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const personName = requirePersonName(personNameInput);
  await setAppSetting(SETUP_PERSON_NAME_KEY, personName, "string", db);
  return personName;
}

export async function saveGuidedRole(
  role: GuidedSetupRole,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  if (role !== "owner" && role !== "seller") {
    throw new GuidedSetupValidationError("person", "Pumili kung Owner o Seller / Empleyado ka.", {
      role: "Kailangan pumili ng role bago magpatuloy.",
    });
  }
  await db.withExclusiveTransactionAsync(async (txn) => {
    await setAppSetting(SETUP_ROLE_KEY, role, "string", txn);
    await setAppSetting(
      SELLER_CONNECTION_STATE_KEY,
      "not_applicable",
      "string",
      txn,
    );
  });
  return role;
}

function effectiveStallLocation(stall: GuidedStallInput, businessLocation: LocationRef | null) {
  if (stall.inheritsBusinessLocation) {
    return businessLocation;
  }
  return stall.locationRef;
}

function normalizedBusinessValues(input: GuidedBusinessInput): BusinessSetupValues {
  return {
    businessName: input.businessName.trim(),
    businessType: input.businessType,
    businessTypeCustom: input.businessTypeCustom?.trim() || null,
    // Validate the raw provider/form value first so malformed runtime input is
    // reported as a form error instead of leaking a low-level Zod exception.
    locationRef: input.locationRef,
  };
}

function normalizedStallValues(
  input: GuidedStallInput,
  businessId: string,
  businessLocation: LocationRef | null,
): StallSetupValues {
  return {
    stallName: input.stallName.trim(),
    businessId,
    locationRef: effectiveStallLocation(input, businessLocation),
  };
}

export async function completeOwnerGuidedSetup(
  input: OwnerGuidedSetupInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const personName = requirePersonName(input.personName);
  const businessValues = normalizedBusinessValues(input.business);
  requireValidBusiness(businessValues);
  const businessLocation = normalizeLocationRef(businessValues.locationRef as LocationRef);
  const provisionalBusinessId = "pending-owner-business";
  const stallValues = normalizedStallValues(input.stall, provisionalBusinessId, businessLocation);
  requireValidStall(stallValues);

  let business: Business | null = null;
  let stall: Branch | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    if ((await listBusinesses(txn)).length > 0) {
      throw new Error("Owner setup already has a business. Resume the existing setup instead.");
    }
    business = await createBusiness(
      {
        businessName: businessValues.businessName,
        businessType: businessValues.businessType as string,
        businessTypeCustom: businessValues.businessTypeCustom ?? null,
        ownerName: personName,
        barangay: businessLocation.formattedAddress,
        locationRef: businessLocation,
        contactNumber: input.business.contactNumber?.trim() || null,
        notes: input.business.notes?.trim() || null,
        preferredLanguage: "Taglish",
      },
      txn,
    );
    const createdBusiness = business as Business;
    const stallLocation = input.stall.inheritsBusinessLocation
      ? inheritLocationRef(businessLocation)
      : normalizeLocationRef(stallValues.locationRef as LocationRef);
    stall = await createBranch(
      {
        businessId: createdBusiness.id,
        branchName: stallValues.stallName,
        location: stallLocation.formattedAddress,
        locationRef: stallLocation,
        inheritsBusinessLocation: input.stall.inheritsBusinessLocation,
        branchType: input.stall.branchType ?? "stall",
        active: true,
        notes: input.stall.notes?.trim() || null,
      },
      txn,
    );
    const createdStall = stall as Branch;

    await setAppSetting("activeBusinessId", createdBusiness.id, "string", txn);
    await setAppSetting("activeBranchId", createdStall.id, "string", txn);
    await setAppSetting(activeBranchSettingKey(createdBusiness.id), createdStall.id, "string", txn);
    await persistIdentity(
      { personName, role: "owner", sellerConnectionState: "not_applicable" },
      txn,
    );
    await setBooleanAppSetting("hasSeededDemoData", false, txn);
    await setBooleanAppSetting("hasCompletedFirstRun", true, txn);
  });

  if (!business || !stall) throw new Error("Owner setup was not created.");
  return { business, stall, status: await loadGuidedSetupStatus(db) };
}

export async function completeExistingOwnerFirstStall(
  input: ExistingOwnerFirstStallInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const business = await getBusinessById(input.existingBusinessId, db);
  if (!business) throw new Error("Business not found.");
  const identity = await loadPersistedIdentity(db);
  const personName = requirePersonName(input.personName?.trim() || identity.personName || business.ownerName);
  const stallValues = normalizedStallValues(input.stall, business.id, business.locationRef);
  requireValidStall(stallValues);

  let stall: Branch | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const existingBranches = await listBranchesForBusiness(business.id, txn);
    if (existingBranches.length > 0) {
      throw new Error("This business already has a stall. Open Owner mode to manage it.");
    }
    const stallLocation = input.stall.inheritsBusinessLocation
      ? inheritLocationRef(business.locationRef)
      : normalizeLocationRef(stallValues.locationRef as LocationRef);
    stall = await createBranch(
      {
        businessId: business.id,
        branchName: stallValues.stallName,
        location: stallLocation.formattedAddress,
        locationRef: stallLocation,
        inheritsBusinessLocation: input.stall.inheritsBusinessLocation,
        branchType: input.stall.branchType ?? "stall",
        active: true,
        notes: input.stall.notes?.trim() || null,
      },
      txn,
    );
    const createdStall = stall as Branch;
    await setAppSetting("activeBusinessId", business.id, "string", txn);
    await setAppSetting("activeBranchId", createdStall.id, "string", txn);
    await setAppSetting(activeBranchSettingKey(business.id), createdStall.id, "string", txn);
    await persistIdentity(
      { personName, role: "owner", sellerConnectionState: "not_applicable" },
      txn,
    );
    await setBooleanAppSetting("hasSeededDemoData", false, txn);
    await setBooleanAppSetting("hasCompletedFirstRun", true, txn);
  });

  if (!stall) throw new Error("The first stall was not created.");
  return { business, stall, status: await loadGuidedSetupStatus(db) };
}

export async function completeSellerLimitedSetup(
  input: { personName: string },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const personName = requirePersonName(input.personName);
  const existingBusinesses = await listBusinesses(db);
  if (existingBusinesses.length > 0) {
    throw new Error("Existing Owner businesses cannot be replaced by a limited Seller setup.");
  }

  await db.withExclusiveTransactionAsync(async (txn) => {
    await persistIdentity(
      { personName, role: "seller", sellerConnectionState: "unconnected" },
      txn,
    );
    await setBooleanAppSetting("hasSeededDemoData", false, txn);
    await setBooleanAppSetting("hasCompletedFirstRun", true, txn);
  });
  return loadGuidedSetupStatus(db);
}

export type SellerCodeJoinResult =
  | { ok: false; code: "missing_code"; message: string }
  | { ok: false; code: "unsupported_local_only"; normalizedCode: string; message: string };

/** No database or network write is permitted until a real enrollment service exists. */
export async function attemptSellerCodeJoin(codeInput: string): Promise<SellerCodeJoinResult> {
  const normalizedCode = codeInput.trim().toUpperCase();
  if (!normalizedCode) {
    return { ok: false, code: "missing_code", message: "Ilagay ang Owner / Stall code." };
  }
  return {
    ok: false,
    code: "unsupported_local_only",
    normalizedCode,
    message:
      "Hindi pa kayang kumonekta ng build na ito sa stall sa ibang phone. Walang data na ipinadala o stall na sinalihan.",
  };
}

export async function createGuidedBusiness(
  input: CreateGuidedBusinessInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const [identity, existingBusinesses, previousOwnerStatus] = await Promise.all([
    loadPersistedIdentity(db),
    listBusinesses(db),
    loadOwnerSetupStatus(db),
  ]);
  const personName = requirePersonName(
    input.personName?.trim() || identity.personName || existingBusinesses[0]?.ownerName || "",
  );
  const values = normalizedBusinessValues(input);
  requireValidBusiness(values);
  const locationRef = normalizeLocationRef(values.locationRef as LocationRef);

  let business: Business | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    business = await createBusiness(
      {
        businessName: values.businessName,
        businessType: values.businessType as string,
        businessTypeCustom: values.businessTypeCustom ?? null,
        ownerName: personName,
        barangay: locationRef.formattedAddress,
        locationRef,
        contactNumber: input.contactNumber?.trim() || null,
        notes: input.notes?.trim() || null,
        preferredLanguage: "Taglish",
      },
      txn,
    );
    const createdBusiness = business as Business;
    if (previousOwnerStatus.activeBusiness && previousOwnerStatus.activeBranch) {
      await setAppSetting(
        activeBranchSettingKey(previousOwnerStatus.activeBusiness.id),
        previousOwnerStatus.activeBranch.id,
        "string",
        txn,
      );
    }
    await setAppSetting("activeBusinessId", createdBusiness.id, "string", txn);
    await setAppSetting("activeBranchId", "", "string", txn);
    await setAppSetting(activeBranchSettingKey(createdBusiness.id), "", "string", txn);
    await persistIdentity(
      { personName, role: "owner", sellerConnectionState: "not_applicable" },
      txn,
    );
  });

  if (!business) throw new Error("Business was not created.");
  return { business, status: await loadGuidedSetupStatus(db) };
}

export async function createGuidedStall(
  input: CreateGuidedStallInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const business = await getBusinessById(input.businessId, db);
  if (!business) throw new Error("Choose a valid business before adding a stall.");
  const values = normalizedStallValues(input, business.id, business.locationRef);
  requireValidStall(values);
  const locationRef = input.inheritsBusinessLocation
    ? inheritLocationRef(business.locationRef)
    : normalizeLocationRef(values.locationRef as LocationRef);

  let stall: Branch | null = null;
  await db.withExclusiveTransactionAsync(async (txn) => {
    stall = await createBranch(
      {
        businessId: business.id,
        branchName: values.stallName,
        location: locationRef.formattedAddress,
        locationRef,
        inheritsBusinessLocation: input.inheritsBusinessLocation,
        branchType: input.branchType ?? "stall",
        active: true,
        notes: input.notes?.trim() || null,
      },
      txn,
    );
    if (input.makeActive) {
      const createdStall = stall as Branch;
      await setAppSetting("activeBusinessId", business.id, "string", txn);
      await setAppSetting("activeBranchId", createdStall.id, "string", txn);
      await setAppSetting(activeBranchSettingKey(business.id), createdStall.id, "string", txn);
    }
  });

  if (!stall) throw new Error("Stall was not created.");
  return { business, stall, status: await loadGuidedSetupStatus(db) };
}
