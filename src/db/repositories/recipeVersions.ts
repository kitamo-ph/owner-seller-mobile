import {
  makeRecipeRoleId,
  makeRecipeVersionId,
  makeRecipeVersionLineId,
} from "@/domain/ids";
import type { CostState } from "@/domain/costState";

import {
  getRepositoryDatabase,
  nowIso,
  toBoolean,
  toInteger,
  type RepositoryDatabase,
} from "./shared";

export type RecipeVersionStatus = "published" | "superseded" | "archived";
export type RecipeVersionCostState =
  | "known"
  | "unknown"
  | "legacy_zero_unresolved"
  | "not_applicable"
  | "partial"
  | "legacy_review";
export type RecipeVersionGraphState =
  | "complete"
  | "incomplete"
  | "legacy_review";
export type RecipeVersionSource =
  | "legacy_import"
  | "native_publish"
  | "duplicate";
export type RecipeVersionLineSource =
  | "catalog_item"
  | "child_recipe_version"
  | "custom_cost";
export type RecipeLineRole =
  | "main"
  | "supporting"
  | "seasoning"
  | "garnish"
  | "packaging"
  | "optional"
  | "unset";
export type RecipeAllocationMode =
  | "none"
  | "legacy_selected"
  | "manual"
  | "recommended_fefo"
  | "recommended_fifo"
  | "legacy_balance";

