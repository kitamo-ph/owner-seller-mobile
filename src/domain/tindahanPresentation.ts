import type { PanindaCatalogEntry } from "@/services/catalogItems";

export type PanindaAttentionKind =
  | "needs_listing"
  | "needs_price"
  | "needs_recipe"
  | "needs_review"
  | "needs_production"
  | "low_stock";

export type PanindaPresentation = {
  sourceLabel: "binili" | "niluluto";
  stockLabel: string;
  stockTone: "success" | "warning" | "danger" | "neutral";
  reason: string | null;
  attentionKind: PanindaAttentionKind | null;
  primaryAction: "list" | "price" | "recipe" | "produce" | "restore" | "details";
  primaryLabel: string;
};

function quantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

export function presentPanindaEntry(entry: PanindaCatalogEntry): PanindaPresentation {
  const product = entry.product;
  const recipeBacked = Boolean(entry.activeRecipeId || entry.activeVersionId);
  const sourceLabel = recipeBacked ? "niluluto" : "binili";

  if (entry.section === "archived") {
    return {
      sourceLabel,
      stockLabel: `${quantity(product.stockQty)} naka-preserve`,
      stockTone: "neutral",
      reason: "Naka-archive ito. Nananatili ang dating stock at history.",
      attentionKind: null,
      primaryAction: "restore",
      primaryLabel: "Ibalik",
    };
  }

  if (entry.reviewRequired || entry.readinessState === "legacy_review") {
    return {
      sourceLabel,
      stockLabel: `${quantity(product.stockQty)} stock`,
      stockTone: "warning",
      reason: "Kailangan pang i-review ang item bago ito maibenta.",
      attentionKind: "needs_review",
      primaryAction: recipeBacked ? "recipe" : "details",
      primaryLabel: recipeBacked ? "Ayusin ang Recipe" : "Suriin",
    };
  }

  if (entry.actions.listForSale) {
    const missingPrice = entry.sellingPriceState !== "known" || product.price <= 0;
    return {
      sourceLabel,
      stockLabel: product.stockQty > 0 ? `${quantity(product.stockQty)} stock` : "0 · i-produce",
      stockTone: product.stockQty > 0 ? "warning" : "danger",
      reason: missingPrice
        ? "Maglagay muna ng presyo bago ito maibenta."
        : "Handa na ang Recipe. Ilagay sa Tindahan para maibenta.",
      attentionKind: missingPrice ? "needs_price" : "needs_listing",
      primaryAction: "list",
      primaryLabel: missingPrice ? "Ilagay ang presyo" : "Ilagay sa Tindahan",
    };
  }

  if (entry.section === "needs_setup") {
    const recipeIncomplete = recipeBacked && entry.readinessState !== "ready";
    return {
      sourceLabel,
      stockLabel: product.stockQty > 0 ? `${quantity(product.stockQty)} stock` : "0 · hindi pa handa",
      stockTone: "danger",
      reason: recipeIncomplete
        ? "May kulang pa sa Recipe. Ayusin ang eksaktong sangkap, dami, unit, o presyo."
        : "May kulang pang setup bago ito maibenta.",
      attentionKind: recipeIncomplete ? "needs_recipe" : "needs_review",
      primaryAction: recipeBacked ? "recipe" : "details",
      primaryLabel: recipeBacked ? "Ayusin ang Recipe" : "Suriin",
    };
  }

  if (product.stockQty <= 0 && entry.actions.produceFromRecipe) {
    return {
      sourceLabel,
      stockLabel: "0 · i-produce",
      stockTone: "danger",
      reason: "Naka-lista pero walang stock. I-produce muna para may maibenta.",
      attentionKind: "needs_production",
      primaryAction: "produce",
      primaryLabel: "Mag-produce",
    };
  }

  if (product.stockQty <= product.lowStockThreshold) {
    return {
      sourceLabel,
      stockLabel: `${quantity(product.stockQty)} na lang`,
      stockTone: "warning",
      reason: `${quantity(product.stockQty)} ${product.unitType} na lang ang natitira.`,
      attentionKind: "low_stock",
      primaryAction: recipeBacked ? "produce" : "details",
      primaryLabel: recipeBacked ? "Mag-produce" : "Magdagdag ng bili",
    };
  }

  return {
    sourceLabel,
    stockLabel: `${quantity(product.stockQty)} nabebenta`,
    stockTone: "success",
    reason: null,
    attentionKind: null,
    primaryAction: "details",
    primaryLabel: "Tingnan",
  };
}
