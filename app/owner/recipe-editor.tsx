import Ionicons from "@expo/vector-icons/Ionicons";
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  GabiPrimaryButton,
  GabiSoftButton,
} from "@/components/gabi/GabiButton";
import {
  GabiEmptyState,
  GabiNotice,
  GabiSnackbar,
} from "@/components/gabi/GabiFeedback";
import {
  GabiCard,
  GabiChip,
  GabiIconButton,
  GabiSectionHeader,
} from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import {
  RecipeFirstChoiceRow,
  RecipeFirstCostSummary,
  RecipeFirstField,
  RecipeFirstModePicker,
  RecipeFirstStepHeader,
  type RecipeFirstCostSummaryValue,
} from "@/components/owner/RecipeFirstEditorUI";
import { formatPeso, formatQuantity } from "@/components/ui/KitaMoUI";
import {
  makeRecipeDraftLineId,
  makeUnitConversionId,
} from "@/domain/ids";
import {
  calculatePreparedBatchCost,
  calculateSimpleIngredientCost,
  convertRecipeQuantity,
  costStateForSource,
  RECIPE_FIRST_UNITS,
  type RecipeFirstCostSource,
  type RecipeFirstUnit,
} from "@/domain/recipeFirst";
import {
  addGroceryPurchase,
  loadGroceryPoolSnapshot,
} from "@/services/groceryPool";
import { loadOwnerSetupStatus } from "@/services/ownerSetup";
import {
  addQuickEstimatedPreparedInput,
  beginNestedPreparedRecipeDraft,
  completePreparedItemRecipe,
  createRecipeFirstUnitConversion,
  loadRecipeFirstDraft,
  loadRecipeLibrary,
  publishRecipeFirstDraft,
  saveRecipeFirstDraftSnapshot,
  startRecipeFirstDraft,
  type RecipeFirstDraftSnapshot,
  type RecipeFirstLibraryEntry,
  type RecipeFirstMode,
} from "@/services/recipeFirst";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import {
  getFriendlyErrorMessage,
  getUserSafeErrorMessage,
  logDevError,
} from "@/utils/errors";

type EditorStep = 1 | 2 | 3;
type IngredientSheet =
  | "sources"
  | "grocery"
  | "prepared"
  | "estimate"
  | "new_raw"
  | "nested"
  | null;
type DraftLine = RecipeFirstDraftSnapshot["lines"][number];
type GrocerySnapshot = Awaited<ReturnType<typeof loadGroceryPoolSnapshot>>;
type GroceryLot = GrocerySnapshot["lots"][number];

