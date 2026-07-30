import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState, type ComponentProps } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton, GabiSnackbar } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { RecipeMakeableCard } from "@/components/owner/RecipeMakeableCard";
import { TindahanTabs } from "@/components/owner/TindahanTabs";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import { ingredientUnits } from "@/db/repositories";
import { areRecipeUnitsCompatible, calculateMakeableQuantity, type CostingLine } from "@/domain/recipeCosting";
import type { IngredientUnit, Product, RecipeProductionMode } from "@/domain/types";
import { loadGroceryPoolSnapshot, type GroceryPoolSnapshot } from "@/services/groceryPool";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import {
  archiveRecipe,
  createRecipeWithLines,
  loadRecipesOverview,
  previewDraftLineCost,
  type RecipeDraftLine,
  type RecipesOverview,
} from "@/services/recipes";
import { useThemeStore } from "@/state/themeStore";
import { themePalettes } from "@/theme/colors";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { extendedThemePalettes } from "@/theme/tokens";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";
import { numbersOnlyMessage, parseRequiredNumber } from "@/utils/numberInput";

type DraftLineView = {
  key: string;
  kind: "lot" | "custom";
  label: string;
  detail: string;
  lineCost: number;
  lotId: string | null;
  customName: string | null;
  quantity: number;
  unit: IngredientUnit;
};

const productionModes: { id: RecipeProductionMode; label: string }[] = [
  { id: "prepared_before_selling", label: "Prepared before selling" },
  { id: "cook_upon_order", label: "Cook upon order" },
];

