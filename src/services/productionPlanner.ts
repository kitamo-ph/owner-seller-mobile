import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  loadRecipeVersionGraph,
  saveProductionPlan,
  type ProductionRequirementKind,
  type RecipeVersionCostState,
  type RecipeVersionLineRecord,
  type RecipeVersionRecord,
  type RepositoryDatabase,
  type SaveProductionPlanAllocationInput,
  type SaveProductionPlanStageInput,
} from "@/db/repositories";
import {
  calculateProductionPlan,
  partitionProductionPlanLotAllocations,
  type ProductionPlanLotAllocation,
  type ProductionPlan,
  type ProductionPlannerInput,
  type ProductionPlannerResult,
} from "@/domain/productionPlanner";
import type {
  RecipeGraphCostState,
  RecipeGraphErrorCode,
  RecipeGraphLine,
  RecipeGraphVersion,
} from "@/domain/recipeGraph";
import { validateRecipeGraph } from "@/domain/recipeGraph";
import { loadOwnerSetupStatus } from "./ownerSetup";

export type NativeProductionReadinessEntry = {
  recipeId: string;
  versionId: string;
  catalogItemId: string;
  productId: string | null;
  name: string;
  classification: "finished_product" | "prepared_base";
  expectedOutputQuantity: number;
  expectedOutputUnit: string;
  kind: "finished_per_unit" | "prepared_batch" | "nested" | "blocked";
  status:
    | "ready_for_planning"
    | "staged_execution_deferred"
    | "blocked";
  costStatus: "actual" | "estimated" | "incomplete" | "no_price" | null;
  missingRequirements: string[];
};

function safeRecipeGraphRequirement(code: RecipeGraphErrorCode): string {
  if (
    code === "exact_version_cycle" ||
    code === "recipe_family_cycle" ||
    code === "output_item_cycle"
  ) {
    return "A Recipe dependency cycle must be resolved.";
  }
  if (
    code === "incompatible_child_unit" ||
    code === "missing_conversion_snapshot"
  ) {
    return "A Recipe input needs compatible unit or conversion evidence.";
  }
  if (code === "archived_dependency") {
    return "A pinned prepared Recipe dependency is archived.";
  }
  if (code === "cross_business_dependency") {
    return "A Recipe dependency is unavailable in this business.";
  }
  if (
    code === "node_limit_exceeded" ||
    code === "edge_limit_exceeded" ||
    code === "depth_limit_exceeded" ||
    code === "provenance_limit_exceeded"
  ) {
    return "The Recipe dependency graph exceeds safe planning limits.";
  }
  if (code === "invalid_cost") {
    return "A Recipe input has invalid cost evidence.";
  }
  return "Recipe dependency information needs review.";
}

