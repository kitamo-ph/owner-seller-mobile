import type { CatalogClassification } from "@/domain/catalogItems";
import type { CostState } from "@/domain/costState";
import {
  makeRecipeDraftId,
  makeRecipeDraftLineId,
} from "@/domain/ids";
import {
  standardRecipeUnitFactor,
  validateRecipeConversionSnapshotEvidence,
} from "@/domain/recipeConversionChains";

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
import type { RecipeLineCostSource } from "./catalogCostProfiles";

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
  notes: string | null;
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
  conversionChainJson: string | null;
  unitStandardSnapshot: string | null;
  role: RecipeLineRole;
  isOptional: boolean;
  costOverride: number | null;
  costState: RecipeVersionCostState;
  costSource: RecipeLineCostSource;
  costProfileId: string | null;
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
  notes: string | null;
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
  conversion_chain_json: string | null;
  unit_standard_snapshot: string | null;
  role: RecipeLineRole;
  is_optional: number;
  cost_override: number | null;
  cost_state: RecipeVersionCostState;
  cost_source: RecipeLineCostSource;
  cost_profile_id: string | null;
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
  notes?: string | null;
  parentDraftId?: string | null;
  parentLineId?: string | null;
  parentExpectedRevision?: number;
  returnRoute?: string | null;
};

export type BeginNestedRecipeDraftInput = CreateRecipeDraftInput & {
  parentDraftId: string;
  parentLineId: string;
  parentExpectedRevision: number;
  returnRoute: string;
};

export type SaveRecipeDraftLineInput = Omit<
  RecipeDraftLineRecord,
  | "id"
  | "businessId"
  | "recipeDraftId"
  | "sortOrder"
  | "costSource"
  | "costProfileId"
> & {
  id?: string;
  costSource?: RecipeLineCostSource;
  costProfileId?: string | null;
};

export type SaveRecipeDraftInput = {
  draftId: string;
  businessId: string;
  expectedRevision: number;
  nextRevision: number;
  outputCatalogItemId?: string | null;
  name?: string | null;
  category?: string | null;
  notes?: string | null;
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
    notes: row.notes,
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
    conversionChainJson: row.conversion_chain_json,
    unitStandardSnapshot: row.unit_standard_snapshot,
    role: row.role,
    isOptional: toBoolean(row.is_optional),
    costOverride: row.cost_override,
    costState: row.cost_state,
    costSource: row.cost_source,
    costProfileId: row.cost_profile_id,
    allocationMode: row.allocation_mode,
    legacyIngredientLotId: row.legacy_ingredient_lot_id,
    notes: row.notes,
  };
}

function normalizedDraftLineCostSource(
  line: SaveRecipeDraftLineInput,
): RecipeLineCostSource {
  if (line.costSource) return line.costSource;
  if (line.sourceKind === "custom_cost") return "custom";
  if (line.legacyIngredientLotId) return "purchase_lot";
  if (line.costState === "not_applicable") return "not_applicable";
  if (line.costState === "known") return "legacy_snapshot";
  return "unknown";
}

type RecipeLineConversionEvidence = {
  business_id: string;
  catalog_item_id: string;
  from_unit: string;
  to_unit: string;
  factor: number;
};

function standardQuantityFactor(fromUnit: string, toUnit: string) {
  return standardRecipeUnitFactor(fromUnit, toUnit);
}

function quantityFactorFromUsageUnit(
  usageUnit: string,
  evidenceUnit: string,
  conversion: RecipeLineConversionEvidence | null,
) {
  const standardFactor = standardQuantityFactor(usageUnit, evidenceUnit);
  if (standardFactor !== null) return standardFactor;
  if (!conversion) return null;
  const normalizedToEvidence = standardQuantityFactor(
    conversion.to_unit,
    evidenceUnit,
  );
  return normalizedToEvidence === null
    ? null
    : conversion.factor * normalizedToEvidence;
}

