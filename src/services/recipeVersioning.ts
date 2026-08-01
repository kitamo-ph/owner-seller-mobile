import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  loadRecipeVersionGraph,
  publishRecipeVersion as persistRecipeVersion,
  publishRecipeVersionInTransaction as persistRecipeVersionInTransaction,
  type PublishRecipeVersionInput,
  type RecipeLineCostSource,
  type RecipeVersionCostState,
  type RecipeVersionLineRecord,
  type RecipeVersionRecord,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  validateRecipeGraph,
  type RecipeGraphCostState,
  type RecipeGraphLine,
  type RecipeGraphVersion,
} from "@/domain/recipeGraph";
import {
  validateRecipeVersionDraft,
  type RecipeVersionDraft,
  type RecipeVersionValidationContext,
  type VersionDependencySnapshot,
  type VersionCostState,
} from "@/domain/recipeVersioning";

function persistenceCostToDomain(
  state: RecipeVersionCostState,
): RecipeGraphCostState {
  if (
    state === "known" ||
    state === "legacy_zero_unresolved" ||
    state === "not_applicable"
  ) {
    return state;
  }
  return "unknown";
}

function mapPersistedLine(line: RecipeVersionLineRecord): RecipeGraphLine {
  const base = {
    id: line.id,
    label:
      line.sourceLabelSnapshot ??
      line.customName ??
      line.catalogItemId ??
      line.childRecipeVersionId ??
      "Recipe input",
    quantity: line.quantity,
    unit: line.unit,
    canonicalQuantity: line.normalizedQuantity ?? undefined,
    canonicalUnit: line.normalizedUnit ?? undefined,
    role: line.role,
    optional: line.isOptional,
  };
  if (line.sourceKind === "child_recipe_version") {
    return {
      ...base,
      sourceKind: "child_recipe_version",
      childVersionId: line.childRecipeVersionId as string,
    };
  }
  if (line.sourceKind === "custom_cost") {
    return {
      ...base,
      sourceKind: "custom_cost",
      costBasis: "per_recipe_line",
      costState: persistenceCostToDomain(line.costState),
      authoritativeUnitCost:
        line.lineCostSnapshot ?? line.costOverride ?? null,
    };
  }
  return {
    ...base,
    sourceKind: "catalog_item",
    itemId: line.catalogItemId as string,
    costState: persistenceCostToDomain(line.costState),
    authoritativeUnitCost: line.costPerUnitSnapshot,
  };
}

function mapPersistedGraph(
  versions: RecipeVersionRecord[],
  lines: RecipeVersionLineRecord[],
): RecipeGraphVersion[] {
  const linesByVersion = new Map<string, RecipeVersionLineRecord[]>();
  for (const line of lines) {
    const current = linesByVersion.get(line.recipeVersionId);
    if (current) current.push(line);
    else linesByVersion.set(line.recipeVersionId, [line]);
  }
  return versions.map((version) => ({
    id: version.id,
    familyId: version.recipeId,
    outputItemId: version.outputCatalogItemId,
    label: version.name,
    businessId: version.businessId,
    expectedOutputQuantity: version.expectedOutputQuantity,
    outputUnit: version.expectedOutputUnit,
    status: version.status,
    lines: (linesByVersion.get(version.id) ?? []).map(mapPersistedLine),
  }));
}

export async function loadValidatedRecipeGraph(
  rootVersionId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const snapshot = await loadRecipeVersionGraph(rootVersionId, 500, db);
  const versions = mapPersistedGraph(snapshot.versions, snapshot.lines);
  return {
    versions,
    validation: validateRecipeGraph(versions, rootVersionId),
  };
}

