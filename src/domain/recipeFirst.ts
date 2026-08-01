/**
 * Dependency-free contracts for the Recipe-first creation experience.
 *
 * These helpers describe creation, costing, library, and lifecycle decisions.
 * Persistence remains responsible for IDs, transactions, and immutable
 * snapshots; UI code remains responsible for presentation.
 */

export const RECIPE_CREATION_MODES = [
  "finished_per_unit",
  "prepared_batch",
  "unsure",
] as const;

export type RecipeCreationMode = (typeof RECIPE_CREATION_MODES)[number];

export type RecipeCreationPlan = {
  mode: RecipeCreationMode;
  label: string;
  classification: "finished_product" | "prepared_base" | null;
  internalOutput: { quantity: 1; unit: "pcs" } | null;
  yieldEntry: "internal_per_unit" | "after_ingredients" | "deferred";
};

export function describeRecipeCreationMode(
  mode: RecipeCreationMode,
): RecipeCreationPlan {
  if (mode === "finished_per_unit") {
    return {
      mode,
      label: "Finished product sold per piece or serving",
      classification: "finished_product",
      internalOutput: { quantity: 1, unit: "pcs" },
      yieldEntry: "internal_per_unit",
    };
  }
  if (mode === "prepared_batch") {
    return {
      mode,
      label: "Prepared ingredient or base",
      classification: "prepared_base",
      internalOutput: null,
      yieldEntry: "after_ingredients",
    };
  }
  return {
    mode,
    label: "I am not sure yet",
    classification: null,
    internalOutput: null,
    yieldEntry: "deferred",
  };
}

export const RECIPE_FIRST_UNITS = [
  "g",
  "kg",
  "ml",
  "l",
  "pcs",
  "pack",
  "portion",
] as const;

export type RecipeFirstUnit = (typeof RECIPE_FIRST_UNITS)[number];

const UNIT_ALIASES: Readonly<Record<string, RecipeFirstUnit>> = {
  g: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kilogram: "kg",
  kilograms: "kg",
  ml: "ml",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  l: "l",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  pc: "pcs",
  pcs: "pcs",
  piece: "pcs",
  pieces: "pcs",
  pack: "pack",
  packs: "pack",
  portion: "portion",
  portions: "portion",
  serving: "portion",
  servings: "portion",
};

type UnitDefinition = {
  dimension: "mass" | "volume" | "count" | "package" | "portion";
  factor: number;
};

const UNIT_DEFINITIONS: Readonly<Record<RecipeFirstUnit, UnitDefinition>> = {
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1_000 },
  ml: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1_000 },
  pcs: { dimension: "count", factor: 1 },
  pack: { dimension: "package", factor: 1 },
  portion: { dimension: "portion", factor: 1 },
};

export function normalizeRecipeUnit(unit: string): RecipeFirstUnit | null {
  return UNIT_ALIASES[unit.trim().toLowerCase()] ?? null;
}

export type RecipeQuantityConversion =
  | {
      ok: true;
      quantity: number;
      fromUnit: RecipeFirstUnit;
      toUnit: RecipeFirstUnit;
    }
  | {
      ok: false;
      reason: "invalid_quantity" | "unknown_unit" | "incompatible_units";
    };

export function convertRecipeQuantity(
  quantity: number,
  fromUnitInput: string,
  toUnitInput: string,
): RecipeQuantityConversion {
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, reason: "invalid_quantity" };
  }
  const fromUnit = normalizeRecipeUnit(fromUnitInput);
  const toUnit = normalizeRecipeUnit(toUnitInput);
  if (!fromUnit || !toUnit) return { ok: false, reason: "unknown_unit" };

  const from = UNIT_DEFINITIONS[fromUnit];
  const to = UNIT_DEFINITIONS[toUnit];
  if (from.dimension !== to.dimension) {
    return { ok: false, reason: "incompatible_units" };
  }
  return {
    ok: true,
    quantity: (quantity * from.factor) / to.factor,
    fromUnit,
    toUnit,
  };
}

export const RECIPE_FIRST_COST_SOURCES = [
  "purchase_lot",
  "prepared_recipe",
  "owner_estimate",
  "custom",
  "unknown",
  "legacy_snapshot",
] as const;

