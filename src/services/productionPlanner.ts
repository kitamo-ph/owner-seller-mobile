import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  saveProductionPlan,
  type PlanCostState,
  type ProductionRequirementKind,
  type RepositoryDatabase,
  type SaveProductionPlanStageInput,
} from "@/db/repositories";
import {
  calculateProductionPlan,
  type ProductionPlan,
  type ProductionPlannerInput,
  type ProductionPlannerResult,
} from "@/domain/productionPlanner";

function planCostState(plan: ProductionPlan): PlanCostState {
  if (plan.costComplete) return "known";
  return plan.knownCostSubtotal > 0 ? "partial" : "unknown";
}

async function catalogRequirementKinds(
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
      WHERE id IN (${unique.map(() => "?").join(", ")})
        AND deleted_at IS NULL
    `,
    unique,
  );
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

async function mapPlanForPersistence(
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
    plan.rawRequirements
      .map((requirement) => requirement.itemId)
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
    const totalProvenance = requirement.provenance.reduce(
      (sum, provenance) => sum + provenance.quantity,
      0,
    );
    for (const [versionId, provenance] of grouped) {
      const stage = stageByVersion.get(versionId);
      if (!stage) continue;
      const groupQuantity = provenance.reduce(
        (sum, entry) => sum + entry.quantity,
        0,
      );
      const ratio =
        totalProvenance > 0 ? groupQuantity / totalProvenance : 1;
      const stageRequirements = requirementsByStage.get(stage.id) ?? [];
      stageRequirements.push({
        catalogItemId: requirement.itemId,
        requirementKind:
          requirement.itemId === null
            ? "custom"
            : kinds.get(requirement.itemId) ?? "ingredient",
        rawQuantity: requirement.quantity * ratio,
        rawUnit: requirement.unit,
        provenanceJson: JSON.stringify(provenance),
        isRequired: true,
        expectedCost:
          requirement.expectedCost === null
            ? null
            : requirement.expectedCost * ratio,
        costState: requirement.costComplete
          ? "known"
          : requirement.knownCostSubtotal > 0
            ? "partial"
            : "unknown",
        allocations: [],
      });
      requirementsByStage.set(stage.id, stageRequirements);
    }
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
 * Calculates from detached graph/stock snapshots and persists only the plan
 * snapshot. The repository assertion contains no inventory mutation SQL.
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
  const result = calculateProductionPlan(input.planner);
  if (!result.ok) return { ok: false, error: result };
  const stages = await mapPlanForPersistence(result.plan, input.planner, db);
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
      costState: planCostState(result.plan),
      missingCostCount: result.plan.missingCostCount,
      stages,
    },
    db,
  );
  return { ok: true, calculation: result.plan, saved };
}
