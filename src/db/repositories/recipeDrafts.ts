import type { CatalogClassification } from "@/domain/catalogItems";
import type { CostState } from "@/domain/costState";
import {
  makeRecipeDraftId,
  makeRecipeDraftLineId,
} from "@/domain/ids";

import {
  getRepositoryDatabase,
  nowIso,
  toBoolean,
  toInteger,
  type RepositoryDatabase,
} from "./shared";
import type {
  RecipeAllocationMode,
  RecipeLineRole,
  RecipeVersionCostState,
} from "./recipeVersions";

export type RecipeDraftLifecycle =
  | "editing"
  | "ready"
  | "published"
  | "abandoned";
export type RecipeDraftLineSource =
  | "catalog_item"
  | "child_recipe_version"
  | "child_draft"
  | "custom_cost"
  | "unresolved";

export type RecipeDraftRecord = {
  id: string;
  businessId: string;
  branchId: string | null;
  recipeId: string | null;
  sourceVersionId: string | null;
  outputCatalogItemId: string | null;
  name: string | null;
  category: string | null;
  expectedOutputQuantity: number | null;
  expectedOutputUnit: string | null;
  productionMode: "prepared_before_selling" | "cook_upon_order" | null;
  suggestedSellingPrice: number | null;
  classificationProposal: Exclude<
    CatalogClassification,
    "legacy_unclassified"
  > | null;
  sellingPriceState: CostState;
  sellable: boolean;
  kioskEnabled: boolean;
  editorStep: string;
  lifecycle: RecipeDraftLifecycle;
  autosaveRevision: number;
  lastSavedAt: string;
  unresolvedRequirementCount: number;
  parentDraftId: string | null;
  parentLineId: string | null;
  returnRoute: string | null;
  publishedVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type RecipeDraftLineRecord = {
  id: string;
  businessId: string;
  recipeDraftId: string;
  sortOrder: number;
  sourceKind: RecipeDraftLineSource;
  catalogItemId: string | null;
  childRecipeVersionId: string | null;
  childDraftId: string | null;
  customName: string | null;
  quantity: number | null;
  unit: string | null;
  normalizedQuantity: number | null;
  normalizedUnit: string | null;
  conversionId: string | null;
  conversionFactorSnapshot: number | null;
  role: RecipeLineRole;
  isOptional: boolean;
  costOverride: number | null;
  costState: RecipeVersionCostState;
  allocationMode: RecipeAllocationMode;
  legacyIngredientLotId: string | null;
  notes: string | null;
};

type RecipeDraftRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  recipe_id: string | null;
  source_version_id: string | null;
  output_catalog_item_id: string | null;
  name: string | null;
  category: string | null;
  expected_output_quantity: number | null;
  expected_output_unit: string | null;
  production_mode: RecipeDraftRecord["productionMode"];
  suggested_selling_price: number | null;
  classification_proposal: RecipeDraftRecord["classificationProposal"];
  selling_price_state: CostState;
  sellable: number;
  kiosk_enabled: number;
  editor_step: string;
  lifecycle_status: RecipeDraftLifecycle;
  autosave_revision: number;
  last_saved_at: string;
  unresolved_requirement_count: number;
  parent_draft_id: string | null;
  parent_line_id: string | null;
  return_route: string | null;
  published_version_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RecipeDraftLineRow = {
  id: string;
  business_id: string;
  recipe_draft_id: string;
  sort_order: number;
  source_kind: RecipeDraftLineSource;
  catalog_item_id: string | null;
  child_recipe_version_id: string | null;
  child_draft_id: string | null;
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
  legacy_ingredient_lot_id: string | null;
  notes: string | null;
};

export type CreateRecipeDraftInput = {
  id?: string;
  businessId: string;
  branchId?: string | null;
  recipeId?: string | null;
  sourceVersionId?: string | null;
  outputCatalogItemId?: string | null;
  name?: string | null;
  parentDraftId?: string | null;
  parentLineId?: string | null;
  returnRoute?: string | null;
};

export type SaveRecipeDraftLineInput = Omit<
  RecipeDraftLineRecord,
  "id" | "businessId" | "recipeDraftId" | "sortOrder"
> & { id?: string };

export type SaveRecipeDraftInput = {
  draftId: string;
  businessId: string;
  expectedRevision: number;
  nextRevision: number;
  outputCatalogItemId?: string | null;
  name?: string | null;
  category?: string | null;
  expectedOutputQuantity?: number | null;
  expectedOutputUnit?: string | null;
  productionMode?: RecipeDraftRecord["productionMode"];
  suggestedSellingPrice?: number | null;
  classificationProposal?: RecipeDraftRecord["classificationProposal"];
  sellingPriceState?: CostState;
  sellable?: boolean;
  kioskEnabled?: boolean;
  editorStep?: string;
  lifecycle?: Extract<RecipeDraftLifecycle, "editing" | "ready">;
  unresolvedRequirementCount?: number;
  lines: SaveRecipeDraftLineInput[];
};

function mapDraft(row: RecipeDraftRow): RecipeDraftRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    recipeId: row.recipe_id,
    sourceVersionId: row.source_version_id,
    outputCatalogItemId: row.output_catalog_item_id,
    name: row.name,
    category: row.category,
    expectedOutputQuantity: row.expected_output_quantity,
    expectedOutputUnit: row.expected_output_unit,
    productionMode: row.production_mode,
    suggestedSellingPrice: row.suggested_selling_price,
    classificationProposal: row.classification_proposal,
    sellingPriceState: row.selling_price_state,
    sellable: toBoolean(row.sellable),
    kioskEnabled: toBoolean(row.kiosk_enabled),
    editorStep: row.editor_step,
    lifecycle: row.lifecycle_status,
    autosaveRevision: row.autosave_revision,
    lastSavedAt: row.last_saved_at,
    unresolvedRequirementCount: row.unresolved_requirement_count,
    parentDraftId: row.parent_draft_id,
    parentLineId: row.parent_line_id,
    returnRoute: row.return_route,
    publishedVersionId: row.published_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapLine(row: RecipeDraftLineRow): RecipeDraftLineRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    recipeDraftId: row.recipe_draft_id,
    sortOrder: row.sort_order,
    sourceKind: row.source_kind,
    catalogItemId: row.catalog_item_id,
    childRecipeVersionId: row.child_recipe_version_id,
    childDraftId: row.child_draft_id,
    customName: row.custom_name,
    quantity: row.quantity,
    unit: row.unit,
    normalizedQuantity: row.normalized_quantity,
    normalizedUnit: row.normalized_unit,
    conversionId: row.conversion_id,
    conversionFactorSnapshot: row.conversion_factor_snapshot,
    role: row.role,
    isOptional: toBoolean(row.is_optional),
    costOverride: row.cost_override,
    costState: row.cost_state,
    allocationMode: row.allocation_mode,
    legacyIngredientLotId: row.legacy_ingredient_lot_id,
    notes: row.notes,
  };
}