export type RecipeFirstCostSource =
  (typeof RECIPE_FIRST_COST_SOURCES)[number];
export type RecipeCostSummaryState =
  | "actual"
  | "estimated"
  | "no_price"
  | "incomplete";

export function costStateForSource(
  source: RecipeFirstCostSource,
): Exclude<RecipeCostSummaryState, "incomplete"> {
  if (source === "purchase_lot" || source === "prepared_recipe") {
    return "actual";
  }
  if (source === "unknown") return "no_price";
  return "estimated";
}

export function recipeCostStateLabel(state: RecipeCostSummaryState): string {
  const labels: Record<RecipeCostSummaryState, string> = {
    actual: "Actual cost",
    estimated: "Estimated cost",
    no_price: "No price yet",
    incomplete: "Cost incomplete",
  };
  return labels[state];
}

export type SimplePurchaseCostInput = {
  costSource: RecipeFirstCostSource;
  purchaseCost: number | null;
  purchasedQuantity: number;
  purchaseUnit: string;
  piecesPerPack?: number | null;
  portionsPerPiece?: number | null;
  usageQuantity: number;
  usageUnit: string;
};

export type IngredientCostIssue =
  | "invalid_purchase_cost"
  | "unknown_cost_has_amount"
  | "invalid_purchased_quantity"
  | "invalid_usage_quantity"
  | "invalid_package_hierarchy"
  | "unknown_unit"
  | "incompatible_units";

export type SimpleIngredientCost = {
  source: RecipeFirstCostSource;
  state: RecipeCostSummaryState;
  amount: number | null;
  costPerUsageUnit: number | null;
  availableUsageQuantity: number | null;
  usageQuantity: number;
  usageUnit: RecipeFirstUnit | null;
  issue: IngredientCostIssue | null;
};

function incompleteIngredientCost(
  input: SimplePurchaseCostInput,
  issue: IngredientCostIssue,
): SimpleIngredientCost {
  return {
    source: input.costSource,
    state: "incomplete",
    amount: null,
    costPerUsageUnit: null,
    availableUsageQuantity: null,
    usageQuantity: input.usageQuantity,
    usageUnit: normalizeRecipeUnit(input.usageUnit),
    issue,
  };
}

function availablePackagedQuantity(
  input: SimplePurchaseCostInput,
  purchaseUnit: RecipeFirstUnit,
  usageUnit: RecipeFirstUnit,
): number | null {
  const pieces = input.piecesPerPack ?? null;
  const portions = input.portionsPerPiece ?? null;
  if (pieces !== null && (!Number.isFinite(pieces) || pieces <= 0)) return null;
  if (portions !== null && (!Number.isFinite(portions) || portions <= 0)) {
    return null;
  }

  if (purchaseUnit === "pack" && pieces !== null) {
    const totalPieces = input.purchasedQuantity * pieces;
    if (usageUnit === "pcs" && portions === null) return totalPieces;
    if (usageUnit === "portion" && portions !== null) {
      return totalPieces * portions;
    }
    return null;
  }
  if (purchaseUnit === "pcs" && portions !== null) {
    return usageUnit === "portion"
      ? input.purchasedQuantity * portions
      : null;
  }
  if (pieces !== null || portions !== null) return null;

  const conversion = convertRecipeQuantity(
    input.purchasedQuantity,
    purchaseUnit,
    usageUnit,
  );
  return conversion.ok ? conversion.quantity : null;
}

