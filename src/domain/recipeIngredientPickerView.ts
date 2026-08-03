export const RECIPE_INGREDIENT_PICKER_GROUPS = [
  ["purchased", "Purchased Ingredients"],
  ["prepared", "Prepared Recipes"],
  ["estimated", "Estimated Prepared Items"],
  ["drafts", "Prepared Drafts"],
  ["legacy", "Legacy Recipe Inputs"],
] as const;

export type RecipeIngredientPickerGroup =
  (typeof RECIPE_INGREDIENT_PICKER_GROUPS)[number][0];

export type RecipeIngredientPickerGroupLabel =
  (typeof RECIPE_INGREDIENT_PICKER_GROUPS)[number][1];

export type RecipeIngredientPickerLibrarySeed = {
  catalogItemId: string;
  name: string;
  sourceType: string;
  classification: string;
  lifecycle: string;
  ingredientId: string | null;
  draftId: string | null;
  activeVersionId: string | null;
  activeVersionOutputQuantity: number | null;
  activeVersionOutputUnit: string | null;
  activeVersionCostStatus:
    | "actual"
    | "estimated"
    | "no_price"
    | "incomplete"
    | null;
  activeCostProfileId: string | null;
  activeCostSource: "owner_estimate" | "recipe_version" | null;
  activeCostTotal: number | null;
  activeCostReferenceQuantity: number | null;
  activeCostReferenceUnit: string | null;
};

export type RecipeIngredientPickerEntry = RecipeIngredientPickerLibrarySeed & {
  pickerGroup: RecipeIngredientPickerGroup;
  action: "select_version" | "select_estimate" | "continue_draft" | "unavailable";
  selectable: boolean;
  disabledReason: string | null;
};

export type RecipeIngredientPickerViewModel = {
  query: string;
  libraryEmpty: boolean;
  filteredEmpty: boolean;
  emptyState:
    | {
        kind: "library_empty";
        title: string;
        message: string;
      }
    | {
        kind: "search_empty";
        title: string;
        message: string;
      }
    | null;
  groups: {
    group: RecipeIngredientPickerGroup;
    label: RecipeIngredientPickerGroupLabel;
    entries: RecipeIngredientPickerEntry[];
  }[];
};

export function mapLibraryEntryToPickerEntry(
  entry: RecipeIngredientPickerLibrarySeed,
  currentOutputCatalogItemId?: string | null,
): RecipeIngredientPickerEntry | null {
  if (entry.lifecycle === "archived") return null;
  const selfReference = entry.catalogItemId === currentOutputCatalogItemId;
  if (entry.activeVersionId) {
    const canMeasure = Boolean(entry.activeVersionOutputUnit);
    return {
      ...entry,
      pickerGroup: entry.sourceType === "native" ? "prepared" : "legacy",
      action: "select_version",
      selectable: !selfReference && canMeasure,
      disabledReason: selfReference
        ? "A Recipe cannot directly use its own published version."
        : canMeasure
          ? null
          : "This Recipe version has no usable output measurement.",
    };
  }
  if (
    entry.activeCostSource === "owner_estimate" &&
    entry.activeCostProfileId &&
    entry.activeCostReferenceQuantity &&
    entry.activeCostReferenceUnit
  ) {
    return {
      ...entry,
      pickerGroup: "estimated",
      action: "select_estimate",
      selectable: !selfReference,
      disabledReason: selfReference
        ? "A Recipe cannot use its own estimate as an ingredient."
        : null,
    };
  }
  if (entry.draftId && !entry.activeVersionId) {
    return {
      ...entry,
      pickerGroup: "drafts",
      action: "continue_draft",
      selectable: false,
      disabledReason: selfReference
        ? "A Recipe cannot use its own draft as an ingredient."
        : "Continue this draft and publish a version before selecting it.",
    };
  }
  if (
    entry.ingredientId ||
    entry.classification === "purchased_ingredient" ||
    entry.classification === "supply_packaging"
  ) {
    return {
      ...entry,
      pickerGroup: "purchased",
      action: "unavailable",
      selectable: false,
      disabledReason: "Choose an exact purchase lot from Grocery.",
    };
  }
  return {
    ...entry,
    pickerGroup: "legacy",
    action: "unavailable",
    selectable: false,
    disabledReason: "This legacy item has no selectable Recipe version.",
  };
}

export function filterRecipeIngredientPickerEntries(
  entries: readonly RecipeIngredientPickerEntry[],
  query: string,
): RecipeIngredientPickerEntry[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...entries];
  return entries.filter((entry) =>
    [entry.name, entry.classification, entry.pickerGroup]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function buildRecipeIngredientPickerViewModel(input: {
  libraryEntries: readonly RecipeIngredientPickerEntry[];
  query: string;
}): RecipeIngredientPickerViewModel {
  const filtered = filterRecipeIngredientPickerEntries(
    input.libraryEntries,
    input.query,
  );
  const libraryEmpty = input.libraryEntries.length === 0;
  const filteredEmpty = filtered.length === 0;
  const groups = RECIPE_INGREDIENT_PICKER_GROUPS.map(([group, label]) => ({
    group,
    label,
    entries: filtered.filter((entry) => entry.pickerGroup === group),
  })).filter((section) => section.entries.length > 0);

  return {
    query: input.query,
    libraryEmpty,
    filteredEmpty,
    emptyState: libraryEmpty
      ? {
          kind: "library_empty",
          title: "Ingredient library is empty",
          message:
            "Record a Grocery purchase or create a prepared Recipe before choosing from the library.",
        }
      : filteredEmpty
        ? {
            kind: "search_empty",
            title: "No matching ingredient sources",
            message:
              "Try another search, clear the filter, or create the missing prepared Recipe.",
          }
        : null,
    groups,
  };
}

export type RecipeIngredientPickerRenderNode = {
  type: string;
  props: Record<string, unknown>;
  children: RecipeIngredientPickerRenderNode[];
};

export function buildRecipeIngredientPickerTree(
  model: RecipeIngredientPickerViewModel,
): RecipeIngredientPickerRenderNode {
  if (model.emptyState) {
    return {
      type: "EmptyState",
      props: {
        kind: model.emptyState.kind,
        title: model.emptyState.title,
        message: model.emptyState.message,
      },
      children: [],
    };
  }

  return {
    type: "Picker",
    props: { testID: "ingredient-library-picker" },
    children: model.groups.map((group) => ({
      type: "Group",
      props: {
        group: group.group,
        label: group.label,
        count: group.entries.length,
      },
      children: group.entries.map((entry) => ({
        type: "Entry",
        props: {
          catalogItemId: entry.catalogItemId,
          name: entry.name,
          classification: entry.classification,
          selectable: entry.selectable,
          action: entry.action,
          disabledReason: entry.disabledReason,
          continueLabel:
            entry.action === "continue_draft" ? "Continue Recipe" : null,
          showsInternalId: false,
          costStatus: entry.activeVersionCostStatus,
        },
        children: [],
      })),
    })),
  };
}

export function findPickerNodes(
  root: RecipeIngredientPickerRenderNode,
  predicate: (node: RecipeIngredientPickerRenderNode) => boolean,
): RecipeIngredientPickerRenderNode[] {
  const matches: RecipeIngredientPickerRenderNode[] = [];
  const visit = (node: RecipeIngredientPickerRenderNode) => {
    if (predicate(node)) matches.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return matches;
}
