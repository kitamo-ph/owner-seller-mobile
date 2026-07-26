import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  getOrderCostEvidenceForSale,
  listActiveSupplyRulesForContext,
  type RepositoryDatabase,
} from "@/db/repositories";
import { summarizeOrderCosts } from "@/domain/orderCosts";
import {
  calculateSupplySuggestions,
  type SupplyConsumptionStage,
  type SupplyRuleContextLine,
} from "@/domain/supplyRules";

export async function calculateSupplyReview(
  input: {
    businessId: string;
    branchId: string;
    contexts: SupplyRuleContextLine[];
    consumptionStage: SupplyConsumptionStage;
  },
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const rules = await listActiveSupplyRulesForContext(
    {
      businessId: input.businessId,
      branchId: input.branchId,
      productIds: input.contexts
        .map((context) => context.productId)
        .filter((id): id is string => id !== null),
      recipeVersionIds: input.contexts
        .map((context) => context.recipeVersionId)
        .filter((id): id is string => id !== null),
      consumptionStage: input.consumptionStage,
    },
    db,
  );
  return calculateSupplySuggestions({
    rules: rules.map((rule) => ({
      id: rule.id,
      supplyItemId: rule.supplyCatalogItemId,
      supplyCategory: rule.supplyCategory,
      supplyUnit: rule.supplyUnit,
      scope: rule.scope,
      behavior: rule.behavior,
      consumptionStage: rule.consumptionStage,
      roundingRule: rule.roundingMode,
      targetProductId: rule.targetProductId,
      targetRecipeVersionId: rule.targetRecipeVersionId,
      triggerQuantity: rule.triggerQuantity,
      supplyQuantity: rule.supplyQuantity,
      active: rule.status === "active",
    })),
    contexts: input.contexts,
    consumptionStage: input.consumptionStage,
  });
}

export async function loadOrderCostSummary(
  saleId: string,
  db: RepositoryDatabase = openKitamoDatabase(),
) {
  await runMigrations(db);
  const evidence = await getOrderCostEvidenceForSale(saleId, db);
  return summarizeOrderCosts(evidence);
}
