import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  abandonUnusedRecipeDraft,
  beginNestedRecipeDraft,
  createRecipeDraft,
  listResumableRecipeDrafts,
  resolvePublishedNestedDraft,
  saveRecipeDraft,
  type BeginNestedRecipeDraftInput,
  type CreateRecipeDraftInput,
  type RepositoryDatabase,
  type SaveRecipeDraftInput,
} from "@/db/repositories";

export async function createPersistentRecipeDraft(
  input: CreateRecipeDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return createRecipeDraft(input, db);
}

export async function beginPersistentNestedRecipeDraft(
  input: BeginNestedRecipeDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return beginNestedRecipeDraft(input, db);
}

export async function savePersistentRecipeDraft(
  input: SaveRecipeDraftInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return saveRecipeDraft(input, db);
}

export async function loadResumableRecipeDrafts(
  businessId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return listResumableRecipeDrafts(businessId, db);
}

export async function discardPersistentRecipeDraft(
  input: {
    draftId: string;
    businessId: string;
    expectedRevision: number;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  return abandonUnusedRecipeDraft(input, db);
}

export async function completeNestedRecipeDraftReturn(
  childDraftId: string,
  publishedVersionId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  await resolvePublishedNestedDraft(childDraftId, publishedVersionId, db);
}