function validateDraftLine(line: SaveRecipeDraftLineInput, index: number) {
  const expectedSource = {
    catalog_item: Boolean(line.catalogItemId),
    child_recipe_version: Boolean(line.childRecipeVersionId),
    child_draft: Boolean(line.childDraftId),
    custom_cost: Boolean(line.customName?.trim()),
    unresolved: true,
  }[line.sourceKind];
  if (!expectedSource) {
    throw new Error(`Draft line ${index + 1} source is incomplete.`);
  }
}

async function insertDraftLine(
  line: SaveRecipeDraftLineInput,
  draftId: string,
  businessId: string,
  sortOrder: number,
  timestamp: string,
  db: RepositoryDatabase,
) {
  await db.runAsync(
    `
      INSERT INTO recipe_draft_lines (
        id, business_id, recipe_draft_id, sort_order, source_kind,
        catalog_item_id, child_recipe_version_id, child_draft_id, custom_name,
        quantity, unit, normalized_quantity, normalized_unit, conversion_id,
        conversion_factor_snapshot, role, is_optional, cost_override,
        cost_state, allocation_mode, legacy_ingredient_lot_id, notes,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
    `,
    [
      line.id ?? makeRecipeDraftLineId(),
      businessId,
      draftId,
      sortOrder,
      line.sourceKind,
      line.catalogItemId ?? null,
      line.childRecipeVersionId ?? null,
      line.childDraftId ?? null,
      line.customName?.trim() || null,
      line.quantity ?? null,
      line.unit?.trim() || null,
      line.normalizedQuantity ?? null,
      line.normalizedUnit?.trim() || null,
      line.conversionId ?? null,
      line.conversionFactorSnapshot ?? null,
      line.role,
      toInteger(line.isOptional),
      line.costOverride ?? null,
      line.costState,
      line.allocationMode,
      line.legacyIngredientLotId ?? null,
      line.notes?.trim() || null,
      timestamp,
      timestamp,
    ],
  );
}

