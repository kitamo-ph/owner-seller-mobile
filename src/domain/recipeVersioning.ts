/**
 * Pure contracts for immutable recipe versions.
 *
 * Persistence adapters allocate IDs and write a validated publication inside
 * one exclusive transaction. This module returns new snapshots; it never edits
 * a published version in place and never selects an alternative implicitly.
 */

export type VersionCostState =
  | "known"
  | "unknown"
  | "legacy_zero_unresolved"
  | "not_applicable";

export type VersionInputRole =
  | "main"
  | "supporting"
  | "seasoning"
  | "garnish"
  | "packaging"
  | "optional"
  | "unset";

export type RecipeVersionStatus = "published" | "superseded" | "archived";

type RecipeVersionInputBase = {
  id: string;
  label: string;
  quantity: number;
  unit: string;
  normalizedQuantity?: number | null;
  normalizedUnit?: string | null;
  conversionId?: string | null;
  conversionFactorSnapshot?: number | null;
  role: VersionInputRole;
  optional: boolean;
  costState: VersionCostState;
  authoritativeUnitCost: number | null;
};

export type CatalogVersionInput = RecipeVersionInputBase & {
  sourceKind: "catalog_item";
  catalogItemId: string;
};

export type ChildRecipeVersionInput = RecipeVersionInputBase & {
  sourceKind: "child_recipe_version";
  childVersionId: string;
  childOutputItemId: string;
};

export type CustomCostVersionInput = RecipeVersionInputBase & {
  sourceKind: "custom_cost";
};

export type UnresolvedVersionInput = {
  id: string;
  sourceKind: "unresolved";
  label: string;
  quantity: number | null;
  unit: string | null;
  role: VersionInputRole;
  optional: boolean;
  costState: VersionCostState;
  authoritativeUnitCost: number | null;
};

export type RecipeVersionInput =
  | CatalogVersionInput
  | ChildRecipeVersionInput
  | CustomCostVersionInput;

export type RecipeVersionDraftInput = RecipeVersionInput | UnresolvedVersionInput;

