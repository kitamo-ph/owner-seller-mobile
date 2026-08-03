const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workspace = process.cwd();
const migrationDirectory = path.join(workspace, "src/db/migrations");
const compiledDirectory = path.join(
  workspace,
  "node_modules/.cache/kitamo-recipe-first-transaction-check",
);
const repositoryCompiledDirectory = path.join(
  workspace,
  "node_modules/.cache/kitamo-recipe-first-repository-check",
);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "kitamo-recipe-first-transactions-"),
);
const databasePath = path.join(temporaryDirectory, "recipe-first.sqlite");
const rollbackDatabasePath = path.join(
  temporaryDirectory,
  "migration-rollback.sqlite",
);
const timestamp = "2026-07-30T00:00:00.000Z";

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
];

function compileMigrations() {
  fs.rmSync(compiledDirectory, { recursive: true, force: true });
  fs.mkdirSync(compiledDirectory, { recursive: true });
  execFileSync(
    path.join(workspace, "node_modules/.bin/tsc"),
    [
      ...migrationSources.map(([file]) => path.join(migrationDirectory, file)),
      "--outDir",
      compiledDirectory,
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
    const compiledPath = path.join(
      compiledDirectory,
      file.replace(/\.ts$/, ".js"),
    );
    return require(compiledPath)[exportName];
  });
}

