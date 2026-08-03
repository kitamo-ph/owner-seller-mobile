const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const workspace = process.cwd();
const migrationDirectory = path.join(workspace, "src/db/migrations");
const fixedTimestamp = "2026-08-01T00:00:00.000Z";

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

function loadLifecycleRepository() {
  const domain = loadTypeScriptModule("src/domain/itemLifecycle.ts");
  return loadTypeScriptModule(
    "src/db/repositories/itemLifecycle.ts",
    (request) => {
      if (request === "@/domain/itemLifecycle") return domain;
      if (request === "./shared") {
        return {
          getRepositoryDatabase: (database) => {
            if (!database) {
              throw new Error("Lifecycle transaction checks require an injected database.");
            }
            return database;
          },
          nowIso: () => fixedTimestamp,
        };
      }
      throw new Error(`Unexpected lifecycle-check import: ${request}`);
    },
  );
}

function deterministicIds() {
  let sequence = 0;
  const next = (kind) => `check_${kind}_${++sequence}`;
  return {
    makeIngredientMovementId: () => next("ingredient_movement"),
    makeMovementId: () => next("movement"),
    makeProductStockLotId: () => next("product_stock_lot"),
    makePurchaseReceiptId: () => next("purchase_receipt"),
    makeSaleSupplyLotUsageId: () => next("sale_supply_lot_usage"),
    makeSaleSupplyUsageId: () => next("sale_supply_usage"),
    makeSupplierId: () => next("supplier"),
    makeSupplyRuleId: () => next("supply_rule"),
  };
}

