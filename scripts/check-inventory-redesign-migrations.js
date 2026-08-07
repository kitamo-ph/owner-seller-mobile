const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workspace = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kitamo-redesign-migrations-"));
const compiledDir = path.join(
  workspace,
  "node_modules/.cache/kitamo-inventory-redesign-migration-check",
);
const migrationSources = [
  ["001_initial_schema.ts", "initialSchemaMigration"],
  ["002_owner_setup_fields.ts", "ownerSetupFieldsMigration"],
  ["003_owner_alert_fields.ts", "ownerAlertFieldsMigration"],
  ["004_grocery_pool.ts", "groceryPoolMigration"],
  ["005_recipes.ts", "recipesMigration"],
  ["006_production.ts", "productionMigration"],
  ["007_selling_cogs.ts", "sellingCogsMigration"],
  ["008_fixed_costs.ts", "fixedCostsMigration"],
  ["009_checkout_idempotency.ts", "checkoutIdempotencyMigration"],
  ["010_problem_reports.ts", "problemReportsMigration"],
  ["011_catalog_identity.ts", "catalogIdentityMigration"],
  ["012_recipe_versions_and_drafts.ts", "recipeVersionsAndDraftsMigration"],
  ["013_inventory_planning_and_adjustments.ts", "inventoryPlanningAndAdjustmentsMigration"],
  ["014_supply_order_costs.ts", "supplyOrderCostsMigration"],
  ["015_recipe_first_costs.ts", "recipeFirstCostsMigration"],
  ["016_recipe_usability.ts", "recipeUsabilityMigration"],
  ["017_native_production_execution.ts", "nativeProductionExecutionMigration"],
];
const expectedNewTableColumns = {
  catalog_items: [
    "id", "business_id", "branch_id", "name", "normalized_name", "source_type",
    "classification", "lifecycle_status", "readiness_state",
    "classification_review_required", "sellable", "kiosk_enabled",
    "purchase_cost_state", "selling_price_state", "stock_policy", "archived_at",
    "created_at", "updated_at", "sync_status", "deleted_at",
  ],
  legacy_item_bindings: [
    "id", "business_id", "catalog_item_id", "entity_kind", "legacy_entity_id",
    "projection_role", "binding_status", "compatibility_mode", "review_required",
    "legacy_active_snapshot", "legacy_deleted_at_snapshot", "migration_provenance",
    "reviewed_at", "native_activated_at", "created_at", "updated_at", "sync_status",
    "deleted_at",
  ],
  item_unit_conversions: [
    "id", "business_id", "catalog_item_id", "from_unit", "to_unit", "factor",
    "version", "status", "supersedes_conversion_id", "effective_at", "created_at",
    "updated_at", "sync_status", "deleted_at",
  ],
  recipe_versions: [
    "id", "business_id", "recipe_id", "version_number", "status", "name_snapshot",
    "category_snapshot", "output_catalog_item_id", "output_product_id_snapshot",
    "expected_output_quantity", "expected_output_unit", "production_mode",
    "suggested_selling_price_snapshot", "selling_price_state", "notes_snapshot",
    "source_kind", "source_draft_id", "duplicated_from_version_id", "graph_state",
    "cost_state", "effective_at", "created_at", "updated_at", "sync_status",
    "deleted_at",
  ],
  recipe_version_lines: [
    "id", "business_id", "recipe_version_id", "sort_order", "source_kind",
    "catalog_item_id", "child_recipe_version_id", "custom_name_snapshot", "quantity",
    "unit", "normalized_quantity", "normalized_unit", "conversion_id",
    "conversion_factor_snapshot", "role", "is_optional", "cost_override",
    "cost_per_unit_snapshot", "line_cost_snapshot", "cost_state", "allocation_mode",
    "legacy_ingredient_id_snapshot", "legacy_ingredient_lot_id",
    "source_label_snapshot", "original_legacy_line_id", "notes_snapshot", "created_at",
    "updated_at", "sync_status", "deleted_at", "cost_source", "cost_profile_id",
    "conversion_chain_json", "unit_standard_snapshot",
  ],
  catalog_item_recipe_roles: [
    "id", "business_id", "output_catalog_item_id", "recipe_id", "role", "status",
    "effective_at", "archived_at", "created_at", "updated_at", "sync_status",
    "deleted_at",
  ],
  recipe_drafts: [
    "id", "business_id", "branch_id", "recipe_id", "source_version_id",
    "output_catalog_item_id", "name", "category", "expected_output_quantity",
    "expected_output_unit", "production_mode", "suggested_selling_price",
    "classification_proposal", "selling_price_state", "sellable", "kiosk_enabled",
    "editor_step", "lifecycle_status", "autosave_revision", "last_saved_at",
    "unresolved_requirement_count", "parent_draft_id", "parent_line_id",
    "return_route", "published_version_id", "created_at", "updated_at", "sync_status",
    "deleted_at", "notes",
  ],
  recipe_draft_lines: [
    "id", "business_id", "recipe_draft_id", "sort_order", "source_kind",
    "catalog_item_id", "child_recipe_version_id", "child_draft_id", "custom_name",
    "quantity", "unit", "normalized_quantity", "normalized_unit", "conversion_id",
    "conversion_factor_snapshot", "role", "is_optional", "cost_override",
    "cost_state", "allocation_mode", "legacy_ingredient_lot_id", "notes",
    "created_at", "updated_at", "sync_status", "deleted_at", "cost_source",
    "cost_profile_id",
    "conversion_chain_json", "unit_standard_snapshot",
  ],
  catalog_cost_profiles: [
    "id", "business_id", "catalog_item_id", "source_kind", "total_cost",
    "reference_quantity", "reference_unit", "request_token", "source_recipe_version_id",
    "supersedes_profile_id", "status", "effective_at", "superseded_at", "notes",
    "created_at", "updated_at", "sync_status", "deleted_at",
  ],
  recipe_version_cost_summaries: [
    "id", "business_id", "recipe_version_id", "status", "total_cost",
    "cost_per_output_unit", "known_cost_subtotal", "missing_required_count",
    "estimated_input_count", "created_at", "sync_status", "deleted_at",
  ],
  suppliers: [
    "id", "business_id", "name", "contact_number", "notes", "status", "created_at",
    "updated_at", "sync_status", "deleted_at",
  ],
  purchase_receipts: [
    "id", "business_id", "branch_id", "supplier_id", "reference_number",
    "purchased_at", "total_cost", "cost_state", "notes", "created_at", "updated_at",
    "sync_status", "deleted_at",
  ],
  product_stock_lots: [
    "id", "business_id", "branch_id", "product_id", "catalog_item_id", "origin_kind",
    "production_batch_id", "purchase_receipt_id", "supplier_id",
    "initialization_token", "origin_date", "expiry_date", "initial_quantity",
    "remaining_quantity", "unit", "recorded_total_cost", "recorded_cost_per_unit",
    "cost_state", "status", "provenance_state", "notes", "created_at", "updated_at",
    "sync_status", "deleted_at",
  ],
  production_plans: [
    "id", "business_id", "branch_id", "root_recipe_id", "root_recipe_version_id",
    "target_quantity", "target_unit", "preparation_mode", "status",
    "calculation_version", "stock_observed_at", "expected_total_cost", "cost_state",
    "missing_cost_count", "started_at", "completed_at", "created_at", "updated_at",
    "sync_status", "deleted_at",
  ],
  production_plan_stages: [
    "id", "business_id", "production_plan_id", "recipe_version_id",
    "parent_stage_id", "topological_order", "expected_input_multiplier",
    "expected_output_quantity", "expected_output_unit", "prepared_stock_quantity",
    "fresh_prepare_quantity", "status", "actual_output_quantity",
    "production_batch_id", "shortage_state", "variance_state", "created_at",
    "updated_at", "sync_status", "deleted_at",
  ],
  production_plan_requirements: [
    "id", "business_id", "production_plan_stage_id", "catalog_item_id",
    "requirement_kind", "raw_quantity", "raw_unit", "normalized_quantity",
    "normalized_unit", "provenance_json", "is_required", "expected_cost", "cost_state",
    "created_at", "updated_at", "sync_status", "deleted_at",
  ],
  production_plan_allocations: [
    "id", "business_id", "production_plan_requirement_id", "lot_kind",
    "ingredient_lot_id", "product_stock_lot_id", "allocation_mode", "quantity",
    "unit", "normalized_quantity", "normalized_unit", "conversion_id",
    "conversion_factor_snapshot", "unit_cost_snapshot", "cost_contribution",
    "cost_state", "selection_state", "sort_order", "created_at", "updated_at",
    "sync_status", "deleted_at",
  ],
  sale_product_lot_usages: [
    "id", "business_id", "sale_id", "sale_item_id", "product_stock_lot_id",
    "catalog_item_id", "quantity_used", "unit", "normalized_quantity",
    "normalized_unit", "conversion_id", "conversion_factor_snapshot",
    "unit_cost_snapshot", "cost_contribution", "cost_state", "allocation_mode",
    "source_label_snapshot", "created_at", "updated_at", "sync_status", "deleted_at",
  ],
  production_input_allocations: [
    "id", "business_id", "production_batch_id", "recipe_version_line_id",
    "production_plan_requirement_id", "catalog_item_id", "lot_kind",
    "ingredient_lot_id", "product_stock_lot_id", "quantity_used", "unit",
    "normalized_quantity", "normalized_unit", "conversion_id",
    "conversion_factor_snapshot", "unit_cost_snapshot", "cost_contribution",
    "cost_state", "allocation_mode", "source_label_snapshot", "created_at",
    "updated_at", "sync_status", "deleted_at",
  ],
  stock_adjustments: [
    "id", "business_id", "branch_id", "catalog_item_id", "subject_kind",
    "product_id", "ingredient_id", "request_token", "operation", "reason_code",
    "note", "accounting_class", "before_quantity", "entered_after_quantity",
    "delta_quantity", "unit", "authorized_mode", "created_at", "updated_at",
    "sync_status", "deleted_at",
  ],
  stock_adjustment_allocations: [
    "id", "business_id", "stock_adjustment_id", "lot_kind", "ingredient_lot_id",
    "product_stock_lot_id", "before_quantity", "delta_quantity", "after_quantity",
    "unit", "conversion_id", "conversion_factor_snapshot", "movement_kind",
    "ingredient_movement_id", "inventory_movement_id", "created_at", "updated_at",
    "sync_status", "deleted_at",
  ],
  supply_usage_rules: [
    "id", "business_id", "branch_id", "supply_catalog_item_id",
    "supply_ingredient_id", "target_product_id", "target_recipe_version_id",
    "supply_category", "consumption_stage", "scope", "behavior", "rounding_mode",
    "trigger_quantity", "supply_quantity", "supply_unit", "version", "status",
    "supersedes_rule_id", "effective_at", "archived_at", "cost_warning",
    "stock_warning", "created_at", "updated_at", "sync_status", "deleted_at",
  ],
  sale_supply_usages: [
    "id", "business_id", "sale_id", "checkout_token", "supply_catalog_item_id",
    "supply_ingredient_id", "rule_id", "request_key", "status", "consumption_stage",
    "supply_name_snapshot", "proposed_quantity", "quantity_used", "unit",
    "required_minimum", "scope_snapshot", "behavior_snapshot",
    "rule_version_snapshot", "is_manual_override", "cost_category",
    "unit_cost_snapshot", "cost_contribution", "cost_state", "stock_tracking_state",
    "ingredient_movement_id", "created_at", "updated_at", "sync_status", "deleted_at",
  ],
  sale_supply_lot_usages: [
    "id", "business_id", "sale_supply_usage_id", "ingredient_lot_id",
    "ingredient_movement_id", "quantity_used", "unit", "normalized_quantity",
    "normalized_unit", "conversion_id", "conversion_factor_snapshot",
    "unit_cost_snapshot", "cost_contribution", "cost_state", "allocation_mode",
    "created_at", "updated_at", "sync_status", "deleted_at",
  ],
};
const expectedAlteredColumns = {
  recipes: ["active_version_id", "versioning_state"],
  ingredient_lots: [
    "expiry_date", "supplier_id", "purchase_receipt_id", "provenance_state",
    "cost_state", "recorded_total_cost", "recorded_cost_per_unit",
    "source_metadata_json", "entered_quantity", "entered_unit",
    "unit_standard_snapshot", "conversion_chain_json",
  ],
  production_batches: [
    "recipe_version_id", "production_plan_stage_id", "expected_output_quantity",
    "actual_output_quantity", "expected_total_cost", "actual_total_cost",
    "cost_state", "yield_variance_quantity", "yield_variance_percent",
  ],
};
const expectedNewIndexes = [
  "idx_catalog_items_business_lifecycle",
  "idx_catalog_items_business_classification",
  "idx_catalog_items_business_review",
  "idx_catalog_items_normalized_name",
  "idx_catalog_items_kiosk_eligibility",
  "idx_legacy_bindings_catalog_role",
  "idx_legacy_bindings_business_mode",
  "idx_item_conversions_lookup",
  "uq_item_conversions_active",
  "idx_recipe_versions_business_recipe",
  "idx_recipe_versions_active_lookup",
  "idx_recipe_versions_output",
  "idx_recipe_version_lines_version",
  "idx_recipe_version_lines_child",
  "idx_recipe_version_lines_catalog",
  "idx_catalog_recipe_roles_lookup",
  "uq_catalog_recipe_roles_active_primary",
  "uq_catalog_recipe_roles_active_kiosk",
  "uq_catalog_recipe_roles_active_family_role",
  "idx_recipe_drafts_business_lifecycle",
  "idx_recipe_drafts_parent",
  "idx_recipe_drafts_revision",
  "idx_recipe_draft_lines_draft",
  "idx_recipe_draft_lines_child_version",
  "idx_recipe_draft_lines_child_draft",
  "idx_suppliers_business_status",
  "idx_purchase_receipts_business_date",
  "idx_purchase_receipts_supplier",
  "idx_ingredient_lots_available_expiry",
  "idx_ingredient_lots_cost_state",
  "idx_ingredient_lots_supplier",
  "idx_product_stock_lots_available",
  "idx_product_stock_lots_catalog",
  "idx_product_stock_lots_origin",
  "idx_product_stock_lots_cost_state",
  "uq_product_stock_lot_initialization",
  "idx_production_plans_business_status",
  "idx_production_plans_root_version",
  "idx_production_plan_stages_plan_status",
  "idx_production_plan_stages_version",
  "idx_production_plan_requirements_stage",
  "idx_production_plan_allocations_requirement",
  "idx_production_plan_allocations_ingredient_lot",
  "idx_production_plan_allocations_product_lot",
  "idx_sale_product_lot_usages_sale",
  "idx_sale_product_lot_usages_lot",
  "idx_production_input_allocations_batch",
  "idx_production_input_allocations_ingredient_lot",
  "idx_production_input_allocations_product_lot",
  "uq_stock_adjustments_request",
  "idx_stock_adjustments_catalog_created",
  "idx_stock_adjustments_reason",
  "idx_stock_adjustment_allocations_adjustment",
  "idx_stock_adjustment_allocations_ingredient_movement",
  "idx_stock_adjustment_allocations_inventory_movement",
  "idx_production_batches_recipe_version",
  "idx_production_batches_plan_stage",
  "idx_production_batches_plan_stage_unique",
  "idx_supply_rules_cart_lookup",
  "idx_supply_rules_recipe_lookup",
  "idx_supply_rules_supply",
  "uq_supply_rules_version",
  "uq_supply_rules_active",
  "idx_sale_supply_usages_sale",
  "idx_sale_supply_usages_checkout",
  "idx_sale_supply_usages_supply",
  "idx_sale_supply_lot_usages_usage",
  "idx_sale_supply_lot_usages_lot",
  "idx_catalog_cost_profiles_item_history",
  "idx_catalog_cost_profiles_recipe_version",
  "uq_catalog_cost_profiles_owner_request",
  "uq_catalog_cost_profiles_recipe_version",
  "uq_catalog_cost_profiles_active",
  "idx_recipe_draft_lines_cost_profile",
  "idx_recipe_version_lines_cost_profile",
  "idx_recipe_version_cost_summaries_business_status",
];

