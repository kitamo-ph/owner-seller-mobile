const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const workspace = process.cwd();
const migrationDirectory = path.join(workspace, "src/db/migrations");
const compiledDirectory = path.join(
  workspace,
  "node_modules/.cache/kitamo-inventory-redesign-transaction-check",
);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "kitamo-redesign-transactions-"),
);
const databasePath = path.join(temporaryDirectory, "transactions.sqlite");
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
];

function compileMigrations() {
  fs.rmSync(compiledDirectory, { force: true, recursive: true });
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

function sqlite(statement, json = false) {
  const args = ["-bail"];
  if (json) args.push("-json");
  args.push(databasePath, `PRAGMA foreign_keys = ON; ${statement}`);
  return execFileSync("sqlite3", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function scalar(statement) {
  return sqlite(statement);
}

function count(tableName, whereClause = "1 = 1") {
  return Number(scalar(`SELECT COUNT(*) FROM ${tableName} WHERE ${whereClause};`));
}

function loadRepositoryModule(relativePath) {
  const absolutePath = path.join(workspace, relativePath);
  const output = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  const ids = {
    makeRecipeDraftId: () => "generated-draft",
    makeRecipeDraftLineId: () => "generated-draft-line",
    makeRecipeRoleId: () => "generated-role",
    makeRecipeVersionId: () => "generated-version",
    makeRecipeVersionLineId: () => "generated-version-line",
  };
  const shared = {
    getRepositoryDatabase: (db) => db,
    nowIso: () => "2026-07-26T06:00:00.000Z",
    toBoolean: (value) => value === 1,
    toInteger: (value) => (value ? 1 : 0),
  };
  const localRequire = (request) => {
    if (request === "@/domain/ids") return ids;
    if (request === "./shared") return shared;
    throw new Error(`Unexpected repository-check import: ${request}`);
  };
  const execute = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    output,
  );
  execute(
    loaded.exports,
    localRequire,
    loaded,
    absolutePath,
    path.dirname(absolutePath),
  );
  return loaded.exports;
}

function createNestedDraftFake({ failParentRevisionUpdate = false } = {}) {
  let state = {
    parent: {
      id: "parent-draft",
      business_id: "business-1",
      lifecycle_status: "editing",
      autosave_revision: 4,
    },
    line: {
      id: "parent-line",
      recipe_draft_id: "parent-draft",
      source_kind: "unresolved",
      catalog_item_id: null,
      child_recipe_version_id: null,
      child_draft_id: null,
    },
    children: {},
  };
  const database = {
    async withExclusiveTransactionAsync(operation) {
      const snapshot = JSON.parse(JSON.stringify(state));
      try {
        return await operation(database);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
    async getFirstAsync(statement, parameters) {
      if (
        statement.includes(
          "SELECT business_id, lifecycle_status, autosave_revision",
        )
      ) {
        return parameters[0] === state.parent.id ? { ...state.parent } : null;
      }
      if (
        statement.includes(
          "SELECT source_kind, catalog_item_id, child_recipe_version_id",
        )
      ) {
        return parameters[0] === state.line.id &&
          parameters[1] === state.parent.id
          ? { ...state.line }
          : null;
      }
      if (statement.includes("SELECT * FROM recipe_drafts")) {
        return state.children[parameters[0]]
          ? { ...state.children[parameters[0]] }
          : null;
      }
      throw new Error(`Unexpected nested-draft query: ${statement}`);
    },
    async runAsync(statement, parameters) {
      if (statement.includes("INSERT INTO recipe_drafts")) {
        const [
          id,
          businessId,
          branchId,
          recipeId,
          sourceVersionId,
          outputCatalogItemId,
          name,
          notes,
          timestamp,
          parentDraftId,
          parentLineId,
          returnRoute,
          createdAt,
          updatedAt,
        ] = parameters;
        state.children[id] = {
          id,
          business_id: businessId,
          branch_id: branchId,
          recipe_id: recipeId,
          source_version_id: sourceVersionId,
          output_catalog_item_id: outputCatalogItemId,
          name,
          category: null,
          notes,
          expected_output_quantity: null,
          expected_output_unit: null,
          production_mode: null,
          suggested_selling_price: null,
          classification_proposal: null,
          selling_price_state: "unknown",
          sellable: 0,
          kiosk_enabled: 0,
          editor_step: "definition",
          lifecycle_status: "editing",
          autosave_revision: 0,
          last_saved_at: timestamp,
          unresolved_requirement_count: 0,
          parent_draft_id: parentDraftId,
          parent_line_id: parentLineId,
          return_route: returnRoute,
          published_version_id: null,
          created_at: createdAt,
          updated_at: updatedAt,
          deleted_at: null,
        };
        return { changes: 1 };
      }
      if (statement.includes("SET source_kind = 'child_draft'")) {
        if (
          state.line.source_kind !== "unresolved" ||
          state.line.child_draft_id !== null
        ) {
          return { changes: 0 };
        }
        state.line.source_kind = "child_draft";
        state.line.child_draft_id = parameters[0];
        return { changes: 1 };
      }
      if (
        statement.includes(
          "SET autosave_revision = autosave_revision + 1",
        )
      ) {
        if (
          failParentRevisionUpdate ||
          state.parent.id !== parameters[2] ||
          state.parent.autosave_revision !== parameters[4]
        ) {
          return { changes: 0 };
        }
        state.parent.autosave_revision += 1;
        return { changes: 1 };
      }
      throw new Error(`Unexpected nested-draft write: ${statement}`);
    },
  };
  return {
    database,
    snapshot: () => JSON.parse(JSON.stringify(state)),
  };
}

async function checkAtomicNestedDraftRepository() {
  const { beginNestedRecipeDraft } = loadRepositoryModule(
    "src/db/repositories/recipeDrafts.ts",
  );
  const input = {
    id: "child-draft",
    businessId: "business-1",
    parentDraftId: "parent-draft",
    parentLineId: "parent-line",
    parentExpectedRevision: 4,
    returnRoute: "/owner/recipes/parent-draft",
  };

  const success = createNestedDraftFake();
  const child = await beginNestedRecipeDraft(input, success.database);
  const saved = success.snapshot();
  assert.equal(child.parentDraftId, "parent-draft");
  assert.equal(child.parentLineId, "parent-line");
  assert.equal(saved.parent.autosave_revision, 5);
  assert.equal(saved.line.source_kind, "child_draft");
  assert.equal(saved.line.child_draft_id, "child-draft");

  const rollback = createNestedDraftFake({
    failParentRevisionUpdate: true,
  });
  await assert.rejects(
    beginNestedRecipeDraft(input, rollback.database),
    /Parent Recipe draft changed before nested save/,
  );
  const rolledBack = rollback.snapshot();
  assert.equal(rolledBack.parent.autosave_revision, 4);
  assert.equal(rolledBack.line.source_kind, "unresolved");
  assert.equal(rolledBack.line.child_draft_id, null);
  assert.equal(rolledBack.children["child-draft"], undefined);
}

function createPublicationFake(persistedLine) {
  let writes = 0;
  const database = {
    async withExclusiveTransactionAsync(operation) {
      return operation(database);
    },
    async getFirstAsync(statement) {
      if (statement.includes("FROM recipes")) {
        return {
          id: "recipe-1",
          business_id: "business-1",
          output_product_id: "product-1",
          active_version_id: null,
        };
      }
      if (statement.includes("FROM catalog_items item")) {
        return {
          business_id: "business-1",
          legacy_entity_id: "product-1",
          binding_status: "active",
        };
      }
      if (statement.includes("FROM recipe_drafts")) {
        return {
          business_id: "business-1",
          recipe_id: "recipe-1",
          output_catalog_item_id: "catalog-product-1",
          name: "Native Recipe",
          category: null,
          expected_output_quantity: 1,
          expected_output_unit: "pcs",
          production_mode: "prepared_before_selling",
          suggested_selling_price: null,
          selling_price_state: "unknown",
          autosave_revision: 3,
          lifecycle_status: "ready",
          unresolved_requirement_count: 0,
        };
      }
      throw new Error(`Unexpected publication query: ${statement}`);
    },
    async getAllAsync(statement) {
      if (statement.includes("FROM recipe_draft_lines")) {
        return [{ ...persistedLine }];
      }
      throw new Error(`Unexpected publication list query: ${statement}`);
    },
    async runAsync() {
      writes += 1;
      return { changes: 1 };
    },
  };
  return { database, writes: () => writes };
}

async function checkPersistedDraftCostEvidence() {
  const { publishRecipeVersion } = loadRepositoryModule(
    "src/db/repositories/recipeVersions.ts",
  );
  const persistedLine = {
    source_kind: "catalog_item",
    catalog_item_id: "catalog-supply-1",
    child_recipe_version_id: null,
    custom_name: null,
    quantity: 1,
    unit: "pcs",
    normalized_quantity: null,
    normalized_unit: null,
    conversion_id: null,
    conversion_factor_snapshot: null,
    role: "main",
    is_optional: 0,
    cost_override: null,
    cost_state: "known",
    allocation_mode: "none",
  };
  const fixture = createPublicationFake(persistedLine);
  await assert.rejects(
    publishRecipeVersion(
      {
        id: "version-cost-mismatch",
        businessId: "business-1",
        recipeId: "recipe-1",
        outputCatalogItemId: "catalog-product-1",
        name: "Native Recipe",
        expectedOutputQuantity: 1,
        expectedOutputUnit: "pcs",
        productionMode: "prepared_before_selling",
        sellingPriceState: "unknown",
        sourceDraftId: "draft-1",
        graphState: "complete",
        costState: "known",
        expectedDraftRevision: 3,
        lines: [
          {
            sourceKind: "catalog_item",
            catalogItemId: "catalog-supply-1",
            quantity: 1,
            unit: "pcs",
            role: "main",
            isOptional: false,
            costPerUnitSnapshot: 6,
            lineCostSnapshot: 6,
            costState: "known",
            allocationMode: "none",
          },
        ],
      },
      fixture.database,
    ),
    /Recipe publication line 1 does not match the saved draft/,
  );
  assert.equal(
    fixture.writes(),
    0,
    "cost mismatch must abort before immutable publication writes",
  );
}

function applyMigrations(migrations) {
  sqlite(
    "CREATE TABLE schema_migrations (id TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL);",
  );
  for (const migration of migrations) {
    sqlite(
      `BEGIN EXCLUSIVE;
       ${migration.up}
       INSERT INTO schema_migrations (id, applied_at)
       VALUES ('${migration.id}', '2026-07-26T00:00:00.000Z');
       COMMIT;`,
    );
  }
}

function checkCatalogWriterBoundary() {
  const transferSource = fs.readFileSync(
    path.join(workspace, "src/services/transfers.ts"),
    "utf8",
  );
  const productRepositorySource = fs.readFileSync(
    path.join(workspace, "src/db/repositories/products.ts"),
    "utf8",
  );

  assert.equal(
    /INSERT\s+INTO\s+products/i.test(transferSource),
    false,
    "transfer-created Products must not bypass the catalog-aware repository",
  );
  assert.match(
    transferSource,
    /await createProduct\([\s\S]*?\n\s*txn,\n\s*\);/,
    "destination Product creation must use createProduct in the transfer transaction",
  );
  assert.match(
    productRepositorySource,
    /INSERT INTO catalog_items/,
    "createProduct must create catalog identity",
  );
  assert.match(
    productRepositorySource,
    /INSERT INTO legacy_item_bindings/,
    "createProduct must create an exact legacy binding",
  );
}

function checkRepositoryIntegrityBoundaries() {
  const sources = Object.fromEntries(
    [
      "src/db/repositories/stockAdjustments.ts",
      "src/db/repositories/recipeVersions.ts",
      "src/db/repositories/recipeDrafts.ts",
      "src/db/repositories/supplies.ts",
      "src/db/repositories/itemLifecycle.ts",
    ].map((relativePath) => [
      relativePath,
      fs.readFileSync(path.join(workspace, relativePath), "utf8"),
    ]),
  );

  const stockAdjustments =
    sources["src/db/repositories/stockAdjustments.ts"];
  assert.match(stockAdjustments, /item\.stock_policy/);
  assert.match(stockAdjustments, /binding\.compatibility_mode/);
  assert.match(
    stockAdjustments,
    /allocations do not match authoritative stock policy/,
  );

  const recipeVersions = sources["src/db/repositories/recipeVersions.ts"];
  assert.match(recipeVersions, /binding\.legacy_entity_id = \?/);
  assert.match(recipeVersions, /publication does not match the saved draft/);
  assert.match(recipeVersions, /Recipe input catalog item is unavailable/);

  const recipeDrafts = sources["src/db/repositories/recipeDrafts.ts"];
  assert.match(recipeDrafts, /Parent draft is no longer eligible/);
  assert.match(recipeDrafts, /parentLine\.source_kind === "child_recipe_version"/);
  assert.match(recipeDrafts, /autosave_revision = \?/);

  const supplies = sources["src/db/repositories/supplies.ts"];
  assert.match(supplies, /FROM item_unit_conversions/);
  assert.match(supplies, /normalized quantity is inconsistent/);
  assert.match(supplies, /allocationTotal - input\.quantityUsed/);

  const lifecycle = sources["src/db/repositories/itemLifecycle.ts"];
  for (const requiredReferenceTable of [
    "production_plan_requirements",
    "catalog_item_recipe_roles",
    "recipe_drafts",
    "recipe_draft_lines",
    "item_unit_conversions",
  ]) {
    assert.match(
      lifecycle,
      new RegExp(`FROM ${requiredReferenceTable}`),
      `${requiredReferenceTable} must participate in delete eligibility`,
    );
  }
  assert.match(lifecycle, /Catalog item is unavailable for reference checks/);
}

function expectRejected(statement, message) {
  assert.throws(() => sqlite(statement), message);
}

function expectRollback(statements, message) {
  assert.throws(
    () =>
      sqlite(
        `BEGIN EXCLUSIVE;
         ${statements}
         SELECT * FROM forced_failure_for_transaction_check;
         COMMIT;`,
      ),
    message,
  );
}

function seedFoundation() {
  sqlite(
    `BEGIN EXCLUSIVE;
     INSERT INTO businesses (
       id, business_name, business_type, owner_name, barangay,
       preferred_language, currency, created_at, updated_at, sync_status
     ) VALUES (
       'business-1', 'KitaMo Transaction Test', 'food', 'Owner', 'Barangay',
       'Taglish', 'PHP', '2026-07-26T00:00:00.000Z',
       '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO branches (
       id, business_id, branch_name, branch_type, active,
       created_at, updated_at, sync_status
     ) VALUES (
       'branch-1', 'business-1', 'Main', 'stall', 1,
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO products (
       id, business_id, branch_id, name, category, price, cost, stock_qty,
       unit_type, low_stock_threshold, active, product_type,
       created_at, updated_at, sync_status
     ) VALUES (
       'product-1', 'business-1', 'branch-1', 'Native Product', 'Food',
       25, 4, 10, 'pcs', 2, 1, 'cooked food',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO ingredients (
       id, business_id, name, default_unit, category, low_stock_threshold,
       is_active, created_at, updated_at, sync_status
     ) VALUES (
       'ingredient-1', 'business-1', 'Packaging Cup', 'pcs', 'Supplies', 5, 1,
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO ingredient_lots (
       id, business_id, ingredient_id, purchase_date, purchased_quantity,
       remaining_quantity, unit, total_cost, cost_per_unit, status,
       created_at, updated_at, sync_status, cost_state,
       recorded_total_cost, recorded_cost_per_unit, provenance_state
     ) VALUES (
       'ingredient-lot-1', 'business-1', 'ingredient-1', '2026-07-26',
       20, 20, 'pcs', 20, 1, 'active',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local',
       'known', 20, 1, 'purchase_recorded'
     );
     INSERT INTO catalog_items (
       id, business_id, branch_id, name, normalized_name, source_type,
       classification, lifecycle_status, readiness_state,
       classification_review_required, sellable, kiosk_enabled,
       purchase_cost_state, selling_price_state, stock_policy,
       created_at, updated_at, sync_status
     ) VALUES
       (
         'catalog-product-1', 'business-1', 'branch-1', 'Native Product',
         'native product', 'native', 'finished_product', 'active', 'ready',
         0, 1, 1, 'known', 'known', 'product_lots',
         '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
       ),
       (
         'catalog-supply-1', 'business-1', NULL, 'Packaging Cup',
         'packaging cup', 'native', 'supply_packaging', 'active', 'ready',
         0, 0, 0, 'known', 'not_applicable', 'ingredient_lots',
         '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
       );
     INSERT INTO legacy_item_bindings (
       id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
       projection_role, binding_status, compatibility_mode, review_required,
       legacy_active_snapshot, migration_provenance, reviewed_at,
       native_activated_at, created_at, updated_at, sync_status
     ) VALUES
       (
         'binding-product-1', 'business-1', 'catalog-product-1', 'product',
         'product-1', 'sale_product', 'active', 'native', 0, 1, 'native',
         '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z',
         '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
       ),
       (
         'binding-supply-1', 'business-1', 'catalog-supply-1', 'ingredient',
         'ingredient-1', 'supply_ingredient', 'active', 'native', 0, 1,
         'native', '2026-07-26T00:00:00.000Z',
         '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z',
         '2026-07-26T00:00:00.000Z', 'local'
       );
     INSERT INTO product_stock_lots (
       id, business_id, branch_id, product_id, catalog_item_id, origin_kind,
       origin_date, initial_quantity, remaining_quantity, unit,
       recorded_total_cost, recorded_cost_per_unit, cost_state, status,
       provenance_state, created_at, updated_at, sync_status
     ) VALUES (
       'product-lot-1', 'business-1', 'branch-1', 'product-1',
       'catalog-product-1', 'adjustment', '2026-07-26', 10, 10, 'pcs',
       40, 4, 'known', 'active', 'exact',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO recipes (
       id, business_id, output_product_id, name, output_quantity, output_unit,
       production_mode, suggested_selling_price, notes, is_active,
       created_at, updated_at, sync_status, versioning_state
     ) VALUES (
       'recipe-1', 'business-1', 'product-1', 'Native Recipe', 5, 'pcs',
       'prepared_before_selling', 25, NULL, 1,
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local', 'native'
     );
     INSERT INTO recipe_drafts (
       id, business_id, branch_id, recipe_id, output_catalog_item_id, name,
       expected_output_quantity, expected_output_unit, production_mode,
       suggested_selling_price, selling_price_state, sellable, kiosk_enabled,
       editor_step, lifecycle_status, autosave_revision, last_saved_at,
       unresolved_requirement_count, created_at, updated_at, sync_status
     ) VALUES (
       'draft-1', 'business-1', 'branch-1', 'recipe-1',
       'catalog-product-1', 'Native Recipe', 5, 'pcs',
       'prepared_before_selling', 25, 'known', 1, 1, 'review',
       'ready', 3, '2026-07-26T00:00:00.000Z', 0,
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO sales (
       id, business_id, branch_id, transaction_no, happened_at, amount,
       discount, payment_method, payment_status, checkout_token,
       created_at, updated_at, sync_status
     ) VALUES (
       'sale-1', 'business-1', 'branch-1', 'TX-001',
       '2026-07-26T00:00:00.000Z', 25, 0, 'cash', 'paid', 'checkout-1',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );
     INSERT INTO supply_usage_rules (
       id, business_id, branch_id, supply_catalog_item_id,
       supply_ingredient_id, target_product_id, supply_category,
       consumption_stage, scope, behavior, rounding_mode, trigger_quantity,
       supply_quantity, supply_unit, version, status, effective_at,
       created_at, updated_at, sync_status
     ) VALUES (
       'supply-rule-1', 'business-1', 'branch-1', 'catalog-supply-1',
       'ingredient-1', 'product-1', 'packaging', 'checkout', 'per_product',
       'required', 'multiply_each', 1, 1, 'pcs', 1, 'active',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z',
       '2026-07-26T00:00:00.000Z', 'local'
     );
     COMMIT;`,
  );
}

function checkSchemaConstraints() {
  expectRejected(
    `INSERT INTO product_stock_lots (
       id, business_id, product_id, catalog_item_id, origin_kind, origin_date,
       initial_quantity, remaining_quantity, unit, cost_state, status,
       provenance_state, created_at, updated_at, sync_status
     ) VALUES (
       'bad-known-cost', 'business-1', 'product-1', 'catalog-product-1',
       'adjustment', '2026-07-26', 1, 1, 'pcs', 'known', 'active', 'exact',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );`,
    "known Product-lot cost without values must be rejected",
  );
  expectRejected(
    `INSERT INTO product_stock_lots (
       id, business_id, product_id, catalog_item_id, origin_kind, origin_date,
       initial_quantity, remaining_quantity, unit, cost_state, status,
       provenance_state, created_at, updated_at, sync_status
     ) VALUES (
       'bad-quantity', 'business-1', 'product-1', 'catalog-product-1',
       'adjustment', '2026-07-26', 1, 2, 'pcs', 'unknown', 'active', 'exact',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );`,
    "remaining Product-lot quantity above initial quantity must be rejected",
  );
  expectRejected(
    `INSERT INTO recipe_draft_lines (
       id, business_id, recipe_draft_id, source_kind, catalog_item_id,
       child_draft_id, quantity, unit, cost_state, allocation_mode,
       created_at, updated_at, sync_status
     ) VALUES (
       'bad-line', 'business-1', 'draft-1', 'catalog_item',
       'catalog-product-1', 'draft-1', 1, 'pcs', 'unknown', 'none',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );`,
    "recipe-draft line with two source identities must be rejected",
  );
  expectRejected(
    `INSERT INTO stock_adjustments (
       id, business_id, catalog_item_id, subject_kind, product_id,
       ingredient_id, request_token, operation, reason_code, accounting_class,
       before_quantity, entered_after_quantity, delta_quantity, unit,
       authorized_mode, created_at, updated_at, sync_status
     ) VALUES (
       'bad-adjustment', 'business-1', 'catalog-product-1', 'product',
       'product-1', 'ingredient-1', 'bad-subject', 'delta', 'other',
       'other_review', 10, 9, -1, 'pcs', 'owner',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );`,
    "stock adjustment with two subject identities must be rejected",
  );
  expectRejected(
    `INSERT INTO supply_usage_rules (
       id, business_id, supply_catalog_item_id, supply_ingredient_id,
       target_product_id, supply_category, consumption_stage, scope, behavior,
       rounding_mode, trigger_quantity, supply_quantity, supply_unit, version,
       status, effective_at, created_at, updated_at, sync_status
     ) VALUES (
       'bad-per-order', 'business-1', 'catalog-supply-1', 'ingredient-1',
       'product-1', 'packaging', 'checkout', 'per_order', 'required',
       'once_per_order', 1, 1, 'pcs', 1, 'active',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z',
       '2026-07-26T00:00:00.000Z', 'local'
     );`,
    "per-order supply rule with a Product target must be rejected",
  );
  expectRejected(
    `INSERT INTO sale_supply_usages (
       id, business_id, checkout_token, supply_catalog_item_id,
       supply_ingredient_id, request_key, status, supply_name_snapshot,
       proposed_quantity, unit, cost_category, unit_cost_snapshot,
       cost_contribution, cost_state,
       stock_tracking_state, created_at, updated_at, sync_status
     ) VALUES (
       'bad-confirmed-usage', 'business-1', 'checkout-bad',
       'catalog-supply-1', 'ingredient-1', 'request-bad', 'confirmed',
       'Packaging Cup', 1, 'pcs', 'packaging_cost', 1, 1, 'known', 'tracked',
       '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z', 'local'
     );`,
    "confirmed supply usage without a sale and used quantity must be rejected",
  );
}

function checkProductAuthorityRollback() {
  expectRollback(
    `UPDATE products
       SET stock_qty = 7, updated_at = '2026-07-26T01:00:00.000Z'
       WHERE id = 'product-1';
     UPDATE product_stock_lots
       SET remaining_quantity = 7, updated_at = '2026-07-26T01:00:00.000Z'
       WHERE id = 'product-lot-1';
     INSERT INTO inventory_movements (
       id, business_id, branch_id, product_id, movement_type, quantity,
       reason, created_at, updated_at, sync_status
     ) VALUES (
       'movement-product-rollback', 'business-1', 'branch-1', 'product-1',
       'adjustment', -3, 'forced rollback',
       '2026-07-26T01:00:00.000Z', '2026-07-26T01:00:00.000Z', 'local'
     );`,
    "Product scalar, Product lot, and movement must roll back together",
  );
  assert.equal(scalar("SELECT stock_qty FROM products WHERE id = 'product-1';"), "10.0");
  assert.equal(
    scalar("SELECT remaining_quantity FROM product_stock_lots WHERE id = 'product-lot-1';"),
    "10.0",
  );
  assert.equal(count("inventory_movements", "id = 'movement-product-rollback'"), 0);
}

function checkAdjustmentRollback() {
  expectRollback(
    `UPDATE ingredient_lots
       SET remaining_quantity = 17, updated_at = '2026-07-26T02:00:00.000Z'
       WHERE id = 'ingredient-lot-1';
     INSERT INTO ingredient_movements (
       id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
       unit_cost, total_cost, reason, created_at, updated_at, sync_status
     ) VALUES (
       'movement-ingredient-rollback', 'business-1', 'ingredient-1',
       'ingredient-lot-1', 'adjustment', -3, 'pcs', 1, -3,
       'forced rollback', '2026-07-26T02:00:00.000Z',
       '2026-07-26T02:00:00.000Z', 'local'
     );
     INSERT INTO stock_adjustments (
       id, business_id, branch_id, catalog_item_id, subject_kind,
       ingredient_id, request_token, operation, reason_code, note,
       accounting_class, before_quantity, entered_after_quantity,
       delta_quantity, unit, authorized_mode, created_at, updated_at, sync_status
     ) VALUES (
       'adjustment-rollback', 'business-1', 'branch-1', 'catalog-supply-1',
       'ingredient', 'ingredient-1', 'adjustment-token-rollback', 'delta',
       'spoilage', 'forced rollback', 'spoilage_loss', 20, 17, -3, 'pcs',
       'owner', '2026-07-26T02:00:00.000Z',
       '2026-07-26T02:00:00.000Z', 'local'
     );
     INSERT INTO stock_adjustment_allocations (
       id, business_id, stock_adjustment_id, lot_kind, ingredient_lot_id,
       before_quantity, delta_quantity, after_quantity, unit, movement_kind,
       ingredient_movement_id, created_at, updated_at, sync_status
     ) VALUES (
       'adjustment-allocation-rollback', 'business-1', 'adjustment-rollback',
       'ingredient', 'ingredient-lot-1', 20, -3, 17, 'pcs', 'ingredient',
       'movement-ingredient-rollback', '2026-07-26T02:00:00.000Z',
       '2026-07-26T02:00:00.000Z', 'local'
     );`,
    "Ingredient balance, movement, adjustment, and allocation must roll back together",
  );
  assert.equal(
    scalar("SELECT remaining_quantity FROM ingredient_lots WHERE id = 'ingredient-lot-1';"),
    "20.0",
  );
  assert.equal(count("ingredient_movements", "id = 'movement-ingredient-rollback'"), 0);
  assert.equal(count("stock_adjustments", "id = 'adjustment-rollback'"), 0);
  assert.equal(
    count("stock_adjustment_allocations", "id = 'adjustment-allocation-rollback'"),
    0,
  );
}

function checkRecipePublishRollback() {
  expectRollback(
    `INSERT INTO recipe_versions (
       id, business_id, recipe_id, version_number, status, name_snapshot,
       output_catalog_item_id, output_product_id_snapshot,
       expected_output_quantity, expected_output_unit, production_mode,
       suggested_selling_price_snapshot, selling_price_state, source_kind,
       source_draft_id, graph_state, cost_state, effective_at,
       created_at, updated_at, sync_status
     ) VALUES (
       'version-rollback', 'business-1', 'recipe-1', 1, 'published',
       'Native Recipe', 'catalog-product-1', 'product-1', 5, 'pcs',
       'prepared_before_selling', 25, 'known', 'native_publish', 'draft-1',
       'complete', 'known', '2026-07-26T03:00:00.000Z',
       '2026-07-26T03:00:00.000Z', '2026-07-26T03:00:00.000Z', 'local'
     );
     INSERT INTO recipe_version_lines (
       id, business_id, recipe_version_id, sort_order, source_kind,
       custom_name_snapshot, quantity, unit, role, is_optional, cost_override,
       cost_state, allocation_mode, created_at, updated_at, sync_status
     ) VALUES (
       'version-line-rollback', 'business-1', 'version-rollback', 0,
       'custom_cost', 'Labor', 1, 'batch', 'supporting', 0, 5, 'known',
       'none', '2026-07-26T03:00:00.000Z',
       '2026-07-26T03:00:00.000Z', 'local'
     );
     INSERT INTO catalog_item_recipe_roles (
       id, business_id, output_catalog_item_id, recipe_id, role, status,
       effective_at, created_at, updated_at, sync_status
     ) VALUES (
       'role-rollback', 'business-1', 'catalog-product-1', 'recipe-1',
       'primary', 'active', '2026-07-26T03:00:00.000Z',
       '2026-07-26T03:00:00.000Z', '2026-07-26T03:00:00.000Z', 'local'
     );
     UPDATE recipes
       SET active_version_id = 'version-rollback',
           updated_at = '2026-07-26T03:00:00.000Z'
       WHERE id = 'recipe-1';
     UPDATE recipe_drafts
       SET lifecycle_status = 'published',
           published_version_id = 'version-rollback',
           updated_at = '2026-07-26T03:00:00.000Z'
       WHERE id = 'draft-1';`,
    "Recipe version, line, role, active pointer, and draft publication must roll back together",
  );
  assert.equal(count("recipe_versions", "id = 'version-rollback'"), 0);
  assert.equal(count("recipe_version_lines", "id = 'version-line-rollback'"), 0);
  assert.equal(count("catalog_item_recipe_roles", "id = 'role-rollback'"), 0);
  assert.equal(
    scalar("SELECT active_version_id IS NULL FROM recipes WHERE id = 'recipe-1';"),
    "1",
  );
  assert.equal(
    scalar("SELECT lifecycle_status FROM recipe_drafts WHERE id = 'draft-1';"),
    "ready",
  );
  assert.equal(
    scalar("SELECT published_version_id IS NULL FROM recipe_drafts WHERE id = 'draft-1';"),
    "1",
  );
}

function checkCheckoutSupplyRollback() {
  expectRollback(
    `UPDATE ingredient_lots
       SET remaining_quantity = 19, updated_at = '2026-07-26T04:00:00.000Z'
       WHERE id = 'ingredient-lot-1';
     INSERT INTO ingredient_movements (
       id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
       unit_cost, total_cost, reason, created_at, updated_at, sync_status
     ) VALUES (
       'movement-supply-rollback', 'business-1', 'ingredient-1',
       'ingredient-lot-1', 'sale_usage', -1, 'pcs', 1, -1,
       'checkout supply', '2026-07-26T04:00:00.000Z',
       '2026-07-26T04:00:00.000Z', 'local'
     );
     INSERT INTO sale_supply_usages (
       id, business_id, sale_id, checkout_token, supply_catalog_item_id,
       supply_ingredient_id, rule_id, request_key, status, consumption_stage,
       supply_name_snapshot, proposed_quantity, quantity_used, unit,
       required_minimum, scope_snapshot, behavior_snapshot,
       rule_version_snapshot, is_manual_override, cost_category,
       unit_cost_snapshot, cost_contribution, cost_state,
       stock_tracking_state, ingredient_movement_id,
       created_at, updated_at, sync_status
     ) VALUES (
       'supply-usage-rollback', 'business-1', 'sale-1', 'checkout-1',
       'catalog-supply-1', 'ingredient-1', 'supply-rule-1',
       'request-supply-rollback', 'confirmed', 'checkout', 'Packaging Cup',
       1, 1, 'pcs', 1, 'per_product', 'required', 1, 0,
       'packaging_cost', 1, 1, 'known', 'tracked',
       'movement-supply-rollback', '2026-07-26T04:00:00.000Z',
       '2026-07-26T04:00:00.000Z', 'local'
     );
     INSERT INTO sale_supply_lot_usages (
       id, business_id, sale_supply_usage_id, ingredient_lot_id,
       ingredient_movement_id, quantity_used, unit, unit_cost_snapshot,
       cost_contribution, cost_state, allocation_mode,
       created_at, updated_at, sync_status
     ) VALUES (
       'supply-lot-usage-rollback', 'business-1', 'supply-usage-rollback',
       'ingredient-lot-1', 'movement-supply-rollback', 1, 'pcs', 1, 1,
       'known', 'recommended_fifo', '2026-07-26T04:00:00.000Z',
       '2026-07-26T04:00:00.000Z', 'local'
     );`,
    "Supply usage, lot allocation, movement, and balance must roll back together",
  );
  assert.equal(
    scalar("SELECT remaining_quantity FROM ingredient_lots WHERE id = 'ingredient-lot-1';"),
    "20.0",
  );
  assert.equal(count("ingredient_movements", "id = 'movement-supply-rollback'"), 0);
  assert.equal(count("sale_supply_usages", "id = 'supply-usage-rollback'"), 0);
  assert.equal(
    count("sale_supply_lot_usages", "id = 'supply-lot-usage-rollback'"),
    0,
  );
}

async function main() {
  try {
    compileMigrations();
    const migrations = loadMigrations();
    applyMigrations(migrations);
    seedFoundation();
    checkCatalogWriterBoundary();
    checkRepositoryIntegrityBoundaries();
    checkSchemaConstraints();
    checkProductAuthorityRollback();
    checkAdjustmentRollback();
    checkRecipePublishRollback();
    checkCheckoutSupplyRollback();
    await checkAtomicNestedDraftRepository();
    await checkPersistedDraftCostEvidence();

    assert.equal(scalar("PRAGMA integrity_check;"), "ok");
    assert.equal(scalar("PRAGMA foreign_key_check;"), "");
    console.log("transfer-created Product catalog binding boundary: passed");
    console.log("repository authority and identity boundaries: passed");
    console.log("inventory redesign schema constraints: passed");
    console.log("Product lot and scalar authority rollback: passed");
    console.log("stock-adjustment transaction rollback: passed");
    console.log("recipe-version publication rollback: passed");
    console.log("checkout-supply persistence rollback: passed");
    console.log("atomic nested Recipe draft begin and rollback: passed");
    console.log("persisted Recipe draft cost publication guard: passed");
    console.log("integrity_check and foreign_key_check: passed");
    console.log("ALL INVENTORY REDESIGN TRANSACTION CHECKS PASSED");
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
