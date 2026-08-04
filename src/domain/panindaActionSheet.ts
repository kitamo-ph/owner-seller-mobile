export type PanindaActionPolicyLike = {
  openRecipe: boolean;
  produceFromRecipe: boolean;
  editSellingItem: boolean;
  addPurchasedStock: boolean;
  manualCompatibilityStockIn: boolean;
  recordSpoilage: boolean;
  transferStock: boolean;
  listForSale: boolean;
  unlistFromSale: boolean;
  changeSellingPrice: boolean;
  archive: boolean;
  restoreFromArchive: boolean;
  requestPermanentDelete: boolean;
};

export type PanindaActionSheetLayoutInput = {
  windowHeight: number;
  topInset: number;
  bottomInset: number;
  spacingLg?: number;
  spacingMd?: number;
};

export type PanindaActionSheetLayout = {
  maxHeight: number;
  paddingBottom: number;
};

export type PanindaActionDescriptor = {
  key:
    | "listForSale"
    | "unlistFromSale"
    | "changeSellingPrice"
    | "openRecipe"
    | "produceFromRecipe"
    | "addPurchasedStock"
    | "editSellingItem"
    | "manualCompatibilityStockIn"
    | "recordSpoilage"
    | "transferStock"
    | "archive"
    | "restoreFromArchive"
    | "requestPermanentDelete";
  label: string;
  danger: boolean;
};

export type PanindaActionSheetModelInput = {
  productName: string;
  stockQty: number;
  unitType: string;
  priceLabel: string;
  classificationLabel: string;
  section: "active" | "needs_setup" | "archived";
  stockPolicy: string;
  productType: string;
  actions: PanindaActionPolicyLike;
  layout: PanindaActionSheetLayoutInput;
};

export type PanindaActionSheetRenderNode = {
  type: string;
  props: Record<string, unknown>;
  children: PanindaActionSheetRenderNode[];
};

export function buildPanindaActionSheetLayout(
  input: PanindaActionSheetLayoutInput,
): PanindaActionSheetLayout {
  const spacingLg = input.spacingLg ?? 16;
  const spacingMd = input.spacingMd ?? 12;
  return {
    maxHeight: Math.max(200, input.windowHeight - input.topInset - spacingLg),
    paddingBottom: Math.max(input.bottomInset, spacingMd),
  };
}

export function buildPanindaActionDescriptors(input: {
  actions: PanindaActionPolicyLike;
  productType: string;
}): PanindaActionDescriptor[] {
  const showManualCompatibilityStockIn =
    input.actions.manualCompatibilityStockIn &&
    (input.actions.openRecipe || input.productType !== "retail item");

  const descriptors: PanindaActionDescriptor[] = [];
  // Listing leads: for a freshly published Recipe this is the action that
  // completes the lifecycle, so it must not be buried below the fold.
  if (input.actions.listForSale) {
    descriptors.push({
      key: "listForSale",
      label: "Ilagay sa Tindahan",
      danger: false,
    });
  }
  if (input.actions.changeSellingPrice) {
    descriptors.push({
      key: "changeSellingPrice",
      label: "Palitan ang presyo",
      danger: false,
    });
  }
  if (input.actions.unlistFromSale) {
    descriptors.push({
      key: "unlistFromSale",
      label: "Alisin sa Tindahan",
      danger: false,
    });
  }
  if (input.actions.openRecipe) {
    descriptors.push({
      key: "openRecipe",
      label: "Open Recipe",
      danger: false,
    });
  }
  if (input.actions.produceFromRecipe) {
    descriptors.push({
      key: "produceFromRecipe",
      label: "Produce from Recipe",
      danger: false,
    });
  }
  if (input.actions.addPurchasedStock) {
    descriptors.push({
      key: "addPurchasedStock",
      label: "Add purchased stock",
      danger: false,
    });
  }
  if (input.actions.editSellingItem) {
    descriptors.push({
      key: "editSellingItem",
      label: "Edit selling item",
      danger: false,
    });
  }
  if (showManualCompatibilityStockIn) {
    descriptors.push({
      key: "manualCompatibilityStockIn",
      label: "Manual stock in (legacy compatibility)",
      danger: false,
    });
  }
  if (input.actions.recordSpoilage) {
    descriptors.push({
      key: "recordSpoilage",
      label: "Record spoilage",
      danger: false,
    });
  }
  if (input.actions.transferStock) {
    descriptors.push({
      key: "transferStock",
      label: "Transfer stock",
      danger: false,
    });
  }
  if (input.actions.archive) {
    descriptors.push({ key: "archive", label: "Archive", danger: false });
  }
  if (input.actions.restoreFromArchive) {
    descriptors.push({
      key: "restoreFromArchive",
      label: "Ibalik mula sa Archive",
      danger: false,
    });
  }
  if (input.actions.requestPermanentDelete) {
    descriptors.push({
      key: "requestPermanentDelete",
      label: "Delete permanently",
      danger: true,
    });
  }
  return descriptors;
}