export function calculateSimpleIngredientCost(
  input: SimplePurchaseCostInput,
): SimpleIngredientCost {
  if (
    !Number.isFinite(input.purchasedQuantity) ||
    input.purchasedQuantity <= 0
  ) {
    return incompleteIngredientCost(input, "invalid_purchased_quantity");
  }
  if (!Number.isFinite(input.usageQuantity) || input.usageQuantity < 0) {
    return incompleteIngredientCost(input, "invalid_usage_quantity");
  }
  const purchaseUnit = normalizeRecipeUnit(input.purchaseUnit);
  const usageUnit = normalizeRecipeUnit(input.usageUnit);
  if (!purchaseUnit || !usageUnit) {
    return incompleteIngredientCost(input, "unknown_unit");
  }

  const availableUsageQuantity = availablePackagedQuantity(
    input,
    purchaseUnit,
    usageUnit,
  );
  if (availableUsageQuantity === null || availableUsageQuantity <= 0) {
    const hasHierarchy =
      input.piecesPerPack !== null &&
        input.piecesPerPack !== undefined ||
      input.portionsPerPiece !== null &&
        input.portionsPerPiece !== undefined;
    return incompleteIngredientCost(
      input,
      hasHierarchy ? "invalid_package_hierarchy" : "incompatible_units",
    );
  }

  if (input.costSource === "unknown") {
    if (input.purchaseCost !== null) {
      return incompleteIngredientCost(input, "unknown_cost_has_amount");
    }
    return {
      source: input.costSource,
      state: "no_price",
      amount: null,
      costPerUsageUnit: null,
      availableUsageQuantity,
      usageQuantity: input.usageQuantity,
      usageUnit,
      issue: null,
    };
  }
  if (
    input.purchaseCost === null ||
    !Number.isFinite(input.purchaseCost) ||
    input.purchaseCost < 0
  ) {
    return incompleteIngredientCost(input, "invalid_purchase_cost");
  }

  const costPerUsageUnit = input.purchaseCost / availableUsageQuantity;
  return {
    source: input.costSource,
    state: costStateForSource(input.costSource),
    amount: costPerUsageUnit * input.usageQuantity,
    costPerUsageUnit,
    availableUsageQuantity,
    usageQuantity: input.usageQuantity,
    usageUnit,
    issue: null,
  };
}

export type RecipeCostComponent = {
  id: string;
  source: RecipeFirstCostSource;
  state: RecipeCostSummaryState;
  amount: number | null;
};

export type RecipeCostSummary = {
  state: RecipeCostSummaryState;
  totalCost: number | null;
  knownSubtotal: number;
  sellingPrice: number | null;
  grossProfit: number | null;
  sellingPriceState: "not_set" | "known" | "invalid";
  issues: readonly string[];
};

export function summarizeRecipeCosts(
  lines: readonly RecipeCostComponent[],
  sellingPrice: number | null = null,
): RecipeCostSummary {
  let knownSubtotal = 0;
  let hasEstimate = false;
  let unresolved = false;
  const issues: string[] = [];

  lines.forEach((line, index) => {
    if (line.state === "actual" || line.state === "estimated") {
      if (
        line.amount === null ||
        !Number.isFinite(line.amount) ||
        line.amount < 0
      ) {
        unresolved = true;
        issues.push(`line_${index + 1}_invalid_known_cost`);
        return;
      }
      knownSubtotal += line.amount;
      if (line.state === "estimated") hasEstimate = true;
      return;
    }
    unresolved = true;
    if (line.amount !== null) {
      issues.push(`line_${index + 1}_unresolved_cost_has_amount`);
    }
  });

  let state: RecipeCostSummaryState;
  let totalCost: number | null;
  if (lines.length === 0) {
    state = "no_price";
    totalCost = null;
  } else if (unresolved) {
    state = "incomplete";
    totalCost = null;
  } else {
    state = hasEstimate ? "estimated" : "actual";
    totalCost = knownSubtotal;
  }

  let sellingPriceState: RecipeCostSummary["sellingPriceState"] = "not_set";
  let acceptedSellingPrice: number | null = null;
  if (sellingPrice !== null) {
    if (Number.isFinite(sellingPrice) && sellingPrice >= 0) {
      sellingPriceState = "known";
      acceptedSellingPrice = sellingPrice;
    } else {
      sellingPriceState = "invalid";
      issues.push("invalid_selling_price");
      state = "incomplete";
      totalCost = null;
    }
  }

  return {
    state,
    totalCost,
    knownSubtotal,
    sellingPrice: acceptedSellingPrice,
    grossProfit:
      acceptedSellingPrice !== null && totalCost !== null
        ? acceptedSellingPrice - totalCost
        : null,
    sellingPriceState,
    issues,
  };
}

export type PreparedBatchCostLine = RecipeCostComponent & {
  inputQuantity: number | null;
  inputUnit: string | null;
};

export type PreparedBatchCostSummary = {
  cost: RecipeCostSummary;
  yieldState: "deferred" | "ready" | "invalid";
  totalBatchCost: number | null;
  costPerGram: number | null;
  costPerKilogram: number | null;
  costPerMilliliter: number | null;
  costPerLiter: number | null;
  yieldRatio: number | null;
  readyForProduction: boolean;
  issues: readonly string[];
};

