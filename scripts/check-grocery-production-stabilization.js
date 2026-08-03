const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

const root = process.cwd();

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loadTypeScriptModule(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const output = ts.transpileModule(source(relativePath), {
    fileName: absolutePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      strict: true,
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
    (request) => {
      throw new Error(`Unexpected Grocery conversion-check import: ${request}`);
    },
    loaded,
    absolutePath,
    path.dirname(absolutePath),
  );
  return loaded.exports;
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function assertExcludes(text, unexpected, label) {
  if (text.includes(unexpected)) {
    throw new Error(`${label}: unexpectedly contains ${JSON.stringify(unexpected)}`);
  }
}

function extractTemplateAfter(text, marker, method = "getAllAsync") {
  const markerIndex = text.indexOf(marker);
  const queryIndex = text.indexOf(method, markerIndex);
  const start = text.indexOf("`", queryIndex);
  const end = text.indexOf("`", start + 1);
  if (markerIndex < 0 || queryIndex < 0 || start < 0 || end < 0) {
    throw new Error(`Could not extract SQL after ${marker}`);
  }
  return text.slice(start + 1, end);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function bindSql(statement, values) {
  let index = 0;
  const bound = statement.replace(/\?/g, () => {
    if (index >= values.length) throw new Error("SQL fixture has too few values");
    return sqlLiteral(values[index++]);
  });
  if (index !== values.length) throw new Error("SQL fixture has unused values");
  return bound;
}

const lots = source("src/db/repositories/ingredientLots.ts");
const grocery = source("src/services/groceryPool.ts");
const missing = source("src/services/groceryRequirements.ts");
const groceryUi = source("app/owner/grocery.tsx");
const recipeEditorUi = source("app/owner/recipe-editor.tsx");
const planner = source("src/services/productionPlanner.ts");
const productionUi = source("app/owner/production.tsx");
const production = source("src/services/production.ts");
const lifecycle = source("src/db/repositories/itemLifecycle.ts");

for (const field of [
  "entered_quantity",
  "entered_unit",
  "unit_standard_snapshot",
  "conversion_chain_json",
]) {
  assertIncludes(lots, field, "ingredient-lot evidence persistence");
}
assertIncludes(lots, "recorded_total_cost = ?", "missing-price completion");
assertIncludes(
  lots,
  "cost_state IN ('unknown', 'legacy_zero_unresolved')",
  "known historical price guard",
);
assertIncludes(
  lots,
  "Record new evidence instead of rewriting history.",
  "known historical price guard",
);
assertIncludes(lots, "updateIngredientLotMetadata", "descriptive metadata-only boundary");
assertIncludes(
  lots,
  "compareAndSetIngredientLotRemainingQuantity",
  "concurrent stock-adjustment guard",
);
for (const evidenceBoundary of [
  "validateIngredientLotConversionEvidence",
  "validateRecipeConversionSnapshotEvidence",
  "unitStandardSnapshot: lot.unitStandardSnapshot",
  "expectedInputUnit: lot.enteredUnit",
  "expectedOutputUnit: lot.unit",
  "expectedOutputQuantityPerInputUnit: factor",
]) {
  assertIncludes(lots, evidenceBoundary, "ingredient-lot conversion-evidence boundary");
}

const conversionRuntime = loadTypeScriptModule(
  "src/domain/recipeConversionChains.ts",
);
const customCupChain = conversionRuntime.buildRecipeConversionChain([
  {
    fromQuantity: 1,
    fromUnit: "custom_cup",
    toQuantity: 240,
    toUnit: "ml",
    standard: "business_custom",
    meaning: "Business cup = 240 mL",
  },
]);
assertEqual(customCupChain.ok, true, "custom-cup fixture chain is valid");
const customCupSnapshot = customCupChain.snapshot;
const customCupEvidence = {
  conversionChainJson:
    conversionRuntime.serializeRecipeConversionChain(customCupSnapshot),
  unitStandardSnapshot: customCupSnapshot.unitStandardSummary,
  expectedInputUnit: "custom_cup",
  expectedOutputUnit: "ml",
  expectedOutputQuantityPerInputUnit: 240,
};
assertEqual(
  conversionRuntime.validateRecipeConversionSnapshotEvidence(
    customCupEvidence,
  ).ok,
  true,
  "canonical custom-cup lot evidence is accepted",
);
for (const [label, override, expectedReason] of [
  [
    "standard",
    { unitStandardSnapshot: "us_customary" },
    "unit_standard_mismatch",
  ],
  [
    "direction",
    { expectedInputUnit: "ml", expectedOutputUnit: "custom_cup" },
    "input_unit_mismatch",
  ],
  [
    "factor",
    { expectedOutputQuantityPerInputUnit: 250 },
    "factor_mismatch",
  ],
]) {
  const result = conversionRuntime.validateRecipeConversionSnapshotEvidence({
    ...customCupEvidence,
    ...override,
  });
  assertEqual(result.ok, false, `mismatched ${label} evidence is rejected`);
  assertEqual(
    result.reason,
    expectedReason,
    `mismatched ${label} evidence fails for the expected reason`,
  );
}
console.log("unknown price and entered-unit evidence guards: passed");

for (const unit of [
  '"metric_cup"',
  '"us_cup"',
  '"custom_cup"',
  '"us_gallon"',
  '"imperial_gallon"',
]) {
  assertIncludes(grocery, unit, "explicit Grocery purchase unit");
}
assertIncludes(grocery, 'input.totalCost === null ? "unknown" : "known"', "unknown versus known-zero boundary");
assertIncludes(grocery, "recordedCostPerUnit", "authoritative Grocery valuation");
assertIncludes(grocery, "completeIngredientLotCost", "complete-price service boundary");
assertIncludes(
  grocery,
  "unitStandardSnapshot: chain.snapshot.unitStandardSummary",
  "canonical Grocery conversion-standard evidence",
);
console.log("Grocery unknown/known-zero and explicit volume units: passed");

for (const requirement of [
  "ingredient_lot",
  "No usable known purchase-cost evidence",
  "Purchase cost belongs to this direct-resale item",
  "Selling price must be completed in Paninda or Recipe Book",
  "Published Recipe cost is incomplete",
  "Saved production plan has incomplete expected cost",
]) {
  assertIncludes(missing, requirement, "Missing Prices projection");
}
assertExcludes(missing, "INSERT ", "read-only Missing Prices projection");
assertExcludes(missing, "UPDATE ", "read-only Missing Prices projection");
assertExcludes(missing, "DELETE ", "read-only Missing Prices projection");
assertExcludes(missing, "supply_packaging", "Kiosk supplies remain out of scope");
assertIncludes(
  missing,
  "SELECT 1 FROM ingredient_lots visible_lot",
  "ingredient and lot Missing Prices de-duplication",
);
console.log("cross-owner Missing Prices projection remains read-only: passed");

for (const affordance of [
  "Missing Prices (",
  "Leave blank to save this lot as No Price",
  "Complete missing price",
  "entry.lotId && candidate.id === entry.lotId",
  "Add Grocery purchase",
  "Add another purchase",
  "Open Recipe Book (not filtered)",
  "Edit non-historical metadata",
  "Adjust remaining stock",
  "Mark lot empty with entered reason",
  "Archive ingredient",
]) {
  assertIncludes(groceryUi, affordance, "Grocery usability affordance");
}
assertIncludes(groceryUi, "Math.max(insets.bottom, spacing.xl)", "safe-area bottom padding");
assertIncludes(groceryUi, 'maxHeight: "92%"', "bounded Grocery sheets");
for (const routeFocusBoundary of [
  "requestedLotId",
  "requestedIngredientId",
  "nextSnapshot.lots.find((lot) => lot.id === requestedLotId)",
  'setFilter("")',
  'setViewMode("all")',
  "openLotActions(requestedLot)",
]) {
  assertIncludes(
    groceryUi,
    routeFocusBoundary,
    "Recipe-to-Grocery exact lot focus",
  );
}
for (const recipeRouteBoundary of [
  'pathname: "/owner/grocery"',
  "lotId: selectedLot.id",
  "ingredientId: selectedLot.ingredientId",
]) {
  assertIncludes(
    recipeEditorUi,
    recipeRouteBoundary,
    "Recipe-to-Grocery exact lot route",
  );
}
assertIncludes(
  groceryUi,
  "Recipe Book opens without an ingredient filter",
  "explicit ingredient-filter limitation",
);
assertIncludes(
  groceryUi,
  "markGroceryLotEmpty(lot.id, reason)",
  "owner-entered empty-lot reason",
);
assertExcludes(
  groceryUi,
  'markGroceryLotEmpty(lot.id, "Owner confirmed empty lot")',
  "hard-coded empty-lot reason",
);
assertIncludes(
  grocery,
  "await db.withExclusiveTransactionAsync(async (txn) =>",
  "atomic Grocery archive boundary",
);
assertIncludes(
  grocery,
  "archiveCatalogItemInTransaction(",
  "transactional catalog archive helper",
);
assertIncludes(
  grocery,
  "updateIngredient(ingredientId, { isActive: false }, txn)",
  "transactional Ingredient projection archive",
);
assertIncludes(
  grocery,
  "binding_status IN ('active', 'archived')",
  "retry-safe Grocery archive lookup",
);
assertIncludes(
  lifecycle,
  "export async function archiveCatalogItemInTransaction",
  "composable catalog archive transaction",
);
console.log("Grocery Missing Prices and bounded action UI: passed");

const nativeReaderStart = planner.indexOf("export async function loadNativeProductionReadiness");
const nativeReaderEnd = planner.indexOf("\nfunction aggregateCostState", nativeReaderStart);
if (nativeReaderStart < 0 || nativeReaderEnd < 0) {
  throw new Error("native Production readiness reader boundary is unavailable");
}
const nativeReader = planner.slice(nativeReaderStart, nativeReaderEnd);
for (const mutation of [
  "withExclusiveTransactionAsync",
  ".runAsync(",
  "recordProduction",
  "saveProductionPlan",
  "createIngredientMovement",
  "createProductStockLot",
]) {
  assertExcludes(nativeReader, mutation, "read-only native Production readiness reader");
}
assertIncludes(nativeReader, "loadRecipeVersionGraph", "persisted immutable graph reader");
assertIncludes(nativeReader, "const executionBlocked = graphBlocked || costIncomplete", "incomplete native Recipe fail-closed guard");
assertIncludes(nativeReader, "status: executionBlocked", "blocked native Recipe visibility");
assertIncludes(
  nativeReader,
  "Recipe dependency information could not be loaded safely.",
  "fail-closed native graph load",
);
assertExcludes(
  nativeReader,
  "validation.error.message",
  "internal Recipe identifiers in owner-facing requirements",
);
assertIncludes(nativeReader, '"staged_execution_deferred"', "nested execution deferral");
assertIncludes(
  nativeReader,
  "missingProductProjection",
  "missing Product projection blocker",
);
for (const projectionGuard of [
  "version.business_id = recipe.business_id",
  "item.business_id = recipe.business_id",
  "product_binding.business_id = recipe.business_id",
  "product_projection.business_id = recipe.business_id",
  "product_projection.active = 1",
  "product_projection.deleted_at IS NULL",
  "product_branch.active = 1",
]) {
  assertIncludes(
    nativeReader,
    projectionGuard,
    "active business-applicable Product projection guard",
  );
}
assertIncludes(
  productionUi,
  "Preparation plan ready; staged production will be enabled in the next production phase.",
  "definition-only nested Production explanation",
);
assertIncludes(productionUi, "Native Recipe production readiness", "separate native Production section");
assertIncludes(
  productionUi,
  "Definition-only · no inventory mutation",
  "definition-only native planning label",
);
assertIncludes(
  productionUi,
  "const orderedNativeReadiness = useMemo",
  "requested native Recipe prioritization",
);
assertIncludes(
  productionUi,
  "requested={entry.recipeId === requestedRecipeId}",
  "requested native Recipe focus handoff",
);
assertIncludes(
  productionUi,
  'label="Requested from Paninda"',
  "requested native Recipe visible highlight",
);
assertIncludes(
  productionUi,
  "!nativeRecipeIds.has(item.recipe.id)",
  "native Recipe exclusion from legacy flat executor",
);
assertIncludes(
  productionUi,
  "publishedItemId: entry.catalogItemId",
  "item-specific Recipe Book navigation",
);
assertIncludes(productionUi, "loadRecipesOverview", "legacy Recipe reader remains available");
assertIncludes(productionUi, "recordProduction", "legacy production executor remains available");
assertIncludes(
  production,
  "assertLegacyFlatProductionBoundary",
  "service-level legacy executor boundary",
);
assertIncludes(
  production,
  'boundary.versioning_state !== "legacy_compat"',
  "native Recipe fail-closed service guard",
);
console.log("native Production readiness is listed without a mutation path: passed");

const databasePath = path.join(
  os.tmpdir(),
  `kitamo-grocery-production-${process.pid}-${Date.now()}.sqlite`,
);
function sqlite(statement) {
  return execFileSync("sqlite3", [databasePath, statement], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function sqliteMustFail(statement) {
  try {
    execFileSync("sqlite3", ["-bail", databasePath, statement], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return;
  }
  throw new Error("SQLite rollback fixture unexpectedly succeeded");
}
try {
  const migrationDirectory = path.join(root, "src/db/migrations");
  const migrationFiles = fs
    .readdirSync(migrationDirectory)
    .filter((file) => /^\d{3}_.+\.ts$/.test(file))
    .sort();
  for (const migrationFile of migrationFiles) {
    const migrationSource = fs.readFileSync(
      path.join(migrationDirectory, migrationFile),
      "utf8",
    );
    const up = migrationSource.match(/\bup:\s*`([\s\S]*?)`\s*,?\s*\n\s*}/);
    if (!up) throw new Error(`Could not parse ${migrationFile}`);
    sqlite(`BEGIN EXCLUSIVE; ${up[1]} COMMIT;`);
  }
  const missingSql = bindSql(extractTemplateAfter(
    missing,
    "export async function listGroceryMissingPrices",
  ), Array(6).fill("business_missing"));
  const readinessSql = bindSql(extractTemplateAfter(
    planner,
    "export async function loadNativeProductionReadiness",
  ), ["business_missing"]);
  sqlite(missingSql);
  sqlite(readinessSql);
  console.log("Missing Prices and native readiness SQL parse on fresh schema: passed");

  const timestamp = "2026-08-01T00:00:00.000Z";
  sqlite(`
    INSERT INTO businesses (
      id, business_name, business_type, owner_name, barangay,
      preferred_language, currency, created_at, updated_at, sync_status,
      deleted_at
    ) VALUES (
      'business_fixture', 'Fixture', 'food', 'Owner', 'Barangay',
      'Taglish', 'PHP', '${timestamp}', '${timestamp}', 'local', NULL
    );
    INSERT INTO ingredients (
      id, business_id, name, default_unit, category, low_stock_threshold,
      is_active, created_at, updated_at, sync_status, deleted_at
    ) VALUES
      ('ingredient_unknown', 'business_fixture', 'Rice', 'kg', 'General', 0, 1,
        '${timestamp}', '${timestamp}', 'local', NULL),
      ('ingredient_no_lot', 'business_fixture', 'Salt', 'kg', 'General', 0, 1,
        '${timestamp}', '${timestamp}', 'local', NULL),
      ('ingredient_archive', 'business_fixture', 'Archive me', 'kg', 'General', 0, 1,
        '${timestamp}', '${timestamp}', 'local', NULL);
    INSERT INTO catalog_items (
      id, business_id, name, normalized_name, source_type, classification,
      lifecycle_status, readiness_state, classification_review_required,
      sellable, kiosk_enabled, purchase_cost_state, selling_price_state,
      stock_policy, created_at, updated_at, sync_status, deleted_at
    ) VALUES
      ('catalog_unknown', 'business_fixture', 'Rice', 'rice',
        'legacy_ingredient', 'legacy_unclassified', 'draft', 'legacy_review',
        1, 0, 0, 'unknown', 'not_applicable', 'ingredient_lots',
        '${timestamp}', '${timestamp}', 'local', NULL),
      ('catalog_no_lot', 'business_fixture', 'Salt', 'salt',
        'legacy_ingredient', 'legacy_unclassified', 'draft', 'legacy_review',
        1, 0, 0, 'unknown', 'not_applicable', 'ingredient_lots',
        '${timestamp}', '${timestamp}', 'local', NULL),
      ('catalog_archive', 'business_fixture', 'Archive me', 'archive me',
        'legacy_ingredient', 'legacy_unclassified', 'draft', 'legacy_review',
        1, 0, 0, 'unknown', 'not_applicable', 'ingredient_lots',
        '${timestamp}', '${timestamp}', 'local', NULL),
      ('catalog_supply', 'business_fixture', 'Paper cup', 'paper cup',
        'native', 'supply_packaging', 'active', 'ready',
        0, 0, 0, 'unknown', 'not_applicable', 'product_lots',
        '${timestamp}', '${timestamp}', 'local', NULL),
      ('catalog_resale', 'business_fixture', 'Bottled drink', 'bottled drink',
        'native', 'direct_resale_product', 'active', 'ready',
        0, 1, 1, 'unknown', 'unknown', 'product_lots',
        '${timestamp}', '${timestamp}', 'local', NULL);
    INSERT INTO legacy_item_bindings (
      id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
      projection_role, binding_status, compatibility_mode, review_required,
      legacy_active_snapshot, migration_provenance, created_at, updated_at,
      sync_status, deleted_at
    ) VALUES
      ('binding_unknown', 'business_fixture', 'catalog_unknown', 'ingredient',
        'ingredient_unknown', 'legacy_ingredient', 'active',
        'legacy_unclassified', 1, 1, 'migration_011', '${timestamp}',
        '${timestamp}', 'local', NULL),
      ('binding_no_lot', 'business_fixture', 'catalog_no_lot', 'ingredient',
        'ingredient_no_lot', 'legacy_ingredient', 'active',
        'legacy_unclassified', 1, 1, 'migration_011', '${timestamp}',
        '${timestamp}', 'local', NULL),
      ('binding_archive', 'business_fixture', 'catalog_archive', 'ingredient',
        'ingredient_archive', 'legacy_ingredient', 'active',
        'legacy_unclassified', 1, 1, 'migration_011', '${timestamp}',
        '${timestamp}', 'local', NULL);
    INSERT INTO ingredient_lots (
      id, business_id, ingredient_id, purchase_date, purchased_quantity,
      remaining_quantity, unit, total_cost, cost_per_unit, status, created_at,
      updated_at, sync_status, deleted_at, provenance_state, cost_state,
      recorded_total_cost, recorded_cost_per_unit, entered_quantity,
      entered_unit, unit_standard_snapshot, conversion_chain_json
    ) VALUES
      ('lot_unknown', 'business_fixture', 'ingredient_unknown', '2026-08-01',
        50, 50, 'kg', 0, 0, 'active', '${timestamp}', '${timestamp}', 'local',
        NULL, 'purchase_recorded', 'unknown', NULL, NULL, 50, 'kg', 'metric', NULL),
      ('lot_known_zero', 'business_fixture', 'ingredient_unknown', '2026-08-01',
        1, 1, 'kg', 0, 0, 'active', '${timestamp}', '${timestamp}', 'local',
        NULL, 'purchase_recorded', 'known', 0, 0, 1, 'kg', 'metric', NULL);
    INSERT INTO ingredient_movements (
      id, business_id, ingredient_id, lot_id, movement_type, quantity, unit,
      unit_cost, total_cost, reason, created_at, updated_at, sync_status,
      deleted_at
    ) VALUES (
      'movement_unknown', 'business_fixture', 'ingredient_unknown',
      'lot_unknown', 'purchase', 50, 'kg', NULL, NULL, 'Grocery purchase',
      '${timestamp}', '${timestamp}', 'local', NULL
    );
  `);

  const fixtureMissingSql = bindSql(
    extractTemplateAfter(
      missing,
      "export async function listGroceryMissingPrices",
    ),
    Array(6).fill("business_fixture"),
  );
  assertEqual(
    sqlite(`SELECT group_concat(id, ',') FROM (${fixtureMissingSql})
      WHERE ingredient_id = 'ingredient_unknown'`),
    "lot:lot_unknown",
    "unknown lot is not duplicated by an ingredient-level Missing Price",
  );
  assertEqual(
    sqlite(`SELECT group_concat(id, ',') FROM (${fixtureMissingSql})
      WHERE ingredient_id = 'ingredient_no_lot'`),
    "ingredient:ingredient_no_lot",
    "zero-lot ingredient retains an actionable Missing Price",
  );
  assertEqual(
    sqlite(`SELECT COUNT(*) FROM (${fixtureMissingSql})
      WHERE catalog_item_id = 'catalog_supply'`),
    "0",
    "Kiosk supply does not enter Grocery Missing Prices",
  );
  assertEqual(
    sqlite(`SELECT COUNT(*) FROM (${fixtureMissingSql})
      WHERE catalog_item_id = 'catalog_resale' AND kind = 'purchase_cost'`),
    "1",
    "direct-resale purchase price remains in Missing Prices",
  );
  console.log("Missing Prices grouping and owner-scope fixtures: passed");

  assertEqual(
    sqlite(`SELECT cost_state || '|' || COALESCE(recorded_total_cost, 'NULL')
      || '|' || COALESCE(recorded_cost_per_unit, 'NULL')
      FROM ingredient_lots WHERE id = 'lot_unknown'`),
    "unknown|NULL|NULL",
    "blank purchase cost persists nullable authoritative evidence",
  );
  assertEqual(
    sqlite(`SELECT cost_state || '|' || recorded_total_cost || '|'
      || recorded_cost_per_unit FROM ingredient_lots
      WHERE id = 'lot_known_zero'`),
    "known|0.0|0.0",
    "known zero remains distinct from unknown",
  );
  const completionSql = bindSql(
    extractTemplateAfter(
      lots,
      "export async function completeIngredientLotCost",
      "runAsync",
    ),
    [500, 10, 500, 10, "2026-08-01T00:01:00.000Z", "lot_unknown", timestamp],
  );
  sqlite(completionSql);
  assertEqual(
    sqlite(`SELECT cost_state || '|' || recorded_total_cost || '|'
      || recorded_cost_per_unit FROM ingredient_lots WHERE id = 'lot_unknown'`),
    "known|500.0|10.0",
    "missing purchase price completes as authoritative known evidence",
  );
  assertEqual(
    sqlite(`SELECT COUNT(*) || '|' || COALESCE(unit_cost, 'NULL') || '|'
      || COALESCE(total_cost, 'NULL') FROM ingredient_movements
      WHERE id = 'movement_unknown'`),
    "1|NULL|NULL",
    "price completion does not rewrite prior movement evidence",
  );
  const knownRewriteSql = bindSql(
    extractTemplateAfter(
      lots,
      "export async function completeIngredientLotCost",
      "runAsync",
    ),
    [999, 999, 999, 999, "2026-08-01T00:02:00.000Z", "lot_known_zero", timestamp],
  );
  sqlite(knownRewriteSql);
  assertEqual(
    sqlite(`SELECT cost_state || '|' || recorded_total_cost || '|'
      || recorded_cost_per_unit FROM ingredient_lots
      WHERE id = 'lot_known_zero'`),
    "known|0.0|0.0",
    "known-zero evidence cannot be rewritten by completion",
  );
  console.log("nullable cost, known-zero, completion, and history fixtures: passed");

  sqlite(`
    INSERT INTO products (
      id, business_id, name, category, price, cost, stock_qty, unit_type,
      low_stock_threshold, active, product_type, created_at, updated_at,
      sync_status, deleted_at
    ) VALUES (
      'product_guard', 'business_fixture', 'Guard output', 'General', 1, 1,
      0, 'piece', 0, 1, 'retail item', '${timestamp}', '${timestamp}',
      'local', NULL
    );
    INSERT INTO recipes (
      id, business_id, output_product_id, name, output_quantity, output_unit,
      production_mode, suggested_selling_price, notes, is_active, created_at,
      updated_at, sync_status, deleted_at, active_version_id, versioning_state
    ) VALUES
      ('recipe_legacy_guard', 'business_fixture', 'product_guard', 'Legacy', 1,
        'pcs', 'prepared_before_selling', NULL, NULL, 1, '${timestamp}',
        '${timestamp}', 'local', NULL, NULL, 'legacy_compat'),
      ('recipe_native_guard', 'business_fixture', 'product_guard', 'Native', 1,
        'pcs', 'prepared_before_selling', NULL, NULL, 1, '${timestamp}',
        '${timestamp}', 'local', NULL, NULL, 'native');
  `);
  const legacyBoundarySql = extractTemplateAfter(
    production,
    "async function assertLegacyFlatProductionBoundary",
    "getFirstAsync",
  );
  assertEqual(
    sqlite(bindSql(legacyBoundarySql, ["recipe_legacy_guard", "business_fixture"])),
    "legacy_compat|",
    "legacy flat Recipe remains eligible at the executor boundary",
  );
  assertEqual(
    sqlite(bindSql(legacyBoundarySql, ["recipe_native_guard", "business_fixture"])),
    "native|",
    "native Recipe state is visible to the fail-closed executor guard",
  );
  console.log("legacy/native production service-boundary fixture: passed");

  sqlite(`
    INSERT INTO branches (
      id, business_id, branch_name, branch_type, active, created_at,
      updated_at, sync_status, deleted_at
    ) VALUES (
      'branch_inactive', 'business_fixture', 'Closed stall', 'stall', 0,
      '${timestamp}', '${timestamp}', 'local', NULL
    );
    INSERT INTO products (
      id, business_id, branch_id, name, category, price, cost, stock_qty,
      unit_type, low_stock_threshold, active, product_type, created_at,
      updated_at, sync_status, deleted_at
    ) VALUES
      ('product_projection_active', 'business_fixture', NULL, 'Active output',
        'General', 1, 1, 0, 'piece', 0, 1, 'retail item', '${timestamp}',
        '${timestamp}', 'local', NULL),
      ('product_projection_inactive', 'business_fixture', NULL, 'Inactive output',
        'General', 1, 1, 0, 'piece', 0, 0, 'retail item', '${timestamp}',
        '${timestamp}', 'local', NULL),
      ('product_projection_closed_branch', 'business_fixture', 'branch_inactive',
        'Closed-branch output', 'General', 1, 1, 0, 'piece', 0, 1,
        'retail item', '${timestamp}', '${timestamp}', 'local', NULL);
    INSERT INTO catalog_items (
      id, business_id, name, normalized_name, source_type, classification,
      lifecycle_status, readiness_state, classification_review_required,
      sellable, kiosk_enabled, purchase_cost_state, selling_price_state,
      stock_policy, created_at, updated_at, sync_status, deleted_at
    ) VALUES
      ('catalog_projection_active', 'business_fixture', 'Active output',
        'active output', 'native', 'finished_product', 'active', 'ready', 0,
        1, 1, 'known', 'known', 'product_lots', '${timestamp}', '${timestamp}',
        'local', NULL),
      ('catalog_projection_inactive', 'business_fixture', 'Inactive output',
        'inactive output', 'native', 'prepared_base', 'active', 'ready', 0,
        0, 0, 'known', 'not_applicable', 'product_lots', '${timestamp}', '${timestamp}',
        'local', NULL),
      ('catalog_projection_closed_branch', 'business_fixture',
        'Closed-branch output', 'closed-branch output', 'native',
        'finished_product', 'active', 'ready', 0, 1, 1, 'known', 'known',
        'product_lots', '${timestamp}', '${timestamp}', 'local', NULL),
      ('catalog_projection_dangling', 'business_fixture', 'Dangling output',
        'dangling output', 'native', 'finished_product', 'active', 'ready', 0,
        1, 1, 'known', 'known', 'product_lots', '${timestamp}', '${timestamp}',
        'local', NULL);
    INSERT INTO legacy_item_bindings (
      id, business_id, catalog_item_id, entity_kind, legacy_entity_id,
      projection_role, binding_status, compatibility_mode, review_required,
      legacy_active_snapshot, migration_provenance, created_at, updated_at,
      sync_status, deleted_at
    ) VALUES
      ('binding_projection_active', 'business_fixture',
        'catalog_projection_active', 'product', 'product_projection_active',
        'recipe_output', 'active', 'native', 0, 1, 'native', '${timestamp}',
        '${timestamp}', 'local', NULL),
      ('binding_projection_inactive', 'business_fixture',
        'catalog_projection_inactive', 'product', 'product_projection_inactive',
        'recipe_output', 'active', 'native', 0, 0, 'native', '${timestamp}',
        '${timestamp}', 'local', NULL),
      ('binding_projection_closed_branch', 'business_fixture',
        'catalog_projection_closed_branch', 'product',
        'product_projection_closed_branch', 'recipe_output', 'active', 'native',
        0, 1, 'native', '${timestamp}', '${timestamp}', 'local', NULL),
      ('binding_projection_dangling', 'business_fixture',
        'catalog_projection_dangling', 'product', 'product_projection_missing',
        'recipe_output', 'active', 'native', 0, 1, 'native', '${timestamp}',
        '${timestamp}', 'local', NULL);
    INSERT INTO recipes (
      id, business_id, output_product_id, name, output_quantity, output_unit,
      production_mode, suggested_selling_price, notes, is_active, created_at,
      updated_at, sync_status, deleted_at, active_version_id, versioning_state
    ) VALUES
      ('recipe_projection_active', 'business_fixture',
        'product_projection_active', 'Active output', 1, 'pcs',
        'prepared_before_selling', 1, NULL, 1, '${timestamp}', '${timestamp}',
        'local', NULL, 'version_projection_active', 'native'),
      ('recipe_projection_inactive', 'business_fixture',
        'product_projection_inactive', 'Inactive output', 1, 'pcs',
        'prepared_before_selling', 1, NULL, 1, '${timestamp}', '${timestamp}',
        'local', NULL, 'version_projection_inactive', 'native'),
      ('recipe_projection_closed_branch', 'business_fixture',
        'product_projection_closed_branch', 'Closed-branch output', 1, 'pcs',
        'prepared_before_selling', 1, NULL, 1, '${timestamp}', '${timestamp}',
        'local', NULL, 'version_projection_closed_branch', 'native'),
      ('recipe_projection_dangling', 'business_fixture',
        'product_projection_missing',
        'Dangling output', 1, 'pcs', 'prepared_before_selling', 1, NULL, 1,
        '${timestamp}', '${timestamp}', 'local', NULL,
        'version_projection_dangling', 'native');
    INSERT INTO recipe_versions (
      id, business_id, recipe_id, version_number, status, name_snapshot,
      output_catalog_item_id, output_product_id_snapshot,
      expected_output_quantity, expected_output_unit, production_mode,
      suggested_selling_price_snapshot, selling_price_state, notes_snapshot,
      source_kind, source_draft_id, duplicated_from_version_id, graph_state,
      cost_state, effective_at, created_at, updated_at, sync_status, deleted_at
    ) VALUES
      ('version_projection_active', 'business_fixture',
        'recipe_projection_active', 1, 'published', 'Active output',
        'catalog_projection_active', 'product_projection_active', 1, 'pcs',
        'prepared_before_selling', 1, 'known', NULL, 'native_publish', NULL,
        NULL, 'complete', 'known', '${timestamp}', '${timestamp}', '${timestamp}',
        'local', NULL),
      ('version_projection_inactive', 'business_fixture',
        'recipe_projection_inactive', 1, 'published', 'Inactive output',
        'catalog_projection_inactive', 'product_projection_inactive', 1, 'pcs',
        'prepared_before_selling', 1, 'known', NULL, 'native_publish', NULL,
        NULL, 'complete', 'known', '${timestamp}', '${timestamp}', '${timestamp}',
        'local', NULL),
      ('version_projection_closed_branch', 'business_fixture',
        'recipe_projection_closed_branch', 1, 'published',
        'Closed-branch output', 'catalog_projection_closed_branch',
        'product_projection_closed_branch', 1, 'pcs',
        'prepared_before_selling', 1, 'known', NULL, 'native_publish', NULL,
        NULL, 'complete', 'known', '${timestamp}', '${timestamp}', '${timestamp}',
        'local', NULL),
      ('version_projection_dangling', 'business_fixture',
        'recipe_projection_dangling', 1, 'published', 'Dangling output',
        'catalog_projection_dangling', 'product_projection_missing', 1, 'pcs',
        'prepared_before_selling', 1, 'known', NULL, 'native_publish', NULL,
        NULL, 'complete', 'known', '${timestamp}', '${timestamp}', '${timestamp}',
        'local', NULL);
  `);
  const fixtureReadinessSql = bindSql(
    extractTemplateAfter(
      planner,
      "export async function loadNativeProductionReadiness",
    ),
    ["business_fixture"],
  );
  assertEqual(
    sqlite(`SELECT COALESCE(product_id, 'NULL') FROM (${fixtureReadinessSql})
      WHERE recipe_id = 'recipe_projection_active'`),
    "product_projection_active",
    "active business-wide Product projection is accepted",
  );
  assertEqual(
    sqlite(`SELECT COALESCE(product_id, 'NULL') FROM (${fixtureReadinessSql})
      WHERE recipe_id = 'recipe_projection_inactive'`),
    "NULL",
    "inactive prepared-base Product projection remains blocked",
  );
  assertEqual(
    sqlite(`SELECT COALESCE(product_id, 'NULL') FROM (${fixtureReadinessSql})
      WHERE recipe_id = 'recipe_projection_closed_branch'`),
    "NULL",
    "Product projection tied to an inactive branch remains blocked",
  );
  assertEqual(
    sqlite(`SELECT COALESCE(product_id, 'NULL') FROM (${fixtureReadinessSql})
      WHERE recipe_id = 'recipe_projection_dangling'`),
    "NULL",
    "dangling Product binding remains blocked",
  );
  console.log("native Product projection fixtures: passed");

  sqliteMustFail(`
    BEGIN EXCLUSIVE;
    UPDATE catalog_items SET lifecycle_status = 'archived'
      WHERE id = 'catalog_archive';
    UPDATE legacy_item_bindings SET binding_status = 'archived'
      WHERE id = 'binding_archive';
    UPDATE ingredients SET is_active = 0 WHERE id = 'ingredient_archive';
    INSERT INTO businesses (
      id, business_name, business_type, owner_name, barangay, created_at,
      updated_at
    ) VALUES (
      'business_fixture', 'Duplicate', 'food', 'Owner', 'Barangay',
      '${timestamp}', '${timestamp}'
    );
    COMMIT;
  `);
  assertEqual(
    sqlite(`
      SELECT item.lifecycle_status || '|' || binding.binding_status || '|'
        || ingredient.is_active
      FROM catalog_items item
      INNER JOIN legacy_item_bindings binding
        ON binding.catalog_item_id = item.id
      INNER JOIN ingredients ingredient
        ON ingredient.id = binding.legacy_entity_id
      WHERE item.id = 'catalog_archive'
    `),
    "draft|active|1",
    "failed coordinated archive rolls back every projection",
  );
  console.log("coordinated Grocery archive rollback fixture: passed");
} finally {
  fs.rmSync(databasePath, { force: true });
}

console.log("ALL GROCERY AND PRODUCTION STABILIZATION CHECKS PASSED");
