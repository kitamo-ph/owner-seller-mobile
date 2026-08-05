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
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import { RecipeUnitSelector } from "@/components/owner/RecipeUnitSelector";
import { formatPeso, formatQuantity } from "@/components/ui/KitaMoUI";
import { buildMeasuredCostDerivationLine } from "@/domain/recipeConversionDisplay";
import { countableMeasuredConversionGuidance } from "@/domain/recipeUnitPicker";
import {
  makeRecipeDraftLineId,
  makeUnitConversionId,
} from "@/domain/ids";
import {
  buildRecipeConversionChain,
  normalizePracticalRecipeUnit,
  recipeUnitStandard,
  type RecipeConversionStep,
} from "@/domain/recipeConversionChains";
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
  RECIPE_INGREDIENT_PICKER_GROUPS,
  buildRecipeIngredientPickerViewModel,
} from "@/domain/recipeIngredientPickerView";
import { presentRecipeLineIdentity } from "@/domain/recipeLinePresentation";
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
  loadRecipeIngredientPicker,
  loadRecipeLibrary,
  publishRecipeFirstDraft,
  reconcileRemovedRecipeLineSource,
  saveRecipeFirstDraftSnapshot,
  startRecipeFirstDraft,
  type RecipeFirstDraftSnapshot,
  type RecipeFirstLibraryEntry,
  type RecipeFirstResolvedLine,
  type RecipeIngredientPickerEntry,
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
const RECIPE_LINE_ROLES: readonly DraftLine["role"][] = [
  "main",
  "supporting",
  "seasoning",
  "garnish",
  "packaging",
  "optional",
];
const LINE_REQUIREMENTS = ["Required", "Optional"] as const;
type LineRequirement = (typeof LINE_REQUIREMENTS)[number];
const COST_MEASUREMENTS = [
  "Price per amount",
  "Package breakdown",
  "Prepared batch recipe",
  "Custom conversion",
] as const;
type CostMeasurement = (typeof COST_MEASUREMENTS)[number];
type OriginalConversionEvidence = {
  lineId: string;
  inputSignature: string;
  factor: number | null;
  conversionChainJson: string | null;
  unitStandardSnapshot: string | null;
};
const PICKER_GROUPS = RECIPE_INGREDIENT_PICKER_GROUPS;

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
  customCupMilliliters: number | null = null,
) {
  if (purchaseUnit === usageUnit) return null;
  if (usageUnit === "custom_cup" && customCupMilliliters) {
    const converted = convertRecipeQuantity(
      customCupMilliliters,
      "ml",
      purchaseUnit,
    );
    return converted.ok ? converted.quantity : null;
  }
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

function calculateIngredientCostWithExplicitConversion(
  input: Parameters<typeof calculateSimpleIngredientCost>[0],
  usageToPurchaseFactor: number | null,
): ReturnType<typeof calculateSimpleIngredientCost> {
  const standard = calculateSimpleIngredientCost(input);
  if (!usageToPurchaseFactor) return standard;
  if (
    !Number.isFinite(input.purchasedQuantity) ||
    input.purchasedQuantity <= 0 ||
    !Number.isFinite(input.usageQuantity) ||
    input.usageQuantity < 0
  ) {
    return standard;
  }
  const availableUsageQuantity =
    input.purchasedQuantity / usageToPurchaseFactor;
  if (input.costSource === "unknown") {
    return {
      source: input.costSource,
      state: "no_price",
      amount: null,
      costPerUsageUnit: null,
      availableUsageQuantity,
      usageQuantity: input.usageQuantity,
      usageUnit: normalizePracticalRecipeUnit(input.usageUnit),
      issue: null,
    };
  }
  if (input.purchaseCost === null || input.purchaseCost < 0) return standard;
  const costPerUsageUnit =
    (input.purchaseCost / input.purchasedQuantity) * usageToPurchaseFactor;
  return {
    source: input.costSource,
    state: costStateForSource(input.costSource),
    amount: costPerUsageUnit * input.usageQuantity,
    costPerUsageUnit,
    availableUsageQuantity,
    usageQuantity: input.usageQuantity,
    usageUnit: normalizePracticalRecipeUnit(input.usageUnit),
    issue: null,
  };
}

function immutableConversionSnapshot(
  fromUnit: string,
  toUnit: string,
  factor: number | null,
  meaning: string,
  standard?: "metric" | "us_customary" | "imperial" | "business_custom" | "item_specific" | "package_breakdown",
) {
  if (!factor || fromUnit.trim() === toUnit.trim()) {
    return { conversionChainJson: null, unitStandardSnapshot: null };
  }
  const normalized = normalizePracticalRecipeUnit(fromUnit);
  const chain = buildRecipeConversionChain([
    {
      fromQuantity: 1,
      fromUnit,
      toQuantity: factor,
      toUnit,
      standard:
        standard ??
        (normalized ? recipeUnitStandard(normalized) : "item_specific"),
      meaning,
    },
  ]);
  if (!chain.ok) {
    throw new Error("The conversion details are inconsistent.");
  }
  return {
    conversionChainJson: JSON.stringify(chain.snapshot),
    unitStandardSnapshot: chain.snapshot.unitStandardSummary,
  };
}

function packageChainSnapshot(
  purchaseUnit: string,
  usageUnit: string,
  piecesPerPack: number | null,
  portionsPerPiece: number | null,
) {
  if (purchaseUnit === usageUnit) {
    return { conversionChainJson: null, unitStandardSnapshot: null };
  }
  const steps = [];
  if (usageUnit === "portion" && portionsPerPiece) {
    steps.push({
      fromQuantity: portionsPerPiece,
      fromUnit: "portion",
      toQuantity: 1,
      toUnit: "pcs",
      standard: "package_breakdown" as const,
      meaning: "Portions produced by each piece",
    });
  }
  if (
    purchaseUnit === "pack" &&
    piecesPerPack &&
    (usageUnit === "pcs" || usageUnit === "portion")
  ) {
    steps.push({
      fromQuantity: piecesPerPack,
      fromUnit: "pcs",
      toQuantity: 1,
      toUnit: "pack",
      standard: "package_breakdown" as const,
      meaning: "Pieces contained in each pack",
    });
  }
  if (steps.length === 0) {
    return { conversionChainJson: null, unitStandardSnapshot: null };
  }
  const chain = buildRecipeConversionChain(steps);
  if (!chain.ok) throw new Error("Package conversion steps are inconsistent.");
  return {
    conversionChainJson: JSON.stringify(chain.snapshot),
    unitStandardSnapshot: chain.snapshot.unitStandardSummary,
  };
}

function customCupChainSnapshot(
  outputUnit: string,
  customCupMilliliters: number,
) {
  const steps: RecipeConversionStep[] = [
    {
      fromQuantity: 1,
      fromUnit: "custom_cup",
      toQuantity: customCupMilliliters,
      toUnit: "ml",
      standard: "business_custom" as const,
      meaning: "Owner-defined cup volume",
    },
  ];
  if (outputUnit.toLocaleLowerCase() === "l") {
    steps.push({
      fromQuantity: 1_000,
      fromUnit: "ml",
      toQuantity: 1,
      toUnit: "l",
      standard: "metric" as const,
      meaning: "Milliliters per liter",
    });
  }
  const chain = buildRecipeConversionChain(steps);
  if (!chain.ok) throw new Error("Custom cup conversion is inconsistent.");
  return {
    conversionChainJson: JSON.stringify(chain.snapshot),
    unitStandardSnapshot: chain.snapshot.unitStandardSummary,
  };
}

function customConversionSnapshot(input: {
  fromQuantity: number | null;
  fromUnit: RecipeFirstUnit;
  toQuantity: number | null;
  toUnit: RecipeFirstUnit;
  meaning: string;
  expectedUsageUnit: string;
  expectedEvidenceUnit: string;
}) {
  if (
    input.fromQuantity === null ||
    input.toQuantity === null ||
    !input.meaning.trim()
  ) {
    return {
      ok: false as const,
      message: "Enter both conversion amounts and explain what the conversion means.",
    };
  }
  if (
    input.fromUnit.toLocaleLowerCase() !==
      input.expectedUsageUnit.trim().toLocaleLowerCase() ||
    input.toUnit.toLocaleLowerCase() !==
      input.expectedEvidenceUnit.trim().toLocaleLowerCase()
  ) {
    return {
      ok: false as const,
      message:
        "The custom conversion must start with the Recipe usage unit and end with the recorded cost unit.",
    };
  }
  if (input.fromUnit === input.toUnit) {
    return {
      ok: false as const,
      message: "A custom conversion must use two different units.",
    };
  }
  const chain = buildRecipeConversionChain([
    {
      fromQuantity: input.fromQuantity,
      fromUnit: input.expectedUsageUnit,
      toQuantity: input.toQuantity,
      toUnit: input.expectedEvidenceUnit,
      standard: "item_specific",
      meaning: input.meaning,
    },
  ]);
  if (!chain.ok) {
    return {
      ok: false as const,
      message: `The custom conversion is invalid (${chain.reason.replaceAll("_", " ")}).`,
    };
  }
  return {
    ok: true as const,
    factor: chain.snapshot.outputQuantityPerInputUnit,
    conversionChainJson: JSON.stringify(chain.snapshot),
    unitStandardSnapshot: chain.snapshot.unitStandardSummary,
  };
}

function parseSavedConversionEvidence(line: DraftLine) {
  if (!line.conversionChainJson) return null;
  try {
    const parsed = JSON.parse(line.conversionChainJson) as {
      steps?: RecipeConversionStep[];
    };
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
    const validated = buildRecipeConversionChain(parsed.steps);
    if (!validated.ok) return null;
    return validated.snapshot;
  } catch {
    return null;
  }
}

function resolveMeasuredConversion(input: {
  measurement: CostMeasurement;
  usageUnit: RecipeFirstUnit;
  evidenceUnit: string;
  piecesPerPack: number | null;
  portionsPerPiece: number | null;
  customFromQuantity: number | null;
  customFromUnit: RecipeFirstUnit;
  customToQuantity: number | null;
  customToUnit: RecipeFirstUnit;
  customMeaning: string;
}) {
  if (input.measurement === "Prepared batch recipe") {
    return {
      ok: false as const,
      message:
        "Create or choose a prepared Recipe instead of flattening this transformation into a cost conversion.",
    };
  }
  if (input.measurement === "Custom conversion") {
    const custom = customConversionSnapshot({
      fromQuantity: input.customFromQuantity,
      fromUnit: input.customFromUnit,
      toQuantity: input.customToQuantity,
      toUnit: input.customToUnit,
      meaning: input.customMeaning,
      expectedUsageUnit: input.usageUnit,
      expectedEvidenceUnit: input.evidenceUnit,
    });
    return custom.ok
      ? {
          ok: true as const,
          factor: custom.factor,
          conversionChainJson: custom.conversionChainJson,
          unitStandardSnapshot: custom.unitStandardSnapshot,
        }
      : custom;
  }
  if (input.measurement === "Package breakdown") {
    const factor = packageConversionFactor(
      input.evidenceUnit,
      input.usageUnit,
      input.piecesPerPack,
      input.portionsPerPiece,
    );
    if (factor === null) {
      return {
        ok: false as const,
        message:
          "Enter a complete package breakdown that connects the usage unit to the recorded package unit.",
      };
    }
    return {
      ok: true as const,
      factor,
      ...packageChainSnapshot(
        input.evidenceUnit,
        input.usageUnit,
        input.piecesPerPack,
        input.portionsPerPiece,
      ),
    };
  }
  const standard = convertRecipeQuantity(
    1,
    input.usageUnit,
    input.evidenceUnit,
  );
  if (!standard.ok) {
    const countableGuidance = countableMeasuredConversionGuidance(
      input.usageUnit,
      input.evidenceUnit,
    );
    return {
      ok: false as const,
      message:
        countableGuidance ??
        "These units do not have a standard conversion. Choose Package breakdown, Prepared batch recipe, or Custom conversion.",
    };
  }
  return {
    ok: true as const,
    factor:
      input.usageUnit.toLocaleLowerCase() ===
      input.evidenceUnit.trim().toLocaleLowerCase()
        ? null
        : standard.quantity,
    ...immutableConversionSnapshot(
      input.usageUnit,
      input.evidenceUnit,
      standard.quantity,
      "Standard unit conversion used by this Recipe",
    ),
  };
}

function measuredConversionInputSignature(input: {
  measurement: CostMeasurement;
  usageUnit: string;
  evidenceUnit: string;
  piecesPerPack: string;
  portionsPerPiece: string;
  customFromQuantity: string;
  customFromUnit: RecipeFirstUnit;
  customToQuantity: string;
  customToUnit: RecipeFirstUnit;
  customMeaning: string;
}) {
  return JSON.stringify({
    measurement: input.measurement,
    usageUnit: input.usageUnit.trim().toLocaleLowerCase(),
    evidenceUnit: input.evidenceUnit.trim().toLocaleLowerCase(),
    piecesPerPack: input.piecesPerPack.trim(),
    portionsPerPiece: input.portionsPerPiece.trim(),
    customFromQuantity: input.customFromQuantity.trim(),
    customFromUnit: input.customFromUnit,
    customToQuantity: input.customToQuantity.trim(),
    customToUnit: input.customToUnit,
    customMeaning: input.customMeaning.trim(),
  });
}

function editableMeasuredConversion(
  line: DraftLine,
  usageUnit: RecipeFirstUnit,
  evidenceUnit: string,
) {
  const saved = parseSavedConversionEvidence(line);
  let measurement: CostMeasurement = "Price per amount";
  let piecesPerPack = "";
  let portionsPerPiece = "";
  let customFromQuantity = "";
  let customFromUnit: RecipeFirstUnit = usageUnit;
  let customToQuantity = "";
  let customToUnit =
    (normalizePracticalRecipeUnit(evidenceUnit) as RecipeFirstUnit | null) ??
    usageUnit;
  let customMeaning = "";
  let customCupMilliliters = "";

  if (saved?.steps.some((step) => step.standard === "package_breakdown")) {
    measurement = "Package breakdown";
    const pieces = saved.steps.find(
      (step) =>
        normalizePracticalRecipeUnit(step.fromUnit) === "pcs" &&
        normalizePracticalRecipeUnit(step.toUnit) === "pack",
    );
    const portions = saved.steps.find(
      (step) =>
        normalizePracticalRecipeUnit(step.fromUnit) === "portion" &&
        normalizePracticalRecipeUnit(step.toUnit) === "pcs",
    );
    piecesPerPack = pieces
      ? String(pieces.fromQuantity / pieces.toQuantity)
      : "";
    portionsPerPiece = portions
      ? String(portions.fromQuantity / portions.toQuantity)
      : "";
  } else if (
    saved &&
    saved.steps.some((step) =>
      ["item_specific", "business_custom"].includes(step.standard),
    )
  ) {
    measurement = "Custom conversion";
    customFromQuantity = "1";
    customFromUnit =
      (normalizePracticalRecipeUnit(saved.inputUnit) as RecipeFirstUnit | null) ??
      usageUnit;
    customToQuantity = String(saved.outputQuantityPerInputUnit);
    customToUnit =
      (normalizePracticalRecipeUnit(saved.outputUnit) as RecipeFirstUnit | null) ??
      customToUnit;
    customMeaning = saved.steps.map((step) => step.meaning).join(" → ");
    const cup = saved.steps.find(
      (step) =>
        normalizePracticalRecipeUnit(step.fromUnit) === "custom_cup" &&
        normalizePracticalRecipeUnit(step.toUnit) === "ml",
    );
    customCupMilliliters = cup
      ? String(cup.toQuantity / cup.fromQuantity)
      : "";
  }

  const inputSignature = measuredConversionInputSignature({
    measurement,
    usageUnit,
    evidenceUnit,
    piecesPerPack,
    portionsPerPiece,
    customFromQuantity,
    customFromUnit,
    customToQuantity,
    customToUnit,
    customMeaning,
  });
  return {
    measurement,
    piecesPerPack,
    portionsPerPiece,
    customFromQuantity,
    customFromUnit,
    customToQuantity,
    customToUnit,
    customMeaning,
    customCupMilliliters,
    original: {
      lineId: line.id,
      inputSignature,
      factor: saved?.outputQuantityPerInputUnit ?? line.conversionFactorSnapshot,
      conversionChainJson: line.conversionChainJson,
      unitStandardSnapshot: line.unitStandardSnapshot,
    } satisfies OriginalConversionEvidence,
  };
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
    conversionChainJson: line.conversionChainJson,
    unitStandardSnapshot: line.unitStandardSnapshot,
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

function resolvedLineFor(
  snapshot: RecipeFirstDraftSnapshot | null,
  lineId: string,
) {
  return snapshot?.resolvedLines.find((line) => line.lineId === lineId) ?? null;
}

function replaceOrAppendLine(
  lines: DraftLine[],
  nextLine: DraftLine,
  editingLineId: string | null,
) {
  if (!editingLineId) return [...lines, nextLine];
  const existing = lines.find((line) => line.id === editingLineId);
  if (!existing) throw new Error("The ingredient being edited has changed.");
  return lines.map((line) =>
    line.id === editingLineId
      ? {
          ...nextLine,
          id: existing.id,
          sortOrder: existing.sortOrder,
        }
      : line,
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
  const [ingredientPicker, setIngredientPicker] =
    useState<RecipeIngredientPickerEntry[]>([]);
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
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [replacingLineSource, setReplacingLineSource] = useState(false);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [usageQuantity, setUsageQuantity] = useState("");
  const [usageUnit, setUsageUnit] = useState<RecipeFirstUnit>("g");
  const [lineRole, setLineRole] = useState<DraftLine["role"]>("main");
  const [lineRequirement, setLineRequirement] =
    useState<LineRequirement>("Required");
  const [costMeasurement, setCostMeasurement] =
    useState<CostMeasurement>("Price per amount");
  const [piecesPerPack, setPiecesPerPack] = useState("");
  const [portionsPerPiece, setPortionsPerPiece] = useState("");
  const [customCupMilliliters, setCustomCupMilliliters] = useState("");
  const [customFromQuantity, setCustomFromQuantity] = useState("");
  const [customFromUnit, setCustomFromUnit] =
    useState<RecipeFirstUnit>("portion");
  const [customToQuantity, setCustomToQuantity] = useState("");
  const [customToUnit, setCustomToUnit] =
    useState<RecipeFirstUnit>("pack");
  const [customMeaning, setCustomMeaning] = useState("");
  const [originalConversionEvidence, setOriginalConversionEvidence] =
    useState<OriginalConversionEvidence | null>(null);

  const [estimateName, setEstimateName] = useState("");
  const [estimateCost, setEstimateCost] = useState("");
  const [estimateReferenceQuantity, setEstimateReferenceQuantity] =
    useState("");
  const [estimateReferenceUnit, setEstimateReferenceUnit] =
    useState<RecipeFirstUnit>("kg");
  const [estimateUsageQuantity, setEstimateUsageQuantity] = useState("");
  const [estimateUsageUnit, setEstimateUsageUnit] =
    useState<RecipeFirstUnit>("g");
  const [estimateNotes, setEstimateNotes] = useState("");

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
    setIngredientPicker(
      activeBusiness
        ? await loadRecipeIngredientPicker(
            activeBusiness.id,
            nextDraft?.output.catalogItemId,
          )
        : [],
    );
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

  const reconcileReplacement = useCallback(
    async (
      before: RecipeFirstDraftSnapshot,
      after: RecipeFirstDraftSnapshot,
      lineId: string | null,
    ) => {
      if (!lineId) return true;
      const prior = before.lines.find((line) => line.id === lineId);
      const current = after.lines.find((line) => line.id === lineId);
      if (!prior) return true;
      const sourceChanged =
        !current ||
        current.sourceKind !== prior.sourceKind ||
        current.catalogItemId !== prior.catalogItemId ||
        current.childDraftId !== prior.childDraftId ||
        current.costSource !== prior.costSource;
      if (!sourceChanged) return true;
      const reconciled = await runSave(() =>
        reconcileRemovedRecipeLineSource({
          businessId: before.draft.businessId,
          parentDraftId: before.draft.id,
          line: prior,
        }),
      );
      return Boolean(reconciled);
    },
    [runSave],
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
    const matches = (grocery?.lots ?? [])
      .filter((lot) => lot.status !== "archived")
      .filter((lot) =>
        query
          ? [lot.ingredientName, lot.brandName ?? "", lot.sourceName ?? ""]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)
          : true,
      );
    const visible = matches.slice(0, 12);
    const selected = selectedLotId
      ? matches.find((lot) => lot.id === selectedLotId)
      : null;
    return selected && !visible.some((lot) => lot.id === selected.id)
      ? [selected, ...visible.slice(0, 11)]
      : visible;
  }, [grocery?.lots, ingredientSearch, selectedLotId]);

  const selectedLot =
    grocery?.lots.find((lot) => lot.id === selectedLotId) ?? null;

  const preparedPickerModel = useMemo(
    () =>
      buildRecipeIngredientPickerViewModel({
        libraryEntries: ingredientPicker,
        query: ingredientSearch,
      }),
    [ingredientPicker, ingredientSearch],
  );
  const preparedEntries = useMemo(
    () => preparedPickerModel.groups.flatMap((group) => group.entries),
    [preparedPickerModel],
  );
  const selectedPrepared =
    ingredientPicker.find(
      (entry) => entry.catalogItemId === selectedPreparedId,
    ) ?? null;
  const pinnedPrepared = useMemo(() => {
    if (!editingLineId || selectedPreparedId || replacingLineSource) return null;
    const line = snapshot?.lines.find(
      (candidate) => candidate.id === editingLineId,
    );
    const resolved = resolvedLineFor(snapshot, editingLineId);
    return line?.sourceKind === "child_recipe_version" &&
      line.childRecipeVersionId &&
      resolved
      ? { line, resolved }
      : null;
  }, [editingLineId, replacingLineSource, selectedPreparedId, snapshot]);
  const editingNestedDraftId = useMemo(() => {
    if (!editingLineId || replacingLineSource) return null;
    const line = snapshot?.lines.find(
      (candidate) => candidate.id === editingLineId,
    );
    return line?.sourceKind === "child_draft" ? line.childDraftId : null;
  }, [editingLineId, replacingLineSource, snapshot?.lines]);
  const preparedPreview = useMemo(() => {
    const quantity = parsePositive(preparedUsageQuantity);
    if (
      (!selectedPrepared && !pinnedPrepared) ||
      quantity === null ||
      (selectedPrepared
        ? selectedPrepared.activeCostTotal === null ||
          selectedPrepared.activeCostReferenceQuantity === null ||
          !selectedPrepared.activeCostReferenceUnit
        : pinnedPrepared?.resolved.profileTotalCost === null ||
          pinnedPrepared?.resolved.profileReferenceQuantity === null ||
          !pinnedPrepared?.resolved.profileReferenceUnit)
    ) {
      return null;
    }
    const customCupVolume = parsePositive(customCupMilliliters);
    const customConversion =
      preparedUsageUnit === "custom_cup" && customCupVolume
        ? convertRecipeQuantity(
            customCupVolume,
            "ml",
            selectedPrepared?.activeCostReferenceUnit ??
              (pinnedPrepared?.resolved.profileReferenceUnit as string),
          )
        : null;
    const explicitFactor = customConversion?.ok
      ? customConversion.quantity
      : null;
    return calculateIngredientCostWithExplicitConversion({
      costSource: "prepared_recipe",
      purchaseCost:
        selectedPrepared?.activeCostTotal ??
        (pinnedPrepared?.resolved.profileTotalCost as number),
      purchasedQuantity:
        selectedPrepared?.activeCostReferenceQuantity ??
        (pinnedPrepared?.resolved.profileReferenceQuantity as number),
      purchaseUnit:
        selectedPrepared?.activeCostReferenceUnit ??
        (pinnedPrepared?.resolved.profileReferenceUnit as string),
      usageQuantity: quantity,
      usageUnit: preparedUsageUnit,
    }, explicitFactor);
  }, [
    customCupMilliliters,
    preparedUsageQuantity,
    preparedUsageUnit,
    pinnedPrepared,
    selectedPrepared,
  ]);

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

  const resolveCurrentMeasuredConversion = useCallback(
    (usage: RecipeFirstUnit, evidence: string) => {
      const resolved = resolveMeasuredConversion({
        measurement: costMeasurement,
        usageUnit: usage,
        evidenceUnit: evidence,
        piecesPerPack: parsePositive(piecesPerPack),
        portionsPerPiece: parsePositive(portionsPerPiece),
        customFromQuantity: parsePositive(customFromQuantity),
        customFromUnit,
        customToQuantity: parsePositive(customToQuantity),
        customToUnit,
        customMeaning,
      });
      if (!resolved.ok) return resolved;
      const signature = measuredConversionInputSignature({
        measurement: costMeasurement,
        usageUnit: usage,
        evidenceUnit: evidence,
        piecesPerPack,
        portionsPerPiece,
        customFromQuantity,
        customFromUnit,
        customToQuantity,
        customToUnit,
        customMeaning,
      });
      if (
        editingLineId &&
        originalConversionEvidence?.lineId === editingLineId &&
        originalConversionEvidence.inputSignature === signature
      ) {
        return {
          ...resolved,
          factor: originalConversionEvidence.factor,
          conversionChainJson:
            originalConversionEvidence.conversionChainJson,
          unitStandardSnapshot:
            originalConversionEvidence.unitStandardSnapshot,
        };
      }
      return resolved;
    },
    [
      costMeasurement,
      customFromQuantity,
      customFromUnit,
      customMeaning,
      customToQuantity,
      customToUnit,
      editingLineId,
      originalConversionEvidence,
      piecesPerPack,
      portionsPerPiece,
    ],
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
    const conversionEvidence = resolveCurrentMeasuredConversion(
      usageUnit,
      lot.unit,
    );
    if (!conversionEvidence.ok) {
      setMessage(conversionEvidence.message);
      return;
    }
    const calculation = calculateIngredientCostWithExplicitConversion({
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
    }, conversionEvidence.factor);
    if (calculation.issue) {
      setMessage(
        "These purchase and usage units cannot be safely converted with the selected measurement.",
      );
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const conversionFactor = conversionEvidence.factor;
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
      id: editingLineId ?? makeRecipeDraftLineId(),
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
      conversionChainJson: conversionEvidence.conversionChainJson,
      unitStandardSnapshot: conversionEvidence.unitStandardSnapshot,
      role: lineRole,
      isOptional: lineRequirement === "Optional",
      costOverride: calculation.costPerUsageUnit,
      costState: calculation.state === "no_price" ? "unknown" : "known",
      costSource: "purchase_lot",
      costProfileId: null,
      allocationMode: "legacy_selected",
      legacyIngredientLotId: lot.id,
      notes:
        costMeasurement === "Package breakdown"
          ? `Package details: ${piecesPerPack || "—"} pieces per pack; ${portionsPerPiece || "—"} portions per piece.`
          : costMeasurement === "Custom conversion"
            ? `Item-specific conversion: ${customMeaning.trim()}`
            : null,
    };
    const saved = await runSave(() =>
      persistExisting(base, replaceOrAppendLine(base.lines, line, editingLineId), 2),
    );
    if (!saved) return;
    if (!(await reconcileReplacement(base, saved, editingLineId))) return;
    closeIngredientSheet();
    setSnackbar(`${lot.ingredientName} added`);
  }, [
    ensureDraft,
    costMeasurement,
    customMeaning,
    editingLineId,
    libraryCatalogIdForLot,
    lineRole,
    lineRequirement,
    persistExisting,
    piecesPerPack,
    portionsPerPiece,
    reconcileReplacement,
    resolveCurrentMeasuredConversion,
    runSave,
    selectedLot,
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

    const pieces = parsePositive(piecesPerPack);
    const portions = parsePositive(portionsPerPiece);
    const estimateConversion = resolveCurrentMeasuredConversion(
      estimateUsageUnit,
      estimateReferenceUnit,
    );
    if (!estimateConversion.ok) {
      setMessage(estimateConversion.message);
      return;
    }

    const result = await runSave(() =>
      addQuickEstimatedPreparedInput({
        requestToken: `ui-estimate:${base.draft.id}:${Date.now()}`,
        businessId: base.draft.businessId,
        branchId: base.draft.branchId,
        parentDraftId: base.draft.id,
        parentExpectedRevision: base.draft.autosaveRevision,
        parentLineId: editingLineId ?? undefined,
        name: estimateName.trim(),
        totalCost,
        referenceQuantity,
        referenceUnit: estimateReferenceUnit,
        usageQuantity: quantity,
        usageUnit: estimateUsageUnit,
        usageUnitFactorToReference: estimateConversion.factor,
        role: lineRole,
        isOptional: lineRequirement === "Optional",
        conversionChainJson: estimateConversion.conversionChainJson,
        unitStandardSnapshot: estimateConversion.unitStandardSnapshot,
        notes:
          estimateNotes.trim() ||
          (costMeasurement === "Package breakdown"
            ? `Original package: ${referenceQuantity} ${estimateReferenceUnit}; ${pieces ?? "—"} pieces per pack; ${portions ?? "—"} portions per piece.`
            : "Temporary owner estimate. Complete the prepared batch recipe later."),
      }),
    );
    if (!result) return;
    const refreshed = await loadRecipeFirstDraft(base.draft.id);
    if (refreshed) {
      applySnapshot(refreshed);
      if (!(await reconcileReplacement(base, refreshed, editingLineId))) return;
    }
    closeIngredientSheet();
    setSnackbar(
      `${estimateName.trim()} estimate ${editingLineId ? "updated" : "added"}`,
    );
  }, [
    applySnapshot,
    costMeasurement,
    editingLineId,
    ensureDraft,
    estimateCost,
    estimateName,
    estimateNotes,
    estimateReferenceQuantity,
    estimateReferenceUnit,
    estimateUsageQuantity,
    estimateUsageUnit,
    lineRole,
    lineRequirement,
    piecesPerPack,
    portionsPerPiece,
    reconcileReplacement,
    resolveCurrentMeasuredConversion,
    runSave,
  ]);

  const addExistingPrepared = useCallback(async () => {
    const entry = selectedPrepared;
    const quantity = parsePositive(preparedUsageQuantity);
    if (pinnedPrepared && quantity !== null) {
      const base = await runSave(() => ensureDraft(2));
      if (!base) return;
      const existing = base.lines.find(
        (line) => line.id === pinnedPrepared.line.id,
      );
      const evidence = resolvedLineFor(base, pinnedPrepared.line.id);
      const referenceUnit =
        evidence?.profileReferenceUnit ?? evidence?.pinnedOutputUnit;
      if (
        !existing ||
        existing.sourceKind !== "child_recipe_version" ||
        !existing.childRecipeVersionId ||
        !evidence?.sourceCatalogItemId ||
        !referenceUnit
      ) {
        setMessage("The pinned prepared Recipe version is unavailable.");
        return;
      }
      const customCupVolume = parsePositive(customCupMilliliters);
      const standardConversion = convertRecipeQuantity(
        1,
        preparedUsageUnit,
        referenceUnit,
      );
      const customConversion =
        preparedUsageUnit === "custom_cup" && customCupVolume
          ? convertRecipeQuantity(customCupVolume, "ml", referenceUnit)
          : null;
      const factor = standardConversion.ok
        ? standardConversion.quantity
        : customConversion?.ok
          ? customConversion.quantity
          : null;
      if (factor === null) {
        setMessage(
          "The edited usage unit cannot be converted to the pinned Recipe output.",
        );
        return;
      }
      const requiresConversion =
        preparedUsageUnit.trim().toLocaleLowerCase() !==
        referenceUnit.trim().toLocaleLowerCase();
      const conversion = requiresConversion
        ? await runSave(() =>
            createRecipeFirstUnitConversion({
              id: makeUnitConversionId(),
              businessId: base.draft.businessId,
              catalogItemId: evidence.sourceCatalogItemId as string,
              fromUnit: preparedUsageUnit,
              toUnit: referenceUnit,
              factor,
            }),
          )
        : null;
      if (requiresConversion && !conversion) return;
      const calculation =
        evidence.profileTotalCost !== null &&
        evidence.profileReferenceQuantity !== null &&
        evidence.profileReferenceUnit
          ? calculateIngredientCostWithExplicitConversion(
              {
                costSource: "prepared_recipe",
                purchaseCost: evidence.profileTotalCost,
                purchasedQuantity: evidence.profileReferenceQuantity,
                purchaseUnit: evidence.profileReferenceUnit,
                usageQuantity: quantity,
                usageUnit: preparedUsageUnit,
              },
              factor,
            )
          : null;
      if (calculation?.issue) {
        setMessage("The edited usage is incompatible with the pinned Recipe.");
        return;
      }
      const conversionSnapshot =
        preparedUsageUnit === "custom_cup" && customCupVolume
          ? customCupChainSnapshot(referenceUnit, customCupVolume)
          : immutableConversionSnapshot(
              preparedUsageUnit,
              referenceUnit,
              factor,
              "Pinned prepared output used by this Recipe",
            );
      const knownCost = calculation?.costPerUsageUnit ?? null;
      const updated: DraftLine = {
        ...existing,
        quantity,
        unit: preparedUsageUnit,
        normalizedQuantity: conversion ? quantity * conversion.factor : null,
        normalizedUnit: conversion?.toUnit ?? null,
        conversionId: conversion?.id ?? null,
        conversionFactorSnapshot: conversion?.factor ?? null,
        ...conversionSnapshot,
        role: lineRole,
        isOptional: lineRequirement === "Optional",
        costOverride: knownCost,
        costState: knownCost === null ? "unknown" : "known",
        costSource: knownCost === null ? "unknown" : "recipe_version",
        costProfileId: knownCost === null ? null : existing.costProfileId,
      };
      const saved = await runSave(() =>
        persistExisting(
          base,
          replaceOrAppendLine(base.lines, updated, existing.id),
          2,
        ),
      );
      if (!saved) return;
      closeIngredientSheet();
      setSnackbar(
        `${evidence.displayName} usage updated; pinned version preserved`,
      );
      return;
    }
    if (
      !entry ||
      quantity === null ||
      !entry.selectable ||
      (entry.action !== "select_version" && entry.action !== "select_estimate")
    ) {
      setMessage(
        "Choose an available prepared Recipe or estimate and enter a positive usage amount.",
      );
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const referenceUnit =
      entry.activeCostReferenceUnit ?? entry.activeVersionOutputUnit;
    if (!referenceUnit) {
      setMessage("The prepared Recipe is missing its output unit.");
      return;
    }
    const standardConvertedUnit = convertRecipeQuantity(
      1,
      preparedUsageUnit,
      referenceUnit,
    );
    const customConvertedUnit =
      preparedUsageUnit === "custom_cup" &&
      parsePositive(customCupMilliliters)
        ? convertRecipeQuantity(
            parsePositive(customCupMilliliters) as number,
            "ml",
            referenceUnit,
          )
        : null;
    const convertedQuantity = standardConvertedUnit.ok
      ? standardConvertedUnit.quantity
      : customConvertedUnit?.ok
        ? customConvertedUnit.quantity
        : null;
    if (convertedQuantity === null) {
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
            factor: convertedQuantity,
          }),
        )
      : null;
    if (requiresConversion && !conversion) return;
    const knownCost =
      preparedPreview &&
      !preparedPreview.issue &&
      preparedPreview.costPerUsageUnit !== null
        ? preparedPreview.costPerUsageUnit
        : null;
    if (entry.action === "select_estimate" && knownCost === null) {
      setMessage("This estimate no longer has usable cost evidence.");
      return;
    }
    const conversionSnapshot =
      preparedUsageUnit === "custom_cup" &&
      parsePositive(customCupMilliliters)
        ? customCupChainSnapshot(
            referenceUnit,
            parsePositive(customCupMilliliters) as number,
          )
        : immutableConversionSnapshot(
            preparedUsageUnit,
            referenceUnit,
            convertedQuantity,
            "Prepared output used by this Recipe",
          );
    const line: DraftLine = {
      id: editingLineId ?? makeRecipeDraftLineId(),
      businessId: base.draft.businessId,
      recipeDraftId: base.draft.id,
      sortOrder: base.lines.length,
      sourceKind:
        entry.action === "select_estimate"
          ? "catalog_item"
          : "child_recipe_version",
      catalogItemId:
        entry.action === "select_estimate" ? entry.catalogItemId : null,
      childRecipeVersionId:
        entry.action === "select_version" ? entry.activeVersionId : null,
      childDraftId: null,
      customName: entry.name,
      quantity,
      unit: preparedUsageUnit,
      normalizedQuantity:
        conversion === null ? null : quantity * conversion.factor,
      normalizedUnit: conversion?.toUnit ?? null,
      conversionId: conversion?.id ?? null,
      conversionFactorSnapshot: conversion?.factor ?? null,
      ...conversionSnapshot,
      role: lineRole,
      isOptional: lineRequirement === "Optional",
      costOverride: knownCost,
      costState: knownCost === null ? "unknown" : "known",
      costSource:
        knownCost === null
          ? "unknown"
          : entry.action === "select_estimate"
            ? "owner_estimate"
            : "recipe_version",
      costProfileId: knownCost === null ? null : entry.activeCostProfileId,
      allocationMode: "none",
      legacyIngredientLotId: null,
      notes:
        entry.action === "select_version"
          ? `Pinned prepared Recipe version ${entry.activeVersionId}; ${knownCost === null ? "cost incomplete" : "cost profile pinned"}.`
          : "Pinned owner estimate; complete the prepared batch Recipe later.",
    };
    const saved = await runSave(() =>
      persistExisting(base, replaceOrAppendLine(base.lines, line, editingLineId), 2),
    );
    if (!saved) return;
    if (!(await reconcileReplacement(base, saved, editingLineId))) return;
    closeIngredientSheet();
    setSnackbar(`${entry.name} added`);
  }, [
    ensureDraft,
    customCupMilliliters,
    editingLineId,
    lineRole,
    lineRequirement,
    persistExisting,
    pinnedPrepared,
    preparedPreview,
    preparedUsageQuantity,
    preparedUsageUnit,
    reconcileReplacement,
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
    const intendedPurchaseUnit = newPurchaseUnit === "l" ? "L" : newPurchaseUnit;
    const conversionEvidence = resolveCurrentMeasuredConversion(
      newUsageUnit,
      intendedPurchaseUnit,
    );
    if (!conversionEvidence.ok) {
      setMessage(conversionEvidence.message);
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    const purchase = await runSave(() =>
      addGroceryPurchase({
        ingredientName: newIngredientName.trim(),
        quantity: purchasedQuantity,
        unit: intendedPurchaseUnit as
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
    const calculation = calculateIngredientCostWithExplicitConversion({
      costSource: "purchase_lot",
      purchaseCost: totalCost,
      purchasedQuantity,
      purchaseUnit: lot.unit,
      piecesPerPack: parsePositive(piecesPerPack),
      portionsPerPiece: parsePositive(portionsPerPiece),
      usageQuantity: quantity,
      usageUnit: newUsageUnit,
    }, conversionEvidence.factor);
    if (calculation.issue || calculation.costPerUsageUnit === null) {
      setMessage(
        "The purchase was saved, but the Recipe usage units need compatible package details.",
      );
      return;
    }
    const conversionFactor = conversionEvidence.factor;
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
      id: editingLineId ?? makeRecipeDraftLineId(),
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
      conversionChainJson: conversionEvidence.conversionChainJson,
      unitStandardSnapshot: conversionEvidence.unitStandardSnapshot,
      role: lineRole,
      isOptional: lineRequirement === "Optional",
      costOverride: calculation.costPerUsageUnit,
      costState: "known",
      costSource: "purchase_lot",
      costProfileId: null,
      allocationMode: "legacy_selected",
      legacyIngredientLotId: lot.id,
      notes:
        costMeasurement === "Package breakdown"
          ? `Package details: ${piecesPerPack || "—"} pieces per pack; ${portionsPerPiece || "—"} portions per piece.`
          : costMeasurement === "Custom conversion"
            ? `Purchase recorded inside Recipe creation. Item-specific conversion: ${customMeaning.trim()}`
            : "Purchase recorded inside Recipe creation.",
    };
    const saved = await runSave(() =>
      persistExisting(base, replaceOrAppendLine(base.lines, line, editingLineId), 2),
    );
    if (!saved) return;
    if (!(await reconcileReplacement(base, saved, editingLineId))) return;
    closeIngredientSheet();
    setSnackbar(`${purchase.ingredient.name} purchase and usage added`);
  }, [
    ensureDraft,
    costMeasurement,
    customMeaning,
    editingLineId,
    newIngredientName,
    newPurchaseCost,
    newPurchaseQuantity,
    newPurchaseUnit,
    newUsageQuantity,
    newUsageUnit,
    lineRole,
    lineRequirement,
    persistExisting,
    piecesPerPack,
    portionsPerPiece,
    reconcileReplacement,
    resolveCurrentMeasuredConversion,
    runSave,
  ]);

  const startNestedDraft = useCallback(async (continueAfterSave = false) => {
    const quantity = parsePositive(nestedUsageQuantity);
    if (!nestedName.trim() || quantity === null) {
      setMessage("Enter the prepared ingredient name and usage.");
      return;
    }
    const base = await runSave(() => ensureDraft(2));
    if (!base) return;
    if (editingLineId && !replacingLineSource) {
      const existing = base.lines.find((line) => line.id === editingLineId);
      if (
        !existing ||
        existing.sourceKind !== "child_draft" ||
        !existing.childDraftId
      ) {
        setMessage("The linked prepared Recipe draft is no longer available.");
        return;
      }
      const updated: DraftLine = {
        ...existing,
        quantity,
        unit: nestedUsageUnit,
        role: lineRole,
        isOptional: lineRequirement === "Optional",
      };
      const saved = await runSave(() =>
        persistExisting(
          base,
          replaceOrAppendLine(base.lines, updated, existing.id),
          2,
        ),
      );
      if (!saved) return;
      const childDraftId = existing.childDraftId;
      closeIngredientSheet();
      if (continueAfterSave) {
        router.push({
          pathname: "/owner/recipe-editor" as never,
          params: { draftId: childDraftId },
        });
      } else {
        setSnackbar("Prepared draft usage updated");
      }
      return;
    }
    const replacedLine = editingLineId
      ? base.lines.find((line) => line.id === editingLineId)
      : null;
    if (editingLineId && !replacedLine) {
      setMessage("The ingredient changed before its source was replaced.");
      return;
    }
    const parentLineId = editingLineId ?? makeRecipeDraftLineId();
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
      conversionChainJson: null,
      unitStandardSnapshot: null,
      role: lineRole,
      isOptional: lineRequirement === "Optional",
      costOverride: null,
      costState: "unknown",
      costSource: "unknown",
      costProfileId: null,
      allocationMode: "none",
      legacyIngredientLotId: null,
      notes: "Nested prepared recipe in progress.",
    };
    const parent = await runSave(() =>
      persistExisting(
        base,
        replaceOrAppendLine(base.lines, placeholder, editingLineId),
        2,
      ),
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
    if (
      editingLineId &&
      !(await runSave(() =>
        reconcileRemovedRecipeLineSource({
          businessId: base.draft.businessId,
          parentDraftId: base.draft.id,
          line: replacedLine as DraftLine,
        }),
      ))
    ) {
      return;
    }
    closeIngredientSheet();
    router.replace({
      pathname: "/owner/recipe-editor" as never,
      params: { draftId: child.draft.id, step: "1" },
    });
  }, [
    ensureDraft,
    editingLineId,
    nestedName,
    nestedUsageQuantity,
    nestedUsageUnit,
    lineRole,
    lineRequirement,
    persistExisting,
    replacingLineSource,
    router,
    runSave,
  ]);

  function closeIngredientSheet() {
    setIngredientSheet(null);
    setEditingLineId(null);
    setReplacingLineSource(false);
    setIngredientSearch("");
    setSelectedLotId(null);
    setUsageQuantity("");
    setEstimateName("");
    setEstimateCost("");
    setEstimateReferenceQuantity("");
    setEstimateUsageQuantity("");
    setEstimateNotes("");
    setNestedName("");
    setNestedUsageQuantity("");
    setSelectedPreparedId(null);
    setPreparedUsageQuantity("");
    setNewIngredientName("");
    setNewPurchaseQuantity("");
    setNewPurchaseCost("");
    setNewUsageQuantity("");
    setCostMeasurement("Price per amount");
    setPiecesPerPack("");
    setPortionsPerPiece("");
    setCustomCupMilliliters("");
    setCustomFromQuantity("");
    setCustomFromUnit("portion");
    setCustomToQuantity("");
    setCustomToUnit("pack");
    setCustomMeaning("");
    setOriginalConversionEvidence(null);
    setLineRole("main");
    setLineRequirement("Required");
  }

  const editLine = useCallback(
    (line: DraftLine) => {
      const resolved = resolvedLineFor(snapshotRef.current, line.id);
      const prepopulateConversion = (
        usage: RecipeFirstUnit,
        evidenceUnit: string,
      ) => {
        const evidence = editableMeasuredConversion(line, usage, evidenceUnit);
        setCostMeasurement(evidence.measurement);
        setPiecesPerPack(evidence.piecesPerPack);
        setPortionsPerPiece(evidence.portionsPerPiece);
        setCustomFromQuantity(evidence.customFromQuantity);
        setCustomFromUnit(evidence.customFromUnit);
        setCustomToQuantity(evidence.customToQuantity);
        setCustomToUnit(evidence.customToUnit);
        setCustomMeaning(evidence.customMeaning);
        setCustomCupMilliliters(evidence.customCupMilliliters);
        setOriginalConversionEvidence(evidence.original);
      };
      setEditingLineId(line.id);
      setReplacingLineSource(false);
      setLineRole(line.role);
      setLineRequirement(line.isOptional ? "Optional" : "Required");
      if (line.costSource === "purchase_lot" && line.legacyIngredientLotId) {
        setSelectedLotId(line.legacyIngredientLotId);
        setUsageQuantity(String(line.quantity ?? ""));
        const normalized = line.unit?.toLocaleLowerCase() as RecipeFirstUnit;
        if (normalized && RECIPE_FIRST_UNITS.includes(normalized)) {
          setUsageUnit(normalized);
          const lot = grocery?.lots.find(
            (candidate) => candidate.id === line.legacyIngredientLotId,
          );
          prepopulateConversion(
            normalized,
            lot?.unit ?? line.normalizedUnit ?? normalized,
          );
        }
        setIngredientSheet("grocery");
        return;
      }
      if (line.costSource === "owner_estimate" && line.catalogItemId) {
        setEstimateName(resolved?.displayName ?? line.customName ?? "");
        setEstimateCost(
          resolved?.profileTotalCost === null ||
            resolved?.profileTotalCost === undefined
            ? ""
            : String(resolved.profileTotalCost),
        );
        setEstimateReferenceQuantity(
          resolved?.profileReferenceQuantity === null ||
            resolved?.profileReferenceQuantity === undefined
            ? ""
            : String(resolved.profileReferenceQuantity),
        );
        const reference = resolved?.profileReferenceUnit?.toLocaleLowerCase() as RecipeFirstUnit;
        if (reference && RECIPE_FIRST_UNITS.includes(reference)) {
          setEstimateReferenceUnit(reference);
        }
        setEstimateUsageQuantity(String(line.quantity ?? ""));
        setEstimateNotes(line.notes ?? "");
        const usage = line.unit?.toLocaleLowerCase() as RecipeFirstUnit;
        if (usage && RECIPE_FIRST_UNITS.includes(usage)) {
          setEstimateUsageUnit(usage);
          prepopulateConversion(
            usage,
            resolved?.profileReferenceUnit ?? line.normalizedUnit ?? usage,
          );
        }
        setIngredientSheet("estimate");
        return;
      }
      if (line.sourceKind === "child_recipe_version" && line.childRecipeVersionId) {
        setSelectedPreparedId(null);
        setPreparedUsageQuantity(String(line.quantity ?? ""));
        const usage = line.unit?.toLocaleLowerCase() as RecipeFirstUnit;
        if (usage && RECIPE_FIRST_UNITS.includes(usage)) {
          setPreparedUsageUnit(usage);
          prepopulateConversion(
            usage,
            resolved?.profileReferenceUnit ??
              resolved?.pinnedOutputUnit ??
              line.normalizedUnit ??
              usage,
          );
        }
        setIngredientSheet("prepared");
        return;
      }
      if (line.sourceKind === "child_draft" && line.childDraftId) {
        setNestedName(resolved?.displayName ?? line.customName ?? "");
        setNestedUsageQuantity(String(line.quantity ?? ""));
        const usage = line.unit?.toLocaleLowerCase() as RecipeFirstUnit;
        if (usage && RECIPE_FIRST_UNITS.includes(usage)) {
          setNestedUsageUnit(usage);
        }
        setIngredientSheet("nested");
        return;
      }
      setIngredientSheet("sources");
    },
    [grocery?.lots],
  );

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
      if (!saved) return;
      if (!(await reconcileReplacement(current, saved, lineId))) return;
      setSnackbar("Ingredient removed; unused source reconciled");
    },
    [persistExisting, reconcileReplacement, runSave],
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
      lines.every(
        (line) =>
          line.isOptional ||
          (line.sourceKind !== "unresolved" && line.sourceKind !== "child_draft"),
      ) &&
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
    const conversion = resolveMeasuredConversion({
      measurement: costMeasurement,
      usageUnit,
      evidenceUnit: selectedLot.unit,
      piecesPerPack: parsePositive(piecesPerPack),
      portionsPerPiece: parsePositive(portionsPerPiece),
      customFromQuantity: parsePositive(customFromQuantity),
      customFromUnit,
      customToQuantity: parsePositive(customToQuantity),
      customToUnit,
      customMeaning,
    });
    if (!conversion.ok) return null;
    return calculateIngredientCostWithExplicitConversion({
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
    }, conversion.factor);
  }, [
    costMeasurement,
    customFromQuantity,
    customFromUnit,
    customMeaning,
    customToQuantity,
    customToUnit,
    piecesPerPack,
    portionsPerPiece,
    selectedLot,
    usageQuantity,
    usageUnit,
  ]);

  const markReady = useCallback(async () => {
    if (!costSummary.definitionReady) {
      setMessage(
        "Complete the required ingredient identities and yield before marking this Recipe ready.",
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
            requireCompleteCost: false,
          }),
    );
    if (!published) return;
    if (returnRoute) router.replace(returnRoute as never);
    else {
      const group =
        saved.draft.classificationProposal === "prepared_base"
          ? "prepared"
          : "selling";
      router.replace({
        pathname: "/owner/recipes" as never,
        params: {
          publishedItemId: published.version.outputCatalogItemId,
          group,
        },
      });
    }
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
            {snapshot ? (
              <RecipeContextCard
                classification={
                  snapshot.draft.classificationProposal ??
                  snapshot.output.classification
                }
                costStatus={costSummary.status}
                lifecycle={snapshot.draft.lifecycle}
                name={snapshot.draft.name ?? snapshot.output.name}
              />
            ) : null}
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
                    onEdit={() => editLine(line)}
                    onRemove={() => void removeLine(line.id)}
                    onReplace={() => {
                      setEditingLineId(line.id);
                      setReplacingLineSource(true);
                      setLineRole(line.role);
                      setLineRequirement(
                        line.isOptional ? "Optional" : "Required",
                      );
                      setIngredientSheet("sources");
                    }}
                    resolved={resolvedLineFor(snapshot, line.id)}
                  />
                ))}
              </GabiCard>
            ) : (
              <GabiCard>
                <GabiEmptyState
                  actionLabel="Add Ingredient"
                  icon="leaf-outline"
                  message="Use Grocery stock, a temporary estimate, or create a prepared recipe without leaving this flow."
                  onAction={() => {
                    setEditingLineId(null);
                    setReplacingLineSource(false);
                    setIngredientSheet("sources");
                  }}
                  title="No ingredients yet"
                />
              </GabiCard>
            )}

            <GabiPrimaryButton
              icon="add"
              label="Add Ingredient"
              onPress={() => {
                setEditingLineId(null);
                setReplacingLineSource(false);
                setIngredientSheet("sources");
              }}
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
            {snapshot ? (
              <RecipeContextCard
                classification={
                  snapshot.draft.classificationProposal ??
                  snapshot.output.classification
                }
                costStatus={costSummary.status}
                lifecycle={snapshot.draft.lifecycle}
                name={snapshot.draft.name ?? snapshot.output.name}
              />
            ) : null}

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
                <RecipeUnitSelector
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
                disabled={busy}
                key={line.id}
                line={line}
                onEdit={() => {
                  setStep(2);
                  editLine(line);
                }}
                onRemove={() => undefined}
                onReplace={() => undefined}
                resolved={resolvedLineFor(snapshot, line.id)}
                review
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
        costMeasurement={costMeasurement}
        customFromQuantity={customFromQuantity}
        customFromUnit={customFromUnit}
        customMeaning={customMeaning}
        customToQuantity={customToQuantity}
        customToUnit={customToUnit}
        estimateCost={estimateCost}
        estimateName={estimateName}
        estimateNotes={estimateNotes}
        estimateReferenceQuantity={estimateReferenceQuantity}
        estimateReferenceUnit={estimateReferenceUnit}
        estimateUsageQuantity={estimateUsageQuantity}
        estimateUsageUnit={estimateUsageUnit}
        customCupMilliliters={customCupMilliliters}
        ingredientSearch={ingredientSearch}
        lineRole={lineRole}
        lineRequirement={lineRequirement}
        editingNestedDraftId={editingNestedDraftId}
        onAddEstimate={() => void addEstimate()}
        onAddGrocery={() => void addGroceryIngredient()}
        onAddNewRaw={() => void addNewRawIngredient()}
        onAddPrepared={() => void addExistingPrepared()}
        onBack={() => {
          if (editingLineId) setReplacingLineSource(true);
          setIngredientSheet("sources");
        }}
        onChangeEstimateCost={setEstimateCost}
        onChangeEstimateName={setEstimateName}
        onChangeEstimateNotes={setEstimateNotes}
        onChangeEstimateReferenceQuantity={setEstimateReferenceQuantity}
        onChangeEstimateReferenceUnit={setEstimateReferenceUnit}
        onChangeEstimateUsageQuantity={setEstimateUsageQuantity}
        onChangeEstimateUsageUnit={setEstimateUsageUnit}
        onChangeCustomCupMilliliters={setCustomCupMilliliters}
        onChangeCustomFromQuantity={setCustomFromQuantity}
        onChangeCustomFromUnit={setCustomFromUnit}
        onChangeCustomMeaning={setCustomMeaning}
        onChangeCustomToQuantity={setCustomToQuantity}
        onChangeCustomToUnit={setCustomToUnit}
        onChangeIngredientSearch={(value) => {
          setIngredientSearch(value);
          setSelectedLotId(null);
        }}
        onChangeLineRole={setLineRole}
        onChangeLineRequirement={setLineRequirement}
        onChangeCostMeasurement={setCostMeasurement}
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
        onOpenIngredient={() => {
          if (!selectedLot) return;
          closeIngredientSheet();
          router.push({
            pathname: "/owner/grocery" as never,
            params: {
              lotId: selectedLot.id,
              ingredientId: selectedLot.ingredientId,
            },
          });
        }}
        onSelectLot={(lot) => {
          if (selectedLotId && selectedLotId !== lot.id) {
            setOriginalConversionEvidence(null);
            setCostMeasurement("Price per amount");
          }
          setSelectedLotId(lot.id);
          const normalized = lot.unit.toLowerCase() as RecipeFirstUnit;
          if (RECIPE_FIRST_UNITS.includes(normalized)) {
            setUsageUnit(normalized);
          }
        }}
        onSelectPrepared={(catalogItemId) => {
          setOriginalConversionEvidence(null);
          setSelectedPreparedId(catalogItemId);
        }}
        onContinuePrepared={(draftId) => {
          closeIngredientSheet();
          router.push({
            pathname: "/owner/recipe-editor" as never,
            params: { draftId },
          });
        }}
        onStartNested={() => void startNestedDraft()}
        onContinueNested={() => void startNestedDraft(true)}
        piecesPerPack={piecesPerPack}
        portionsPerPiece={portionsPerPiece}
        preparedEntries={preparedEntries}
        preparedPickerEmptyState={preparedPickerModel.emptyState}
        preparedPreview={preparedPreview}
        pinnedPreparedLabel={pinnedPrepared?.resolved.displayName ?? null}
        pinnedPreparedVersionId={
          pinnedPrepared?.line.childRecipeVersionId ?? null
        }
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

