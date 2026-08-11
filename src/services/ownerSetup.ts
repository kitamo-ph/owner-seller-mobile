import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import type { LocalDataCounts } from "@/db/schema";
import {
  getAppSetting,
  getBooleanAppSetting,
  getLocalDataCounts,
  listBranchesForBusiness,
  listBusinesses,
  listProductsForBusiness,
  setAppSetting,
  setBooleanAppSetting,
  type RepositoryDatabase,
} from "@/db/repositories";
import { resolveStoredBranch, resolveStoredBusiness } from "@/domain/ownerContext";
import type { Branch, Business, Product } from "@/domain/types";

import { seedDemoData } from "./pilotData";

export type OwnerSetupMode = "fresh" | "demo";

export type OwnerSetupStatus = {
  dbReady: boolean;
  firstRunComplete: boolean;
  mode: OwnerSetupMode;
  activeBusiness: Business | null;
  activeBranch: Branch | null;
  businesses: Business[];
  branches: Branch[];
  products: Product[];
  counts: LocalDataCounts;
  productCount: number;
  stallCount: number;
  pendingQueueCount: number;
  appliedMigrationIds: string[];
  newlyAppliedMigrationIds: string[];
};

type PendingQueueRow = {
  count: number;
};

async function countPendingQueue(db: RepositoryDatabase) {
  const row = await db.getFirstAsync<PendingQueueRow>(
    "SELECT COUNT(*) AS count FROM offline_queue WHERE status = 'pending' AND deleted_at IS NULL",
  );
  return row?.count ?? 0;
}

export async function completeFreshFirstRun(db: RepositoryDatabase = openKitamoDatabase()) {
  await runMigrations(db);
  await setBooleanAppSetting("hasSeededDemoData", false, db);
  await setBooleanAppSetting("hasCompletedFirstRun", true, db);
}

export async function completeDemoFirstRun(db: RepositoryDatabase = openKitamoDatabase()) {
  await runMigrations(db);
  await seedDemoData(db);
  const activeBusinessSetting = await getAppSetting("activeBusinessId", db);
  const businesses = await listBusinesses(db);
  const demoBusiness =
    resolveStoredBusiness(businesses, activeBusinessSetting?.value) ?? businesses[0] ?? null;

  await db.withExclusiveTransactionAsync(async (txn) => {
    await setAppSetting("setupPersonName", demoBusiness?.ownerName.trim() || "Demo Seller", "string", txn);
    await setAppSetting("setupRole", "owner", "string", txn);
    await setAppSetting("sellerConnectionState", "not_applicable", "string", txn);
    await setBooleanAppSetting("hasCompletedFirstRun", true, txn);
  });
}

function activeBranchSettingKey(businessId: string) {
  return `activeBranchId:${businessId}` as const;
}

export async function switchActiveBusinessContext(
  businessId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const businesses = await listBusinesses(db);
  const business = resolveStoredBusiness(businesses, businessId);
  if (!business) {
    throw new Error("Business not found.");
  }

  const currentBusinessSetting = await getAppSetting("activeBusinessId", db);
  const currentBusiness = resolveStoredBusiness(businesses, currentBusinessSetting?.value);
  const legacySetting = await getAppSetting("activeBranchId", db);
  const currentBranches = currentBusiness ? await listBranchesForBusiness(currentBusiness.id, db) : [];
  const currentBranch = currentBusiness
    ? resolveStoredBranch(currentBranches, currentBusiness.id, legacySetting?.value)
    : null;
  const branches = await listBranchesForBusiness(business.id, db);
  const rememberedSetting = await getAppSetting(activeBranchSettingKey(business.id), db);
  const rememberedBranch = resolveStoredBranch(
    branches,
    business.id,
    rememberedSetting?.value ?? legacySetting?.value ?? null,
  );

  await db.withExclusiveTransactionAsync(async (txn) => {
    if (currentBusiness && currentBranch) {
      await setAppSetting(activeBranchSettingKey(currentBusiness.id), currentBranch.id, "string", txn);
    }
    await setAppSetting("activeBusinessId", business.id, "string", txn);
    await setAppSetting("activeBranchId", rememberedBranch?.id ?? "", "string", txn);
    if (rememberedBranch) {
      await setAppSetting(activeBranchSettingKey(business.id), rememberedBranch.id, "string", txn);
    }
  });

  return loadOwnerSetupStatus(db);
}

