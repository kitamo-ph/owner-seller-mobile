import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  archiveCatalogItem,
  evaluateCatalogItemPermanentDelete,
  listCatalogItemForSale,
  permanentlyDeleteCatalogItem,
  restoreArchivedCatalogItem,
  unlistCatalogItemFromSale,
  type RepositoryDatabase,
} from "@/db/repositories";

export async function archiveInventoryCatalogItem(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  await archiveCatalogItem(catalogItemId, ownerAuthorized, db);
}

export async function inspectPermanentDeleteEligibility(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return evaluateCatalogItemPermanentDelete(
    catalogItemId,
    ownerAuthorized,
    db,
  );
}

export async function permanentlyDeleteInventoryCatalogItem(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return permanentlyDeleteCatalogItem(catalogItemId, ownerAuthorized, db);
}

/**
 * Puts a ready item on sale: the transition that completes
 * Recipe publication and makes an item Kiosk-eligible.
 */
export async function listInventoryCatalogItemForSale(
  input: {
    catalogItemId: string;
    ownerAuthorized: boolean;
    sellingPrice: number | null;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return listCatalogItemForSale(input, db);
}

/** Takes an item off sale without touching history, stock, or its Recipe. */
export async function unlistInventoryCatalogItemFromSale(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return unlistCatalogItemFromSale({ catalogItemId, ownerAuthorized }, db);
}

/** Returns an archived item to `ready`; listing stays an explicit later act. */
export async function restoreArchivedInventoryCatalogItem(
  catalogItemId: string,
  ownerAuthorized: boolean,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return restoreArchivedCatalogItem({ catalogItemId, ownerAuthorized }, db);
}