function RecipeContextCard({
  name,
  classification,
  lifecycle,
  costStatus,
}: {
  name: string;
  classification: string;
  lifecycle: string;
  costStatus: RecipeFirstCostSummaryValue["status"];
}) {
  return (
    <GabiCard>
      <GabiText variant="cardTitle">{name}</GabiText>
      <View style={styles.contextChips}>
        <GabiChip label={classification.replaceAll("_", " ")} tone="primary" />
        <GabiChip label={lifecycle} tone="neutral" />
        <GabiChip
          label={
            costStatus === "actual"
              ? "Actual cost"
              : costStatus === "estimated"
                ? "Estimated cost"
                : costStatus === "no_price"
                  ? "No price yet"
                  : "Cost incomplete"
          }
          tone={
            costStatus === "actual"
              ? "success"
              : costStatus === "estimated"
                ? "warning"
                : "danger"
          }
        />
      </View>
    </GabiCard>
  );
}

function IngredientLine({
  line,
  resolved,
  disabled,
  review = false,
  onEdit,
  onReplace,
  onRemove,
}: {
  line: DraftLine;
  resolved: RecipeFirstResolvedLine | null;
  disabled: boolean;
  review?: boolean;
  onEdit: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  const amount = lineAmount(line);
  const presentation = presentRecipeLineIdentity({
    lineId: line.id,
    quantity: line.quantity,
    unit: line.unit,
    resolved,
  });

  return (
    <View style={[styles.line, { borderColor: palette.border }]}>
      <View style={styles.lineCopy}>
        <GabiText variant="buttonSm">{presentation.displayName}</GabiText>
        <GabiText tone="muted" variant="caption">
          {[
            presentation.classification
              ? presentation.classification.replaceAll("_", " ")
              : null,
            presentation.sourceLabel,
            presentation.costLabel,
          ]
            .filter(Boolean)
            .join(" · ") || "Unresolved ingredient"}
        </GabiText>
        <GabiText tone="muted" variant="caption">
          {presentation.quantityLabel}
        </GabiText>
        {presentation.category ? (
          <GabiText tone="faint" variant="caption">
            {presentation.category}
          </GabiText>
        ) : null}
        {presentation.sourceDetail ? (
          <GabiText tone="faint" variant="caption">
            {presentation.sourceDetail}
          </GabiText>
        ) : null}
        {presentation.conversionSummary ? (
          <GabiText tone="muted" variant="caption">
            {presentation.conversionSummary}
          </GabiText>
        ) : null}
        <GabiText
          money
          tone={amount === null ? "danger" : "primary"}
          variant="caption"
        >
          {amount === null
            ? presentation.costLabel
            : `${formatPeso(amount)} ${presentation.costLabel.toLocaleLowerCase()}`}
        </GabiText>
        {presentation.missingReason ? (
          <GabiText tone="warning" variant="caption">
            {presentation.missingReason}
          </GabiText>
        ) : null}
      </View>
      {!disabled ? (
        <View style={styles.lineActions}>
          <GabiSoftButton
            compact
            icon="create-outline"
            label="Edit"
            onPress={onEdit}
          />
          {!review ? (
            <>
              <GabiSoftButton
                compact
                icon="swap-horizontal-outline"
                label="Replace source"
                onPress={onReplace}
              />
              <Pressable
                accessibilityLabel={`Remove ${presentation.displayName}`}
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
            </>
          ) : null}
        </View>
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
  lineRole: DraftLine["role"];
  lineRequirement: LineRequirement;
  usageQuantity: string;
  usageUnit: RecipeFirstUnit;
  costMeasurement: CostMeasurement;
  piecesPerPack: string;
  portionsPerPiece: string;
  customCupMilliliters: string;
  customFromQuantity: string;
  customFromUnit: RecipeFirstUnit;
  customToQuantity: string;
  customToUnit: RecipeFirstUnit;
  customMeaning: string;
  estimateName: string;
  estimateCost: string;
  estimateReferenceQuantity: string;
  estimateReferenceUnit: RecipeFirstUnit;
  estimateUsageQuantity: string;
  estimateUsageUnit: RecipeFirstUnit;
  estimateNotes: string;
  preparedEntries: RecipeIngredientPickerEntry[];
  preparedPickerEmptyState: {
    title: string;
    message: string;
  } | null;
  selectedPreparedId: string | null;
  pinnedPreparedLabel: string | null;
  pinnedPreparedVersionId: string | null;
  preparedPreview: ReturnType<typeof calculateSimpleIngredientCost> | null;
  preparedUsageQuantity: string;
  preparedUsageUnit: RecipeFirstUnit;
  nestedName: string;
  nestedUsageQuantity: string;
  nestedUsageUnit: RecipeFirstUnit;
  editingNestedDraftId: string | null;
  newIngredientName: string;
  newPurchaseQuantity: string;
  newPurchaseUnit: (typeof PURCHASE_UNITS)[number];
  newPurchaseCost: string;
  newUsageQuantity: string;
  newUsageUnit: RecipeFirstUnit;
  onClose: () => void;
  onBack: () => void;
  onOpenSource: (sheet: Exclude<IngredientSheet, null>) => void;
  onOpenIngredient: () => void;
  onChangeIngredientSearch: (value: string) => void;
  onChangeLineRole: (value: DraftLine["role"]) => void;
  onChangeLineRequirement: (value: LineRequirement) => void;
  onSelectLot: (lot: GroceryLot) => void;
  onChangeUsageQuantity: (value: string) => void;
  onChangeUsageUnit: (value: RecipeFirstUnit) => void;
  onChangeCostMeasurement: (value: CostMeasurement) => void;
  onChangePiecesPerPack: (value: string) => void;
  onChangePortionsPerPiece: (value: string) => void;
  onChangeCustomCupMilliliters: (value: string) => void;
  onChangeCustomFromQuantity: (value: string) => void;
  onChangeCustomFromUnit: (value: RecipeFirstUnit) => void;
  onChangeCustomToQuantity: (value: string) => void;
  onChangeCustomToUnit: (value: RecipeFirstUnit) => void;
  onChangeCustomMeaning: (value: string) => void;
  onAddGrocery: () => void;
  onSelectPrepared: (catalogItemId: string) => void;
  onContinuePrepared: (draftId: string) => void;
  onChangePreparedUsageQuantity: (value: string) => void;
  onChangePreparedUsageUnit: (value: RecipeFirstUnit) => void;
  onAddPrepared: () => void;
  onChangeEstimateName: (value: string) => void;
  onChangeEstimateCost: (value: string) => void;
  onChangeEstimateReferenceQuantity: (value: string) => void;
  onChangeEstimateReferenceUnit: (value: RecipeFirstUnit) => void;
  onChangeEstimateUsageQuantity: (value: string) => void;
  onChangeEstimateUsageUnit: (value: RecipeFirstUnit) => void;
  onChangeEstimateNotes: (value: string) => void;
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
  onContinueNested: () => void;
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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={insets.top}
        style={styles.modalBackdrop}
      >
        <Pressable
          accessibilityLabel="Close ingredient form"
          accessibilityRole="button"
          onPress={props.onClose}
          style={styles.modalScrim}
        />
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
            {props.sheet && props.sheet !== "sources" ? (
              <>
                <RecipeFirstChoiceRow
                  label="Ingredient role"
                  onChange={props.onChangeLineRole}
                  options={RECIPE_LINE_ROLES}
                  selected={props.lineRole}
                />
                <RecipeFirstChoiceRow
                  label="Ingredient status"
                  onChange={props.onChangeLineRequirement}
                  options={LINE_REQUIREMENTS}
                  selected={props.lineRequirement}
                />
              </>
            ) : null}
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
                    <GabiSoftButton
                      icon="open-outline"
                      label="Open Ingredient in Grocery"
                      onPress={props.onOpenIngredient}
                    />
                    <RecipeFirstField
                      help="How much is used for one piece, serving, or batch?"
                      keyboardType="decimal-pad"
                      label="Usage amount"
                      onChangeText={props.onChangeUsageQuantity}
                      placeholder="Example: 27"
                      value={props.usageQuantity}
                    />
                    <RecipeUnitSelector
                      label="Usage unit"
                      onChange={props.onChangeUsageUnit}
                      options={RECIPE_FIRST_UNITS}
                      selected={props.usageUnit}
                    />
                    <CostMeasurementFields
                      {...props}
                      selectedLot={selectedLot}
                    />
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
                    {props.costMeasurement !== "Prepared batch recipe" ? (
                      <GabiPrimaryButton
                        icon="add"
                        label="Add Grocery Ingredient"
                        onPress={props.onAddGrocery}
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            {props.sheet === "prepared" ? (
              <>
                <GabiNotice
                  message="Every Recipe ingredient source is shown. Unavailable choices remain visible with the reason; cost-incomplete published Recipes can be selected but stay blocked from production."
                  tone="owner"
                />
                {props.pinnedPreparedVersionId ? (
                  <GabiNotice
                    message={`Editing ${props.pinnedPreparedLabel ?? "prepared Recipe"} at pinned version ${props.pinnedPreparedVersionId}. Saving usage keeps this exact historical version. Selecting another entry below explicitly replaces it.`}
                    tone="warning"
                  />
                ) : null}
                <View
                  style={[
                    styles.search,
                    {
                      backgroundColor: extended.field,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <Ionicons color={palette.mutedText} name="search" size={19} />
                  <TextInput
                    onChangeText={props.onChangeIngredientSearch}
                    placeholder="Search every ingredient source"
                    placeholderTextColor={extended.textFaint}
                    style={[styles.searchInput, { color: palette.text }]}
                    value={props.ingredientSearch}
                  />
                </View>
                {PICKER_GROUPS.map(([group, label]) => {
                  const entries = props.preparedEntries.filter(
                    (entry) => entry.pickerGroup === group,
                  );
                  if (entries.length === 0) return null;
                  return (
                    <View key={group} style={styles.sourceList}>
                      <GabiSectionHeader
                        action={<GabiChip label={String(entries.length)} tone="neutral" />}
                        title={label}
                      />
                      {entries.map((entry) => {
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
                            accessibilityState={{
                              checked: selected,
                              disabled:
                                !entry.selectable &&
                                entry.action !== "continue_draft",
                            }}
                            key={`${group}:${entry.catalogItemId}`}
                            onPress={() => {
                              if (entry.selectable) {
                                props.onSelectPrepared(entry.catalogItemId);
                              } else if (
                                entry.action === "continue_draft" &&
                                entry.draftId
                              ) {
                                props.onContinuePrepared(entry.draftId);
                              }
                            }}
                            style={[
                              styles.lot,
                              {
                                backgroundColor: selected
                                  ? palette.softPrimary
                                  : palette.surface,
                                borderColor: selected
                                  ? palette.primary
                                  : palette.border,
                                opacity:
                                  entry.selectable ||
                                  entry.action === "continue_draft"
                                    ? 1
                                    : 0.72,
                              },
                            ]}
                          >
                            <Ionicons
                              color={selected ? palette.primary : extended.radioOff}
                              name={
                                entry.action === "continue_draft"
                                  ? "create-outline"
                                  : selected
                                    ? "radio-button-on"
                                    : entry.selectable
                                      ? "radio-button-off-outline"
                                      : "lock-closed-outline"
                              }
                              size={22}
                            />
                            <View style={styles.lineCopy}>
                              <GabiText variant="buttonSm">{entry.name}</GabiText>
                              <GabiText tone="muted" variant="caption">
                                {entry.activeVersionId
                                  ? `Pinned version · ${entry.activeVersionOutputQuantity ?? "?"} ${entry.activeVersionOutputUnit ?? "unit"}`
                                  : entry.action === "continue_draft"
                                    ? "Continue Recipe"
                                    : entry.classification}
                              </GabiText>
                              <GabiText
                                money
                                tone={referenceCost === null ? "warning" : "primary"}
                                variant="caption"
                              >
                                {referenceCost === null
                                  ? entry.disabledReason ?? "Cost incomplete — production remains blocked"
                                  : `${formatPeso(referenceCost)}/${entry.activeCostReferenceUnit ?? entry.activeVersionOutputUnit ?? "unit"}`}
                              </GabiText>
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
                {props.preparedPickerEmptyState ? (
                  <GabiEmptyState
                    icon="layers-outline"
                    message={props.preparedPickerEmptyState.message}
                    title={props.preparedPickerEmptyState.title}
                  />
                ) : null}
                {props.selectedPreparedId || props.pinnedPreparedVersionId ? (
                  <>
                    <RecipeFirstField
                      help="How much is used for one piece, serving, or batch?"
                      keyboardType="decimal-pad"
                      label="Usage amount"
                      onChangeText={props.onChangePreparedUsageQuantity}
                      placeholder="Example: 27"
                      value={props.preparedUsageQuantity}
                    />
                    <RecipeUnitSelector
                      label="Usage unit"
                      onChange={props.onChangePreparedUsageUnit}
                      options={RECIPE_FIRST_UNITS}
                      selected={props.preparedUsageUnit}
                    />
                    {props.preparedUsageUnit === "custom_cup" ? (
                      <RecipeFirstField
                        help="Define this kitchen cup explicitly. The exact volume is saved with this Recipe line."
                        keyboardType="decimal-pad"
                        label="Custom business cup volume (mL)"
                        onChangeText={props.onChangeCustomCupMilliliters}
                        placeholder="Example: 240"
                        value={props.customCupMilliliters}
                      />
                    ) : null}
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
                      label={
                        props.pinnedPreparedVersionId
                          ? "Save Pinned Version Usage"
                          : "Add Prepared Recipe"
                      }
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
                <RecipeUnitSelector
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
                <RecipeUnitSelector
                  label="Usage unit"
                  onChange={props.onChangeEstimateUsageUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.estimateUsageUnit}
                />
                <CostMeasurementFields {...props} selectedLot={null} />
                <RecipeFirstField
                  help="Optional owner notes and evidence context are preserved when this estimate is edited."
                  label="Notes"
                  multiline
                  onChangeText={props.onChangeEstimateNotes}
                  placeholder="Why this estimate is reasonable"
                  value={props.estimateNotes}
                />
                {props.costMeasurement !== "Prepared batch recipe" ? (
                  <GabiPrimaryButton
                    icon="calculator-outline"
                    label="Add Estimated Ingredient"
                    onPress={props.onAddEstimate}
                  />
                ) : null}
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
                <RecipeUnitSelector
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
                <RecipeUnitSelector
                  label="Usage unit"
                  onChange={props.onChangeNewUsageUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.newUsageUnit}
                />
                <CostMeasurementFields {...props} selectedLot={null} />
                {props.costMeasurement !== "Prepared batch recipe" ? (
                  <GabiPrimaryButton
                    icon="add"
                    label="Record Purchase and Add Ingredient"
                    onPress={props.onAddNewRaw}
                  />
                ) : null}
              </>
            ) : null}

            {props.sheet === "nested" ? (
              <>
                <GabiNotice
                  message="Your current Recipe is saved first. After the prepared Recipe is completed, you return to this ingredient list."
                  tone="owner"
                />
                <RecipeFirstField
                  editable={!props.editingNestedDraftId}
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
                <RecipeUnitSelector
                  label="Usage unit"
                  onChange={props.onChangeNestedUsageUnit}
                  options={RECIPE_FIRST_UNITS}
                  selected={props.nestedUsageUnit}
                />
                <GabiPrimaryButton
                  icon={
                    props.editingNestedDraftId
                      ? "save-outline"
                      : "git-branch-outline"
                  }
                  label={
                    props.editingNestedDraftId
                      ? "Save Parent Usage"
                      : "Save Parent and Create Prepared Recipe"
                  }
                  onPress={props.onStartNested}
                />
                {props.editingNestedDraftId ? (
                  <GabiSoftButton
                    icon="create-outline"
                    label="Continue Prepared Recipe"
                    onPress={props.onContinueNested}
                  />
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CostMeasurementFields(
  props: IngredientModalProps & { selectedLot: GroceryLot | null },
) {
  const pieces = parsePositive(props.piecesPerPack);
  const portions = parsePositive(props.portionsPerPiece);
  const referenceQuantity =
    props.sheet === "grocery"
      ? props.selectedLot?.purchasedQuantity ?? null
      : props.sheet === "estimate"
        ? parsePositive(props.estimateReferenceQuantity)
        : parsePositive(props.newPurchaseQuantity);
  const referenceCost =
    props.sheet === "grocery"
      ? props.selectedLot?.costState === "known"
        ? (props.selectedLot.recordedTotalCost ?? props.selectedLot.totalCost)
        : null
      : props.sheet === "estimate"
        ? parseOptionalNonNegative(props.estimateCost)
        : parsePositive(props.newPurchaseCost);
  const usageQuantity =
    props.sheet === "grocery"
      ? parsePositive(props.usageQuantity)
      : props.sheet === "estimate"
        ? parsePositive(props.estimateUsageQuantity)
        : parsePositive(props.newUsageQuantity);
  const usablePortions =
    referenceQuantity && pieces
      ? referenceQuantity * pieces * (portions ?? 1)
      : null;
  const costPerPortion =
    referenceCost !== null && usablePortions
      ? referenceCost / usablePortions
      : null;
  const customFrom = parsePositive(props.customFromQuantity);
  const customTo = parsePositive(props.customToQuantity);

  return (
    <GabiCard>
      <RecipeFirstChoiceRow
        label="How is this cost measured?"
        onChange={props.onChangeCostMeasurement}
        options={COST_MEASUREMENTS}
        selected={props.costMeasurement}
      />
      {props.costMeasurement === "Price per amount" ? (
        (() => {
          const evidenceUnit =
            props.sheet === "grocery"
              ? props.selectedLot?.unit ?? ""
              : props.sheet === "estimate"
                ? props.estimateReferenceUnit
                : props.newPurchaseUnit;
          const usageUnit =
            props.sheet === "grocery"
              ? props.usageUnit
              : props.sheet === "estimate"
                ? props.estimateUsageUnit
                : props.newUsageUnit;
          const countableGuidance = countableMeasuredConversionGuidance(
            usageUnit,
            evidenceUnit,
          );
          if (countableGuidance) {
            return (
              <>
                <GabiNotice message={countableGuidance} tone="warning" />
                <GabiSoftButton
                  icon="cube-outline"
                  label="Gamitin ang Package breakdown"
                  onPress={() =>
                    props.onChangeCostMeasurement("Package breakdown")
                  }
                />
                <GabiSoftButton
                  icon="swap-horizontal-outline"
                  label="Gamitin ang Custom conversion"
                  onPress={() =>
                    props.onChangeCostMeasurement("Custom conversion")
                  }
                />
              </>
            );
          }
          const derivation =
            referenceQuantity && usageQuantity
              ? (() => {
                  const preview =
                    referenceCost === null
                      ? null
                      : calculateSimpleIngredientCost({
                          purchaseCost: referenceCost,
                          purchasedQuantity: referenceQuantity,
                          purchaseUnit: evidenceUnit,
                          usageQuantity,
                          usageUnit,
                          costSource:
                            props.sheet === "grocery"
                              ? "purchase_lot"
                              : "owner_estimate",
                        });
                  return buildMeasuredCostDerivationLine({
                    referenceQuantity,
                    referenceUnit: evidenceUnit,
                    usageQuantity,
                    usageUnit,
                    costPerUsageUnit: preview?.costPerUsageUnit ?? null,
                    totalAmount: preview?.amount ?? null,
                  });
                })()
              : null;
          return (
            <>
              <GabiNotice
                message="Use the recorded price and amount above. Only compatible standard unit conversions are applied automatically."
                tone="owner"
              />
              {derivation ? (
                <GabiNotice message={derivation} tone="success" />
              ) : null}
            </>
          );
        })()
      ) : null}
      {props.costMeasurement === "Package breakdown" ? (
        <>
          <RecipeFirstField
            help="Example: 18 sausages in one package"
            keyboardType="decimal-pad"
            label="Pieces per package"
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
          {usablePortions ? (
            <GabiNotice
              message={`${formatQuantity(referenceQuantity ?? 0)} pack × ${formatQuantity(pieces ?? 0)} pieces${portions ? ` × ${formatQuantity(portions)} portions` : ""} = ${formatQuantity(usablePortions)} usable ${portions ? "portions" : "pieces"}.${costPerPortion === null ? " Add a price to calculate cost." : ` ${formatPeso(referenceCost ?? 0)} ÷ ${formatQuantity(usablePortions)} = approximately ${formatPeso(costPerPortion)} each${usageQuantity ? `; ${formatQuantity(usageQuantity)} used costs approximately ${formatPeso(costPerPortion * usageQuantity)}` : ""}.`}`}
              tone="owner"
            />
          ) : (
            <GabiNotice
              message="Enter the package quantity and pieces to see the complete live calculation."
              tone="warning"
            />
          )}
        </>
      ) : null}
      {props.costMeasurement === "Prepared batch recipe" ? (
        <>
          <GabiNotice
            message="Use a prepared Recipe for cooking, mixing, seasoning, or another transformation. Its version and batch cost stay explicit instead of being flattened into one conversion."
            tone="warning"
          />
          <GabiSoftButton
            icon="layers-outline"
            label="Choose a Prepared Recipe"
            onPress={() => props.onOpenSource("prepared")}
          />
          <GabiSoftButton
            icon="git-branch-outline"
            label="Create a Prepared Recipe"
            onPress={() => props.onOpenSource("nested")}
          />
        </>
      ) : null}
      {props.costMeasurement === "Custom conversion" ? (
        <>
          <GabiNotice
            message="This owner-entered conversion applies only to the selected ingredient. KitaMo never infers a universal mass-to-volume or package conversion."
            tone="warning"
          />
          <RecipeFirstField
            keyboardType="decimal-pad"
            label="From quantity"
            onChangeText={props.onChangeCustomFromQuantity}
            placeholder="Example: 1"
            value={props.customFromQuantity}
          />
          <RecipeUnitSelector
            label="From unit"
            onChange={props.onChangeCustomFromUnit}
            options={RECIPE_FIRST_UNITS}
            selected={props.customFromUnit}
          />
          <RecipeFirstField
            keyboardType="decimal-pad"
            label="To quantity"
            onChangeText={props.onChangeCustomToQuantity}
            placeholder="Example: 240"
            value={props.customToQuantity}
          />
          <RecipeUnitSelector
            label="To unit"
            onChange={props.onChangeCustomToUnit}
            options={RECIPE_FIRST_UNITS}
            selected={props.customToUnit}
          />
          <RecipeFirstField
            help="Describe the ingredient-specific evidence, such as Our kitchen cup of sushi rice weighs 210 g."
            label="Conversion meaning"
            onChangeText={props.onChangeCustomMeaning}
            placeholder="What this conversion means"
            value={props.customMeaning}
          />
          {customFrom && customTo ? (
            <GabiNotice
              message={`${formatQuantity(customFrom)} ${props.customFromUnit} → ${formatQuantity(customTo)} ${props.customToUnit}; 1 ${props.customFromUnit} = ${formatQuantity(customTo / customFrom)} ${props.customToUnit}. This preview is item-specific.`}
              tone="owner"
            />
          ) : null}
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
  contextChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
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
  lineActions: {
    alignItems: "flex-end",
    gap: spacing.xs,
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
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
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
