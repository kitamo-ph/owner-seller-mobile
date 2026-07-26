import {
  aggregateCosts,
  type AggregatedCost,
  type CostEvidence,
} from "./costState";
import {
  type SupplyCategory,
  type SupplyConsumptionStage,
} from "./supplyRules";

export type OrderCostCategory =
  | "product_cogs"
  | "packaging"
  | "utensil_condiment"
  | "other_supply";

export type OrderCostEvidence = {
  evidenceId: string;
  category: OrderCostCategory;
  source: "sale_item_cogs" | "supply_usage";
  consumptionStage: SupplyConsumptionStage | null;
  cost: CostEvidence;
};

export type OrderCostSummary = {
  productCogs: AggregatedCost;
  packagingCost: AggregatedCost;
  utensilCondimentCost: AggregatedCost;
  otherSupplyCost: AggregatedCost;
  totalOrderCost: AggregatedCost;
};

export type OrderCostSummaryResult =
  | { ok: true; summary: OrderCostSummary }
  | {
      ok: false;
      evidenceId: string;
      reason:
        | "duplicate_evidence"
        | "invalid_product_cogs_stage"
        | "invalid_supply_stage"
        | "invalid_supply_category"
        | "invalid_cost_evidence";
    };

export function orderCostCategoryForSupply(
  category: SupplyCategory,
): Exclude<OrderCostCategory, "product_cogs"> {
  if (category === "packaging" || category === "disposable") {
    return "packaging";
  }
  if (category === "utensil" || category === "condiment") {
    return "utensil_condiment";
  }
  return "other_supply";
}

function aggregateOrThrow(costs: readonly CostEvidence[]): AggregatedCost | null {
  const result = aggregateCosts(costs);
  return result.ok ? result.cost : null;
}

/**
 * Keeps checkout-stage fulfillment costs separate from Product COGS.
 *
 * Production-stage packaging is already part of batch/Product COGS and cannot
 * be inserted again as order-level supply evidence.
 */
export function summarizeOrderCosts(
  evidence: readonly OrderCostEvidence[],
): OrderCostSummaryResult {
  const seen = new Set<string>();
  const grouped: Record<OrderCostCategory, CostEvidence[]> = {
    product_cogs: [],
    packaging: [],
    utensil_condiment: [],
    other_supply: [],
  };

  for (const entry of evidence) {
    if (seen.has(entry.evidenceId)) {
      return {
        ok: false,
        evidenceId: entry.evidenceId,
        reason: "duplicate_evidence",
      };
    }
    seen.add(entry.evidenceId);

    if (entry.source === "sale_item_cogs") {
      if (
        entry.category !== "product_cogs" ||
        entry.consumptionStage === "checkout"
      ) {
        return {
          ok: false,
          evidenceId: entry.evidenceId,
          reason: "invalid_product_cogs_stage",
        };
      }
    } else {
      if (entry.consumptionStage !== "checkout") {
        return {
          ok: false,
          evidenceId: entry.evidenceId,
          reason: "invalid_supply_stage",
        };
      }
      if (entry.category === "product_cogs") {
        return {
          ok: false,
          evidenceId: entry.evidenceId,
          reason: "invalid_supply_category",
        };
      }
    }

    grouped[entry.category].push(entry.cost);
  }

  const productCogs = aggregateOrThrow(grouped.product_cogs);
  const packagingCost = aggregateOrThrow(grouped.packaging);
  const utensilCondimentCost = aggregateOrThrow(grouped.utensil_condiment);
  const otherSupplyCost = aggregateOrThrow(grouped.other_supply);
  const totalOrderCost = aggregateOrThrow(evidence.map((entry) => entry.cost));
  if (
    !productCogs ||
    !packagingCost ||
    !utensilCondimentCost ||
    !otherSupplyCost ||
    !totalOrderCost
  ) {
    return {
      ok: false,
      evidenceId: "",
      reason: "invalid_cost_evidence",
    };
  }

  return {
    ok: true,
    summary: {
      productCogs,
      packagingCost,
      utensilCondimentCost,
      otherSupplyCost,
      totalOrderCost,
    },
  };
}
