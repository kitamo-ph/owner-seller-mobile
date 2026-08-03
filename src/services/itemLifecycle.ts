import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  archiveCatalogItem,
  evaluateCatalogItemPermanentDelete,
  permanentlyDeleteCatalogItem,
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
