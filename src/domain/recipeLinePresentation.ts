export type RecipeLinePresentation = {
  lineId: string;
  displayName: string;
  classification: string | null;
  sourceLabel: string;
  costLabel: string;
  quantity: number;
  unit: string;
  quantityLabel: string;
  conversionSummary: string | null;
  category: string | null;
  sourceDetail: string | null;
  missingReason: string | null;
};

export type ResolvedLineIdentityInput = {
  lineId: string;
  quantity: number | null;
  unit: string | null;
  resolved: {
    displayName: string | null | undefined;
    classification: string | null;
    sourceLabel: string;
    costLabel: string;
    conversionSummary: string | null;
    category: string | null;
    sourceDetail: string | null;
    missingReason: string | null;
  } | null;
};

export const INGREDIENT_IDENTITY_UNAVAILABLE =
  "Ingredient information unavailable";

/**
 * Builds the shared Step 2 / Step 3 presentation for one Recipe line.
 * Generic "Recorded ingredient" labels are never used as a normal state.
 */
export function presentRecipeLineIdentity(
  input: ResolvedLineIdentityInput,
): RecipeLinePresentation {
  const quantity = input.quantity ?? 0;
  const unit = input.unit?.trim() || "unit";
  const displayName =
    input.resolved?.displayName?.trim() || INGREDIENT_IDENTITY_UNAVAILABLE;

  return {
    lineId: input.lineId,
    displayName,
    classification: input.resolved?.classification ?? null,
    sourceLabel: input.resolved?.sourceLabel ?? "Unresolved ingredient",
    costLabel: input.resolved?.costLabel ?? "Cost missing",
    quantity,
    unit,
    quantityLabel: `${formatQuantity(quantity)} ${unit} per recipe`,
    conversionSummary: input.resolved?.conversionSummary ?? null,
    category: input.resolved?.category ?? null,
    sourceDetail: input.resolved?.sourceDetail ?? null,
    missingReason:
      displayName === INGREDIENT_IDENTITY_UNAVAILABLE
        ? input.resolved?.missingReason ?? INGREDIENT_IDENTITY_UNAVAILABLE
        : input.resolved?.missingReason ?? null,
  };
}

export function presentationsMatch(
  left: RecipeLinePresentation,
  right: RecipeLinePresentation,
): boolean {
  return (
    left.lineId === right.lineId &&
    left.displayName === right.displayName &&
    left.classification === right.classification &&
    left.sourceLabel === right.sourceLabel &&
    left.costLabel === right.costLabel &&
    left.quantity === right.quantity &&
    left.unit === right.unit &&
    left.conversionSummary === right.conversionSummary
  );
}

function formatQuantity(value: number) {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(4)));
}
