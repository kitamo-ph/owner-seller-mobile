import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  archiveCatalogItem,
  evaluateCatalogItemPermanentDelete,
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

/**
 * Eligibility only. Permanent deletion is intentionally not exposed in Phase
 * B; the later owner workflow must re-run this check and delete atomically.
 */
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
