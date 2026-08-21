/**
 * Real-SQLite transaction checks for executeSimpleNativeProductionPlan.
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const workspace = process.cwd();
const migrationDirectory = path.join(workspace, "src/db/migrations");
const fixedTimestamp = "2026-08-03T00:00:00.000Z";
const BUSINESS = "business-native-exec";
const BRANCH = "branch-native-exec";

function loadTypeScriptModule(relativePath, localRequire = require) {
  const absolutePath = path.join(workspace, relativePath);
  const output = ts.transpileModule(fs.readFileSync(absolutePath, "utf8"), {
    fileName: absolutePath,
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
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

function loadMigrations() {
  return fs
    .readdirSync(migrationDirectory)
    .filter((file) => /^\d{3}_.+\.ts$/.test(file))
    .sort()
    .map((file) => {
      const loaded = loadTypeScriptModule(path.join("src/db/migrations", file));
      const migration = Object.values(loaded).find(
        (value) =>
          value &&
          typeof value === "object" &&
          typeof value.id === "string" &&
          typeof value.up === "string",
      );
      assert.ok(migration, `Could not load migration ${file}.`);
      return migration;
    });
}

function deterministicIds() {
  let sequence = 0;
  const next = (kind) => `exec_${kind}_${++sequence}`;
  return {
    makeIngredientMovementId: () => next("ingredient_movement"),
    makeMovementId: () => next("inventory_movement"),
    makeProductStockLotId: () => next("product_stock_lot"),
    makeProductionBatchId: () => next("production_batch"),
    makeProductionInputAllocationId: () => next("production_input"),
  };
}

function loadExecutorModules() {
  const ids = deterministicIds();
  const shared = {
    getRepositoryDatabase: (database) => {
      if (!database) {
        throw new Error("Native executor checks require an injected database.");
      }
      return database;
    },
    nowIso: () => fixedTimestamp,
    toBoolean: (value) => value === 1,
    toInteger: (value) => (value ? 1 : 0),
  };
  const costState = loadTypeScriptModule("src/domain/costState.ts");
  const catalogItems = loadTypeScriptModule(
    "src/domain/catalogItems.ts",
    (request) => {
      if (request === "./costState") return costState;
      throw new Error(`Unexpected catalog-domain import: ${request}`);
    },
  );
  const stockAuthority = loadTypeScriptModule(
    "src/domain/stockAuthority.ts",
    (request) => {
      if (request === "./catalogItems") return catalogItems;
      throw new Error(`Unexpected stock-authority import: ${request}`);
    },
  );
  const productStockLots = loadTypeScriptModule(
    "src/db/repositories/productStockLots.ts",
    (request) => {
      if (request === "@/domain/ids") return ids;
      if (request === "@/domain/stockAuthority") return stockAuthority;
      if (request === "./shared") return shared;
      throw new Error(`Unexpected product-lot import: ${request}`);
    },
  );
  const productionPlans = loadTypeScriptModule(
    "src/db/repositories/productionPlans.ts",
    (request) => {
      if (request === "@/domain/ids") return ids;
      if (request === "./shared") return shared;
      throw new Error(`Unexpected production-plan import: ${request}`);
    },
  );
  const executor = loadTypeScriptModule(
    "src/services/nativeProductionExecutor.ts",
    (request) => {
      if (request === "@/db/client") {
        return {
          openKitamoDatabase: () => {
            throw new Error("Native executor checks require an injected database.");
          },
        };
      }
      if (request === "@/db/migrations") {
        return { runMigrations: async () => undefined };
      }
      if (request === "@/db/repositories") {
        return {
          addProductStockLotWithScalarProjection:
            productStockLots.addProductStockLotWithScalarProjection,
          getProductionPlanById: productionPlans.getProductionPlanById,
        };
      }
      if (request === "@/domain/ids") return ids;
      throw new Error(`Unexpected executor import: ${request}`);
    },
  );
  return { executor, productStockLots };
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("SQLite parameters must be finite.");
    }
    return String(value);
  }
  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new Error(`Unsupported SQLite parameter type: ${typeof value}`);
}

function normalizedParameters(parameters) {
  return parameters.length === 1 && Array.isArray(parameters[0])
    ? parameters[0]
    : parameters;
}

function bindSql(sql, parameters) {
  const values = normalizedParameters(parameters);
  let bound = "";
  let valueIndex = 0;
  let inSingleQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'") {
      if (inSingleQuote && sql[index + 1] === "'") {
        bound += "''";
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      bound += character;
      continue;
    }
    if (character === "?" && !inSingleQuote) {
      if (valueIndex >= values.length) {
        throw new Error("SQLite statement is missing a bound parameter.");
      }
      bound += sqlLiteral(values[valueIndex]);
      valueIndex += 1;
      continue;
    }
    bound += character;
  }
  if (valueIndex !== values.length) {
    throw new Error("SQLite statement received extra bound parameters.");
  }
  return bound;
}

class SqliteCliDatabase {
  constructor(filename) {
    this.filename = filename;
    this.transactionSequence = 0;
    this.runCli("PRAGMA journal_mode = DELETE;");
  }

  runCli(sql, json = false) {
    const args = ["-bail"];
    if (json) args.push("-json");
    args.push(this.filename);
    return execFileSync("sqlite3", args, {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;\n${sql}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  async execAsync(sql) {
    this.runCli(sql);
  }

  async runAsync(sql, ...parameters) {
    const output = this.runCli(
      `${bindSql(sql, parameters)};
       SELECT changes() AS changes,
         last_insert_rowid() AS lastInsertRowId;`,
      true,
    );
    const result = JSON.parse(output || "[]").at(-1);
    return {
      changes: Number(result?.changes ?? 0),
      lastInsertRowId: Number(result?.lastInsertRowId ?? 0),
    };
  }

  async getFirstAsync(sql, ...parameters) {
    return (await this.getAllAsync(sql, ...parameters))[0] ?? null;
  }

  async getAllAsync(sql, ...parameters) {
    const output = this.runCli(bindSql(sql, parameters), true);
    return JSON.parse(output || "[]");
  }

  async withExclusiveTransactionAsync(operation) {
    this.transactionSequence += 1;
    const transactionPath = `${this.filename}.txn-${process.pid}-${this.transactionSequence}`;
    fs.copyFileSync(this.filename, transactionPath);
    const transaction = new SqliteCliDatabase(transactionPath);
    try {
      const result = await operation(transaction);
      fs.renameSync(transactionPath, this.filename);
      return result;
    } catch (error) {
      fs.rmSync(transactionPath, { force: true });
      throw error;
    }
  }
}

async function createDatabase(migrations) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kitamo-native-exec-"));
  const dbPath = path.join(root, "executor.sqlite");
  const db = new SqliteCliDatabase(dbPath);
  for (const migration of migrations) {
    await db.execAsync(migration.up);
  }
  return { root, db, dbPath };
}

async function seedSimpleFinishedPlan(db, options = {}) {
  const {
    planId = "plan-simple",
    stageId = "stage-simple",
    requirementId = "req-flour",
    allocationId = "alloc-flour",
    secondRequirement = false,
    planCostState = "known",
    planExpectedCost = 12,
    missingCostCount = 0,
    allocationCostState = "known",
    allocationUnitCost = 0.12,
    allocationCostContribution = 12,
    lotRemaining = 1000,
    multiStage = false,
    preparedRequirement = false,
    flourProvenanceJson = JSON.stringify([
      {
        versionId: "version-bread-1",
        versionLabel: "Bread Loaf",
        lineId: "line-flour",
        lineLabel: "Flour",
        quantity: 100,
      },
    ]),
    sugarProvenanceJson = JSON.stringify([
      {
        versionId: "version-bread-1",
        versionLabel: "Bread Loaf",
        lineId: "line-sugar",
        lineLabel: "Sugar",
        quantity: 50,
      },
    ]),
    extraFlourLine = false,
  } = options;

  await db.runAsync(
    `
      INSERT INTO businesses (
        id, business_name, business_type, owner_name, barangay,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'Native Exec', 'karinderya', 'Owner', 'Owner Barangay', ?, ?, 'local', NULL)
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO branches (
        id, business_id, branch_name, branch_type, active,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, 'Main', 'stall', 1, ?, ?, 'local', NULL)
    `,
    [BRANCH, BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO products (
        id, business_id, branch_id, name, category, price, cost, stock_qty,
        unit_type, low_stock_threshold, active, product_type,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (
        'product-bread', ?, ?, 'Bread Loaf', 'Food', 40, 0, 0, 'pcs', 1, 1,
        'cooked food', ?, ?, 'local', NULL
      )
    `,
    [BUSINESS, BRANCH, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO ingredients (
        id, business_id, name, default_unit, category, low_stock_threshold,
        is_active, created_at, updated_at, sync_status, deleted_at
      ) VALUES (
        'ingredient-flour', ?, 'Flour', 'g', 'Raw', 100, 1, ?, ?, 'local', NULL
      )
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  if (secondRequirement) {
    await db.runAsync(
      `
        INSERT INTO ingredients (
          id, business_id, name, default_unit, category, low_stock_threshold,
          is_active, created_at, updated_at, sync_status, deleted_at
        ) VALUES (
          'ingredient-sugar', ?, 'Sugar', 'g', 'Raw', 100, 1, ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp],
    );
  }
  await db.runAsync(
    `
      INSERT INTO ingredient_lots (
        id, business_id, ingredient_id, brand_name, source_name, purchase_date,
        purchased_quantity, remaining_quantity, unit, total_cost, cost_per_unit,
        status, recorded_total_cost, recorded_cost_per_unit, cost_state,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (
        'lot-flour', ?, 'ingredient-flour', 'Brand', 'Market', '2026-08-01',
        1000, ?, 'g', 120, 0.12, 'active', 120, 0.12, 'known',
        ?, ?, 'local', NULL
      )
    `,
    [BUSINESS, lotRemaining, fixedTimestamp, fixedTimestamp],
  );
  if (secondRequirement) {
    await db.runAsync(
      `
        INSERT INTO ingredient_lots (
          id, business_id, ingredient_id, brand_name, source_name, purchase_date,
          purchased_quantity, remaining_quantity, unit, total_cost, cost_per_unit,
          status, recorded_total_cost, recorded_cost_per_unit, cost_state,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (
          'lot-sugar', ?, 'ingredient-sugar', 'Brand', 'Market', '2026-08-01',
          500, 500, 'g', 50, 0.1, 'active', 50, 0.1, 'known',
          ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp],
    );
  }
  await db.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, classification,
        lifecycle_status, readiness_state, classification_review_required,
        sellable, kiosk_enabled, purchase_cost_state, selling_price_state,
        stock_policy, source_type, archived_at, created_at, updated_at,
        sync_status, deleted_at
      ) VALUES
        (
          'catalog-bread', ?, ?, 'Bread Loaf', 'bread loaf', 'finished_product',
          'active', 'ready', 0, 1, 1, 'not_applicable', 'known', 'product_lots',
          'native', NULL, ?, ?, 'local', NULL
        ),
        (
          'catalog-flour', ?, ?, 'Flour', 'flour', 'purchased_ingredient',
          'active', 'ready', 0, 0, 0, 'known', 'not_applicable',
          'ingredient_lots', 'native', NULL, ?, ?, 'local', NULL
        )
    `,
    [
      BUSINESS,
      BRANCH,
      fixedTimestamp,
      fixedTimestamp,
      BUSINESS,
      BRANCH,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
  if (secondRequirement) {
    await db.runAsync(
      `
        INSERT INTO catalog_items (
          id, business_id, branch_id, name, normalized_name, classification,
          lifecycle_status, readiness_state, classification_review_required,
          sellable, kiosk_enabled, purchase_cost_state, selling_price_state,
          stock_policy, source_type, archived_at, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (
          'catalog-sugar', ?, ?, 'Sugar', 'sugar', 'purchased_ingredient',
          'active', 'ready', 0, 0, 0, 'known', 'not_applicable',
          'ingredient_lots', 'native', NULL, ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, BRANCH, fixedTimestamp, fixedTimestamp],
    );
  }
  await db.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, migration_provenance,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES
        (
          'binding-bread', ?, 'catalog-bread', 'product', 'product-bread',
          'recipe_output', 'active', 'native', 0, 1, 'native',
          ?, ?, 'local', NULL
        ),
        (
          'binding-flour', ?, 'catalog-flour', 'ingredient', 'ingredient-flour',
          'stock_ingredient', 'active', 'native', 0, 1, 'native',
          ?, ?, 'local', NULL
        )
    `,
    [
      BUSINESS,
      fixedTimestamp,
      fixedTimestamp,
      BUSINESS,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
  if (secondRequirement) {
    await db.runAsync(
      `
        INSERT INTO legacy_item_bindings (
          id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
          projection_role, binding_status, compatibility_mode, review_required,
          legacy_active_snapshot, migration_provenance,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (
          'binding-sugar', ?, 'catalog-sugar', 'ingredient', 'ingredient-sugar',
          'stock_ingredient', 'active', 'native', 0, 1, 'native',
          ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp],
    );
  }
  await db.runAsync(
    `
      INSERT INTO recipes (
        id, business_id, output_product_id, name, output_quantity, output_unit,
        production_mode, suggested_selling_price, notes, is_active,
        active_version_id, versioning_state,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (
        'recipe-bread', ?, 'product-bread', 'Bread Loaf', 10, 'pcs',
        'prepared_before_selling', 40, NULL, 1, NULL, 'native',
        ?, ?, 'local', NULL
      )
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO recipe_versions (
        id, business_id, recipe_id, version_number, status, name_snapshot,
        category_snapshot, output_catalog_item_id, output_product_id_snapshot,
        expected_output_quantity, expected_output_unit, production_mode,
        suggested_selling_price_snapshot, selling_price_state, notes_snapshot,
        source_kind, source_draft_id, duplicated_from_version_id,
        graph_state, cost_state, effective_at, created_at, updated_at,
        sync_status, deleted_at
      ) VALUES (
        'version-bread-1', ?, 'recipe-bread', 1, 'published', 'Bread Loaf',
        'Food', 'catalog-bread', 'product-bread', 10, 'pcs',
        'prepared_before_selling', 40, 'known', NULL, 'native_publish',
        NULL, NULL, 'complete', 'known', ?, ?, ?, 'local', NULL
      )
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `UPDATE recipes SET active_version_id = 'version-bread-1' WHERE id = 'recipe-bread'`,
  );
  await db.runAsync(
    `
      INSERT INTO recipe_version_lines (
        id, business_id, recipe_version_id, sort_order, source_kind,
        catalog_item_id, quantity, unit, role, is_optional, cost_state,
        allocation_mode, created_at, updated_at, sync_status, deleted_at
      ) VALUES (
        'line-flour', ?, 'version-bread-1', 0, 'catalog_item', 'catalog-flour',
        100, 'g', 'main', 0, 'known', 'recommended_fefo', ?, ?, 'local', NULL
      )
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  if (extraFlourLine) {
    await db.runAsync(
      `
        INSERT INTO recipe_version_lines (
          id, business_id, recipe_version_id, sort_order, source_kind,
          catalog_item_id, quantity, unit, role, is_optional, cost_state,
          allocation_mode, created_at, updated_at, sync_status, deleted_at
        ) VALUES (
          'line-flour-b', ?, 'version-bread-1', 2, 'catalog_item', 'catalog-flour',
          100, 'g', 'supporting', 0, 'known', 'recommended_fefo', ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp],
    );
  }
  if (secondRequirement) {
    await db.runAsync(
      `
        INSERT INTO recipe_version_lines (
          id, business_id, recipe_version_id, sort_order, source_kind,
          catalog_item_id, quantity, unit, role, is_optional, cost_state,
          allocation_mode, created_at, updated_at, sync_status, deleted_at
        ) VALUES (
          'line-sugar', ?, 'version-bread-1', 1, 'catalog_item', 'catalog-sugar',
          50, 'g', 'supporting', 0, 'known', 'recommended_fefo', ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp],
    );
  }

  const expectedTotal =
    planCostState === "known" ? planExpectedCost : null;
  await db.runAsync(
    `
      INSERT INTO production_plans (
        id, business_id, branch_id, root_recipe_id, root_recipe_version_id,
        target_quantity, target_unit, preparation_mode, status,
        calculation_version, stock_observed_at, expected_total_cost, cost_state,
        missing_cost_count, created_at, updated_at, sync_status
      ) VALUES (
        ?, ?, ?, 'recipe-bread', 'version-bread-1', 10, 'pcs', 'prepare_fresh',
        'ready', 1, ?, ?, ?, ?, ?, ?, 'local'
      )
    `,
    [
      planId,
      BUSINESS,
      BRANCH,
      fixedTimestamp,
      expectedTotal,
      planCostState,
      missingCostCount,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
  await db.runAsync(
    `
      INSERT INTO production_plan_stages (
        id, business_id, production_plan_id, recipe_version_id,
        topological_order, expected_input_multiplier, expected_output_quantity,
        expected_output_unit, prepared_stock_quantity, fresh_prepare_quantity,
        status, shortage_state, variance_state, created_at, updated_at, sync_status
      ) VALUES (
        ?, ?, ?, 'version-bread-1', 0, 1, 10, 'pcs', 0, 10,
        'ready', 'none', 'pending', ?, ?, 'local'
      )
    `,
    [stageId, BUSINESS, planId, fixedTimestamp, fixedTimestamp],
  );
  if (multiStage) {
    await db.runAsync(
      `
        INSERT INTO production_plan_stages (
          id, business_id, production_plan_id, recipe_version_id, parent_stage_id,
          topological_order, expected_input_multiplier, expected_output_quantity,
          expected_output_unit, prepared_stock_quantity, fresh_prepare_quantity,
          status, shortage_state, variance_state, created_at, updated_at, sync_status
        ) VALUES (
          'stage-child', ?, ?, 'version-bread-1', ?, 1, 1, 5, 'pcs', 0, 5,
          'ready', 'none', 'pending', ?, ?, 'local'
        )
      `,
      [BUSINESS, planId, stageId, fixedTimestamp, fixedTimestamp],
    );
  }

  const requirementKind = preparedRequirement ? "prepared_product" : "ingredient";
  const requirementCatalog = preparedRequirement
    ? "catalog-bread"
    : "catalog-flour";
  await db.runAsync(
    `
      INSERT INTO production_plan_requirements (
        id, business_id, production_plan_stage_id, catalog_item_id,
        requirement_kind, raw_quantity, raw_unit, provenance_json, is_required,
        expected_cost, cost_state, created_at, updated_at, sync_status
      ) VALUES (
        ?, ?, ?, ?, ?, 100, 'g', ?, 1, ?, ?, ?, ?, 'local'
      )
    `,
    [
      requirementId,
      BUSINESS,
      stageId,
      requirementCatalog,
      requirementKind,
      flourProvenanceJson,
      allocationCostState === "known" ? allocationCostContribution : null,
      allocationCostState === "known" ? "known" : allocationCostState,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
  if (!preparedRequirement) {
    await db.runAsync(
      `
        INSERT INTO production_plan_allocations (
          id, business_id, production_plan_requirement_id, lot_kind,
          ingredient_lot_id, allocation_mode, quantity, unit, unit_cost_snapshot,
          cost_contribution, cost_state, selection_state, sort_order,
          created_at, updated_at, sync_status
        ) VALUES (
          ?, ?, ?, 'ingredient', 'lot-flour', 'recommended_fefo', 100, 'g',
          ?, ?, ?, 'recommended', 0, ?, ?, 'local'
        )
      `,
      [
        allocationId,
        BUSINESS,
        requirementId,
        allocationCostState === "known" ? allocationUnitCost : null,
        allocationCostState === "known" ? allocationCostContribution : null,
        allocationCostState,
        fixedTimestamp,
        fixedTimestamp,
      ],
    );
  }
  if (secondRequirement) {
    await db.runAsync(
      `
        INSERT INTO production_plan_requirements (
          id, business_id, production_plan_stage_id, catalog_item_id,
          requirement_kind, raw_quantity, raw_unit, provenance_json, is_required,
          expected_cost, cost_state, created_at, updated_at, sync_status
        ) VALUES (
          'req-sugar', ?, ?, 'catalog-sugar', 'ingredient', 50, 'g', ?, 1, 5,
          'known', ?, ?, 'local'
        )
      `,
      [
        BUSINESS,
        stageId,
        sugarProvenanceJson,
        fixedTimestamp,
        fixedTimestamp,
      ],
    );
    await db.runAsync(
      `
        INSERT INTO production_plan_allocations (
          id, business_id, production_plan_requirement_id, lot_kind,
          ingredient_lot_id, allocation_mode, quantity, unit, unit_cost_snapshot,
          cost_contribution, cost_state, selection_state, sort_order,
          created_at, updated_at, sync_status
        ) VALUES (
          'alloc-sugar', ?, 'req-sugar', 'ingredient', 'lot-sugar',
          'recommended_fefo', 50, 'g', 0.1, 5, 'known', 'recommended', 0,
          ?, ?, 'local'
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp],
    );
  }

  return { planId, stageId };
}

async function count(db, sql, params = []) {
  const row = await db.getFirstAsync(sql, params);
  return Number(row?.count ?? 0);
}

async function expectRejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(String(error.message || error), pattern);
    return true;
  });
}

async function run() {
  const migrations = loadMigrations();
  assert.equal(
    migrations.at(-1)?.id,
    "018_guided_onboarding",
    "native production migration must remain present before the append-only onboarding migration",
  );
  assert.equal(
    migrations.some((migration) => migration.id === "017_native_production_execution"),
    true,
    "native production execution migration must remain registered",
  );
  const { executor, productStockLots } = loadExecutorModules();
  const { executeSimpleNativeProductionPlan } = executor;
  const kioskSalesSource = fs.readFileSync(
    path.join(workspace, "src/services/kioskSales.ts"),
    "utf8",
  );
  assert.match(
    kioskSalesSource,
    /eligibleItem\?\.stockPolicy === "product_lots"[\s\S]*?deductAvailableProductStockLotsWithScalarProjection/,
    "Kiosk checkout must route lot-backed Products through exact lot deduction",
  );

  // 1. HAPPY PATH + 2. IDEMPOTENT RETRY
  {
    const { db } = await createDatabase(migrations);
    const { planId, stageId } = await seedSimpleFinishedPlan(db);
    const first = await executeSimpleNativeProductionPlan(planId, db);
    assert.equal(first.outcome, "executed");
    assert.equal(first.productionBatchId.startsWith("exec_production_batch_"), true);
    assert.equal(first.stageId, stageId);
    assert.equal(first.outputQuantity, 10);
    assert.equal(first.totalCost, 12);

    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches WHERE deleted_at IS NULL"),
      1,
    );
    const batch = await db.getFirstAsync(
      `SELECT recipe_version_id, production_plan_stage_id, output_product_id,
         output_quantity, output_unit, total_batch_cost, actual_total_cost, cost_state
       FROM production_batches WHERE id = ?`,
      [first.productionBatchId],
    );
    assert.equal(batch.recipe_version_id, "version-bread-1");
    assert.equal(batch.production_plan_stage_id, stageId);
    assert.equal(batch.output_product_id, "product-bread");
    assert.equal(batch.output_quantity, 10);
    assert.equal(batch.output_unit, "pcs");
    assert.equal(batch.total_batch_cost, 12);

    assert.equal(batch.actual_total_cost, 12);
    assert.equal(batch.cost_state, "known");

    const flourLot = await db.getFirstAsync(
      `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
    );
    assert.equal(flourLot.remaining_quantity, 900);
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM ingredient_movements
         WHERE movement_type = 'recipe_usage' AND deleted_at IS NULL`,
      ),
      1,
    );
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM production_input_allocations
         WHERE production_batch_id = ? AND deleted_at IS NULL`,
        [first.productionBatchId],
      ),
      1,
    );
    const inputAllocation = await db.getFirstAsync(
      `SELECT recipe_version_line_id, production_plan_requirement_id, catalog_item_id
       FROM production_input_allocations
       WHERE production_batch_id = ? AND deleted_at IS NULL`,
      [first.productionBatchId],
    );
    assert.equal(inputAllocation.recipe_version_line_id, "line-flour");
    assert.equal(inputAllocation.production_plan_requirement_id, "req-flour");
    assert.equal(inputAllocation.catalog_item_id, "catalog-flour");
    const productLot = await db.getFirstAsync(
      `SELECT origin_kind, production_batch_id, remaining_quantity, unit,
         recorded_total_cost, recorded_cost_per_unit, cost_state, provenance_state
       FROM product_stock_lots WHERE id = ?`,
      [first.productStockLotId],
    );
    assert.equal(productLot.origin_kind, "production");
    assert.equal(productLot.production_batch_id, first.productionBatchId);
    assert.equal(productLot.remaining_quantity, 10);
    assert.equal(productLot.unit, "pcs");
    assert.equal(productLot.recorded_total_cost, 12);
    assert.equal(productLot.recorded_cost_per_unit, 1.2);
    assert.equal(productLot.cost_state, "known");
    assert.equal(productLot.provenance_state, "exact");

    const product = await db.getFirstAsync(
      `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
    );
    assert.equal(product.stock_qty, 10);

    const stage = await db.getFirstAsync(
      `SELECT status, actual_output_quantity, production_batch_id, shortage_state, variance_state
       FROM production_plan_stages WHERE id = ?`,
      [stageId],
    );
    assert.equal(stage.status, "completed");
    assert.equal(stage.actual_output_quantity, 10);
    assert.equal(stage.production_batch_id, first.productionBatchId);
    assert.equal(stage.shortage_state, "none");
    assert.equal(stage.variance_state, "within_tolerance");

    const plan = await db.getFirstAsync(
      `SELECT status, started_at, completed_at FROM production_plans WHERE id = ?`,
      [planId],
    );
    assert.equal(plan.status, "completed");
    assert.ok(plan.started_at);
    assert.ok(plan.completed_at);

    const allocation = await db.getFirstAsync(
      `SELECT selection_state FROM production_plan_allocations WHERE id = 'alloc-flour'`,
    );
    assert.equal(allocation.selection_state, "committed");
    console.log("happy path: passed");

    const retry = await executeSimpleNativeProductionPlan(planId, db);
    assert.equal(retry.outcome, "already_completed");
    assert.equal(retry.productionBatchId, first.productionBatchId);
    assert.equal(retry.productStockLotId, first.productStockLotId);
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches WHERE deleted_at IS NULL"),
      1,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      900,
    );
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM ingredient_movements
         WHERE movement_type = 'recipe_usage' AND deleted_at IS NULL`,
      ),
      1,
    );
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM production_input_allocations WHERE deleted_at IS NULL`,
      ),
      1,
    );
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM product_stock_lots WHERE deleted_at IS NULL`,
      ),
      1,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
        )
      ).stock_qty,
      10,
    );
    console.log("idempotent retry: passed");

    let deductions = null;
    await db.withExclusiveTransactionAsync(async (txn) => {
      deductions =
        await productStockLots.deductAvailableProductStockLotsWithScalarProjection(
          {
            businessId: BUSINESS,
            productId: first.outputProductId,
            quantity: 1,
            movementType: "stock_out_sale",
            movementReason: "Golden journey checkout",
          },
          txn,
        );
    });
    assert.deepEqual(deductions, [
      { lotId: first.productStockLotId, quantity: 1 },
    ]);
    const postSaleStock = await db.getFirstAsync(
      `SELECT product.stock_qty AS scalar_quantity,
        lot.remaining_quantity AS lot_quantity
       FROM products product
       INNER JOIN product_stock_lots lot ON lot.product_id = product.id
       WHERE product.id = ? AND lot.id = ?`,
      [first.outputProductId, first.productStockLotId],
    );
    assert.equal(postSaleStock.scalar_quantity, 9);
    assert.equal(postSaleStock.lot_quantity, 9);
    console.log("exact Product-lot checkout deduction: passed");
  }

  // Native Recipe `pcs` maps only at the existing Product projection boundary;
  // the authoritative Product lot keeps its protected `piece` stock unit.
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      planId: "plan-piece-projection",
      stageId: "stage-piece-projection",
    });
    await db.runAsync(
      `UPDATE products SET unit_type = 'piece' WHERE id = 'product-bread'`,
    );
    const result = await executeSimpleNativeProductionPlan(planId, db);
    const productLot = await db.getFirstAsync(
      `SELECT unit FROM product_stock_lots WHERE id = ?`,
      [result.productStockLotId],
    );
    assert.equal(result.outputUnit, "pcs");
    assert.equal(productLot.unit, "piece");
    console.log("Recipe pcs to Product piece projection: passed");
  }

  // 3. STALE RECIPE VERSION
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db);
    await db.runAsync(
      `
        INSERT INTO recipe_versions (
          id, business_id, recipe_id, version_number, status, name_snapshot,
          category_snapshot, output_catalog_item_id, output_product_id_snapshot,
          expected_output_quantity, expected_output_unit, production_mode,
          suggested_selling_price_snapshot, selling_price_state, notes_snapshot,
          source_kind, source_draft_id, duplicated_from_version_id,
          graph_state, cost_state, effective_at, created_at, updated_at,
          sync_status, deleted_at
        ) VALUES (
          'version-bread-2', ?, 'recipe-bread', 2, 'published', 'Bread Loaf v2',
          'Food', 'catalog-bread', 'product-bread', 10, 'pcs',
          'prepared_before_selling', 40, 'known', NULL, 'native_publish',
          NULL, NULL, 'complete', 'known', ?, ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, fixedTimestamp, fixedTimestamp, fixedTimestamp],
    );
    await db.runAsync(
      `UPDATE recipe_versions SET status = 'superseded' WHERE id = 'version-bread-1'`,
    );
    await db.runAsync(
      `UPDATE recipes SET active_version_id = 'version-bread-2' WHERE id = 'recipe-bread'`,
    );

    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /stale|active version/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      1000,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT status FROM production_plans WHERE id = ?`,
          [planId],
        )
      ).status,
      "ready",
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT status FROM production_plan_stages WHERE production_plan_id = ?`,
          [planId],
        )
      ).status,
      "ready",
    );
    console.log("stale recipe version: passed");
  }

  // 4. LOT SHORT AFTER PLANNING (full rollback)
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      secondRequirement: true,
      planExpectedCost: 17,
    });
    await db.runAsync(
      `UPDATE ingredient_lots SET remaining_quantity = 10 WHERE id = 'lot-flour'`,
    );

    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /enough remaining quantity|changed before deduction/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM ingredient_movements"),
      0,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_input_allocations"),
      0,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM product_stock_lots"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      10,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-sugar'`,
        )
      ).remaining_quantity,
      500,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
        )
      ).stock_qty,
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT status FROM production_plans WHERE id = ?`,
          [planId],
        )
      ).status,
      "ready",
    );
    console.log("lot short after planning: passed");
  }

  // 5. UNKNOWN / UNRESOLVED COST
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      planCostState: "unknown",
      planExpectedCost: null,
      missingCostCount: 1,
      allocationCostState: "unknown",
      allocationUnitCost: null,
      allocationCostContribution: null,
    });

    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /cost evidence/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      1000,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
        )
      ).stock_qty,
      0,
    );
    console.log("unknown unresolved cost: passed");
  }

  // 6. UNSUPPORTED SHAPE (multi-stage / nested)
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, { multiStage: true });
    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /exactly one production stage/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      1000,
    );
    console.log("unsupported multi-stage shape: passed");
  }

  // 6b. UNSUPPORTED prepared_product requirement
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      preparedRequirement: true,
    });
    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /ingredient requirements/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    console.log("unsupported prepared requirement: passed");
  }

  // 8. IDEMPOTENT WRONG OUTPUT PRODUCT
  {
    const { db } = await createDatabase(migrations);
    const { planId, stageId } = await seedSimpleFinishedPlan(db, {
      planId: "plan-wrong-product",
      stageId: "stage-wrong-product",
    });
    const first = await executeSimpleNativeProductionPlan(planId, db);
    assert.equal(first.outcome, "executed");
    await db.runAsync(
      `
        INSERT INTO products (
          id, business_id, branch_id, name, category, price, cost, stock_qty,
          unit_type, low_stock_threshold, active, product_type,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (
          'product-other', ?, ?, 'Other Loaf', 'Food', 40, 0, 0, 'pcs', 1, 1,
          'cooked food', ?, ?, 'local', NULL
        )
      `,
      [BUSINESS, BRANCH, fixedTimestamp, fixedTimestamp],
    );
    await db.runAsync(
      `UPDATE production_batches
       SET output_product_id = 'product-other'
       WHERE id = ?`,
      [first.productionBatchId],
    );

    const beforeFlour = (
      await db.getFirstAsync(
        `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
      )
    ).remaining_quantity;
    const beforeStock = (
      await db.getFirstAsync(
        `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
      )
    ).stock_qty;
    const beforeMovements = await count(
      db,
      `SELECT COUNT(*) AS count FROM ingredient_movements WHERE deleted_at IS NULL`,
    );
    const beforeLots = await count(
      db,
      `SELECT COUNT(*) AS count FROM product_stock_lots WHERE deleted_at IS NULL`,
    );

    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /output Product does not match/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches WHERE deleted_at IS NULL"),
      1,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      beforeFlour,
    );
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM ingredient_movements WHERE deleted_at IS NULL`,
      ),
      beforeMovements,
    );
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM product_stock_lots WHERE deleted_at IS NULL`,
      ),
      beforeLots,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
        )
      ).stock_qty,
      beforeStock,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT status FROM production_plan_stages WHERE id = ?`,
          [stageId],
        )
      ).status,
      "completed",
    );
    console.log("idempotent wrong output product: passed");
  }

  // 9. MALFORMED / MISSING PROVENANCE
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      planId: "plan-bad-provenance",
      stageId: "stage-bad-provenance",
      flourProvenanceJson: JSON.stringify([{ versionId: "version-bread-1" }]),
    });
    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /versionId and lineId|provenance/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      1000,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM ingredient_movements"),
      0,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM product_stock_lots"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT status FROM production_plans WHERE id = ?`,
          [planId],
        )
      ).status,
      "ready",
    );
    console.log("malformed missing provenance: passed");
  }

  // 10. MULTI-LINE AGGREGATED PROVENANCE
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      planId: "plan-multi-line",
      stageId: "stage-multi-line",
      extraFlourLine: true,
      flourProvenanceJson: JSON.stringify([
        {
          versionId: "version-bread-1",
          versionLabel: "Bread Loaf",
          lineId: "line-flour",
          lineLabel: "Flour A",
          quantity: 50,
        },
        {
          versionId: "version-bread-1",
          versionLabel: "Bread Loaf",
          lineId: "line-flour-b",
          lineLabel: "Flour B",
          quantity: 50,
        },
      ]),
    });
    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /multiple Recipe version lines/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      1000,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_input_allocations"),
      0,
    );
    console.log("multi-line aggregated provenance: passed");
  }

  // 11. DETACHED LINE ID
  {
    const { db } = await createDatabase(migrations);
    const { planId } = await seedSimpleFinishedPlan(db, {
      planId: "plan-detached-line",
      stageId: "stage-detached-line",
      secondRequirement: true,
      planExpectedCost: 17,
      flourProvenanceJson: JSON.stringify([
        {
          versionId: "version-bread-1",
          versionLabel: "Bread Loaf",
          lineId: "line-sugar",
          lineLabel: "Sugar",
          quantity: 100,
        },
      ]),
    });
    await expectRejects(
      executeSimpleNativeProductionPlan(planId, db),
      /detached from persisted Recipe content/i,
    );
    assert.equal(
      await count(db, "SELECT COUNT(*) AS count FROM production_batches"),
      0,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-flour'`,
        )
      ).remaining_quantity,
      1000,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT remaining_quantity FROM ingredient_lots WHERE id = 'lot-sugar'`,
        )
      ).remaining_quantity,
      500,
    );
    assert.equal(
      (
        await db.getFirstAsync(
          `SELECT stock_qty FROM products WHERE id = 'product-bread'`,
        )
      ).stock_qty,
      0,
    );
    console.log("detached line id: passed");
  }

  // 12. UNIQUE EXECUTION IDENTITY
  {
    const { db } = await createDatabase(migrations);
    const { stageId } = await seedSimpleFinishedPlan(db, {
      planId: "plan-unique",
      stageId: "stage-unique",
    });
    await db.runAsync(
      `
        INSERT INTO production_batches (
          id, business_id, branch_id, recipe_id, output_product_id, recipe_name,
          output_quantity, output_unit, batch_multiplier, total_batch_cost,
          cost_per_output_unit, notes, created_at, updated_at, sync_status,
          deleted_at, recipe_version_id, production_plan_stage_id,
          expected_output_quantity, actual_output_quantity, expected_total_cost,
          actual_total_cost, cost_state, yield_variance_quantity,
          yield_variance_percent
        ) VALUES (
          'batch-unique-1', ?, ?, 'recipe-bread', 'product-bread', 'Bread Loaf',
          10, 'pcs', 1, 12, 1.2, NULL, ?, ?, 'local', NULL,
          'version-bread-1', ?, 10, 10, 12, 12, 'known', 0, 0
        )
      `,
      [BUSINESS, BRANCH, fixedTimestamp, fixedTimestamp, stageId],
    );
    await assert.rejects(async () => {
      await db.runAsync(
        `
          INSERT INTO production_batches (
            id, business_id, branch_id, recipe_id, output_product_id, recipe_name,
            output_quantity, output_unit, batch_multiplier, total_batch_cost,
            cost_per_output_unit, notes, created_at, updated_at, sync_status,
            deleted_at, recipe_version_id, production_plan_stage_id,
            expected_output_quantity, actual_output_quantity, expected_total_cost,
            actual_total_cost, cost_state, yield_variance_quantity,
            yield_variance_percent
          ) VALUES (
            'batch-unique-2', ?, ?, 'recipe-bread', 'product-bread', 'Bread Loaf',
            10, 'pcs', 1, 12, 1.2, NULL, ?, ?, 'local', NULL,
            'version-bread-1', ?, 10, 10, 12, 12, 'known', 0, 0
          )
        `,
        [BUSINESS, BRANCH, fixedTimestamp, fixedTimestamp, stageId],
      );
    }, /UNIQUE|unique/i);
    assert.equal(
      await count(
        db,
        `SELECT COUNT(*) AS count FROM production_batches
         WHERE production_plan_stage_id = ? AND deleted_at IS NULL`,
        [stageId],
      ),
      1,
    );
    console.log("unique execution identity: passed");
  }

  console.log("ALL NATIVE PRODUCTION EXECUTOR CHECKS PASSED");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