function compileMigrations() {
  fs.rmSync(compiledDir, { recursive: true, force: true });
  fs.mkdirSync(compiledDir, { recursive: true });
  execFileSync(
    path.join(workspace, "node_modules/.bin/tsc"),
    [
      ...migrationSources.map(([file]) => path.join(workspace, "src/db/migrations", file)),
      "--outDir",
      compiledDir,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--strict",
      "--skipLibCheck",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function loadMigrations() {
  return migrationSources.map(([file, exportName]) => {
    const compiledFile = path.join(compiledDir, file.replace(/\.ts$/, ".js"));
    return require(compiledFile)[exportName];
  });
}

function sql(dbPath, statement, json = false) {
  const args = ["-bail"];
  if (json) {
    args.push("-json");
  }
  args.push(dbPath, `PRAGMA foreign_keys = ON; ${statement}`);
  return execFileSync("sqlite3", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function applyMigrations(dbPath, migrations, through = migrations.length) {
  sql(
    dbPath,
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);",
  );
  let applied = 0;
  for (const migration of migrations.slice(0, through)) {
    const exists =
      sql(dbPath, `SELECT COUNT(*) FROM schema_migrations WHERE id = '${migration.id}';`) === "1";
    if (exists) {
      continue;
    }
    sql(
      dbPath,
      `BEGIN EXCLUSIVE;
       ${migration.up}
       INSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id}', datetime('now'));
       COMMIT;`,
    );
    applied += 1;
  }
  return applied;
}

function tableExists(dbPath, tableName) {
  return (
    sql(
      dbPath,
      `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '${tableName}';`,
    ) === "1"
  );
}

function columnExists(dbPath, tableName, columnName) {
  const rows = JSON.parse(sql(dbPath, `PRAGMA table_info(${tableName});`, true) || "[]");
  return rows.some((row) => row.name === columnName);
}

function tableColumns(dbPath, tableName) {
  return JSON.parse(sql(dbPath, `PRAGMA table_info(${tableName});`, true) || "[]").map(
    (row) => row.name,
  );
}

function ledgerIds(dbPath) {
  return JSON.parse(
    sql(dbPath, "SELECT id FROM schema_migrations ORDER BY id ASC;", true) || "[]",
  ).map((row) => row.id);
}

function assertSchemaInventory(dbPath) {
  for (const [tableName, expectedColumns] of Object.entries(expectedNewTableColumns)) {
    assert.equal(tableExists(dbPath, tableName), true, `${tableName} must exist`);
    assert.deepEqual(
      tableColumns(dbPath, tableName),
      expectedColumns,
      `${tableName} columns must match the persistence contract`,
    );
  }

  for (const [tableName, expectedColumns] of Object.entries(expectedAlteredColumns)) {
    const actualColumns = tableColumns(dbPath, tableName);
    for (const columnName of expectedColumns) {
      assert.equal(
        actualColumns.includes(columnName),
        true,
        `${tableName}.${columnName} must exist`,
      );
    }
  }

  const indexNames = new Set(
    JSON.parse(
      sql(
        dbPath,
        "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name ASC;",
        true,
      ) || "[]",
    ).map((row) => row.name),
  );
  for (const indexName of expectedNewIndexes) {
    assert.equal(indexNames.has(indexName), true, `${indexName} must exist`);
  }
}

function assertNoFabricatedRows(dbPath) {
  const emptyTables = [
    "item_unit_conversions",
    "catalog_item_recipe_roles",
    "recipe_drafts",
    "recipe_draft_lines",
    "suppliers",
    "purchase_receipts",
    "product_stock_lots",
    "production_plans",
    "production_plan_stages",
    "production_plan_requirements",
    "production_plan_allocations",
    "sale_product_lot_usages",
    "production_input_allocations",
    "stock_adjustments",
    "stock_adjustment_allocations",
    "supply_usage_rules",
    "sale_supply_usages",
    "sale_supply_lot_usages",
    "catalog_cost_profiles",
    "recipe_version_cost_summaries",
  ];
  for (const tableName of emptyTables) {
    assert.equal(
      Number(sql(dbPath, `SELECT COUNT(*) FROM ${tableName};`)),
      0,
      `${tableName} must not receive guessed legacy rows`,
    );
  }
}

function assertHealthy(dbPath) {
  assert.equal(sql(dbPath, "PRAGMA integrity_check;"), "ok", "integrity_check must pass");
  assert.equal(sql(dbPath, "PRAGMA foreign_key_check;"), "", "foreign_key_check must be empty");
}

function assertRunnerRegistration(migrations) {
  const indexSource = fs.readFileSync(
    path.join(workspace, "src/db/migrations/index.ts"),
    "utf8",
  );
  let priorOffset = -1;
  for (const [sourceFile, exportName] of migrationSources) {
    const moduleName = sourceFile.replace(/\.ts$/, "");
    const importText = `import { ${exportName} } from "./${moduleName}";`;
    const importOffset = indexSource.indexOf(importText);
    assert.notEqual(importOffset, -1, `${moduleName} must be imported by the runner`);
    assert.ok(importOffset > priorOffset, `${moduleName} import must be ordered`);
    priorOffset = importOffset;
  }

  const registrationBlock = indexSource.slice(
    indexSource.indexOf("const migrations: Migration[] = ["),
    indexSource.indexOf("];", indexSource.indexOf("const migrations: Migration[] = [")),
  );
  priorOffset = -1;
  for (const [, exportName] of migrationSources) {
    const registrationOffset = registrationBlock.indexOf(exportName);
    assert.notEqual(registrationOffset, -1, `${exportName} must be registered`);
    assert.ok(registrationOffset > priorOffset, `${exportName} registration must be ordered`);
    priorOffset = registrationOffset;
  }

  const schemaSource = fs.readFileSync(path.join(workspace, "src/db/schema.ts"), "utf8");
  assert.match(schemaSource, /export const schemaVersion = 17;/);
  assert.equal(migrations.length, 17);
}

function seedPopulatedV10(dbPath) {
  sql(
    dbPath,
    `BEGIN EXCLUSIVE;
     INSERT INTO businesses (
       id, business_name, business_type, owner_name, barangay,
       preferred_language, currency, created_at, updated_at, sync_status, deleted_at
     ) VALUES (
       'business-1', 'KitaMo Test', 'food', 'Owner', 'Barangay',
       'Taglish', 'PHP', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'local', NULL
     );
     INSERT INTO branches (
       id, business_id, branch_name, branch_type, active,
       created_at, updated_at, sync_status, deleted_at
     ) VALUES (
       'branch-1', 'business-1', 'Main', 'stall', 1,
       '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'local', NULL
     );
     INSERT INTO products (
       id, business_id, branch_id, name, category, price, cost, stock_qty,
       unit_type, low_stock_threshold, active, product_type,
       created_at, updated_at, sync_status, deleted_at
     ) VALUES (
       'shared-id', 'business-1', 'branch-1', 'Legacy Output', 'Food', 0, 0, 7.25,
       'serving', 2, 1, 'cooked food',
       '2026-07-02T00:00:00.000Z', '2026-07-03T00:00:00.000Z', 'local', NULL
     );
     INSERT INTO ingredients (
       id, business_id, name, default_unit, category, low_stock_threshold, is_active,
       created_at, updated_at, sync_status, deleted_at
     ) VALUES (
       'shared-id', 'business-1', 'Legacy Input', 'g', 'Raw', 100, 1,
       '2026-07-02T00:00:00.000Z', '2026-07-03T00:00:00.000Z', 'local', NULL
     );
     INSERT INTO ingredient_lots (
       id, business_id, ingredient_id, brand_name, source_name, purchase_date,
       purchased_quantity, remaining_quantity, unit, total_cost, cost_per_unit,
       status, created_at, updated_at, sync_status, deleted_at
     ) VALUES
       (
         'lot-positive', 'business-1', 'shared-id', 'Brand', 'Market', '2026-07-02',
         1000, 750, 'g', 120, 0.12, 'active',
         '2026-07-02T00:00:00.000Z', '2026-07-03T00:00:00.000Z', 'local', NULL
       ),
       (
         'lot-zero', 'business-1', 'shared-id', NULL, NULL, '2026-07-03',
         10, 10, 'g', 0, 0, 'active',
         '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z', 'local', NULL
       );
     INSERT INTO recipes (
       id, business_id, output_product_id, name, output_quantity, output_unit,
       production_mode, suggested_selling_price, notes, is_active,
       created_at, updated_at, sync_status, deleted_at
     ) VALUES (
       'recipe-1', 'business-1', 'shared-id', 'Current Stored Recipe', 5, 'pcs',
       'prepared_before_selling', 0, 'Preserve me', 1,
       '2026-07-04T00:00:00.000Z', '2026-07-05T00:00:00.000Z', 'local', NULL
     );
     INSERT INTO recipe_ingredient_lines (
       id, business_id, recipe_id, ingredient_id, ingredient_lot_id, custom_name,
       quantity, unit, cost_override, cost_per_unit_snapshot, line_cost_snapshot,
       source_label_snapshot, is_custom, notes, created_at, updated_at, sync_status, deleted_at
     ) VALUES
       (
         'line-ingredient', 'business-1', 'recipe-1', 'shared-id', 'lot-positive', NULL,
         250, 'g', NULL, 0.12, 30, 'Brand / Market', 0, 'Selected lot',
         '2026-07-04T01:00:00.000Z', '2026-07-04T01:00:00.000Z', 'local', NULL
       ),
       (
         'line-custom', 'business-1', 'recipe-1', NULL, NULL, 'Gas',
         1, 'pcs', 5, NULL, 5, 'Custom', 1, NULL,
         '2026-07-04T02:00:00.000Z', '2026-07-04T02:00:00.000Z', 'local', NULL
       );
     INSERT INTO production_batches (
       id, business_id, branch_id, recipe_id, output_product_id, recipe_name,
       output_quantity, output_unit, batch_multiplier, total_batch_cost,
       cost_per_output_unit, notes, created_at, updated_at, sync_status, deleted_at
     ) VALUES (
       'batch-legacy', 'business-1', 'branch-1', 'recipe-1', 'shared-id', 'Old Recipe',
       4, 'pcs', 1, 35, 8.75, 'Historical',
       '2026-07-06T00:00:00.000Z', '2026-07-06T00:00:00.000Z', 'local', NULL
     );
     COMMIT;`,
  );
}

function legacyFingerprint(dbPath) {
  const statements = [
    `SELECT id, business_id, branch_id, name, category, price, cost, stock_qty,
      unit_type, low_stock_threshold, active, product_type, created_at, updated_at,
      sync_status, deleted_at FROM products ORDER BY id;`,
    `SELECT id, business_id, name, default_unit, category, low_stock_threshold,
      is_active, created_at, updated_at, sync_status, deleted_at
      FROM ingredients ORDER BY id;`,
    `SELECT id, business_id, ingredient_id, brand_name, source_name, purchase_date,
      purchased_quantity, remaining_quantity, unit, total_cost, cost_per_unit,
      notes, status, created_at, updated_at, sync_status, deleted_at
      FROM ingredient_lots ORDER BY id;`,
    `SELECT id, business_id, output_product_id, name, output_quantity, output_unit,
      production_mode, suggested_selling_price, notes, is_active,
      created_at, updated_at, sync_status, deleted_at FROM recipes ORDER BY id;`,
    `SELECT id, business_id, recipe_id, ingredient_id, ingredient_lot_id, custom_name,
      quantity, unit, cost_override, cost_per_unit_snapshot, line_cost_snapshot,
      source_label_snapshot, is_custom, notes, created_at, updated_at, sync_status, deleted_at
      FROM recipe_ingredient_lines ORDER BY id;`,
    `SELECT id, business_id, branch_id, recipe_id, output_product_id, recipe_name,
      output_quantity, output_unit, batch_multiplier, total_batch_cost,
      cost_per_output_unit, notes, created_at, updated_at, sync_status, deleted_at
      FROM production_batches ORDER BY id;`,
  ];
  return statements.map((statement) => sql(dbPath, statement, true));
}

function expectRejected(dbPath, statement, message) {
  assert.throws(() => sql(dbPath, statement), message);
}

function seedResetCoverage(dbPath) {
  sql(
    dbPath,
    `BEGIN EXCLUSIVE;
     INSERT INTO suppliers (
       id, business_id, name, status, created_at, updated_at, sync_status
     ) VALUES (
       'supplier-reset', 'business-1', 'Reset Supplier', 'active',
       datetime('now'), datetime('now'), 'local'
     );
     UPDATE purchase_receipts
     SET supplier_id = 'supplier-reset'
     WHERE id = 'receipt-known-zero';
     INSERT INTO item_unit_conversions (
       id, business_id, catalog_item_id, from_unit, to_unit, factor, version,
       status, effective_at, created_at, updated_at, sync_status
     ) VALUES (
       'conversion-reset', 'business-1', 'legacy:ingredient:shared-id',
       'g', 'kg', 0.001, 1, 'active', datetime('now'), datetime('now'),
       datetime('now'), 'local'
     );
     INSERT INTO recipe_drafts (
       id, business_id, recipe_id, output_catalog_item_id, name,
       selling_price_state, sellable, kiosk_enabled, editor_step,
       lifecycle_status, autosave_revision, last_saved_at,
       unresolved_requirement_count, created_at, updated_at, sync_status
     ) VALUES (
       'draft-parent', 'business-1', 'recipe-1', 'legacy:product:shared-id',
       'Reset Parent', 'unknown', 0, 0, 'composition', 'editing', 1,
       datetime('now'), 1, datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO recipe_drafts (
       id, business_id, recipe_id, output_catalog_item_id, name,
       selling_price_state, sellable, kiosk_enabled, editor_step,
       lifecycle_status, autosave_revision, last_saved_at,
       unresolved_requirement_count, parent_draft_id, parent_line_id,
       created_at, updated_at, sync_status
     ) VALUES (
       'draft-child', 'business-1', 'recipe-1', 'legacy:product:shared-id',
       'Reset Child', 'unknown', 0, 0, 'definition', 'editing', 1,
       datetime('now'), 0, 'draft-parent', 'draft-line-reset',
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO recipe_draft_lines (
       id, business_id, recipe_draft_id, sort_order, source_kind, custom_name,
       role, is_optional, cost_state, allocation_mode,
       created_at, updated_at, sync_status
     ) VALUES (
       'draft-line-reset', 'business-1', 'draft-parent', 0, 'unresolved',
       'Pending child', 'unset', 0, 'unknown', 'none',
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO catalog_cost_profiles (
       id, business_id, catalog_item_id, source_kind, total_cost,
       reference_quantity, reference_unit, request_token, status, effective_at,
       created_at, updated_at, sync_status
     ) VALUES (
       'cost-profile-reset', 'business-1', 'legacy:product:shared-id',
       'owner_estimate', 35, 5, 'pcs', 'reset-estimate', 'active', datetime('now'),
       datetime('now'), datetime('now'), 'local'
     );
     UPDATE recipe_draft_lines
     SET cost_source = 'owner_estimate',
         cost_profile_id = 'cost-profile-reset'
     WHERE id = 'draft-line-reset';
     INSERT INTO recipe_version_cost_summaries (
       id, business_id, recipe_version_id, status, total_cost,
       cost_per_output_unit, known_cost_subtotal, missing_required_count,
       estimated_input_count, created_at, sync_status
     ) VALUES (
       'cost-summary-reset', 'business-1',
       'legacy:recipe-version:recipe-1:1', 'actual', 35, 7, 35, 0, 0,
       datetime('now'), 'local'
     );
     INSERT INTO production_plans (
       id, business_id, branch_id, root_recipe_id, root_recipe_version_id,
       target_quantity, target_unit, preparation_mode, status,
       calculation_version, stock_observed_at, expected_total_cost, cost_state,
       missing_cost_count, created_at, updated_at, sync_status
     ) VALUES (
       'plan-reset', 'business-1', 'branch-1', 'recipe-1',
       'legacy:recipe-version:recipe-1:1', 10, 'pcs', 'prepare_fresh', 'draft',
       1, datetime('now'), 0, 'known', 0, datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO production_plan_stages (
       id, business_id, production_plan_id, recipe_version_id,
       topological_order, expected_input_multiplier, expected_output_quantity,
       expected_output_unit, prepared_stock_quantity, fresh_prepare_quantity,
       status, shortage_state, variance_state, created_at, updated_at, sync_status
     ) VALUES (
       'stage-parent', 'business-1', 'plan-reset',
       'legacy:recipe-version:recipe-1:1', 0, 2, 10, 'pcs', 0, 10,
       'pending', 'none', 'pending', datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO production_plan_stages (
       id, business_id, production_plan_id, recipe_version_id, parent_stage_id,
       topological_order, expected_input_multiplier, expected_output_quantity,
       expected_output_unit, prepared_stock_quantity, fresh_prepare_quantity,
       status, shortage_state, variance_state, created_at, updated_at, sync_status
     ) VALUES (
       'stage-child', 'business-1', 'plan-reset',
       'legacy:recipe-version:recipe-1:1', 'stage-parent', 1, 1, 5, 'pcs', 0, 5,
       'pending', 'none', 'pending', datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO production_plan_requirements (
       id, business_id, production_plan_stage_id, catalog_item_id,
       requirement_kind, raw_quantity, raw_unit, provenance_json, is_required,
       expected_cost, cost_state, created_at, updated_at, sync_status
     ) VALUES (
       'requirement-reset', 'business-1', 'stage-parent',
       'legacy:ingredient:shared-id', 'ingredient', 1, 'g', '{}', 1, 0,
       'known', datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO production_plan_allocations (
       id, business_id, production_plan_requirement_id, lot_kind,
       ingredient_lot_id, allocation_mode, quantity, unit, unit_cost_snapshot,
       cost_contribution, cost_state, selection_state, sort_order,
       created_at, updated_at, sync_status
     ) VALUES (
       'plan-allocation-reset', 'business-1', 'requirement-reset', 'ingredient',
       'lot-positive', 'manual', 1, 'g', 0, 0, 'known', 'manual', 0,
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO product_stock_lots (
       id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
       purchase_receipt_id, origin_date, initial_quantity, remaining_quantity,
       unit, recorded_total_cost, recorded_cost_per_unit, cost_state, status,
       provenance_state, created_at, updated_at, sync_status
     ) VALUES (
       'product-lot-reset', 'business-1', 'branch-1', 'shared-id',
       'legacy:product:shared-id', 'purchase', 'receipt-known-zero',
       datetime('now'), 5, 5, 'pcs', 10, 2, 'known', 'active', 'exact',
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO sales (
       id, business_id, branch_id, transaction_no, happened_at, amount, discount,
       payment_method, payment_status, created_at, updated_at, sync_status,
       checkout_token
     ) VALUES (
       'sale-reset', 'business-1', 'branch-1', 'RESET-1', datetime('now'), 5, 0,
       'cash', 'paid', datetime('now'), datetime('now'), 'local', 'checkout-reset'
     );
     INSERT INTO sale_items (
       id, sale_id, business_id, branch_id, product_id, name, quantity,
       unit_price, unit_cost, line_total, bundle_applied, discount_amount,
       created_at, updated_at, sync_status
     ) VALUES (
       'sale-item-reset', 'sale-reset', 'business-1', 'branch-1', 'shared-id',
       'Reset item', 1, 5, 2, 5, 0, 0, datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO sale_product_lot_usages (
       id, business_id, sale_id, sale_item_id, product_stock_lot_id,
       catalog_item_id, quantity_used, unit, unit_cost_snapshot,
       cost_contribution, cost_state, allocation_mode, created_at, updated_at,
       sync_status
     ) VALUES (
       'sale-product-usage-reset', 'business-1', 'sale-reset', 'sale-item-reset',
       'product-lot-reset', 'legacy:product:shared-id', 1, 'pcs', 2, 2, 'known',
       'manual', datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO production_input_allocations (
       id, business_id, production_batch_id, recipe_version_line_id,
       production_plan_requirement_id, catalog_item_id, lot_kind,
       ingredient_lot_id, quantity_used, unit, unit_cost_snapshot,
       cost_contribution, cost_state, allocation_mode, source_label_snapshot,
       created_at, updated_at, sync_status
     ) VALUES (
       'production-input-reset', 'business-1', 'batch-legacy',
       'legacy:recipe-version-line:line-ingredient', 'requirement-reset',
       'legacy:ingredient:shared-id', 'ingredient', 'lot-positive', 1, 'g',
       0.12, 0.12, 'known', 'legacy_selected', 'Brand / Market',
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO ingredient_movements (
       id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
       unit_cost, total_cost, reason, created_at, updated_at, sync_status
     ) VALUES (
       'movement-reset', 'business-1', 'shared-id', 'lot-positive',
       'adjustment', -1, 'g', 0.12, 0.12, 'Reset evidence',
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO stock_adjustments (
       id, business_id, branch_id, catalog_item_id, subject_kind, ingredient_id,
       request_token, operation, reason_code, accounting_class, before_quantity,
       entered_after_quantity, delta_quantity, unit, authorized_mode,
       created_at, updated_at, sync_status
     ) VALUES (
       'adjustment-reset', 'business-1', 'branch-1',
       'legacy:ingredient:shared-id', 'ingredient', 'shared-id',
       'adjustment-token-reset', 'delta', 'spoilage',
       'inventory_loss_spoilage', 750, 749, -1, 'g', 'owner',
       datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO stock_adjustment_allocations (
       id, business_id, stock_adjustment_id, lot_kind, ingredient_lot_id,
       before_quantity, delta_quantity, after_quantity, unit, movement_kind,
       ingredient_movement_id, created_at, updated_at, sync_status
     ) VALUES (
       'adjustment-allocation-reset', 'business-1', 'adjustment-reset',
       'ingredient', 'lot-positive', 750, -1, 749, 'g', 'ingredient',
       'movement-reset', datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO supply_usage_rules (
       id, business_id, branch_id, supply_catalog_item_id, supply_ingredient_id,
       target_product_id, supply_category, consumption_stage, scope, behavior,
       rounding_mode, trigger_quantity, supply_quantity, supply_unit, version,
       status, effective_at, cost_warning, stock_warning, created_at, updated_at,
       sync_status
     ) VALUES (
       'supply-rule-reset', 'business-1', 'branch-1',
       'legacy:ingredient:shared-id', 'shared-id', 'shared-id', 'packaging',
       'checkout', 'per_product', 'required', 'multiply_each', 1, 1, 'g', 1,
       'active', datetime('now'), 0, 0, datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO sale_supply_usages (
       id, business_id, sale_id, checkout_token, supply_catalog_item_id,
       supply_ingredient_id, rule_id, request_key, status, consumption_stage,
       supply_name_snapshot, proposed_quantity, quantity_used, unit,
       required_minimum, scope_snapshot, behavior_snapshot,
       rule_version_snapshot, is_manual_override, cost_category,
       unit_cost_snapshot, cost_contribution, cost_state, stock_tracking_state,
       ingredient_movement_id, created_at, updated_at, sync_status
     ) VALUES (
       'sale-supply-reset', 'business-1', 'sale-reset', 'checkout-reset',
       'legacy:ingredient:shared-id', 'shared-id', 'supply-rule-reset',
       'supply-line-reset', 'confirmed', 'checkout', 'Reset wrapper', 1, 1, 'g',
       1, 'per_product', 'required', 1, 0, 'packaging_cost', 0.12, 0.12,
       'known', 'tracked', 'movement-reset', datetime('now'), datetime('now'), 'local'
     );
     INSERT INTO sale_supply_lot_usages (
       id, business_id, sale_supply_usage_id, ingredient_lot_id,
       ingredient_movement_id, quantity_used, unit, unit_cost_snapshot,
       cost_contribution, cost_state, allocation_mode, created_at, updated_at,
       sync_status
     ) VALUES (
       'sale-supply-lot-reset', 'business-1', 'sale-supply-reset',
       'lot-positive', 'movement-reset', 1, 'g', 0.12, 0.12, 'known', 'manual',
       datetime('now'), datetime('now'), 'local'
     );
     COMMIT;`,
  );
}

function resetTableOrder() {
  const schemaSource = fs.readFileSync(path.join(workspace, "src/db/schema.ts"), "utf8");
  const match = schemaSource.match(
    /export const resettableTables = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(match, "resettableTables must be readable");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function assertResetCoverage(dbPath) {
  seedResetCoverage(dbPath);
  const tableOrder = resetTableOrder();
  for (const tableName of Object.keys(expectedNewTableColumns)) {
    assert.equal(
      tableOrder.includes(tableName),
      true,
      `${tableName} must be included in resettableTables`,
    );
  }
  sql(
    dbPath,
    `BEGIN EXCLUSIVE;
     ${tableOrder.map((tableName) => `DELETE FROM ${tableName};`).join("\n")}
     COMMIT;`,
  );
  for (const tableName of tableOrder) {
    assert.equal(Number(sql(dbPath, `SELECT COUNT(*) FROM ${tableName};`)), 0);
  }
  assert.equal(Number(sql(dbPath, "SELECT COUNT(*) FROM schema_migrations;")), 17);
  assertHealthy(dbPath);
}

try {
  compileMigrations();
  const migrations = loadMigrations();
  assertRunnerRegistration(migrations);
  assert.deepEqual(
    migrations.map((migration) => migration.id),
    [
      "001_initial_schema",
      "002_owner_setup_fields",
      "003_owner_alert_fields",
      "004_grocery_pool",
      "005_recipes",
      "006_production",
      "007_selling_cogs",
      "008_fixed_costs",
      "009_checkout_idempotency",
      "010_problem_reports",
      "011_catalog_identity",
      "012_recipe_versions_and_drafts",
      "013_inventory_planning_and_adjustments",
      "014_supply_order_costs",
      "015_recipe_first_costs",
      "016_recipe_usability",
      "017_native_production_execution",
    ],
  );

  const freshDb = path.join(temporaryRoot, "fresh.sqlite");
  assert.equal(applyMigrations(freshDb, migrations), 17, "fresh database must apply 17 migrations");
  assert.equal(applyMigrations(freshDb, migrations), 0, "fresh replay must apply zero migrations");
  assert.equal(Number(sql(freshDb, "SELECT COUNT(*) FROM schema_migrations;")), 17);
  assert.equal(Number(sql(freshDb, "SELECT COUNT(*) FROM catalog_items;")), 0);
  assertSchemaInventory(freshDb);
  assertHealthy(freshDb);

  const populatedDb = path.join(temporaryRoot, "populated.sqlite");
  assert.equal(applyMigrations(populatedDb, migrations, 10), 10);
  seedPopulatedV10(populatedDb);
  const beforeFingerprint = legacyFingerprint(populatedDb);
  assert.equal(applyMigrations(populatedDb, migrations), 7);
  assert.equal(applyMigrations(populatedDb, migrations), 0);
  assert.deepEqual(legacyFingerprint(populatedDb), beforeFingerprint, "legacy facts must remain unchanged");
  assert.deepEqual(
    JSON.parse(
      sql(
        populatedDb,
        `SELECT id, entered_quantity, entered_unit,
           unit_standard_snapshot, conversion_chain_json
         FROM ingredient_lots
         ORDER BY id ASC;`,
        true,
      ),
    ),
    [
      {
        id: "lot-positive",
        entered_quantity: 1000,
        entered_unit: "g",
        unit_standard_snapshot: null,
        conversion_chain_json: null,
      },
      {
        id: "lot-zero",
        entered_quantity: 10,
        entered_unit: "g",
        unit_standard_snapshot: null,
        conversion_chain_json: null,
      },
    ],
    "016 must backfill original entered quantity and unit without inventing conversion evidence",
  );

  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM catalog_items;")), 2);
  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM legacy_item_bindings;")), 2);
  assert.equal(
    Number(
      sql(
        populatedDb,
        `SELECT COUNT(*) FROM catalog_items
         WHERE classification = 'legacy_unclassified'
           AND readiness_state = 'legacy_review'
           AND classification_review_required = 1;`,
      ),
    ),
    2,
  );
  assert.equal(
    Number(
      sql(
        populatedDb,
        `SELECT COUNT(DISTINCT catalog_item_id) FROM legacy_item_bindings
         WHERE legacy_entity_id = 'shared-id';`,
      ),
    ),
    2,
    "same-text Product and Ingredient IDs must not merge",
  );
  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM recipe_versions;")), 1);
  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM recipe_version_lines;")), 2);
  assert.deepEqual(
    JSON.parse(
      sql(
        populatedDb,
        `SELECT
           entity_kind,
           legacy_entity_id,
           catalog_item_id,
           projection_role,
           binding_status,
           compatibility_mode,
           review_required,
           legacy_active_snapshot,
           migration_provenance
         FROM legacy_item_bindings
         ORDER BY entity_kind ASC;`,
        true,
      ),
    ),
    [
      {
        entity_kind: "ingredient",
        legacy_entity_id: "shared-id",
        catalog_item_id: "legacy:ingredient:shared-id",
        projection_role: "legacy_ingredient",
        binding_status: "active",
        compatibility_mode: "legacy_unclassified",
        review_required: 1,
        legacy_active_snapshot: 1,
        migration_provenance: "migration_011",
      },
      {
        entity_kind: "product",
        legacy_entity_id: "shared-id",
        catalog_item_id: "legacy:product:shared-id",
        projection_role: "legacy_product",
        binding_status: "active",
        compatibility_mode: "legacy_unclassified",
        review_required: 1,
        legacy_active_snapshot: 1,
        migration_provenance: "migration_011",
      },
    ],
  );
  assert.deepEqual(
    JSON.parse(
      sql(
        populatedDb,
        `SELECT
           id,
           recipe_id,
           version_number,
           status,
           name_snapshot,
           output_catalog_item_id,
           output_product_id_snapshot,
           expected_output_quantity,
           expected_output_unit,
           production_mode,
           suggested_selling_price_snapshot,
           selling_price_state,
           notes_snapshot,
           source_kind,
           graph_state,
           cost_state,
           effective_at,
           created_at,
           updated_at
         FROM recipe_versions;`,
        true,
      ),
    ),
    [
      {
        id: "legacy:recipe-version:recipe-1:1",
        recipe_id: "recipe-1",
        version_number: 1,
        status: "published",
        name_snapshot: "Current Stored Recipe",
        output_catalog_item_id: "legacy:product:shared-id",
        output_product_id_snapshot: "shared-id",
        expected_output_quantity: 5.0,
        expected_output_unit: "pcs",
        production_mode: "prepared_before_selling",
        suggested_selling_price_snapshot: 0.0,
        selling_price_state: "legacy_zero_unresolved",
        notes_snapshot: "Preserve me",
        source_kind: "legacy_import",
        graph_state: "legacy_review",
        cost_state: "legacy_review",
        effective_at: "2026-07-05T00:00:00.000Z",
        created_at: "2026-07-04T00:00:00.000Z",
        updated_at: "2026-07-05T00:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(
    JSON.parse(
      sql(
        populatedDb,
        `SELECT
           original_legacy_line_id,
           sort_order,
           source_kind,
           catalog_item_id,
           custom_name_snapshot,
           quantity,
           unit,
           cost_override,
           cost_per_unit_snapshot,
           line_cost_snapshot,
           cost_state,
           cost_source,
           cost_profile_id,
           allocation_mode,
           legacy_ingredient_id_snapshot,
           legacy_ingredient_lot_id,
           source_label_snapshot,
           notes_snapshot
         FROM recipe_version_lines
         ORDER BY sort_order ASC;`,
        true,
      ),
    ),
    [
      {
        original_legacy_line_id: "line-ingredient",
        sort_order: 0,
        source_kind: "catalog_item",
        catalog_item_id: "legacy:ingredient:shared-id",
        custom_name_snapshot: null,
        quantity: 250.0,
        unit: "g",
        cost_override: null,
        cost_per_unit_snapshot: 0.12,
        line_cost_snapshot: 30.0,
        cost_state: "known",
        cost_source: "purchase_lot",
        cost_profile_id: null,
        allocation_mode: "legacy_selected",
        legacy_ingredient_id_snapshot: "shared-id",
        legacy_ingredient_lot_id: "lot-positive",
        source_label_snapshot: "Brand / Market",
        notes_snapshot: "Selected lot",
      },
      {
        original_legacy_line_id: "line-custom",
        sort_order: 1,
        source_kind: "custom_cost",
        catalog_item_id: null,
        custom_name_snapshot: "Gas",
        quantity: 1.0,
        unit: "pcs",
        cost_override: 5.0,
        cost_per_unit_snapshot: null,
        line_cost_snapshot: 5.0,
        cost_state: "known",
        cost_source: "custom",
        cost_profile_id: null,
        allocation_mode: "none",
        legacy_ingredient_id_snapshot: null,
        legacy_ingredient_lot_id: null,
        source_label_snapshot: "Custom",
        notes_snapshot: null,
      },
    ],
  );
  assert.equal(
    sql(populatedDb, "SELECT active_version_id FROM recipes WHERE id = 'recipe-1';"),
    "legacy:recipe-version:recipe-1:1",
  );
  assert.equal(
    sql(
      populatedDb,
      "SELECT allocation_mode FROM recipe_version_lines WHERE original_legacy_line_id = 'line-ingredient';",
    ),
    "legacy_selected",
  );
  assert.equal(
    sql(populatedDb, "SELECT cost_state FROM ingredient_lots WHERE id = 'lot-positive';"),
    "known",
  );
  assert.equal(
    sql(populatedDb, "SELECT recorded_total_cost FROM ingredient_lots WHERE id = 'lot-positive';"),
    "120.0",
  );
  assert.equal(
    sql(populatedDb, "SELECT cost_state FROM ingredient_lots WHERE id = 'lot-zero';"),
    "legacy_zero_unresolved",
  );
  assert.equal(
    sql(populatedDb, "SELECT recorded_total_cost IS NULL FROM ingredient_lots WHERE id = 'lot-zero';"),
    "1",
  );
  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM product_stock_lots;")), 0);
  assert.equal(
    sql(populatedDb, "SELECT recipe_version_id IS NULL FROM production_batches WHERE id = 'batch-legacy';"),
    "1",
  );
  assert.equal(
    sql(populatedDb, "SELECT actual_output_quantity FROM production_batches WHERE id = 'batch-legacy';"),
    "4.0",
  );
  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM supply_usage_rules;")), 0);
  assert.equal(Number(sql(populatedDb, "SELECT COUNT(*) FROM sale_supply_usages;")), 0);
  assertNoFabricatedRows(populatedDb);

  expectRejected(
    populatedDb,
    `INSERT INTO legacy_item_bindings (
      id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
      projection_role, binding_status, compatibility_mode, review_required,
      legacy_active_snapshot, migration_provenance, created_at, updated_at, sync_status
    ) VALUES (
      'duplicate-binding', 'business-1', 'legacy:product:shared-id', 'product', 'shared-id',
      'legacy_product', 'active', 'legacy_unclassified', 1, 1, 'native',
      datetime('now'), datetime('now'), 'local'
    );`,
    "duplicate exact binding must be rejected",
  );
  sql(
    populatedDb,
    `INSERT INTO catalog_item_recipe_roles (
      id, business_id, output_catalog_item_id, recipe_id, role, status,
      effective_at, created_at, updated_at, sync_status
    ) VALUES (
      'role-1', 'business-1', 'legacy:product:shared-id', 'recipe-1', 'primary', 'active',
      datetime('now'), datetime('now'), datetime('now'), 'local'
    );`,
  );
  expectRejected(
    populatedDb,
    `INSERT INTO catalog_item_recipe_roles (
      id, business_id, output_catalog_item_id, recipe_id, role, status,
      effective_at, created_at, updated_at, sync_status
    ) VALUES (
      'role-2', 'business-1', 'legacy:product:shared-id', 'recipe-1', 'primary', 'active',
      datetime('now'), datetime('now'), datetime('now'), 'local'
    );`,
    "an output item must not have two implicit primary recipes",
  );
  expectRejected(
    populatedDb,
    `INSERT INTO purchase_receipts (
      id, business_id, purchased_at, total_cost, cost_state,
      created_at, updated_at, sync_status
    ) VALUES (
      'receipt-unknown-with-zero', 'business-1', datetime('now'), 0, 'unknown',
      datetime('now'), datetime('now'), 'local'
    );`,
    "an unknown native cost must not persist a numeric zero",
  );
  expectRejected(
    populatedDb,
    `INSERT INTO purchase_receipts (
      id, business_id, purchased_at, total_cost, cost_state,
      created_at, updated_at, sync_status
    ) VALUES (
      'receipt-known-without-value', 'business-1', datetime('now'), NULL, 'known',
      datetime('now'), datetime('now'), 'local'
    );`,
    "a known native cost must persist its authoritative value",
  );
  sql(
    populatedDb,
    `INSERT INTO purchase_receipts (
      id, business_id, purchased_at, total_cost, cost_state,
      created_at, updated_at, sync_status
    ) VALUES (
      'receipt-known-zero', 'business-1', datetime('now'), 0, 'known',
      datetime('now'), datetime('now'), 'local'
    );
    INSERT INTO product_stock_lots (
      id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
      purchase_receipt_id, initialization_token, origin_date, initial_quantity,
      remaining_quantity, unit, recorded_total_cost, recorded_cost_per_unit,
      cost_state, status, provenance_state, created_at, updated_at, sync_status
    ) VALUES (
      'known-zero-lot', 'business-1', 'branch-1', 'shared-id',
      'legacy:product:shared-id', 'purchase', 'receipt-known-zero',
      'review-token-1', datetime('now'), 0, 0, 'pcs', 0, 0, 'known',
      'depleted', 'review_required', datetime('now'), datetime('now'), 'local'
    );`,
  );
  expectRejected(
    populatedDb,
    `INSERT INTO product_stock_lots (
      id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
      initialization_token, origin_date, initial_quantity, remaining_quantity,
      unit, recorded_total_cost, recorded_cost_per_unit, cost_state, status,
      provenance_state, created_at, updated_at, sync_status
    ) VALUES (
      'unknown-zero-lot', 'business-1', 'branch-1', 'shared-id',
      'legacy:product:shared-id', 'legacy_balance', 'review-token-2',
      datetime('now'), 0, 0, 'pcs', 0, 0, 'unknown', 'depleted',
      'review_required', datetime('now'), datetime('now'), 'local'
    );`,
    "an unknown Product-lot cost must keep authoritative shadows null",
  );
  expectRejected(
    populatedDb,
    `INSERT INTO product_stock_lots (
      id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
      purchase_receipt_id, initialization_token, origin_date, initial_quantity,
      remaining_quantity, unit, recorded_total_cost, recorded_cost_per_unit,
      cost_state, status, provenance_state, created_at, updated_at, sync_status
    ) VALUES (
      'duplicate-init-lot', 'business-1', 'branch-1', 'shared-id',
      'legacy:product:shared-id', 'purchase', 'receipt-known-zero',
      'review-token-1', datetime('now'), 0, 0, 'pcs', 0, 0, 'known',
      'depleted', 'review_required', datetime('now'), datetime('now'), 'local'
    );`,
    "owner-review Product-lot initialization must be idempotent",
  );
  assertHealthy(populatedDb);
  assertResetCoverage(populatedDb);

  const retryDb = path.join(temporaryRoot, "retry.sqlite");
  assert.equal(applyMigrations(retryDb, migrations, 10), 10);
  seedPopulatedV10(retryDb);
  const rollbackSentinels = [
    ["catalog_items", null],
    ["recipe_versions", ["recipes", "active_version_id"]],
    ["product_stock_lots", ["ingredient_lots", "cost_state"]],
    ["supply_usage_rules", null],
    ["catalog_cost_profiles", ["recipe_draft_lines", "cost_source"]],
    [null, ["recipe_draft_lines", "conversion_chain_json"]],
    // 017 only adds idx_production_batches_plan_stage_unique; no table/column sentinel.
    [null, null],
  ];
  for (let index = 10; index < migrations.length; index += 1) {
    const migration = migrations[index];
    const beforeFailedAttempt = legacyFingerprint(retryDb);
    assert.throws(
      () =>
        sql(
          retryDb,
          `BEGIN EXCLUSIVE;
           ${migration.up}
           INSERT INTO schema_migrations (id, applied_at)
             VALUES ('${migration.id}', datetime('now'));
           SELECT * FROM forced_failure_for_migration_check;
           COMMIT;`,
        ),
      `forced failure must abort ${migration.id}`,
    );
    assert.equal(
      Number(sql(retryDb, `SELECT COUNT(*) FROM schema_migrations WHERE id = '${migration.id}';`)),
      0,
      `${migration.id} ledger row must roll back`,
    );
    assert.deepEqual(
      legacyFingerprint(retryDb),
      beforeFailedAttempt,
      `${migration.id} must roll back seeded legacy data changes`,
    );
    const [tableName, alteredColumn] = rollbackSentinels[index - 10];
    if (tableName) {
      assert.equal(tableExists(retryDb, tableName), false, `${tableName} DDL must roll back`);
    }
    if (alteredColumn) {
      assert.equal(
        columnExists(retryDb, alteredColumn[0], alteredColumn[1]),
        false,
        `${alteredColumn.join(".")} must roll back`,
      );
    }
    if (migration.id === "017_native_production_execution") {
      assert.equal(
        Number(
          sql(
            retryDb,
            `SELECT COUNT(*) FROM sqlite_master
             WHERE type = 'index'
               AND name = 'idx_production_batches_plan_stage_unique';`,
          ),
        ),
        0,
        "idx_production_batches_plan_stage_unique must roll back",
      );
    }
    assert.equal(applyMigrations(retryDb, migrations, index + 1), 1);
    assert.deepEqual(
      ledgerIds(retryDb),
      migrations.slice(0, index + 1).map((entry) => entry.id),
      `${migration.id} resume must leave an exact migration prefix`,
    );
    assertHealthy(retryDb);
  }
  assert.equal(applyMigrations(retryDb, migrations), 0);

  console.log("fresh 001-017 migration and replay: passed");
  console.log("populated v10 preservation and deterministic import: passed");
  console.log("legacy zero, selected-lot, and historical-version handling: passed");
  console.log("binding and one-primary-recipe constraints: passed");
  console.log("native unknown/known-zero persistence constraints: passed");
  console.log("representative child-first pilot reset with migration ledger retained: passed");
  console.log("forced rollback and restart for 011-017: passed");
  console.log("integrity_check and foreign_key_check: passed");
  console.log("ALL INVENTORY REDESIGN MIGRATION CHECKS PASSED");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
  fs.rmSync(compiledDir, { recursive: true, force: true });
}