/**
 * Builds a host-agnostic render tree for the Paninda product action sheet.
 * Behavioral checks inspect this tree rather than source-text regex matches.
 */
export function buildPanindaActionSheetTree(
  input: PanindaActionSheetModelInput,
): PanindaActionSheetRenderNode {
  const layout = buildPanindaActionSheetLayout(input.layout);
  const actions = buildPanindaActionDescriptors({
    actions: input.actions,
    productType: input.productType,
  });

  const actionNodes = actions.map((action) => ({
    type: "Action",
    props: {
      key: action.key,
      label: action.label,
      danger: action.danger,
      accessibilityLabel: action.label,
      accessibilityRole: "button",
    },
    children: [],
  }));

  const summaryChildren: PanindaActionSheetRenderNode[] = [
    {
      type: "Chip",
      props: { label: input.classificationLabel },
      children: [],
    },
  ];
  if (input.section === "needs_setup") {
    summaryChildren.push({
      type: "Chip",
      props: { label: "Needs setup" },
      children: [],
    });
  }
  if (input.section === "archived") {
    summaryChildren.push({
      type: "Chip",
      props: { label: "Archived" },
      children: [],
    });
  }

  const scrollChildren: PanindaActionSheetRenderNode[] = [
    {
      type: "View",
      props: { testID: "sheet-summary" },
      children: summaryChildren,
    },
  ];
  if (input.stockPolicy === "product_lots") {
    scrollChildren.push({
      type: "Notice",
      props: {
        message:
          "This item uses native lot evidence. Stock changes stay in a lot-aware purchase, Recipe, or Production flow so no partial scalar-only mutation is created.",
      },
      children: [],
    });
  }
  scrollChildren.push({
    type: "View",
    props: { testID: "sheet-actions" },
    children:
      actionNodes.length > 0
        ? actionNodes
        : [
            {
              type: "Text",
              props: {
                text: "This archived item is read-only. Its historical records remain preserved.",
              },
              children: [],
            },
          ],
  });

  return {
    type: "Modal",
    props: {
      onRequestClose: true,
      transparent: true,
      visible: true,
      accessibilityViewIsModal: true,
    },
    children: [
      {
        type: "Pressable",
        props: {
          testID: "sheet-scrim",
          accessibilityLabel: "Isara ang product actions",
          onPress: true,
        },
        children: [],
      },
      {
        type: "View",
        props: {
          testID: "action-sheet",
          maxHeight: layout.maxHeight,
          paddingBottom: layout.paddingBottom,
        },
        children: [
          {
            type: "View",
            props: { testID: "sheet-handle", decorative: true },
            children: [],
          },
          {
            type: "View",
            props: { testID: "sheet-header", fixed: true },
            children: [
              {
                type: "Text",
                props: {
                  testID: "sheet-title",
                  text: input.productName,
                  numberOfLines: 2,
                },
                children: [],
              },
              {
                type: "Text",
                props: {
                  text: `${input.stockQty} ${input.unitType} sa stock · ${input.priceLabel}`,
                },
                children: [],
              },
              {
                type: "Button",
                props: {
                  testID: "sheet-close",
                  label: "Isara",
                  onPress: true,
                },
                children: [],
              },
            ],
          },
          {
            type: "ScrollView",
            props: {
              testID: "sheet-scroll",
              scrollEnabled: true,
              keyboardShouldPersistTaps: "handled",
              showsVerticalScrollIndicator: true,
            },
            children: scrollChildren,
          },
        ],
      },
    ],
  };
}

export function findRenderNodes(
  root: PanindaActionSheetRenderNode,
  predicate: (node: PanindaActionSheetRenderNode) => boolean,
): PanindaActionSheetRenderNode[] {
  const matches: PanindaActionSheetRenderNode[] = [];
  const visit = (node: PanindaActionSheetRenderNode) => {
    if (predicate(node)) matches.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return matches;
}
