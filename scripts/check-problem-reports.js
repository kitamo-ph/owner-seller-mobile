const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const compiledDir = path.join(process.cwd(), "node_modules/.cache/kitamo-problem-report-check");
const migrationModules = [
  ["db/migrations/001_initial_schema.js", "initialSchemaMigration"],
  ["db/migrations/002_owner_setup_fields.js", "ownerSetupFieldsMigration"],
  ["db/migrations/003_owner_alert_fields.js", "ownerAlertFieldsMigration"],
  ["db/migrations/004_grocery_pool.js", "groceryPoolMigration"],
  ["db/migrations/005_recipes.js", "recipesMigration"],
  ["db/migrations/006_production.js", "productionMigration"],
  ["db/migrations/007_selling_cogs.js", "sellingCogsMigration"],
  ["db/migrations/008_fixed_costs.js", "fixedCostsMigration"],
  ["db/migrations/009_checkout_idempotency.js", "checkoutIdempotencyMigration"],
  ["db/migrations/010_problem_reports.js", "problemReportsMigration"],
];
const migrations = migrationModules.map(([file, exportName]) => require(path.join(compiledDir, file))[exportName]);
const {
  buildProblemReportShareText,
  sanitizeProblemReportDiagnostics,
  sanitizeProblemReportText,
} = require(path.join(compiledDir, "domain/problemReports.js"));
const dbPath = path.join(os.tmpdir(), `kitamo-problem-reports-${process.pid}-${Date.now()}.sqlite`);

function sql(statement, json = false) {
  const args = json ? ["-json", dbPath, statement] : [dbPath, statement];
  return execFileSync("sqlite3", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function applyMigrations() {
  sql("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);");
  let applied = 0;
  for (const migration of migrations) {
    if (sql(`SELECT COUNT(*) FROM schema_migrations WHERE id = '${migration.id}';`) === "1") continue;
    sql(`BEGIN EXCLUSIVE; ${migration.up} INSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', datetime('now')); COMMIT;`);
    applied += 1;
  }
  return applied;
}

try {
  assert.equal(applyMigrations(), migrations.length);
  assert.equal(applyMigrations(), 0, "problem-report migration must be repeat-safe");

  const maliciousDiagnostics = {
    appVersion: "1.0.0",
    buildNumber: "2",
    androidVersion: "15",
    deviceModel: "Low End Phone",
    mode: "kiosk",
    route: "/kiosk/checkout",
    businessId: "local_business_1",
    branchId: "local_branch_1",
    network: { type: "WIFI", isConnected: true, isInternetReachable: null, ipAddress: "192.0.2.1" },
    breadcrumbs: [{ kind: "route", name: "/kiosk/sell", occurredAt: "2026-07-16T00:00:00.000Z", receiptText: "secret receipt" }],
    ownerPin: "2468",
    password: "secret",
    databaseContents: "all rows",
    customerName: "Private Customer",
    receiptContents: "Full receipt",
  };
  const diagnostics = sanitizeProblemReportDiagnostics(maliciousDiagnostics);
  const diagnosticJson = JSON.stringify(diagnostics);
  for (const forbidden of ["2468", "secret", "all rows", "Private Customer", "Full receipt", "192.0.2.1"]) {
    assert.equal(diagnosticJson.includes(forbidden), false, `sanitized diagnostics leaked: ${forbidden}`);
  }

  assert.equal(sanitizeProblemReportText("PIN: 2468 was rejected", 180), "PIN [REDACTED] was rejected");

  const reportId = "problem_550e8400-e29b-41d4-a716-446655440000";
  const escapedDiagnostics = diagnosticJson.replaceAll("'", "''");
  const insert = `
    INSERT OR IGNORE INTO problem_reports (
      id, business_id, branch_id, mode, category, description, user_action,
      expected_result, actual_result, diagnostics_json, status,
      created_at, updated_at, sync_status, deleted_at
    ) VALUES (
      '${reportId}', NULL, NULL, 'kiosk', 'button_not_working', 'Save button did not respond',
      'Pressed Save once', 'One local report', 'Nothing changed', '${escapedDiagnostics}',
      'open', '2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 'local', NULL
    );
  `;
  sql(insert);
  sql(insert);
  assert.equal(Number(sql(`SELECT COUNT(*) FROM problem_reports WHERE id = '${reportId}';`)), 1, "duplicate taps must persist one report ID");

  const persisted = JSON.parse(sql(`SELECT * FROM problem_reports WHERE id = '${reportId}';`, true))[0];
  assert.equal(persisted.category, "button_not_working");
  assert.equal(persisted.sync_status, "local");
  assert.equal(persisted.deleted_at, null);
  assert.deepEqual(JSON.parse(persisted.diagnostics_json), diagnostics);

  const shareText = buildProblemReportShareText({
    id: reportId,
    businessId: null,
    branchId: null,
    mode: "kiosk",
    category: "button_not_working",
    description: persisted.description,
    userAction: persisted.user_action,
    expectedResult: persisted.expected_result,
    actualResult: persisted.actual_result,
    diagnostics,
    status: "open",
    createdAt: persisted.created_at,
    updatedAt: persisted.updated_at,
    syncStatus: "local",
    deletedAt: null,
  });
  assert.match(shareText, /Saved locally\. No automatic upload or crash monitoring is active\./);
  assert.equal(shareText.includes("2468"), false);

  console.log(`problem-report migrations: ${migrations.length} applied, 0 on rerun`);
  console.log("problem-report duplicate persistence: passed");
  console.log("diagnostics/share sanitization: passed");
  console.log("ALL PROBLEM REPORT CHECKS PASSED");
} finally {
  fs.rmSync(dbPath, { force: true });
}
