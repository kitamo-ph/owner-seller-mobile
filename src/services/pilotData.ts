import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  clearLocalPilotData as clearLocalPilotDataRepository,
  createBranch,
  createBusiness,
  createInventoryMovement,
  createProduct,
  getBooleanAppSetting,
  getLocalDataCounts,
  setAppSetting,
  setBooleanAppSetting,
  type RepositoryDatabase,
} from "@/db/repositories";
import type { Branch, Business, Product } from "@/domain/types";

import { clearOwnerAccess } from "./ownerAccess";

export async function seedDemoData(db: RepositoryDatabase = openKitamoDatabase()) {
  await runMigrations(db);

  const alreadySeeded = await getBooleanAppSetting("hasSeededDemoData", db);
  if (alreadySeeded) {
    return {
      seeded: false,
      reason: "Demo data was already seeded on this local database.",
      counts: await getLocalDataCounts(db),
    };
  }

  let business: Business | null = null;
  let branch: Branch | null = null;
  const products: Product[] = [];

  await db.withExclusiveTransactionAsync(async (txn) => {
    business = await createBusiness(
      {
        businessName: "KitaMo Demo Stall",
        businessType: "kiosk",
        ownerName: "Demo Seller",
        barangay: "Demo Barangay",
        contactNumber: null,
        preferredLanguage: "Taglish",
      },
      txn,
    );

    branch = await createBranch(
      {
        businessId: business.id,
        branchName: "Night Bazaar Booth",
        location: "Demo Night Market",
        branchType: "stall",
      },
      txn,
    );

    products.push(
      await createProduct(
        {
          businessId: business.id,
          branchId: branch.id,
          name: "Coke Mismo",
          category: "Drinks",
          price: 25,
          cost: 18,
          stockQty: 12,
          unitType: "bottle",
          lowStockThreshold: 6,
          productType: "retail item",
        },
        txn,
      ),
      await createProduct(
        {
          businessId: business.id,
          branchId: branch.id,
          name: "Adobo Rice Meal",
          category: "Rice meals",
          price: 85,
          cost: 48,
          stockQty: 10,
          unitType: "serving",
          lowStockThreshold: 4,
          productType: "cooked food",
        },
        txn,
      ),
      await createProduct(
        {
          businessId: business.id,
          branchId: branch.id,
          name: "Sushi Roll",
          category: "Night bazaar",
          price: 20,
          cost: 11,
          stockQty: 40,
          unitType: "piece",
          lowStockThreshold: 12,
          bundleQuantity: 8,
          bundlePrice: 150,
          bundleLabel: "8 for PHP 150",
          productType: "cooked food",
        },
        txn,
      ),
    );

    for (const product of products) {
      await createInventoryMovement(
        {
          businessId: business.id,
          branchId: branch.id,
          productId: product.id,
          movementType: "stock_in",
          quantity: product.stockQty,
          reason: "Demo opening stock",
          unitCost: product.cost,
          totalCost: product.cost * product.stockQty,
        },
        txn,
      );
    }

    await setAppSetting("activeBusinessId", business.id, "string", txn);
    await setAppSetting("activeBranchId", branch.id, "string", txn);
    await setBooleanAppSetting("hasSeededDemoData", true, txn);
  });

  if (!business || !branch) {
    throw new Error("Demo data was not created.");
  }

  return {
    seeded: true,
    business,
    branch,
    products,
    counts: await getLocalDataCounts(db),
  };
}

export async function clearLocalPilotData(db: RepositoryDatabase = openKitamoDatabase()) {
  await runMigrations(db);
  await clearOwnerAccess();
  return clearLocalPilotDataRepository(db);
}

export function describePilotDataBoundary() {
  return "Fresh mode starts empty. Demo data is only inserted when seedDemoData() is called explicitly.";
}