function totalCompatibleInputs(
  lines: readonly PreparedBatchCostLine[],
  outputUnit: RecipeFirstUnit,
): number | null {
  const definition = UNIT_DEFINITIONS[outputUnit];
  const baseUnit = definition.dimension === "mass" ? "g" : "ml";
  if (definition.dimension !== "mass" && definition.dimension !== "volume") {
    return null;
  }

  let total = 0;
  for (const line of lines) {
    if (line.inputQuantity === null || line.inputUnit === null) return null;
    const converted = convertRecipeQuantity(
      line.inputQuantity,
      line.inputUnit,
      baseUnit,
    );
    if (!converted.ok) return null;
    total += converted.quantity;
  }
  return total > 0 ? total : null;
}

export function calculatePreparedBatchCost(input: {
  lines: readonly PreparedBatchCostLine[];
  expectedYieldQuantity: number | null;
  expectedYieldUnit: string | null;
}): PreparedBatchCostSummary {
  const cost = summarizeRecipeCosts(input.lines);
  const issues: string[] = [...cost.issues];
  const bothDeferred =
    input.expectedYieldQuantity === null && input.expectedYieldUnit === null;
  if (bothDeferred) {
    return {
      cost,
      yieldState: "deferred",
      totalBatchCost: cost.totalCost,
      costPerGram: null,
      costPerKilogram: null,
      costPerMilliliter: null,
      costPerLiter: null,
      yieldRatio: null,
      readyForProduction: false,
      issues,
    };
  }

  const yieldUnit = input.expectedYieldUnit
    ? normalizeRecipeUnit(input.expectedYieldUnit)
    : null;
  if (
    input.expectedYieldQuantity === null ||
    !Number.isFinite(input.expectedYieldQuantity) ||
    input.expectedYieldQuantity <= 0 ||
    !yieldUnit
  ) {
    issues.push("invalid_expected_yield");
    return {
      cost,
      yieldState: "invalid",
      totalBatchCost: cost.totalCost,
      costPerGram: null,
      costPerKilogram: null,
      costPerMilliliter: null,
      costPerLiter: null,
      yieldRatio: null,
      readyForProduction: false,
      issues,
    };
  }

  const definition = UNIT_DEFINITIONS[yieldUnit];
  const baseUnit =
    definition.dimension === "mass"
      ? "g"
      : definition.dimension === "volume"
        ? "ml"
        : yieldUnit;
  const output = convertRecipeQuantity(
    input.expectedYieldQuantity,
    yieldUnit,
    baseUnit,
  );
  const outputBaseQuantity = output.ok ? output.quantity : null;
  const perBase =
    cost.totalCost !== null && outputBaseQuantity !== null
      ? cost.totalCost / outputBaseQuantity
      : null;
  const inputTotal = totalCompatibleInputs(input.lines, yieldUnit);

  return {
    cost,
    yieldState: "ready",
    totalBatchCost: cost.totalCost,
    costPerGram: definition.dimension === "mass" ? perBase : null,
    costPerKilogram:
      definition.dimension === "mass" && perBase !== null
        ? perBase * 1_000
        : null,
    costPerMilliliter: definition.dimension === "volume" ? perBase : null,
    costPerLiter:
      definition.dimension === "volume" && perBase !== null
        ? perBase * 1_000
        : null,
    yieldRatio:
      outputBaseQuantity !== null && inputTotal !== null
        ? outputBaseQuantity / inputTotal
        : null,
    readyForProduction:
      cost.totalCost !== null && outputBaseQuantity !== null,
    issues,
  };
}

export const RECIPE_LIBRARY_GROUPS = [
  "all",
  "recipes",
  "prepared_bases",
  "ingredients",
  "selling_items",
  "resale_products",
  "drafts",
  "archived",
] as const;

export type RecipeLibraryGroup = (typeof RECIPE_LIBRARY_GROUPS)[number];
export type RecipeLibraryClassification =
  | "finished_recipe"
  | "prepared_base"
  | "ingredient"
  | "selling_item"
  | "resale_product";