export default function OwnerRecipesScreen() {
  const [overview, setOverview] = useState<RecipesOverview | null>(null);
  const [grocery, setGrocery] = useState<GroceryPoolSnapshot | null>(null);
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [outputProductId, setOutputProductId] = useState<string | null>(null);
  const [recipeName, setRecipeName] = useState("");
  const [outputQuantity, setOutputQuantity] = useState("");
  const [outputUnit, setOutputUnit] = useState<IngredientUnit>("pcs");
  const [productionMode, setProductionMode] = useState<RecipeProductionMode>("prepared_before_selling");
  const [recipeNotes, setRecipeNotes] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLineView[]>([]);

  const [lotSearch, setLotSearch] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const [lineQuantity, setLineQuantity] = useState("");
  const [lineUnit, setLineUnit] = useState<IngredientUnit>("g");
  const [lineMessage, setLineMessage] = useState<string | null>(null);

  const [customName, setCustomName] = useState("");
  const [customCost, setCustomCost] = useState("");

  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formIsError, setFormIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const archiveLock = useRef(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [builderStep, setBuilderStep] = useState<1 | 2 | 3>(1);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const draftKeyRef = useRef(0);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode === "dark" ? "dark" : "light"];

  const refresh = useCallback(async () => {
    const nextStatus = await loadOwnerSetupStatus();
    const nextOverview = await loadRecipesOverview();
    const nextGrocery = await loadGroceryPoolSnapshot();
    setStatus(nextStatus);
    setOverview(nextOverview);
    setGrocery(nextGrocery);
    if (nextOverview.items.filter((item) => item.recipe.isActive).length === 0) {
      setShowCreateForm(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      refresh()
        .then(() => {
          if (active) {
            setLoadError(null);
          }
        })
        .catch((error) => {
          logDevError("OwnerRecipes.refresh", error);
          if (active) {
            setLoadError(getFriendlyErrorMessage("Could not load recipes."));
          }
        });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  const products = useMemo(() => status?.products ?? [], [status?.products]);
  const lots = useMemo(() => (grocery?.lots ?? []).filter((lot) => lot.status !== "archived"), [grocery?.lots]);

  const matchingLots = useMemo(() => {
    const query = lotSearch.trim().toLowerCase();
    if (!query) {
      return lots.slice(0, 6);
    }

    return lots
      .filter((lot) =>
        [lot.ingredientName, lot.brandName ?? "", lot.sourceName ?? ""].some((value) => value.toLowerCase().includes(query)),
      )
      .slice(0, 6);
  }, [lots, lotSearch]);

  const selectedLot = useMemo(() => lots.find((lot) => lot.id === selectedLotId) ?? null, [lots, selectedLotId]);
  const outputQuantityParsed = parseRequiredNumber(outputQuantity, 0);
  const lineQuantityParsed = parseRequiredNumber(lineQuantity, 0);
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === outputProductId) ?? null,
    [outputProductId, products],
  );

  const lowestCostByIngredient = useMemo(() => {
    const values = new Map<string, number>();
    for (const lot of lots) {
      const current = values.get(lot.ingredientId);
      if (current === undefined || lot.costPerUnit < current) values.set(lot.ingredientId, lot.costPerUnit);
    }
    return values;
  }, [lots]);

  const draftCostingLines = useMemo<CostingLine[]>(
    () =>
      draftLines.map((line) => {
        if (line.kind === "custom") {
          return {
            label: line.label,
            isCustom: true,
            quantity: 0,
            unit: "pcs",
            costOverride: line.lineCost,
          };
        }

        const lot = lots.find((candidate) => candidate.id === line.lotId);
        return {
          label: line.label,
          isCustom: false,
          quantity: line.quantity,
          unit: line.unit,
          lotId: line.lotId,
          lotUnit: lot?.unit ?? line.unit,
          lotCostPerUnit: lot?.costPerUnit ?? null,
          lotRemainingQuantity: lot?.remainingQuantity ?? 0,
        };
      }),
    [draftLines, lots],
  );

  const draftMakeable = useMemo(
    () => calculateMakeableQuantity(draftCostingLines, outputQuantityParsed === "invalid" ? 1 : outputQuantityParsed),
    [draftCostingLines, outputQuantityParsed],
  );

  const linePreview = useMemo(() => {
    if (!selectedLot) {
      return null;
    }

    const quantity = parseRequiredNumber(lineQuantity, 0);
    if (quantity === "invalid" || quantity <= 0) {
      return null;
    }

    const result = previewDraftLineCost({ quantity, unit: lineUnit, lot: selectedLot });
    if (!result.ok) {
      return { incompatible: true as const, lineCost: 0 };
    }

    return { incompatible: false as const, lineCost: result.lineCost };
  }, [selectedLot, lineQuantity, lineUnit]);

  const batchCostPreview = draftLines.reduce((total, line) => total + line.lineCost, 0);
  const costPerUnitPreview =
    outputQuantityParsed !== "invalid" && outputQuantityParsed > 0 ? batchCostPreview / outputQuantityParsed : null;

  function nextDraftKey() {
    draftKeyRef.current += 1;
    return `draft_${draftKeyRef.current}`;
  }

  function addLotLine() {
    setLineMessage(null);

    if (!selectedLot) {
      setLineMessage("Piliin muna ang grocery item para sa linya.");
      return;
    }

    const quantity = parseRequiredNumber(lineQuantity, 0);
    if (quantity === "invalid") {
      setLineMessage(numbersOnlyMessage);
      return;
    }

    if (quantity <= 0) {
      setLineMessage("Ilagay kung gaano karami ang gamit sa recipe. Example: 100.");
      return;
    }

    const preview = previewDraftLineCost({ quantity, unit: lineUnit, lot: selectedLot });
    if (!preview.ok) {
      setLineMessage(
        preview.incompatible
          ? `Hindi ma-convert ang ${lineUnit} papunta sa ${selectedLot.unit}. Gamitin ang ${selectedLot.unit}, o katugmang g/kg o ml/L.`
          : "Walang cost na mababasa para sa grocery item na ito.",
      );
      return;
    }

    const brand = selectedLot.brandName?.trim();
    const source = selectedLot.sourceName?.trim();

    setDraftLines((current) => [
      ...current,
      {
        key: nextDraftKey(),
        kind: "lot",
        label: brand ? `${selectedLot.ingredientName} · ${brand}` : selectedLot.ingredientName,
        detail: `${formatQuantity(quantity)} ${lineUnit}${source ? ` · ${source}` : ""}`,
        lineCost: preview.lineCost,
        lotId: selectedLot.id,
        customName: null,
        quantity,
        unit: lineUnit,
      },
    ]);
    setSelectedLotId(null);
    setLotSearch("");
    setLineQuantity("");
  }

  function addCustomLine() {
    setLineMessage(null);

    const name = customName.trim();
    if (!name) {
      setLineMessage("Ilagay ang pangalan ng custom ingredient.");
      return;
    }

    const cost = parseRequiredNumber(customCost, 0);
    if (cost === "invalid") {
      setLineMessage(numbersOnlyMessage);
      return;
    }

    if (cost <= 0) {
      setLineMessage("Ilagay ang custom cost. Example: 15.");
      return;
    }

    setDraftLines((current) => [
      ...current,
      {
        key: nextDraftKey(),
        kind: "custom",
        label: name,
        detail: "Custom cost",
        lineCost: cost,
        lotId: null,
        customName: name,
        quantity: 0,
        unit: "pcs",
      },
    ]);
    setCustomName("");
    setCustomCost("");
  }

  function removeDraftLine(key: string) {
    setDraftLines((current) => current.filter((line) => line.key !== key));
  }

  function resetForm() {
    setOutputProductId(null);
    setRecipeName("");
    setOutputQuantity("");
    setOutputUnit("pcs");
    setProductionMode("prepared_before_selling");
    setRecipeNotes("");
    setDraftLines([]);
    setSelectedLotId(null);
    setLotSearch("");
    setLineQuantity("");
    setCustomName("");
    setCustomCost("");
    setLineMessage(null);
    setFormMessage(null);
    setFormIsError(false);
  }

  function openBuilder() {
    setBuilderStep(1);
    setFormMessage(null);
    setLineMessage(null);
    setShowCreateForm(true);
  }

  function closeBuilder() {
    resetForm();
    setBuilderStep(1);
    setShowCreateForm(false);
  }

  function requestCloseBuilder() {
    const hasDraft = Boolean(recipeName.trim() || outputProductId || draftLines.length > 0);
    if (!hasDraft) {
      closeBuilder();
      return;
    }

    Alert.alert("Discard recipe draft?", "Hindi pa naka-save ang recipe na ito.", [
      { text: "Continue editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: closeBuilder },
    ]);
  }

  function continueBuilder() {
    setFormMessage(null);
    setFormIsError(false);

    if (builderStep === 1) {
      if (!outputProductId) {
        setFormMessage("Piliin kung anong paninda ang gawa ng recipe.");
        setFormIsError(true);
        return;
      }
      if (!recipeName.trim()) {
        setFormMessage("Ilagay ang pangalan ng recipe. Example: Siomai.");
        setFormIsError(true);
        return;
      }
      if (outputQuantityParsed === "invalid" || outputQuantityParsed <= 0) {
        setFormMessage(outputQuantityParsed === "invalid" ? numbersOnlyMessage : "Ilagay ang output ng isang batch.");
        setFormIsError(true);
        return;
      }
      setBuilderStep(2);
      return;
    }

    if (builderStep === 2) {
      if (draftLines.length === 0) {
        setFormMessage("Magdagdag ng kahit isang ingredient o custom cost line.");
        setFormIsError(true);
        return;
      }
      setBuilderStep(3);
    }
  }

  async function saveRecipe() {
    if (saveLock.current) {
      return;
    }

    if (!outputProductId) {
      setFormMessage("Piliin kung anong paninda ang gawa ng recipe na ito.");
      setFormIsError(true);
      return;
    }

    const name = recipeName.trim();
    if (!name) {
      setFormMessage("Recipe name is required. Example: Sushi.");
      setFormIsError(true);
      return;
    }

    const output = parseRequiredNumber(outputQuantity, 0);
    if (output === "invalid") {
      setFormMessage(numbersOnlyMessage);
      setFormIsError(true);
      return;
    }

    if (output <= 0) {
      setFormMessage("Ilagay kung ilang piraso ang gawa ng isang batch. Example: 5.");
      setFormIsError(true);
      return;
    }

    if (draftLines.length === 0) {
      setFormMessage("Add at least one ingredient line.");
      setFormIsError(true);
      return;
    }

    const lines: RecipeDraftLine[] = draftLines.map((line) =>
      line.kind === "lot"
        ? { kind: "lot", lotId: line.lotId as string, quantity: line.quantity, unit: line.unit }
        : { kind: "custom", name: line.customName as string, cost: line.lineCost },
    );

    saveLock.current = true;
    setSaving(true);
    setFormMessage(null);
    try {
      const result = await createRecipeWithLines({
        outputProductId,
        name,
        outputQuantity: output,
        outputUnit,
        productionMode,
        notes: recipeNotes.trim() || null,
        lines,
      });

      resetForm();
      setBuilderStep(1);
      setShowCreateForm(false);
      setSnackbarMessage(
        `${result.recipe.name} saved · ${formatPeso(result.batchCost)} batch · ${formatPeso(result.costPerOutputUnit)}/${outputUnit}`,
      );

      try {
        await refresh();
      } catch (refreshError) {
        logDevError("OwnerRecipes.refreshAfterSave", refreshError);
        setLoadError(getFriendlyErrorMessage("Could not reload the recipe list. Balikan ang screen na ito."));
      }
    } catch (error) {
      logDevError("OwnerRecipes.saveRecipe", error);
      setFormMessage(getUserSafeErrorMessage(error, "Could not save the recipe."));
      setFormIsError(true);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function archive(recipeId: string) {
    if (archiveLock.current) {
      return;
    }

    archiveLock.current = true;
    setArchivingId(recipeId);
    try {
      await archiveRecipe(recipeId);
      await refresh();
    } catch (error) {
      logDevError("OwnerRecipes.archive", error);
      setLoadError(getFriendlyErrorMessage("Could not archive the recipe."));
    } finally {
      archiveLock.current = false;
      setArchivingId(null);
    }
  }

  function confirmArchive(recipeId: string, recipeNameToArchive: string) {
    Alert.alert(
      "Archive recipe?",
      `${recipeNameToArchive} will be hidden from active recipes. Existing production and cost records stay saved.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Archive", style: "destructive", onPress: () => void archive(recipeId) },
      ],
    );
  }

  const visibleItems = (overview?.items ?? []).filter((item) => item.recipe.isActive);
  const filteredItems = visibleItems.filter((item) =>
    `${item.recipe.name} ${item.recipe.outputProductName}`.toLocaleLowerCase().includes(recipeSearch.trim().toLocaleLowerCase()),
  );
  const hasBusiness = Boolean(status?.activeBusiness);

  return (
    <>
      <ScreenScroll bottomNav>
        <AppTopBar
          right={<GabiIconButton accessibilityLabel="Add recipe" icon="add" onPress={openBuilder} />}
          subtitle="Bili → Timpla → Presyo → Luto → Paninda → Benta"
          title="Tindahan"
        />

        <TindahanTabs active="recipes" />

        {snackbarMessage ? (
          <GabiSnackbar message={snackbarMessage} onDismiss={() => setSnackbarMessage(null)} />
        ) : null}

        {loadError ? (
          <>
            <GabiNotice message={loadError} title="Hindi ma-load ang local recipes" tone="danger" />
            <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh()} />
          </>
        ) : null}

        {!overview || !status || !grocery ? (
          <GabiCard>
            <GabiSkeleton height={54} />
            <GabiSkeleton height={112} />
            <GabiSkeleton height={112} />
          </GabiCard>
        ) : null}

        {status && !hasBusiness ? (
          <GabiCard>
            <GabiEmptyState
              actionLabel="Pumili ng negosyo"
              icon="business-outline"
              message="Kailangan ng business context bago gumawa ng recipe. Hindi pipili ang KitaMo nang tahimik."
              onAction={() => router.push("/owner/context")}
              title="Walang napiling negosyo"
            />
          </GabiCard>
        ) : null}

        {overview && hasBusiness ? (
          <View style={styles.summaryGrid}>
            <SummaryTile icon="restaurant-outline" label="Recipe" value={String(overview.activeCount)} />
            <SummaryTile
              icon="cash-outline"
              label="Avg puhunan"
              value={overview.averageCostPerUnit !== null ? formatPeso(overview.averageCostPerUnit) : "—"}
            />
            <SummaryTile
              icon="warning-outline"
              label="Bantayan"
              tone={overview.lowMakeableCount > 0 ? "warning" : "success"}
              value={String(overview.lowMakeableCount)}
            />
          </View>
        ) : null}

        {overview && hasBusiness ? (
          <>
            <GabiSectionHeader
              action={
                <Pressable accessibilityRole="button" hitSlop={6} onPress={openBuilder}>
                  <GabiText tone="primary" variant="buttonSm">+ Recipe</GabiText>
                </Pressable>
              }
              title="Mga recipe"
            />

            {visibleItems.length > 0 ? (
              <View style={[styles.searchWrap, { backgroundColor: extended.field, borderColor: palette.border }]}>
                <Ionicons color={palette.mutedText} name="search" size={19} />
                <TextInput
                  onChangeText={setRecipeSearch}
                  placeholder="Hanapin ang recipe o paninda"
                  placeholderTextColor={extended.textFaint}
                  style={[styles.searchInput, { color: palette.text }]}
                  value={recipeSearch}
                />
              </View>
            ) : null}

            {visibleItems.length === 0 ? (
              <GabiCard>
                <GabiEmptyState
                  actionLabel="Gumawa ng unang recipe"
                  icon="restaurant-outline"
                  message="Pumili ng exact grocery lot para tama ang puhunan at stock deduction."
                  onAction={openBuilder}
                  title="Wala pang recipe"
                />
              </GabiCard>
            ) : null}

            {visibleItems.length > 0 && filteredItems.length === 0 ? (
              <GabiCard>
                <GabiEmptyState
                  icon="search-outline"
                  message="Subukan ang ibang recipe o output product name."
                  title="Walang tugmang recipe"
                />
              </GabiCard>
            ) : null}

            {filteredItems.map((item) => {
              const itemProduct = products.find((product) => product.id === item.recipe.outputProductId) ?? null;
              const price = item.recipe.suggestedSellingPrice ?? itemProduct?.price ?? null;
              const profit = price !== null ? price - item.costPerOutputUnit : null;
              const canCook =
                item.recipe.productionMode === "prepared_before_selling" &&
                (!item.makeable.stockLimited || (item.makeable.batches ?? 0) > 0);

              return (
                <GabiCard key={item.recipe.id} raised>
                  <Pressable
                    accessibilityHint="Open read-only recipe details"
                    accessibilityRole="button"
                    onPress={() => router.push({ pathname: "/owner/recipe-detail", params: { recipeId: item.recipe.id } })}
                    style={styles.recipeHeader}
                  >
                    <View style={styles.recipeText}>
                      <GabiText variant="cardTitle">{item.recipe.name}</GabiText>
                      <GabiText tone="muted" variant="caption">
                        Gawa: {item.recipe.outputProductName} · {formatQuantity(item.recipe.outputQuantity)} {item.recipe.outputUnit} bawat batch
                      </GabiText>
                    </View>
                    <GabiChip
                      icon={item.recipe.productionMode === "cook_upon_order" ? "flash-outline" : "restaurant-outline"}
                      label={item.recipe.productionMode === "cook_upon_order" ? "Cook upon order" : "Prepared"}
                      tone={item.recipe.productionMode === "cook_upon_order" ? "primary" : "accent"}
                    />
                  </Pressable>

                  <View style={styles.costGrid}>
                    <CostMetric label="PUHUNAN" tone="primary" value={`${formatPeso(item.costPerOutputUnit)}/${item.recipe.outputUnit}`} />
                    <CostMetric label="BATCH" value={formatPeso(item.batchCost)} />
                    <CostMetric
                      label="TUBO / UNIT"
                      tone={profit !== null && profit >= 0 ? "success" : profit !== null ? "danger" : "muted"}
                      value={profit !== null ? `${profit >= 0 ? "+" : "−"}${formatPeso(Math.abs(profit))}` : "—"}
                    />
                  </View>

                  <RecipeMakeableCard
                    compact
                    makeable={item.makeable}
                    outputUnit={item.recipe.outputUnit}
                    productionMode={item.recipe.productionMode}
                  />

                  {item.hasCustomLines ? (
                    <GabiNotice
                      message="May custom cost: kasama sa presyo, hindi kasama sa grocery stock math."
                      tone="owner"
                    />
                  ) : null}

                  <View style={styles.recipeActions}>
                    <View style={styles.actionGrow}>
                      <GabiSoftButton
                        compact
                        icon="document-text-outline"
                        label="Detalye"
                        onPress={() => router.push({ pathname: "/owner/recipe-detail", params: { recipeId: item.recipe.id } })}
                      />
                    </View>
                    {item.recipe.productionMode === "prepared_before_selling" ? (
                      <View style={styles.actionGrow}>
                        <GabiPrimaryButton
                          compact
                          disabled={!canCook}
                          icon="restaurant-outline"
                          label="Magluto"
                          onPress={() => router.push({ pathname: "/owner/production", params: { recipeId: item.recipe.id } })}
                        />
                      </View>
                    ) : null}
                    <Pressable
                      accessibilityLabel={`Archive ${item.recipe.name}`}
                      accessibilityRole="button"
                      disabled={archivingId !== null}
                      onPress={() => confirmArchive(item.recipe.id, item.recipe.name)}
                      style={[
                        styles.archiveButton,
                        {
                          backgroundColor: archivingId !== null ? extended.disabledBg : extended.neutralChipBg,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <Ionicons
                        color={archivingId !== null ? extended.disabledText : palette.mutedText}
                        name={archivingId === item.recipe.id ? "hourglass-outline" : "archive-outline"}
                        size={19}
                      />
                    </Pressable>
                  </View>
                  {!canCook && item.recipe.productionMode === "prepared_before_selling" ? (
                    <GabiText tone="danger" variant="caption">Kulang ang bottleneck lot. Bumili muna bago magluto.</GabiText>
                  ) : null}
                </GabiCard>
              );
            })}
          </>
        ) : null}
      </ScreenScroll>

      <Modal animationType="slide" onRequestClose={requestCloseBuilder} visible={showCreateForm}>
        <View style={[styles.builderScreen, { backgroundColor: palette.background, paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.builderHeader}>
            <GabiIconButton accessibilityLabel="Close recipe builder" icon="close" onPress={requestCloseBuilder} />
            <View style={styles.builderHeaderCopy}>
              <GabiText tone="primary" variant="eyebrow">Bagong recipe</GabiText>
              <GabiText variant="h1">
                {builderStep === 1 ? "Ano ang gagawin?" : builderStep === 2 ? "Mga sangkap" : "Suriin ang recipe"}
              </GabiText>
            </View>
            <GabiChip label={`${builderStep} / 3`} tone="primary" />
          </View>

          <View style={styles.progressRow}>
            {[1, 2, 3].map((step) => (
              <View
                key={step}
                style={[
                  styles.progressBar,
                  { backgroundColor: step <= builderStep ? palette.primary : extended.disabledBg },
                ]}
              />
            ))}
          </View>

          <ScrollView
            contentContainerStyle={styles.builderContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {builderStep === 1 ? (
              <>
                <GabiNotice
                  message="Ang output product price ay reference lang. Hindi ito babaguhin ng recipe."
                  title="Timpla at costing muna"
                  tone="owner"
                />

                {!hasBusiness ? (
                  <GabiNotice message="Pumili muna ng negosyo sa Owner context." tone="warning" />
                ) : null}
                {hasBusiness && products.length === 0 ? (
                  <GabiEmptyState
                    actionLabel="Buksan ang Paninda"
                    icon="cube-outline"
                    message="Kailangan ng output paninda bago gumawa ng recipe."
                    onAction={() => {
                      closeBuilder();
                      router.push("/owner/inventory");
                    }}
                    title="Wala pang paninda"
                  />
                ) : null}

                <ProductPicker
                  disabled={saving}
                  onSelect={(product) => {
                    setOutputProductId(product.id);
                    if (!recipeName.trim()) setRecipeName(product.name);
                  }}
                  products={products}
                  selectedId={outputProductId}
                />

                <FormField
                  editable={!saving}
                  label="Pangalan ng recipe"
                  onChangeText={setRecipeName}
                  placeholder="Example: Siomai"
                  value={recipeName}
                />

                <View style={styles.twoColumn}>
                  <FormField
                    editable={!saving}
                    keyboardType="decimal-pad"
                    label="Output bawat batch"
                    onChangeText={setOutputQuantity}
                    placeholder="Example: 40"
                    value={outputQuantity}
                  />
                  <View style={styles.field}>
                    <GabiText variant="buttonSm">Output unit</GabiText>
                    <View style={styles.optionWrap}>
                      {ingredientUnits.map((unit) => (
                        <UnitChip
                          key={unit}
                          label={unit}
                          onPress={() => setOutputUnit(unit)}
                          selected={unit === outputUnit}
                        />
                      ))}
                    </View>
                  </View>
                </View>

                <View style={styles.field}>
                  <GabiText variant="buttonSm">Paraan ng paghahanda</GabiText>
                  {productionModes.map((mode) => {
                    const selected = mode.id === productionMode;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        key={mode.id}
                        onPress={() => setProductionMode(mode.id)}
                        style={[
                          styles.modeOption,
                          {
                            backgroundColor: selected ? palette.softPrimary : palette.surface,
                            borderColor: selected ? palette.primary : palette.border,
                          },
                        ]}
                      >
                        <View style={[styles.modeRadio, { borderColor: selected ? palette.primary : extended.radioOff }]}>
                          {selected ? <View style={[styles.modeRadioDot, { backgroundColor: palette.primary }]} /> : null}
                        </View>
                        <View style={styles.modeCopy}>
                          <GabiText variant="buttonSm">{mode.label}</GabiText>
                          <GabiText tone="muted" variant="caption">
                            {mode.id === "prepared_before_selling"
                              ? "Mag-production muna para madagdagan ang finished stock."
                              : "Cost at grocery deduction ay mangyayari sa bawat Kiosk sale."}
                          </GabiText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <FormField
                  editable={!saving}
                  label="Notes (optional)"
                  onChangeText={setRecipeNotes}
                  placeholder="Example: pang-umaga na batch"
                  value={recipeNotes}
                />
              </>
            ) : null}

            {builderStep === 2 ? (
              <>
                {draftLines.length > 0 ? (
                  <GabiCard>
                    <GabiSectionHeader
                      action={<GabiChip label={`${draftLines.length} linya`} tone="neutral" />}
                      title="Recipe canvas"
                    />
                    {draftLines.map((line) => (
                      <DraftLineRow disabled={saving} key={line.key} line={line} onRemove={() => removeDraftLine(line.key)} />
                    ))}
                    <View style={[styles.runningCost, { backgroundColor: palette.kioskHeader }]}>
                      <GabiText tone="inverse" variant="caption">Batch cost so far</GabiText>
                      <GabiText money tone="inverse" variant="heroPeso">{formatPeso(batchCostPreview)}</GabiText>
                    </View>
                  </GabiCard>
                ) : null}

                <GabiCard>
                  <GabiSectionHeader title="Dagdag sangkap mula Grocery" />
                  {lots.length === 0 ? (
                    <GabiEmptyState
                      actionLabel="Buksan ang Grocery"
                      icon="basket-outline"
                      message="Magdagdag ng purchase lot, o gumamit ng custom cost sa ibaba."
                      onAction={() => {
                        closeBuilder();
                        router.push("/owner/grocery");
                      }}
                      title="Walang grocery lot"
                    />
                  ) : (
                    <>
                      <View style={[styles.searchWrap, { backgroundColor: extended.field, borderColor: palette.border }]}>
                        <Ionicons color={palette.mutedText} name="search" size={19} />
                        <TextInput
                          editable={!saving}
                          onChangeText={(value) => {
                            setLotSearch(value);
                            setSelectedLotId(null);
                          }}
                          placeholder="Ingredient, brand, o source"
                          placeholderTextColor={extended.textFaint}
                          style={[styles.searchInput, { color: palette.text }]}
                          value={lotSearch}
                        />
                      </View>

                      {matchingLots.map((lot) => {
                        const isSelected = lot.id === selectedLotId;
                        const isLowest = lot.costPerUnit === lowestCostByIngredient.get(lot.ingredientId);
                        return (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ selected: isSelected }}
                            disabled={saving}
                            key={lot.id}
                            onPress={() => {
                              setSelectedLotId(lot.id);
                              setLineUnit(lot.unit);
                            }}
                            style={[
                              styles.lotOption,
                              {
                                backgroundColor: isSelected ? palette.softPrimary : palette.surface,
                                borderColor: isSelected ? palette.primary : palette.border,
                              },
                            ]}
                          >
                            <View style={[styles.modeRadio, { borderColor: isSelected ? palette.primary : extended.radioOff }]}>
                              {isSelected ? <View style={[styles.modeRadioDot, { backgroundColor: palette.primary }]} /> : null}
                            </View>
                            <View style={styles.lotOptionText}>
                              <GabiText variant="buttonSm">
                                {lot.ingredientName}{lot.brandName ? ` · ${lot.brandName}` : ""}
                              </GabiText>
                              <GabiText tone="muted" variant="caption">
                                {lot.sourceName ? `${lot.sourceName} · ` : ""}{lot.purchaseDate} · {formatQuantity(lot.remainingQuantity)} {lot.unit} natitira
                              </GabiText>
                              <GabiText money tone="primary" variant="caption">{formatPeso(lot.costPerUnit)}/{lot.unit}</GabiText>
                            </View>
                            {isLowest ? <GabiChip label="Mas mura" tone="success" /> : null}
                          </Pressable>
                        );
                      })}

                      {matchingLots.length === 0 ? (
                        <GabiText tone="muted" variant="caption">Walang tugma sa Grocery Stock.</GabiText>
                      ) : null}

                      <FormField
                        editable={!saving}
                        keyboardType="decimal-pad"
                        label="Gaano karami bawat batch?"
                        onChangeText={setLineQuantity}
                        placeholder="Example: 1.6"
                        value={lineQuantity}
                      />

                      <View style={styles.field}>
                        <GabiText variant="buttonSm">Unit</GabiText>
                        <View style={styles.optionWrap}>
                          {ingredientUnits.map((unit) => {
                            const compatible = !selectedLot || areRecipeUnitsCompatible(unit, selectedLot.unit);
                            return (
                              <UnitChip
                                disabled={!compatible || saving}
                                key={unit}
                                label={unit}
                                onPress={() => setLineUnit(unit)}
                                selected={unit === lineUnit}
                              />
                            );
                          })}
                        </View>
                        {selectedLot ? (
                          <GabiText tone="faint" variant="caption">
                            Compatible lang sa {selectedLot.unit} ang puwedeng piliin. Pack, pcs, timbang, at volume ay hindi hinuhulaan.
                          </GabiText>
                        ) : null}
                      </View>

                      {linePreview && !linePreview.incompatible ? (
                        <View style={[styles.lineCostPreview, { backgroundColor: palette.softPrimary }]}>
                          <View>
                            <GabiText tone="primary" variant="eyebrow">Linyang ito</GabiText>
                            <GabiText tone="muted" variant="caption">
                              {formatQuantity(lineQuantityParsed === "invalid" ? 0 : lineQuantityParsed)} {lineUnit}
                            </GabiText>
                          </View>
                          <GabiText money tone="primary" variant="h1">{formatPeso(linePreview.lineCost)}</GabiText>
                        </View>
                      ) : null}

                      <GabiSoftButton
                        disabled={saving}
                        icon="add"
                        label="Idagdag ang exact lot"
                        onPress={addLotLine}
                      />
                    </>
                  )}
                </GabiCard>

                <GabiCard>
                  <GabiSectionHeader title="Custom cost" />
                  <GabiNotice
                    message="Kasama sa recipe cost, pero hindi ibabawas sa grocery stock at hindi lilimitahan ang makeable quantity."
                    tone="owner"
                  />
                  <View style={styles.twoColumn}>
                    <FormField
                      editable={!saving}
                      label="Pangalan"
                      onChangeText={setCustomName}
                      placeholder="Example: Paminta"
                      value={customName}
                    />
                    <FormField
                      editable={!saving}
                      keyboardType="decimal-pad"
                      label="Cost bawat batch"
                      onChangeText={setCustomCost}
                      placeholder="Example: 15"
                      value={customCost}
                    />
                  </View>
                  <GabiSoftButton disabled={saving} icon="add" label="Idagdag ang custom cost" onPress={addCustomLine} />
                </GabiCard>

                {lineMessage ? <GabiNotice message={lineMessage} tone="danger" /> : null}
              </>
            ) : null}

            {builderStep === 3 ? (
              <>
                <GabiCard>
                  <View style={styles.reviewHeader}>
                    <View style={styles.recipeText}>
                      <GabiText variant="h1">{recipeName}</GabiText>
                      <GabiText tone="muted" variant="caption">
                        {selectedProduct?.name ?? "Paninda"} · {formatQuantity(outputQuantityParsed === "invalid" ? 0 : outputQuantityParsed)} {outputUnit} bawat batch
                      </GabiText>
                    </View>
                    <GabiChip
                      label={productionMode === "cook_upon_order" ? "Cook upon order" : "Prepared"}
                      tone={productionMode === "cook_upon_order" ? "primary" : "accent"}
                    />
                  </View>
                  {draftLines.map((line) => (
                    <DraftLineRow key={line.key} line={line} />
                  ))}
                </GabiCard>

                <View style={[styles.costPanel, { backgroundColor: palette.kioskHeader }]}>
                  <CostPanelRow label="Batch cost" value={formatPeso(batchCostPreview)} />
                  <CostPanelRow
                    accent
                    label={`Bawat ${outputUnit}`}
                    value={costPerUnitPreview !== null ? formatPeso(costPerUnitPreview) : "—"}
                  />
                  <View style={[styles.costDivider, { backgroundColor: extended.textOnPrimaryMuted }]} />
                  <CostPanelRow
                    label={`Presyo ${selectedProduct ? formatPeso(selectedProduct.price) : "—"} → tubo/${outputUnit}`}
                    value={
                      costPerUnitPreview !== null && selectedProduct
                        ? formatPeso(selectedProduct.price - costPerUnitPreview)
                        : "—"
                    }
                  />
                </View>

                <GabiNotice
                  message="Presyo ay advisory lamang. Hindi awtomatikong babaguhin ang paninda."
                  tone="owner"
                />

                <RecipeMakeableCard
                  makeable={draftMakeable}
                  outputUnit={outputUnit}
                  productionMode={productionMode}
                />

                <GabiNotice
                  message="Ang exact lot cost ay ise-save bilang snapshot. Hindi magbabago ang lumang luto kapag nagmahal ang susunod na bili."
                  title="Cost snapshot"
                  tone="success"
                />
              </>
            ) : null}

            {formMessage ? (
              <GabiNotice message={formMessage} tone={formIsError ? "danger" : "success"} />
            ) : null}
          </ScrollView>

          <View style={[styles.builderFooter, { backgroundColor: palette.surface, borderTopColor: palette.border, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <View style={styles.actionGrow}>
              <GabiSoftButton
                disabled={saving}
                icon={builderStep === 1 ? "close" : "arrow-back"}
                label={builderStep === 1 ? "Cancel" : "Bumalik"}
                onPress={() => (builderStep === 1 ? requestCloseBuilder() : setBuilderStep((builderStep - 1) as 1 | 2))}
              />
            </View>
            <View style={styles.actionGrow}>
              {builderStep < 3 ? (
                <GabiPrimaryButton icon="arrow-forward" label="Sunod" onPress={continueBuilder} />
              ) : (
                <GabiPrimaryButton
                  disabled={!hasBusiness || products.length === 0}
                  icon="save-outline"
                  label="I-save ang recipe"
                  loading={saving}
                  onPress={() => void saveRecipe()}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone = "primary",
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  tone?: "primary" | "warning" | "success";
}) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const color = tone === "warning" ? palette.warning : tone === "success" ? palette.success : palette.primary;
  const background = tone === "warning" ? palette.softWarning : tone === "success" ? palette.softSuccess : palette.softPrimary;

  return (
    <GabiCard style={styles.summaryTile}>
      <View style={[styles.summaryIcon, { backgroundColor: background }]}>
        <Ionicons color={color} name={icon} size={19} />
      </View>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText money style={{ color }} variant="h2">{value}</GabiText>
    </GabiCard>
  );
}

function CostMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "success" | "danger" | "muted";
}) {
  return (
    <View style={styles.costMetric}>
      <GabiText tone="faint" variant="eyebrow">{label}</GabiText>
      <GabiText money tone={tone} variant="metricValue">{value}</GabiText>
    </View>
  );
}

function UnitChip({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode === "dark" ? "dark" : "light"];

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.unitChip,
        {
          backgroundColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.surface,
          borderColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.border,
        },
      ]}
    >
      <GabiText
        style={{
          color: disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.text,
          textDecorationLine: disabled ? "line-through" : "none",
        }}
        variant="buttonSm"
      >
        {label}
      </GabiText>
    </Pressable>
  );
}

function DraftLineRow({
  line,
  onRemove,
  disabled = false,
}: {
  line: DraftLineView;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];

  return (
    <View style={[styles.draftRow, { borderBottomColor: palette.border }]}>
      <View style={styles.draftText}>
        <View style={styles.inlineMeta}>
          <GabiText variant="buttonSm">{line.label}</GabiText>
          {line.kind === "custom" ? <GabiChip label="Custom" tone="neutral" /> : null}
        </View>
        <GabiText tone="muted" variant="caption">
          {line.detail}{line.kind === "custom" ? " · hindi kasama sa stock math" : ""}
        </GabiText>
      </View>
      <GabiText money variant="metricValue">{formatPeso(line.lineCost)}</GabiText>
      {onRemove ? (
        <Pressable
          accessibilityLabel={`Remove ${line.label}`}
          accessibilityRole="button"
          disabled={disabled}
          hitSlop={6}
          onPress={onRemove}
          style={styles.removeButton}
        >
          <Ionicons color={disabled ? palette.mutedText : palette.danger} name="close-circle-outline" size={20} />
        </Pressable>
      ) : null}
    </View>
  );
}

function CostPanelRow({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.costPanelRow}>
      <GabiText tone="inverse" variant="buttonSm">{label}</GabiText>
      <GabiText money tone={accent ? "accent" : "inverse"} variant="h1">{value}</GabiText>
    </View>
  );
}

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad";
  editable?: boolean;
};

function FormField({ label, value, onChangeText, placeholder, keyboardType = "default", editable = true }: FormFieldProps) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode === "dark" ? "dark" : "light"];

  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">{label}</GabiText>
      <TextInput
        editable={editable}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.mutedText}
        style={[
          styles.input,
          {
            backgroundColor: editable ? extended.field : extended.disabledBg,
            borderColor: editable ? palette.border : extended.disabledBg,
            color: editable ? palette.text : extended.disabledText,
          },
        ]}
        value={value}
      />
    </View>
  );
}

type ProductPickerProps = {
  products: Product[];
  selectedId: string | null;
  onSelect: (product: Product) => void;
  disabled?: boolean;
};

function ProductPicker({ products, selectedId, onSelect, disabled = false }: ProductPickerProps) {
  const themeMode = useThemeStore((state) => state.themeMode);
  const palette = themePalettes[themeMode === "dark" ? "dark" : "light"];
  const extended = extendedThemePalettes[themeMode === "dark" ? "dark" : "light"];

  if (products.length === 0) {
    return null;
  }

  return (
    <View style={styles.field}>
      <GabiText variant="buttonSm">Anong paninda ang gagawin?</GabiText>
      <View style={styles.productOptions}>
        {products.map((product) => {
          const isSelected = product.id === selectedId;
          return (
            <Pressable
              disabled={disabled}
              key={product.id}
              onPress={() => onSelect(product)}
              style={[
                styles.productOption,
                {
                  backgroundColor: disabled ? extended.disabledBg : isSelected ? palette.softPrimary : palette.surface,
                  borderColor: disabled ? extended.disabledBg : isSelected ? palette.primary : palette.border,
                },
              ]}
            >
              <View style={[styles.modeRadio, { borderColor: isSelected ? palette.primary : extended.radioOff }]}>
                {isSelected ? <View style={[styles.modeRadioDot, { backgroundColor: palette.primary }]} /> : null}
              </View>
              <View style={styles.modeCopy}>
                <GabiText style={{ color: disabled ? extended.disabledText : palette.text }} variant="buttonSm">{product.name}</GabiText>
                <GabiText style={{ color: disabled ? extended.disabledText : palette.mutedText }} variant="caption">
                  Presyo {formatPeso(product.price)} · stock {formatQuantity(product.stockQty)} {product.unitType}
                </GabiText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryTile: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
    padding: spacing.md,
  },
  summaryIcon: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  searchWrap: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  recipeHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  recipeText: {
    flex: 1,
    gap: spacing.xs,
  },
  costGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  costMetric: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 82,
  },
  recipeActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionGrow: {
    flex: 1,
  },
  archiveButton: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  builderScreen: {
    flex: 1,
  },
  builderHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.screenGutter,
    paddingVertical: spacing.sm,
  },
  builderHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  progressRow: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.screenGutter,
    paddingVertical: spacing.sm,
  },
  progressBar: {
    borderRadius: radius.pill,
    flex: 1,
    height: 4,
  },
  builderContent: {
    gap: spacing.md,
    padding: spacing.screenGutter,
    paddingBottom: spacing.xxl,
  },
  builderFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.screenGutter,
    paddingTop: spacing.md,
  },
  field: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 132,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  twoColumn: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  unitChip: {
    alignItems: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  modeOption: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    padding: spacing.md,
  },
  modeRadio: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  modeRadioDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  modeCopy: {
    flex: 1,
    gap: 2,
  },
  lotOption: {
    alignItems: "flex-start",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 64,
    padding: spacing.md,
  },
  lotOptionText: {
    flex: 1,
    gap: 2,
  },
  lineCostPreview: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  draftRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  draftText: {
    flex: 1,
    gap: 2,
  },
  inlineMeta: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  removeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 36,
  },
  runningCost: {
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.md,
  },
  reviewHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  costPanel: {
    borderRadius: radius.lg,
    gap: spacing.md,
    padding: spacing.lg,
  },
  costPanelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  costDivider: {
    height: StyleSheet.hairlineWidth,
    opacity: 0.35,
  },
  productOptions: {
    gap: spacing.sm,
  },
  productOption: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 58,
    padding: spacing.md,
  },
});
