/**
 * End-to-end SQLite proof that the Paninda listing lifecycle has no dead end.
 *
 * Before this transition existed, publishing a Recipe left
 *   catalog_items.lifecycle_status = 'ready'
 *   catalog_items.readiness_state  = 'incomplete'
 *   catalog_items.sellable = 0, kiosk_enabled = 0
 *   products.active = 0
 * and no writer anywhere could satisfy the gates that Paninda `Active`,
 * native production readiness, and Kiosk eligibility all require. A published
 * Recipe was therefore permanently unsellable and unproducible.
 *
 * This check drives the real repository transactions against a real database
 * and asserts the full round trip: needs_setup -> listed -> Kiosk-eligible ->
 * unlisted -> archived -> restored.
 */
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const workspace = process.cwd();
const migrationDirectory = path.join(workspace, "src/db/migrations");
const fixedTimestamp = "2026-08-05T00:00:00.000Z";
const BUSINESS = "business-listing";

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

const costStateDomain = loadTypeScriptModule("src/domain/costState.ts");
const catalogDomain = loadTypeScriptModule(
  "src/domain/catalogItems.ts",
  (request) => {
    if (request === "./costState") return costStateDomain;
    throw new Error(`Unexpected catalog-domain import: ${request}`);
  },
);
const listingDomain = loadTypeScriptModule(
  "src/domain/panindaListing.ts",
  (request) => {
    if (request === "./catalogItems") return catalogDomain;
    if (request === "./costState") return costStateDomain;
    throw new Error(`Unexpected listing-domain import: ${request}`);
  },
);

const listingRepository = loadTypeScriptModule(
  "src/db/repositories/panindaListing.ts",
  (request) => {
    if (request === "@/domain/panindaListing") return listingDomain;
    if (request === "@/domain/catalogItems") return catalogDomain;
    if (request === "@/domain/costState") return costStateDomain;
    if (request === "./shared") {
      return {
        getRepositoryDatabase: (database) => {
          if (!database) {
            throw new Error("Listing checks require an injected database.");
          }
          return database;
        },
        nowIso: () => fixedTimestamp,
      };
    }
    throw new Error(`Unexpected listing-repository import: ${request}`);
  },
);