export type RecipeLibraryLifecycle = "draft" | "active" | "archived";

export type RecipeLibraryItem = {
  id: string;
  name: string;
  category: string | null;
  classification: RecipeLibraryClassification;
  lifecycle: RecipeLibraryLifecycle;
  costState: RecipeCostSummaryState;
  sellingPrice: number | null;
  readyForProduction: boolean;
  readyForKiosk: boolean;
  usesEstimatedPreparedIngredient: boolean;
  missingRequiredInformation: boolean;
};

export function recipeLibraryMembership(
  item: RecipeLibraryItem,
): readonly RecipeLibraryGroup[] {
  if (item.lifecycle === "archived") return ["archived"];

  const groups: RecipeLibraryGroup[] = ["all"];
  if (
    item.classification === "finished_recipe" ||
    item.classification === "prepared_base"
  ) {
    groups.push("recipes");
  }
  if (item.classification === "prepared_base") groups.push("prepared_bases");
  if (item.classification === "ingredient") groups.push("ingredients");
  if (
    item.classification === "finished_recipe" ||
    item.classification === "selling_item" ||
    item.classification === "resale_product"
  ) {
    groups.push("selling_items");
  }
  if (item.classification === "resale_product") {
    groups.push("resale_products");
  }
  if (item.lifecycle === "draft") groups.push("drafts");
  return groups;
}

export function recipeLibraryReadiness(item: RecipeLibraryItem): {
  production: "ready" | "not_ready" | "not_applicable";
  kiosk: "ready" | "not_ready" | "not_applicable";
  labels: readonly string[];
} {
  const productionApplicable =
    item.classification === "finished_recipe" ||
    item.classification === "prepared_base";
  const kioskApplicable =
    item.classification === "finished_recipe" ||
    item.classification === "selling_item" ||
    item.classification === "resale_product";
  const available = item.lifecycle === "active";
  const production =
    !productionApplicable
      ? "not_applicable"
      : available &&
          item.readyForProduction &&
          !item.missingRequiredInformation
        ? "ready"
        : "not_ready";
  const kiosk =
    !kioskApplicable
      ? "not_applicable"
      : available && item.readyForKiosk && !item.missingRequiredInformation
        ? "ready"
        : "not_ready";
  const labels = [
    item.lifecycle === "draft"
      ? "Draft"
      : item.lifecycle === "archived"
        ? "Archived"
        : "Active",
    recipeCostStateLabel(item.costState),
    production === "ready"
      ? "Ready for production"
      : production === "not_ready"
        ? "Not ready for production"
        : "Production not required",
    kiosk === "ready"
      ? "Ready for Kiosk"
      : kiosk === "not_ready"
        ? "Not ready for Kiosk"
        : "Kiosk not applicable",
  ];
  if (item.usesEstimatedPreparedIngredient) {
    labels.push("Uses estimated prepared ingredient");
  }
  if (item.missingRequiredInformation) {
    labels.push("Missing required information");
  }
  return { production, kiosk, labels };
}

export function filterRecipeLibraryItems(
  items: readonly RecipeLibraryItem[],
  filter: {
    query?: string;
    group?: RecipeLibraryGroup;
    costState?: RecipeCostSummaryState;
    readiness?: "production_ready" | "kiosk_ready" | "needs_attention";
  } = {},
): readonly RecipeLibraryItem[] {
  const query = filter.query?.trim().toLocaleLowerCase() ?? "";
  return items.filter((item) => {
    if (
      query &&
      !`${item.name} ${item.category ?? ""}`
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return false;
    }
    if (
      filter.group &&
      !recipeLibraryMembership(item).includes(filter.group)
    ) {
      return false;
    }
    if (filter.costState && item.costState !== filter.costState) return false;

    const readiness = recipeLibraryReadiness(item);
    if (
      filter.readiness === "production_ready" &&
      readiness.production !== "ready"
    ) {
      return false;
    }
    if (filter.readiness === "kiosk_ready" && readiness.kiosk !== "ready") {
      return false;
    }
    if (
      filter.readiness === "needs_attention" &&
      !(
        item.missingRequiredInformation ||
        item.costState === "incomplete" ||
        item.costState === "no_price"
      )
    ) {
      return false;
    }
    return true;
  });
}