export type RecipeVersionDraft = {
  id: string;
  familyId: string;
  businessId: string;
  basedOnVersionId: string | null;
  duplicatedFromVersionId: string | null;
  name: string;
  category: string | null;
  outputCatalogItemId: string | null;
  expectedOutputQuantity: number | null;
  outputUnit: string | null;
  productionMode: "prepared_before_selling" | "cook_upon_order";
  suggestedSellingPrice: number | null;
  sellingPriceState: VersionCostState;
  requestedReadyForSale: boolean;
  notes: string | null;
  inputs: readonly RecipeVersionDraftInput[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ImmutableRecipeVersion = {
  readonly id: string;
  readonly familyId: string;
  readonly businessId: string;
  readonly versionNumber: number;
  readonly status: RecipeVersionStatus;
  readonly name: string;
  readonly category: string | null;
  readonly outputCatalogItemId: string;
  readonly expectedOutputQuantity: number;
  readonly outputUnit: string;
  readonly productionMode: "prepared_before_selling" | "cook_upon_order";
  readonly suggestedSellingPrice: number | null;
  readonly sellingPriceState: VersionCostState;
  readonly notes: string | null;
  readonly costComplete: boolean;
  readonly sourceDraftId: string;
  readonly basedOnVersionId: string | null;
  readonly duplicatedFromVersionId: string | null;
  readonly createdAt: string;
  readonly effectiveAt: string;
  readonly inputs: readonly Readonly<RecipeVersionInput>[];
};

export type VersionDependencySnapshot = {
  versionId: string;
  businessId: string;
  outputCatalogItemId: string;
  status: RecipeVersionStatus;
};

export type RecipeVersionValidationErrorCode =
  | "missing_name"
  | "missing_output_item"
  | "invalid_expected_output"
  | "missing_output_unit"
  | "missing_inputs"
  | "duplicate_input_id"
  | "unresolved_input"
  | "invalid_input_quantity"
  | "invalid_input_unit"
  | "invalid_unit_conversion"
  | "missing_catalog_item"
  | "missing_child_version"
  | "archived_child_version"
  | "cross_business_child_version"
  | "child_output_mismatch"
  | "invalid_known_cost"
  | "selling_price_required"
  | "graph_validation_required"
  | "graph_validation_failed";

export type RecipeVersionValidationError = {
  code: RecipeVersionValidationErrorCode;
  inputId?: string;
  message: string;
  dependencyPath?: readonly string[];
};

export type RecipeVersionValidationWarning = {
  code: "cost_incomplete" | "selling_price_incomplete";
  inputId?: string;
  message: string;
};

export type RecipeVersionValidationContext = {
  dependencies?: ReadonlyMap<string, VersionDependencySnapshot>;
  graphValidation?: {
    ok: boolean;
    error?: { code: string; path?: readonly string[] };
  };
};

export type RecipeVersionValidationResult = {
  valid: boolean;
  costComplete: boolean;
  errors: readonly RecipeVersionValidationError[];
  warnings: readonly RecipeVersionValidationWarning[];
};

export type PublishRecipeVersionInput = {
  versionId: string;
  versionNumber: number;
  effectiveAt: string;
};

export type PublishRecipeVersionResult =
  | { ok: true; version: ImmutableRecipeVersion }
  | { ok: false; validation: RecipeVersionValidationResult };

export type CatalogItemRecipeRole = {
  outputCatalogItemId: string;
  familyId: string;
  versionId: string;
  role: "default" | "alternative";
  active: boolean;
};

export type DefaultRecipeInvariantResult =
  | { ok: true }
  | {
      ok: false;
      code: "multiple_default_recipes" | "duplicate_recipe_role";
      outputCatalogItemId: string;
      conflictingVersionIds: readonly string[];
    };

export type ResolveProductionVersionResult =
  | {
      ok: true;
      version: ImmutableRecipeVersion;
      selection: "explicit" | "default";
    }
  | {
      ok: false;
      code:
        | "explicit_version_missing"
        | "explicit_version_unavailable"
        | "explicit_output_mismatch"
        | "no_default_recipe"
        | "multiple_default_recipes"
        | "default_version_missing"
        | "default_version_unavailable";
    };

const isPositiveFinite = (value: number | null) =>
  value !== null && Number.isFinite(value) && value > 0;

function isIncompleteCost(state: VersionCostState) {
  return state === "unknown" || state === "legacy_zero_unresolved";
}

function hasValidKnownCost(state: VersionCostState, value: number | null) {
  return (
    state !== "known" ||
    (value !== null && Number.isFinite(value) && value >= 0)
  );
}

function cloneInput(input: RecipeVersionInput): RecipeVersionInput {
  return { ...input };
}

function deepFreezeVersion(version: ImmutableRecipeVersion): ImmutableRecipeVersion {
  for (const input of version.inputs) Object.freeze(input);
  Object.freeze(version.inputs);
  return Object.freeze(version);
}

export function validateRecipeVersionDraft(
  draft: RecipeVersionDraft,
  context: RecipeVersionValidationContext = {},
): RecipeVersionValidationResult {
  const errors: RecipeVersionValidationError[] = [];
  const warnings: RecipeVersionValidationWarning[] = [];

  if (!draft.name.trim()) {
    errors.push({ code: "missing_name", message: "Recipe name is required." });
  }
  if (!draft.outputCatalogItemId?.trim()) {
    errors.push({
      code: "missing_output_item",
      message: "An output catalog item is required.",
    });
  }
  if (!isPositiveFinite(draft.expectedOutputQuantity)) {
    errors.push({
      code: "invalid_expected_output",
      message: "Expected output must be a positive quantity.",
    });
  }
  if (!draft.outputUnit?.trim()) {
    errors.push({
      code: "missing_output_unit",
      message: "Expected output unit is required.",
    });
  }
  if (draft.inputs.length === 0) {
    errors.push({
      code: "missing_inputs",
      message: "At least one recipe input is required.",
    });
  }

  const seenInputIds = new Set<string>();
  let hasChildInput = false;

  for (const input of draft.inputs) {
    if (seenInputIds.has(input.id)) {
      errors.push({
        code: "duplicate_input_id",
        inputId: input.id,
        message: `Input ${input.id} occurs more than once.`,
      });
    }
    seenInputIds.add(input.id);

    if (input.sourceKind === "unresolved") {
      errors.push({
        code: "unresolved_input",
        inputId: input.id,
        message: `${input.label || "Recipe input"} is unresolved.`,
      });
      continue;
    }

    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      errors.push({
        code: "invalid_input_quantity",
        inputId: input.id,
        message: `${input.label} must have a positive quantity.`,
      });
    }
    if (!input.unit.trim()) {
      errors.push({
        code: "invalid_input_unit",
        inputId: input.id,
        message: `${input.label} must have a unit.`,
      });
    }
    const hasConversionEvidence =
      input.conversionId !== undefined ||
      input.conversionFactorSnapshot !== undefined ||
      input.normalizedQuantity !== undefined ||
      input.normalizedUnit !== undefined;
    if (hasConversionEvidence) {
      const conversionFactor = input.conversionFactorSnapshot ?? 1;
      const normalizedQuantity = input.normalizedQuantity;
      const normalizedUnit = input.normalizedUnit?.trim();
      const sameUnitEvidence =
        !input.conversionId &&
        normalizedUnit === input.unit.trim() &&
        normalizedQuantity !== null &&
        normalizedQuantity !== undefined &&
        Number.isFinite(normalizedQuantity) &&
        Math.abs(normalizedQuantity - input.quantity) <= 1e-9 &&
        Number.isFinite(conversionFactor) &&
        Math.abs(conversionFactor - 1) <= 1e-9;
      const convertedEvidence =
        Boolean(input.conversionId?.trim()) &&
        Boolean(normalizedUnit) &&
        normalizedQuantity !== null &&
        normalizedQuantity !== undefined &&
        Number.isFinite(normalizedQuantity) &&
        Number.isFinite(conversionFactor) &&
        conversionFactor > 0 &&
        Math.abs(normalizedQuantity - input.quantity * conversionFactor) <=
          1e-9;
      if (!sameUnitEvidence && !convertedEvidence) {
        errors.push({
          code: "invalid_unit_conversion",
          inputId: input.id,
          message: `${input.label} has inconsistent unit-conversion evidence.`,
        });
      }
    }
    if (!hasValidKnownCost(input.costState, input.authoritativeUnitCost)) {
      errors.push({
        code: "invalid_known_cost",
        inputId: input.id,
        message: `${input.label} is marked known but has no valid cost.`,
      });
    }
    if (isIncompleteCost(input.costState)) {
      warnings.push({
        code: "cost_incomplete",
        inputId: input.id,
        message: `${input.label} has an incomplete cost.`,
      });
    }

    if (input.sourceKind === "catalog_item" && !input.catalogItemId.trim()) {
      errors.push({
        code: "missing_catalog_item",
        inputId: input.id,
        message: `${input.label} has no catalog item.`,
      });
    }

    if (input.sourceKind === "child_recipe_version") {
      hasChildInput = true;
      const dependency = context.dependencies?.get(input.childVersionId);
      if (!dependency) {
        errors.push({
          code: "missing_child_version",
          inputId: input.id,
          message: `${input.label} references an unavailable recipe version.`,
        });
      } else {
        if (dependency.status === "archived" && !input.optional) {
          errors.push({
            code: "archived_child_version",
            inputId: input.id,
            message: `${input.label} references an archived recipe version.`,
          });
        }
        if (dependency.businessId !== draft.businessId) {
          errors.push({
            code: "cross_business_child_version",
            inputId: input.id,
            message: `${input.label} belongs to another business.`,
          });
        }
        if (dependency.outputCatalogItemId !== input.childOutputItemId) {
          errors.push({
            code: "child_output_mismatch",
            inputId: input.id,
            message: `${input.label} does not match the pinned child output.`,
          });
        }
      }
    }
  }

  if (hasChildInput && !context.graphValidation) {
    errors.push({
      code: "graph_validation_required",
      message: "Nested recipe inputs require bounded graph validation.",
    });
  } else if (context.graphValidation && !context.graphValidation.ok) {
    errors.push({
      code: "graph_validation_failed",
      message: `Recipe graph validation failed${
        context.graphValidation.error?.code
          ? `: ${context.graphValidation.error.code}`
          : ""
      }.`,
      dependencyPath: context.graphValidation.error?.path,
    });
  }

  if (draft.requestedReadyForSale) {
    const sellingPriceKnown =
      draft.sellingPriceState === "known" &&
      draft.suggestedSellingPrice !== null &&
      Number.isFinite(draft.suggestedSellingPrice) &&
      draft.suggestedSellingPrice >= 0;
    if (!sellingPriceKnown) {
      errors.push({
        code: "selling_price_required",
        message: "A known selling price is required for sale readiness.",
      });
    }
  } else if (isIncompleteCost(draft.sellingPriceState)) {
    warnings.push({
      code: "selling_price_incomplete",
      message: "Selling price is incomplete but does not block recipe publication.",
    });
  }

  const costComplete = draft.inputs.every(
    (input) =>
      input.optional ||
      (input.sourceKind !== "unresolved" &&
        !isIncompleteCost(input.costState) &&
        hasValidKnownCost(input.costState, input.authoritativeUnitCost)),
  );

  return {
    valid: errors.length === 0,
    costComplete,
    errors,
    warnings,
  };
}

/**
 * Creates an immutable publication snapshot. The caller persists this snapshot
 * and updates active/default pointers in one transaction only after `ok`.
 */
export function publishRecipeVersion(
  draft: RecipeVersionDraft,
  context: RecipeVersionValidationContext,
  publication: PublishRecipeVersionInput,
): PublishRecipeVersionResult {
  const validation = validateRecipeVersionDraft(draft, context);
  if (!validation.valid) return { ok: false, validation };

  if (
    !publication.versionId.trim() ||
    !Number.isInteger(publication.versionNumber) ||
    publication.versionNumber <= 0
  ) {
    return {
      ok: false,
      validation: {
        ...validation,
        valid: false,
        errors: [
          ...validation.errors,
          {
            code: "invalid_expected_output",
            message: "Publication requires a stable version ID and positive version number.",
          },
        ],
      },
    };
  }

  const inputs = draft.inputs.map((input, index) => {
    if (input.sourceKind === "unresolved") {
      throw new Error("Validated publication unexpectedly contains an unresolved input.");
    }
    return cloneInput({ ...input, id: `${publication.versionId}:input:${index + 1}` });
  });

  return {
    ok: true,
    version: deepFreezeVersion({
      id: publication.versionId,
      familyId: draft.familyId,
      businessId: draft.businessId,
      versionNumber: publication.versionNumber,
      status: "published",
      name: draft.name.trim(),
      category: draft.category,
      outputCatalogItemId: draft.outputCatalogItemId as string,
      expectedOutputQuantity: draft.expectedOutputQuantity as number,
      outputUnit: draft.outputUnit as string,
      productionMode: draft.productionMode,
      suggestedSellingPrice: draft.suggestedSellingPrice,
      sellingPriceState: draft.sellingPriceState,
      notes: draft.notes,
      costComplete: validation.costComplete,
      sourceDraftId: draft.id,
      basedOnVersionId: draft.basedOnVersionId,
      duplicatedFromVersionId: draft.duplicatedFromVersionId,
      createdAt: publication.effectiveAt,
      effectiveAt: publication.effectiveAt,
      inputs,
    }),
  };
}

function draftInputsFromVersion(
  version: ImmutableRecipeVersion,
  draftId: string,
): RecipeVersionDraftInput[] {
  return version.inputs.map((input, index) => ({
    ...input,
    id: `${draftId}:input:${index + 1}`,
  }));
}

export function createNextVersionDraft(
  version: ImmutableRecipeVersion,
  input: { draftId: string; now: string },
): RecipeVersionDraft {
  return {
    id: input.draftId,
    familyId: version.familyId,
    businessId: version.businessId,
    basedOnVersionId: version.id,
    duplicatedFromVersionId: null,
    name: version.name,
    category: version.category,
    outputCatalogItemId: version.outputCatalogItemId,
    expectedOutputQuantity: version.expectedOutputQuantity,
    outputUnit: version.outputUnit,
    productionMode: version.productionMode,
    suggestedSellingPrice: version.suggestedSellingPrice,
    sellingPriceState: version.sellingPriceState,
    requestedReadyForSale: false,
    notes: version.notes,
    inputs: draftInputsFromVersion(version, input.draftId),
    revision: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Duplication creates a new family/draft identity and deliberately clears sale
 * readiness. It copies no stock, history, role, or active/Kiosk state.
 */
export function duplicateVersionIntoNewFamily(
  version: ImmutableRecipeVersion,
  input: {
    newFamilyId: string;
    newDraftId: string;
    now: string;
    name?: string;
  },
): RecipeVersionDraft {
  return {
    ...createNextVersionDraft(version, {
      draftId: input.newDraftId,
      now: input.now,
    }),
    familyId: input.newFamilyId,
    basedOnVersionId: null,
    duplicatedFromVersionId: version.id,
    name: input.name ?? `${version.name} copy`,
    requestedReadyForSale: false,
  };
}

export function transitionRecipeVersionStatus(
  version: ImmutableRecipeVersion,
  nextStatus: RecipeVersionStatus,
): ImmutableRecipeVersion {
  if (version.status === nextStatus) return version;
  const allowed =
    (version.status === "published" &&
      (nextStatus === "superseded" || nextStatus === "archived")) ||
    (version.status === "superseded" && nextStatus === "archived");

  if (!allowed) {
    throw new Error(
      `Invalid recipe version status transition: ${version.status} -> ${nextStatus}.`,
    );
  }

  return deepFreezeVersion({
    ...version,
    status: nextStatus,
    inputs: version.inputs.map(cloneInput),
  });
}

export function assessRecipeVersionMutation(
  version: ImmutableRecipeVersion,
  historicalReferenceCount: number,
): {
  mutableInPlace: false;
  action: "create_new_version";
  reason: "published_versions_are_immutable" | "historical_version_is_referenced";
} {
  return {
    mutableInPlace: false,
    action: "create_new_version",
    reason:
      historicalReferenceCount > 0
        ? "historical_version_is_referenced"
        : "published_versions_are_immutable",
  };
}

export function validateDefaultRecipeInvariant(
  roles: readonly CatalogItemRecipeRole[],
): DefaultRecipeInvariantResult {
  const seen = new Set<string>();
  const defaultsByOutput = new Map<string, CatalogItemRecipeRole[]>();

  for (const role of roles) {
    const key = `${role.outputCatalogItemId}\u0000${role.familyId}\u0000${role.versionId}`;
    if (seen.has(key)) {
      return {
        ok: false,
        code: "duplicate_recipe_role",
        outputCatalogItemId: role.outputCatalogItemId,
        conflictingVersionIds: [role.versionId],
      };
    }
    seen.add(key);

    if (role.active && role.role === "default") {
      const current = defaultsByOutput.get(role.outputCatalogItemId);
      if (current) current.push(role);
      else defaultsByOutput.set(role.outputCatalogItemId, [role]);
    }
  }

  for (const [outputCatalogItemId, defaults] of defaultsByOutput) {
    if (defaults.length > 1) {
      return {
        ok: false,
        code: "multiple_default_recipes",
        outputCatalogItemId,
        conflictingVersionIds: defaults.map((role) => role.versionId),
      };
    }
  }

  return { ok: true };
}

export function getExactRecipeVersion(
  versions: readonly ImmutableRecipeVersion[],
  versionId: string,
): ImmutableRecipeVersion | null {
  return versions.find((version) => version.id === versionId) ?? null;
}

/**
 * Explicit alternatives are resolved by exact ID. Without an explicit choice,
 * exactly one active default role must exist for the output item.
 */
export function resolveProductionRecipeVersion(input: {
  outputCatalogItemId: string;
  versions: readonly ImmutableRecipeVersion[];
  roles: readonly CatalogItemRecipeRole[];
  explicitVersionId?: string | null;
}): ResolveProductionVersionResult {
  if (input.explicitVersionId) {
    const explicit = getExactRecipeVersion(input.versions, input.explicitVersionId);
    if (!explicit) return { ok: false, code: "explicit_version_missing" };
    if (explicit.outputCatalogItemId !== input.outputCatalogItemId) {
      return { ok: false, code: "explicit_output_mismatch" };
    }
    if (explicit.status !== "published") {
      return { ok: false, code: "explicit_version_unavailable" };
    }
    return { ok: true, version: explicit, selection: "explicit" };
  }

  const defaults = input.roles.filter(
    (role) =>
      role.outputCatalogItemId === input.outputCatalogItemId &&
      role.active &&
      role.role === "default",
  );
  if (defaults.length === 0) return { ok: false, code: "no_default_recipe" };
  if (defaults.length > 1) {
    return { ok: false, code: "multiple_default_recipes" };
  }

  const version = getExactRecipeVersion(input.versions, defaults[0].versionId);
  if (!version) return { ok: false, code: "default_version_missing" };
  if (version.status !== "published") {
    return { ok: false, code: "default_version_unavailable" };
  }
  return { ok: true, version, selection: "default" };
}