export async function createRecipeDraft(
  input: CreateRecipeDraftInput,
  db?: RepositoryDatabase,
) {
  if (!input.businessId.trim()) throw new Error("Business is required.");
  const database = getRepositoryDatabase(db);
  const timestamp = nowIso();
  const draftId = input.id ?? makeRecipeDraftId();

  await database.runAsync(
    `
      INSERT INTO recipe_drafts (
        id, business_id, branch_id, recipe_id, source_version_id,
        output_catalog_item_id, name, category, expected_output_quantity,
        expected_output_unit, production_mode, suggested_selling_price,
        classification_proposal, selling_price_state, sellable, kiosk_enabled,
        editor_step, lifecycle_status, autosave_revision, last_saved_at,
        unresolved_requirement_count, parent_draft_id, parent_line_id,
        return_route, published_version_id, created_at, updated_at, sync_status,
        deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 'unknown', 0, 0, 'definition', 'editing', 0, ?, 0, ?, ?, ?, NULL, ?, ?, 'local', NULL)
    `,
    [
      draftId,
      input.businessId,
      input.branchId ?? null,
      input.recipeId ?? null,
      input.sourceVersionId ?? null,
      input.outputCatalogItemId ?? null,
      input.name?.trim() || null,
      timestamp,
      input.parentDraftId ?? null,
      input.parentLineId ?? null,
      input.returnRoute ?? null,
      timestamp,
      timestamp,
    ],
  );

  const draft = await getRecipeDraftById(draftId, database);
  if (!draft) throw new Error("Could not load the created recipe draft.");
  return draft;
}

export async function getRecipeDraftById(
  id: string,
  db?: RepositoryDatabase,
) {
  const row = await getRepositoryDatabase(db).getFirstAsync<RecipeDraftRow>(
    "SELECT * FROM recipe_drafts WHERE id = ? AND deleted_at IS NULL",
    [id],
  );
  return row ? mapDraft(row) : null;
}

export async function listRecipeDraftLines(
  draftId: string,
  db?: RepositoryDatabase,
) {
  const rows =
    await getRepositoryDatabase(db).getAllAsync<RecipeDraftLineRow>(
      `
        SELECT *
        FROM recipe_draft_lines
        WHERE recipe_draft_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
      `,
      [draftId],
    );
  return rows.map(mapLine);
}

export async function listResumableRecipeDrafts(
  businessId: string,
  db?: RepositoryDatabase,
) {
  const rows = await getRepositoryDatabase(db).getAllAsync<RecipeDraftRow>(
    `
      SELECT *
      FROM recipe_drafts
      WHERE business_id = ?
        AND lifecycle_status IN ('editing', 'ready')
        AND deleted_at IS NULL
      ORDER BY updated_at DESC, id ASC
    `,
    [businessId],
  );
  return rows.map(mapDraft);
}

/**
 * Persists the complete mutable draft snapshot behind an optimistic revision
 * guard. Losing the guard aborts the same transaction before line replacement.
 */