function persistenceCostToGraph(
  state: RecipeVersionCostState,
): RecipeGraphCostState {
  return state === "known" ||
    state === "legacy_zero_unresolved" ||
    state === "not_applicable"
    ? state
    : "unknown";
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
      costState: persistenceCostToGraph(line.costState),
      authoritativeUnitCost:
        line.lineCostSnapshot ?? line.costOverride ?? null,
    };
  }
  return {
    ...base,
    sourceKind: "catalog_item",
    itemId: line.catalogItemId as string,
    costState: persistenceCostToGraph(line.costState),
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

/**
 * Read-only compatibility bridge for native immutable Recipe versions.
 * Entries returned here are deliberately separate from the legacy flat
 * production executor and this function performs no writes or reservations.
 */
export async function loadNativeProductionReadiness(
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<NativeProductionReadinessEntry[]> {
  await runMigrations(db);
  const owner = await loadOwnerSetupStatus(db);
  if (!owner.activeBusiness) return [];
  const rows = await db.getAllAsync<{
    recipe_id: string;
    version_id: string;
    catalog_item_id: string;
    product_id: string | null;
    name: string;
    classification: "finished_product" | "prepared_base";
    expected_output_quantity: number;
    expected_output_unit: string;
    graph_state: "complete" | "incomplete" | "legacy_review";
    version_cost_state: RecipeVersionCostState;
    cost_status: NativeProductionReadinessEntry["costStatus"];
  }>(
    `
      SELECT recipe.id AS recipe_id, version.id AS version_id,
        item.id AS catalog_item_id,
        product_projection.id AS product_id,
        version.name_snapshot AS name, item.classification,
        version.expected_output_quantity, version.expected_output_unit,
        version.graph_state, version.cost_state AS version_cost_state,
        summary.status AS cost_status
      FROM recipes recipe
      INNER JOIN recipe_versions version
        ON version.id = recipe.active_version_id
        AND version.business_id = recipe.business_id
        AND version.status = 'published'
        AND version.deleted_at IS NULL
      INNER JOIN catalog_items item
        ON item.id = version.output_catalog_item_id
        AND item.business_id = recipe.business_id
        AND item.source_type = 'native'
        AND item.classification IN ('finished_product', 'prepared_base')
        AND item.lifecycle_status <> 'archived'
        AND item.deleted_at IS NULL
      LEFT JOIN legacy_item_bindings product_binding
        ON product_binding.catalog_item_id = item.id
        AND product_binding.business_id = recipe.business_id
        AND product_binding.entity_kind = 'product'
        AND product_binding.binding_status = 'active'
        AND product_binding.deleted_at IS NULL
      LEFT JOIN products product_projection
        ON product_projection.id = product_binding.legacy_entity_id
        AND product_projection.business_id = recipe.business_id
        AND product_projection.active = 1
        AND product_projection.deleted_at IS NULL
        AND (
          product_projection.branch_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM branches product_branch
            WHERE product_branch.id = product_projection.branch_id
              AND product_branch.business_id = recipe.business_id
              AND product_branch.active = 1
              AND product_branch.deleted_at IS NULL
          )
        )
      LEFT JOIN recipe_version_cost_summaries summary
        ON summary.recipe_version_id = version.id
        AND summary.deleted_at IS NULL
      WHERE recipe.business_id = ? AND recipe.is_active = 1
        AND recipe.deleted_at IS NULL
      ORDER BY version.name_snapshot COLLATE NOCASE ASC, version.id ASC
    `,
    [owner.activeBusiness.id],
  );

  return Promise.all(
    rows.map(async (row): Promise<NativeProductionReadinessEntry> => {
      let snapshot: Awaited<ReturnType<typeof loadRecipeVersionGraph>>;
      try {
        snapshot = await loadRecipeVersionGraph(row.version_id, 500, db);
      } catch {
        return {
          recipeId: row.recipe_id,
          versionId: row.version_id,
          catalogItemId: row.catalog_item_id,
          productId: row.product_id,
          name: row.name,
          classification: row.classification,
          expectedOutputQuantity: row.expected_output_quantity,
          expectedOutputUnit: row.expected_output_unit,
          kind: "blocked",
          status: "blocked",
          costStatus: row.cost_status,
          missingRequirements: [
            "Recipe dependency information could not be loaded safely.",
          ],
        };
      }
      const versions = mapPersistedGraph(snapshot.versions, snapshot.lines);
      const validation = validateRecipeGraph(versions, row.version_id);
      const rootLines = snapshot.lines.filter(
        (line) => line.recipeVersionId === row.version_id,
      );
      const nested = snapshot.lines.some(
        (line) => line.sourceKind === "child_recipe_version",
      );
      const missingRequirements: string[] = [];
      if (!validation.ok) {
        missingRequirements.push(
          safeRecipeGraphRequirement(validation.error.code),
        );
      }
      if (row.graph_state !== "complete") {
        missingRequirements.push("Recipe graph needs review.");
      }
      if (rootLines.length === 0) {
        missingRequirements.push("Published Recipe has no input lines.");
      }
      const missingProductProjection = !row.product_id;
      if (missingProductProjection) {
        missingRequirements.push(
          "Recipe has no active Paninda Product projection.",
        );
      }
      const costIncomplete =
        row.cost_status === "incomplete" ||
        row.cost_status === "no_price" ||
        row.cost_status === null ||
        row.version_cost_state === "unknown" ||
        row.version_cost_state === "partial" ||
        row.version_cost_state === "legacy_zero_unresolved" ||
        row.version_cost_state === "legacy_review";
      if (costIncomplete) {
        missingRequirements.push(
          "Cost is incomplete; no profit or production cost will be fabricated.",
        );
      }
      const graphBlocked =
        !validation.ok ||
        row.graph_state !== "complete" ||
        rootLines.length === 0 ||
        missingProductProjection;
      const executionBlocked = graphBlocked || costIncomplete;
      return {
        recipeId: row.recipe_id,
        versionId: row.version_id,
        catalogItemId: row.catalog_item_id,
        productId: row.product_id,
        name: row.name,
        classification: row.classification,
        expectedOutputQuantity: row.expected_output_quantity,
        expectedOutputUnit: row.expected_output_unit,
        kind: graphBlocked
          ? "blocked"
          : nested
            ? "nested"
            : row.classification === "prepared_base"
              ? "prepared_batch"
              : "finished_per_unit",
        status: executionBlocked
          ? "blocked"
          : nested
            ? "staged_execution_deferred"
            : "ready_for_planning",
        costStatus: row.cost_status,
        missingRequirements,
      };
    }),
  );
}

function aggregateCostState(
  states: readonly RecipeGraphCostState[],
): ProductionPlan["costState"] {
  const applicable = states.filter((state) => state !== "not_applicable");
  if (applicable.length === 0) return "not_applicable";
  const hasKnown = applicable.includes("known");
  const hasUnknown = applicable.includes("unknown");
  const hasLegacy = applicable.includes("legacy_zero_unresolved");
  if (!hasUnknown && !hasLegacy) return "known";
  if (hasKnown) return "partial";
  return hasUnknown ? "unknown" : "legacy_zero_unresolved";
}

function lineExpectedCost(line: RecipeGraphLine, quantity: number) {
  if (line.sourceKind === "child_recipe_version") return 0;
  if (line.costState !== "known") return 0;
  if (
    line.authoritativeUnitCost === null ||
    line.authoritativeUnitCost === undefined
  ) {
    throw new Error("Published Recipe line has incomplete known-cost evidence.");
  }
  if (
    line.sourceKind === "custom_cost" &&
    (line.costBasis ?? "per_recipe_line") === "per_recipe_line"
  ) {
    const configuredQuantity = line.canonicalQuantity ?? line.quantity;
    return (quantity / configuredQuantity) * line.authoritativeUnitCost;
  }
  return quantity * line.authoritativeUnitCost;
}

function assertExactStockEvidence(planner: ProductionPlannerInput) {
  const seen = new Set<string>();
  for (const stock of [...planner.preparedStock, ...planner.rawStock]) {
    if (stock.quantity <= 0) continue;
    if (
      !stock.lotKind ||
      !stock.lotId?.trim() ||
      !stock.allocationMode ||
      stock.costState === undefined
    ) {
      throw new Error(
        "Persisted production plans require exact lot, allocation, and cost evidence.",
      );
    }
    const key = `${stock.lotKind}:${stock.lotId.trim()}`;
    if (seen.has(key)) {
      throw new Error("A stock lot occurs more than once in the plan snapshot.");
    }
    seen.add(key);
  }
}

async function catalogRequirementKinds(
  businessId: string,
  itemIds: string[],
  db: RepositoryDatabase,
) {
  const unique = [...new Set(itemIds.filter(Boolean))];
  if (unique.length === 0) return new Map<string, ProductionRequirementKind>();
  const rows = await db.getAllAsync<{
    id: string;
    classification: string;
  }>(
    `
      SELECT id, classification
      FROM catalog_items
      WHERE business_id = ?
        AND id IN (${unique.map(() => "?").join(", ")})
        AND deleted_at IS NULL
    `,
    [businessId, ...unique],
  );
  if (rows.length !== unique.length) {
    throw new Error("Production plan contains unavailable catalog items.");
  }
  return new Map(
    rows.map((row) => [
      row.id,
      row.classification === "supply_packaging"
        ? ("supply" as const)
        : row.classification === "prepared_base" ||
            row.classification === "finished_product"
          ? ("prepared_product" as const)
          : ("ingredient" as const),
    ]),
  );
}

function mapAllocation(
  allocation: ProductionPlanLotAllocation,
): SaveProductionPlanAllocationInput {
  return {
    lotKind: allocation.lotKind,
    ingredientLotId:
      allocation.lotKind === "ingredient" ? allocation.lotId : null,
    productStockLotId:
      allocation.lotKind === "product" ? allocation.lotId : null,
    allocationMode: allocation.allocationMode,
    quantity: allocation.quantity,
    unit: allocation.unit,
    normalizedQuantity: allocation.normalizedQuantity,
    normalizedUnit: allocation.normalizedUnit,
    conversionId: allocation.conversionId,
    conversionFactorSnapshot: allocation.conversionFactorSnapshot,
    unitCostSnapshot: allocation.unitCostSnapshot,
    costContribution:
      allocation.costContribution === null
        ? null
        : allocation.costContribution,
    costState: allocation.costState,
    selectionState:
      allocation.allocationMode === "manual" ? "manual" : "recommended",
  };
}

async function mapPlanForPersistence(
  businessId: string,
  plan: ProductionPlan,
  input: ProductionPlannerInput,
  db: RepositoryDatabase,
) {
  const stageByVersion = new Map(
    plan.stages.map((stage) => [stage.versionId, stage]),
  );
  const parentKeyByChild = new Map<string, string>();
  for (const parent of plan.stages) {
    for (const dependency of parent.dependencies) {
      if (!parentKeyByChild.has(dependency.childVersionId)) {
        parentKeyByChild.set(dependency.childVersionId, parent.id);
      }
    }
  }
  const versionById = new Map(
    input.versions.map((version) => [version.id, version]),
  );
  const kinds = await catalogRequirementKinds(
    businessId,
    [
      ...plan.rawRequirements.map((requirement) => requirement.itemId),
      ...plan.preparedStockUses.map((usage) => usage.itemId),
    ]
      .filter((id): id is string => id !== null),
    db,
  );
  const requirementsByStage = new Map<
    string,
    SaveProductionPlanStageInput["requirements"]
  >();

  for (const requirement of plan.rawRequirements) {
    const grouped = new Map<
      string,
      typeof requirement.provenance extends readonly (infer Entry)[]
        ? Entry[]
        : never
    >();
    for (const provenance of requirement.provenance) {
      const entries = grouped.get(provenance.versionId);
      if (entries) entries.push(provenance);
      else grouped.set(provenance.versionId, [provenance]);
    }
    const groupedEntries = [...grouped.entries()];
    const allocationPartitions = partitionProductionPlanLotAllocations(
      requirement.allocations,
      groupedEntries.map(([, provenance]) =>
        provenance.reduce((sum, entry) => sum + entry.quantity, 0),
      ),
    );
    for (const [
      groupIndex,
      [versionId, provenance],
    ] of groupedEntries.entries()) {
      const stage = stageByVersion.get(versionId);
      const version = versionById.get(versionId);
      if (!stage || !version) {
        throw new Error("Requirement provenance has no pinned production stage.");
      }
      const groupQuantity = provenance.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      );
      const lines = provenance.map((entry) => {
        const line = version.lines.find(
          (candidate) => candidate.id === entry.lineId,
        );
        if (!line || line.sourceKind === "child_recipe_version") {
          throw new Error("Requirement provenance has no pinned Recipe line.");
        }
        return line;
      });
      const groupCostState = aggregateCostState(
        lines.map((line) => line.costState),
      );
      const groupAllocations = allocationPartitions[groupIndex] ?? [];
      const allocatedQuantity = groupAllocations.reduce(
        (sum, allocation) => sum + allocation.normalizedQuantity,
        0,
      );
      const exactCostStates = groupAllocations.map(
        (allocation) => allocation.costState,
      );
      if (
        requirement.itemId !== null &&
        allocatedQuantity + 1e-9 < groupQuantity &&
        groupCostState !== "not_applicable"
      ) {
        exactCostStates.push("unknown");
      }
      if (requirement.itemId !== null && exactCostStates.length === 0) {
        exactCostStates.push(
          groupCostState === "not_applicable"
            ? "not_applicable"
            : "unknown",
        );
      }
      const persistedGroupCostState =
        requirement.itemId === null
          ? groupCostState
          : aggregateCostState(exactCostStates);
      const groupKnownCostSubtotal =
        requirement.itemId === null
          ? provenance.reduce(
              (sum, entry, index) =>
                sum + lineExpectedCost(lines[index], entry.quantity),
              0,
            )
          : groupAllocations.reduce(
              (sum, allocation) =>
                sum + (allocation.costContribution ?? 0),
              0,
            );
      const stageRequirements = requirementsByStage.get(stage.id) ?? [];
      stageRequirements.push({
        catalogItemId: requirement.itemId,
        requirementKind:
          requirement.itemId === null
            ? "custom"
            : kinds.get(requirement.itemId) ?? "ingredient",
        rawQuantity: groupQuantity,
        rawUnit: requirement.unit,
        provenanceJson: JSON.stringify(provenance),
        isRequired: true,
        expectedCost:
          persistedGroupCostState === "known"
            ? groupKnownCostSubtotal
            : null,
        costState: persistedGroupCostState,
        allocations: groupAllocations.map(mapAllocation),
      });
      requirementsByStage.set(stage.id, stageRequirements);
    }
  }

  for (const usage of plan.preparedStockUses) {
    const stage = stageByVersion.get(usage.versionId);
    if (!stage) {
      throw new Error("Prepared-stock use has no matching production stage.");
    }
    const stageRequirements = requirementsByStage.get(stage.id) ?? [];
    stageRequirements.push({
      catalogItemId: usage.itemId,
      requirementKind: "prepared_product",
      rawQuantity: usage.quantity,
      rawUnit: usage.unit,
      provenanceJson: JSON.stringify([
        {
          kind: "prepared_stock",
          versionId: usage.versionId,
          quantity: usage.quantity,
          unit: usage.unit,
        },
      ]),
      isRequired: true,
      expectedCost: usage.expectedCost,
      costState: usage.costState,
      allocations: usage.allocations.map((allocation) =>
        mapAllocation(allocation),
      ),
    });
    requirementsByStage.set(stage.id, stageRequirements);
  }

  return plan.stages.map<SaveProductionPlanStageInput>((stage) => {
    const version = versionById.get(stage.versionId);
    const expectedYield = version?.expectedOutputQuantity ?? 1;
    return {
      key: stage.id,
      parentKey: parentKeyByChild.get(stage.versionId) ?? null,
      recipeVersionId: stage.versionId,
      topologicalOrder: stage.sequence,
      expectedInputMultiplier:
        expectedYield > 0 ? stage.expectedFreshOutput / expectedYield : 0,
      expectedOutputQuantity: stage.requiredOutputQuantity,
      expectedOutputUnit: stage.unit,
      preparedStockQuantity: stage.preparedStockUsed,
      freshPrepareQuantity: stage.expectedFreshOutput,
      status: stage.shortfallQuantity > 0 ? "short" : "ready",
      shortageState: stage.shortfallQuantity > 0 ? "short" : "none",
      varianceState: "pending",
      requirements: requirementsByStage.get(stage.id) ?? [],
    };
  });
}

/**
 * Replaces caller-authored recipe content with the exact persisted graph,
 * validates exact stock evidence, and persists a read-only plan snapshot.
 * Neither this service nor the repository mutates inventory.
 */
export async function calculateAndSaveProductionPlan(
  input: {
    businessId: string;
    branchId?: string | null;
    rootRecipeId: string;
    planner: ProductionPlannerInput;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
): Promise<
  | {
      ok: true;
      calculation: ProductionPlan;
      saved: Awaited<ReturnType<typeof saveProductionPlan>>;
    }
  | { ok: false; error: Exclude<ProductionPlannerResult, { ok: true }> }
> {
  await runMigrations(db);
  assertExactStockEvidence(input.planner);
  const persisted = await loadRecipeVersionGraph(
    input.planner.rootVersionId,
    500,
    db,
  );
  const versions = mapPersistedGraph(persisted.versions, persisted.lines);
  const root = versions.find(
    (version) => version.id === input.planner.rootVersionId,
  );
  if (
    !root ||
    root.familyId !== input.rootRecipeId ||
    root.businessId !== input.businessId ||
    root.status !== "published"
  ) {
    throw new Error(
      "Production-plan root must be the active business's published Recipe version.",
    );
  }
  const trustedPlanner: ProductionPlannerInput = {
    ...input.planner,
    versions,
  };
  const result = calculateProductionPlan(trustedPlanner);
  if (!result.ok) return { ok: false, error: result };
  const stages = await mapPlanForPersistence(
    input.businessId,
    result.plan,
    trustedPlanner,
    db,
  );
  const saved = await saveProductionPlan(
    {
      id: result.plan.id,
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      rootRecipeId: input.rootRecipeId,
      rootRecipeVersionId: result.plan.rootVersionId,
      targetQuantity: result.plan.targetQuantity,
      targetUnit: result.plan.targetUnit,
      preparationMode: result.plan.mode,
      status:
        result.plan.missingStockCount === 0 &&
        result.plan.targetShortfallQuantity === 0
          ? "ready"
          : "draft",
      calculationVersion: result.plan.calculationVersion,
      stockObservedAt: result.plan.observedAt,
      expectedTotalCost: result.plan.expectedCost,
      costState: result.plan.costState,
      missingCostCount: result.plan.missingCostCount,
      stages,
    },
    db,
  );
  return { ok: true, calculation: result.plan, saved };
}