function normalizedParameters(parameters) {
  return parameters.length === 1 && Array.isArray(parameters[0])
    ? parameters[0]
    : parameters;
}

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
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
      assert.ok(valueIndex < values.length, "Not enough bound parameters.");
      bound += literal(values[valueIndex]);
      valueIndex += 1;
      continue;
    }
    bound += character;
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
       SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowId;`,
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

/** Mirrors the native-item shape publishRecipeFirstDraft leaves behind. */
async function seedPublishedRecipeItem(db, { withPrice }) {
  await db.runAsync(
    `
      INSERT INTO businesses (
        id, business_name, business_type, owner_name, barangay,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, 'Listing Test', 'karinderya', 'Owner', 'Barangay', ?, ?, 'local', NULL)
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO products (
        id, business_id, branch_id, name, category, price, cost, stock_qty,
        unit_type, low_stock_threshold, active, product_type,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('product-sushi', ?, NULL, 'Sausage Sushi', 'General', ?, 3.47, 0,
        'piece', 1, 0, 'cooked food', ?, ?, 'local', NULL)
    `,
    [BUSINESS, withPrice ? 25 : 0, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO catalog_items (
        id, business_id, branch_id, name, normalized_name, classification,
        lifecycle_status, readiness_state, classification_review_required,
        sellable, kiosk_enabled, purchase_cost_state, selling_price_state,
        stock_policy, source_type, archived_at, created_at, updated_at,
        sync_status, deleted_at
      ) VALUES ('item-sushi', ?, NULL, 'Sausage Sushi', 'sausage sushi',
        'finished_product', 'ready', 'ready', 0, 0, 0, 'not_applicable', ?,
        'product_scalar', 'native', NULL, ?, ?, 'local', NULL)
    `,
    [BUSINESS, withPrice ? "known" : "unknown", fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO legacy_item_bindings (
        id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
        projection_role, binding_status, compatibility_mode, review_required,
        legacy_active_snapshot, migration_provenance,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES ('binding-sushi', ?, 'item-sushi', 'product', 'product-sushi',
        'recipe_output', 'active', 'native', 0, 0, 'native',
        ?, ?, 'local', NULL)
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO recipes (
        id, business_id, output_product_id, name, output_quantity, output_unit,
        active_version_id, is_active, created_at, updated_at, sync_status, deleted_at
      ) VALUES ('recipe-sushi', ?, 'product-sushi', 'Sausage Sushi', 1, 'piece',
        NULL, 1, ?, ?, 'local', NULL)
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
      ) VALUES ('version-sushi', ?, 'recipe-sushi', 1, 'published', 'Sausage Sushi',
        'General', 'item-sushi', 'product-sushi', 1, 'piece',
        'prepared_before_selling', NULL, ?, NULL, 'native_publish', NULL, NULL,
        'complete', 'known', ?, ?, ?, 'local', NULL)
    `,
    [
      BUSINESS,
      withPrice ? "known" : "unknown",
      fixedTimestamp,
      fixedTimestamp,
      fixedTimestamp,
    ],
  );
  await db.runAsync(
    `UPDATE recipes SET active_version_id = 'version-sushi' WHERE id = 'recipe-sushi'`,
  );
  await db.runAsync(
    `
      INSERT INTO catalog_item_recipe_roles (
        id, business_id, output_catalog_item_id, recipe_id, role, status,
        effective_at, archived_at, created_at, updated_at, sync_status, deleted_at
      ) VALUES ('role-sushi', ?, 'item-sushi', 'recipe-sushi', 'primary', 'active',
        ?, NULL, ?, ?, 'local', NULL)
    `,
    [BUSINESS, fixedTimestamp, fixedTimestamp, fixedTimestamp],
  );
}

async function catalogRow(db) {
  return db.getFirstAsync(
    `SELECT lifecycle_status, readiness_state, sellable, kiosk_enabled,
       selling_price_state, archived_at
     FROM catalog_items WHERE id = 'item-sushi'`,
  );
}

async function productRow(db) {
  return db.getFirstAsync(
    `SELECT active, price FROM products WHERE id = 'product-sushi'`,
  );
}

/** The exact native branch of listKioskEligibleCatalogProducts. */
async function kioskEligibleCount(db) {
  const row = await db.getFirstAsync(
    `
      SELECT COUNT(*) AS count
      FROM catalog_items ci
      INNER JOIN legacy_item_bindings b
        ON b.catalog_item_id = ci.id AND b.entity_kind = 'product'
        AND b.deleted_at IS NULL
      INNER JOIN products p
        ON p.id = b.legacy_entity_id AND p.deleted_at IS NULL
      WHERE ci.business_id = ? AND ci.deleted_at IS NULL
        AND b.compatibility_mode IN ('reviewed_legacy', 'native')
        AND b.review_required = 0
        AND ci.lifecycle_status = 'active'
        AND ci.sellable = 1
        AND ci.kiosk_enabled = 1
        AND ci.selling_price_state = 'known'
        AND p.active = 1
    `,
    [BUSINESS],
  );
  return Number(row?.count ?? 0);
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kitamo-paninda-listing-"));
  const dbPath = path.join(root, "listing.sqlite");
  const db = new SqliteCliDatabase(dbPath);
  for (const migration of loadMigrations()) await db.execAsync(migration.up);

  // --- Baseline: exactly the state publication used to leave behind --------
  await seedPublishedRecipeItem(db, { withPrice: false });
  await db.runAsync(
    `UPDATE catalog_items SET lifecycle_status='ready', readiness_state='incomplete',
       sellable=0, kiosk_enabled=0 WHERE id='item-sushi'`,
  );
  assert.equal(
    await kioskEligibleCount(db),
    0,
    "an unlisted published Recipe must not be Kiosk-eligible",
  );
  assert.equal(
    catalogDomain.resolvePanindaSection({
      classification: "finished_product",
      lifecycle: "ready",
      readinessState: "incomplete",
      compatibilityMode: "native",
      sourceType: "native",
      bindingStatus: "active",
      stockPolicy: "product_scalar",
      productActive: false,
      hasDraft: false,
      hasRecipe: true,
      hasPublishedRecipe: true,
    }),
    "needs_setup",
    "an unlisted published Recipe starts in Needs Setup",
  );
  console.log("baseline unlisted published Recipe: passed");

  // --- Listing without a price must be refused, not silently defaulted ----
  const noPrice = await listingRepository.listCatalogItemForSale(
    { catalogItemId: "item-sushi", ownerAuthorized: true, sellingPrice: null },
    db,
  );
  assert.equal(noPrice.outcome, "blocked");
  assert.equal(noPrice.requiresSellingPrice, true);
  assert.ok(noPrice.blockers.includes("selling_price_required"));
  assert.equal(
    (await productRow(db)).active,
    0,
    "a blocked listing must not partially activate the Paninda record",
  );
  console.log("listing without a price is refused atomically: passed");

  // --- Unauthorized listing is fail-closed --------------------------------
  const unauthorized = await listingRepository.listCatalogItemForSale(
    { catalogItemId: "item-sushi", ownerAuthorized: false, sellingPrice: 25 },
    db,
  );
  assert.equal(unauthorized.outcome, "blocked");
  assert.ok(unauthorized.blockers.includes("owner_authorization_required"));
  assert.equal((await productRow(db)).active, 0);
  console.log("unauthorized listing is fail-closed: passed");

  // --- The transition that breaks the cycle -------------------------------
  const listed = await listingRepository.listCatalogItemForSale(
    { catalogItemId: "item-sushi", ownerAuthorized: true, sellingPrice: 25 },
    db,
  );
  assert.equal(listed.outcome, "listed");
  assert.equal(listed.sellingPrice, 25);

  const afterListing = await catalogRow(db);
  assert.equal(afterListing.lifecycle_status, "active");
  assert.equal(afterListing.readiness_state, "ready");
  assert.equal(afterListing.sellable, 1);
  assert.equal(afterListing.kiosk_enabled, 1);
  assert.equal(afterListing.selling_price_state, "known");
  const listedProduct = await productRow(db);
  assert.equal(listedProduct.active, 1);
  assert.equal(listedProduct.price, 25);
  assert.equal(
    await kioskEligibleCount(db),
    1,
    "a listed Recipe-backed item must become Kiosk-eligible",
  );
  assert.equal(
    catalogDomain.resolvePanindaSection({
      classification: "finished_product",
      lifecycle: "active",
      readinessState: "ready",
      compatibilityMode: "native",
      sourceType: "native",
      bindingStatus: "active",
      stockPolicy: "product_scalar",
      productActive: true,
      hasDraft: false,
      hasRecipe: true,
      hasPublishedRecipe: true,
    }),
    "active",
    "a listed item reaches the Active Paninda section",
  );
  console.log("listing reaches Active + Kiosk eligibility: passed");

  // --- Reverse transition: listing is never one-way -----------------------
  const unlisted = await listingRepository.unlistCatalogItemFromSale(
    { catalogItemId: "item-sushi", ownerAuthorized: true },
    db,
  );
  assert.equal(unlisted.outcome, "unlisted");
  const afterUnlist = await catalogRow(db);
  assert.equal(afterUnlist.lifecycle_status, "ready");
  assert.equal(afterUnlist.sellable, 0);
  assert.equal(afterUnlist.kiosk_enabled, 0);
  assert.equal((await productRow(db)).active, 0);
  assert.equal(
    (await productRow(db)).price,
    25,
    "unlisting must preserve the price so relisting does not re-ask",
  );
  assert.equal(await kioskEligibleCount(db), 0);
  console.log("unlisting is reversible and preserves evidence: passed");

  // --- Relisting round trip ----------------------------------------------
  const relisted = await listingRepository.listCatalogItemForSale(
    { catalogItemId: "item-sushi", ownerAuthorized: true, sellingPrice: null },
    db,
  );
  assert.equal(
    relisted.outcome,
    "listed",
    "relisting must reuse the retained known price without re-asking",
  );
  assert.equal(await kioskEligibleCount(db), 1);
  console.log("relisting reuses retained price: passed");

  // --- Archive/restore is not a one-way trap ------------------------------
  await db.runAsync(
    `UPDATE catalog_items SET lifecycle_status='archived', readiness_state='blocked',
       sellable=0, kiosk_enabled=0, archived_at=? WHERE id='item-sushi'`,
    [fixedTimestamp],
  );
  await db.runAsync(`UPDATE products SET active=0 WHERE id='product-sushi'`);
  assert.equal(await kioskEligibleCount(db), 0);

  const blockedListing = await listingRepository.listCatalogItemForSale(
    { catalogItemId: "item-sushi", ownerAuthorized: true, sellingPrice: 25 },
    db,
  );
  assert.equal(blockedListing.outcome, "blocked");
  assert.ok(blockedListing.blockers.includes("item_archived"));

  const restored = await listingRepository.restoreArchivedCatalogItem(
    { catalogItemId: "item-sushi", ownerAuthorized: true },
    db,
  );
  assert.equal(restored.outcome, "restored");
  const afterRestore = await catalogRow(db);
  assert.equal(afterRestore.lifecycle_status, "ready");
  assert.equal(afterRestore.archived_at, null);
  assert.equal(
    (await productRow(db)).active,
    0,
    "restore must not silently put an item back on sale",
  );
  const relistedAfterRestore = await listingRepository.listCatalogItemForSale(
    { catalogItemId: "item-sushi", ownerAuthorized: true, sellingPrice: 30 },
    db,
  );
  assert.equal(relistedAfterRestore.outcome, "listed");
  assert.equal(await kioskEligibleCount(db), 1);
  console.log("archive -> restore -> relist round trip: passed");

  // --- Integrity ----------------------------------------------------------
  assert.equal(db.runCli("PRAGMA integrity_check;"), "ok");
  assert.equal(db.runCli("PRAGMA foreign_key_check;"), "");
  console.log("integrity_check and foreign_key_check: passed");

  fs.rmSync(root, { recursive: true, force: true });
  console.log(
    "ALL PANINDA LISTING TRANSACTION CHECKS PASSED: no lifecycle dead end remains",
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