export async function saveRecipeDraft(
  input: SaveRecipeDraftInput,
  db?: RepositoryDatabase,
) {
  if (
    !Number.isInteger(input.expectedRevision) ||
    !Number.isInteger(input.nextRevision) ||
    input.nextRevision <= input.expectedRevision
  ) {
    throw new Error("Draft revisions must increase monotonically.");
  }
  input.lines.forEach(validateDraftLine);

  const database = getRepositoryDatabase(db);
  const timestamp = nowIso();
  await database.withExclusiveTransactionAsync(async (txn) => {
    const result = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET output_catalog_item_id = COALESCE(?, output_catalog_item_id),
          name = ?, category = ?, expected_output_quantity = ?,
          expected_output_unit = ?, production_mode = ?,
          suggested_selling_price = ?, classification_proposal = ?,
          selling_price_state = COALESCE(?, selling_price_state),
          sellable = COALESCE(?, sellable),
          kiosk_enabled = COALESCE(?, kiosk_enabled),
          editor_step = COALESCE(?, editor_step),
          lifecycle_status = COALESCE(?, lifecycle_status),
          autosave_revision = ?, last_saved_at = ?,
          unresolved_requirement_count = COALESCE(?, unresolved_requirement_count),
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ?
          AND autosave_revision = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND deleted_at IS NULL
      `,
      [
        input.outputCatalogItemId === undefined
          ? null
          : input.outputCatalogItemId,
        input.name?.trim() || null,
        input.category?.trim() || null,
        input.expectedOutputQuantity ?? null,
        input.expectedOutputUnit?.trim() || null,
        input.productionMode ?? null,
        input.suggestedSellingPrice ?? null,
        input.classificationProposal ?? null,
        input.sellingPriceState ?? null,
        input.sellable === undefined ? null : toInteger(input.sellable),
        input.kioskEnabled === undefined
          ? null
          : toInteger(input.kioskEnabled),
        input.editorStep ?? null,
        input.lifecycle ?? null,
        input.nextRevision,
        timestamp,
        input.unresolvedRequirementCount ?? null,
        timestamp,
        input.draftId,
        input.businessId,
        input.expectedRevision,
      ],
    );
    if (result.changes !== 1) {
      throw new Error("Recipe draft changed before autosave.");
    }

    await txn.runAsync(
      "DELETE FROM recipe_draft_lines WHERE recipe_draft_id = ?",
      [input.draftId],
    );
    for (const [index, line] of input.lines.entries()) {
      await insertDraftLine(
        line,
        input.draftId,
        input.businessId,
        index,
        timestamp,
        txn,
      );
    }
  });

  const saved = await getRecipeDraftById(input.draftId, database);
  if (!saved) throw new Error("Saved recipe draft is unavailable.");
  return saved;
}

/**
 * Resolves a persisted child return atomically. Restarting after publication
 * can safely retry because the final child-version reference is idempotent.
 */
export async function resolvePublishedNestedDraft(
  childDraftId: string,
  publishedVersionId: string,
  db?: RepositoryDatabase,
) {
  const database = getRepositoryDatabase(db);
  const timestamp = nowIso();
  await database.withExclusiveTransactionAsync(async (txn) => {
    const child = await txn.getFirstAsync<{
      parent_draft_id: string | null;
      parent_line_id: string | null;
      published_version_id: string | null;
    }>(
      `
        SELECT parent_draft_id, parent_line_id, published_version_id
        FROM recipe_drafts
        WHERE id = ? AND deleted_at IS NULL
      `,
      [childDraftId],
    );
    if (
      !child?.parent_draft_id ||
      !child.parent_line_id ||
      child.published_version_id !== publishedVersionId
    ) {
      throw new Error("Published child draft return context is incomplete.");
    }

    const result = await txn.runAsync(
      `
        UPDATE recipe_draft_lines
        SET source_kind = 'child_recipe_version',
          child_recipe_version_id = ?, child_draft_id = NULL,
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND recipe_draft_id = ?
          AND source_kind IN ('child_draft', 'child_recipe_version')
          AND (child_draft_id = ? OR child_recipe_version_id = ?)
          AND deleted_at IS NULL
      `,
      [
        publishedVersionId,
        timestamp,
        child.parent_line_id,
        child.parent_draft_id,
        childDraftId,
        publishedVersionId,
      ],
    );
    if (result.changes !== 1) {
      throw new Error("Parent draft placeholder could not be resolved.");
    }

    await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET autosave_revision = autosave_revision + 1,
          last_saved_at = ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND lifecycle_status IN ('editing', 'ready')
          AND deleted_at IS NULL
      `,
      [timestamp, timestamp, child.parent_draft_id],
    );
  });
}