export function groupRecipeLibraryItems(
  items: readonly RecipeLibraryItem[],
): Readonly<Record<RecipeLibraryGroup, readonly RecipeLibraryItem[]>> {
  const groups: Record<RecipeLibraryGroup, RecipeLibraryItem[]> = {
    all: [],
    recipes: [],
    prepared_bases: [],
    ingredients: [],
    selling_items: [],
    resale_products: [],
    drafts: [],
    archived: [],
  };
  items.forEach((item) => {
    recipeLibraryMembership(item).forEach((group) => groups[group].push(item));
  });
  return groups;
}

export type RecipeLifecycleInput = {
  lifecycle: RecipeLibraryLifecycle;
  hasPublishedVersion: boolean;
  historicalUseCount: number;
};

export function decideRecipeEdit(input: RecipeLifecycleInput):
  | { action: "edit_draft"; preservesHistory: true }
  | { action: "create_new_version"; preservesHistory: true }
  | { action: "blocked"; reason: "archived"; preservesHistory: true } {
  if (input.lifecycle === "archived") {
    return { action: "blocked", reason: "archived", preservesHistory: true };
  }
  if (
    input.lifecycle === "draft" &&
    !input.hasPublishedVersion &&
    input.historicalUseCount === 0
  ) {
    return { action: "edit_draft", preservesHistory: true };
  }
  return { action: "create_new_version", preservesHistory: true };
}

export function decideRecipeDuplicate(
  input: Pick<RecipeLifecycleInput, "lifecycle">,
): {
  action: "create_new_family_draft";
  sourceRemainsUnchanged: true;
  allowed: boolean;
} {
  return {
    action: "create_new_family_draft",
    sourceRemainsUnchanged: true,
    allowed: ["draft", "active", "archived"].includes(input.lifecycle),
  };
}

export function decideRecipeArchive(
  lifecycle: RecipeLibraryLifecycle,
):
  | { action: "archive"; preservesHistory: true }
  | { action: "no_change"; reason: "already_archived"; preservesHistory: true } {
  return lifecycle === "archived"
    ? {
        action: "no_change",
        reason: "already_archived",
        preservesHistory: true,
      }
    : { action: "archive", preservesHistory: true };
}

export const RECIPE_DELETE_REFERENCE_KINDS = [
  "purchase",
  "lot",
  "movement",
  "recipe_reference",
  "production",
  "sale",
  "bundle_reference",
  "adjustment",
  "historical_dependency",
] as const;

export type RecipeDeleteReferenceKind =
  (typeof RECIPE_DELETE_REFERENCE_KINDS)[number];

export function decideRecipeSafeDelete(input: {
  ownerAuthorized: boolean;
  lifecycle: RecipeLibraryLifecycle;
  hasPublishedVersion: boolean;
  referenceCounts: Partial<Record<RecipeDeleteReferenceKind, number | null>>;
}):
  | { action: "delete"; blockingReferences: [] }
  | {
      action: "owner_authorization_required";
      blockingReferences: [];
    }
  | {
      action: "archive";
      reason: "immutable_or_referenced";
      blockingReferences: RecipeDeleteReferenceKind[];
    }
  | {
      action: "blocked";
      reason: "reference_check_incomplete";
      blockingReferences: RecipeDeleteReferenceKind[];
    } {
  if (!input.ownerAuthorized) {
    return {
      action: "owner_authorization_required",
      blockingReferences: [],
    };
  }

  const uncertain: RecipeDeleteReferenceKind[] = [];
  const present: RecipeDeleteReferenceKind[] = [];
  RECIPE_DELETE_REFERENCE_KINDS.forEach((kind) => {
    const count = input.referenceCounts[kind];
    if (
      count === null ||
      count === undefined ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      uncertain.push(kind);
    } else if (count > 0) {
      present.push(kind);
    }
  });
  if (uncertain.length > 0) {
    return {
      action: "blocked",
      reason: "reference_check_incomplete",
      blockingReferences: uncertain,
    };
  }
  if (
    present.length > 0 ||
    input.lifecycle !== "draft" ||
    input.hasPublishedVersion
  ) {
    return {
      action: "archive",
      reason: "immutable_or_referenced",
      blockingReferences: present,
    };
  }
  return { action: "delete", blockingReferences: [] };
}