function loadProductPurchaseService() {
  const ids = deterministicIds();
  const shared = {
    getRepositoryDatabase: (database) => {
      if (!database) {
        throw new Error("Product purchase checks require an injected database.");
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
      throw new Error(`Unexpected catalog-domain check import: ${request}`);
    },
  );
  const stockAuthority = loadTypeScriptModule(
    "src/domain/stockAuthority.ts",
    (request) => {
      if (request === "./catalogItems") return catalogItems;
      throw new Error(`Unexpected stock-authority check import: ${request}`);
    },
  );
  const productStockLots = loadTypeScriptModule(
    "src/db/repositories/productStockLots.ts",
    (request) => {
      if (request === "@/domain/ids") return ids;
      if (request === "@/domain/stockAuthority") return stockAuthority;
      if (request === "./shared") return shared;
      throw new Error(`Unexpected Product-lot check import: ${request}`);
    },
  );
  const supplies = loadTypeScriptModule(
    "src/db/repositories/supplies.ts",
    (request) => {
      if (request === "@/domain/costState") return costState;
      if (request === "@/domain/ids") return ids;
      if (request === "@/domain/orderCosts") {
        return { orderCostCategoryForSupply: () => "other" };
      }
      if (request === "@/domain/supplyRules") {
        return { validateSupplyRule: () => [] };
      }
      if (request === "@/domain/stockAuthority") return stockAuthority;
      if (request === "./shared") return shared;
      throw new Error(`Unexpected purchase-receipt check import: ${request}`);
    },
  );
  const service = loadTypeScriptModule(
    "src/services/productPurchases.ts",
    (request) => {
      if (request === "@/db/client") {
        return {
          openKitamoDatabase: () => {
            throw new Error("Product purchase checks require an injected database.");
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
          createPurchaseReceipt: supplies.createPurchaseReceipt,
        };
      }
      if (request === "./ownerSetup") {
        return {
          loadOwnerSetupStatus: async () => ({
            activeBusiness: { id: "business-lifecycle" },
          }),
        };
      }
      throw new Error(`Unexpected Product-purchase service import: ${request}`);
    },
  );
  return { productStockLots, service };
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

function bindSql(statement, parameters) {
  const values = normalizedParameters(parameters);
  let bound = "";
  let valueIndex = 0;
  let inSingleQuote = false;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    if (character === "'") {
      if (inSingleQuote && statement[index + 1] === "'") {
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

  runCli(statement, json = false) {
    const args = ["-bail"];
    if (json) args.push("-json");
    args.push(this.filename);
    return execFileSync("sqlite3", args, {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;\n${statement}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  }

  async execAsync(statement) {
    this.runCli(statement);
  }

  async runAsync(statement, ...parameters) {
    const output = this.runCli(
      `${bindSql(statement, parameters)};
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

  async getFirstAsync(statement, ...parameters) {
    return (await this.getAllAsync(statement, ...parameters))[0] ?? null;
  }

  async getAllAsync(statement, ...parameters) {
    const output = this.runCli(bindSql(statement, parameters), true);
    return JSON.parse(output || "[]");
  }

  async withExclusiveTransactionAsync(operation) {
    this.transactionSequence += 1;
    const transactionPath = `${this.filename}.transaction-${process.pid}-${this.transactionSequence}`;
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

function withInjectedFailure(database, predicate) {
  return {
    execAsync: (statement) => database.execAsync(statement),
    getAllAsync: (statement, ...parameters) =>
      database.getAllAsync(statement, ...parameters),
    getFirstAsync: (statement, ...parameters) => {
      if (predicate("read", statement)) {
        throw new Error("Injected lifecycle audit failure.");
      }
      return database.getFirstAsync(statement, ...parameters);
    },
    runAsync: (statement, ...parameters) => {
      if (predicate("write", statement)) {
        throw new Error("Injected lifecycle write failure.");
      }
      return database.runAsync(statement, ...parameters);
    },
    withExclusiveTransactionAsync: (operation) =>
      database.withExclusiveTransactionAsync((transaction) =>
        operation(withInjectedFailure(transaction, predicate)),
      ),
  };
}

async function applyFreshMigrations(database) {
  for (const migration of loadMigrations()) {
    await database.execAsync(migration.up);
  }
}

async function insertBusiness(database) {
  await database.runAsync(
    `
      INSERT INTO businesses (
        id, business_name, business_type, owner_name, barangay,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'local', NULL)
    `,
    [
      "business-lifecycle",
      "Lifecycle Test Business",
      "sari-sari store",
      "Lifecycle Owner",
      "Test Barangay",
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
}

async function insertProductIdentity(
  database,
  { catalogItemId, productId, name, stockQty = 0, stockPolicy = "product_scalar" },
) {
  await database.runAsync(
    `
      INSERT INTO products (
        id, business_id, branch_id, name, category, price, cost, stock_qty,
        unit_type, low_stock_threshold, active, product_type,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', NULL, ?, 'Test', 10, 2, ?,
        'piece', 1, 1, 'retail item', ?, ?, 'local', NULL)
    `,
    [productId, name, stockQty, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, source_type,
        classification, lifecycle_status, readiness_state,
        classification_review_required, sellable, kiosk_enabled,
        purchase_cost_state, selling_price_state, stock_policy,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', NULL, ?, ?, 'legacy_product',
        'legacy_unclassified', 'active', 'legacy_review', 1, 1, 1,
        'known', 'known', ?, ?, ?, 'local', NULL)
    `,
    [
      catalogItemId,
      name,
      name.toLocaleLowerCase(),
      stockPolicy,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
  await database.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, migration_provenance,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', ?, 'product', ?, 'legacy_product',
        'active', 'legacy_unclassified', 1, 1, 'migration_011',
        ?, ?, 'local', NULL)
    `,
    [
      `binding:${catalogItemId}`,
      catalogItemId,
      productId,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
}

async function insertNativeDirectResaleIdentity(
  database,
  { catalogItemId, productId, name },
) {
  await database.runAsync(
    `
      INSERT INTO products (
        id, business_id, branch_id, name, category, price, cost, stock_qty,
        unit_type, low_stock_threshold, active, product_type,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', NULL, ?, 'Test', 10, 0, 0,
        'piece', 1, 1, 'retail item', ?, ?, 'local', NULL)
    `,
    [productId, name, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, source_type,
        classification, lifecycle_status, readiness_state,
        classification_review_required, sellable, kiosk_enabled,
        purchase_cost_state, selling_price_state, stock_policy,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', NULL, ?, ?, 'native',
        'direct_resale_product', 'active', 'ready', 0, 1, 1,
        'unknown', 'known', 'product_lots', ?, ?, 'local', NULL)
    `,
    [catalogItemId, name, name.toLocaleLowerCase(), fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, migration_provenance, native_activated_at,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', ?, 'product', ?, 'sale_product',
        'active', 'native', 0, 1, 'native', ?, ?, ?, 'local', NULL)
    `,
    [
      `binding:${catalogItemId}`,
      catalogItemId,
      productId,
      fixedTimestamp,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
}

async function insertIngredientIdentity(
  database,
  { catalogItemId, ingredientId, name },
) {
  await database.runAsync(
    `
      INSERT INTO ingredients (
        id, business_id, name, default_unit, category, low_stock_threshold,
        is_active, created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', ?, 'gram', 'Test', 0, 1,
        ?, ?, 'local', NULL)
    `,
    [ingredientId, name, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, source_type,
        classification, lifecycle_status, readiness_state,
        classification_review_required, sellable, kiosk_enabled,
        purchase_cost_state, selling_price_state, stock_policy,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', NULL, ?, ?, 'legacy_ingredient',
        'legacy_unclassified', 'active', 'legacy_review', 1, 0, 0,
        'unknown', 'not_applicable', 'ingredient_lots', ?, ?, 'local', NULL)
    `,
    [catalogItemId, name, name.toLocaleLowerCase(), fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, migration_provenance,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'business-lifecycle', ?, 'ingredient', ?,
        'legacy_ingredient', 'active', 'legacy_unclassified', 1, 1,
        'migration_011', ?, ?, 'local', NULL)
    `,
    [
      `binding:${catalogItemId}`,
      catalogItemId,
      ingredientId,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
}

async function seedProductionUsageOnly(database) {
  await insertIngredientIdentity(database, {
    catalogItemId: "catalog-ingredient-production",
    ingredientId: "ingredient-production",
    name: "Production Usage Ingredient",
  });
  await database.runAsync(
    `
      INSERT INTO production_batches (
        id, business_id, recipe_name, output_quantity, output_unit,
        batch_multiplier, total_batch_cost, cost_per_output_unit,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('batch-usage-only', 'business-lifecycle', 'Historical Batch',
        1, 'piece', 1, 0, 0, ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO production_ingredient_usages (
        id, business_id, production_batch_id, ingredient_id,
        quantity_used, unit, line_cost, is_custom,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('production-usage-only', 'business-lifecycle',
        'batch-usage-only', 'ingredient-production', 1, 'gram', 0, 0,
        ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
}

async function seedSaleUsageOnly(database) {
  await insertIngredientIdentity(database, {
    catalogItemId: "catalog-ingredient-sale",
    ingredientId: "ingredient-sale",
    name: "Sale Usage Ingredient",
  });
  await database.runAsync(
    `
      INSERT INTO sales (
        id, business_id, transaction_no, happened_at, amount, discount,
        payment_method, payment_status, created_at, updated_at, sync_status,
        deleted_at, checkout_token
      ) VALUES ('sale-usage-only', 'business-lifecycle', 'TEST-1', ?, 10, 0,
        'cash', 'paid', ?, ?, 'local', NULL, 'checkout-usage-only')
    `,
    [fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO sale_items (
        id, sale_id, business_id, name, quantity, unit_price, unit_cost,
        line_total, bundle_applied, discount_amount,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('sale-item-usage-only', 'sale-usage-only',
        'business-lifecycle', 'Historical Sale Item', 1, 10, 0, 10, 0, 0,
        ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO sale_ingredient_usages (
        id, business_id, sale_id, sale_item_id, ingredient_id,
        quantity_used, unit, line_cost, is_estimated, shortfall_quantity,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('sale-ingredient-usage-only', 'business-lifecycle',
        'sale-usage-only', 'sale-item-usage-only', 'ingredient-sale',
        1, 'gram', 0, 0, 0, ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
}

async function seedArchiveGraph(database) {
  await insertProductIdentity(database, {
    catalogItemId: "catalog-archive",
    productId: "product-archive",
    name: "Archive Graph Product",
    stockQty: 5,
    stockPolicy: "product_lots",
  });
  await database.runAsync(
    `
      INSERT INTO recipes (
        id, business_id, output_product_id, name, output_quantity, output_unit,
        production_mode, is_active, created_at, updated_at, sync_status,
        deleted_at
      ) VALUES ('recipe-archive', 'business-lifecycle', 'product-archive',
        'Archive Recipe', 1, 'piece', 'prepared_before_selling', 1,
        ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO catalog_item_recipe_roles (
        id, business_id, output_catalog_item_id, recipe_id, role, status,
        effective_at, created_at, updated_at, sync_status, deleted_at
      ) VALUES ('role-archive', 'business-lifecycle', 'catalog-archive',
        'recipe-archive', 'primary', 'active', ?, ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO recipe_drafts (
        id, business_id, recipe_id, output_catalog_item_id, name,
        lifecycle_status, autosave_revision, last_saved_at,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('draft-archive', 'business-lifecycle', 'recipe-archive',
        'catalog-archive', 'Archive Draft', 'editing', 0, ?,
        ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO catalog_cost_profiles (
        id, business_id, catalog_item_id, source_kind, total_cost,
        reference_quantity, reference_unit, request_token, status,
        effective_at, created_at, updated_at, sync_status, deleted_at
      ) VALUES ('profile-archive', 'business-lifecycle', 'catalog-archive',
        'owner_estimate', 10, 5, 'piece', 'request-profile-archive', 'active',
        ?, ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO product_stock_lots (
        id, business_id, product_id, catalog_item_id, origin_kind,
        origin_date, initial_quantity, remaining_quantity, unit,
        cost_state, status, provenance_state,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('lot-archive', 'business-lifecycle', 'product-archive',
        'catalog-archive', 'legacy_balance', '2026-08-01', 5, 5, 'piece',
        'unknown', 'active', 'exact', ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO inventory_movements (
        id, business_id, product_id, movement_type, quantity, reason,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('movement-archive', 'business-lifecycle', 'product-archive',
        'stock_in', 5, 'Historical archive fixture', ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO sales (
        id, business_id, transaction_no, happened_at, amount, discount,
        payment_method, payment_status, created_at, updated_at, sync_status,
        deleted_at, checkout_token
      ) VALUES ('sale-archive', 'business-lifecycle', 'TEST-ARCHIVE', ?, 10, 0,
        'cash', 'paid', ?, ?, 'local', NULL, 'checkout-archive')
    `,
    [fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO sale_items (
        id, sale_id, business_id, product_id, name, quantity, unit_price,
        unit_cost, line_total, bundle_applied, discount_amount,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('sale-item-archive', 'sale-archive', 'business-lifecycle',
        'product-archive', 'Archive Graph Product', 1, 10, 2, 10, 0, 0,
        ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
  await database.runAsync(
    `
      INSERT INTO production_batches (
        id, business_id, recipe_id, output_product_id, recipe_name,
        output_quantity, output_unit, batch_multiplier, total_batch_cost,
        cost_per_output_unit, created_at, updated_at, sync_status, deleted_at
      ) VALUES ('batch-archive', 'business-lifecycle', 'recipe-archive',
        'product-archive', 'Archive Recipe', 5, 'piece', 1, 10, 2,
        ?, ?, 'local', NULL)
    `,
    [fixedTimestamp, fixedTimestamp],
  );
}

async function countRows(database, table, where, parameters = []) {
  const row = await database.getFirstAsync(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
    parameters,
  );
  return Number(row?.count ?? 0);
}

async function runProductPurchaseTransactions(database) {
  const { productStockLots, service } = loadProductPurchaseService();

  await insertProductIdentity(database, {
    catalogItemId: "catalog-purchase-ineligible",
    productId: "product-purchase-ineligible",
    name: "Unreviewed Purchase Product",
    stockPolicy: "product_lots",
  });
  await assert.rejects(
    service.addDirectResalePurchase(
      {
        catalogItemId: "catalog-purchase-ineligible",
        productId: "product-purchase-ineligible",
        quantity: 1,
        totalCost: 10,
        purchasedAt: "2026-08-01",
        notes: "ineligible purchase",
      },
      database,
    ),
    /not eligible for lot-backed purchasing/,
    "unreviewed compatibility Products must not enter the native lot path",
  );
  assert.equal(
    await countRows(database, "purchase_receipts", "notes = 'ineligible purchase'"),
    0,
    "eligibility failure must happen before receipt creation",
  );

  await insertNativeDirectResaleIdentity(database, {
    catalogItemId: "catalog-purchase-zero",
    productId: "product-purchase-zero",
    name: "Known Zero Purchase Product",
  });
  const zeroCostLot = await service.addDirectResalePurchase(
    {
      catalogItemId: "catalog-purchase-zero",
      productId: "product-purchase-zero",
      quantity: 3,
      totalCost: 0,
      purchasedAt: "2026-08-02",
      notes: "known zero purchase",
    },
    database,
  );
  assert.equal(zeroCostLot.productId, "product-purchase-zero");
  assert.equal(zeroCostLot.initialQuantity, 3);
  assert.equal(zeroCostLot.remainingQuantity, 3);
  assert.equal(zeroCostLot.costState, "known");
  assert.equal(zeroCostLot.recordedTotalCost, 0);
  assert.equal(zeroCostLot.recordedCostPerUnit, 0);
  assert.deepEqual(
    await database.getFirstAsync(
      `
        SELECT receipt.cost_state AS receipt_cost_state,
          receipt.total_cost AS receipt_total_cost,
          lot.cost_state AS lot_cost_state,
          lot.recorded_total_cost AS lot_total_cost,
          lot.recorded_cost_per_unit AS lot_unit_cost,
          movement.unit_cost AS movement_unit_cost,
          movement.total_cost AS movement_total_cost,
          product.stock_qty,
          item.purchase_cost_state
        FROM product_stock_lots lot
        INNER JOIN purchase_receipts receipt
          ON receipt.id = lot.purchase_receipt_id
        INNER JOIN inventory_movements movement
          ON movement.product_id = lot.product_id
          AND movement.reason = 'Direct-resale purchase lot'
        INNER JOIN products product ON product.id = lot.product_id
        INNER JOIN catalog_items item ON item.id = lot.catalog_item_id
        WHERE lot.product_id = 'product-purchase-zero'
      `,
    ),
    {
      receipt_cost_state: "known",
      receipt_total_cost: 0,
      lot_cost_state: "known",
      lot_total_cost: 0,
      lot_unit_cost: 0,
      movement_unit_cost: 0,
      movement_total_cost: 0,
      stock_qty: 3,
      purchase_cost_state: "known",
    },
    "known zero must remain explicit cost evidence across receipt, lot, and movement",
  );
  assert.equal(
    (await productStockLots.reconcileStoredProductStock(
      "product-purchase-zero",
      "business-lifecycle",
      database,
    )).status,
    "balanced",
    "Product scalar must equal the authoritative active-lot total",
  );

  await insertNativeDirectResaleIdentity(database, {
    catalogItemId: "catalog-purchase-unknown",
    productId: "product-purchase-unknown",
    name: "Unknown Cost Purchase Product",
  });
  const unknownCostLot = await service.addDirectResalePurchase(
    {
      catalogItemId: "catalog-purchase-unknown",
      productId: "product-purchase-unknown",
      quantity: 2,
      totalCost: null,
      purchasedAt: "2026-08-03",
      notes: "unknown cost purchase",
    },
    database,
  );
  assert.equal(unknownCostLot.costState, "unknown");
  assert.equal(unknownCostLot.recordedTotalCost, null);
  assert.equal(unknownCostLot.recordedCostPerUnit, null);
  assert.deepEqual(
    await database.getFirstAsync(
      `
        SELECT receipt.cost_state AS receipt_cost_state,
          receipt.total_cost AS receipt_total_cost,
          lot.cost_state AS lot_cost_state,
          lot.recorded_total_cost AS lot_total_cost,
          lot.recorded_cost_per_unit AS lot_unit_cost,
          movement.unit_cost AS movement_unit_cost,
          movement.total_cost AS movement_total_cost,
          product.stock_qty,
          item.purchase_cost_state
        FROM product_stock_lots lot
        INNER JOIN purchase_receipts receipt
          ON receipt.id = lot.purchase_receipt_id
        INNER JOIN inventory_movements movement
          ON movement.product_id = lot.product_id
          AND movement.reason = 'Direct-resale purchase lot'
        INNER JOIN products product ON product.id = lot.product_id
        INNER JOIN catalog_items item ON item.id = lot.catalog_item_id
        WHERE lot.product_id = 'product-purchase-unknown'
      `,
    ),
    {
      receipt_cost_state: "unknown",
      receipt_total_cost: null,
      lot_cost_state: "unknown",
      lot_total_cost: null,
      lot_unit_cost: null,
      movement_unit_cost: null,
      movement_total_cost: null,
      stock_qty: 2,
      purchase_cost_state: "unknown",
    },
    "unknown cost must remain NULL and distinct from known zero",
  );
  const unknownReconciliation =
    await productStockLots.reconcileStoredProductStock(
      "product-purchase-unknown",
      "business-lifecycle",
      database,
    );
  assert.equal(unknownReconciliation.status, "balanced");
  assert.equal(unknownReconciliation.scalarQuantity, 2);
  assert.equal(unknownReconciliation.activeLotQuantity, 2);
  for (const productId of ["product-purchase-zero", "product-purchase-unknown"]) {
    assert.equal(
      await countRows(database, "product_stock_lots", "product_id = ?", [productId]),
      1,
      "each purchase must create exactly one Product lot",
    );
    assert.equal(
      await countRows(database, "inventory_movements", "product_id = ?", [productId]),
      1,
      "each purchase must create exactly one movement",
    );
  }
  assert.equal(
    await countRows(
      database,
      "purchase_receipts",
      "notes IN ('known zero purchase', 'unknown cost purchase')",
    ),
    2,
    "each successful purchase must create exactly one receipt",
  );

  await insertNativeDirectResaleIdentity(database, {
    catalogItemId: "catalog-purchase-rollback",
    productId: "product-purchase-rollback",
    name: "Rollback Purchase Product",
  });
  const failedMovementDatabase = withInjectedFailure(
    database,
    (kind, statement) =>
      kind === "write" && statement.includes("INSERT INTO inventory_movements"),
  );
  await assert.rejects(
    service.addDirectResalePurchase(
      {
        catalogItemId: "catalog-purchase-rollback",
        productId: "product-purchase-rollback",
        quantity: 4,
        totalCost: 20,
        purchasedAt: "2026-08-04",
        notes: "rollback purchase",
      },
      failedMovementDatabase,
    ),
    /Injected lifecycle write failure/,
    "a failure after receipt, lot, and scalar writes must abort the purchase",
  );
  assert.equal(
    await countRows(database, "purchase_receipts", "notes = 'rollback purchase'"),
    0,
    "purchase rollback must remove the tentative receipt",
  );
  assert.equal(
    await countRows(database, "product_stock_lots", "product_id = ?", [
      "product-purchase-rollback",
    ]),
    0,
    "purchase rollback must remove the tentative lot",
  );
  assert.equal(
    await countRows(database, "inventory_movements", "product_id = ?", [
      "product-purchase-rollback",
    ]),
    0,
    "purchase rollback must not leave movement evidence",
  );
  assert.deepEqual(
    await database.getFirstAsync(
      `
        SELECT product.stock_qty, item.purchase_cost_state
        FROM products product
        INNER JOIN legacy_item_bindings binding
          ON binding.legacy_entity_id = product.id
          AND binding.entity_kind = 'product'
        INNER JOIN catalog_items item ON item.id = binding.catalog_item_id
        WHERE product.id = 'product-purchase-rollback'
      `,
    ),
    { stock_qty: 0, purchase_cost_state: "unknown" },
    "purchase rollback must restore scalar stock and catalog cost state",
  );

  assert.deepEqual(await database.getAllAsync("PRAGMA foreign_key_check"), []);
  assert.deepEqual(await database.getFirstAsync("PRAGMA integrity_check"), {
    integrity_check: "ok",
  });
  console.log(
    "DIRECT-RESALE PURCHASE SQLITE CHECKS PASSED: eligibility, atomic receipt/lot/movement, scalar derivation, unknown versus known zero, and rollback",
  );
}

async function runPanindaLifecycleTransactions() {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "kitamo-paninda-lifecycle-"),
  );
  const databasePath = path.join(temporaryDirectory, "lifecycle.sqlite");
  const database = new SqliteCliDatabase(databasePath);
  const purchaseDatabase = new SqliteCliDatabase(
    path.join(temporaryDirectory, "product-purchases.sqlite"),
  );
  const lifecycle = loadLifecycleRepository();

  try {
    await applyFreshMigrations(database);
    await insertBusiness(database);
    await applyFreshMigrations(purchaseDatabase);
    await insertBusiness(purchaseDatabase);
    await runProductPurchaseTransactions(purchaseDatabase);

    await insertProductIdentity(database, {
      catalogItemId: "catalog-safe-delete",
      productId: "product-safe-delete",
      name: "Safe Delete Product",
    });
    const safeResult = await lifecycle.permanentlyDeleteCatalogItem(
      "catalog-safe-delete",
      true,
      database,
    );
    assert.deepEqual(safeResult, {
      outcome: "deleted",
      catalogItemId: "catalog-safe-delete",
    });
    assert.equal(
      await countRows(database, "catalog_items", "id = ?", ["catalog-safe-delete"]),
      0,
      "safe delete must remove the catalog identity",
    );
    assert.equal(
      await countRows(database, "products", "id = ?", ["product-safe-delete"]),
      0,
      "safe delete must remove the exact Product projection",
    );
    assert.equal(
      await countRows(database, "legacy_item_bindings", "catalog_item_id = ?", [
        "catalog-safe-delete",
      ]),
      0,
      "safe delete must not leave an orphan binding",
    );

    await seedProductionUsageOnly(database);
    const productionCounts = await lifecycle.getCatalogItemReferenceCounts(
      "catalog-ingredient-production",
      database,
    );
    assert.equal(
      productionCounts.production,
      1,
      "usage-only production evidence must be counted",
    );
    const productionDelete = await lifecycle.permanentlyDeleteCatalogItem(
      "catalog-ingredient-production",
      true,
      database,
    );
    assert.equal(productionDelete.outcome, "archive_required");
    assert.ok(productionDelete.blockingReferences.includes("production"));
    assert.equal(
      await countRows(database, "ingredients", "id = ?", ["ingredient-production"]),
      1,
      "a production-usage-only Ingredient must be preserved",
    );

    await seedSaleUsageOnly(database);
    const saleCounts = await lifecycle.getCatalogItemReferenceCounts(
      "catalog-ingredient-sale",
      database,
    );
    assert.equal(
      saleCounts.sale,
      1,
      "usage-only sale evidence must be counted",
    );
    const saleDelete = await lifecycle.permanentlyDeleteCatalogItem(
      "catalog-ingredient-sale",
      true,
      database,
    );
    assert.equal(saleDelete.outcome, "archive_required");
    assert.ok(saleDelete.blockingReferences.includes("sale"));
    assert.equal(
      await countRows(database, "ingredients", "id = ?", ["ingredient-sale"]),
      1,
      "a sale-usage-only Ingredient must be preserved",
    );

    await insertProductIdentity(database, {
      catalogItemId: "catalog-fail-closed",
      productId: "product-fail-closed",
      name: "Fail Closed Product",
    });
    const failedAuditDatabase = withInjectedFailure(
      database,
      (kind, statement) =>
        kind === "read" && statement.includes("FROM sale_ingredient_usages usage"),
    );
    const failClosedResult = await lifecycle.permanentlyDeleteCatalogItem(
      "catalog-fail-closed",
      true,
      failedAuditDatabase,
    );
    assert.equal(
      failClosedResult.outcome,
      "denied_fail_closed",
      "an uncertain reference audit must deny permanent deletion",
    );
    assert.equal(
      await countRows(database, "products", "id = ?", ["product-fail-closed"]),
      1,
      "a failed audit must leave the projection intact",
    );

    await seedArchiveGraph(database);
    const preservedTables = [
      ["recipes", "id = 'recipe-archive'"],
      ["product_stock_lots", "id = 'lot-archive'"],
      ["inventory_movements", "id = 'movement-archive'"],
      ["sale_items", "id = 'sale-item-archive'"],
      ["production_batches", "id = 'batch-archive'"],
    ];
    const beforeArchive = await Promise.all(
      preservedTables.map(([table, where]) => countRows(database, table, where)),
    );
    await lifecycle.archiveCatalogItem("catalog-archive", true, database);
    const archivedItem = await database.getFirstAsync(
      `
        SELECT lifecycle_status, readiness_state, sellable, kiosk_enabled,
          archived_at
        FROM catalog_items WHERE id = 'catalog-archive'
      `,
    );
    assert.deepEqual(archivedItem, {
      lifecycle_status: "archived",
      readiness_state: "blocked",
      sellable: 0,
      kiosk_enabled: 0,
      archived_at: fixedTimestamp,
    });
    assert.equal(
      (
        await database.getFirstAsync(
          "SELECT active FROM products WHERE id = 'product-archive'",
        )
      ).active,
      0,
    );
    assert.deepEqual(
      await database.getFirstAsync(
        `
          SELECT binding_status, compatibility_mode, legacy_active_snapshot
          FROM legacy_item_bindings WHERE catalog_item_id = 'catalog-archive'
        `,
      ),
      {
        binding_status: "archived",
        compatibility_mode: "reviewed_legacy",
        legacy_active_snapshot: 0,
      },
      "archive must disable the exact legacy Kiosk compatibility bypass",
    );
    assert.equal(
      (
        await database.getFirstAsync(
          "SELECT is_active FROM recipes WHERE id = 'recipe-archive'",
        )
      ).is_active,
      0,
    );
    assert.equal(
      (
        await database.getFirstAsync(
          "SELECT status FROM catalog_item_recipe_roles WHERE id = 'role-archive'",
        )
      ).status,
      "archived",
    );
    assert.deepEqual(
      await database.getFirstAsync(
        `
          SELECT lifecycle_status, autosave_revision
          FROM recipe_drafts WHERE id = 'draft-archive'
        `,
      ),
      { lifecycle_status: "abandoned", autosave_revision: 1 },
    );
    assert.equal(
      (
        await database.getFirstAsync(
          "SELECT status FROM catalog_cost_profiles WHERE id = 'profile-archive'",
        )
      ).status,
      "archived",
    );
    const afterArchive = await Promise.all(
      preservedTables.map(([table, where]) => countRows(database, table, where)),
    );
    assert.deepEqual(
      afterArchive,
      beforeArchive,
      "archive must preserve lots, movements, recipes, sales, and production evidence",
    );

    await insertProductIdentity(database, {
      catalogItemId: "catalog-archive-rollback",
      productId: "product-archive-rollback",
      name: "Archive Rollback Product",
    });
    const failedArchiveDatabase = withInjectedFailure(
      database,
      (kind, statement) =>
        kind === "write" && statement.includes("UPDATE catalog_item_recipe_roles"),
    );
    await assert.rejects(
      lifecycle.archiveCatalogItem(
        "catalog-archive-rollback",
        true,
        failedArchiveDatabase,
      ),
      /Injected lifecycle write failure/,
    );
    assert.deepEqual(
      await database.getFirstAsync(
        `
          SELECT lifecycle_status, readiness_state, sellable, kiosk_enabled
          FROM catalog_items WHERE id = 'catalog-archive-rollback'
        `,
      ),
      {
        lifecycle_status: "active",
        readiness_state: "legacy_review",
        sellable: 1,
        kiosk_enabled: 1,
      },
      "an interrupted coordinated archive must roll back catalog state",
    );
    assert.equal(
      (
        await database.getFirstAsync(
          "SELECT active FROM products WHERE id = 'product-archive-rollback'",
        )
      ).active,
      1,
      "an interrupted coordinated archive must roll back Product state",
    );

    assert.deepEqual(
      await database.getAllAsync("PRAGMA foreign_key_check"),
      [],
      "lifecycle fixtures must preserve foreign-key integrity",
    );
    assert.deepEqual(
      await database.getFirstAsync("PRAGMA integrity_check"),
      { integrity_check: "ok" },
      "lifecycle transaction database must remain intact",
    );

    console.log(
      "PANINDA LIFECYCLE SQLITE CHECKS PASSED: safe delete, usage-only blockers, fail-closed audit, coordinated archive preservation, and archive rollback",
    );
  } finally {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

if (require.main === module) {
  runPanindaLifecycleTransactions().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { runPanindaLifecycleTransactions };