function compileCostEvidenceRepositories() {
  fs.rmSync(repositoryCompiledDirectory, { recursive: true, force: true });
  const configPath = path.join(
    temporaryDirectory,
    "cost-evidence-tsconfig.json",
  );
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        target: "ES2020",
        module: "commonjs",
        moduleResolution: "node",
        esModuleInterop: true,
        baseUrl: workspace,
        paths: { "@/*": ["src/*"] },
        rootDir: path.join(workspace, "src"),
        outDir: repositoryCompiledDirectory,
      },
      files: [
        path.join(
          workspace,
          "src/db/repositories/recipeDrafts.ts",
        ),
        path.join(
          workspace,
          "src/db/repositories/recipeVersions.ts",
        ),
      ],
    }),
  );
  execFileSync(
    path.join(workspace, "node_modules/.bin/tsc"),
    ["--project", configPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function loadCostEvidenceValidators() {
  const Module = require("node:module");
  const originalLoad = Module._load;
  Module._load = function loadCompiledRepository(
    request,
    parent,
    isMain,
  ) {
    if (request === "@/db/client") {
      return {
        openKitamoDatabase() {
          throw new Error("Repository validator check requires an injected DB.");
        },
      };
    }
    if (request === "@/db/schema") {
      return { countableTables: [] };
    }
    if (request.startsWith("@/")) {
      return originalLoad.call(
        this,
        path.join(repositoryCompiledDirectory, request.slice(2)),
        parent,
        isMain,
      );
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const drafts = require(path.join(
      repositoryCompiledDirectory,
      "db/repositories/recipeDrafts.js",
    ));
    const versions = require(path.join(
      repositoryCompiledDirectory,
      "db/repositories/recipeVersions.js",
    ));
    const conversionChains = require(path.join(
      repositoryCompiledDirectory,
      "domain/recipeConversionChains.js",
    ));
    return {
      validateDraft:
        drafts.validateRecipeDraftLineCostEvidenceInTransaction,
      validateVersion:
        versions.validateRecipeVersionLineCostEvidenceInTransaction,
      buildConversionChain: conversionChains.buildRecipeConversionChain,
      serializeConversionChain: conversionChains.serializeRecipeConversionChain,
    };
  } finally {
    Module._load = originalLoad;
  }
}

function sqliteAt(dbPath, statement, json = false) {
  const args = ["-bail"];
  if (json) args.push("-json");
  args.push(dbPath, `PRAGMA foreign_keys = ON; ${statement}`);
  return execFileSync("sqlite3", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sqlite(statement, json = false) {
  return sqliteAt(databasePath, statement, json);
}

function rows(statement) {
  return JSON.parse(sqlite(statement, true) || "[]");
}

function count(tableName, whereClause = "1 = 1") {
  return Number(
    sqlite(`SELECT COUNT(*) FROM ${tableName} WHERE ${whereClause};`),
  );
}

function expectRejected(statement, message) {
  assert.throws(() => sqlite(statement), message);
}

function applyMigration(dbPath, migration) {
  sqliteAt(
    dbPath,
    `BEGIN EXCLUSIVE;
     ${migration.up}
     INSERT INTO schema_migrations (id, applied_at)
     VALUES ('${migration.id}', '${timestamp}');
     COMMIT;`,
  );
}

function applyMigrations(dbPath, migrations, through = migrations.length) {
  sqliteAt(
    dbPath,
    "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);",
  );
  for (const migration of migrations.slice(0, through)) {
    applyMigration(dbPath, migration);
  }
}

function columnExists(dbPath, tableName, columnName) {
  const tableInfo = JSON.parse(
    sqliteAt(dbPath, `PRAGMA table_info(${tableName});`, true) || "[]",
  );
  return tableInfo.some((column) => column.name === columnName);
}

function tableExists(dbPath, tableName) {
  return (
    sqliteAt(
      dbPath,
      `SELECT COUNT(*) FROM sqlite_master
       WHERE type = 'table' AND name = '${tableName}';`,
    ) === "1"
  );
}

function checkMigration015Atomicity(migrations) {
  applyMigrations(rollbackDatabasePath, migrations, 14);
  const migration = migrations[14];
  assert.equal(migration.id, "015_recipe_first_costs");
  assert.equal(tableExists(rollbackDatabasePath, "catalog_cost_profiles"), false);
  assert.equal(
    columnExists(rollbackDatabasePath, "recipe_draft_lines", "cost_source"),
    false,
  );
  sqliteAt(
    rollbackDatabasePath,
    `INSERT INTO businesses (
       id, business_name, business_type, owner_name, barangay,
       preferred_language, currency, created_at, updated_at, sync_status
     ) VALUES (
       'business-backfill', 'Backfill Test', 'food', 'Owner', 'Barangay',
       'Taglish', 'PHP', '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO products (
       id, business_id, name, category, price, cost, stock_qty, unit_type,
       low_stock_threshold, active, product_type, created_at, updated_at,
       sync_status
     ) VALUES (
       'product-backfill', 'business-backfill', 'Unknown Cost Output',
       'Recipe', 0, 0, 0, 'piece', 0, 0, 'cooked food',
       '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO catalog_items (
       id, business_id, name, normalized_name, source_type, classification,
       lifecycle_status, readiness_state, classification_review_required,
       sellable, kiosk_enabled, purchase_cost_state, selling_price_state,
       stock_policy, created_at, updated_at, sync_status
     ) VALUES (
       'catalog-backfill', 'business-backfill', 'Unknown Cost Output',
       'unknown cost output', 'native', 'finished_product', 'draft',
       'incomplete', 0, 0, 0, 'not_applicable', 'unknown', 'product_lots',
       '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO recipes (
       id, business_id, output_product_id, name, output_quantity, output_unit,
       production_mode, is_active, created_at, updated_at, sync_status,
       active_version_id, versioning_state
     ) VALUES (
       'recipe-backfill', 'business-backfill', 'product-backfill',
       'Unknown Cost Output', 1, 'piece', 'prepared_before_selling', 1,
       '${timestamp}', '${timestamp}', 'local', NULL, 'native'
     );
     INSERT INTO recipe_versions (
       id, business_id, recipe_id, version_number, status, name_snapshot,
       output_catalog_item_id, output_product_id_snapshot,
       expected_output_quantity, expected_output_unit, production_mode,
       selling_price_state, source_kind, graph_state, cost_state, effective_at,
       created_at, updated_at, sync_status
     ) VALUES (
       'version-backfill', 'business-backfill', 'recipe-backfill', 1,
       'published', 'Unknown Cost Output', 'catalog-backfill',
       'product-backfill', 1, 'piece', 'prepared_before_selling', 'unknown',
       'native_publish', 'incomplete', 'unknown', '${timestamp}',
       '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO recipe_version_lines (
       id, business_id, recipe_version_id, sort_order, source_kind,
       custom_name_snapshot, quantity, unit, role, is_optional, cost_state,
       allocation_mode, created_at, updated_at, sync_status
     ) VALUES (
       'line-backfill', 'business-backfill', 'version-backfill', 0,
       'custom_cost', 'Unknown custom input', 1, 'piece', 'main', 0,
       'unknown', 'none', '${timestamp}', '${timestamp}', 'local'
     );`,
  );

  assert.throws(
    () =>
      sqliteAt(
        rollbackDatabasePath,
        `BEGIN EXCLUSIVE;
         ${migration.up}
         INSERT INTO schema_migrations (id, applied_at)
         VALUES ('${migration.id}', '${timestamp}');
         SELECT * FROM forced_recipe_first_migration_failure;
         COMMIT;`,
      ),
    "a failed migration 015 transaction must throw",
  );
  assert.equal(
    sqliteAt(
      rollbackDatabasePath,
      "SELECT COUNT(*) FROM schema_migrations WHERE id = '015_recipe_first_costs';",
    ),
    "0",
    "the failed migration must not leave a ledger row",
  );
  assert.equal(
    tableExists(rollbackDatabasePath, "catalog_cost_profiles"),
    false,
    "migration 015 table DDL must roll back",
  );
  assert.equal(
    tableExists(rollbackDatabasePath, "recipe_version_cost_summaries"),
    false,
    "migration 015 summary DDL must roll back",
  );
  assert.equal(
    columnExists(rollbackDatabasePath, "recipe_draft_lines", "cost_source"),
    false,
    "migration 015 draft-line ALTER must roll back",
  );
  assert.equal(
    columnExists(rollbackDatabasePath, "recipe_version_lines", "cost_profile_id"),
    false,
    "migration 015 version-line ALTER must roll back",
  );
  assert.equal(
    sqliteAt(
      rollbackDatabasePath,
      "SELECT cost_state FROM recipe_version_lines WHERE id = 'line-backfill';",
    ),
    "unknown",
    "a failed migration must preserve the pre-015 unknown cost state",
  );

  applyMigration(rollbackDatabasePath, migration);
  assert.equal(tableExists(rollbackDatabasePath, "catalog_cost_profiles"), true);
  assert.equal(
    columnExists(rollbackDatabasePath, "recipe_draft_lines", "cost_source"),
    true,
  );
  assert.deepEqual(
    JSON.parse(
      sqliteAt(
        rollbackDatabasePath,
        `SELECT cost_state, cost_source, cost_profile_id
         FROM recipe_version_lines
         WHERE id = 'line-backfill';`,
        true,
      ) || "[]",
    ),
    [
      {
        cost_state: "unknown",
        cost_source: "unknown",
        cost_profile_id: null,
      },
    ],
    "migration 015 must not relabel unknown historical cost as an authoritative snapshot",
  );
  assert.equal(
    sqliteAt(rollbackDatabasePath, "PRAGMA integrity_check;"),
    "ok",
  );
  assert.equal(
    sqliteAt(rollbackDatabasePath, "PRAGMA foreign_key_check;"),
    "",
  );
}

function seedFoundation() {
  sqlite(
    `BEGIN EXCLUSIVE;
     INSERT INTO businesses (
       id, business_name, business_type, owner_name, barangay,
       preferred_language, currency, created_at, updated_at, sync_status
     ) VALUES (
       'business-1', 'KitaMo Recipe-first Test', 'food', 'Owner', 'Barangay',
       'Taglish', 'PHP', '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO branches (
       id, business_id, branch_name, branch_type, active,
       created_at, updated_at, sync_status
     ) VALUES (
       'branch-1', 'business-1', 'Main', 'stall', 1,
       '${timestamp}', '${timestamp}', 'local'
     );

     INSERT INTO products (
       id, business_id, branch_id, name, category, price, cost, stock_qty,
       unit_type, low_stock_threshold, active, product_type,
       created_at, updated_at, sync_status
     ) VALUES
       (
         'product-resale', 'business-1', 'branch-1', 'Bottled Water',
         'Grocery', 20, 10, 8, 'pcs', 2, 1, 'retail item',
         '${timestamp}', '${timestamp}', 'local'
       ),
       (
         'product-legacy', 'business-1', 'branch-1', 'Legacy Bagong Paninda',
         'General', 40, 25, 3, 'pcs', 1, 1, 'retail item',
         '${timestamp}', '${timestamp}', 'local'
       );
     INSERT INTO catalog_items (
       id, business_id, branch_id, name, normalized_name, source_type,
       classification, lifecycle_status, readiness_state,
       classification_review_required, sellable, kiosk_enabled,
       purchase_cost_state, selling_price_state, stock_policy,
       created_at, updated_at, sync_status
     ) VALUES
       (
         'catalog-resale', 'business-1', 'branch-1', 'Bottled Water',
         'bottled water', 'native', 'direct_resale_product', 'active', 'ready',
         0, 1, 1, 'known', 'known', 'product_lots',
         '${timestamp}', '${timestamp}', 'local'
       ),
       (
         'catalog-legacy', 'business-1', 'branch-1',
         'Legacy Bagong Paninda', 'legacy bagong paninda', 'legacy_product',
         'legacy_unclassified', 'draft', 'legacy_review', 1, 0, 0,
         'known', 'known', 'product_scalar',
         '${timestamp}', '${timestamp}', 'local'
       );
     INSERT INTO legacy_item_bindings (
       id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
       projection_role, binding_status, compatibility_mode, review_required,
       legacy_active_snapshot, migration_provenance, reviewed_at,
       native_activated_at, created_at, updated_at, sync_status
     ) VALUES
       (
         'binding-resale', 'business-1', 'catalog-resale', 'product',
         'product-resale', 'sale_product', 'active', 'native', 0, 1, 'native',
         '${timestamp}', '${timestamp}', '${timestamp}', '${timestamp}', 'local'
       ),
       (
         'binding-legacy', 'business-1', 'catalog-legacy', 'product',
         'product-legacy', 'legacy_product', 'active', 'legacy_unclassified',
         1, 1, 'migration_011', NULL, NULL, '${timestamp}', '${timestamp}',
         'local'
       );
     COMMIT;`,
  );
}

function compatibilityFingerprint() {
  return [
    sqlite(
      `SELECT id, business_id, branch_id, name, category, price, cost,
         stock_qty, unit_type, low_stock_threshold, active, product_type,
         created_at, updated_at, sync_status, deleted_at
       FROM products
       WHERE id IN ('product-resale', 'product-legacy')
       ORDER BY id;`,
      true,
    ),
    sqlite(
      `SELECT id, business_id, branch_id, name, normalized_name, source_type,
         classification, lifecycle_status, readiness_state,
         classification_review_required, sellable, kiosk_enabled,
         purchase_cost_state, selling_price_state, stock_policy, archived_at,
         created_at, updated_at, sync_status, deleted_at
       FROM catalog_items
       WHERE id IN ('catalog-resale', 'catalog-legacy')
       ORDER BY id;`,
      true,
    ),
    sqlite(
      `SELECT id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
         projection_role, binding_status, compatibility_mode, review_required,
         legacy_active_snapshot, legacy_deleted_at_snapshot,
         migration_provenance, reviewed_at, native_activated_at,
         created_at, updated_at, sync_status, deleted_at
       FROM legacy_item_bindings
       WHERE id IN ('binding-resale', 'binding-legacy')
       ORDER BY id;`,
      true,
    ),
  ];
}

function recipeFirstStartStatements(identity, mode) {
  const isFinished = mode === "finished_per_unit";
  const classification = isFinished ? "finished_product" : "prepared_base";
  const outputQuantity = isFinished ? "1" : "NULL";
  const outputUnit = isFinished ? "'pcs'" : "NULL";
  const sellingPriceState = isFinished ? "unknown" : "not_applicable";
  const productType = isFinished ? "cooked food" : "ingredient-based";

  return `
    INSERT INTO catalog_items (
      id, business_id, branch_id, name, normalized_name, source_type,
      classification, lifecycle_status, readiness_state,
      classification_review_required, sellable, kiosk_enabled,
      purchase_cost_state, selling_price_state, stock_policy,
      created_at, updated_at, sync_status
    ) VALUES (
      'catalog-${identity}', 'business-1', 'branch-1', 'Recipe ${identity}',
      'recipe ${identity}', 'native', '${classification}', 'draft',
      'incomplete', 0, 0, 0, 'not_applicable', '${sellingPriceState}',
      'product_lots', '${timestamp}', '${timestamp}', 'local'
    );
    INSERT INTO products (
      id, business_id, branch_id, name, category, price, cost, stock_qty,
      unit_type, low_stock_threshold, active, product_type,
      created_at, updated_at, sync_status
    ) VALUES (
      'product-${identity}', 'business-1', 'branch-1', 'Recipe ${identity}',
      'Recipe', 0, 0, 0, 'pcs', 0, 0, '${productType}',
      '${timestamp}', '${timestamp}', 'local'
    );
    INSERT INTO legacy_item_bindings (
      id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
      projection_role, binding_status, compatibility_mode, review_required,
      legacy_active_snapshot, migration_provenance,
      created_at, updated_at, sync_status
    ) VALUES (
      'binding-${identity}', 'business-1', 'catalog-${identity}', 'product',
      'product-${identity}', 'recipe_output', 'active', 'native', 0, 0,
      'native', '${timestamp}', '${timestamp}', 'local'
    );
    INSERT INTO recipe_drafts (
      id, business_id, branch_id, output_catalog_item_id, name,
      expected_output_quantity, expected_output_unit, production_mode,
      classification_proposal, selling_price_state, sellable, kiosk_enabled,
      editor_step, lifecycle_status, autosave_revision, last_saved_at,
      unresolved_requirement_count, created_at, updated_at, sync_status
    ) VALUES (
      'draft-${identity}', 'business-1', 'branch-1', 'catalog-${identity}',
      'Recipe ${identity}', ${outputQuantity}, ${outputUnit},
      'prepared_before_selling', '${classification}', '${sellingPriceState}',
      0, 0, 'definition', 'editing', 0, '${timestamp}', 0,
      '${timestamp}', '${timestamp}', 'local'
    );
  `;
}

function assertIdentityCardinality(identity) {
  assert.equal(
    count("catalog_items", `id = 'catalog-${identity}' AND deleted_at IS NULL`),
    1,
  );
  assert.equal(
    count("products", `id = 'product-${identity}' AND deleted_at IS NULL`),
    1,
  );
  assert.equal(
    count(
      "legacy_item_bindings",
      `id = 'binding-${identity}'
       AND catalog_item_id = 'catalog-${identity}'
       AND legacy_entity_id = 'product-${identity}'
       AND projection_role = 'recipe_output'
       AND compatibility_mode = 'native'
       AND deleted_at IS NULL`,
    ),
    1,
  );
  assert.equal(
    count(
      "recipe_drafts",
      `id = 'draft-${identity}'
       AND output_catalog_item_id = 'catalog-${identity}'
       AND deleted_at IS NULL`,
    ),
    1,
  );
}

function checkAtomicRecipeFirstStarts() {
  for (const tableName of [
    "catalog_items",
    "products",
    "legacy_item_bindings",
    "recipe_drafts",
  ]) {
    assert.equal(
      count(tableName, `id LIKE '%-finished'`),
      0,
      "the finished Recipe must start without a prior projection",
    );
  }

  assert.throws(
    () =>
      sqlite(
        `BEGIN EXCLUSIVE;
         ${recipeFirstStartStatements("finished", "finished_per_unit")}
         SELECT * FROM forced_recipe_first_start_failure;
         COMMIT;`,
      ),
    "a failed Recipe-first start must throw",
  );
  for (const tableName of [
    "catalog_items",
    "products",
    "legacy_item_bindings",
    "recipe_drafts",
  ]) {
    assert.equal(
      count(tableName, `id LIKE '%-finished'`),
      0,
      "a failed Recipe-first start must leave no partial identity",
    );
  }

  sqlite(
    `BEGIN EXCLUSIVE;
     ${recipeFirstStartStatements("finished", "finished_per_unit")}
     COMMIT;`,
  );
  assertIdentityCardinality("finished");
  assert.deepEqual(
    rows(
      `SELECT
         p.active AS product_active,
         p.price,
         p.cost,
         p.stock_qty,
         ci.lifecycle_status,
         ci.readiness_state,
         ci.sellable,
         ci.kiosk_enabled,
         d.expected_output_quantity,
         d.expected_output_unit
       FROM products p
       INNER JOIN legacy_item_bindings b ON b.legacy_entity_id = p.id
       INNER JOIN catalog_items ci ON ci.id = b.catalog_item_id
       INNER JOIN recipe_drafts d ON d.output_catalog_item_id = ci.id
       WHERE p.id = 'product-finished';`,
    ),
    [
      {
        product_active: 0,
        price: 0.0,
        cost: 0.0,
        stock_qty: 0.0,
        lifecycle_status: "draft",
        readiness_state: "incomplete",
        sellable: 0,
        kiosk_enabled: 0,
        expected_output_quantity: 1.0,
        expected_output_unit: "pcs",
      },
    ],
  );

  expectRejected(
    `BEGIN EXCLUSIVE;
     ${recipeFirstStartStatements("finished", "finished_per_unit")}
     COMMIT;`,
    "retrying with the same exact identity must not duplicate projections",
  );
  assertIdentityCardinality("finished");

  sqlite(
    `BEGIN EXCLUSIVE;
     ${recipeFirstStartStatements("batch", "prepared_batch")}
     COMMIT;`,
  );
  assertIdentityCardinality("batch");
  assert.deepEqual(
    rows(
      `SELECT expected_output_quantity, expected_output_unit,
              classification_proposal
       FROM recipe_drafts WHERE id = 'draft-batch';`,
    ),
    [
      {
        expected_output_quantity: null,
        expected_output_unit: null,
        classification_proposal: "prepared_base",
      },
    ],
    "a prepared batch must not invent a yield",
  );
}

const kioskEligibilityQuery = `
  SELECT p.id
  FROM catalog_items ci
  INNER JOIN legacy_item_bindings b
    ON b.catalog_item_id = ci.id
    AND b.entity_kind = 'product'
    AND b.deleted_at IS NULL
  INNER JOIN products p
    ON p.id = b.legacy_entity_id
    AND p.deleted_at IS NULL
  WHERE ci.business_id = 'business-1'
    AND ci.deleted_at IS NULL
    AND (p.branch_id = 'branch-1' OR p.branch_id IS NULL)
    AND (
      (
        b.compatibility_mode = 'legacy_unclassified'
        AND ci.classification = 'legacy_unclassified'
        AND b.review_required = 1
      )
      OR
      (
        b.compatibility_mode IN ('reviewed_legacy', 'native')
        AND b.review_required = 0
        AND ci.lifecycle_status = 'active'
        AND ci.classification IN (
          'prepared_base',
          'finished_product',
          'direct_resale_product',
          'bundle_combo'
        )
        AND ci.sellable = 1
        AND ci.kiosk_enabled = 1
        AND ci.selling_price_state = 'known'
        AND p.active = 1
        AND (
          ci.classification IN ('direct_resale_product', 'bundle_combo')
          OR EXISTS (
            SELECT 1
            FROM catalog_item_recipe_roles role
            INNER JOIN recipes r
              ON r.id = role.recipe_id
              AND r.active_version_id IS NOT NULL
              AND r.is_active = 1
              AND r.deleted_at IS NULL
            WHERE role.output_catalog_item_id = ci.id
              AND role.status = 'active'
              AND role.deleted_at IS NULL
              AND role.role IN ('primary', 'kiosk_cook_upon_order')
          )
        )
      )
    )
  ORDER BY p.id;
`;

function checkDraftEligibilityAndCompatibility(beforeFingerprint) {
  assert.deepEqual(
    rows(kioskEligibilityQuery),
    [{ id: "product-legacy" }, { id: "product-resale" }],
    "draft native outputs must stay excluded while legacy and direct-resale behavior remains eligible",
  );
  assert.deepEqual(
    compatibilityFingerprint(),
    beforeFingerprint,
    "Recipe-first persistence must not rewrite direct resale or legacy Bagong Paninda facts",
  );
}

function addEstimatedPreparedInput() {
  sqlite(
    `BEGIN EXCLUSIVE;
     ${recipeFirstStartStatements("estimate", "prepared_batch")}
     INSERT INTO catalog_cost_profiles (
       id, business_id, catalog_item_id, source_kind, total_cost,
       reference_quantity, reference_unit, request_token, status,
       effective_at, created_at, updated_at, sync_status
     ) VALUES (
       'profile-estimate', 'business-1', 'catalog-estimate',
       'owner_estimate', 20, 5, 'pcs', 'estimate-request-1', 'active',
       '${timestamp}', '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO recipe_draft_lines (
       id, business_id, recipe_draft_id, sort_order, source_kind,
       catalog_item_id, quantity, unit, role, is_optional, cost_override,
       cost_state, allocation_mode, cost_source, cost_profile_id,
       created_at, updated_at, sync_status
     ) VALUES (
       'line-parent-estimate', 'business-1', 'draft-finished', 0,
       'catalog_item', 'catalog-estimate', 2, 'pcs', 'main', 0, 4,
       'known', 'none', 'owner_estimate', 'profile-estimate',
       '${timestamp}', '${timestamp}', 'local'
     );
     UPDATE recipe_drafts
     SET autosave_revision = autosave_revision + 1,
         updated_at = '${timestamp}'
     WHERE id = 'draft-finished' AND autosave_revision = 0;
     COMMIT;`,
  );

  assertIdentityCardinality("estimate");
  assert.deepEqual(
    rows(
      `SELECT source_kind, total_cost, reference_quantity, reference_unit,
              request_token, status, source_recipe_version_id
       FROM catalog_cost_profiles WHERE id = 'profile-estimate';`,
    ),
    [
      {
        source_kind: "owner_estimate",
        total_cost: 20.0,
        reference_quantity: 5.0,
        reference_unit: "pcs",
        request_token: "estimate-request-1",
        status: "active",
        source_recipe_version_id: null,
      },
    ],
  );
  assert.deepEqual(
    rows(
      `SELECT source_kind, catalog_item_id, quantity, unit, cost_override,
              cost_state, cost_source, cost_profile_id
       FROM recipe_draft_lines WHERE id = 'line-parent-estimate';`,
    ),
    [
      {
        source_kind: "catalog_item",
        catalog_item_id: "catalog-estimate",
        quantity: 2.0,
        unit: "pcs",
        cost_override: 4.0,
        cost_state: "known",
        cost_source: "owner_estimate",
        cost_profile_id: "profile-estimate",
      },
    ],
    "estimated prepared input must link one stable catalog identity and exact cost profile",
  );
}

function createHistoricalParentSnapshot() {
  sqlite(
    `BEGIN EXCLUSIVE;
     INSERT INTO recipes (
       id, business_id, output_product_id, name, output_quantity, output_unit,
       production_mode, suggested_selling_price, is_active,
       created_at, updated_at, sync_status, versioning_state
     ) VALUES (
       'recipe-parent', 'business-1', 'product-finished', 'Recipe finished',
       1, 'pcs', 'prepared_before_selling', NULL, 1,
       '${timestamp}', '${timestamp}', 'local', 'native'
     );
     INSERT INTO recipe_versions (
       id, business_id, recipe_id, version_number, status, name_snapshot,
       output_catalog_item_id, output_product_id_snapshot,
       expected_output_quantity, expected_output_unit, production_mode,
       selling_price_state, source_kind, source_draft_id, graph_state,
       cost_state, effective_at, created_at, updated_at, sync_status
     ) VALUES (
       'version-parent-1', 'business-1', 'recipe-parent', 1, 'published',
       'Recipe finished', 'catalog-finished', 'product-finished', 1, 'pcs',
       'prepared_before_selling', 'unknown', 'native_publish',
       'draft-finished', 'complete', 'known', '${timestamp}',
       '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO recipe_version_lines (
       id, business_id, recipe_version_id, sort_order, source_kind,
       catalog_item_id, quantity, unit, role, is_optional, cost_override,
       cost_per_unit_snapshot, line_cost_snapshot, cost_state, allocation_mode,
       cost_source, cost_profile_id, created_at, updated_at, sync_status
     ) VALUES (
       'version-line-parent-estimate', 'business-1', 'version-parent-1', 0,
       'catalog_item', 'catalog-estimate', 2, 'pcs', 'main', 0, 4, 4, 8,
       'known', 'none', 'owner_estimate', 'profile-estimate',
       '${timestamp}', '${timestamp}', 'local'
     );
     INSERT INTO recipe_version_cost_summaries (
       id, business_id, recipe_version_id, status, total_cost,
       cost_per_output_unit, known_cost_subtotal, missing_required_count,
       estimated_input_count, created_at, sync_status
     ) VALUES (
       'summary-parent-1', 'business-1', 'version-parent-1', 'estimated',
       8, 8, 8, 0, 1, '${timestamp}', 'local'
     );
     UPDATE recipes
     SET active_version_id = 'version-parent-1'
     WHERE id = 'recipe-parent';
     COMMIT;`,
  );
}

function completionStatements() {
  const completionTimestamp = "2026-07-30T01:00:00.000Z";
  return `
    INSERT INTO recipes (
      id, business_id, output_product_id, name, output_quantity, output_unit,
      production_mode, suggested_selling_price, is_active,
      created_at, updated_at, sync_status, versioning_state
    ) VALUES (
      'recipe-estimate', 'business-1', 'product-estimate', 'Recipe estimate',
      2, 'pcs', 'prepared_before_selling', NULL, 1,
      '${completionTimestamp}', '${completionTimestamp}', 'local', 'native'
    );
    INSERT INTO recipe_versions (
      id, business_id, recipe_id, version_number, status, name_snapshot,
      output_catalog_item_id, output_product_id_snapshot,
      expected_output_quantity, expected_output_unit, production_mode,
      selling_price_state, source_kind, source_draft_id, graph_state,
      cost_state, effective_at, created_at, updated_at, sync_status
    ) VALUES (
      'version-estimate-1', 'business-1', 'recipe-estimate', 1, 'published',
      'Recipe estimate', 'catalog-estimate', 'product-estimate', 2, 'pcs',
      'prepared_before_selling', 'not_applicable', 'native_publish',
      'draft-estimate', 'complete', 'known', '${completionTimestamp}',
      '${completionTimestamp}', '${completionTimestamp}', 'local'
    );
    INSERT INTO recipe_version_cost_summaries (
      id, business_id, recipe_version_id, status, total_cost,
      cost_per_output_unit, known_cost_subtotal, missing_required_count,
      estimated_input_count, created_at, sync_status
    ) VALUES (
      'summary-estimate-1', 'business-1', 'version-estimate-1', 'actual',
      12, 6, 12, 0, 0, '${completionTimestamp}', 'local'
    );
    UPDATE recipes
    SET active_version_id = 'version-estimate-1',
        updated_at = '${completionTimestamp}'
    WHERE id = 'recipe-estimate';
    UPDATE recipe_drafts
    SET recipe_id = 'recipe-estimate',
        expected_output_quantity = 2,
        expected_output_unit = 'pcs',
        lifecycle_status = 'published',
        published_version_id = 'version-estimate-1',
        updated_at = '${completionTimestamp}'
    WHERE id = 'draft-estimate';
    INSERT INTO catalog_item_recipe_roles (
      id, business_id, output_catalog_item_id, recipe_id, role, status,
      effective_at, created_at, updated_at, sync_status
    ) VALUES (
      'role-estimate-primary', 'business-1', 'catalog-estimate',
      'recipe-estimate', 'primary', 'active', '${completionTimestamp}',
      '${completionTimestamp}', '${completionTimestamp}', 'local'
    );
    UPDATE catalog_cost_profiles
    SET status = 'superseded',
        superseded_at = '${completionTimestamp}',
        updated_at = '${completionTimestamp}'
    WHERE id = 'profile-estimate' AND status = 'active';
    INSERT INTO catalog_cost_profiles (
      id, business_id, catalog_item_id, source_kind, total_cost,
      reference_quantity, reference_unit, source_recipe_version_id,
      supersedes_profile_id, status, effective_at,
      created_at, updated_at, sync_status
    ) VALUES (
      'profile-recipe', 'business-1', 'catalog-estimate',
      'recipe_version', 12, 2, 'pcs', 'version-estimate-1',
      'profile-estimate', 'active', '${completionTimestamp}',
      '${completionTimestamp}', '${completionTimestamp}', 'local'
    );
    UPDATE recipe_draft_lines
    SET cost_override = 6,
        cost_source = 'recipe_version',
        cost_profile_id = 'profile-recipe',
        updated_at = '${completionTimestamp}'
    WHERE id = 'line-parent-estimate'
      AND cost_profile_id = 'profile-estimate';
  `;
}

function checkEstimateToRecipeTransition() {
  const historicalVersionBefore = sqlite(
    `SELECT * FROM recipe_version_lines
     WHERE id = 'version-line-parent-estimate';`,
    true,
  );
  const historicalSummaryBefore = sqlite(
    `SELECT * FROM recipe_version_cost_summaries
     WHERE id = 'summary-parent-1';`,
    true,
  );

  assert.throws(
    () =>
      sqlite(
        `BEGIN EXCLUSIVE;
         ${completionStatements()}
         SELECT * FROM forced_estimate_completion_failure;
         COMMIT;`,
      ),
    "a failed estimate completion must throw",
  );
  assert.equal(count("recipes", "id = 'recipe-estimate'"), 0);
  assert.equal(count("recipe_versions", "id = 'version-estimate-1'"), 0);
  assert.equal(count("catalog_cost_profiles", "id = 'profile-recipe'"), 0);
  assert.equal(
    sqlite(
      "SELECT status FROM catalog_cost_profiles WHERE id = 'profile-estimate';",
    ),
    "active",
    "failed completion must leave the estimate active",
  );
  assert.equal(
    sqlite(
      "SELECT cost_source FROM recipe_draft_lines WHERE id = 'line-parent-estimate';",
    ),
    "owner_estimate",
  );

  sqlite(
    `BEGIN EXCLUSIVE;
     ${completionStatements()}
     COMMIT;`,
  );

  assertIdentityCardinality("estimate");
  assert.deepEqual(
    rows(
      `SELECT id, source_kind, total_cost, reference_quantity, reference_unit,
              request_token, source_recipe_version_id, supersedes_profile_id,
              status, superseded_at
       FROM catalog_cost_profiles
       WHERE catalog_item_id = 'catalog-estimate'
       ORDER BY created_at, id;`,
    ),
    [
      {
        id: "profile-estimate",
        source_kind: "owner_estimate",
        total_cost: 20.0,
        reference_quantity: 5.0,
        reference_unit: "pcs",
        request_token: "estimate-request-1",
        source_recipe_version_id: null,
        supersedes_profile_id: null,
        status: "superseded",
        superseded_at: "2026-07-30T01:00:00.000Z",
      },
      {
        id: "profile-recipe",
        source_kind: "recipe_version",
        total_cost: 12.0,
        reference_quantity: 2.0,
        reference_unit: "pcs",
        request_token: null,
        source_recipe_version_id: "version-estimate-1",
        supersedes_profile_id: "profile-estimate",
        status: "active",
        superseded_at: null,
      },
    ],
    "completion must switch the one active profile without deleting its estimate",
  );
  assert.deepEqual(
    rows(
      `SELECT recipe_id, output_catalog_item_id, output_product_id_snapshot,
              expected_output_quantity, expected_output_unit
       FROM recipe_versions WHERE id = 'version-estimate-1';`,
    ),
    [
      {
        recipe_id: "recipe-estimate",
        output_catalog_item_id: "catalog-estimate",
        output_product_id_snapshot: "product-estimate",
        expected_output_quantity: 2.0,
        expected_output_unit: "pcs",
      },
    ],
    "the completed Recipe must reuse the estimated prepared item's identity",
  );
  assert.deepEqual(
    rows(
      `SELECT cost_source, cost_profile_id, cost_override
       FROM recipe_draft_lines WHERE id = 'line-parent-estimate';`,
    ),
    [
      {
        cost_source: "recipe_version",
        cost_profile_id: "profile-recipe",
        cost_override: 6.0,
      },
    ],
    "the mutable parent draft must adopt exact Recipe-derived cost evidence",
  );
  assert.equal(
    sqlite(
      `SELECT COUNT(*) FROM catalog_cost_profiles
       WHERE catalog_item_id = 'catalog-estimate'
         AND status = 'active' AND deleted_at IS NULL;`,
    ),
    "1",
  );
  assert.equal(
    sqlite(
      `SELECT COUNT(*) FROM recipe_version_cost_summaries
       WHERE recipe_version_id = 'version-estimate-1'
         AND status = 'actual' AND total_cost = 12
         AND cost_per_output_unit = 6;`,
    ),
    "1",
  );
  assert.equal(
    sqlite(
      `SELECT COUNT(*) FROM recipe_version_lines
       WHERE id = 'version-line-parent-estimate'
         AND cost_source = 'owner_estimate'
         AND cost_profile_id = 'profile-estimate'
         AND cost_per_unit_snapshot = 4
         AND line_cost_snapshot = 8;`,
    ),
    "1",
    "the already-published parent line must preserve estimate provenance and numbers",
  );
  assert.equal(
    sqlite(
      `SELECT COUNT(*) FROM recipe_version_cost_summaries
       WHERE id = 'summary-parent-1'
         AND status = 'estimated'
         AND total_cost = 8
         AND estimated_input_count = 1;`,
    ),
    "1",
    "the already-published parent cost summary must remain estimated",
  );
  assert.equal(
    sqlite(
      `SELECT * FROM recipe_version_lines
       WHERE id = 'version-line-parent-estimate';`,
      true,
    ),
    historicalVersionBefore,
    "Recipe completion must not rewrite immutable parent version-line evidence",
  );
  assert.equal(
    sqlite(
      `SELECT * FROM recipe_version_cost_summaries
       WHERE id = 'summary-parent-1';`,
      true,
    ),
    historicalSummaryBefore,
    "Recipe completion must not rewrite immutable parent cost summaries",
  );
}

function checkRecipeFirstSchemaConstraints() {
  expectRejected(
    `INSERT INTO catalog_cost_profiles (
       id, business_id, catalog_item_id, source_kind, total_cost,
       reference_quantity, reference_unit, status, effective_at, superseded_at,
       created_at, updated_at, sync_status
     ) VALUES (
       'bad-estimate-no-token', 'business-1', 'catalog-estimate',
       'owner_estimate', 1, 1, 'pcs', 'superseded', '${timestamp}', '${timestamp}',
       '${timestamp}', '${timestamp}', 'local'
     );`,
    "owner estimates without a request token must be rejected",
  );
  expectRejected(
    `INSERT INTO catalog_cost_profiles (
       id, business_id, catalog_item_id, source_kind, total_cost,
       reference_quantity, reference_unit, request_token,
       source_recipe_version_id, status, effective_at, superseded_at,
       created_at, updated_at, sync_status
     ) VALUES (
       'bad-recipe-token', 'business-1', 'catalog-estimate',
       'recipe_version', 12, 2, 'pcs', 'not-allowed', 'version-estimate-1',
       'superseded', '${timestamp}', '${timestamp}', '${timestamp}', '${timestamp}', 'local'
     );`,
    "Recipe-derived profiles with estimate tokens must be rejected",
  );
  expectRejected(
    `INSERT INTO catalog_cost_profiles (
       id, business_id, catalog_item_id, source_kind, total_cost,
       reference_quantity, reference_unit, source_recipe_version_id,
       status, effective_at, superseded_at, created_at, updated_at, sync_status
     ) VALUES (
       'bad-second-active', 'business-1', 'catalog-estimate',
       'recipe_version', 12, 2, 'pcs', 'version-parent-1',
       'active', '${timestamp}', '${timestamp}', '${timestamp}', 'local'
     );`,
    "an item must not have two active cost profiles",
  );
  expectRejected(
    `INSERT INTO catalog_cost_profiles (
       id, business_id, catalog_item_id, source_kind, total_cost,
       reference_quantity, reference_unit, source_recipe_version_id,
       status, effective_at, created_at, updated_at, sync_status
     ) VALUES (
       'bad-duplicate-version-profile', 'business-1', 'catalog-finished',
       'recipe_version', 12, 2, 'pcs', 'version-estimate-1',
       'superseded', '${timestamp}', '${timestamp}', '${timestamp}',
       '${timestamp}', 'local'
     );`,
    "one immutable Recipe version must not produce multiple cost profiles",
  );
  expectRejected(
    `INSERT INTO recipe_version_cost_summaries (
       id, business_id, recipe_version_id, status, total_cost,
       cost_per_output_unit, known_cost_subtotal, missing_required_count,
       estimated_input_count, created_at, sync_status
     ) VALUES (
       'bad-actual-summary', 'business-1', 'version-estimate-1',
       'actual', 12, 6, 12, 0, 1, '${timestamp}', 'local'
     );`,
    "an actual summary cannot contain estimated inputs",
  );
  expectRejected(
    `INSERT INTO recipe_draft_lines (
       id, business_id, recipe_draft_id, sort_order, source_kind,
       catalog_item_id, quantity, unit, cost_state, allocation_mode,
       cost_source, created_at, updated_at, sync_status
     ) VALUES (
       'bad-cost-source', 'business-1', 'draft-finished', 99,
       'catalog_item', 'catalog-resale', 1, 'pcs', 'known', 'none',
       'guessed_zero', '${timestamp}', '${timestamp}', 'local'
     );`,
    "unrecognized cost provenance must be rejected",
  );
}

async function checkRepositoryCostEvidenceGuards() {
  compileCostEvidenceRepositories();
  const {
    validateDraft,
    validateVersion,
    buildConversionChain,
    serializeConversionChain,
  } =
    loadCostEvidenceValidators();
  assert.equal(typeof validateDraft, "function");
  assert.equal(typeof validateVersion, "function");
  assert.equal(typeof buildConversionChain, "function");
  assert.equal(typeof serializeConversionChain, "function");

  const lots = {
    "lot-rice": {
      business_id: "business-1",
      catalog_item_id: "catalog-rice",
      unit: "kg",
      purchased_quantity: 2,
      cost_state: "known",
      recorded_total_cost: 160,
      recorded_cost_per_unit: 80,
    },
    "lot-zero": {
      business_id: "business-1",
      catalog_item_id: "catalog-free",
      unit: "pcs",
      purchased_quantity: 10,
      cost_state: "known",
      recorded_total_cost: 0,
      recorded_cost_per_unit: 0,
    },
    "lot-unknown": {
      business_id: "business-1",
      catalog_item_id: "catalog-unknown",
      unit: "kg",
      purchased_quantity: 2,
      cost_state: "unknown",
      recorded_total_cost: null,
      recorded_cost_per_unit: null,
    },
  };
  const profiles = {
    "profile-mayo": {
      business_id: "business-1",
      catalog_item_id: "catalog-mayo",
      source_kind: "owner_estimate",
      source_recipe_version_id: null,
      total_cost: 300,
      reference_quantity: 500,
      reference_unit: "ml",
    },
    "profile-rice": {
      business_id: "business-1",
      catalog_item_id: "catalog-cooked-rice",
      source_kind: "recipe_version",
      source_recipe_version_id: "version-cooked-rice",
      total_cost: 80,
      reference_quantity: 1,
      reference_unit: "kg",
    },
  };
  const conversions = {
    "conversion-package-kg": {
      business_id: "business-1",
      catalog_item_id: "catalog-rice",
      from_unit: "package",
      to_unit: "kg",
      factor: 2,
    },
  };
  const versions = {
    "version-cooked-rice": {
      business_id: "business-1",
      output_catalog_item_id: "catalog-cooked-rice",
    },
    "version-other": {
      business_id: "business-1",
      output_catalog_item_id: "catalog-other",
    },
  };
  const evidenceDb = {
    async getFirstAsync(statement, params) {
      if (statement.includes("FROM item_unit_conversions")) {
        return conversions[params[0]] ?? null;
      }
      if (statement.includes("FROM ingredient_lots lot")) {
        return lots[params[0]] ?? null;
      }
      if (statement.includes("FROM catalog_cost_profiles")) {
        return profiles[params[0]] ?? null;
      }
      if (statement.includes("FROM recipe_versions")) {
        return versions[params[0]] ?? null;
      }
      throw new Error(`Unexpected cost-evidence query: ${statement}`);
    },
  };
  const standardGramToKilogram = buildConversionChain([
    {
      fromQuantity: 1_000,
      fromUnit: "g",
      toQuantity: 1,
      toUnit: "kg",
      standard: "metric",
      meaning: "Grams used from exact kilogram lot evidence",
    },
  ]);
  assert.equal(standardGramToKilogram.ok, true);
  const standardGramToKilogramJson = serializeConversionChain(
    standardGramToKilogram.snapshot,
  );
  const packageToKilogram = buildConversionChain([
    {
      fromQuantity: 1,
      fromUnit: "package",
      toQuantity: 2,
      toUnit: "kg",
      standard: "item_specific",
      meaning: "Owner-recorded kilograms per package",
    },
  ]);
  assert.equal(packageToKilogram.ok, true);
  const packageToKilogramJson = serializeConversionChain(
    packageToKilogram.snapshot,
  );
  const draftLine = {
    sourceKind: "catalog_item",
    catalogItemId: "catalog-rice",
    childRecipeVersionId: null,
    childDraftId: null,
    customName: null,
    quantity: 27,
    unit: "g",
    normalizedQuantity: null,
    normalizedUnit: null,
    conversionId: null,
    conversionFactorSnapshot: null,
    role: "main",
    isOptional: false,
    costOverride: 0.08,
    costState: "known",
    costSource: "purchase_lot",
    costProfileId: null,
    allocationMode: "none",
    legacyIngredientLotId: "lot-rice",
    notes: null,
  };
  await assert.doesNotReject(() =>
    validateDraft(draftLine, 0, "business-1", evidenceDb),
  );
  const draftLineWithStandardChain = {
    ...draftLine,
    conversionChainJson: standardGramToKilogramJson,
    unitStandardSnapshot: "metric",
  };
  await assert.doesNotReject(() =>
    validateDraft(
      draftLineWithStandardChain,
      0,
      "business-1",
      evidenceDb,
    ),
  );
  await assert.rejects(
    () =>
      validateDraft(
        {
          ...draftLineWithStandardChain,
          unitStandardSnapshot: "imperial",
        },
        0,
        "business-1",
        evidenceDb,
      ),
    /unit_standard_mismatch/,
    "draft save must reject a conversion with a mismatched unit standard",
  );
  await assert.rejects(
    () =>
      validateDraft(
        {
          ...draftLineWithStandardChain,
          unit: "kg",
        },
        0,
        "business-1",
        evidenceDb,
      ),
    /input_unit_mismatch/,
    "draft save must reject a reversed conversion direction",
  );
  await assert.rejects(
    () =>
      validateDraft(
        { ...draftLine, costOverride: 0.081 },
        0,
        "business-1",
        evidenceDb,
      ),
    /exact lot evidence/,
    "draft save must reject an arbitrary lot-derived amount",
  );
  await assert.doesNotReject(() =>
    validateDraft(
      {
        ...draftLine,
        quantity: 1,
        unit: "package",
        normalizedQuantity: 2,
        normalizedUnit: "kg",
        conversionId: "conversion-package-kg",
        conversionFactorSnapshot: 2,
        conversionChainJson: packageToKilogramJson,
        unitStandardSnapshot: "item_specific",
        costOverride: 160,
      },
      0,
      "business-1",
      evidenceDb,
    ),
  );
  const wrongPackageFactor = buildConversionChain([
    {
      fromQuantity: 1,
      fromUnit: "package",
      toQuantity: 3,
      toUnit: "kg",
      standard: "item_specific",
      meaning: "Contradictory kilograms per package",
    },
  ]);
  assert.equal(wrongPackageFactor.ok, true);
  await assert.rejects(
    () =>
      validateDraft(
        {
          ...draftLine,
          quantity: 1,
          unit: "package",
          normalizedQuantity: 2,
          normalizedUnit: "kg",
          conversionId: "conversion-package-kg",
          conversionFactorSnapshot: 2,
          conversionChainJson: serializeConversionChain(
            wrongPackageFactor.snapshot,
          ),
          unitStandardSnapshot: "item_specific",
          costOverride: 160,
        },
        0,
        "business-1",
        evidenceDb,
      ),
    /factor_mismatch/,
    "draft save must reject a chain factor detached from persisted conversion evidence",
  );
  await assert.doesNotReject(() =>
    validateDraft(
      {
        ...draftLine,
        catalogItemId: "catalog-free",
        quantity: 1,
        unit: "pcs",
        costOverride: 0,
        legacyIngredientLotId: "lot-zero",
      },
      0,
      "business-1",
      evidenceDb,
    ),
  );
  const unknownDraftLine = {
    ...draftLine,
    catalogItemId: "catalog-unknown",
    costOverride: null,
    costState: "unknown",
    legacyIngredientLotId: "lot-unknown",
  };
  await assert.doesNotReject(() =>
    validateDraft(unknownDraftLine, 0, "business-1", evidenceDb),
  );
  await assert.rejects(
    () =>
      validateDraft(
        {
          ...unknownDraftLine,
          costOverride: 0,
          costState: "known",
        },
        0,
        "business-1",
        evidenceDb,
      ),
    /must remain unknown/,
    "a compatibility zero must not turn unknown lot cost into known cost",
  );
  const ownerEstimateDraftLine = {
    ...draftLine,
    catalogItemId: "catalog-mayo",
    quantity: 5,
    unit: "ml",
    costOverride: 0.6,
    costSource: "owner_estimate",
    costProfileId: "profile-mayo",
    legacyIngredientLotId: null,
  };
  await assert.doesNotReject(() =>
    validateDraft(
      ownerEstimateDraftLine,
      0,
      "business-1",
      evidenceDb,
    ),
  );
  await assert.rejects(
    () =>
      validateDraft(
        { ...ownerEstimateDraftLine, costOverride: 0.61 },
        0,
        "business-1",
        evidenceDb,
      ),
    /exact profile/,
    "draft save must reject an arbitrary estimate-derived amount",
  );
  const childDraftLine = {
    ...draftLine,
    sourceKind: "child_recipe_version",
    catalogItemId: null,
    childRecipeVersionId: "version-cooked-rice",
    costSource: "recipe_version",
    costProfileId: "profile-rice",
    legacyIngredientLotId: null,
  };
  await assert.doesNotReject(() =>
    validateDraft(childDraftLine, 0, "business-1", evidenceDb),
  );
  await assert.rejects(
    () =>
      validateDraft(
        {
          ...childDraftLine,
          childRecipeVersionId: "version-other",
        },
        0,
        "business-1",
        evidenceDb,
      ),
    /exact source/,
    "a Recipe-derived profile must pin its exact child version",
  );

  const versionLotLine = {
    sourceKind: "catalog_item",
    catalogItemId: "catalog-rice",
    childRecipeVersionId: null,
    customName: null,
    quantity: 27,
    unit: "g",
    normalizedQuantity: null,
    normalizedUnit: null,
    conversionId: null,
    conversionFactorSnapshot: null,
    role: "main",
    isOptional: false,
    costOverride: null,
    costPerUnitSnapshot: 0.08,
    lineCostSnapshot: 2.16,
    costState: "known",
    costSource: "purchase_lot",
    costProfileId: null,
    allocationMode: "none",
  };
  await assert.doesNotReject(() =>
    validateVersion(
      {
        ...versionLotLine,
        conversionChainJson: standardGramToKilogramJson,
        unitStandardSnapshot: "metric",
      },
      0,
      "business-1",
      "lot-rice",
      evidenceDb,
    ),
  );
  await assert.rejects(
    () =>
      validateVersion(
        {
          ...versionLotLine,
          conversionChainJson: standardGramToKilogramJson,
          unitStandardSnapshot: "imperial",
        },
        0,
        "business-1",
        "lot-rice",
        evidenceDb,
      ),
    /unit_standard_mismatch/,
    "publication must reject a conversion standard detached from its immutable chain",
  );
  await assert.rejects(
    () =>
      validateVersion(
        {
          ...versionLotLine,
          costPerUnitSnapshot: 0.081,
          lineCostSnapshot: 2.187,
        },
        0,
        "business-1",
        "lot-rice",
        evidenceDb,
      ),
    /exact lot evidence/,
    "immutable publication must re-derive lot cost evidence",
  );
  await assert.doesNotReject(() =>
    validateVersion(
      {
        ...versionLotLine,
        catalogItemId: "catalog-unknown",
        costPerUnitSnapshot: null,
        lineCostSnapshot: null,
        costState: "unknown",
      },
      0,
      "business-1",
      "lot-unknown",
      evidenceDb,
    ),
  );
  const versionEstimateLine = {
    ...versionLotLine,
    catalogItemId: "catalog-mayo",
    quantity: 5,
    unit: "ml",
    costPerUnitSnapshot: 0.6,
    lineCostSnapshot: 3,
    costSource: "owner_estimate",
    costProfileId: "profile-mayo",
  };
  await assert.doesNotReject(() =>
    validateVersion(
      versionEstimateLine,
      0,
      "business-1",
      null,
      evidenceDb,
    ),
  );
  await assert.rejects(
    () =>
      validateVersion(
        {
          ...versionEstimateLine,
          costPerUnitSnapshot: 0.61,
          lineCostSnapshot: 3.05,
        },
        0,
        "business-1",
        null,
        evidenceDb,
      ),
    /exact profile/,
    "immutable publication must re-derive profile cost evidence",
  );
  const versionChildLine = {
    ...versionLotLine,
    sourceKind: "child_recipe_version",
    catalogItemId: null,
    childRecipeVersionId: "version-cooked-rice",
    costPerUnitSnapshot: null,
    lineCostSnapshot: 2.16,
    costSource: "recipe_version",
    costProfileId: "profile-rice",
  };
  await assert.doesNotReject(() =>
    validateVersion(
      versionChildLine,
      0,
      "business-1",
      null,
      evidenceDb,
    ),
  );
  await assert.rejects(
    () =>
      validateVersion(
        {
          ...versionChildLine,
          childRecipeVersionId: "version-other",
        },
        0,
        "business-1",
        null,
        evidenceDb,
      ),
    /exact source/,
    "immutable publication must reject a mismatched child/profile pair",
  );
}

function checkSourceBoundaries() {
  const servicePath = path.join(workspace, "src/services/recipeFirst.ts");
  assert.equal(
    fs.existsSync(servicePath),
    true,
    "src/services/recipeFirst.ts must implement the Recipe-first orchestration boundary",
  );
  const serviceSource = fs.readFileSync(servicePath, "utf8");
  for (const exportName of [
    "loadRecipeLibrary",
    "startRecipeFirstDraft",
    "loadRecipeFirstDraft",
    "saveRecipeFirstDraftSnapshot",
    "createRecipeFirstUnitConversion",
    "addQuickEstimatedPreparedInput",
    "beginNestedPreparedRecipeDraft",
    "completePreparedItemRecipe",
    "publishRecipeFirstDraft",
    "duplicateRecipeFirstItem",
    "archiveRecipeFirstItem",
    "deleteRecipeFirstItem",
  ]) {
    assert.match(
      serviceSource,
      new RegExp(
        `export\\s+(?:async\\s+function|function|const)\\s+${exportName}\\b`,
      ),
      `${exportName} must remain an explicit service API`,
    );
  }
  assert.match(
    serviceSource,
    /withExclusiveTransactionAsync/,
    "Recipe-first coordinated writes must use an exclusive SQLite transaction",
  );
  for (const requiredWrite of [
    "INSERT INTO catalog_items",
    "INSERT INTO products",
    "INSERT INTO legacy_item_bindings",
    "INSERT INTO recipe_drafts",
  ]) {
    assert.match(
      serviceSource,
      new RegExp(requiredWrite),
      `Recipe-first service must own ${requiredWrite}`,
    );
  }
  assert.match(serviceSource, /owner_estimate/);
  assert.match(serviceSource, /recipe_version/);
  assert.match(
    serviceSource,
    /activeRecipeId:\s*row\.active_recipe_id/,
    "library entries must expose the exact Recipe owning the active version",
  );
  assert.match(
    serviceSource,
    /active_version\.id\s*=\s*recipe\.active_version_id/,
    "library selection must resolve the Recipe active-version pointer",
  );
  assert.match(
    serviceSource,
    /row\.selling_price_state\s*===\s*"known"\s*\?\s*row\.selling_price\s*:\s*null/,
    "library selling price must remain null unless its state is known",
  );
  assert.match(
    serviceSource,
    /versionId:\s*generated\.versionId/,
    "caller-coordinated version identity must reach immutable publication",
  );
  assert.match(
    serviceSource,
    /requirePreparedClassification:\s*true/,
    "prepared-item completion must require prepared classification in transaction",
  );
  assert.match(
    serviceSource,
    /!line\.isOptional[\s\S]*missingRequiredCount\s*\+=\s*1/,
    "unknown optional costs must not become required publication blockers",
  );
  assert.match(
    serviceSource,
    /Estimate request token was replayed with changed coordinated evidence/,
    "quick-estimate replay must reject changed coordinated evidence",
  );
  assert.match(
    serviceSource,
    /const isFirstPublication\s*=\s*!priorVersion/,
    "publication must distinguish first-time activation from active edits",
  );
  assert.match(
    serviceSource,
    /active_state_preserved/,
    "publishing an edit must report preservation of active native state",
  );
  assert.match(
    serviceSource,
    /DELETE FROM catalog_cost_profiles[\s\S]*source_kind = 'owner_estimate'/,
    "safe deletion may remove only detached, self-owned estimate evidence",
  );
  assert.doesNotMatch(
    serviceSource,
    /UPDATE\s+recipe_version_lines/i,
    "Recipe-first orchestration must not rewrite immutable version lines",
  );
  assert.doesNotMatch(
    serviceSource,
    /UPDATE\s+recipe_version_cost_summaries/i,
    "Recipe-first orchestration must not rewrite immutable cost summaries",
  );

  const costProfileSource = fs.readFileSync(
    path.join(workspace, "src/db/repositories/catalogCostProfiles.ts"),
    "utf8",
  );
  assert.match(costProfileSource, /activateCatalogCostProfileInTransaction/);
  assert.match(costProfileSource, /expectedActiveProfileId/);
  assert.match(costProfileSource, /status = 'superseded'/);
  assert.match(costProfileSource, /requestToken/);
  assert.match(costProfileSource, /createRecipeVersionCostSummary/);

  const draftRepositorySource = fs.readFileSync(
    path.join(workspace, "src/db/repositories/recipeDrafts.ts"),
    "utf8",
  );
  assert.match(
    draftRepositorySource,
    /await validateRecipeDraftLineCostEvidenceInTransaction\(/,
    "draft replacement must validate exact line-cost evidence in transaction",
  );
  const versionRepositorySource = fs.readFileSync(
    path.join(workspace, "src/db/repositories/recipeVersions.ts"),
    "utf8",
  );
  assert.match(
    versionRepositorySource,
    /await validateRecipeVersionLineCostEvidenceInTransaction\(/,
    "immutable publication must validate exact line-cost evidence in transaction",
  );

  const catalogSource = fs.readFileSync(
    path.join(workspace, "src/db/repositories/catalogItems.ts"),
    "utf8",
  );
  assert.match(catalogSource, /listKioskEligibleCatalogProducts/);
  assert.match(catalogSource, /b\.compatibility_mode = 'legacy_unclassified'/);
  assert.match(catalogSource, /ci\.lifecycle_status = 'active'/);
  assert.match(catalogSource, /ci\.kiosk_enabled = 1/);
  assert.match(catalogSource, /p\.active = 1/);
}

async function main() {
  try {
    compileMigrations();
    const migrations = loadMigrations();
    assert.equal(migrations.length, 16);
    checkMigration015Atomicity(migrations);

    applyMigrations(databasePath, migrations);
    seedFoundation();
    const beforeCompatibilityFingerprint = compatibilityFingerprint();
    checkAtomicRecipeFirstStarts();
    checkDraftEligibilityAndCompatibility(beforeCompatibilityFingerprint);
    addEstimatedPreparedInput();
    createHistoricalParentSnapshot();
    checkEstimateToRecipeTransition();
    checkRecipeFirstSchemaConstraints();
    checkDraftEligibilityAndCompatibility(beforeCompatibilityFingerprint);
    await checkRepositoryCostEvidenceGuards();
    checkSourceBoundaries();

    assert.equal(sqlite("PRAGMA integrity_check;"), "ok");
    assert.equal(sqlite("PRAGMA foreign_key_check;"), "");

    console.log("migration 015 rollback and restart: passed");
    console.log("atomic Recipe-first identity start and retry cardinality: passed");
    console.log("finished-per-unit and prepared-batch yield defaults: passed");
    console.log("inactive native draft Kiosk exclusion: passed");
    console.log("direct-resale and legacy compatibility preservation: passed");
    console.log("owner estimate to Recipe-version cost switch: passed");
    console.log("immutable historical cost evidence preservation: passed");
    console.log("strict transactional line-cost evidence guards: passed");
    console.log("Recipe-first schema provenance constraints: passed");
    console.log("Recipe-first service and repository boundaries: passed");
    console.log("integrity_check and foreign_key_check: passed");
    console.log("ALL RECIPE-FIRST TRANSACTION CHECKS PASSED");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    fs.rmSync(compiledDirectory, { recursive: true, force: true });
    fs.rmSync(repositoryCompiledDirectory, {
      recursive: true,
      force: true,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
