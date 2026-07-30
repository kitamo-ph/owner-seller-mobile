import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  createIngredient,
  createIngredientLot,
  createIngredientMovement,
  findIngredientByName,
  getIngredientLotById,
  listIngredientLotsForBusiness,
  listIngredientLotsForIngredient,
  listIngredientsForBusiness,
  listRecipeLinesForBusiness,
  searchIngredientLots,
  setIngredientLotRemainingQuantity,
  updateIngredient,
  type IngredientLotWithName,
  type RepositoryDatabase,
} from "@/db/repositories";
import type { Ingredient, IngredientLot, IngredientUnit } from "@/domain/types";

import { loadOwnerSetupStatus } from "./ownerSetup";

export type AddGroceryPurchaseInput = {
  ingredientName: string;
  brandName?: string | null;
  sourceName?: string | null;
  quantity: number;
  unit: IngredientUnit;
  totalCost: number;
  purchaseDate?: string | null;
  lowStockThreshold?: number | null;
  category?: string | null;
  notes?: string | null;
};

export type AddGroceryPurchaseResult = {
  ingredient: Ingredient;
  lot: IngredientLot;
  costPerUnit: number;
  createdNewIngredient: boolean;
};

export type LowStockIngredientSummary = {
  ingredient: Ingredient;
  remainingInDefaultUnit: number;
};

export type GroceryPoolSnapshot = {
  hasBusiness: boolean;
  ingredientCount: number;
  lotCount: number;
  recentLotCount: number;
  totalRemainingValue: number;
  lowStockIngredients: LowStockIngredientSummary[];
  recipeUsageCountByLot: Record<string, number>;
  lots: IngredientLotWithName[];
};

export type IngredientCostHistoryEntry = {
  lotId: string;
  purchaseDate: string;
  brandName: string | null;
  sourceName: string | null;
  unit: IngredientUnit;
  costPerUnit: number;
  totalCost: number;
  purchasedQuantity: number;
};

/**
 * Converts between trivially compatible units only (kg<->g, L<->ml).
 * Returns null when the conversion needs owner-defined sizing (e.g. pack -> g),
 * which is deferred to the recipe costing phase.
 */
export function convertIngredientQuantity(quantity: number, fromUnit: IngredientUnit, toUnit: IngredientUnit): number | null {
  if (fromUnit === toUnit) {
    return quantity;
  }

  if (fromUnit === "kg" && toUnit === "g") {
    return quantity * 1000;
  }

  if (fromUnit === "g" && toUnit === "kg") {
    return quantity / 1000;
  }

  if (fromUnit === "L" && toUnit === "ml") {
    return quantity * 1000;
  }

  if (fromUnit === "ml" && toUnit === "L") {
    return quantity / 1000;
  }

  return null;
}

function toLocalIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function todayIsoDate() {
  return toLocalIsoDate(new Date());
}

async function requireActiveBusiness(db: RepositoryDatabase) {
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    throw new Error("Create your business profile in Owner Settings first.");
  }
  return status.activeBusiness;
}