async function publicationContext(
  draft: RecipeVersionDraft,
  db: RepositoryDatabase,
): Promise<{
  context: RecipeVersionValidationContext;
  graphState: "complete" | "incomplete";
}> {
  const childInputs = draft.inputs.filter(
    (input) => input.sourceKind === "child_recipe_version",
  );
  if (childInputs.length === 0) {
    return { context: {}, graphState: "complete" };
  }

  const versionsById = new Map<string, RecipeGraphVersion>();
  const dependencies = new Map<string, VersionDependencySnapshot>();
  for (const child of childInputs) {
    const snapshot = await loadRecipeVersionGraph(
      child.childVersionId,
      500,
      db,
    );
    for (const version of mapPersistedGraph(
      snapshot.versions,
      snapshot.lines,
    )) {
      versionsById.set(version.id, version);
      dependencies.set(version.id, {
        versionId: version.id,
        businessId: version.businessId ?? draft.businessId,
        outputCatalogItemId: version.outputItemId,
        status: version.status,
      });
    }
  }

  const proposedId = `draft:${draft.id}`;
  const proposedLines: RecipeGraphLine[] = draft.inputs
    .filter((input) => input.sourceKind !== "unresolved")
    .map((input) => {
      const base = {
        id: input.id,
        label: input.label,
        quantity: input.quantity,
        unit: input.unit,
        canonicalQuantity: input.normalizedQuantity ?? undefined,
        canonicalUnit: input.normalizedUnit ?? undefined,
        role: input.role,
        optional: input.optional,
      };
      if (input.sourceKind === "child_recipe_version") {
        return {
          ...base,
          sourceKind: "child_recipe_version" as const,
          childVersionId: input.childVersionId,
        };
      }
      if (input.sourceKind === "custom_cost") {
        return {
          ...base,
          sourceKind: "custom_cost" as const,
          costBasis: "per_recipe_line" as const,
          costState: input.costState,
          authoritativeUnitCost: input.authoritativeUnitCost,
        };
      }
      return {
        ...base,
        sourceKind: "catalog_item" as const,
        itemId: input.catalogItemId,
        costState: input.costState,
        authoritativeUnitCost: input.authoritativeUnitCost,
      };
    });
  versionsById.set(proposedId, {
    id: proposedId,
    familyId: draft.familyId,
    outputItemId: draft.outputCatalogItemId ?? "",
    label: draft.name,
    businessId: draft.businessId,
    expectedOutputQuantity: draft.expectedOutputQuantity ?? 0,
    outputUnit: draft.outputUnit ?? "",
    status: "published",
    lines: proposedLines,
  });
  const graphValidation = validateRecipeGraph(
    [...versionsById.values()],
    proposedId,
  );
  return {
    context: {
      dependencies,
      graphValidation: graphValidation.ok
        ? { ok: true }
        : {
            ok: false,
            error: {
              code: graphValidation.error.code,
              path: graphValidation.error.path,
            },
          },
    },
    graphState: graphValidation.ok ? "complete" : "incomplete",
  };
}

/**
 * Validates the proposed immutable definition and bounded exact-version graph,
 * then delegates the all-or-nothing insert/pointer advance to the repository.
 */
export type ValidatedRecipeDraftPublicationInput = {
  draft: RecipeVersionDraft;
  versionId?: string;
  outputProductIdSnapshot?: string | null;
  expectedStoredDraftRevision: number;
  role?: "default" | "alternative";
  lineCostEvidence?: Readonly<
    Record<
      string,
      {
        costSource: RecipeLineCostSource;
        costProfileId: string | null;
      }
    >
  >;
};