export async function switchActiveBranchContext(
  branchId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const activeBusinessSetting = await getAppSetting("activeBusinessId", db);
  const businesses = await listBusinesses(db);
  const activeBusiness = resolveStoredBusiness(businesses, activeBusinessSetting?.value);
  if (!activeBusiness) {
    throw new Error("Choose a valid business first.");
  }

  const branches = await listBranchesForBusiness(activeBusiness.id, db);
  const branch = resolveStoredBranch(branches, activeBusiness.id, branchId);
  if (!branch) {
    throw new Error("Choose an active stall from this business.");
  }

  await db.withExclusiveTransactionAsync(async (txn) => {
    await setAppSetting("activeBranchId", branch.id, "string", txn);
    await setAppSetting(activeBranchSettingKey(activeBusiness.id), branch.id, "string", txn);
  });

  return loadOwnerSetupStatus(db);
}

export async function clearActiveBranchContext(
  businessId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const activeBusinessSetting = await getAppSetting("activeBusinessId", db);
  if (activeBusinessSetting?.value !== businessId) {
    return loadOwnerSetupStatus(db);
  }

  await db.withExclusiveTransactionAsync(async (txn) => {
    await setAppSetting("activeBranchId", "", "string", txn);
    await setAppSetting(activeBranchSettingKey(businessId), "", "string", txn);
  });

  return loadOwnerSetupStatus(db);
}

export async function setActiveBusiness(businessId: string, db: RepositoryDatabase = openKitamoDatabase()) {
  return switchActiveBusinessContext(businessId, db);
}

export async function setActiveBranch(branchId: string, db: RepositoryDatabase = openKitamoDatabase()) {
  return switchActiveBranchContext(branchId, db);
}

export async function loadOwnerSetupStatus(db: RepositoryDatabase = openKitamoDatabase()): Promise<OwnerSetupStatus> {
  const migrationResult = await runMigrations(db);
  const firstRunComplete = await getBooleanAppSetting("hasCompletedFirstRun", db);
  const hasSeededDemoData = await getBooleanAppSetting("hasSeededDemoData", db);
  const activeBusinessSetting = await getAppSetting("activeBusinessId", db);
  const activeBranchSetting = await getAppSetting("activeBranchId", db);
  const businesses = await listBusinesses(db);
  const counts = await getLocalDataCounts(db);
  const pendingQueueCount = await countPendingQueue(db);

  const activeBusiness = resolveStoredBusiness(businesses, activeBusinessSetting?.value);
  const branches = activeBusiness ? await listBranchesForBusiness(activeBusiness.id, db) : [];
  const products = activeBusiness ? await listProductsForBusiness(activeBusiness.id, db) : [];
  const rememberedBranchSetting = activeBusiness
    ? await getAppSetting(activeBranchSettingKey(activeBusiness.id), db)
    : null;
  const activeBranch = activeBusiness
    ? resolveStoredBranch(
        branches,
        activeBusiness.id,
        rememberedBranchSetting?.value ?? activeBranchSetting?.value ?? null,
      )
    : null;

  return {
    dbReady: true,
    firstRunComplete,
    mode: hasSeededDemoData ? "demo" : "fresh",
    activeBusiness,
    activeBranch,
    businesses,
    branches,
    products,
    counts,
    productCount: products.length,
    stallCount: branches.length,
    pendingQueueCount,
    appliedMigrationIds: migrationResult.appliedMigrationIds,
    newlyAppliedMigrationIds: migrationResult.newlyAppliedMigrationIds,
  };
}