export async function addGroceryPurchase(
  input: AddGroceryPurchaseInput,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<AddGroceryPurchaseResult> {
  await runMigrations(db);

  const name = input.ingredientName.trim();
  if (!name) {
    throw new Error("Ingredient name is required.");
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  if (!Number.isFinite(input.totalCost) || input.totalCost <= 0) {
    throw new Error("Total cost must be greater than zero.");
  }

  const business = await requireActiveBusiness(db);
  const existingIngredient = await findIngredientByName(business.id, name, db);
  const purchaseDate = input.purchaseDate?.trim() || todayIsoDate();
  const costPerUnit = input.totalCost / input.quantity;

  let ingredient: Ingredient | null = null;
  let lot: IngredientLot | null = null;

  await db.withExclusiveTransactionAsync(async (txn) => {
    if (existingIngredient) {
      ingredient =
        input.lowStockThreshold !== null && input.lowStockThreshold !== undefined
          ? await updateIngredient(existingIngredient.id, { lowStockThreshold: input.lowStockThreshold }, txn)
          : existingIngredient;
    } else {
      ingredient = await createIngredient(
        {
          businessId: business.id,
          name,
          defaultUnit: input.unit,
          category: input.category?.trim() || "General",
          lowStockThreshold: input.lowStockThreshold ?? 0,
        },
        txn,
      );
    }

    lot = await createIngredientLot(
      {
        businessId: business.id,
        ingredientId: ingredient.id,
        brandName: input.brandName ?? null,
        sourceName: input.sourceName ?? null,
        purchaseDate,
        purchasedQuantity: input.quantity,
        unit: input.unit,
        totalCost: input.totalCost,
        notes: input.notes ?? null,
      },
      txn,
    );

    await createIngredientMovement(
      {
        businessId: business.id,
        ingredientId: ingredient.id,
        lotId: lot.id,
        movementType: "purchase",
        quantity: input.quantity,
        unit: input.unit,
        unitCost: costPerUnit,
        totalCost: input.totalCost,
        reason: [
          "Grocery purchase",
          input.brandName?.trim() ? `- ${input.brandName.trim()}` : null,
          input.sourceName?.trim() ? `(${input.sourceName.trim()})` : null,
        ]
          .filter(Boolean)
          .join(" "),
      },
      txn,
    );
  });

  if (!ingredient || !lot) {
    throw new Error("Could not save the grocery purchase.");
  }

  return {
    ingredient,
    lot,
    costPerUnit,
    createdNewIngredient: !existingIngredient,
  };
}

async function loadGroceryPoolSnapshotInternal(
  db: RepositoryDatabase,
  includeRecipeUsage: boolean,
): Promise<GroceryPoolSnapshot> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);

  if (!status.activeBusiness) {
    return {
      hasBusiness: false,
      ingredientCount: 0,
      lotCount: 0,
      recentLotCount: 0,
      totalRemainingValue: 0,
      lowStockIngredients: [],
      recipeUsageCountByLot: {},
      lots: [],
    };
  }

  const businessId = status.activeBusiness.id;
  const ingredients = await listIngredientsForBusiness(businessId, db);
  const lots = await listIngredientLotsForBusiness(businessId, db);
  const recipeLines = includeRecipeUsage ? await listRecipeLinesForBusiness(businessId, db) : [];
  const visibleLots = lots.filter((lot) => lot.status !== "archived");

  const recipeIdsByLot = new Map<string, Set<string>>();
  for (const line of recipeLines) {
    if (!line.ingredientLotId) {
      continue;
    }

    const recipeIds = recipeIdsByLot.get(line.ingredientLotId) ?? new Set<string>();
    recipeIds.add(line.recipeId);
    recipeIdsByLot.set(line.ingredientLotId, recipeIds);
  }
  const recipeUsageCountByLot = Object.fromEntries(
    [...recipeIdsByLot.entries()].map(([lotId, recipeIds]) => [lotId, recipeIds.size]),
  );

  const totalRemainingValue = visibleLots.reduce((total, lot) => total + lot.remainingQuantity * lot.costPerUnit, 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoIso = toLocalIsoDate(sevenDaysAgo);
  const recentLotCount = visibleLots.filter((lot) => lot.purchaseDate >= sevenDaysAgoIso).length;

  const lowStockIngredients: LowStockIngredientSummary[] = [];
  for (const ingredient of ingredients) {
    if (!ingredient.isActive || ingredient.lowStockThreshold <= 0) {
      continue;
    }

    let remainingInDefaultUnit = 0;
    for (const lot of visibleLots) {
      if (lot.ingredientId !== ingredient.id) {
        continue;
      }

      const converted = convertIngredientQuantity(lot.remainingQuantity, lot.unit, ingredient.defaultUnit);
      if (converted !== null) {
        remainingInDefaultUnit += converted;
      }
    }

    if (remainingInDefaultUnit <= ingredient.lowStockThreshold) {
      lowStockIngredients.push({ ingredient, remainingInDefaultUnit });
    }
  }

  return {
    hasBusiness: true,
    ingredientCount: ingredients.length,
    lotCount: visibleLots.length,
    recentLotCount,
    totalRemainingValue,
    lowStockIngredients,
    recipeUsageCountByLot,
    lots,
  };
}

export async function loadGroceryPoolSnapshot(db: RepositoryDatabase = openKitamoDatabase()): Promise<GroceryPoolSnapshot> {
  return loadGroceryPoolSnapshotInternal(db, false);
}

export async function loadGroceryPoolScreenSnapshot(db: RepositoryDatabase = openKitamoDatabase()): Promise<GroceryPoolSnapshot> {
  return loadGroceryPoolSnapshotInternal(db, true);
}

export async function searchGroceryLots(
  query: string,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<IngredientLotWithName[]> {
  await runMigrations(db);
  const status = await loadOwnerSetupStatus(db);
  if (!status.activeBusiness) {
    return [];
  }

  const trimmed = query.trim();
  if (!trimmed) {
    return listIngredientLotsForBusiness(status.activeBusiness.id, db);
  }

  return searchIngredientLots(status.activeBusiness.id, trimmed, db);
}

export async function getIngredientCostHistory(
  ingredientId: string,
  limit = 10,
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<IngredientCostHistoryEntry[]> {
  await runMigrations(db);
  const lots = await listIngredientLotsForIngredient(ingredientId, limit, db);
  return lots.map((lot) => ({
    lotId: lot.id,
    purchaseDate: lot.purchaseDate,
    brandName: lot.brandName,
    sourceName: lot.sourceName,
    unit: lot.unit,
    costPerUnit: lot.costPerUnit,
    totalCost: lot.totalCost,
    purchasedQuantity: lot.purchasedQuantity,
  }));
}

export async function adjustLotRemainingQuantity(
  lotId: string,
  newRemainingQuantity: number,
  reason = "Manual stock adjustment",
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);

  const lot = await getIngredientLotById(lotId, db);
  if (!lot) {
    throw new Error("Grocery item not found.");
  }

  const delta = newRemainingQuantity - lot.remainingQuantity;

  await db.withExclusiveTransactionAsync(async (txn) => {
    await setIngredientLotRemainingQuantity(lotId, newRemainingQuantity, txn);
    await createIngredientMovement(
      {
        businessId: lot.businessId,
        ingredientId: lot.ingredientId,
        lotId: lot.id,
        movementType: "adjustment",
        quantity: delta,
        unit: lot.unit,
        unitCost: lot.costPerUnit,
        totalCost: lot.costPerUnit * delta,
        reason,
      },
      txn,
    );
  });

  return {
    lotId,
    previousRemainingQuantity: lot.remainingQuantity,
    newRemainingQuantity,
  };
}
