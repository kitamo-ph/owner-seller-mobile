const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");

const workspace = process.cwd();
const compiledDirectory = path.join(
  workspace,
  "node_modules/.cache/kitamo-recipe-first-orchestration-check",
);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "kitamo-recipe-first-orchestration-"),
);
const databasePath = path.join(temporaryDirectory, "recipe-first.sqlite");
const businessId = "business-recipe-first-orchestration";
const fixedTimestamp = "2026-07-31T00:00:00.000Z";

function compileRecipeFirstService() {
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
      files: [path.join(workspace, "src/services/recipeFirst.ts")],
    }),
  );
  execFileSync(
    path.join(workspace, "node_modules/.bin/tsc"),
    ["--project", configPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function loadRecipeFirstService() {
  const originalLoad = Module._load;
  Module._load = function loadCompiledService(request, parent, isMain) {
    if (request === "@/db/client") {
      return {
        openKitamoDatabase() {
          throw new Error(
            "Recipe-first orchestration checks require an injected database.",
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
    return require(path.join(
      compiledDirectory,
      "services/recipeFirst.js",
    ));
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
    const statement = bindSql(sql, parameters);
    const output = this.runCli(
      `${statement};
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

function customCostLine(id, name, totalCost) {
  return {
    id,
    sourceKind: "custom_cost",
    catalogItemId: null,
    childRecipeVersionId: null,
    childDraftId: null,
    customName: name,
    quantity: 1,
    unit: "batch",
    normalizedQuantity: null,
    normalizedUnit: null,
    conversionId: null,
    conversionFactorSnapshot: null,
    role: "main",
    isOptional: false,
    costOverride: totalCost,
    costState: "known",
    costSource: "custom",
    costProfileId: null,
    allocationMode: "none",
    legacyIngredientLotId: null,
    notes: null,
  };
}

function unresolvedLine(id, name, quantity, unit) {
  return {
    id,
    sourceKind: "unresolved",
    catalogItemId: null,
    childRecipeVersionId: null,
    childDraftId: null,
    customName: name,
    quantity,
    unit,
    normalizedQuantity: null,
    normalizedUnit: null,
    conversionId: null,
    conversionFactorSnapshot: null,
    role: "supporting",
    isOptional: false,
    costOverride: null,
    costState: "unknown",
    costSource: "unknown",
    costProfileId: null,
    allocationMode: "none",
    legacyIngredientLotId: null,
    notes: null,
  };
}

async function saveSnapshot(service, db, snapshot, changes = {}) {
  const draft = snapshot.draft;
  const lines = valueOr(
    changes,
    "lines",
    snapshot.lines.map(toSaveLine),
  );
  return service.saveRecipeFirstDraftSnapshot(
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
      productionMode: valueOr(
        changes,
        "productionMode",
        draft.productionMode,
      ),
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

async function countRows(db, tableName, where = "1 = 1") {
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`,
  );
  return Number(row?.count ?? 0);
}

async function assertKioskExcluded(service, db, catalogItemId) {
  const item = (await service.loadRecipeLibrary(businessId, db)).find(
    (entry) => entry.catalogItemId === catalogItemId,
  );
  assert.ok(item, `Library item ${catalogItemId} is missing.`);
  assert.equal(item.kioskEnabled, false);
  assert.equal(item.sellable, false);
  assert.notEqual(item.productActive, true);
}

async function run() {
  compileRecipeFirstService();
  const service = loadRecipeFirstService();
  const db = new SqliteCliDatabase(databasePath);

  await service.loadRecipeLibrary(businessId, db);
  await db.runAsync(
    `
      INSERT INTO businesses (
        id, business_name, business_type, owner_name, barangay,
        preferred_language, currency, created_at, updated_at, sync_status,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, 'Taglish', 'PHP', ?, ?, 'local', NULL)
    `,
    [
      businessId,
      "Recipe-first Orchestration",
      "food",
      "Owner",
      "Test Barangay",
      fixedTimestamp,
      fixedTimestamp,
    ],
  );

  const finishedIds = {
    catalogItemId: "catalog-finished",
    productId: "product-finished",
    bindingId: "binding-finished",
    draftId: "draft-finished",
  };
  const finishedStart = {
    businessId,
    name: "Chicken Meal",
    category: "Meals",
    notes: "Direct Recipe Book creation",
    mode: "finished_per_unit",
    ids: finishedIds,
  };
  let finished = await service.startRecipeFirstDraft(finishedStart, db);
  assert.equal(finished.draft.expectedOutputQuantity, 1);
  assert.equal(finished.draft.expectedOutputUnit, "pcs");
  assert.equal(finished.output.classification, "finished_product");
  assert.equal(finished.output.productActive, false);
  await assert.rejects(
    service.startRecipeFirstDraft(finishedStart, db),
    /UNIQUE constraint failed/,
  );
  assert.equal(
    await countRows(db, "catalog_items", "id = 'catalog-finished'"),
    1,
  );
  assert.equal(
    await countRows(db, "products", "id = 'product-finished'"),
    1,
  );
  assert.equal(
    await countRows(db, "legacy_item_bindings", "id = 'binding-finished'"),
    1,
  );
  assert.equal(
    await countRows(db, "recipe_drafts", "id = 'draft-finished'"),
    1,
  );

  finished = await saveSnapshot(service, db, finished, {
    expectedOutputQuantity: 1,
    expectedOutputUnit: "pcs",
    suggestedSellingPrice: 25,
    sellingPriceState: "known",
    classificationProposal: "finished_product",
    editorStep: "review",
    lifecycle: "ready",
    lines: [customCostLine("line-finished-cost", "Batch cost", 10)],
  });
  const finishedPublicationInput = {
    businessId,
    draftId: finished.draft.id,
    expectedRevision: finished.draft.autosaveRevision,
    requireCompleteCost: true,
    ids: {
      productId: "unused-product-finished",
      bindingId: "unused-binding-finished",
      recipeId: "recipe-finished",
      versionId: "version-finished-1",
      costSummaryId: "summary-finished-1",
      recipeCostProfileId: "profile-finished-1",
    },
  };
  const finishedPublication = await service.publishRecipeFirstDraft(
    finishedPublicationInput,
    db,
  );
  assert.equal(finishedPublication.repeated, false);
  assert.equal(finishedPublication.version.expectedOutputQuantity, 1);
  assert.equal(finishedPublication.version.expectedOutputUnit, "pcs");
  assert.equal(finishedPublication.summary.status, "estimated");
  closeTo(finishedPublication.summary.totalCost, 10, "finished total cost");
  closeTo(
    finishedPublication.summary.costPerOutputUnit,
    10,
    "finished per-piece cost",
  );
  assert.equal(await countRows(db, "products"), 1);
  assert.equal(
    await countRows(
      db,
      "recipe_versions",
      "output_catalog_item_id = 'catalog-finished'",
    ),
    1,
  );
  const repeatedFinished = await service.publishRecipeFirstDraft(
    finishedPublicationInput,
    db,
  );
  assert.equal(repeatedFinished.repeated, true);
  assert.equal(repeatedFinished.version.id, finishedPublication.version.id);
  assert.equal(
    await countRows(
      db,
      "recipe_versions",
      "output_catalog_item_id = 'catalog-finished'",
    ),
    1,
  );
  await assertKioskExcluded(service, db, finishedIds.catalogItemId);

  let estimateParent = await service.startRecipeFirstDraft(
    {
      businessId,
      name: "Sushi Bowl",
      category: "Meals",
      mode: "finished_per_unit",
      ids: {
        catalogItemId: "catalog-estimate-parent",
        productId: "product-estimate-parent",
        bindingId: "binding-estimate-parent",
        draftId: "draft-estimate-parent",
      },
    },
    db,
  );
  const estimateInput = {
    requestToken: "estimate-sushi-rice-v1",
    businessId,
    parentDraftId: estimateParent.draft.id,
    parentExpectedRevision: estimateParent.draft.autosaveRevision,
    parentLineId: "line-estimated-rice",
    preparedDraftId: "draft-sushi-rice",
    catalogItemId: "catalog-sushi-rice",
    costProfileId: "profile-sushi-rice-estimate",
    name: "Sushi Rice",
    totalCost: 80,
    referenceQuantity: 1,
    referenceUnit: "kg",
    usageQuantity: 27,
    usageUnit: "g",
    role: "main",
    notes: "Owner estimate before prepared Recipe completion",
  };
  const estimate = await service.addQuickEstimatedPreparedInput(
    estimateInput,
    db,
  );
  assert.equal(estimate.repeated, false);
  assert.equal(estimate.parentRevision, 1);
  const repeatedEstimate =
    await service.addQuickEstimatedPreparedInput(estimateInput, db);
  assert.equal(repeatedEstimate.repeated, true);
  assert.equal(repeatedEstimate.parentRevision, 1);
  estimateParent = await service.loadRecipeFirstDraft(
    estimateParent.draft.id,
    db,
  );
  assert.equal(estimateParent.lines.length, 1);
  closeTo(
    estimateParent.lines[0].costOverride,
    0.08,
    "estimated cost per gram",
  );
  assert.equal(estimateParent.lines[0].costSource, "owner_estimate");

  const estimateParentPublication =
    await service.publishRecipeFirstDraft(
      {
        businessId,
        draftId: estimateParent.draft.id,
        expectedRevision: estimateParent.draft.autosaveRevision,
        requireCompleteCost: true,
        ids: {
          productId: "unused-product-estimate-parent",
          bindingId: "unused-binding-estimate-parent",
          recipeId: "recipe-estimate-parent",
          versionId: "version-estimate-parent-1",
          costSummaryId: "summary-estimate-parent-1",
          recipeCostProfileId: "profile-estimate-parent-1",
        },
      },
      db,
    );
  closeTo(
    estimateParentPublication.summary.totalCost,
    2.16,
    "historical estimated parent cost",
  );
  const historicalEstimateLine = await db.getFirstAsync(
    `
      SELECT source_kind, catalog_item_id, child_recipe_version_id,
        cost_per_unit_snapshot, line_cost_snapshot, cost_source,
        cost_profile_id
      FROM recipe_version_lines
      WHERE recipe_version_id = ?
    `,
    [estimateParentPublication.version.id],
  );
  assert.equal(historicalEstimateLine.source_kind, "catalog_item");
  assert.equal(historicalEstimateLine.catalog_item_id, estimate.catalogItemId);
  assert.equal(historicalEstimateLine.child_recipe_version_id, null);
  assert.equal(historicalEstimateLine.cost_source, "owner_estimate");
  assert.equal(
    historicalEstimateLine.cost_profile_id,
    estimate.costProfile.id,
  );
  closeTo(
    historicalEstimateLine.cost_per_unit_snapshot,
    0.08,
    "historical estimate unit snapshot",
  );
  closeTo(
    historicalEstimateLine.line_cost_snapshot,
    2.16,
    "historical estimate line snapshot",
  );

  const futureParent = await service.startRecipeFirstEdit(
    {
      businessId,
      sourceVersionId: estimateParentPublication.version.id,
      draftId: "draft-estimate-parent-next",
    },
    db,
  );
  assert.equal(futureParent.lines[0].costSource, "owner_estimate");
  assert.equal(futureParent.lines[0].catalogItemId, estimate.catalogItemId);

  let prepared = await service.loadRecipeFirstDraft(
    estimate.preparedDraftId,
    db,
  );
  prepared = await saveSnapshot(service, db, prepared, {
    expectedOutputQuantity: null,
    expectedOutputUnit: null,
    classificationProposal: "prepared_base",
    sellingPriceState: "not_applicable",
    editorStep: "review",
    lifecycle: "editing",
    lines: [customCostLine("line-rice-cost", "Rice batch cost", 50)],
  });
  assert.equal(prepared.draft.expectedOutputQuantity, null);
  assert.equal(prepared.draft.lifecycle, "editing");
  await assert.rejects(
    service.completePreparedItemRecipe(
      {
        businessId,
        draftId: prepared.draft.id,
        expectedRevision: prepared.draft.autosaveRevision,
        expectedActiveCostProfileId: estimate.costProfile.id,
        ids: {
          productId: "product-sushi-rice",
          bindingId: "binding-sushi-rice",
          recipeId: "recipe-sushi-rice",
          versionId: "version-sushi-rice-1",
          costSummaryId: "summary-sushi-rice-1",
          recipeCostProfileId: "profile-sushi-rice-recipe-1",
        },
      },
      db,
    ),
    /Expected output must be a positive quantity/,
  );
  const afterRejectedCompletion = await service.loadRecipeFirstDraft(
    prepared.draft.id,
    db,
  );
  assert.equal(afterRejectedCompletion.draft.lifecycle, "editing");
  assert.equal(
    await countRows(
      db,
      "recipe_versions",
      "output_catalog_item_id = 'catalog-sushi-rice'",
    ),
    0,
  );
  prepared = await saveSnapshot(service, db, afterRejectedCompletion, {
    expectedOutputQuantity: 1000,
    expectedOutputUnit: "g",
    classificationProposal: "prepared_base",
    sellingPriceState: "not_applicable",
    editorStep: "review",
    lifecycle: "ready",
    lines: afterRejectedCompletion.lines.map(toSaveLine),
  });
  const preparedCompletion =
    await service.completePreparedItemRecipe(
      {
        businessId,
        draftId: prepared.draft.id,
        expectedRevision: prepared.draft.autosaveRevision,
        expectedActiveCostProfileId: estimate.costProfile.id,
        ids: {
          productId: "product-sushi-rice",
          bindingId: "binding-sushi-rice",
          recipeId: "recipe-sushi-rice",
          versionId: "version-sushi-rice-1",
          costSummaryId: "summary-sushi-rice-1",
          recipeCostProfileId: "profile-sushi-rice-recipe-1",
        },
      },
      db,
    );
  closeTo(preparedCompletion.summary.totalCost, 50, "prepared batch cost");
  closeTo(
    preparedCompletion.summary.costPerOutputUnit,
    0.05,
    "prepared cost per gram",
  );
  assert.equal(
    preparedCompletion.activeCostProfile.supersedesProfileId,
    estimate.costProfile.id,
  );
  assert.equal(
    preparedCompletion.activeCostProfile.sourceKind,
    "recipe_version",
  );
  assert.equal(
    await countRows(
      db,
      "catalog_items",
      "id = 'catalog-sushi-rice'",
    ),
    1,
  );
  const futureAfterCompletion = await service.loadRecipeFirstDraft(
    futureParent.draft.id,
    db,
  );
  assert.equal(futureAfterCompletion.lines[0].sourceKind, "child_recipe_version");
  assert.equal(futureAfterCompletion.lines[0].catalogItemId, null);
  assert.equal(
    futureAfterCompletion.lines[0].childRecipeVersionId,
    preparedCompletion.version.id,
  );
  assert.equal(
    futureAfterCompletion.lines[0].costProfileId,
    preparedCompletion.activeCostProfile.id,
  );
  closeTo(
    futureAfterCompletion.lines[0].costOverride,
    0.05,
    "future consumer cost per gram",
  );
  const historicalAfterCompletion = await db.getFirstAsync(
    `
      SELECT source_kind, catalog_item_id, child_recipe_version_id,
        cost_per_unit_snapshot, line_cost_snapshot, cost_source,
        cost_profile_id
      FROM recipe_version_lines
      WHERE recipe_version_id = ?
    `,
    [estimateParentPublication.version.id],
  );
  assert.deepEqual(historicalAfterCompletion, historicalEstimateLine);
  const historicalSummary = await db.getFirstAsync(
    `
      SELECT total_cost, cost_per_output_unit
      FROM recipe_version_cost_summaries
      WHERE recipe_version_id = ?
    `,
    [estimateParentPublication.version.id],
  );
  closeTo(historicalSummary.total_cost, 2.16, "preserved historical total");
  closeTo(
    historicalSummary.cost_per_output_unit,
    2.16,
    "preserved historical per-piece cost",
  );
  await assertKioskExcluded(service, db, estimate.catalogItemId);

  let convertedEstimateParent = await service.startRecipeFirstDraft(
    {
      businessId,
      name: "Party Sushi Tray",
      category: "Meals",
      mode: "finished_per_unit",
      ids: {
        catalogItemId: "catalog-converted-estimate-parent",
        productId: "product-converted-estimate-parent",
        bindingId: "binding-converted-estimate-parent",
        draftId: "draft-converted-estimate-parent",
      },
    },
    db,
  );
  const convertedEstimate =
    await service.addQuickEstimatedPreparedInput(
      {
        requestToken: "estimate-converted-rice-v1",
        businessId,
        parentDraftId: convertedEstimateParent.draft.id,
        parentExpectedRevision:
          convertedEstimateParent.draft.autosaveRevision,
        parentLineId: "line-converted-estimated-rice",
        preparedDraftId: "draft-converted-rice",
        catalogItemId: "catalog-converted-rice",
        costProfileId: "profile-converted-rice-estimate",
        name: "Converted Sushi Rice",
        totalCost: 80,
        referenceQuantity: 1,
        referenceUnit: "kg",
        usageQuantity: 2,
        usageUnit: "kg",
        role: "main",
      },
      db,
    );
  const packToKilogram =
    await service.createRecipeFirstUnitConversion(
      {
        id: "conversion-converted-rice-pack-kg",
        businessId,
        catalogItemId: convertedEstimate.catalogItemId,
        fromUnit: "pack",
        toUnit: "kg",
        factor: 0.5,
      },
      db,
    );
  convertedEstimateParent = await service.loadRecipeFirstDraft(
    convertedEstimateParent.draft.id,
    db,
  );
  const convertedEstimateLine = {
    ...toSaveLine(convertedEstimateParent.lines[0]),
    quantity: 2,
    unit: "pack",
    normalizedQuantity: 1,
    normalizedUnit: "kg",
    conversionId: packToKilogram.id,
    conversionFactorSnapshot: packToKilogram.factor,
    costOverride: 40,
  };
  convertedEstimateParent = await saveSnapshot(
    service,
    db,
    convertedEstimateParent,
    {
      editorStep: "review",
      lifecycle: "ready",
      lines: [convertedEstimateLine],
    },
  );
  const convertedParentPublication =
    await service.publishRecipeFirstDraft(
      {
        businessId,
        draftId: convertedEstimateParent.draft.id,
        expectedRevision:
          convertedEstimateParent.draft.autosaveRevision,
        requireCompleteCost: true,
        ids: {
          productId: "unused-product-converted-parent",
          bindingId: "unused-binding-converted-parent",
          recipeId: "recipe-converted-parent",
          versionId: "version-converted-parent-1",
          costSummaryId: "summary-converted-parent-1",
          recipeCostProfileId: "profile-converted-parent-1",
        },
      },
      db,
    );
  closeTo(
    convertedParentPublication.summary.totalCost,
    80,
    "historical converted estimate total",
  );
  const historicalConvertedLine = await db.getFirstAsync(
    `
      SELECT source_kind, catalog_item_id, child_recipe_version_id,
        quantity, unit, normalized_quantity, normalized_unit, conversion_id,
        conversion_factor_snapshot, cost_per_unit_snapshot,
        line_cost_snapshot, cost_source, cost_profile_id
      FROM recipe_version_lines
      WHERE recipe_version_id = ?
    `,
    [convertedParentPublication.version.id],
  );
  assert.equal(historicalConvertedLine.source_kind, "catalog_item");
  assert.equal(
    historicalConvertedLine.catalog_item_id,
    convertedEstimate.catalogItemId,
  );
  assert.equal(historicalConvertedLine.quantity, 2);
  assert.equal(historicalConvertedLine.unit, "pack");
  assert.equal(historicalConvertedLine.normalized_quantity, 1);
  assert.equal(historicalConvertedLine.normalized_unit, "kg");
  assert.equal(
    historicalConvertedLine.conversion_id,
    packToKilogram.id,
  );
  closeTo(
    historicalConvertedLine.conversion_factor_snapshot,
    0.5,
    "historical pack conversion",
  );
  closeTo(
    historicalConvertedLine.cost_per_unit_snapshot,
    40,
    "historical estimated cost per pack",
  );
  closeTo(
    historicalConvertedLine.line_cost_snapshot,
    80,
    "historical converted estimate line cost",
  );
  assert.equal(historicalConvertedLine.cost_source, "owner_estimate");
  assert.equal(
    historicalConvertedLine.cost_profile_id,
    convertedEstimate.costProfile.id,
  );

  let convertedPrepared = await service.loadRecipeFirstDraft(
    convertedEstimate.preparedDraftId,
    db,
  );
  convertedPrepared = await saveSnapshot(
    service,
    db,
    convertedPrepared,
    {
      expectedOutputQuantity: 1,
      expectedOutputUnit: "kg",
      classificationProposal: "prepared_base",
      sellingPriceState: "not_applicable",
      editorStep: "review",
      lifecycle: "ready",
      lines: [
        customCostLine(
          "line-converted-rice-cost",
          "Converted rice batch cost",
          60,
        ),
      ],
    },
  );
  const convertedPreparedCompletion =
    await service.completePreparedItemRecipe(
      {
        businessId,
        draftId: convertedPrepared.draft.id,
        expectedRevision: convertedPrepared.draft.autosaveRevision,
        expectedActiveCostProfileId: convertedEstimate.costProfile.id,
        ids: {
          productId: "product-converted-rice",
          bindingId: "binding-converted-rice",
          recipeId: "recipe-converted-rice",
          versionId: "version-converted-rice-1",
          costSummaryId: "summary-converted-rice-1",
          recipeCostProfileId: "profile-converted-rice-recipe-1",
        },
      },
      db,
    );
  assert.equal(
    convertedPreparedCompletion.activeCostProfile.sourceKind,
    "recipe_version",
  );
  assert.equal(
    convertedPreparedCompletion.activeCostProfile.supersedesProfileId,
    convertedEstimate.costProfile.id,
  );
  closeTo(
    convertedPreparedCompletion.activeCostProfile.totalCost,
    60,
    "active converted prepared cost",
  );
  assert.equal(
    convertedPreparedCompletion.activeCostProfile.referenceUnit,
    "kg",
  );

  let refreshedConvertedParent = await service.startRecipeFirstEdit(
    {
      businessId,
      sourceVersionId: convertedParentPublication.version.id,
      draftId: "draft-converted-parent-next",
    },
    db,
  );
  assert.equal(refreshedConvertedParent.lines.length, 1);
  const refreshedConvertedLine = refreshedConvertedParent.lines[0];
  assert.equal(
    refreshedConvertedLine.sourceKind,
    "child_recipe_version",
  );
  assert.equal(refreshedConvertedLine.catalogItemId, null);
  assert.equal(
    refreshedConvertedLine.childRecipeVersionId,
    convertedPreparedCompletion.version.id,
  );
  assert.equal(
    refreshedConvertedLine.costProfileId,
    convertedPreparedCompletion.activeCostProfile.id,
  );
  assert.equal(refreshedConvertedLine.costSource, "recipe_version");
  assert.equal(refreshedConvertedLine.quantity, 2);
  assert.equal(refreshedConvertedLine.unit, "pack");
  assert.equal(refreshedConvertedLine.normalizedQuantity, 1);
  assert.equal(refreshedConvertedLine.normalizedUnit, "kg");
  assert.equal(refreshedConvertedLine.conversionId, packToKilogram.id);
  closeTo(
    refreshedConvertedLine.conversionFactorSnapshot,
    0.5,
    "refreshed pack conversion",
  );
  closeTo(
    refreshedConvertedLine.costOverride,
    30,
    "refreshed recipe-derived cost per pack",
  );
  refreshedConvertedParent = await saveSnapshot(
    service,
    db,
    refreshedConvertedParent,
    {
      editorStep: "review",
      lifecycle: "ready",
      lines: refreshedConvertedParent.lines.map(toSaveLine),
    },
  );
  const refreshedConvertedPublication =
    await service.publishRecipeFirstDraft(
      {
        businessId,
        draftId: refreshedConvertedParent.draft.id,
        expectedRevision:
          refreshedConvertedParent.draft.autosaveRevision,
        requireCompleteCost: true,
        ids: {
          productId: "unused-product-converted-parent-next",
          bindingId: "unused-binding-converted-parent-next",
          recipeId: "recipe-converted-parent",
          versionId: "version-converted-parent-2",
          costSummaryId: "summary-converted-parent-2",
          recipeCostProfileId: "profile-converted-parent-2",
        },
      },
      db,
    );
  closeTo(
    refreshedConvertedPublication.summary.totalCost,
    60,
    "refreshed converted parent total",
  );
  const publishedRefreshedConvertedLine = await db.getFirstAsync(
    `
      SELECT source_kind, child_recipe_version_id, quantity, unit,
        normalized_quantity, normalized_unit, conversion_id,
        conversion_factor_snapshot, cost_per_unit_snapshot,
        line_cost_snapshot, cost_source, cost_profile_id
      FROM recipe_version_lines
      WHERE recipe_version_id = ?
    `,
    [refreshedConvertedPublication.version.id],
  );
  assert.equal(
    publishedRefreshedConvertedLine.source_kind,
    "child_recipe_version",
  );
  assert.equal(
    publishedRefreshedConvertedLine.child_recipe_version_id,
    convertedPreparedCompletion.version.id,
  );
  assert.equal(publishedRefreshedConvertedLine.quantity, 2);
  assert.equal(publishedRefreshedConvertedLine.unit, "pack");
  assert.equal(publishedRefreshedConvertedLine.normalized_quantity, 1);
  assert.equal(publishedRefreshedConvertedLine.normalized_unit, "kg");
  assert.equal(
    publishedRefreshedConvertedLine.conversion_id,
    packToKilogram.id,
  );
  closeTo(
    publishedRefreshedConvertedLine.conversion_factor_snapshot,
    0.5,
    "published refreshed pack conversion",
  );
  assert.equal(
    publishedRefreshedConvertedLine.cost_per_unit_snapshot,
    null,
  );
  closeTo(
    publishedRefreshedConvertedLine.line_cost_snapshot,
    60,
    "published refreshed converted line cost",
  );
  assert.equal(
    publishedRefreshedConvertedLine.cost_source,
    "recipe_version",
  );
  assert.equal(
    publishedRefreshedConvertedLine.cost_profile_id,
    convertedPreparedCompletion.activeCostProfile.id,
  );
  const historicalConvertedAfterRefresh = await db.getFirstAsync(
    `
      SELECT source_kind, catalog_item_id, child_recipe_version_id,
        quantity, unit, normalized_quantity, normalized_unit, conversion_id,
        conversion_factor_snapshot, cost_per_unit_snapshot,
        line_cost_snapshot, cost_source, cost_profile_id
      FROM recipe_version_lines
      WHERE recipe_version_id = ?
    `,
    [convertedParentPublication.version.id],
  );
  assert.deepEqual(
    historicalConvertedAfterRefresh,
    historicalConvertedLine,
  );

  let nestedParent = await service.startRecipeFirstDraft(
    {
      businessId,
      name: "House Sauce",
      category: "Prepared",
      notes: "Persist across restart",
      mode: "prepared_batch",
      ids: {
        catalogItemId: "catalog-nested-parent",
        productId: "product-nested-parent",
        bindingId: "binding-nested-parent",
        draftId: "draft-nested-parent",
      },
    },
    db,
  );
  nestedParent = await saveSnapshot(service, db, nestedParent, {
    expectedOutputQuantity: null,
    expectedOutputUnit: null,
    classificationProposal: "prepared_base",
    editorStep: "inputs",
    lifecycle: "editing",
    lines: [
      unresolvedLine(
        "line-nested-placeholder",
        "Prepared seasoning",
        100,
        "g",
      ),
    ],
  });
  const nestedChild = await service.beginNestedPreparedRecipeDraft(
    {
      businessId,
      parentDraftId: nestedParent.draft.id,
      parentLineId: "line-nested-placeholder",
      parentExpectedRevision: nestedParent.draft.autosaveRevision,
      returnRoute: "/owner/recipe-editor?draftId=draft-nested-parent",
      name: "Prepared Seasoning",
      category: "Prepared",
      notes: "Nested draft survives process restart",
      ids: {
        catalogItemId: "catalog-nested-child",
        productId: "product-nested-child",
        bindingId: "binding-nested-child",
        draftId: "draft-nested-child",
      },
    },
    db,
  );
  assert.equal(nestedChild.draft.parentDraftId, nestedParent.draft.id);
  assert.equal(nestedChild.draft.parentLineId, "line-nested-placeholder");
  const restartedDb = new SqliteCliDatabase(databasePath);
  const restartedParent = await service.loadRecipeFirstDraft(
    nestedParent.draft.id,
    restartedDb,
  );
  const restartedChild = await service.loadRecipeFirstDraft(
    nestedChild.draft.id,
    restartedDb,
  );
  assert.equal(restartedParent.draft.name, "House Sauce");
  assert.equal(restartedParent.draft.notes, "Persist across restart");
  assert.equal(restartedParent.lines.length, 1);
  assert.equal(restartedParent.lines[0].sourceKind, "child_draft");
  assert.equal(restartedParent.lines[0].childDraftId, nestedChild.draft.id);
  assert.equal(
    restartedChild.draft.returnRoute,
    "/owner/recipe-editor?draftId=draft-nested-parent",
  );
  assert.equal(
    restartedChild.draft.notes,
    "Nested draft survives process restart",
  );
  await assertKioskExcluded(
    service,
    restartedDb,
    restartedParent.output.catalogItemId,
  );
  await assertKioskExcluded(
    service,
    restartedDb,
    restartedChild.output.catalogItemId,
  );

  const readyNestedChild = await saveSnapshot(
    service,
    restartedDb,
    restartedChild,
    {
      expectedOutputQuantity: 1000,
      expectedOutputUnit: "g",
      classificationProposal: "prepared_base",
      sellingPriceState: "not_applicable",
      editorStep: "review",
      lifecycle: "ready",
      lines: [
        customCostLine(
          "line-nested-child-cost",
          "Prepared seasoning cost",
          50,
        ),
      ],
    },
  );
  const nestedCompletion = await service.completePreparedItemRecipe(
    {
      businessId,
      draftId: readyNestedChild.draft.id,
      expectedRevision: readyNestedChild.draft.autosaveRevision,
      ids: {
        productId: "unused-product-nested-child",
        bindingId: "unused-binding-nested-child",
        recipeId: "recipe-nested-child",
        versionId: "version-nested-child-1",
        costSummaryId: "summary-nested-child-1",
        recipeCostProfileId: "profile-nested-child-1",
      },
    },
    restartedDb,
  );
  const resolvedParent = await service.loadRecipeFirstDraft(
    nestedParent.draft.id,
    restartedDb,
  );
  assert.equal(resolvedParent.draft.lifecycle, "editing");
  assert.equal(resolvedParent.lines[0].sourceKind, "child_recipe_version");
  assert.equal(resolvedParent.lines[0].childDraftId, null);
  assert.equal(
    resolvedParent.lines[0].childRecipeVersionId,
    nestedCompletion.version.id,
  );
  assert.equal(
    resolvedParent.lines[0].costProfileId,
    nestedCompletion.activeCostProfile.id,
  );
  closeTo(
    resolvedParent.lines[0].costOverride,
    0.05,
    "resolved nested cost per gram",
  );

  const duplicate = await service.duplicateRecipeFirstItem(
    {
      businessId,
      sourceVersionId: finishedPublication.version.id,
      name: "Chicken Meal copy",
      ids: {
        catalogItemId: "catalog-finished-copy",
        productId: "product-finished-copy",
        bindingId: "binding-finished-copy",
        draftId: "draft-finished-copy",
      },
    },
    restartedDb,
  );
  assert.equal(duplicate.draft.sourceVersionId, finishedPublication.version.id);
  assert.equal(duplicate.lines.length, 1);
  assert.equal(
    await countRows(
      restartedDb,
      "recipe_versions",
      "output_catalog_item_id = 'catalog-finished'",
    ),
    1,
  );
  const duplicatePublication = await service.publishRecipeFirstDraft(
    {
      businessId,
      draftId: duplicate.draft.id,
      expectedRevision: duplicate.draft.autosaveRevision,
      requireCompleteCost: true,
      ids: {
        productId: "unused-product-finished-copy",
        bindingId: "unused-binding-finished-copy",
        recipeId: "recipe-finished-copy",
        versionId: "version-finished-copy-1",
        costSummaryId: "summary-finished-copy-1",
        recipeCostProfileId: "profile-finished-copy-1",
      },
    },
    restartedDb,
  );
  const duplicateProvenance = await restartedDb.getFirstAsync(
    `
      SELECT duplicated_from_version_id
      FROM recipe_versions
      WHERE id = ?
    `,
    [duplicatePublication.version.id],
  );
  assert.equal(
    duplicateProvenance.duplicated_from_version_id,
    finishedPublication.version.id,
  );

  const unused = await service.startRecipeFirstDraft(
    {
      businessId,
      name: "Unused draft",
      mode: "finished_per_unit",
      ids: {
        catalogItemId: "catalog-unused",
        productId: "product-unused",
        bindingId: "binding-unused",
        draftId: "draft-unused",
      },
    },
    restartedDb,
  );
  const deleted = await service.deleteRecipeFirstItem(
    {
      businessId,
      catalogItemId: unused.output.catalogItemId,
      ownerAuthorized: true,
    },
    restartedDb,
  );
  assert.equal(deleted.deleted, true);
  assert.equal(
    await countRows(
      restartedDb,
      "catalog_items",
      "id = 'catalog-unused'",
    ),
    0,
  );
  assert.equal(
    await countRows(restartedDb, "products", "id = 'product-unused'"),
    0,
  );
  await assert.rejects(
    service.deleteRecipeFirstItem(
      {
        businessId,
        catalogItemId: finishedIds.catalogItemId,
        ownerAuthorized: true,
      },
      restartedDb,
    ),
    /Only an unused native draft item can be permanently deleted/,
  );
  await service.archiveRecipeFirstItem(
    {
      businessId,
      catalogItemId: finishedIds.catalogItemId,
      ownerAuthorized: true,
    },
    restartedDb,
  );
  await service.archiveRecipeFirstItem(
    {
      businessId,
      catalogItemId: finishedIds.catalogItemId,
      ownerAuthorized: true,
    },
    restartedDb,
  );
  const archived = await restartedDb.getFirstAsync(
    `
      SELECT item.lifecycle_status, item.sellable, item.kiosk_enabled,
        product.active
      FROM catalog_items item
      INNER JOIN legacy_item_bindings binding
        ON binding.catalog_item_id = item.id
        AND binding.entity_kind = 'product'
      INNER JOIN products product
        ON product.id = binding.legacy_entity_id
      WHERE item.id = ?
    `,
    [finishedIds.catalogItemId],
  );
  assert.equal(archived.lifecycle_status, "archived");
  assert.equal(archived.sellable, 0);
  assert.equal(archived.kiosk_enabled, 0);
  assert.equal(archived.active, 0);
  assert.equal(
    await countRows(
      restartedDb,
      "recipe_versions",
      "output_catalog_item_id = 'catalog-finished'",
    ),
    1,
  );

  console.log(
    "Recipe-first service orchestration checks passed: direct per-piece publication and replay, draft-before-yield guard, estimate promotion with immutable history, restart-safe nesting, duplicate provenance, Kiosk exclusion, and safe lifecycle.",
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });
