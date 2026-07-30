const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const compiledDir = path.join(process.cwd(), "node_modules/.cache/kitamo-migration-check");
const migrationModules = [
  ["001_initial_schema.js", "initialSchemaMigration"],
  ["002_owner_setup_fields.js", "ownerSetupFieldsMigration"],
  ["003_owner_alert_fields.js", "ownerAlertFieldsMigration"],
  ["004_grocery_pool.js", "groceryPoolMigration"],
  ["005_recipes.js", "recipesMigration"],
  ["006_production.js", "productionMigration"],
  ["007_selling_cogs.js", "sellingCogsMigration"],
  ["008_fixed_costs.js", "fixedCostsMigration"],
  ["009_checkout_idempotency.js", "checkoutIdempotencyMigration"],
  ["010_problem_reports.js", "problemReportsMigration"],
];
const migrations = migrationModules.map(([file, exportName]) => require(path.join(compiledDir, file))[exportName]);
const dbPath = path.join(os.tmpdir(), `kitamo-migrations-${process.pid}-${Date.now()}.sqlite`);

function sql(statement, json = false) {
  const args = json ? ["-json", dbPath, statement] : [dbPath, statement];
  return execFileSync("sqlite3", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function applyMigrations() {
  sql("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);");
  let applied = 0;
  for (const migration of migrations) {
    const exists = sql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${migration.id}';`) === "1";
    if (exists) {
      continue;
    }
    sql(`BEGIN EXCLUSIVE; ${migration.up} INSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', datetime('now')); COMMIT;`);
    applied += 1;
  }
  return applied;
}

try {
  const firstRun = applyMigrations();
  const secondRun = applyMigrations();
  const appliedCount = Number(sql("SELECT COUNT(*) FROM schema_migrations;"));
  const salesColumns = JSON.parse(sql("PRAGMA table_info(sales);", true));
  const hasCheckoutToken = salesColumns.some((column) => column.name === "checkout_token");
  const problemReportColumns = JSON.parse(sql("PRAGMA table_info(problem_reports);", true));
  const hasProblemReports = problemReportColumns.some((column) => column.name === "diagnostics_json");

  const saleColumns = "id, business_id, transaction_no, happened_at, amount, discount, payment_method, payment_status, created_at, updated_at, sync_status, deleted_at, checkout_token";
  const saleValues = "'sale_1', 'business_1', 'KTM-1', datetime('now'), 100, 0, 'cash', 'paid', datetime('now'), datetime('now'), 'local', NULL, 'checkout_1'";
  sql(`INSERT INTO sales (${saleColumns}) VALUES (${saleValues});`);

  let duplicateRejected = false;
  try {
    sql(`INSERT INTO sales (${saleColumns}) VALUES ('sale_2', 'business_1', 'KTM-2', datetime('now'), 100, 0, 'cash', 'paid', datetime('now'), datetime('now'), 'local', NULL, 'checkout_1');`);
  } catch {
    duplicateRejected = true;
  }

  const saleCount = Number(sql("SELECT COUNT(*) FROM sales WHERE checkout_token = 'checkout_1';"));
  const ok =
    firstRun === migrations.length &&
    secondRun === 0 &&
    appliedCount === migrations.length &&
    hasCheckoutToken &&
    hasProblemReports &&
    duplicateRejected &&
    saleCount === 1;

  console.log(`first migration run: ${firstRun} applied`);
  console.log(`second migration run: ${secondRun} applied`);
  console.log(`checkout_token column: ${hasCheckoutToken ? "present" : "missing"}`);
  console.log(`problem_reports table: ${hasProblemReports ? "present" : "missing"}`);
  console.log(`duplicate checkout token: ${duplicateRejected ? "rejected" : "accepted"}`);
  console.log(`sales with checkout_1: ${saleCount}`);

  if (!ok) {
    throw new Error("Migration regression failed.");
  }
  console.log("ALL MIGRATION CHECKS PASSED");
} finally {
  fs.rmSync(dbPath, { force: true });
}
