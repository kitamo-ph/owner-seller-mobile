import type { SQLiteDatabase } from "expo-sqlite";

import { openKitamoDatabase } from "@/db/client";

import { initialSchemaMigration } from "./001_initial_schema";
import { ownerSetupFieldsMigration } from "./002_owner_setup_fields";
import { ownerAlertFieldsMigration } from "./003_owner_alert_fields";
import { groceryPoolMigration } from "./004_grocery_pool";
import { recipesMigration } from "./005_recipes";
import { productionMigration } from "./006_production";
import { sellingCogsMigration } from "./007_selling_cogs";
import { fixedCostsMigration } from "./008_fixed_costs";
import { checkoutIdempotencyMigration } from "./009_checkout_idempotency";
import { problemReportsMigration } from "./010_problem_reports";

export type Migration = {
  id: string;
  up: string;
};

const migrations: Migration[] = [
  initialSchemaMigration,
  ownerSetupFieldsMigration,
  ownerAlertFieldsMigration,
  groceryPoolMigration,
  recipesMigration,
  productionMigration,
  sellingCogsMigration,
  fixedCostsMigration,
  checkoutIdempotencyMigration,
  problemReportsMigration,
];

type MigrationRow = {
  id: string;
  applied_at: string;
};

type MigrationResult = {
  appliedMigrationIds: string[];
  newlyAppliedMigrationIds: string[];
};

const migrationQueues = new WeakMap<SQLiteDatabase, Promise<void>>();

async function ensureMigrationTable(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export async function getAppliedMigrations(db = openKitamoDatabase()) {
  await ensureMigrationTable(db);
  return db.getAllAsync<MigrationRow>("SELECT id, applied_at FROM schema_migrations ORDER BY id ASC");
}

async function runMigrationsNow(db: SQLiteDatabase): Promise<MigrationResult> {
  await ensureMigrationTable(db);

  const appliedRows = await getAppliedMigrations(db);
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migration.up);
      await txn.runAsync("INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
        migration.id,
        new Date().toISOString(),
      ]);
    });

    newlyApplied.push(migration.id);
  }

  return {
    appliedMigrationIds: [...appliedIds, ...newlyApplied],
    newlyAppliedMigrationIds: newlyApplied,
  };
}

export function runMigrations(db = openKitamoDatabase()): Promise<MigrationResult> {
  const previous = migrationQueues.get(db) ?? Promise.resolve();
  const operation = previous.then(
    () => runMigrationsNow(db),
    () => runMigrationsNow(db),
  );

  // Keep concurrent startup consumers from entering overlapping transactions.
  migrationQueues.set(
    db,
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );

  return operation;
}