export type RecipeVersionRecord = {
  id: string;
  businessId: string;
  recipeId: string;
  versionNumber: number;
  status: RecipeVersionStatus;
  name: string;
  category: string | null;
  outputCatalogItemId: string;
  outputProductIdSnapshot: string | null;
  expectedOutputQuantity: number;
  expectedOutputUnit: string;
  productionMode: "prepared_before_selling" | "cook_upon_order";
  suggestedSellingPriceSnapshot: number | null;
  sellingPriceState: CostState;
  notes: string | null;
  sourceKind: RecipeVersionSource;
  sourceDraftId: string | null;
  duplicatedFromVersionId: string | null;
  graphState: RecipeVersionGraphState;
  costState: RecipeVersionCostState;
  effectiveAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RecipeVersionLineRecord = {
  id: string;
  businessId: string;
  recipeVersionId: string;
  sortOrder: number;
  sourceKind: RecipeVersionLineSource;
  catalogItemId: string | null;
  childRecipeVersionId: string | null;
  customName: string | null;
  quantity: number;
  unit: string;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
  conversionId: string | null;
  conversionFactorSnapshot: number | null;
  role: RecipeLineRole;
  isOptional: boolean;
  costOverride: number | null;
  costPerUnitSnapshot: number | null;
  lineCostSnapshot: number | null;
  costState: RecipeVersionCostState;
  allocationMode: RecipeAllocationMode;
  legacyIngredientIdSnapshot: string | null;
  legacyIngredientLotId: string | null;
  sourceLabelSnapshot: string | null;
  originalLegacyLineId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type RecipeVersionRow = {
  id: string;
  business_id: string;
  recipe_id: string;
  version_number: number;
  status: RecipeVersionStatus;
  name_snapshot: string;
  category_snapshot: string | null;
  output_catalog_item_id: string;
  output_product_id_snapshot: string | null;
  expected_output_quantity: number;
  expected_output_unit: string;
  production_mode: RecipeVersionRecord["productionMode"];
  suggested_selling_price_snapshot: number | null;
  selling_price_state: CostState;
  notes_snapshot: string | null;
  source_kind: RecipeVersionSource;
  source_draft_id: string | null;
  duplicated_from_version_id: string | null;
  graph_state: RecipeVersionGraphState;
  cost_state: RecipeVersionCostState;
  effective_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RecipeVersionLineRow = {
  id: string;
  business_id: string;
  recipe_version_id: string;
  sort_order: number;
  source_kind: RecipeVersionLineSource;
  catalog_item_id: string | null;
  child_recipe_version_id: string | null;
  custom_name_snapshot: string | null;
  quantity: number;
  unit: string;
  normalized_quantity: number | null;
  normalized_unit: string | null;
  conversion_id: string | null;
  conversion_factor_snapshot: number | null;
  role: RecipeLineRole;
  is_optional: number;
  cost_override: number | null;
  cost_per_unit_snapshot: number | null;
  line_cost_snapshot: number | null;
  cost_state: RecipeVersionCostState;
  allocation_mode: RecipeAllocationMode;
  legacy_ingredient_id_snapshot: string | null;
  legacy_ingredient_lot_id: string | null;
  source_label_snapshot: string | null;
  original_legacy_line_id: string | null;
  notes_snapshot: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type PublishRecipeVersionLineInput = {
  id?: string;
  sourceKind: RecipeVersionLineSource;
  catalogItemId?: string | null;
  childRecipeVersionId?: string | null;
  customName?: string | null;
  quantity: number;
  unit: string;
  normalizedQuantity?: number | null;
  normalizedUnit?: string | null;
  conversionId?: string | null;
  conversionFactorSnapshot?: number | null;
  role?: RecipeLineRole;
  isOptional?: boolean;
  costOverride?: number | null;
  costPerUnitSnapshot?: number | null;
  lineCostSnapshot?: number | null;
  costState: RecipeVersionCostState;
  allocationMode?: RecipeAllocationMode;
  sourceLabelSnapshot?: string | null;
  notes?: string | null;
};

export type PublishRecipeVersionInput = {
  id?: string;
  businessId: string;
  recipeId: string;
  outputCatalogItemId: string;
  outputProductIdSnapshot?: string | null;
  name: string;
  category?: string | null;
  expectedOutputQuantity: number;
  expectedOutputUnit: string;
  productionMode: RecipeVersionRecord["productionMode"];
  suggestedSellingPriceSnapshot?: number | null;
  sellingPriceState: CostState;
  notes?: string | null;
  sourceKind?: Exclude<RecipeVersionSource, "legacy_import">;
  sourceDraftId?: string | null;
  duplicatedFromVersionId?: string | null;
  graphState: RecipeVersionGraphState;
  costState: RecipeVersionCostState;
  expectedDraftRevision?: number;
  role?: "primary" | "alternate" | "kiosk_cook_upon_order";
  lines: PublishRecipeVersionLineInput[];
};

function mapVersion(row: RecipeVersionRow): RecipeVersionRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    recipeId: row.recipe_id,
    versionNumber: row.version_number,
    status: row.status,
    name: row.name_snapshot,
    category: row.category_snapshot,
    outputCatalogItemId: row.output_catalog_item_id,
    outputProductIdSnapshot: row.output_product_id_snapshot,
    expectedOutputQuantity: row.expected_output_quantity,
    expectedOutputUnit: row.expected_output_unit,
    productionMode: row.production_mode,
    suggestedSellingPriceSnapshot: row.suggested_selling_price_snapshot,
    sellingPriceState: row.selling_price_state,
    notes: row.notes_snapshot,
    sourceKind: row.source_kind,
    sourceDraftId: row.source_draft_id,
    duplicatedFromVersionId: row.duplicated_from_version_id,
    graphState: row.graph_state,
    costState: row.cost_state,
    effectiveAt: row.effective_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapLine(row: RecipeVersionLineRow): RecipeVersionLineRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    recipeVersionId: row.recipe_version_id,
    sortOrder: row.sort_order,
    sourceKind: row.source_kind,
    catalogItemId: row.catalog_item_id,
    childRecipeVersionId: row.child_recipe_version_id,
    customName: row.custom_name_snapshot,
    quantity: row.quantity,
    unit: row.unit,
    normalizedQuantity: row.normalized_quantity,
    normalizedUnit: row.normalized_unit,
    conversionId: row.conversion_id,
    conversionFactorSnapshot: row.conversion_factor_snapshot,
    role: row.role,
    isOptional: toBoolean(row.is_optional),
    costOverride: row.cost_override,
    costPerUnitSnapshot: row.cost_per_unit_snapshot,
    lineCostSnapshot: row.line_cost_snapshot,
    costState: row.cost_state,
    allocationMode: row.allocation_mode,
    legacyIngredientIdSnapshot: row.legacy_ingredient_id_snapshot,
    legacyIngredientLotId: row.legacy_ingredient_lot_id,
    sourceLabelSnapshot: row.source_label_snapshot,
    originalLegacyLineId: row.original_legacy_line_id,
    notes: row.notes_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function getPublicationAuthoritativeUnitCost(
  line: PublishRecipeVersionLineInput,
) {
  if (line.sourceKind === "custom_cost") {
    return line.costOverride ?? null;
  }
  if (line.sourceKind === "catalog_item") {
    return line.costPerUnitSnapshot ?? null;
  }
  if (
    line.lineCostSnapshot === null ||
    line.lineCostSnapshot === undefined
  ) {
    return null;
  }
  return line.lineCostSnapshot / line.quantity;
}

function validatePublicationLineCostEvidence(
  line: PublishRecipeVersionLineInput,
  index: number,
) {
  if (
    (line.sourceKind === "custom_cost" &&
      line.costPerUnitSnapshot !== null &&
      line.costPerUnitSnapshot !== undefined) ||
    (line.sourceKind === "catalog_item" &&
      line.costOverride !== null &&
      line.costOverride !== undefined) ||
    (line.sourceKind === "child_recipe_version" &&
      ((line.costOverride !== null && line.costOverride !== undefined) ||
        (line.costPerUnitSnapshot !== null &&
          line.costPerUnitSnapshot !== undefined)))
  ) {
    throw new Error(
      `Recipe line ${index + 1} cost evidence does not match its source.`,
    );
  }

  const authoritativeUnitCost = getPublicationAuthoritativeUnitCost(line);
  const lineCost = line.lineCostSnapshot ?? null;
  if (line.costState === "known") {
    if (
      authoritativeUnitCost === null ||
      !Number.isFinite(authoritativeUnitCost) ||
      authoritativeUnitCost < 0
    ) {
      throw new Error(
        `Recipe line ${index + 1} known cost requires non-negative evidence.`,
      );
    }
    const expectedLineCost =
      line.sourceKind === "custom_cost"
        ? authoritativeUnitCost
        : authoritativeUnitCost * line.quantity;
    if (
      lineCost === null ||
      !Number.isFinite(lineCost) ||
      Math.abs(lineCost - expectedLineCost) > 1e-9
    ) {
      throw new Error(
        `Recipe line ${index + 1} cost snapshot is inconsistent.`,
      );
    }
    return;
  }

  if (authoritativeUnitCost !== null || lineCost !== null) {
    throw new Error(
      `Recipe line ${index + 1} incomplete cost cannot carry authoritative evidence.`,
    );
  }
}

function validatePublishInput(input: PublishRecipeVersionInput) {
  if (!input.name.trim()) throw new Error("Recipe version name is required.");
  if (
    !Number.isFinite(input.expectedOutputQuantity) ||
    input.expectedOutputQuantity <= 0
  ) {
    throw new Error("Expected output quantity must be greater than zero.");
  }
  if (!input.expectedOutputUnit.trim()) {
    throw new Error("Expected output unit is required.");
  }
  if (input.lines.length === 0) {
    throw new Error("A published recipe version requires at least one line.");
  }

  input.lines.forEach((line, index) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error(`Recipe line ${index + 1} requires a positive quantity.`);
    }
    const sources = [
      Boolean(line.catalogItemId),
      Boolean(line.childRecipeVersionId),
      Boolean(line.customName?.trim()),
    ].filter(Boolean).length;
    if (sources !== 1) {
      throw new Error(`Recipe line ${index + 1} must have exactly one source.`);
    }
    if (
      (line.sourceKind === "catalog_item" && !line.catalogItemId) ||
      (line.sourceKind === "child_recipe_version" &&
        !line.childRecipeVersionId) ||
      (line.sourceKind === "custom_cost" && !line.customName?.trim())
    ) {
      throw new Error(`Recipe line ${index + 1} source kind does not match its source.`);
    }
    validatePublicationLineCostEvidence(line, index);
  });
}

function sameOptionalText(
  left: string | null,
  right: string | null | undefined,
) {
  return left === (right?.trim() || null);
}

function sameOptionalNumber(
  left: number | null,
  right: number | null | undefined,
) {
  const normalizedRight = right ?? null;
  return (
    (left === null && normalizedRight === null) ||
    (left !== null &&
      normalizedRight !== null &&
      Math.abs(left - normalizedRight) <= 1e-9)
  );
}

export async function getRecipeVersionById(
  id: string,
  db?: RepositoryDatabase,
) {
  const row = await getRepositoryDatabase(db).getFirstAsync<RecipeVersionRow>(
    "SELECT * FROM recipe_versions WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return row ? mapVersion(row) : null;
}

export async function listRecipeVersionLines(
  recipeVersionId: string,
  db?: RepositoryDatabase,
) {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<RecipeVersionLineRow>(
      `
        SELECT *
        FROM recipe_version_lines
        WHERE recipe_version_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
      `,
      [recipeVersionId],
    );
  return rows.map(mapLine);
}

export async function listRecipeVersionHistory(
  recipeId: string,
  db?: RepositoryDatabase,
) {
  const rows = await getRepositoryDatabase(db).getAllAsync<RecipeVersionRow>(
    `
      SELECT *
      FROM recipe_versions
      WHERE recipe_id = ? AND deleted_at IS NULL
      ORDER BY version_number DESC
    `,
    [recipeId],
  );
  return rows.map(mapVersion);
}

export async function loadRecipeVersionGraph(
  rootVersionId: string,
  maxVersions = 100,
  db?: RepositoryDatabase,
) {
  if (!Number.isInteger(maxVersions) || maxVersions < 1 || maxVersions > 500) {
    throw new Error("Recipe graph limit must be between 1 and 500.");
  }

  const database = getRepositoryDatabase(db);
  const versionRows = await database.getAllAsync<RecipeVersionRow>(
    `
      WITH RECURSIVE graph(id, path, depth) AS (
        SELECT id, '|' || id || '|', 0
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
        UNION ALL
        SELECT child.id, graph.path || child.id || '|', graph.depth + 1
        FROM graph
        INNER JOIN recipe_version_lines line
          ON line.recipe_version_id = graph.id
          AND line.source_kind = 'child_recipe_version'
          AND line.deleted_at IS NULL
        INNER JOIN recipe_versions child
          ON child.id = line.child_recipe_version_id
          AND child.deleted_at IS NULL
        WHERE graph.depth < ?
          AND instr(graph.path, '|' || child.id || '|') = 0
      )
      SELECT DISTINCT version.*
      FROM graph
      INNER JOIN recipe_versions version ON version.id = graph.id
      LIMIT ?
    `,
    [rootVersionId, maxVersions, maxVersions],
  );

  if (versionRows.length === maxVersions) {
    throw new Error("Recipe graph reached its repository load budget.");
  }
  const ids = versionRows.map((row) => row.id);
  if (ids.length === 0) return { versions: [], lines: [] };

  const placeholders = ids.map(() => "?").join(", ");
  const lineRows = await database.getAllAsync<RecipeVersionLineRow>(
    `
      SELECT *
      FROM recipe_version_lines
      WHERE recipe_version_id IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY recipe_version_id ASC, sort_order ASC, id ASC
    `,
    ids,
  );

  return {
    versions: versionRows.map(mapVersion),
    lines: lineRows.map(mapLine),
  };
}

/**
 * Inserts immutable content and advances the compatibility pointer in one
 * exclusive transaction. Existing version content is never updated.
 */
export async function publishRecipeVersion(
  input: PublishRecipeVersionInput,
  db?: RepositoryDatabase,
) {
  validatePublishInput(input);
  const database = getRepositoryDatabase(db);
  let published: RecipeVersionRecord | null = null;

  await database.withExclusiveTransactionAsync(async (txn) => {
    const recipe = await txn.getFirstAsync<{
      id: string;
      business_id: string;
      output_product_id: string;
      active_version_id: string | null;
    }>(
      `
        SELECT id, business_id, output_product_id, active_version_id
        FROM recipes
        WHERE id = ? AND deleted_at IS NULL
      `,
      [input.recipeId],
    );
    if (!recipe || recipe.business_id !== input.businessId) {
      throw new Error("Recipe does not belong to the active business.");
    }

    const output = await txn.getFirstAsync<{
      business_id: string;
      legacy_entity_id: string;
      binding_status: string;
    }>(
      `
        SELECT item.business_id, binding.legacy_entity_id,
          binding.binding_status
        FROM catalog_items item
        INNER JOIN legacy_item_bindings binding
          ON binding.catalog_item_id = item.id
          AND binding.entity_kind = 'product'
          AND binding.legacy_entity_id = ?
          AND binding.deleted_at IS NULL
        WHERE item.id = ? AND item.deleted_at IS NULL
          AND item.lifecycle_status <> 'archived'
      `,
      [recipe.output_product_id, input.outputCatalogItemId],
    );
    if (
      !output ||
      output.business_id !== input.businessId ||
      output.legacy_entity_id !== recipe.output_product_id ||
      output.binding_status !== "active" ||
      (input.outputProductIdSnapshot !== undefined &&
        input.outputProductIdSnapshot !== null &&
        input.outputProductIdSnapshot !== recipe.output_product_id)
    ) {
      throw new Error("Output catalog item is not the Recipe's exact Product binding.");
    }

    if (input.sourceDraftId) {
      if (input.expectedDraftRevision === undefined) {
        throw new Error("Recipe draft publication requires a revision guard.");
      }
      const draft = await txn.getFirstAsync<{
        business_id: string;
        recipe_id: string | null;
        output_catalog_item_id: string | null;
        name: string | null;
        category: string | null;
        expected_output_quantity: number | null;
        expected_output_unit: string | null;
        production_mode: RecipeVersionRecord["productionMode"] | null;
        suggested_selling_price: number | null;
        selling_price_state: CostState;
        autosave_revision: number;
        lifecycle_status: string;
        unresolved_requirement_count: number;
      }>(
        `
          SELECT business_id, recipe_id, output_catalog_item_id, name,
            category, expected_output_quantity, expected_output_unit,
            production_mode, suggested_selling_price, selling_price_state,
            autosave_revision, lifecycle_status,
            unresolved_requirement_count
          FROM recipe_drafts
          WHERE id = ? AND deleted_at IS NULL
        `,
        [input.sourceDraftId],
      );
      if (!draft || draft.business_id !== input.businessId) {
        throw new Error("Recipe draft is unavailable.");
      }
      if (draft.autosave_revision !== input.expectedDraftRevision) {
        throw new Error("Recipe draft changed before publication.");
      }
      if (!["editing", "ready"].includes(draft.lifecycle_status)) {
        throw new Error("Recipe draft is not publishable.");
      }
      if (
        draft.recipe_id !== input.recipeId ||
        draft.output_catalog_item_id !== input.outputCatalogItemId ||
        draft.name?.trim() !== input.name.trim() ||
        !sameOptionalText(draft.category, input.category) ||
        !sameOptionalNumber(
          draft.expected_output_quantity,
          input.expectedOutputQuantity,
        ) ||
        draft.expected_output_unit?.trim() !==
          input.expectedOutputUnit.trim() ||
        draft.production_mode !== input.productionMode ||
        !sameOptionalNumber(
          draft.suggested_selling_price,
          input.suggestedSellingPriceSnapshot,
        ) ||
        draft.selling_price_state !== input.sellingPriceState ||
        draft.unresolved_requirement_count !== 0
      ) {
        throw new Error("Recipe publication does not match the saved draft.");
      }

      const draftLines = await txn.getAllAsync<{
        source_kind: string;
        catalog_item_id: string | null;
        child_recipe_version_id: string | null;
        custom_name: string | null;
        quantity: number | null;
        unit: string | null;
        normalized_quantity: number | null;
        normalized_unit: string | null;
        conversion_id: string | null;
        conversion_factor_snapshot: number | null;
        role: RecipeLineRole;
        is_optional: number;
        cost_override: number | null;
        cost_state: RecipeVersionCostState;
        allocation_mode: RecipeAllocationMode;
      }>(
        `
          SELECT source_kind, catalog_item_id, child_recipe_version_id,
            custom_name, quantity, unit, normalized_quantity, normalized_unit,
            conversion_id, conversion_factor_snapshot, role, is_optional,
            cost_override, cost_state, allocation_mode
          FROM recipe_draft_lines
          WHERE recipe_draft_id = ? AND deleted_at IS NULL
          ORDER BY sort_order ASC, id ASC
        `,
        [input.sourceDraftId],
      );
      if (draftLines.length !== input.lines.length) {
        throw new Error("Recipe publication lines do not match the saved draft.");
      }
      for (const [index, draftLine] of draftLines.entries()) {
        const line = input.lines[index];
        const publicationCost = getPublicationAuthoritativeUnitCost(line);
        if (
          draftLine.source_kind !== line.sourceKind ||
          draftLine.catalog_item_id !== (line.catalogItemId ?? null) ||
          draftLine.child_recipe_version_id !==
            (line.childRecipeVersionId ?? null) ||
          !sameOptionalText(draftLine.custom_name, line.customName) ||
          !sameOptionalNumber(draftLine.quantity, line.quantity) ||
          draftLine.unit?.trim() !== line.unit.trim() ||
          !sameOptionalNumber(
            draftLine.normalized_quantity,
            line.normalizedQuantity,
          ) ||
          !sameOptionalText(
            draftLine.normalized_unit,
            line.normalizedUnit,
          ) ||
          draftLine.conversion_id !== (line.conversionId ?? null) ||
          !sameOptionalNumber(
            draftLine.conversion_factor_snapshot,
            line.conversionFactorSnapshot,
          ) ||
          draftLine.role !== (line.role ?? "unset") ||
          draftLine.is_optional !== toInteger(line.isOptional ?? false) ||
          !sameOptionalNumber(draftLine.cost_override, publicationCost) ||
          draftLine.cost_state !== line.costState ||
          draftLine.allocation_mode !== (line.allocationMode ?? "none")
        ) {
          throw new Error(
            `Recipe publication line ${index + 1} does not match the saved draft.`,
          );
        }
      }
    }

    const catalogItemIds = [
      ...new Set(
        input.lines
          .filter((line) => line.sourceKind === "catalog_item")
          .map((line) => line.catalogItemId as string),
      ),
    ];
    for (const catalogItemId of catalogItemIds) {
      const item = await txn.getFirstAsync<{ business_id: string }>(
        `
          SELECT business_id
          FROM catalog_items
          WHERE id = ? AND deleted_at IS NULL
            AND lifecycle_status <> 'archived'
        `,
        [catalogItemId],
      );
      if (item?.business_id !== input.businessId) {
        throw new Error("Recipe input catalog item is unavailable.");
      }
    }

    const childVersionIds = [
      ...new Set(
        input.lines
          .filter((line) => line.sourceKind === "child_recipe_version")
          .map((line) => line.childRecipeVersionId as string),
      ),
    ];
    for (const childVersionId of childVersionIds) {
      const child = await txn.getFirstAsync<{
        business_id: string;
        status: RecipeVersionStatus;
      }>(
        `
          SELECT business_id, status
          FROM recipe_versions
          WHERE id = ? AND deleted_at IS NULL
        `,
        [childVersionId],
      );
      if (
        child?.business_id !== input.businessId ||
        child.status === "archived"
      ) {
        throw new Error("Pinned child Recipe version is unavailable.");
      }
    }

    for (const line of input.lines) {
      if (!line.conversionId) continue;
      if (
        line.sourceKind !== "catalog_item" ||
        !line.normalizedUnit?.trim() ||
        line.conversionFactorSnapshot === null ||
        line.conversionFactorSnapshot === undefined
      ) {
        throw new Error("Recipe line conversion evidence is incomplete.");
      }
      const conversion = await txn.getFirstAsync<{
        business_id: string;
        catalog_item_id: string;
        from_unit: string;
        to_unit: string;
        factor: number;
      }>(
        `
          SELECT business_id, catalog_item_id, from_unit, to_unit, factor
          FROM item_unit_conversions
          WHERE id = ? AND deleted_at IS NULL
        `,
        [line.conversionId],
      );
      if (
        !conversion ||
        conversion.business_id !== input.businessId ||
        conversion.catalog_item_id !== line.catalogItemId ||
        conversion.from_unit !== line.unit.trim() ||
        conversion.to_unit !== line.normalizedUnit.trim() ||
        Math.abs(conversion.factor - line.conversionFactorSnapshot) > 1e-9
      ) {
        throw new Error("Recipe line conversion evidence is unavailable.");
      }
    }

    const nextRow = await txn.getFirstAsync<{ next_version: number }>(
      `
        SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
        FROM recipe_versions
        WHERE recipe_id = ?
      `,
      [input.recipeId],
    );
    const versionNumber = nextRow?.next_version ?? 1;
    const timestamp = nowIso();
    const version: RecipeVersionRecord = {
      id: input.id ?? makeRecipeVersionId(),
      businessId: input.businessId,
      recipeId: input.recipeId,
      versionNumber,
      status: "published",
      name: input.name.trim(),
      category: input.category?.trim() || null,
      outputCatalogItemId: input.outputCatalogItemId,
      outputProductIdSnapshot: recipe.output_product_id,
      expectedOutputQuantity: input.expectedOutputQuantity,
      expectedOutputUnit: input.expectedOutputUnit.trim(),
      productionMode: input.productionMode,
      suggestedSellingPriceSnapshot:
        input.suggestedSellingPriceSnapshot ?? null,
      sellingPriceState: input.sellingPriceState,
      notes: input.notes?.trim() || null,
      sourceKind: input.sourceKind ?? "native_publish",
      sourceDraftId: input.sourceDraftId ?? null,
      duplicatedFromVersionId: input.duplicatedFromVersionId ?? null,
      graphState: input.graphState,
      costState: input.costState,
      effectiveAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    await txn.runAsync(
      `
        INSERT INTO recipe_versions (
          id, business_id, recipe_id, version_number, status, name_snapshot,
          category_snapshot, output_catalog_item_id,
          output_product_id_snapshot, expected_output_quantity,
          expected_output_unit, production_mode,
          suggested_selling_price_snapshot, selling_price_state,
          notes_snapshot, source_kind, source_draft_id,
          duplicated_from_version_id, graph_state, cost_state, effective_at,
          created_at, updated_at, sync_status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
      `,
      [
        version.id,
        version.businessId,
        version.recipeId,
        version.versionNumber,
        version.status,
        version.name,
        version.category,
        version.outputCatalogItemId,
        version.outputProductIdSnapshot,
        version.expectedOutputQuantity,
        version.expectedOutputUnit,
        version.productionMode,
        version.suggestedSellingPriceSnapshot,
        version.sellingPriceState,
        version.notes,
        version.sourceKind,
        version.sourceDraftId,
        version.duplicatedFromVersionId,
        version.graphState,
        version.costState,
        version.effectiveAt,
        version.createdAt,
        version.updatedAt,
      ],
    );

    for (const [sortOrder, line] of input.lines.entries()) {
      await txn.runAsync(
        `
          INSERT INTO recipe_version_lines (
            id, business_id, recipe_version_id, sort_order, source_kind,
            catalog_item_id, child_recipe_version_id, custom_name_snapshot,
            quantity, unit, normalized_quantity, normalized_unit,
            conversion_id, conversion_factor_snapshot, role, is_optional,
            cost_override, cost_per_unit_snapshot, line_cost_snapshot,
            cost_state, allocation_mode, legacy_ingredient_id_snapshot,
            legacy_ingredient_lot_id, source_label_snapshot,
            original_legacy_line_id, notes_snapshot, created_at, updated_at,
            sync_status, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, 'local', NULL)
        `,
        [
          line.id ?? makeRecipeVersionLineId(),
          input.businessId,
          version.id,
          sortOrder,
          line.sourceKind,
          line.catalogItemId ?? null,
          line.childRecipeVersionId ?? null,
          line.customName?.trim() || null,
          line.quantity,
          line.unit.trim(),
          line.normalizedQuantity ?? null,
          line.normalizedUnit?.trim() || null,
          line.conversionId ?? null,
          line.conversionFactorSnapshot ?? null,
          line.role ?? "unset",
          toInteger(line.isOptional ?? false),
          line.costOverride ?? null,
          line.costPerUnitSnapshot ?? null,
          line.lineCostSnapshot ?? null,
          line.costState,
          line.allocationMode ?? "none",
          line.sourceLabelSnapshot?.trim() || null,
          line.notes?.trim() || null,
          timestamp,
          timestamp,
        ],
      );
    }

    if (recipe.active_version_id) {
      const supersedeResult = await txn.runAsync(
        `
          UPDATE recipe_versions
          SET status = 'superseded', updated_at = ?, sync_status = 'local'
          WHERE id = ? AND recipe_id = ? AND status = 'published'
        `,
        [timestamp, recipe.active_version_id, input.recipeId],
      );
      if (supersedeResult.changes !== 1) {
        throw new Error("Active Recipe version changed before publication.");
      }
    }

    const recipeResult = await txn.runAsync(
      `
        UPDATE recipes
        SET active_version_id = ?, versioning_state = 'native',
          name = ?, output_quantity = ?, output_unit = ?,
          production_mode = ?, suggested_selling_price = ?, notes = ?,
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
      `,
      [
        version.id,
        version.name,
        version.expectedOutputQuantity,
        version.expectedOutputUnit,
        version.productionMode,
        version.suggestedSellingPriceSnapshot,
        version.notes,
        timestamp,
        input.recipeId,
        input.businessId,
      ],
    );
    if (recipeResult.changes !== 1) {
      throw new Error("Recipe changed before version publication.");
    }

    if (input.role) {
      await txn.runAsync(
        `
          UPDATE catalog_item_recipe_roles
          SET status = 'superseded', archived_at = ?, updated_at = ?,
            sync_status = 'local'
          WHERE output_catalog_item_id = ? AND role = ?
            ${input.role === "alternate" ? "AND recipe_id = ?" : ""}
            AND status = 'active' AND deleted_at IS NULL
        `,
        input.role === "alternate"
          ? [
              timestamp,
              timestamp,
              input.outputCatalogItemId,
              input.role,
              input.recipeId,
            ]
          : [timestamp, timestamp, input.outputCatalogItemId, input.role],
      );
      await txn.runAsync(
        `
          INSERT INTO catalog_item_recipe_roles (
            id, business_id, output_catalog_item_id, recipe_id, role, status,
            effective_at, archived_at, created_at, updated_at, sync_status,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, 'local', NULL)
        `,
        [
          makeRecipeRoleId(),
          input.businessId,
          input.outputCatalogItemId,
          input.recipeId,
          input.role,
          timestamp,
          timestamp,
          timestamp,
        ],
      );
    }

    if (input.sourceDraftId) {
      const result = await txn.runAsync(
        `
          UPDATE recipe_drafts
          SET lifecycle_status = 'published', published_version_id = ?,
            updated_at = ?, last_saved_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND recipe_id = ?
            AND output_catalog_item_id = ?
            AND lifecycle_status IN ('editing', 'ready')
            AND autosave_revision = ?
            AND deleted_at IS NULL
        `,
        [
          version.id,
          timestamp,
          timestamp,
          input.sourceDraftId,
          input.businessId,
          input.recipeId,
          input.outputCatalogItemId,
          input.expectedDraftRevision as number,
        ],
      );
      if (result.changes !== 1) {
        throw new Error("Recipe draft publication lost its revision guard.");
      }
    }

    published = version;
  });

  if (!published) throw new Error("Recipe version publication failed.");
  return published;
}