const editorStepNames = ["definition", "inputs", "review"] as const;
const PURCHASE_UNITS = ["g", "kg", "ml", "l", "pcs", "pack"] as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositive(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseOptionalNonNegative(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function packageConversionFactor(
  purchaseUnit: string,
  usageUnit: string,
  piecesPerPack: number | null,
  portionsPerPiece: number | null,
) {
  if (purchaseUnit === usageUnit) return null;
  if (purchaseUnit === "pack" && usageUnit === "pcs" && piecesPerPack) {
    return 1 / piecesPerPack;
  }
  if (
    purchaseUnit === "pack" &&
    usageUnit === "portion" &&
    piecesPerPack &&
    portionsPerPiece
  ) {
    return 1 / (piecesPerPack * portionsPerPiece);
  }
  if (
    purchaseUnit === "pcs" &&
    usageUnit === "portion" &&
    portionsPerPiece
  ) {
    return 1 / portionsPerPiece;
  }
  return null;
}

function modeFromSnapshot(
  snapshot: RecipeFirstDraftSnapshot,
): RecipeFirstMode {
  if (snapshot.draft.classificationProposal === "finished_product") {
    return "finished_per_unit";
  }
  if (snapshot.draft.classificationProposal === "prepared_base") {
    return "prepared_batch";
  }
  return "unsure";
}

function saveableLine(line: DraftLine) {
  return {
    id: line.id,
    sourceKind: line.sourceKind,
    catalogItemId: line.catalogItemId,
    childRecipeVersionId: line.childRecipeVersionId,
    childDraftId: line.childDraftId,
    customName: line.customName,
    quantity: line.quantity,
    unit: line.unit,
    normalizedQuantity: line.normalizedQuantity,
    normalizedUnit: line.normalizedUnit,
    conversionId: line.conversionId,
    conversionFactorSnapshot: line.conversionFactorSnapshot,
    role: line.role,
    isOptional: line.isOptional,
    costOverride: line.costOverride,
    costState: line.costState,
    costSource: line.costSource,
    costProfileId: line.costProfileId,
    allocationMode: line.allocationMode,
    legacyIngredientLotId: line.legacyIngredientLotId,
    notes: line.notes,
  };
}

function draftLineLabel(line: DraftLine) {
  return (
    line.customName ??
    (line.sourceKind === "child_draft"
      ? "Prepared recipe draft"
      : line.sourceKind === "unresolved"
        ? "Prepared ingredient to complete"
        : "Recorded ingredient")
  );
}

function lineAmount(line: DraftLine) {
  if (line.costState !== "known" || line.costOverride === null) return null;
  if (line.sourceKind === "custom_cost") return line.costOverride;
  return line.costOverride * (line.quantity ?? 0);
}

function domainCostSource(line: DraftLine): RecipeFirstCostSource {
  if (line.costSource === "purchase_lot") return "purchase_lot";
  if (line.costSource === "recipe_version") return "prepared_recipe";
  if (line.costSource === "owner_estimate") return "owner_estimate";
  if (line.costSource === "custom") return "custom";
  if (line.costSource === "legacy_snapshot") return "legacy_snapshot";
  return "unknown";
}

function activeCostProfile(snapshot: RecipeFirstDraftSnapshot | null) {
  return (
    snapshot?.costProfiles.find((profile) => profile.status === "active") ??
    null
  );
}

export default function OwnerRecipeEditorScreen() {
  const params = useLocalSearchParams<{
    draftId?: string | string[];
    mode?: string | string[];
    step?: string | string[];
  }>();
  const requestedDraftId = firstParam(params.draftId);
  const requestedMode = firstParam(params.mode);
  const requestedStep = firstParam(params.step);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette } = useGabiTheme();

  const [snapshot, setSnapshot] =
    useState<RecipeFirstDraftSnapshot | null>(null);
  const snapshotRef = useRef<RecipeFirstDraftSnapshot | null>(null);
  const [library, setLibrary] = useState<RecipeFirstLibraryEntry[]>([]);
  const [grocery, setGrocery] = useState<GrocerySnapshot | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const saveLock = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const [step, setStep] = useState<EditorStep>(
    requestedStep === "2" ? 2 : requestedStep === "3" ? 3 : 1,
  );
  const [mode, setMode] = useState<RecipeFirstMode | null>(
    requestedMode === "finished_per_unit" ||
      requestedMode === "prepared_batch" ||
      requestedMode === "unsure"
      ? requestedMode
      : null,
  );
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [category, setCategory] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [yieldQuantity, setYieldQuantity] = useState("");
  const [yieldUnit, setYieldUnit] = useState<RecipeFirstUnit>("g");

  const [ingredientSheet, setIngredientSheet] =
    useState<IngredientSheet>(null);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [usageQuantity, setUsageQuantity] = useState("");
  const [usageUnit, setUsageUnit] = useState<RecipeFirstUnit>("g");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [portionsPerPiece, setPortionsPerPiece] = useState("");

  const [estimateName, setEstimateName] = useState("");
  const [estimateCost, setEstimateCost] = useState("");
  const [estimateReferenceQuantity, setEstimateReferenceQuantity] =
    useState("");
  const [estimateReferenceUnit, setEstimateReferenceUnit] =
    useState<RecipeFirstUnit>("kg");
  const [estimateUsageQuantity, setEstimateUsageQuantity] = useState("");
  const [estimateUsageUnit, setEstimateUsageUnit] =
    useState<RecipeFirstUnit>("g");

  const [nestedName, setNestedName] = useState("");
  const [nestedUsageQuantity, setNestedUsageQuantity] = useState("");
  const [nestedUsageUnit, setNestedUsageUnit] =
    useState<RecipeFirstUnit>("g");
  const [selectedPreparedId, setSelectedPreparedId] =
    useState<string | null>(null);
  const [preparedUsageQuantity, setPreparedUsageQuantity] = useState("");
  const [preparedUsageUnit, setPreparedUsageUnit] =
    useState<RecipeFirstUnit>("g");

  const [newIngredientName, setNewIngredientName] = useState("");
  const [newPurchaseQuantity, setNewPurchaseQuantity] = useState("");
  const [newPurchaseUnit, setNewPurchaseUnit] =
    useState<(typeof PURCHASE_UNITS)[number]>("g");
  const [newPurchaseCost, setNewPurchaseCost] = useState("");
  const [newUsageQuantity, setNewUsageQuantity] = useState("");
  const [newUsageUnit, setNewUsageUnit] = useState<RecipeFirstUnit>("g");

  const applySnapshot = useCallback((next: RecipeFirstDraftSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    setMode(modeFromSnapshot(next));
    setName(next.draft.name ?? next.output.name);
    setCategory(next.draft.category ?? "");
    setNotes(next.draft.notes ?? "");
    setSellingPrice(
      next.draft.suggestedSellingPrice === null
        ? ""
        : String(next.draft.suggestedSellingPrice),
    );
    if (next.draft.expectedOutputQuantity !== null) {
      setYieldQuantity(String(next.draft.expectedOutputQuantity));
    }
    const storedUnit = next.draft.expectedOutputUnit?.toLowerCase();
    if (
      storedUnit &&
      RECIPE_FIRST_UNITS.includes(storedUnit as RecipeFirstUnit)
    ) {
      setYieldUnit(storedUnit as RecipeFirstUnit);
    }
  }, []);

  const loadEditor = useCallback(async () => {
    const status = await loadOwnerSetupStatus();
    const activeBusiness = status.activeBusiness;
    setBusinessId(activeBusiness?.id ?? null);
    setBranchId(status.activeBranch?.id ?? null);

    const [nextGrocery, nextLibrary, nextDraft] = await Promise.all([
      loadGroceryPoolSnapshot(),
      activeBusiness ? loadRecipeLibrary(activeBusiness.id) : Promise.resolve([]),
      requestedDraftId
        ? loadRecipeFirstDraft(requestedDraftId)
        : Promise.resolve(null),
    ]);
    setGrocery(nextGrocery);
    setLibrary(nextLibrary);
    if (requestedDraftId && !nextDraft) {
      throw new Error("This Recipe draft is no longer available.");
    }
    if (nextDraft) applySnapshot(nextDraft);
  }, [applySnapshot, requestedDraftId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void loadEditor()
        .then(() => {
          if (active) setMessage(null);
        })
        .catch((error) => {
          logDevError("OwnerRecipeEditor.load", error);
          if (active) {
            setMessage(
              getFriendlyErrorMessage("Could not load this Recipe draft."),
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [loadEditor]),
  );

  const persistExisting = useCallback(
    async (
      base: RecipeFirstDraftSnapshot,
      lines: DraftLine[],
      targetStep: EditorStep,
      lifecycle: "editing" | "ready" = "editing",
    ) => {
      if (!mode) throw new Error("Choose what you are creating first.");
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Product or Recipe name is required.");
      const price = parseOptionalNonNegative(sellingPrice);
      if (sellingPrice.trim() && price === null) {
        throw new Error("Selling price must be zero or higher.");
      }
      const outputQuantity =
        mode === "finished_per_unit"
          ? 1
          : targetStep === 3
            ? parsePositive(yieldQuantity)
            : base.draft.expectedOutputQuantity;
      if (
        mode === "prepared_batch" &&
        lifecycle === "ready" &&
        outputQuantity === null
      ) {
        throw new Error("Enter how much this preparation produces.");
      }
      const unresolved = lines.filter(
        (line) =>
          !line.isOptional &&
          (line.sourceKind === "unresolved" ||
            line.sourceKind === "child_draft"),
      ).length;
      const next = await saveRecipeFirstDraftSnapshot({
        draftId: base.draft.id,
        businessId: base.draft.businessId,
        expectedRevision: base.draft.autosaveRevision,
        nextRevision: base.draft.autosaveRevision + 1,
        outputCatalogItemId: base.output.catalogItemId,
        name: cleanName,
        category: category.trim() || null,
        notes: notes.trim() || null,
        expectedOutputQuantity: outputQuantity,
        expectedOutputUnit:
          mode === "finished_per_unit"
            ? "pcs"
            : outputQuantity === null
              ? null
              : yieldUnit,
        productionMode: "prepared_before_selling",
        suggestedSellingPrice:
          mode === "finished_per_unit" ? price : null,
        classificationProposal:
          mode === "finished_per_unit"
            ? "finished_product"
            : mode === "prepared_batch"
              ? "prepared_base"
              : null,
        sellingPriceState:
          mode === "finished_per_unit"
            ? price === null
              ? "unknown"
              : "known"
            : "not_applicable",
        sellable: false,
        kioskEnabled: false,
        editorStep: editorStepNames[targetStep - 1],
        lifecycle,
        unresolvedRequirementCount: unresolved,
        lines: lines.map(saveableLine),
      });
      applySnapshot(next);
      return next;
    },
    [
      applySnapshot,
      category,
      mode,
      name,
      notes,
      sellingPrice,
      yieldQuantity,
      yieldUnit,
    ],
  );

  const ensureDraft = useCallback(
    async (targetStep: EditorStep) => {
      const current = snapshotRef.current;
      if (current) {
        return persistExisting(current, current.lines, targetStep);
      }
      if (!businessId) {
        throw new Error("Choose a business before creating a Recipe.");
      }
      if (!mode) throw new Error("Choose what you are creating first.");
      if (!name.trim()) throw new Error("Product or Recipe name is required.");
      const created = await startRecipeFirstDraft({
        businessId,
        branchId,
        name: name.trim(),
        category: category.trim() || null,
        notes: notes.trim() || null,
        mode,
      });
      applySnapshot(created);
      const saved = await persistExisting(created, created.lines, targetStep);
      router.replace({
        pathname: "/owner/recipe-editor" as never,
        params: { draftId: saved.draft.id, step: String(targetStep) },
      });
      return saved;
    },
    [
      applySnapshot,
      branchId,
      businessId,
      category,
      mode,
      name,
      notes,
      persistExisting,
      router,
    ],
  );

  const runSave = useCallback(
    async <T,>(operation: () => Promise<T>) => {
      if (saveLock.current) return null;
      saveLock.current = true;
      setBusy(true);
      setMessage(null);
      try {
        return await operation();
      } catch (error) {
        logDevError("OwnerRecipeEditor.save", error);
        setMessage(
          getUserSafeErrorMessage(error, "Could not save Recipe changes."),
        );
        return null;
      } finally {
        saveLock.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const saveAndMove = useCallback(
    async (targetStep: EditorStep) => {
      const saved = await runSave(() => ensureDraft(targetStep));
      if (!saved) return;
      setStep(targetStep);
      setSnackbar("Draft saved");
    },
    [ensureDraft, runSave],
  );

  const exitEditor = useCallback(async () => {
    const current = snapshotRef.current;
    if (current && saveLock.current) {
      setMessage("Please wait for the current Recipe save to finish.");
      return;
    }
    if (current && !saveLock.current) {
      const saved = await runSave(() =>
        persistExisting(current, current.lines, step, "editing"),
      );
      if (!saved) return;
    } else if (!current && businessId && mode && name.trim()) {
      const saved = await runSave(() => ensureDraft(step));
      if (!saved) return;
    } else if (!current) {
      Alert.alert(
        "Discard this new Recipe?",
        "Choose what you are creating and enter a name to save a draft, or discard this blank form.",
        [
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard Blank Form",
            style: "destructive",
            onPress: () => router.replace("/owner/recipes"),
          },
        ],
      );
      return;
    }
    const returnRoute = snapshotRef.current?.draft.returnRoute;
    if (returnRoute) router.replace(returnRoute as never);
    else router.replace("/owner/recipes");
  }, [
    businessId,
    ensureDraft,
    mode,
    name,
    persistExisting,
    router,
    runSave,
    step,
  ]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          void exitEditor();
          return true;
        },
      );
      return () => subscription.remove();
    }, [exitEditor]),
  );

  const visibleLots = useMemo(() => {
    const query = ingredientSearch.trim().toLocaleLowerCase();
    return (grocery?.lots ?? [])
      .filter((lot) => lot.status !== "archived")
      .filter((lot) =>
        query
          ? [lot.ingredientName, lot.brandName ?? "", lot.sourceName ?? ""]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)
          : true,
      )
      .slice(0, 12);
  }, [grocery?.lots, ingredientSearch]);

  const selectedLot =
    grocery?.lots.find((lot) => lot.id === selectedLotId) ?? null;

  const preparedEntries = useMemo(
    () =>
      library.filter(
        (entry) =>
          entry.classification === "prepared_base" &&
          entry.lifecycle !== "archived" &&
          Boolean(entry.activeVersionId) &&
          entry.activeCostSource === "recipe_version" &&
          Boolean(entry.activeCostProfileId) &&
          entry.activeCostTotal !== null &&
          entry.activeCostReferenceQuantity !== null &&
          entry.activeCostReferenceQuantity > 0 &&
          Boolean(entry.activeCostReferenceUnit),
      ),
    [library],
  );
  const selectedPrepared =
    preparedEntries.find(
      (entry) => entry.catalogItemId === selectedPreparedId,
    ) ?? null;
  const preparedPreview = useMemo(() => {
    const quantity = parsePositive(preparedUsageQuantity);
    if (
      !selectedPrepared ||
      quantity === null ||
      selectedPrepared.activeCostTotal === null ||
      selectedPrepared.activeCostReferenceQuantity === null ||
      !selectedPrepared.activeCostReferenceUnit
    ) {
      return null;
    }
    return calculateSimpleIngredientCost({
      costSource: "prepared_recipe",
      purchaseCost: selectedPrepared.activeCostTotal,
      purchasedQuantity: selectedPrepared.activeCostReferenceQuantity,
      purchaseUnit: selectedPrepared.activeCostReferenceUnit,
      usageQuantity: quantity,
      usageUnit: preparedUsageUnit,
    });
  }, [preparedUsageQuantity, preparedUsageUnit, selectedPrepared]);

  const libraryCatalogIdForLot = useCallback(
    (lot: GroceryLot) =>
      library.find(
        (entry) =>
          "ingredientId" in entry &&
          (entry as RecipeFirstLibraryEntry & { ingredientId: string | null })
            .ingredientId === lot.ingredientId,
      )?.catalogItemId ?? null,
    [library],
  );

  const addGroceryIngredient = useCallback(async () => {
    const lot = selectedLot;
    const quantity = parsePositive(usageQuantity);
    if (!lot || quantity === null) {
      setMessage("Choose a Grocery lot and enter a positive usage amount.");
      return;
    }
    const catalogItemId = libraryCatalogIdForLot(lot);
    if (!catalogItemId) {
      setMessage(
        "This Grocery item is not linked to the Recipe library yet. Refresh after catalog reconciliation.",
      );
      return;
    }
    const calculation = calculateSimpleIngredientCost({
      costSource:
        lot.costState === "known" ? "purchase_lot" : "unknown",
      purchaseCost:
        lot.costState === "known"
          ? (lot.recordedTotalCost ?? lot.totalCost)
          : null,
      purchasedQuantity: lot.purchasedQuantity,
      purchaseUnit: lot.unit,
      piecesPerPack: parsePositive(piecesPerPack),
      portionsPerPiece: parsePositive(portionsPerPiece),
      usageQuantity: quantity,
      usageUnit,
    });
    if (calculation.issue) {
      setMessage(
        "These purchase and usage units cannot be safely converted. Check Advanced details or use the lot unit.",
      );
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const conversionFactor = packageConversionFactor(
      lot.unit,
      usageUnit,
      parsePositive(piecesPerPack),
      parsePositive(portionsPerPiece),
    );
    const conversionId = conversionFactor ? makeUnitConversionId() : null;
    const conversionSaved = conversionFactor
      ? await runSave(() =>
          createRecipeFirstUnitConversion({
            id: conversionId as string,
            businessId: base.draft.businessId,
            catalogItemId,
            fromUnit: usageUnit,
            toUnit: lot.unit,
            factor: conversionFactor,
          }),
        )
      : null;
    if (conversionFactor && !conversionSaved) return;
    const line: DraftLine = {
      id: makeRecipeDraftLineId(),
      businessId: base.draft.businessId,
      recipeDraftId: base.draft.id,
      sortOrder: base.lines.length,
      sourceKind: "catalog_item",
      catalogItemId,
      childRecipeVersionId: null,
      childDraftId: null,
      customName: lot.ingredientName,
      quantity,
      unit: usageUnit,
      normalizedQuantity:
        conversionFactor === null ? null : quantity * conversionFactor,
      normalizedUnit: conversionFactor === null ? null : lot.unit,
      conversionId,
      conversionFactorSnapshot: conversionFactor,
      role: "main",
      isOptional: false,
      costOverride: calculation.costPerUsageUnit,
      costState: calculation.state === "no_price" ? "unknown" : "known",
      costSource: "purchase_lot",
      costProfileId: null,
      allocationMode: "legacy_selected",
      legacyIngredientLotId: lot.id,
      notes:
        showAdvanced && (piecesPerPack || portionsPerPiece)
          ? `Package details: ${piecesPerPack || "—"} pieces per pack; ${portionsPerPiece || "—"} portions per piece.`
          : null,
    };
    const saved = await runSave(() =>
      persistExisting(base, [...base.lines, line], 2),
    );
    if (!saved) return;
    closeIngredientSheet();
    setSnackbar(`${lot.ingredientName} added`);
  }, [
    ensureDraft,
    libraryCatalogIdForLot,
    persistExisting,
    piecesPerPack,
    portionsPerPiece,
    runSave,
    selectedLot,
    showAdvanced,
    usageQuantity,
    usageUnit,
  ]);

  const addEstimate = useCallback(async () => {
    const totalCost = parseOptionalNonNegative(estimateCost);
    const referenceQuantity = parsePositive(estimateReferenceQuantity);
    const quantity = parsePositive(estimateUsageQuantity);
    if (
      !estimateName.trim() ||
      totalCost === null ||
      referenceQuantity === null ||
      quantity === null
    ) {
      setMessage(
        "Enter the prepared ingredient, estimate, reference quantity, and usage.",
      );
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;

    let serviceReferenceQuantity = referenceQuantity;
    let serviceReferenceUnit: string =
      estimateReferenceUnit === "l" ? "L" : estimateReferenceUnit;
    let serviceUsageUnit: string =
      estimateUsageUnit === "l" ? "L" : estimateUsageUnit;
    const pieces = parsePositive(piecesPerPack);
    const portions = parsePositive(portionsPerPiece);
    if (showAdvanced && estimateReferenceUnit === "pack" && pieces) {
      serviceReferenceQuantity = referenceQuantity * pieces * (portions ?? 1);
      serviceReferenceUnit = portions ? "portion" : "pcs";
      serviceUsageUnit = serviceReferenceUnit;
      if (estimateUsageUnit !== serviceUsageUnit) {
        setMessage(
          `For these package details, choose ${serviceUsageUnit} as the usage unit.`,
        );
        return;
      }
    }

    const result = await runSave(() =>
      addQuickEstimatedPreparedInput({
        requestToken: `ui-estimate:${base.draft.id}:${Date.now()}`,
        businessId: base.draft.businessId,
        branchId: base.draft.branchId,
        parentDraftId: base.draft.id,
        parentExpectedRevision: base.draft.autosaveRevision,
        name: estimateName.trim(),
        totalCost,
        referenceQuantity: serviceReferenceQuantity,
        referenceUnit: serviceReferenceUnit,
        usageQuantity: quantity,
        usageUnit: serviceUsageUnit,
        role: "supporting",
        notes:
          showAdvanced && pieces
            ? `Original package: ${referenceQuantity} pack; ${pieces} pieces per pack; ${portions ?? 1} portions per piece.`
            : "Temporary owner estimate. Complete the prepared batch recipe later.",
      }),
    );
    if (!result) return;
    const refreshed = await loadRecipeFirstDraft(base.draft.id);
    if (refreshed) applySnapshot(refreshed);
    closeIngredientSheet();
    setSnackbar(`${estimateName.trim()} estimate added`);
  }, [
    applySnapshot,
    ensureDraft,
    estimateCost,
    estimateName,
    estimateReferenceQuantity,
    estimateReferenceUnit,
    estimateUsageQuantity,
    estimateUsageUnit,
    piecesPerPack,
    portionsPerPiece,
    runSave,
    showAdvanced,
  ]);

  const addExistingPrepared = useCallback(async () => {
    const entry = selectedPrepared;
    const quantity = parsePositive(preparedUsageQuantity);
    if (
      !entry ||
      quantity === null ||
      !entry.activeVersionId ||
      !entry.activeCostProfileId ||
      !preparedPreview ||
      preparedPreview.issue ||
      preparedPreview.costPerUsageUnit === null
    ) {
      setMessage(
        "Choose a completed prepared Recipe and enter a compatible positive usage amount.",
      );
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const referenceUnit = entry.activeCostReferenceUnit;
    if (!referenceUnit) {
      setMessage("The prepared Recipe is missing its output unit.");
      return;
    }
    const convertedUnit = convertRecipeQuantity(
      1,
      preparedUsageUnit,
      referenceUnit,
    );
    if (!convertedUnit.ok) {
      setMessage(
        "The selected usage unit cannot be converted to this prepared Recipe output.",
      );
      return;
    }
    const requiresConversion =
      preparedUsageUnit.trim() !== referenceUnit.trim();
    const conversionId = requiresConversion ? makeUnitConversionId() : null;
    const conversion = requiresConversion
      ? await runSave(() =>
          createRecipeFirstUnitConversion({
            id: conversionId as string,
            businessId: base.draft.businessId,
            catalogItemId: entry.catalogItemId,
            fromUnit: preparedUsageUnit,
            toUnit: referenceUnit,
            factor: convertedUnit.quantity,
          }),
        )
      : null;
    if (requiresConversion && !conversion) return;
    const line: DraftLine = {
      id: makeRecipeDraftLineId(),
      businessId: base.draft.businessId,
      recipeDraftId: base.draft.id,
      sortOrder: base.lines.length,
      sourceKind: "child_recipe_version",
      catalogItemId: null,
      childRecipeVersionId: entry.activeVersionId,
      childDraftId: null,
      customName: entry.name,
      quantity,
      unit: preparedUsageUnit,
      normalizedQuantity:
        conversion === null ? null : quantity * conversion.factor,
      normalizedUnit: conversion?.toUnit ?? null,
      conversionId: conversion?.id ?? null,
      conversionFactorSnapshot: conversion?.factor ?? null,
      role: "supporting",
      isOptional: false,
      costOverride: preparedPreview.costPerUsageUnit,
      costState: "known",
      costSource: "recipe_version",
      costProfileId: entry.activeCostProfileId,
      allocationMode: "none",
      legacyIngredientLotId: null,
      notes: `Pinned prepared Recipe version ${entry.activeVersionId}.`,
    };
    const saved = await runSave(() =>
      persistExisting(base, [...base.lines, line], 2),
    );
    if (!saved) return;
    closeIngredientSheet();
    setSnackbar(`${entry.name} added`);
  }, [
    ensureDraft,
    persistExisting,
    preparedPreview,
    preparedUsageQuantity,
    preparedUsageUnit,
    runSave,
    selectedPrepared,
  ]);

  const addNewRawIngredient = useCallback(async () => {
    const purchasedQuantity = parsePositive(newPurchaseQuantity);
    const totalCost = parsePositive(newPurchaseCost);
    const quantity = parsePositive(newUsageQuantity);
    if (
      !newIngredientName.trim() ||
      purchasedQuantity === null ||
      totalCost === null ||
      quantity === null
    ) {
      setMessage(
        "Enter the ingredient name, purchase quantity, purchase cost, and Recipe usage.",
      );
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const purchase = await runSave(() =>
      addGroceryPurchase({
        ingredientName: newIngredientName.trim(),
        quantity: purchasedQuantity,
        unit: (newPurchaseUnit === "l" ? "L" : newPurchaseUnit) as
          | "g"
          | "kg"
          | "ml"
          | "L"
          | "pcs"
          | "pack",
        totalCost,
      }),
    );
    if (!purchase) return;
    const [nextGrocery, nextLibrary] = await Promise.all([
      loadGroceryPoolSnapshot(),
      loadRecipeLibrary(base.draft.businessId),
    ]);
    setGrocery(nextGrocery);
    setLibrary(nextLibrary);
    const lot = nextGrocery.lots.find(
      (candidate) => candidate.id === purchase.lot.id,
    );
    const catalogItemId = nextLibrary.find(
      (entry) => entry.ingredientId === purchase.ingredient.id,
    )?.catalogItemId;
    if (!lot || !catalogItemId) {
      setMessage(
        "The purchase was saved, but its Recipe catalog link could not be loaded. Reopen Add Ingredient to select it from Grocery.",
      );
      return;
    }
    const calculation = calculateSimpleIngredientCost({
      costSource: "purchase_lot",
      purchaseCost: totalCost,
      purchasedQuantity,
      purchaseUnit: lot.unit,
      piecesPerPack: parsePositive(piecesPerPack),
      portionsPerPiece: parsePositive(portionsPerPiece),
      usageQuantity: quantity,
      usageUnit: newUsageUnit,
    });
    if (calculation.issue || calculation.costPerUsageUnit === null) {
      setMessage(
        "The purchase was saved, but the Recipe usage units need compatible package details.",
      );
      return;
    }
    const conversionFactor = packageConversionFactor(
      lot.unit,
      newUsageUnit,
      parsePositive(piecesPerPack),
      parsePositive(portionsPerPiece),
    );
    const conversionId = conversionFactor ? makeUnitConversionId() : null;
    const conversionSaved = conversionFactor
      ? await runSave(() =>
          createRecipeFirstUnitConversion({
            id: conversionId as string,
            businessId: base.draft.businessId,
            catalogItemId,
            fromUnit: newUsageUnit,
            toUnit: lot.unit,
            factor: conversionFactor,
          }),
        )
      : null;
    if (conversionFactor && !conversionSaved) return;
    const line: DraftLine = {
      id: makeRecipeDraftLineId(),
      businessId: base.draft.businessId,
      recipeDraftId: base.draft.id,
      sortOrder: base.lines.length,
      sourceKind: "catalog_item",
      catalogItemId,
      childRecipeVersionId: null,
      childDraftId: null,
      customName: purchase.ingredient.name,
      quantity,
      unit: newUsageUnit,
      normalizedQuantity:
        conversionFactor === null ? null : quantity * conversionFactor,
      normalizedUnit: conversionFactor === null ? null : lot.unit,
      conversionId,
      conversionFactorSnapshot: conversionFactor,
      role: "main",
      isOptional: false,
      costOverride: calculation.costPerUsageUnit,
      costState: "known",
      costSource: "purchase_lot",
      costProfileId: null,
      allocationMode: "legacy_selected",
      legacyIngredientLotId: lot.id,
      notes:
        showAdvanced && (piecesPerPack || portionsPerPiece)
          ? `Package details: ${piecesPerPack || "—"} pieces per pack; ${portionsPerPiece || "—"} portions per piece.`
          : "Purchase recorded inside Recipe creation.",
    };
    const saved = await runSave(() =>
      persistExisting(base, [...base.lines, line], 2),
    );
    if (!saved) return;
    closeIngredientSheet();
    setSnackbar(`${purchase.ingredient.name} purchase and usage added`);
  }, [
    ensureDraft,
    newIngredientName,
    newPurchaseCost,
    newPurchaseQuantity,
    newPurchaseUnit,
    newUsageQuantity,
    newUsageUnit,
    persistExisting,
    piecesPerPack,
    portionsPerPiece,
    runSave,
    showAdvanced,
  ]);

  const startNestedDraft = useCallback(async () => {
    const quantity = parsePositive(nestedUsageQuantity);
    if (!nestedName.trim() || quantity === null) {
      setMessage("Enter the prepared ingredient name and usage.");
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const parentLineId = makeRecipeDraftLineId();
    const placeholder: DraftLine = {
      id: parentLineId,
      businessId: base.draft.businessId,
      recipeDraftId: base.draft.id,
      sortOrder: base.lines.length,
      sourceKind: "unresolved",
      catalogItemId: null,
      childRecipeVersionId: null,
      childDraftId: null,
      customName: nestedName.trim(),
      quantity,
      unit: nestedUsageUnit,
      normalizedQuantity: null,
      normalizedUnit: null,
      conversionId: null,
      conversionFactorSnapshot: null,
      role: "supporting",
      isOptional: false,
      costOverride: null,
      costState: "unknown",
      costSource: "unknown",
      costProfileId: null,
      allocationMode: "none",
      legacyIngredientLotId: null,
      notes: "Nested prepared recipe in progress.",
    };
    const parent = await runSave(() =>
      persistExisting(base, [...base.lines, placeholder], 2),
    );
    if (!parent) return;
    const child = await runSave(() =>
      beginNestedPreparedRecipeDraft({
        businessId: parent.draft.businessId,
        branchId: parent.draft.branchId,
        parentDraftId: parent.draft.id,
        parentLineId,
        parentExpectedRevision: parent.draft.autosaveRevision,
        returnRoute: `/owner/recipe-editor?draftId=${parent.draft.id}&step=2`,
        name: nestedName.trim(),
        category: "Prepared item",
      }),
    );
    if (!child) return;
    closeIngredientSheet();
    router.replace({
      pathname: "/owner/recipe-editor" as never,
      params: { draftId: child.draft.id, step: "1" },
    });
  }, [
    ensureDraft,
    nestedName,
    nestedUsageQuantity,
    nestedUsageUnit,
    persistExisting,
    router,
    runSave,
  ]);

  function closeIngredientSheet() {
    setIngredientSheet(null);
    setIngredientSearch("");
    setSelectedLotId(null);
    setUsageQuantity("");
    setEstimateName("");
    setEstimateCost("");
    setEstimateReferenceQuantity("");
    setEstimateUsageQuantity("");
    setNestedName("");
    setNestedUsageQuantity("");
    setSelectedPreparedId(null);
    setPreparedUsageQuantity("");
    setNewIngredientName("");
    setNewPurchaseQuantity("");
    setNewPurchaseCost("");
    setNewUsageQuantity("");
    setShowAdvanced(false);
    setPiecesPerPack("");
    setPortionsPerPiece("");
  }

  const removeLine = useCallback(
    async (lineId: string) => {
      const current = snapshotRef.current;
      if (!current) return;
      const saved = await runSave(() =>
        persistExisting(
          current,
          current.lines.filter((line) => line.id !== lineId),
          2,
        ),
      );
      if (saved) setSnackbar("Ingredient removed");
    },
    [persistExisting, runSave],
  );

  const costSummary = useMemo<RecipeFirstCostSummaryValue>(() => {
    const lines = snapshot?.lines ?? [];
    const amounts = lines.map(lineAmount);
    const missingCostCount = lines.filter(
      (line, index) => !line.isOptional && amounts[index] === null,
    ).length;
    const estimatedInputCount = lines.filter((line) =>
      ["owner_estimate", "custom", "legacy_snapshot"].includes(line.costSource),
    ).length;
    const knownSubtotal = amounts.reduce<number>(
      (sum, amount) => sum + (amount ?? 0),
      0,
    );
    const totalCost =
      lines.length === 0 || missingCostCount > 0 ? null : knownSubtotal;
    const outputQuantity =
      mode === "finished_per_unit" ? 1 : parsePositive(yieldQuantity);
    const unitCost =
      totalCost !== null && outputQuantity !== null
        ? totalCost / outputQuantity
        : null;
    const price = parseOptionalNonNegative(sellingPrice);
    const definitionReady =
      lines.length > 0 &&
      missingCostCount === 0 &&
      (mode === "finished_per_unit" ||
        (mode === "prepared_batch" && outputQuantity !== null));
    const productionReady =
      definitionReady &&
      snapshot?.output.lifecycle === "active" &&
      snapshot.output.readinessState === "ready";
    return {
      status:
        lines.length === 0
          ? "no_price"
          : missingCostCount > 0
            ? "incomplete"
            : estimatedInputCount > 0
              ? "estimated"
              : "actual",
      totalCost,
      unitCost,
      unitLabel:
        mode === "finished_per_unit" ? "piece or serving" : yieldUnit,
      estimatedInputCount,
      missingCostCount,
      sellingPrice: mode === "finished_per_unit" ? price : null,
      grossProfit:
        mode === "finished_per_unit" &&
        price !== null &&
        unitCost !== null
          ? price - unitCost
          : null,
      definitionReady,
      productionReady,
      kioskReady:
        mode === "finished_per_unit" &&
        definitionReady &&
        productionReady &&
        price !== null &&
        snapshot?.output.sellable === true &&
        snapshot.output.kioskEnabled === true &&
        snapshot.output.productActive === true,
    };
  }, [mode, sellingPrice, snapshot, yieldQuantity, yieldUnit]);

  const estimateComparison = useMemo(() => {
    if (!snapshot) return null;
    const current = snapshot.costProfiles.find(
      (profile) =>
        profile.sourceKind === "recipe_version" &&
        profile.status === "active",
    );
    const previous = snapshot.costProfiles.find(
      (profile) =>
        profile.sourceKind === "owner_estimate" &&
        profile.status === "superseded",
    );
    return current && previous ? { current, previous } : null;
  }, [snapshot]);

  const preparedBatchSummary = useMemo(() => {
    if (mode !== "prepared_batch") return null;
    return calculatePreparedBatchCost({
      lines: (snapshot?.lines ?? []).map((line) => {
        const source = domainCostSource(line);
        return {
          id: line.id,
          source,
          state:
            line.costState === "known"
              ? costStateForSource(source)
              : line.costState === "unknown"
                ? ("no_price" as const)
                : ("incomplete" as const),
          amount: lineAmount(line),
          inputQuantity: line.normalizedQuantity ?? line.quantity,
          inputUnit: line.normalizedUnit ?? line.unit,
        };
      }),
      expectedYieldQuantity: parsePositive(yieldQuantity),
      expectedYieldUnit: yieldQuantity.trim() ? yieldUnit : null,
    });
  }, [mode, snapshot?.lines, yieldQuantity, yieldUnit]);

  const selectedLotPreview = useMemo(() => {
    if (!selectedLot) return null;
    const quantity = parsePositive(usageQuantity);
    if (quantity === null) return null;
    return calculateSimpleIngredientCost({
      costSource:
        selectedLot.costState === "known" ? "purchase_lot" : "unknown",
      purchaseCost:
        selectedLot.costState === "known"
          ? (selectedLot.recordedTotalCost ?? selectedLot.totalCost)
          : null,
      purchasedQuantity: selectedLot.purchasedQuantity,
      purchaseUnit: selectedLot.unit,
      piecesPerPack: parsePositive(piecesPerPack),
      portionsPerPiece: parsePositive(portionsPerPiece),
      usageQuantity: quantity,
      usageUnit,
    });
  }, [
    piecesPerPack,
    portionsPerPiece,
    selectedLot,
    usageQuantity,
    usageUnit,
  ]);

  const markReady = useCallback(async () => {
    if (!costSummary.definitionReady) {
      setMessage(
        "Complete the required ingredients, costs, and yield before marking this Recipe ready.",
      );
      return;
    }
    const current = snapshotRef.current;
    const saved = await runSave(() =>
      current
        ? persistExisting(current, current.lines, 3, "ready")
        : ensureDraft(3),
    );
    if (!saved || !mode) return;
    const returnRoute = saved.draft.returnRoute;
    const published = await runSave(() =>
      mode === "prepared_batch"
        ? completePreparedItemRecipe({
            businessId: saved.draft.businessId,
            draftId: saved.draft.id,
            expectedRevision: saved.draft.autosaveRevision,
            expectedActiveCostProfileId:
              activeCostProfile(saved)?.id ?? null,
          })
        : publishRecipeFirstDraft({
            businessId: saved.draft.businessId,
            draftId: saved.draft.id,
            expectedRevision: saved.draft.autosaveRevision,
            expectedActiveCostProfileId:
              activeCostProfile(saved)?.id ?? null,
            requireCompleteCost: true,
          }),
    );
    if (!published) return;
    if (returnRoute) router.replace(returnRoute as never);
    else router.replace("/owner/recipes");
  }, [
    costSummary.definitionReady,
    ensureDraft,
    mode,
    persistExisting,
    router,
    runSave,
  ]);

  if (loading) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: palette.background, paddingTop: insets.top },
        ]}
      >
        <GabiText tone="muted" variant="body">
          Loading Recipe draft…
        </GabiText>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: palette.background,
            paddingTop: insets.top + spacing.sm,
          },
        ]}
      >
        <GabiIconButton
          accessibilityLabel="Save and go back"
          icon="arrow-back"
          onPress={() => void exitEditor()}
        />
        <View style={styles.headerCopy}>
          <GabiText tone="primary" variant="eyebrow">
            Recipe Book
          </GabiText>
          <GabiText numberOfLines={1} variant="cardTitle">
            {name.trim() || "New Recipe"}
          </GabiText>
        </View>
        <GabiChip
          label={snapshot ? "Saved draft" : "Not saved yet"}
          tone={snapshot ? "success" : "warning"}
        />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {message ? <GabiNotice message={message} tone="danger" /> : null}
        {snapshot && estimateComparison ? (
          <GabiNotice
            message={`Previous estimate: ${formatPeso(estimateComparison.previous.totalCost)} per ${formatQuantity(estimateComparison.previous.referenceQuantity)} ${estimateComparison.previous.referenceUnit}. Current recipe-derived cost: ${formatPeso(estimateComparison.current.totalCost)} per ${formatQuantity(estimateComparison.current.referenceQuantity)} ${estimateComparison.current.referenceUnit}. Future calculations will use the completed ${snapshot.output.name} recipe. Previous production and sales will keep their recorded costs.`}
            title="Estimate history preserved"
            tone="success"
          />
        ) : null}
        {!businessId ? (
          <GabiNotice
            message="Choose a business in Owner settings before creating a Recipe."
            tone="warning"
          />
        ) : null}

        {step === 1 ? (
          <>
            <RecipeFirstStepHeader
              message="Create the item and its Recipe together. Paninda is not required first."
              step={1}
              title="Basic information"
            />
            <GabiCard>
              <GabiSectionHeader title="What are you creating?" />
              <RecipeFirstModePicker
                disabled={Boolean(
                  snapshot && modeFromSnapshot(snapshot) !== "unsure",
                )}
                onChange={setMode}
                selected={mode}
              />
              {snapshot ? (
                <GabiText tone="faint" variant="caption">
                  Classification is locked after the stable item identity is
                  created.
                </GabiText>
              ) : null}
            </GabiCard>

            <GabiCard>
              <RecipeFirstField
                editable={!busy}
                help={
                  mode === "prepared_batch"
                    ? "Example: Sushi Rice or Cooked Rice"
                    : "Enter the name once; the selling item is linked automatically."
                }
                label={
                  mode === "prepared_batch"
                    ? "Prepared ingredient name"
                    : "Product or Recipe name"
                }
                onChangeText={setName}
                placeholder={
                  mode === "prepared_batch"
                    ? "Example: Sushi Rice"
                    : "Example: Sausage Sushi"
                }
                value={name}
              />
              <RecipeFirstField
                editable={!busy}
                help="Optional"
                label="Category"
                onChangeText={setCategory}
                placeholder="Example: Sushi"
                value={category}
              />
              <RecipeFirstField
                editable={!busy}
                help="Optional. Preparation reminders or context for the owner."
                label="Notes"
                multiline
                onChangeText={setNotes}
                placeholder="Example: Use for the lunch menu"
                value={notes}
              />
              {mode === "finished_per_unit" ? (
                <RecipeFirstField
                  editable={!busy}
                  help="Optional. You may save without a selling price."
                  keyboardType="decimal-pad"
                  label="Selling price per piece or serving"
                  onChangeText={setSellingPrice}
                  placeholder="Example: 45"
                  value={sellingPrice}
                />
              ) : null}
              {mode === "finished_per_unit" ? (
                <GabiNotice
                  message="This Recipe always describes one piece or serving. Choose the production quantity later in Paninda."
                  tone="owner"
                />
              ) : null}
              {mode === "prepared_batch" ? (
                <GabiNotice
                  message="Add ingredients first. Expected batch yield is requested only during Review Cost."
                  tone="owner"
                />
              ) : null}
            </GabiCard>

            <GabiPrimaryButton
              disabled={!businessId || !mode || !name.trim()}
              icon="arrow-forward"
              label="Save Draft and Add Ingredients"
              loading={busy}
              onPress={() => void saveAndMove(2)}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <RecipeFirstStepHeader
              message={
                mode === "finished_per_unit"
                  ? "Enter how much each ingredient is used for one piece or serving."
                  : "Add the preparation inputs now. Yield comes in the next step."
              }
              step={2}
              title="Ingredients"
            />
            <GabiNotice
              message="Utensils, bags, and optional condiments can be added during order review."
              tone="owner"
            />

            {snapshot && snapshot.lines.length > 0 ? (
              <GabiCard>
                <GabiSectionHeader
                  action={
                    <GabiChip
                      label={`${snapshot.lines.length} ingredient${snapshot.lines.length === 1 ? "" : "s"}`}
                      tone="neutral"
                    />
                  }
                  title="Recipe ingredients"
                />
                {snapshot.lines.map((line) => (
                  <IngredientLine
                    disabled={busy}
                    key={line.id}
                    line={line}
                    onRemove={() => void removeLine(line.id)}
                  />
                ))}
              </GabiCard>
            ) : (
              <GabiCard>
                <GabiEmptyState
                  actionLabel="Add Ingredient"
                  icon="leaf-outline"
                  message="Use Grocery stock, a temporary estimate, or create a prepared recipe without leaving this flow."
                  onAction={() => setIngredientSheet("sources")}
                  title="No ingredients yet"
                />
              </GabiCard>
            )}

            <GabiPrimaryButton
              icon="add"
              label="Add Ingredient"
              onPress={() => setIngredientSheet("sources")}
            />
            <GabiSoftButton
              disabled={!snapshot || snapshot.lines.length === 0}
              icon="calculator-outline"
              label="Review Cost"
              loading={busy}
              onPress={() => void saveAndMove(3)}
            />
            <GabiSoftButton
              icon="save-outline"
              label="Save Draft"
              loading={busy}
              onPress={() => void saveAndMove(2)}
            />
            <GabiSoftButton
              icon="time-outline"
              label="Complete Later"
              onPress={() => void exitEditor()}
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <RecipeFirstStepHeader
              message="Review every cost and readiness label before marking the Recipe ready."
              step={3}
              title="Review cost"
            />

            {mode === "prepared_batch" ? (
              <GabiCard>
                <GabiSectionHeader title="How much does this preparation produce?" />
                <RecipeFirstField
                  editable={!busy}
                  help="Enter the expected yield after all ingredients are added. Actual production output is recorded in Paninda."
                  keyboardType="decimal-pad"
                  label="Expected output"
                  onChangeText={setYieldQuantity}
                  placeholder="Example: 3"
                  value={yieldQuantity}
                />
                <RecipeFirstChoiceRow
                  label="Yield unit"
                  onChange={setYieldUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={yieldUnit}
                />
              </GabiCard>
            ) : null}

            <RecipeFirstCostSummary value={costSummary} />
            {costSummary.definitionReady &&
            !costSummary.productionReady ? (
              <GabiNotice
                message="Mark Ready publishes this Recipe definition. Production and Kiosk remain blocked until the item passes the existing readiness and visibility rules."
                tone="warning"
              />
            ) : null}

            {preparedBatchSummary ? (
              <GabiCard>
                <GabiSectionHeader title="Batch and yield calculation" />
                <BatchMetric
                  label="Total expected batch cost"
                  value={
                    preparedBatchSummary.totalBatchCost === null
                      ? "Cost incomplete"
                      : formatPeso(preparedBatchSummary.totalBatchCost)
                  }
                />
                <BatchMetric
                  label="Cost per gram"
                  value={
                    preparedBatchSummary.costPerGram === null
                      ? "Not available for this yield"
                      : formatPeso(preparedBatchSummary.costPerGram)
                  }
                />
                <BatchMetric
                  label="Cost per kilogram"
                  value={
                    preparedBatchSummary.costPerKilogram === null
                      ? "Not available for this yield"
                      : formatPeso(preparedBatchSummary.costPerKilogram)
                  }
                />
                {preparedBatchSummary.costPerMilliliter !== null ||
                preparedBatchSummary.costPerLiter !== null ? (
                  <>
                    <BatchMetric
                      label="Cost per milliliter"
                      value={
                        preparedBatchSummary.costPerMilliliter === null
                          ? "Not available"
                          : formatPeso(
                              preparedBatchSummary.costPerMilliliter,
                            )
                      }
                    />
                    <BatchMetric
                      label="Cost per liter"
                      value={
                        preparedBatchSummary.costPerLiter === null
                          ? "Not available"
                          : formatPeso(preparedBatchSummary.costPerLiter)
                      }
                    />
                  </>
                ) : null}
                <BatchMetric
                  label="Yield ratio"
                  value={
                    preparedBatchSummary.yieldRatio === null
                      ? "Not available for mixed or missing input units"
                      : `${formatQuantity(preparedBatchSummary.yieldRatio)}×`
                  }
                />
                <GabiText
                  tone={
                    preparedBatchSummary.readyForProduction
                      ? "success"
                      : "warning"
                  }
                  variant="caption"
                >
                  {preparedBatchSummary.readyForProduction
                    ? "Batch cost and yield are complete."
                    : "Complete the missing cost or yield information."}
                </GabiText>
              </GabiCard>
            ) : null}

            {snapshot?.lines.map((line) => (
              <IngredientLine
                disabled
                key={line.id}
                line={line}
                onRemove={() => undefined}
              />
            ))}

            <GabiPrimaryButton
              disabled={!costSummary.definitionReady}
              icon="checkmark-circle-outline"
              label="Mark Ready"
              loading={busy}
              onPress={() => void markReady()}
            />
            <GabiSoftButton
              icon="create-outline"
              label="Edit Ingredients"
              onPress={() => setStep(2)}
            />
            <GabiSoftButton
              icon="save-outline"
              label="Save Draft"
              loading={busy}
              onPress={() => void saveAndMove(3)}
            />
            <GabiSoftButton
              icon="time-outline"
              label="Complete Later"
              onPress={() => void exitEditor()}
            />
          </>
        ) : null}
      </ScrollView>

      <IngredientModal
        advanced={showAdvanced}
        estimateCost={estimateCost}
        estimateName={estimateName}
        estimateReferenceQuantity={estimateReferenceQuantity}
        estimateReferenceUnit={estimateReferenceUnit}
        estimateUsageQuantity={estimateUsageQuantity}
        estimateUsageUnit={estimateUsageUnit}
        ingredientSearch={ingredientSearch}
        onAddEstimate={() => void addEstimate()}
        onAddGrocery={() => void addGroceryIngredient()}
        onAddNewRaw={() => void addNewRawIngredient()}
        onAddPrepared={() => void addExistingPrepared()}
        onBack={() => setIngredientSheet("sources")}
        onChangeEstimateCost={setEstimateCost}
        onChangeEstimateName={setEstimateName}
        onChangeEstimateReferenceQuantity={setEstimateReferenceQuantity}
        onChangeEstimateReferenceUnit={setEstimateReferenceUnit}
        onChangeEstimateUsageQuantity={setEstimateUsageQuantity}
        onChangeEstimateUsageUnit={setEstimateUsageUnit}
        onChangeIngredientSearch={(value) => {
          setIngredientSearch(value);
          setSelectedLotId(null);
        }}
        onChangeNewIngredientName={setNewIngredientName}
        onChangeNewPurchaseCost={setNewPurchaseCost}
        onChangeNewPurchaseQuantity={setNewPurchaseQuantity}
        onChangeNewPurchaseUnit={setNewPurchaseUnit}
        onChangeNewUsageQuantity={setNewUsageQuantity}
        onChangeNewUsageUnit={setNewUsageUnit}
        onChangeNestedName={setNestedName}
        onChangeNestedUsageQuantity={setNestedUsageQuantity}
        onChangeNestedUsageUnit={setNestedUsageUnit}
        onChangePiecesPerPack={setPiecesPerPack}
        onChangePortionsPerPiece={setPortionsPerPiece}
        onChangePreparedUsageQuantity={setPreparedUsageQuantity}
        onChangePreparedUsageUnit={setPreparedUsageUnit}
        onChangeUsageQuantity={setUsageQuantity}
        onChangeUsageUnit={setUsageUnit}
        onClose={closeIngredientSheet}
        onOpenSource={setIngredientSheet}
        onSelectLot={(lot) => {
          setSelectedLotId(lot.id);
          const normalized = lot.unit.toLowerCase() as RecipeFirstUnit;
          if (RECIPE_FIRST_UNITS.includes(normalized)) {
            setUsageUnit(normalized);
          }
        }}
        onSelectPrepared={setSelectedPreparedId}
        onStartNested={() => void startNestedDraft()}
        onToggleAdvanced={() => setShowAdvanced((current) => !current)}
        piecesPerPack={piecesPerPack}
        portionsPerPiece={portionsPerPiece}
        preparedEntries={preparedEntries}
        preparedPreview={preparedPreview}
        preparedUsageQuantity={preparedUsageQuantity}
        preparedUsageUnit={preparedUsageUnit}
        nestedName={nestedName}
        nestedUsageQuantity={nestedUsageQuantity}
        nestedUsageUnit={nestedUsageUnit}
        newIngredientName={newIngredientName}
        newPurchaseCost={newPurchaseCost}
        newPurchaseQuantity={newPurchaseQuantity}
        newPurchaseUnit={newPurchaseUnit}
        newUsageQuantity={newUsageQuantity}
        newUsageUnit={newUsageUnit}
        selectedPreparedId={selectedPreparedId}
        selectedLotId={selectedLotId}
        selectedLotPreview={selectedLotPreview}
        sheet={ingredientSheet}
        usageQuantity={usageQuantity}
        usageUnit={usageUnit}
        visibleLots={visibleLots}
      />

      {snackbar ? (
        <View
          style={[
            styles.snackbar,
            { bottom: insets.bottom + spacing.md },
          ]}
        >
          <GabiSnackbar
            message={snackbar}
            onDismiss={() => setSnackbar(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

function BatchMetric({ label, value }: { label: string; value: string }) {
  const { palette } = useGabiTheme();

  return (
    <View style={[styles.batchMetric, { borderColor: palette.border }]}>
      <GabiText tone="muted" variant="caption">
        {label}
      </GabiText>
      <GabiText money variant="buttonSm">
        {value}
      </GabiText>
    </View>
  );
}

function IngredientLine({
  line,
  disabled,
  onRemove,
}: {
  line: DraftLine;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  const amount = lineAmount(line);

  return (
    <View style={[styles.line, { borderColor: palette.border }]}>
      <View style={styles.lineCopy}>
        <GabiText variant="buttonSm">{draftLineLabel(line)}</GabiText>
        <GabiText tone="muted" variant="caption">
          {formatQuantity(line.quantity ?? 0)} {line.unit ?? "unit"}
          {line.costSource === "owner_estimate"
            ? " · Estimated prepared ingredient"
            : line.costSource === "purchase_lot"
              ? " · Exact Grocery lot"
              : line.sourceKind === "child_draft"
                ? " · Nested Recipe draft"
                : ""}
        </GabiText>
        <GabiText
          money
          tone={amount === null ? "danger" : "primary"}
          variant="caption"
        >
          {amount === null ? "Cost missing" : formatPeso(amount)}
        </GabiText>
      </View>
      {!disabled ? (
        <Pressable
          accessibilityLabel={`Remove ${draftLineLabel(line)}`}
          accessibilityRole="button"
          onPress={onRemove}
          style={[
            styles.removeButton,
            {
              backgroundColor: extended.neutralChipBg,
              borderColor: palette.border,
            },
          ]}
        >
          <Ionicons color={palette.danger} name="trash-outline" size={19} />
        </Pressable>
      ) : null}
    </View>
  );
}

type IngredientModalProps = {
  sheet: IngredientSheet;
  visibleLots: GroceryLot[];
  selectedLotId: string | null;
  selectedLotPreview: ReturnType<typeof calculateSimpleIngredientCost> | null;
  ingredientSearch: string;
  usageQuantity: string;
  usageUnit: RecipeFirstUnit;
  advanced: boolean;
  piecesPerPack: string;
  portionsPerPiece: string;
  estimateName: string;
  estimateCost: string;
  estimateReferenceQuantity: string;
  estimateReferenceUnit: RecipeFirstUnit;
  estimateUsageQuantity: string;
  estimateUsageUnit: RecipeFirstUnit;
  preparedEntries: RecipeFirstLibraryEntry[];
  selectedPreparedId: string | null;
  preparedPreview: ReturnType<typeof calculateSimpleIngredientCost> | null;
  preparedUsageQuantity: string;
  preparedUsageUnit: RecipeFirstUnit;
  nestedName: string;
  nestedUsageQuantity: string;
  nestedUsageUnit: RecipeFirstUnit;
  newIngredientName: string;
  newPurchaseQuantity: string;
  newPurchaseUnit: (typeof PURCHASE_UNITS)[number];
  newPurchaseCost: string;
  newUsageQuantity: string;
  newUsageUnit: RecipeFirstUnit;
  onClose: () => void;
  onBack: () => void;
  onOpenSource: (sheet: Exclude<IngredientSheet, null>) => void;
  onChangeIngredientSearch: (value: string) => void;
  onSelectLot: (lot: GroceryLot) => void;
  onChangeUsageQuantity: (value: string) => void;
  onChangeUsageUnit: (value: RecipeFirstUnit) => void;
  onToggleAdvanced: () => void;
  onChangePiecesPerPack: (value: string) => void;
  onChangePortionsPerPiece: (value: string) => void;
  onAddGrocery: () => void;
  onSelectPrepared: (catalogItemId: string) => void;
  onChangePreparedUsageQuantity: (value: string) => void;
  onChangePreparedUsageUnit: (value: RecipeFirstUnit) => void;
  onAddPrepared: () => void;
  onChangeEstimateName: (value: string) => void;
  onChangeEstimateCost: (value: string) => void;
  onChangeEstimateReferenceQuantity: (value: string) => void;
  onChangeEstimateReferenceUnit: (value: RecipeFirstUnit) => void;
  onChangeEstimateUsageQuantity: (value: string) => void;
  onChangeEstimateUsageUnit: (value: RecipeFirstUnit) => void;
  onAddEstimate: () => void;
  onChangeNewIngredientName: (value: string) => void;
  onChangeNewPurchaseQuantity: (value: string) => void;
  onChangeNewPurchaseUnit: (
    value: (typeof PURCHASE_UNITS)[number],
  ) => void;
  onChangeNewPurchaseCost: (value: string) => void;
  onChangeNewUsageQuantity: (value: string) => void;
  onChangeNewUsageUnit: (value: RecipeFirstUnit) => void;
  onAddNewRaw: () => void;
  onChangeNestedName: (value: string) => void;
  onChangeNestedUsageQuantity: (value: string) => void;
  onChangeNestedUsageUnit: (value: RecipeFirstUnit) => void;
  onStartNested: () => void;
};

function IngredientModal(props: IngredientModalProps) {
  const { palette, extended } = useGabiTheme();
  const insets = useSafeAreaInsets();
  const selectedLot =
    props.visibleLots.find((lot) => lot.id === props.selectedLotId) ?? null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      transparent
      visible={props.sheet !== null}
    >
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: palette.background,
              paddingBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            {props.sheet !== "sources" ? (
              <GabiIconButton
                accessibilityLabel="Back to ingredient choices"
                icon="arrow-back"
                onPress={props.onBack}
              />
            ) : null}
            <View style={styles.headerCopy}>
              <GabiText tone="primary" variant="eyebrow">
                Add Ingredient
              </GabiText>
              <GabiText variant="h2">
                {props.sheet === "sources"
                  ? "Choose an ingredient source"
                  : props.sheet === "grocery"
                    ? "Use an existing Grocery lot"
                    : props.sheet === "prepared"
                      ? "Use a completed prepared recipe"
                    : props.sheet === "estimate"
                      ? "Quick estimated prepared ingredient"
                      : props.sheet === "new_raw"
                        ? "Record a new raw ingredient"
                        : "Create a prepared recipe"}
              </GabiText>
            </View>
            <GabiIconButton
              accessibilityLabel="Close ingredient form"
              icon="close"
              onPress={props.onClose}
            />
          </View>

          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {props.sheet === "sources" ? (
              <View style={styles.sourceList}>
                <SourceChoice
                  detail="Select an exact recorded purchase lot and calculate its usage cost."
                  icon="basket-outline"
                  label="Choose from Grocery"
                  onPress={() => props.onOpenSource("grocery")}
                />
                <SourceChoice
                  detail="Use the pinned version and cost of a completed prepared Recipe."
                  icon="layers-outline"
                  label="Choose an existing prepared recipe"
                  onPress={() => props.onOpenSource("prepared")}
                />
                <SourceChoice
                  detail="Use a temporary cost and complete its batch Recipe later."
                  icon="calculator-outline"
                  label="Add a quick estimated prepared ingredient"
                  onPress={() => props.onOpenSource("estimate")}
                />
                <SourceChoice
                  detail="Record a purchase and add its exact lot without leaving this Recipe."
                  icon="leaf-outline"
                  label="Record a new raw ingredient"
                  onPress={() => props.onOpenSource("new_raw")}
                />
                <SourceChoice
                  detail="Save this parent draft, create the prepared base, then return here."
                  icon="git-branch-outline"
                  label="Create a new prepared recipe"
                  onPress={() => props.onOpenSource("nested")}
                />
              </View>
            ) : null}

            {props.sheet === "grocery" ? (
              <>
                <View
                  style={[
                    styles.search,
                    {
                      backgroundColor: extended.field,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Ionicons
                    color={palette.mutedText}
                    name="search"
                    size={19}
                  />
                  <TextInput
                    onChangeText={props.onChangeIngredientSearch}
                    placeholder="Ingredient, brand, or source"
                    placeholderTextColor={extended.textFaint}
                    style={[styles.searchInput, { color: palette.text }]}
                    value={props.ingredientSearch}
                  />
                </View>
                {props.visibleLots.map((lot) => {
                  const selected = lot.id === props.selectedLotId;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={lot.id}
                      onPress={() => props.onSelectLot(lot)}
                      style={[
                        styles.lot,
                        {
                          backgroundColor: selected
                            ? palette.softPrimary
                            : palette.surface,
                          borderColor: selected
                            ? palette.primary
                            : palette.border,
                        },
                      ]}
                    >
                      <Ionicons
                        color={
                          selected ? palette.primary : extended.radioOff
                        }
                        name={
                          selected
                            ? "radio-button-on"
                            : "radio-button-off-outline"
                        }
                        size={22}
                      />
                      <View style={styles.lineCopy}>
                        <GabiText variant="buttonSm">
                          {lot.ingredientName}
                          {lot.brandName ? ` · ${lot.brandName}` : ""}
                        </GabiText>
                        <GabiText tone="muted" variant="caption">
                          {formatQuantity(lot.remainingQuantity)} {lot.unit} left
                          {lot.sourceName ? ` · ${lot.sourceName}` : ""}
                        </GabiText>
                        <GabiText
                          money
                          tone={lot.costState === "known" ? "primary" : "danger"}
                          variant="caption"
                        >
                          {lot.costState === "known"
                            ? `${formatPeso(lot.recordedCostPerUnit ?? lot.costPerUnit)}/${lot.unit}`
                            : "No purchase cost recorded"}
                        </GabiText>
                      </View>
                    </Pressable>
                  );
                })}
                {props.visibleLots.length === 0 ? (
                  <GabiEmptyState
                    icon="search-outline"
                    message="Try another search, or use a temporary estimate."
                    title="No Grocery lots found"
                  />
                ) : null}
                {selectedLot ? (
                  <>
                    <RecipeFirstField
                      help="How much is used for one piece, serving, or batch?"
                      keyboardType="decimal-pad"
                      label="Usage amount"
                      onChangeText={props.onChangeUsageQuantity}
                      placeholder="Example: 27"
                      value={props.usageQuantity}
                    />
                    <RecipeFirstChoiceRow
                      label="Usage unit"
                      onChange={props.onChangeUsageUnit}
                      options={RECIPE_FIRST_UNITS}
                      selected={props.usageUnit}
                    />
                    <AdvancedPackageFields {...props} />
                    {props.selectedLotPreview ? (
                      <GabiNotice
                        message={
                          props.selectedLotPreview.amount === null
                            ? "Cost remains unavailable until this lot has a recorded price."
                            : `Calculated usage cost: approximately ${formatPeso(props.selectedLotPreview.amount)}.`
                        }
                        tone={
                          props.selectedLotPreview.issue ? "danger" : "owner"
                        }
                      />
                    ) : null}
                    <GabiPrimaryButton
                      icon="add"
                      label="Add Grocery Ingredient"
                      onPress={props.onAddGrocery}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {props.sheet === "prepared" ? (
              <>
                <GabiNotice
                  message="Only completed prepared Recipes with exact version and recipe-derived cost evidence are available here."
                  tone="owner"
                />
                {props.preparedEntries.map((entry) => {
                  const selected =
                    entry.catalogItemId === props.selectedPreparedId;
                  const referenceCost =
                    entry.activeCostTotal !== null &&
                    entry.activeCostReferenceQuantity !== null &&
                    entry.activeCostReferenceQuantity > 0
                      ? entry.activeCostTotal /
                        entry.activeCostReferenceQuantity
                      : null;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={entry.catalogItemId}
                      onPress={() =>
                        props.onSelectPrepared(entry.catalogItemId)
                      }
                      style={[
                        styles.lot,
                        {
                          backgroundColor: selected
                            ? palette.softPrimary
                            : palette.surface,
                          borderColor: selected
                            ? palette.primary
                            : palette.border,
                        },
                      ]}
                    >
                      <Ionicons
                        color={
                          selected ? palette.primary : extended.radioOff
                        }
                        name={
                          selected
                            ? "radio-button-on"
                            : "radio-button-off-outline"
                        }
                        size={22}
                      />
                      <View style={styles.lineCopy}>
                        <GabiText variant="buttonSm">{entry.name}</GabiText>
                        <GabiText tone="muted" variant="caption">
                          Completed prepared Recipe · pinned version
                        </GabiText>
                        <GabiText money tone="primary" variant="caption">
                          {referenceCost === null
                            ? "Cost unavailable"
                            : `${formatPeso(referenceCost)}/${entry.activeCostReferenceUnit ?? "unit"}`}
                        </GabiText>
                      </View>
                    </Pressable>
                  );
                })}
                {props.preparedEntries.length === 0 ? (
                  <GabiEmptyState
                    icon="layers-outline"
                    message="Complete a prepared Recipe first, or add a quick temporary estimate."
                    title="No completed prepared Recipes"
                  />
                ) : null}
                {props.selectedPreparedId ? (
                  <>
                    <RecipeFirstField
                      help="How much is used for one piece, serving, or batch?"
                      keyboardType="decimal-pad"
                      label="Usage amount"
                      onChangeText={props.onChangePreparedUsageQuantity}
                      placeholder="Example: 27"
                      value={props.preparedUsageQuantity}
                    />
                    <RecipeFirstChoiceRow
                      label="Usage unit"
                      onChange={props.onChangePreparedUsageUnit}
                      options={RECIPE_FIRST_UNITS}
                      selected={props.preparedUsageUnit}
                    />
                    {props.preparedPreview ? (
                      <GabiNotice
                        message={
                          props.preparedPreview.amount === null
                            ? "Cost unavailable for these units."
                            : `Calculated usage cost: approximately ${formatPeso(props.preparedPreview.amount)}.`
                        }
                        tone={
                          props.preparedPreview.issue ? "danger" : "owner"
                        }
                      />
                    ) : null}
                    <GabiPrimaryButton
                      icon="add"
                      label="Add Prepared Recipe"
                      onPress={props.onAddPrepared}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {props.sheet === "estimate" ? (
              <>
                <GabiNotice
                  message="This creates a prepared ingredient with an estimated cost. It is not automatically sellable, produced, or shown in Kiosk."
                  tone="warning"
                />
                <RecipeFirstField
                  label="Prepared ingredient"
                  onChangeText={props.onChangeEstimateName}
                  placeholder="Example: Sushi Rice"
                  value={props.estimateName}
                />
                <RecipeFirstField
                  keyboardType="decimal-pad"
                  label="Estimated cost"
                  onChangeText={props.onChangeEstimateCost}
                  placeholder="Example: 80"
                  value={props.estimateCost}
                />
                <RecipeFirstField
                  help="The amount covered by the estimated cost."
                  keyboardType="decimal-pad"
                  label="Reference quantity"
                  onChangeText={props.onChangeEstimateReferenceQuantity}
                  placeholder="Example: 1"
                  value={props.estimateReferenceQuantity}
                />
                <RecipeFirstChoiceRow
                  label="Reference unit"
                  onChange={props.onChangeEstimateReferenceUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.estimateReferenceUnit}
                />
                <RecipeFirstField
                  help="How much is used for one piece, serving, or parent batch?"
                  keyboardType="decimal-pad"
                  label="Usage amount"
                  onChangeText={props.onChangeEstimateUsageQuantity}
                  placeholder="Example: 27"
                  value={props.estimateUsageQuantity}
                />
                <RecipeFirstChoiceRow
                  label="Usage unit"
                  onChange={props.onChangeEstimateUsageUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.estimateUsageUnit}
                />
                <AdvancedPackageFields {...props} />
                <GabiPrimaryButton
                  icon="calculator-outline"
                  label="Add Estimated Ingredient"
                  onPress={props.onAddEstimate}
                />
              </>
            ) : null}

            {props.sheet === "new_raw" ? (
              <>
                <GabiNotice
                  message="A Grocery purchase lot is recorded without requiring a receipt, then its exact cost is pinned to this Recipe line."
                  tone="owner"
                />
                <RecipeFirstField
                  label="Ingredient name"
                  onChangeText={props.onChangeNewIngredientName}
                  placeholder="Example: Japanese mayonnaise"
                  value={props.newIngredientName}
                />
                <RecipeFirstField
                  keyboardType="decimal-pad"
                  label="How much was purchased?"
                  onChangeText={props.onChangeNewPurchaseQuantity}
                  placeholder="Example: 500"
                  value={props.newPurchaseQuantity}
                />
                <RecipeFirstChoiceRow
                  label="Purchase unit"
                  onChange={props.onChangeNewPurchaseUnit}
                  options={PURCHASE_UNITS}
                  selected={props.newPurchaseUnit}
                />
                <RecipeFirstField
                  keyboardType="decimal-pad"
                  label="What did it cost?"
                  onChangeText={props.onChangeNewPurchaseCost}
                  placeholder="Example: 300"
                  value={props.newPurchaseCost}
                />
                <RecipeFirstField
                  help="How much is used for one piece, serving, or batch?"
                  keyboardType="decimal-pad"
                  label="Recipe usage"
                  onChangeText={props.onChangeNewUsageQuantity}
                  placeholder="Example: 5"
                  value={props.newUsageQuantity}
                />
                <RecipeFirstChoiceRow
                  label="Usage unit"
                  onChange={props.onChangeNewUsageUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.newUsageUnit}
                />
                <AdvancedPackageFields {...props} />
                <GabiPrimaryButton
                  icon="add"
                  label="Record Purchase and Add Ingredient"
                  onPress={props.onAddNewRaw}
                />
              </>
            ) : null}

            {props.sheet === "nested" ? (
              <>
                <GabiNotice
                  message="Your current Recipe is saved first. After the prepared Recipe is completed, you return to this ingredient list."
                  tone="owner"
                />
                <RecipeFirstField
                  label="Prepared ingredient name"
                  onChangeText={props.onChangeNestedName}
                  placeholder="Example: Cooked Rice"
                  value={props.nestedName}
                />
                <RecipeFirstField
                  help="How much the parent Recipe expects to use."
                  keyboardType="decimal-pad"
                  label="Usage amount"
                  onChangeText={props.onChangeNestedUsageQuantity}
                  placeholder="Example: 2.5"
                  value={props.nestedUsageQuantity}
                />
                <RecipeFirstChoiceRow
                  label="Usage unit"
                  onChange={props.onChangeNestedUsageUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.nestedUsageUnit}
                />
                <GabiPrimaryButton
                  icon="git-branch-outline"
                  label="Save Parent and Create Prepared Recipe"
                  onPress={props.onStartNested}
                />
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function AdvancedPackageFields(
  props: Pick<
    IngredientModalProps,
    | "advanced"
    | "piecesPerPack"
    | "portionsPerPiece"
    | "onToggleAdvanced"
    | "onChangePiecesPerPack"
    | "onChangePortionsPerPiece"
  >,
) {
  return (
    <GabiCard>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: props.advanced }}
        onPress={props.onToggleAdvanced}
        style={styles.advancedHeader}
      >
        <View style={styles.lineCopy}>
          <GabiText variant="buttonSm">Advanced details</GabiText>
          <GabiText tone="muted" variant="caption">
            Optional package calculation
          </GabiText>
        </View>
        <Ionicons
          name={props.advanced ? "chevron-up" : "chevron-down"}
          size={20}
        />
      </Pressable>
      {props.advanced ? (
        <>
          <RecipeFirstField
            help="Example: 18 sausages in one pack"
            keyboardType="decimal-pad"
            label="Pieces per pack"
            onChangeText={props.onChangePiecesPerPack}
            placeholder="Example: 18"
            value={props.piecesPerPack}
          />
          <RecipeFirstField
            help="Example: 4 sushi portions from each sausage"
            keyboardType="decimal-pad"
            label="Portions per piece"
            onChangeText={props.onChangePortionsPerPiece}
            placeholder="Example: 4"
            value={props.portionsPerPiece}
          />
        </>
      ) : null}
    </GabiCard>
  );
}

function SourceChoice({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  detail: string;
  onPress: () => void;
}) {
  const { palette } = useGabiTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sourceChoice,
        {
          backgroundColor: pressed ? palette.softPrimary : palette.surface,
          borderColor: palette.border,
        },
      ]}
    >
      <View
        style={[styles.sourceIcon, { backgroundColor: palette.softPrimary }]}
      >
        <Ionicons color={palette.primary} name={icon} size={23} />
      </View>
      <View style={styles.lineCopy}>
        <GabiText variant="buttonSm">{label}</GabiText>
        <GabiText tone="muted" variant="caption">
          {detail}
        </GabiText>
      </View>
      <Ionicons
        color={palette.mutedText}
        name="chevron-forward"
        size={20}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  line: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    paddingTop: spacing.md,
  },
  batchMetric: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 48,
    paddingTop: spacing.sm,
  },
  lineCopy: {
    flex: 1,
    gap: 2,
  },
  removeButton: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  snackbar: {
    left: spacing.lg,
    position: "absolute",
    right: spacing.lg,
  },
  modalBackdrop: {
    backgroundColor: "rgba(0,0,0,0.45)",
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
    minHeight: "54%",
  },
  modalHandle: {
    alignSelf: "center",
    backgroundColor: "#9CA3AF",
    borderRadius: 3,
    height: 5,
    marginTop: spacing.sm,
    width: 42,
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sourceList: {
    gap: spacing.sm,
  },
  sourceChoice: {
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 82,
    padding: spacing.md,
  },
  sourceIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  search: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    minHeight: 50,
  },
  lot: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.md,
  },
  advancedHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
  },
});