function sameCost(left: number, right: number) {
  return (
    Math.abs(left - right) <=
    1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function validateDraftLineConversionSnapshot(
  line: SaveRecipeDraftLineInput,
  index: number,
  expectedOutputUnit?: string | null,
  expectedFactor?: number | null,
) {
  const conversionChainJson = line.conversionChainJson?.trim() || null;
  if (!conversionChainJson) {
    if (line.unitStandardSnapshot?.trim()) {
      throw new Error(
        `Draft line ${index + 1} unit standard has no conversion chain.`,
      );
    }
    return;
  }
  if (!line.unit?.trim()) {
    throw new Error(`Draft line ${index + 1} conversion input is missing.`);
  }
  const validation = validateRecipeConversionSnapshotEvidence({
    conversionChainJson,
    unitStandardSnapshot: line.unitStandardSnapshot,
    expectedInputUnit: line.unit,
    expectedOutputUnit,
    expectedOutputQuantityPerInputUnit: expectedFactor,
  });
  if (!validation.ok) {
    throw new Error(
      `Draft line ${index + 1} conversion snapshot is inconsistent (${validation.reason}).`,
    );
  }
}

function validateDraftLine(line: SaveRecipeDraftLineInput, index: number) {
  const costSource = normalizedDraftLineCostSource(line);
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
  if (
    line.costState === "known" &&
    (line.costOverride === null ||
      line.costOverride === undefined ||
      !Number.isFinite(line.costOverride) ||
      line.costOverride < 0)
  ) {
    throw new Error(
      `Draft line ${index + 1} known cost requires non-negative evidence.`,
    );
  }
  if (
    line.costState !== "known" &&
    line.costOverride !== null &&
    line.costOverride !== undefined
  ) {
    throw new Error(
      `Draft line ${index + 1} incomplete cost cannot carry authoritative evidence.`,
    );
  }
  if (
    (costSource === "owner_estimate" ||
      costSource === "recipe_version") &&
    (!line.costProfileId || line.costState !== "known")
  ) {
    throw new Error(
      `Draft line ${index + 1} ${costSource} cost requires an exact profile and known snapshot.`,
    );
  }
  if (
    line.costProfileId &&
    costSource !== "owner_estimate" &&
    costSource !== "recipe_version"
  ) {
    throw new Error(
      `Draft line ${index + 1} cost profile does not match its provenance.`,
    );
  }
  if (
    (costSource === "owner_estimate" &&
      line.sourceKind !== "catalog_item") ||
    (costSource === "recipe_version" &&
      line.sourceKind !== "child_recipe_version") ||
    (costSource === "custom" && line.sourceKind !== "custom_cost") ||
    (costSource === "purchase_lot" &&
      (line.sourceKind !== "catalog_item" ||
        !line.legacyIngredientLotId)) ||
    (line.legacyIngredientLotId && costSource !== "purchase_lot")
  ) {
    throw new Error(
      `Draft line ${index + 1} cost provenance does not match its source.`,
    );
  }
  validateDraftLineConversionSnapshot(
    line,
    index,
    line.normalizedUnit,
    line.conversionFactorSnapshot,
  );
}

/**
 * Verifies mutable Recipe-first cost evidence against the exact persisted
 * source inside the same transaction that replaces the draft snapshot.
 */
export async function validateRecipeDraftLineCostEvidenceInTransaction(
  line: SaveRecipeDraftLineInput,
  index: number,
  businessId: string,
  db: RepositoryDatabase,
) {
  const costSource = normalizedDraftLineCostSource(line);
  let conversion: RecipeLineConversionEvidence | null = null;
  if (line.conversionId) {
    let conversionCatalogItemId = line.catalogItemId;
    if (line.sourceKind === "child_recipe_version") {
      const child = await db.getFirstAsync<{
        business_id: string;
        output_catalog_item_id: string;
      }>(
        `
          SELECT business_id, output_catalog_item_id
          FROM recipe_versions
          WHERE id = ? AND deleted_at IS NULL
        `,
        [line.childRecipeVersionId as string],
      );
      conversionCatalogItemId =
        child?.business_id === businessId
          ? child.output_catalog_item_id
          : null;
    }
    if (
      (line.sourceKind !== "catalog_item" &&
        line.sourceKind !== "child_recipe_version") ||
      !conversionCatalogItemId ||
      !line.normalizedUnit?.trim() ||
      line.conversionFactorSnapshot === null ||
      line.conversionFactorSnapshot === undefined
    ) {
      throw new Error(`Draft line ${index + 1} conversion is incomplete.`);
    }
    conversion =
      await db.getFirstAsync<RecipeLineConversionEvidence>(
        `
          SELECT business_id, catalog_item_id, from_unit, to_unit, factor
          FROM item_unit_conversions
          WHERE id = ? AND deleted_at IS NULL
        `,
        [line.conversionId],
      );
    if (
      !conversion ||
      conversion.business_id !== businessId ||
      conversion.catalog_item_id !== conversionCatalogItemId ||
      conversion.from_unit !== line.unit?.trim() ||
      conversion.to_unit !== line.normalizedUnit.trim() ||
      !sameCost(conversion.factor, line.conversionFactorSnapshot)
    ) {
      throw new Error(`Draft line ${index + 1} conversion is unavailable.`);
    }
    if (
      line.quantity !== null &&
      line.quantity !== undefined &&
      line.normalizedQuantity !== null &&
      line.normalizedQuantity !== undefined &&
      !sameCost(
        line.normalizedQuantity,
        line.quantity * conversion.factor,
      )
    ) {
      throw new Error(
        `Draft line ${index + 1} conversion quantity is inconsistent.`,
      );
    }
  } else if (
    line.conversionFactorSnapshot !== null &&
    line.conversionFactorSnapshot !== undefined
  ) {
    throw new Error(
      `Draft line ${index + 1} conversion snapshot is not persisted.`,
    );
  }

  if (costSource === "purchase_lot") {
    const legacyLot = await db.getFirstAsync<{
      business_id: string;
      catalog_item_id: string;
      unit: string;
      purchased_quantity: number;
      cost_state: CostState;
      recorded_total_cost: number | null;
      recorded_cost_per_unit: number | null;
    }>(
      `
        SELECT lot.business_id, binding.catalog_item_id, lot.unit,
          lot.purchased_quantity, lot.cost_state, lot.recorded_total_cost,
          lot.recorded_cost_per_unit
        FROM ingredient_lots lot
        INNER JOIN legacy_item_bindings binding
          ON binding.entity_kind = 'ingredient'
          AND binding.legacy_entity_id = lot.ingredient_id
          AND binding.deleted_at IS NULL
        WHERE lot.id = ? AND lot.deleted_at IS NULL
      `,
      [line.legacyIngredientLotId],
    );
    if (
      legacyLot?.business_id !== businessId ||
      legacyLot.catalog_item_id !== line.catalogItemId
    ) {
      throw new Error(
        `Draft line ${index + 1} legacy lot is not an exact item binding.`,
      );
    }
    const usageUnit = line.unit?.trim();
    const quantityFactor = usageUnit
      ? quantityFactorFromUsageUnit(
          usageUnit,
          legacyLot.unit,
          conversion,
        )
      : null;
    validateDraftLineConversionSnapshot(
      line,
      index,
      legacyLot.unit,
      line.conversionChainJson ? (quantityFactor ?? Number.NaN) : null,
    );
    if (legacyLot.cost_state !== "known") {
      if (line.costState === "known" || line.costOverride !== null) {
        throw new Error(
          `Draft line ${index + 1} unknown lot cost must remain unknown.`,
        );
      }
      return;
    }
    if (
      legacyLot.recorded_total_cost === null ||
      legacyLot.recorded_cost_per_unit === null ||
      !Number.isFinite(legacyLot.recorded_total_cost) ||
      !Number.isFinite(legacyLot.recorded_cost_per_unit) ||
      legacyLot.recorded_total_cost < 0 ||
      legacyLot.recorded_cost_per_unit < 0 ||
      !Number.isFinite(legacyLot.purchased_quantity) ||
      legacyLot.purchased_quantity <= 0 ||
      !sameCost(
        legacyLot.recorded_cost_per_unit,
        legacyLot.recorded_total_cost / legacyLot.purchased_quantity,
      )
    ) {
      throw new Error(
        `Draft line ${index + 1} lot cost evidence is inconsistent.`,
      );
    }
    const expectedCost =
      quantityFactor === null
        ? null
        : legacyLot.recorded_cost_per_unit * quantityFactor;
    if (
      line.costState !== "known" ||
      line.costOverride === null ||
      expectedCost === null ||
      !sameCost(line.costOverride, expectedCost)
    ) {
      throw new Error(
        `Draft line ${index + 1} cost does not match its exact lot evidence.`,
      );
    }
    return;
  }

  if (costSource !== "owner_estimate" && costSource !== "recipe_version") {
    if (line.conversionChainJson) {
      if (
        line.sourceKind !== "child_recipe_version" ||
        !line.childRecipeVersionId
      ) {
        throw new Error(
          `Draft line ${index + 1} conversion has no exact source evidence.`,
        );
      }
      const child = await db.getFirstAsync<{
        business_id: string;
        expected_output_unit: string;
      }>(
        `
          SELECT business_id, expected_output_unit
          FROM recipe_versions
          WHERE id = ? AND deleted_at IS NULL
        `,
        [line.childRecipeVersionId],
      );
      const usageUnit = line.unit?.trim();
      const quantityFactor =
        child?.business_id === businessId && usageUnit
          ? quantityFactorFromUsageUnit(
              usageUnit,
              child.expected_output_unit,
              conversion,
            )
          : null;
      if (!child || child.business_id !== businessId) {
        throw new Error(
          `Draft line ${index + 1} conversion source is unavailable.`,
        );
      }
      validateDraftLineConversionSnapshot(
        line,
        index,
        child.expected_output_unit,
        quantityFactor ?? Number.NaN,
      );
    }
    return;
  }
  const profile = await db.getFirstAsync<{
    business_id: string;
    catalog_item_id: string;
    source_kind: "owner_estimate" | "recipe_version";
    source_recipe_version_id: string | null;
    total_cost: number;
    reference_quantity: number;
    reference_unit: string;
  }>(
    `
      SELECT business_id, catalog_item_id, source_kind,
        source_recipe_version_id, total_cost, reference_quantity,
        reference_unit
      FROM catalog_cost_profiles
      WHERE id = ? AND deleted_at IS NULL
    `,
    [line.costProfileId as string],
  );
  if (
    !profile ||
    profile.business_id !== businessId ||
    profile.source_kind !== costSource
  ) {
    throw new Error(
      `Draft line ${index + 1} cost profile is unavailable.`,
    );
  }
  if (
    (costSource === "owner_estimate" &&
      (line.sourceKind !== "catalog_item" ||
        profile.catalog_item_id !== line.catalogItemId ||
        profile.source_recipe_version_id !== null)) ||
    (costSource === "recipe_version" &&
      (line.sourceKind !== "child_recipe_version" ||
        profile.source_recipe_version_id !== line.childRecipeVersionId))
  ) {
    throw new Error(
      `Draft line ${index + 1} cost profile does not match its exact source.`,
    );
  }
  if (costSource === "recipe_version") {
    const child = await db.getFirstAsync<{
      business_id: string;
      output_catalog_item_id: string;
    }>(
      `
        SELECT business_id, output_catalog_item_id
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
      `,
      [line.childRecipeVersionId as string],
    );
    if (
      child?.business_id !== businessId ||
      child.output_catalog_item_id !== profile.catalog_item_id
    ) {
      throw new Error(
        `Draft line ${index + 1} profile is not the pinned child Recipe.`,
      );
    }
  }
  const usageUnit = line.unit?.trim();
  const quantityFactor = usageUnit
    ? quantityFactorFromUsageUnit(
        usageUnit,
        profile.reference_unit,
        conversion,
      )
    : null;
  validateDraftLineConversionSnapshot(
    line,
    index,
    profile.reference_unit,
    line.conversionChainJson ? (quantityFactor ?? Number.NaN) : null,
  );
  const expectedCost =
    quantityFactor === null
      ? null
      : (profile.total_cost / profile.reference_quantity) * quantityFactor;
  if (
    line.costState !== "known" ||
    line.costOverride === null ||
    !Number.isFinite(profile.total_cost) ||
    profile.total_cost < 0 ||
    !Number.isFinite(profile.reference_quantity) ||
    profile.reference_quantity <= 0 ||
    expectedCost === null ||
    !sameCost(line.costOverride, expectedCost)
  ) {
    throw new Error(
      `Draft line ${index + 1} cost does not match its exact profile.`,
    );
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
        conversion_chain_json, unit_standard_snapshot,
        cost_state, cost_source, cost_profile_id, allocation_mode,
        legacy_ingredient_lot_id, notes,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL)
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
      line.conversionChainJson?.trim() || null,
      line.unitStandardSnapshot?.trim() || null,
      line.costState,
      normalizedDraftLineCostSource(line),
      line.costProfileId ?? null,
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
  const hasNestedContext = Boolean(
    input.parentDraftId ||
      input.parentLineId ||
      input.returnRoute ||
      input.parentExpectedRevision !== undefined,
  );
  if (
    hasNestedContext &&
    (!input.parentDraftId ||
      !input.parentLineId ||
      !input.returnRoute?.trim() ||
      !Number.isInteger(input.parentExpectedRevision) ||
      (input.parentExpectedRevision as number) < 0)
  ) {
    throw new Error("Nested Recipe draft return context is incomplete.");
  }
  const nestedContext = hasNestedContext
    ? {
        parentDraftId: input.parentDraftId as string,
        parentLineId: input.parentLineId as string,
        parentExpectedRevision: input.parentExpectedRevision as number,
        returnRoute: (input.returnRoute as string).trim(),
      }
    : null;
  const database = getRepositoryDatabase(db);
  const timestamp = nowIso();
  const draftId = input.id ?? makeRecipeDraftId();

  await database.withExclusiveTransactionAsync(async (txn) => {
    if (input.branchId) {
      const branch = await txn.getFirstAsync<{ business_id: string }>(
        `
          SELECT business_id
          FROM branches
          WHERE id = ? AND deleted_at IS NULL
        `,
        [input.branchId],
      );
      if (branch?.business_id !== input.businessId) {
        throw new Error("Recipe draft Branch belongs to another business.");
      }
    }

    const recipe = input.recipeId
      ? await txn.getFirstAsync<{
          business_id: string;
          output_product_id: string;
        }>(
          `
            SELECT business_id, output_product_id
            FROM recipes
            WHERE id = ? AND deleted_at IS NULL
          `,
          [input.recipeId],
        )
      : null;
    if (input.recipeId && recipe?.business_id !== input.businessId) {
      throw new Error("Recipe draft family belongs to another business.");
    }

    const sourceVersion = input.sourceVersionId
      ? await txn.getFirstAsync<{
          business_id: string;
          recipe_id: string;
          output_catalog_item_id: string;
          status: string;
        }>(
          `
            SELECT business_id, recipe_id, output_catalog_item_id, status
            FROM recipe_versions
            WHERE id = ? AND deleted_at IS NULL
          `,
          [input.sourceVersionId],
        )
      : null;
    if (
      input.sourceVersionId &&
      (!sourceVersion ||
        sourceVersion.business_id !== input.businessId ||
        sourceVersion.status === "archived" ||
        (input.recipeId && sourceVersion.recipe_id !== input.recipeId) ||
        (input.outputCatalogItemId &&
          sourceVersion.output_catalog_item_id !==
            input.outputCatalogItemId))
    ) {
      throw new Error("Recipe draft source version is unavailable.");
    }

    if (input.outputCatalogItemId) {
      const output = await txn.getFirstAsync<{ business_id: string }>(
        `
          SELECT business_id
          FROM catalog_items
          WHERE id = ? AND lifecycle_status <> 'archived'
            AND deleted_at IS NULL
        `,
        [input.outputCatalogItemId],
      );
      if (output?.business_id !== input.businessId) {
        throw new Error("Recipe draft output item is unavailable.");
      }
      if (recipe) {
        const exactBinding = await txn.getFirstAsync<{ id: string }>(
          `
            SELECT id
            FROM legacy_item_bindings
            WHERE catalog_item_id = ? AND entity_kind = 'product'
              AND legacy_entity_id = ? AND binding_status = 'active'
              AND deleted_at IS NULL
          `,
          [input.outputCatalogItemId, recipe.output_product_id],
        );
        if (!exactBinding) {
          throw new Error(
            "Recipe draft output is not the family's exact Product binding.",
          );
        }
      }
    }

    if (nestedContext) {
      const parent = await txn.getFirstAsync<{
        business_id: string;
        lifecycle_status: RecipeDraftLifecycle;
        autosave_revision: number;
      }>(
        `
          SELECT business_id, lifecycle_status, autosave_revision
          FROM recipe_drafts
          WHERE id = ? AND deleted_at IS NULL
        `,
        [nestedContext.parentDraftId],
      );
      const parentLine = await txn.getFirstAsync<{
        source_kind: RecipeDraftLineSource;
        catalog_item_id: string | null;
        child_recipe_version_id: string | null;
        child_draft_id: string | null;
      }>(
        `
          SELECT source_kind, catalog_item_id, child_recipe_version_id,
            child_draft_id
          FROM recipe_draft_lines
          WHERE id = ? AND recipe_draft_id = ? AND deleted_at IS NULL
        `,
        [nestedContext.parentLineId, nestedContext.parentDraftId],
      );
      if (
        parent?.business_id !== input.businessId ||
        !["editing", "ready"].includes(parent.lifecycle_status) ||
        parent.autosave_revision !== nestedContext.parentExpectedRevision ||
        !parentLine ||
        parentLine.source_kind !== "unresolved" ||
        parentLine.catalog_item_id !== null ||
        parentLine.child_recipe_version_id !== null ||
        parentLine.child_draft_id !== null
      ) {
        throw new Error("Nested Recipe draft parent is unavailable.");
      }
    }

    await txn.runAsync(
      `
        INSERT INTO recipe_drafts (
          id, business_id, branch_id, recipe_id, source_version_id,
          output_catalog_item_id, name, category, notes,
          expected_output_quantity,
          expected_output_unit, production_mode, suggested_selling_price,
          classification_proposal, selling_price_state, sellable, kiosk_enabled,
          editor_step, lifecycle_status, autosave_revision, last_saved_at,
          unresolved_requirement_count, parent_draft_id, parent_line_id,
          return_route, published_version_id, created_at, updated_at, sync_status,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, 'unknown', 0, 0, 'definition', 'editing', 0, ?, 0, ?, ?, ?, NULL, ?, ?, 'local', NULL)
      `,
      [
        draftId,
        input.businessId,
        input.branchId ?? null,
        input.recipeId ?? null,
        input.sourceVersionId ?? null,
        input.outputCatalogItemId ?? null,
        input.name?.trim() || null,
        input.notes?.trim() || null,
        timestamp,
        nestedContext?.parentDraftId ?? null,
        nestedContext?.parentLineId ?? null,
        nestedContext?.returnRoute ?? null,
        timestamp,
        timestamp,
      ],
    );

    if (nestedContext) {
      const lineResult = await txn.runAsync(
        `
          UPDATE recipe_draft_lines
          SET source_kind = 'child_draft', catalog_item_id = NULL,
            child_recipe_version_id = NULL, child_draft_id = ?,
            updated_at = ?, sync_status = 'local'
          WHERE id = ? AND recipe_draft_id = ?
            AND source_kind = 'unresolved' AND catalog_item_id IS NULL
            AND child_recipe_version_id IS NULL AND child_draft_id IS NULL
            AND deleted_at IS NULL
        `,
        [
          draftId,
          timestamp,
          nestedContext.parentLineId,
          nestedContext.parentDraftId,
        ],
      );
      if (lineResult.changes !== 1) {
        throw new Error("Nested Recipe draft placeholder changed before save.");
      }

      const parentResult = await txn.runAsync(
        `
          UPDATE recipe_drafts
          SET autosave_revision = autosave_revision + 1,
            last_saved_at = ?, updated_at = ?, sync_status = 'local'
          WHERE id = ? AND business_id = ? AND autosave_revision = ?
            AND lifecycle_status IN ('editing', 'ready')
            AND deleted_at IS NULL
        `,
        [
          timestamp,
          timestamp,
          nestedContext.parentDraftId,
          input.businessId,
          nestedContext.parentExpectedRevision,
        ],
      );
      if (parentResult.changes !== 1) {
        throw new Error("Parent Recipe draft changed before nested save.");
      }
    }
  });

  const draft = await getRecipeDraftById(draftId, database);
  if (!draft) throw new Error("Could not load the created recipe draft.");
  return draft;
}

export async function beginNestedRecipeDraft(
  input: BeginNestedRecipeDraftInput,
  db?: RepositoryDatabase,
) {
  return createRecipeDraft(input, db);
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
 * Persists an explicit discard without deleting evidence. Referenced,
 * published, or stale drafts fail closed so a later owner workflow cannot
 * strand nested-return or immutable-version provenance.
 */
export async function abandonUnusedRecipeDraft(
  input: {
    draftId: string;
    businessId: string;
    expectedRevision: number;
  },
  db?: RepositoryDatabase,
) {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("Recipe draft discard requires a valid revision.");
  }
  const database = getRepositoryDatabase(db);
  await database.withExclusiveTransactionAsync(async (txn) => {
    const draft = await txn.getFirstAsync<{
      lifecycle_status: RecipeDraftLifecycle;
      autosave_revision: number;
      published_version_id: string | null;
    }>(
      `
        SELECT lifecycle_status, autosave_revision, published_version_id
        FROM recipe_drafts
        WHERE id = ? AND business_id = ? AND deleted_at IS NULL
      `,
      [input.draftId, input.businessId],
    );
    if (!draft) throw new Error("Recipe draft is unavailable.");
    if (draft.lifecycle_status === "abandoned") return;
    if (
      !["editing", "ready"].includes(draft.lifecycle_status) ||
      draft.published_version_id ||
      draft.autosave_revision !== input.expectedRevision
    ) {
      throw new Error("Recipe draft is not eligible for discard.");
    }

    const references = await txn.getFirstAsync<{ count: number }>(
      `
        SELECT (
          SELECT COUNT(*)
          FROM recipe_draft_lines
          WHERE child_draft_id = ? AND deleted_at IS NULL
        ) + (
          SELECT COUNT(*)
          FROM recipe_drafts
          WHERE parent_draft_id = ? AND deleted_at IS NULL
        ) + (
          SELECT COUNT(*)
          FROM recipe_versions
          WHERE source_draft_id = ? AND deleted_at IS NULL
        ) AS count
      `,
      [input.draftId, input.draftId, input.draftId],
    );
    if (!references || references.count !== 0) {
      throw new Error("Referenced Recipe draft must be retained.");
    }

    const timestamp = nowIso();
    const result = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET lifecycle_status = 'abandoned',
          autosave_revision = autosave_revision + 1,
          last_saved_at = ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND business_id = ? AND autosave_revision = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND published_version_id IS NULL AND deleted_at IS NULL
      `,
      [
        timestamp,
        timestamp,
        input.draftId,
        input.businessId,
        input.expectedRevision,
      ],
    );
    if (result.changes !== 1) {
      throw new Error("Recipe draft changed before discard.");
    }
  });

  const discarded = await getRecipeDraftById(input.draftId, database);
  if (!discarded) throw new Error("Discarded Recipe draft is unavailable.");
  return discarded;
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
    const storedDraft = await txn.getFirstAsync<{
      recipe_id: string | null;
      output_catalog_item_id: string | null;
    }>(
      `
        SELECT recipe_id, output_catalog_item_id
        FROM recipe_drafts
        WHERE id = ? AND business_id = ?
          AND autosave_revision = ?
          AND lifecycle_status IN ('editing', 'ready')
          AND deleted_at IS NULL
      `,
      [input.draftId, input.businessId, input.expectedRevision],
    );
    if (!storedDraft) {
      throw new Error("Recipe draft changed before autosave.");
    }

    const outputCatalogItemId =
      input.outputCatalogItemId === undefined
        ? storedDraft.output_catalog_item_id
        : input.outputCatalogItemId;
    if (outputCatalogItemId) {
      const output = await txn.getFirstAsync<{ business_id: string }>(
        `
          SELECT business_id
          FROM catalog_items
          WHERE id = ? AND lifecycle_status <> 'archived'
            AND deleted_at IS NULL
        `,
        [outputCatalogItemId],
      );
      if (output?.business_id !== input.businessId) {
        throw new Error("Recipe draft output item is unavailable.");
      }
      if (storedDraft.recipe_id) {
        const exactOutput = await txn.getFirstAsync<{ id: string }>(
          `
            SELECT recipe.id
            FROM recipes recipe
            INNER JOIN legacy_item_bindings binding
              ON binding.entity_kind = 'product'
              AND binding.legacy_entity_id = recipe.output_product_id
              AND binding.catalog_item_id = ?
              AND binding.binding_status = 'active'
              AND binding.deleted_at IS NULL
            WHERE recipe.id = ? AND recipe.business_id = ?
              AND recipe.deleted_at IS NULL
          `,
          [
            outputCatalogItemId,
            storedDraft.recipe_id,
            input.businessId,
          ],
        );
        if (!exactOutput) {
          throw new Error(
            "Recipe draft output is not the family's exact Product binding.",
          );
        }
      }
    }

    for (const [index, line] of input.lines.entries()) {
      if (line.sourceKind === "catalog_item") {
        const item = await txn.getFirstAsync<{ business_id: string }>(
          `
            SELECT business_id
            FROM catalog_items
            WHERE id = ? AND lifecycle_status <> 'archived'
              AND deleted_at IS NULL
          `,
          [line.catalogItemId ?? null],
        );
        if (item?.business_id !== input.businessId) {
          throw new Error(`Draft line ${index + 1} catalog item is unavailable.`);
        }
      }
      if (line.sourceKind === "child_recipe_version") {
        const child = await txn.getFirstAsync<{
          business_id: string;
          status: string;
        }>(
          `
            SELECT business_id, status
            FROM recipe_versions
            WHERE id = ? AND deleted_at IS NULL
          `,
          [line.childRecipeVersionId ?? null],
        );
        if (
          child?.business_id !== input.businessId ||
          child.status === "archived"
        ) {
          throw new Error(`Draft line ${index + 1} child version is unavailable.`);
        }
      }
      if (line.sourceKind === "child_draft") {
        const child = await txn.getFirstAsync<{
          business_id: string;
          lifecycle_status: RecipeDraftLifecycle;
        }>(
          `
            SELECT business_id, lifecycle_status
            FROM recipe_drafts
            WHERE id = ? AND deleted_at IS NULL
          `,
          [line.childDraftId ?? null],
        );
        if (
          child?.business_id !== input.businessId ||
          !["editing", "ready"].includes(child.lifecycle_status)
        ) {
          throw new Error(`Draft line ${index + 1} child draft is unavailable.`);
        }
      }
      await validateRecipeDraftLineCostEvidenceInTransaction(
        line,
        index,
        input.businessId,
        txn,
      );
    }

    const result = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET output_catalog_item_id = COALESCE(?, output_catalog_item_id),
          name = ?, category = ?, notes = ?, expected_output_quantity = ?,
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
        input.notes?.trim() || null,
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
      business_id: string;
      parent_draft_id: string | null;
      parent_line_id: string | null;
      published_version_id: string | null;
    }>(
      `
        SELECT business_id, parent_draft_id, parent_line_id,
          published_version_id
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

    const publishedVersion = await txn.getFirstAsync<{
      business_id: string;
    }>(
      `
        SELECT business_id
        FROM recipe_versions
        WHERE id = ? AND deleted_at IS NULL
      `,
      [publishedVersionId],
    );
    if (publishedVersion?.business_id !== child.business_id) {
      throw new Error("Published child version belongs to another business.");
    }

    const parent = await txn.getFirstAsync<{
      business_id: string;
      lifecycle_status: RecipeDraftLifecycle;
      autosave_revision: number;
    }>(
      `
        SELECT business_id, lifecycle_status, autosave_revision
        FROM recipe_drafts
        WHERE id = ? AND deleted_at IS NULL
      `,
      [child.parent_draft_id],
    );
    const parentLine = await txn.getFirstAsync<{
      source_kind: RecipeDraftLineSource;
      child_draft_id: string | null;
      child_recipe_version_id: string | null;
    }>(
      `
        SELECT source_kind, child_draft_id, child_recipe_version_id
        FROM recipe_draft_lines
        WHERE id = ? AND recipe_draft_id = ? AND deleted_at IS NULL
      `,
      [child.parent_line_id, child.parent_draft_id],
    );
    if (!parent || parent.business_id !== child.business_id || !parentLine) {
      throw new Error("Parent draft return context is unavailable.");
    }
    if (
      parentLine.source_kind === "child_recipe_version" &&
      parentLine.child_draft_id === null &&
      parentLine.child_recipe_version_id === publishedVersionId
    ) {
      return;
    }
    if (
      !["editing", "ready"].includes(parent.lifecycle_status) ||
      parentLine.source_kind !== "child_draft" ||
      parentLine.child_draft_id !== childDraftId ||
      parentLine.child_recipe_version_id !== null
    ) {
      throw new Error("Parent draft is no longer eligible for nested return.");
    }

    const result = await txn.runAsync(
      `
        UPDATE recipe_draft_lines
        SET source_kind = 'child_recipe_version',
          child_recipe_version_id = ?, child_draft_id = NULL,
          updated_at = ?, sync_status = 'local'
        WHERE id = ? AND recipe_draft_id = ?
          AND source_kind = 'child_draft' AND child_draft_id = ?
          AND child_recipe_version_id IS NULL
          AND deleted_at IS NULL
      `,
      [
        publishedVersionId,
        timestamp,
        child.parent_line_id,
        child.parent_draft_id,
        childDraftId,
      ],
    );
    if (result.changes !== 1) {
      throw new Error("Parent draft placeholder could not be resolved.");
    }

    const parentResult = await txn.runAsync(
      `
        UPDATE recipe_drafts
        SET autosave_revision = autosave_revision + 1,
          last_saved_at = ?, updated_at = ?, sync_status = 'local'
        WHERE id = ? AND lifecycle_status IN ('editing', 'ready')
          AND autosave_revision = ?
          AND deleted_at IS NULL
      `,
      [
        timestamp,
        timestamp,
        child.parent_draft_id,
        parent.autosave_revision,
      ],
    );
    if (parentResult.changes !== 1) {
      throw new Error("Parent draft changed before nested return.");
    }
  });
}
