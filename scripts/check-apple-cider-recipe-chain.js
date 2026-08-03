const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const workspace = process.cwd();
const compiledDirectory = path.join(
  workspace,
  "node_modules/.cache/kitamo-apple-cider-recipe-chain-check",
);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "kitamo-apple-cider-recipe-chain-"),
);
const databasePath = path.join(temporaryDirectory, "acceptance.sqlite");
const businessId = "business-apple-cider-acceptance";
const fixedTimestamp = "2026-08-01T00:00:00.000Z";
const US_GALLON_MILLILITERS = 3_785.411784;
const METRIC_CUP_MILLILITERS = 250;

function compileAcceptanceServices() {
  fs.rmSync(compiledDirectory, { recursive: true, force: true });
  fs.mkdirSync(compiledDirectory, { recursive: true });
  const configPath = path.join(temporaryDirectory, "tsconfig.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      compilerOptions: {
        baseUrl: workspace,
        esModuleInterop: true,
        module: "commonjs",
        moduleResolution: "node",
        noEmitOnError: true,
        outDir: compiledDirectory,
        paths: { "@/*": ["src/*"] },
        rootDir: path.join(workspace, "src"),
        skipLibCheck: true,
        strict: true,
        target: "ES2020",
      },
      files: [
        path.join(workspace, "src/domain/recipeConversionChains.ts"),
        path.join(workspace, "src/domain/recipeFirst.ts"),
        path.join(workspace, "src/services/groceryPool.ts"),
        path.join(workspace, "src/services/recipeFirst.ts"),
      ],
    }),
  );
  execFileSync(
    path.join(workspace, "node_modules/.bin/tsc"),
    ["--project", configPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function loadAcceptanceModules() {
  const originalLoad = Module._load;
  Module._load = function loadCompiledModule(request, parent, isMain) {
    if (
      request === "./ownerSetup" &&
      parent?.filename ===
        path.join(compiledDirectory, "services/groceryPool.js")
    ) {
      return {
        async loadOwnerSetupStatus() {
          return { activeBusiness: { id: businessId } };
        },
      };
    }
    if (request === "@/db/client") {
      return {
        openKitamoDatabase() {
          throw new Error(
            "Apple Cider acceptance checks require an injected database.",
          );
        },
      };
    }
    if (request.startsWith("@/")) {
      return originalLoad.call(
        this,
        path.join(compiledDirectory, request.slice(2)),
        parent,
        isMain,
      );
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return {
      grocery: require(path.join(compiledDirectory, "services/groceryPool.js")),
      recipe: require(path.join(compiledDirectory, "services/recipeFirst.js")),
      recipeDomain: require(path.join(compiledDirectory, "domain/recipeFirst.js")),
      conversions: require(
        path.join(compiledDirectory, "domain/recipeConversionChains.js"),
      ),
    };
  } finally {
    Module._load = originalLoad;
  }
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

function closeTo(actual, expected, label) {
  assert.equal(typeof actual, "number", `${label} must be numeric`);
  assert.ok(
    Math.abs(actual - expected) <=
      1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected)),
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function valueOr(source, key, fallback) {
  return Object.hasOwn(source, key) ? source[key] : fallback;
}

function toSaveLine(line) {
  return {
    id: line.id,
    sourceKind: line.sourceKind,
    catalogItemId: line.catalogItemId,
    childRecipeVersionId: line.childRecipeVersionId,
    childDraftId: line.childDraftId,
    customName: line.customName,
    quantity: line.quantity,
    unit: line.unit,
    normalizedQuantity: line.normalizedQuantity,
    normalizedUnit: line.normalizedUnit,
    conversionId: line.conversionId,
    conversionFactorSnapshot: line.conversionFactorSnapshot,
    conversionChainJson: line.conversionChainJson,
    unitStandardSnapshot: line.unitStandardSnapshot,
    role: line.role,
    isOptional: line.isOptional,
    costOverride: line.costOverride,
    costState: line.costState,
    costSource: line.costSource,
    costProfileId: line.costProfileId,
    allocationMode: line.allocationMode,
    legacyIngredientLotId: line.legacyIngredientLotId,
    notes: line.notes,
  };
}

async function saveSnapshot(recipe, db, snapshot, changes = {}) {
  const draft = snapshot.draft;
  const lines = valueOr(changes, "lines", snapshot.lines.map(toSaveLine));
  return recipe.saveRecipeFirstDraftSnapshot(
    {
      draftId: draft.id,
      businessId: draft.businessId,
      expectedRevision: draft.autosaveRevision,
      nextRevision: draft.autosaveRevision + 1,
      outputCatalogItemId: snapshot.output.catalogItemId,
      name: valueOr(changes, "name", draft.name ?? snapshot.output.name),
      category: valueOr(changes, "category", draft.category),
      notes: valueOr(changes, "notes", draft.notes),
      expectedOutputQuantity: valueOr(
        changes,
        "expectedOutputQuantity",
        draft.expectedOutputQuantity,
      ),
      expectedOutputUnit: valueOr(
        changes,
        "expectedOutputUnit",
        draft.expectedOutputUnit,
      ),
      productionMode: valueOr(changes, "productionMode", draft.productionMode),
      suggestedSellingPrice: valueOr(
        changes,
        "suggestedSellingPrice",
        draft.suggestedSellingPrice,
      ),
      classificationProposal: valueOr(
        changes,
        "classificationProposal",
        draft.classificationProposal,
      ),
      sellingPriceState: valueOr(
        changes,
        "sellingPriceState",
        draft.sellingPriceState,
      ),
      sellable: false,
      kioskEnabled: false,
      editorStep: valueOr(changes, "editorStep", draft.editorStep),
      lifecycle: valueOr(changes, "lifecycle", draft.lifecycle),
      unresolvedRequirementCount: valueOr(
        changes,
        "unresolvedRequirementCount",
        lines.filter(
          (line) =>
            !line.isOptional &&
            (line.sourceKind === "unresolved" ||
              line.sourceKind === "child_draft"),
        ).length,
      ),
      lines,
    },
    db,
  );
}

async function countRows(db, tableName, where = "1 = 1", parameters = []) {
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`,
    parameters,
  );
  return Number(row?.count ?? 0);
}

async function seedOwnerContext(recipe, db) {
  await recipe.loadRecipeLibrary(businessId, db);
  await db.runAsync(
    `
      INSERT INTO businesses (
        id, business_name, business_type, owner_name, barangay,
        preferred_language, currency, created_at, updated_at, sync_status,
        deleted_at
      ) VALUES (?, ?, 'food', 'Owner', 'Test Barangay', 'Taglish', 'PHP',
        ?, ?, 'local', NULL)
    `,
    [businessId, "Apple Cider Acceptance", fixedTimestamp, fixedTimestamp],
  );
  await db.runAsync(
    `
      INSERT INTO app_settings (
        id, key, value, value_type, created_at, updated_at
      ) VALUES (?, 'activeBusinessId', ?, 'string', ?, ?)
    `,
    ["setting-active-business", businessId, fixedTimestamp, fixedTimestamp],
  );
}

async function checkQuickEstimateReplacement(recipe, conversions, db) {
  let parent = await recipe.startRecipeFirstDraft(
    {
      businessId,
      name: "Quick Estimate Parent",
      category: "Prepared",
      mode: "prepared_batch",
      ids: {
        catalogItemId: "catalog-estimate-parent",
        productId: "product-estimate-parent",
        bindingId: "binding-estimate-parent",
        draftId: "draft-estimate-parent",
      },
    },
    db,
  );
  const packToKilogram = conversions.buildRecipeConversionChain([
    {
      fromQuantity: 1,
      fromUnit: "pack",
      toQuantity: 0.5,
      toUnit: "kg",
      standard: "item_specific",
      meaning: "Owner-recorded kilograms per pack for this estimate",
    },
  ]);
  assert.equal(packToKilogram.ok, true);
  const packToKilogramJson = conversions.serializeRecipeConversionChain(
    packToKilogram.snapshot,
  );
  const portionToGram = conversions.buildRecipeConversionChain([
    {
      fromQuantity: 1,
      fromUnit: "portion",
      toQuantity: 125,
      toUnit: "g",
      standard: "item_specific",
      meaning: "Owner-recorded grams per portion for this estimate",
    },
  ]);
  assert.equal(portionToGram.ok, true);
  const portionToGramJson = conversions.serializeRecipeConversionChain(
    portionToGram.snapshot,
  );
  const originalInput = {
    requestToken: "estimate-original",
    businessId,
    parentDraftId: parent.draft.id,
    parentExpectedRevision: parent.draft.autosaveRevision,
    parentLineId: "line-estimate-stable",
    preparedDraftId: "draft-estimate-original",
    catalogItemId: "catalog-estimate-original",
    costProfileId: "profile-estimate-original",
    name: "Original Prepared Estimate",
    totalCost: 80,
    referenceQuantity: 1,
    referenceUnit: "kg",
    usageQuantity: 2,
    usageUnit: "pack",
    usageUnitFactorToReference: 0.5,
    conversionChainJson: packToKilogramJson,
    unitStandardSnapshot: "item_specific",
    role: "main",
    isOptional: false,
    notes: "Original estimate evidence",
  };
  const original = await recipe.addQuickEstimatedPreparedInput(
    originalInput,
    db,
  );
  assert.equal(original.parentLineId, "line-estimate-stable");
  assert.equal(original.parentRevision, 1);
  const originalConversion = await db.getFirstAsync(
    `
      SELECT id, from_unit, to_unit, factor
      FROM item_unit_conversions
      WHERE catalog_item_id = ? AND deleted_at IS NULL
    `,
    [original.catalogItemId],
  );
  assert.ok(originalConversion);
  assert.equal(originalConversion.from_unit, "pack");
  assert.equal(originalConversion.to_unit, "kg");
  closeTo(originalConversion.factor, 0.5, "original package conversion");
  const originalLine = (
    await recipe.loadRecipeFirstDraft(parent.draft.id, db)
  ).lines[0];

  const beforeConflict = JSON.stringify(
    await db.getAllAsync(
      `
        SELECT id, catalog_item_id, quantity, unit, role, is_optional,
          cost_override, cost_profile_id
        FROM recipe_draft_lines
        WHERE recipe_draft_id = ? ORDER BY id
      `,
      [parent.draft.id],
    ),
  );
  await assert.rejects(
    recipe.addQuickEstimatedPreparedInput(
      {
        ...originalInput,
        requestToken: "estimate-conflict",
        parentExpectedRevision: 0,
        preparedDraftId: "draft-estimate-conflict",
        catalogItemId: "catalog-estimate-conflict",
        costProfileId: "profile-estimate-conflict",
        name: "Conflicting Estimate",
      },
      db,
    ),
    /Parent Recipe draft changed before estimate insertion/,
  );
  assert.equal(
    await countRows(db, "catalog_items", "id = 'catalog-estimate-conflict'"),
    0,
  );
  assert.equal(
    await countRows(
      db,
      "catalog_cost_profiles",
      "id = 'profile-estimate-conflict'",
    ),
    0,
  );
  assert.equal(
    JSON.stringify(
      await db.getAllAsync(
        `
          SELECT id, catalog_item_id, quantity, unit, role, is_optional,
            cost_override, cost_profile_id
          FROM recipe_draft_lines
          WHERE recipe_draft_id = ? ORDER BY id
        `,
        [parent.draft.id],
      ),
    ),
    beforeConflict,
    "an autosave conflict must roll back every coordinated estimate write",
  );

  const edited = await recipe.addQuickEstimatedPreparedInput(
    {
      requestToken: "estimate-edited",
      businessId,
      parentDraftId: parent.draft.id,
      parentExpectedRevision: original.parentRevision,
      parentLineId: original.parentLineId,
      preparedDraftId: "draft-estimate-edited",
      catalogItemId: "catalog-estimate-edited",
      costProfileId: "profile-estimate-edited",
      name: "Edited Prepared Estimate",
      totalCost: 180,
      referenceQuantity: 1500,
      referenceUnit: "g",
      usageQuantity: 3,
      usageUnit: "portion",
      usageUnitFactorToReference: 125,
      conversionChainJson: portionToGramJson,
      unitStandardSnapshot: "item_specific",
      role: "garnish",
      isOptional: true,
      notes: "Edited estimate evidence",
    },
    db,
  );
  assert.equal(edited.parentLineId, original.parentLineId);
  assert.equal(edited.parentRevision, 2);
  assert.equal(
    await countRows(
      db,
      "recipe_draft_lines",
      "recipe_draft_id = ? AND deleted_at IS NULL",
      [parent.draft.id],
    ),
    1,
    "editing a quick estimate must not duplicate its parent row",
  );
  const editedLine = await db.getFirstAsync(
    `
      SELECT id, catalog_item_id, custom_name, quantity, unit,
        normalized_quantity, normalized_unit, conversion_id,
        conversion_factor_snapshot, role, is_optional, cost_override,
        cost_source, cost_profile_id, notes
      FROM recipe_draft_lines
      WHERE recipe_draft_id = ? AND deleted_at IS NULL
    `,
    [parent.draft.id],
  );
  assert.deepEqual(
    {
      id: editedLine.id,
      catalog_item_id: editedLine.catalog_item_id,
      custom_name: editedLine.custom_name,
      quantity: editedLine.quantity,
      unit: editedLine.unit,
      normalized_quantity: editedLine.normalized_quantity,
      normalized_unit: editedLine.normalized_unit,
      role: editedLine.role,
      is_optional: editedLine.is_optional,
      cost_source: editedLine.cost_source,
      cost_profile_id: editedLine.cost_profile_id,
      notes: editedLine.notes,
    },
    {
      id: "line-estimate-stable",
      catalog_item_id: "catalog-estimate-edited",
      custom_name: "Edited Prepared Estimate",
      quantity: 3,
      unit: "portion",
      normalized_quantity: 375,
      normalized_unit: "g",
      role: "garnish",
      is_optional: 1,
      cost_source: "owner_estimate",
      cost_profile_id: "profile-estimate-edited",
      notes: "Edited estimate evidence",
    },
  );
  closeTo(editedLine.conversion_factor_snapshot, 125, "edited conversion");
  closeTo(editedLine.cost_override, 15, "edited usage-unit cost");
  assert.deepEqual(
    await recipe.reconcileRemovedRecipeLineSource(
      {
        businessId,
        parentDraftId: parent.draft.id,
        line: originalLine,
      },
      db,
    ),
    {
      reconciled: "already_reconciled",
      catalogItemId: original.catalogItemId,
    },
    "the UI reconciliation call must be idempotent after atomic replacement cleanup",
  );
  const editedProfile = await db.getFirstAsync(
    `
      SELECT total_cost, reference_quantity, reference_unit, request_token,
        status
      FROM catalog_cost_profiles WHERE id = ?
    `,
    [edited.costProfile.id],
  );
  assert.deepEqual(editedProfile, {
    total_cost: 180,
    reference_quantity: 1500,
    reference_unit: "g",
    request_token: "estimate-edited",
    status: "active",
  });
  assert.deepEqual(
    await db.getFirstAsync(
      `
        SELECT name, output_catalog_item_id, notes
        FROM recipe_drafts WHERE id = ?
      `,
      [edited.preparedDraftId],
    ),
    {
      name: "Edited Prepared Estimate",
      output_catalog_item_id: "catalog-estimate-edited",
      notes: "Edited estimate evidence",
    },
  );

  for (const [tableName, where, parameters] of [
    ["catalog_items", "id = ?", [original.catalogItemId]],
    ["recipe_drafts", "id = ?", [original.preparedDraftId]],
    ["catalog_cost_profiles", "id = ?", [original.costProfile.id]],
    ["item_unit_conversions", "id = ?", [originalConversion.id]],
  ]) {
    assert.equal(
      await countRows(db, tableName, where, parameters),
      0,
      `${tableName} must not retain the replaced estimate orphan`,
    );
  }

  parent = await recipe.loadRecipeFirstDraft(parent.draft.id, db);
  const removedLine = parent.lines[0];
  const editedConversionId = removedLine.conversionId;
  parent = await saveSnapshot(recipe, db, parent, { lines: [] });
  assert.equal(parent.lines.length, 0);
  const reconciliation = await recipe.reconcileRemovedRecipeLineSource(
    {
      businessId,
      parentDraftId: parent.draft.id,
      line: removedLine,
    },
    db,
  );
  assert.equal(reconciliation.reconciled, "deleted");
  for (const [tableName, where, parameters] of [
    ["catalog_items", "id = ?", [edited.catalogItemId]],
    ["recipe_drafts", "id = ?", [edited.preparedDraftId]],
    ["catalog_cost_profiles", "id = ?", [edited.costProfile.id]],
    ["item_unit_conversions", "id = ?", [editedConversionId]],
  ]) {
    assert.equal(
      await countRows(db, tableName, where, parameters),
      0,
      `${tableName} must not retain the removed estimate orphan`,
    );
  }
}

async function checkAppleCiderChain(
  { grocery, recipe, recipeDomain, conversions },
  db,
) {
  const purchase = await grocery.addGroceryPurchase(
    {
      ingredientName: "Apple Cider",
      sourceName: "Acceptance fixture",
      quantity: 5,
      unit: "us_gallon",
      totalCost: 900,
      purchaseDate: "2026-08-01",
      category: "Seasoning",
      notes: "Exact US-gallon purchase evidence",
    },
    db,
  );
  const normalizedPurchaseQuantity = 5 * US_GALLON_MILLILITERS;
  closeTo(
    purchase.lot.purchasedQuantity,
    normalizedPurchaseQuantity,
    "five US gallons normalized to mL",
  );
  closeTo(purchase.lot.recordedTotalCost, 900, "purchase total");
  closeTo(
    purchase.lot.recordedCostPerUnit,
    900 / normalizedPurchaseQuantity,
    "Apple Cider cost per mL",
  );
  assert.equal(purchase.lot.enteredQuantity, 5);
  assert.equal(purchase.lot.enteredUnit, "us_gallon");
  assert.equal(purchase.lot.unit, "ml");
  assert.equal(purchase.lot.unitStandardSnapshot, "us_customary");
  const purchaseChain = JSON.parse(purchase.lot.conversionChainJson);
  assert.equal(purchaseChain.inputUnit, "us_gallon");
  assert.equal(purchaseChain.outputUnit, "ml");
  closeTo(
    purchaseChain.outputQuantityPerInputUnit,
    US_GALLON_MILLILITERS,
    "persisted US-gallon factor",
  );
  assert.deepEqual(purchaseChain.steps, [
    {
      fromQuantity: 1,
      fromUnit: "us_gallon",
      toQuantity: US_GALLON_MILLILITERS,
      toUnit: "ml",
      standard: "us_customary",
      meaning: "us_gallon converted to milliliters using us_customary",
    },
  ]);
  const movement = await db.getFirstAsync(
    `
      SELECT quantity, unit, unit_cost, total_cost, movement_type
      FROM ingredient_movements WHERE lot_id = ?
    `,
    [purchase.lot.id],
  );
  assert.equal(movement.movement_type, "purchase");
  closeTo(movement.quantity, normalizedPurchaseQuantity, "movement quantity");
  assert.equal(movement.unit, "ml");
  closeTo(movement.unit_cost, purchase.costPerUnit, "movement unit cost");
  closeTo(movement.total_cost, 900, "movement total cost");

  const appleCatalog = await db.getFirstAsync(
    `
      SELECT catalog_item_id
      FROM legacy_item_bindings
      WHERE entity_kind = 'ingredient' AND legacy_entity_id = ?
        AND deleted_at IS NULL
    `,
    [purchase.ingredient.id],
  );
  assert.ok(appleCatalog?.catalog_item_id);

  let seasoning = await recipe.startRecipeFirstDraft(
    {
      businessId,
      name: "Sushi Seasoning",
      category: "Prepared",
      mode: "prepared_batch",
      ids: {
        catalogItemId: "catalog-sushi-seasoning",
        productId: "product-sushi-seasoning",
        bindingId: "binding-sushi-seasoning",
        draftId: "draft-sushi-seasoning-v1",
      },
    },
    db,
  );
  const appleCostPerMilliliter = 900 / normalizedPurchaseQuantity;
  seasoning = await saveSnapshot(recipe, db, seasoning, {
    expectedOutputQuantity: 400,
    expectedOutputUnit: "ml",
    classificationProposal: "prepared_base",
    sellingPriceState: "not_applicable",
    editorStep: "review",
    lifecycle: "ready",
    lines: [
      {
        id: "line-seasoning-apple-cider-v1",
        sourceKind: "catalog_item",
        catalogItemId: appleCatalog.catalog_item_id,
        childRecipeVersionId: null,
        childDraftId: null,
        customName: "Apple Cider",
        quantity: 400,
        unit: "ml",
        normalizedQuantity: null,
        normalizedUnit: null,
        conversionId: null,
        conversionFactorSnapshot: null,
        conversionChainJson: null,
        unitStandardSnapshot: null,
        role: "main",
        isOptional: false,
        costOverride: appleCostPerMilliliter,
        costState: "known",
        costSource: "purchase_lot",
        costProfileId: null,
        allocationMode: "none",
        legacyIngredientLotId: purchase.lot.id,
        notes: "Exact Apple Cider lot",
      },
    ],
  });
  const seasoningV1 = await recipe.completePreparedItemRecipe(
    {
      businessId,
      draftId: seasoning.draft.id,
      expectedRevision: seasoning.draft.autosaveRevision,
      ids: {
        productId: "unused-product-seasoning-v1",
        bindingId: "unused-binding-seasoning-v1",
        recipeId: "recipe-sushi-seasoning",
        versionId: "version-sushi-seasoning-1",
        costSummaryId: "summary-sushi-seasoning-1",
        recipeCostProfileId: "profile-sushi-seasoning-1",
      },
    },
    db,
  );
  const seasoningV1Total = appleCostPerMilliliter * 400;
  assert.equal(seasoningV1.summary.status, "actual");
  closeTo(seasoningV1.summary.totalCost, seasoningV1Total, "seasoning v1 cost");
  closeTo(
    seasoningV1.summary.costPerOutputUnit,
    appleCostPerMilliliter,
    "seasoning v1 cost per mL",
  );
  assert.equal(seasoningV1.version.expectedOutputQuantity, 400);
  assert.equal(seasoningV1.version.expectedOutputUnit, "ml");
  assert.equal(seasoningV1.activeCostProfile.sourceKind, "recipe_version");
  assert.equal(
    seasoningV1.activeCostProfile.sourceRecipeVersionId,
    seasoningV1.version.id,
  );

  const cupChainResult = conversions.buildRecipeConversionChain([
    {
      fromQuantity: 1,
      fromUnit: "metric_cup",
      toQuantity: METRIC_CUP_MILLILITERS,
      toUnit: "ml",
      standard: "metric",
      meaning: "Metric cup = 250 mL",
    },
  ]);
  assert.equal(cupChainResult.ok, true);
  const cupChainJson = conversions.serializeRecipeConversionChain(
    cupChainResult.snapshot,
  );
  const seasoningCupConversion = await recipe.createRecipeFirstUnitConversion(
    {
      id: "conversion-sushi-seasoning-metric-cup",
      businessId,
      catalogItemId: seasoningV1.version.outputCatalogItemId,
      fromUnit: "metric_cup",
      toUnit: "ml",
      factor: METRIC_CUP_MILLILITERS,
    },
    db,
  );
  let sushiRice = await recipe.startRecipeFirstDraft(
    {
      businessId,
      name: "Sushi Rice",
      category: "Prepared",
      mode: "prepared_batch",
      ids: {
        catalogItemId: "catalog-sushi-rice-acceptance",
        productId: "product-sushi-rice-acceptance",
        bindingId: "binding-sushi-rice-acceptance",
        draftId: "draft-sushi-rice-acceptance",
      },
    },
    db,
  );
  const seasoningCostPerMetricCup =
    (seasoningV1.activeCostProfile.totalCost /
      seasoningV1.activeCostProfile.referenceQuantity) *
    METRIC_CUP_MILLILITERS;
  sushiRice = await saveSnapshot(recipe, db, sushiRice, {
    expectedOutputQuantity: 1000,
    expectedOutputUnit: "g",
    classificationProposal: "prepared_base",
    sellingPriceState: "not_applicable",
    editorStep: "review",
    lifecycle: "ready",
    lines: [
      {
        id: "line-sushi-rice-seasoning-v1",
        sourceKind: "child_recipe_version",
        catalogItemId: null,
        childRecipeVersionId: seasoningV1.version.id,
        childDraftId: null,
        customName: "Sushi Seasoning",
        quantity: 1,
        unit: "metric_cup",
        normalizedQuantity: METRIC_CUP_MILLILITERS,
        normalizedUnit: "ml",
        conversionId: seasoningCupConversion.id,
        conversionFactorSnapshot: METRIC_CUP_MILLILITERS,
        conversionChainJson: cupChainJson,
        unitStandardSnapshot: "metric",
        role: "supporting",
        isOptional: false,
        costOverride: seasoningCostPerMetricCup,
        costState: "known",
        costSource: "recipe_version",
        costProfileId: seasoningV1.activeCostProfile.id,
        allocationMode: "none",
        legacyIngredientLotId: null,
        notes: "One metric cup per 1,000 g output",
      },
    ],
  });
  const sushiRiceV1 = await recipe.completePreparedItemRecipe(
    {
      businessId,
      draftId: sushiRice.draft.id,
      expectedRevision: sushiRice.draft.autosaveRevision,
      ids: {
        productId: "unused-product-sushi-rice",
        bindingId: "unused-binding-sushi-rice",
        recipeId: "recipe-sushi-rice-acceptance",
        versionId: "version-sushi-rice-acceptance-1",
        costSummaryId: "summary-sushi-rice-acceptance-1",
        recipeCostProfileId: "profile-sushi-rice-acceptance-1",
      },
    },
    db,
  );
  assert.equal(sushiRiceV1.summary.status, "actual");
  closeTo(
    sushiRiceV1.summary.totalCost,
    seasoningCostPerMetricCup,
    "Sushi Rice propagated seasoning cost",
  );
  const pinnedLineBefore = JSON.stringify(
    await db.getFirstAsync(
      `
        SELECT * FROM recipe_version_lines
        WHERE recipe_version_id = ?
          AND child_recipe_version_id = ?
        ORDER BY sort_order ASC, id ASC
      `,
      [sushiRiceV1.version.id, seasoningV1.version.id],
    ),
  );
  const pinnedSummaryBefore = JSON.stringify(
    await db.getFirstAsync(
      `SELECT * FROM recipe_version_cost_summaries WHERE recipe_version_id = ?`,
      [sushiRiceV1.version.id],
    ),
  );
  const pinnedLine = JSON.parse(pinnedLineBefore);
  assert.ok(pinnedLine, "Sushi Rice must publish a pinned Seasoning line");
  assert.equal(pinnedLine.child_recipe_version_id, seasoningV1.version.id);
  assert.equal(pinnedLine.cost_profile_id, seasoningV1.activeCostProfile.id);
  assert.equal(pinnedLine.unit, "metric_cup");
  assert.equal(pinnedLine.normalized_quantity, METRIC_CUP_MILLILITERS);
  assert.equal(pinnedLine.normalized_unit, "ml");
  assert.equal(pinnedLine.unit_standard_snapshot, "metric");
  assert.deepEqual(JSON.parse(pinnedLine.conversion_chain_json), {
    ...cupChainResult.snapshot,
  });
  closeTo(
    pinnedLine.line_cost_snapshot,
    seasoningCostPerMetricCup,
    "pinned Sushi Rice line cost",
  );

  let seasoningEdit = await recipe.startRecipeFirstEdit(
    {
      businessId,
      sourceVersionId: seasoningV1.version.id,
      draftId: "draft-sushi-seasoning-v2",
    },
    db,
  );
  const changedSeasoningLine = {
    ...toSaveLine(seasoningEdit.lines[0]),
    quantity: 200,
    notes: "Later version uses less Apple Cider",
  };
  seasoningEdit = await saveSnapshot(recipe, db, seasoningEdit, {
    editorStep: "review",
    lifecycle: "ready",
    lines: [changedSeasoningLine],
  });
  const seasoningV2 = await recipe.completePreparedItemRecipe(
    {
      businessId,
      draftId: seasoningEdit.draft.id,
      expectedRevision: seasoningEdit.draft.autosaveRevision,
      expectedActiveCostProfileId: seasoningV1.activeCostProfile.id,
      ids: {
        productId: "unused-product-seasoning-v2",
        bindingId: "unused-binding-seasoning-v2",
        recipeId: "recipe-sushi-seasoning",
        versionId: "version-sushi-seasoning-2",
        costSummaryId: "summary-sushi-seasoning-2",
        recipeCostProfileId: "profile-sushi-seasoning-2",
      },
    },
    db,
  );
  assert.equal(seasoningV2.version.versionNumber, 2);
  closeTo(
    seasoningV2.summary.totalCost,
    seasoningV1Total / 2,
    "seasoning v2 changed cost",
  );
  assert.equal(
    await db.getFirstAsync(
      `SELECT active_version_id FROM recipes WHERE id = 'recipe-sushi-seasoning'`,
    ).then((row) => row.active_version_id),
    seasoningV2.version.id,
  );
  assert.equal(
    JSON.stringify(
      await db.getFirstAsync(
        `
          SELECT * FROM recipe_version_lines
          WHERE recipe_version_id = ?
            AND child_recipe_version_id = ?
          ORDER BY sort_order ASC, id ASC
        `,
        [sushiRiceV1.version.id, seasoningV1.version.id],
      ),
    ),
    pinnedLineBefore,
    "a later Seasoning version must not rewrite the pinned Sushi Rice line",
  );
  assert.equal(
    JSON.stringify(
      await db.getFirstAsync(
        `SELECT * FROM recipe_version_cost_summaries WHERE recipe_version_id = ?`,
        [sushiRiceV1.version.id],
      ),
    ),
    pinnedSummaryBefore,
    "a later Seasoning version must not rewrite the Sushi Rice cost summary",
  );
  const historicalSeasoningProfile = await db.getFirstAsync(
    `
      SELECT source_recipe_version_id, total_cost, reference_quantity,
        reference_unit, status
      FROM catalog_cost_profiles WHERE id = ?
    `,
    [seasoningV1.activeCostProfile.id],
  );
  assert.equal(
    historicalSeasoningProfile.source_recipe_version_id,
    seasoningV1.version.id,
  );
  closeTo(
    historicalSeasoningProfile.total_cost,
    seasoningV1Total,
    "retained Seasoning v1 profile cost",
  );
  assert.equal(historicalSeasoningProfile.reference_quantity, 400);
  assert.equal(historicalSeasoningProfile.reference_unit, "ml");
  assert.equal(historicalSeasoningProfile.status, "superseded");

  assert.deepEqual(recipeDomain.convertRecipeQuantity(1, "g", "ml"), {
    ok: false,
    reason: "incompatible_units",
  });
  assert.equal(conversions.standardRecipeUnitFactor("kg", "L"), null);
  assert.equal(
    await countRows(
      db,
      "item_unit_conversions",
      `
        LOWER(from_unit) IN ('g', 'kg')
        AND LOWER(to_unit) IN ('ml', 'l')
        OR LOWER(from_unit) IN ('ml', 'l')
        AND LOWER(to_unit) IN ('g', 'kg')
      `,
    ),
    0,
    "the fixture must not persist an invented mass-volume conversion",
  );
}

async function run() {
  compileAcceptanceServices();
  const modules = loadAcceptanceModules();
  const db = new SqliteCliDatabase(databasePath);
  await seedOwnerContext(modules.recipe, db);
  await checkQuickEstimateReplacement(
    modules.recipe,
    modules.conversions,
    db,
  );
  await checkAppleCiderChain(modules, db);
  assert.equal(db.runCli("PRAGMA integrity_check;"), "ok");
  assert.equal(db.runCli("PRAGMA foreign_key_check;"), "");

  console.log("quick-estimate same-line edit and conflict rollback: passed");
  console.log("quick-estimate replacement/removal orphan cleanup: passed");
  console.log("Apple Cider US-gallon Grocery evidence: passed");
  console.log("Sushi Seasoning propagated 400 mL cost: passed");
  console.log("Sushi Rice explicit cup and immutable version pin: passed");
  console.log("mass-volume conversion boundary: passed");
  console.log("APPLE CIDER RECIPE CHAIN ACCEPTANCE PASSED");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    fs.rmSync(compiledDirectory, { recursive: true, force: true });
  });