async function prepareValidatedRecipePublication(
  input: ValidatedRecipeDraftPublicationInput,
  db: RepositoryDatabase,
) {
  if (
    !Number.isInteger(input.expectedStoredDraftRevision) ||
    input.expectedStoredDraftRevision < 0 ||
    input.draft.revision !== input.expectedStoredDraftRevision
  ) {
    throw new Error("Recipe draft revision does not match persisted publication.");
  }
  const { context, graphState } = await publicationContext(input.draft, db);
  const validation = validateRecipeVersionDraft(input.draft, context);
  if (!validation.valid) {
    return { ok: false as const, validation };
  }
  const lines = input.draft.inputs.map((line) => {
    if (line.sourceKind === "unresolved") {
      throw new Error("Validated recipe unexpectedly contains an unresolved line.");
    }
    const costState = line.costState as RecipeVersionCostState;
    return {
      sourceKind: line.sourceKind,
      catalogItemId:
        line.sourceKind === "catalog_item" ? line.catalogItemId : null,
      childRecipeVersionId:
        line.sourceKind === "child_recipe_version"
          ? line.childVersionId
          : null,
      customName: line.sourceKind === "custom_cost" ? line.label : null,
      quantity: line.quantity,
      unit: line.unit,
      normalizedQuantity: line.normalizedQuantity ?? null,
      normalizedUnit: line.normalizedUnit ?? null,
      conversionId: line.conversionId ?? null,
      conversionFactorSnapshot: line.conversionFactorSnapshot ?? null,
      role: line.role,
      isOptional: line.optional,
      costOverride:
        line.sourceKind === "custom_cost"
          ? line.authoritativeUnitCost
          : null,
      costPerUnitSnapshot:
        line.sourceKind === "catalog_item"
          ? line.authoritativeUnitCost
          : null,
      lineCostSnapshot:
        line.costState === "known" &&
        line.authoritativeUnitCost !== null
          ? line.sourceKind === "custom_cost"
            ? line.authoritativeUnitCost
            : line.authoritativeUnitCost * line.quantity
          : null,
      costState,
      costSource: input.lineCostEvidence?.[line.id]?.costSource,
      costProfileId:
        input.lineCostEvidence?.[line.id]?.costProfileId ?? null,
      allocationMode: "none" as const,
      sourceLabelSnapshot: line.label,
    };
  });

  const publication: PublishRecipeVersionInput = {
    id: input.versionId,
    businessId: input.draft.businessId,
    recipeId: input.draft.familyId,
    outputCatalogItemId: input.draft.outputCatalogItemId as string,
    outputProductIdSnapshot: input.outputProductIdSnapshot ?? null,
    name: input.draft.name,
    category: input.draft.category,
    expectedOutputQuantity: input.draft.expectedOutputQuantity as number,
    expectedOutputUnit: input.draft.outputUnit as string,
    productionMode: input.draft.productionMode,
    suggestedSellingPriceSnapshot: input.draft.suggestedSellingPrice,
    sellingPriceState: input.draft.sellingPriceState,
    notes: input.draft.notes,
    sourceKind: input.draft.duplicatedFromVersionId
      ? "duplicate"
      : "native_publish",
    sourceDraftId: input.draft.id,
    duplicatedFromVersionId: input.draft.duplicatedFromVersionId,
    graphState,
    costState: validation.costComplete ? "known" : "partial",
    expectedDraftRevision: input.expectedStoredDraftRevision,
    role:
      input.role === "default"
        ? "primary"
        : input.role === "alternative"
          ? "alternate"
          : undefined,
    lines,
  };
  return { ok: true as const, publication, validation };
}

export async function publishValidatedRecipeDraftInTransaction(
  input: ValidatedRecipeDraftPublicationInput,
  db: RepositoryDatabase,
) {
  const prepared = await prepareValidatedRecipePublication(input, db);
  if (!prepared.ok) return prepared;
  const version = await persistRecipeVersionInTransaction(
    prepared.publication,
    db,
  );
  return {
    ok: true as const,
    version,
    validation: prepared.validation,
  };
}

export async function publishValidatedRecipeDraft(
  input: ValidatedRecipeDraftPublicationInput,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const prepared = await prepareValidatedRecipePublication(input, db);
  if (!prepared.ok) return prepared;
  const version = await persistRecipeVersion(prepared.publication, db);
  return { ok: true as const, version, validation: prepared.validation };
}

export function mapPersistenceCostStateToVersionCost(
  state: RecipeVersionCostState,
): VersionCostState {
  return persistenceCostToDomain(state);
}
