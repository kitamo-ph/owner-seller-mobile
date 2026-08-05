import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { RecipeUnitSelector } from "@/components/owner/RecipeUnitSelector";
import { TindahanTabs } from "@/components/owner/TindahanTabs";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import type { IngredientLotWithName } from "@/db/repositories";
import {
  addGroceryPurchase,
  adjustLotRemainingQuantity,
  archiveGroceryIngredient,
  completeGroceryLotPrice,
  groceryPurchaseUnits,
  loadGroceryPoolScreenSnapshot,
  markGroceryLotEmpty,
  updateGroceryLotMetadata,
  type GroceryPoolSnapshot,
  type GroceryPurchaseUnit,
} from "@/services/groceryPool";
import type { GroceryMissingPriceEntry } from "@/services/groceryRequirements";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";
import { numbersOnlyMessage, parseOptionalStrictNumber, parseRequiredNumber } from "@/utils/numberInput";

type GroceryForm = {
  ingredientName: string;
  brandName: string;
  sourceName: string;
  quantity: string;
  unit: GroceryPurchaseUnit;
  customCupMilliliters: string;
  totalCost: string;
  purchaseDate: string;
  lowStockThreshold: string;
  notes: string;
};

type GroceryLotGroup = {
  ingredientId: string;
  ingredientName: string;
  lots: IngredientLotWithName[];
};

const emptyGroceryForm: GroceryForm = {
  ingredientName: "",
  brandName: "",
  sourceName: "",
  quantity: "",
  unit: "kg",
  customCupMilliliters: "",
  totalCost: "",
  purchaseDate: "",
  lowStockThreshold: "",
  notes: "",
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const groceryGroupRenderBatch = 20;

function groceryUnitLabel(unit: GroceryPurchaseUnit) {
  if (unit === "metric_cup") return "Metric cup · 250 mL";
  if (unit === "us_cup") return "US cup · 236.588 mL";
  if (unit === "custom_cup") return "Our kitchen cup";
  if (unit === "us_gallon") return "US gallon";
  if (unit === "imperial_gallon") return "Imperial gallon";
  return unit;
}

function isValidIsoDate(value: string) {
  if (!isoDatePattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("fil-PH", { dateStyle: "medium" });
}

function groupLots(lots: IngredientLotWithName[]): GroceryLotGroup[] {
  const groups = new Map<string, GroceryLotGroup>();

  for (const lot of lots) {
    const existing = groups.get(lot.ingredientId);
    if (existing) {
      existing.lots.push(lot);
    } else {
      groups.set(lot.ingredientId, {
        ingredientId: lot.ingredientId,
        ingredientName: lot.ingredientName,
        lots: [lot],
      });
    }
  }

  return [...groups.values()];
}

export default function OwnerGroceryScreen() {
  const { ingredientId: requestedIngredientId, lotId: requestedLotId } =
    useLocalSearchParams<{ ingredientId?: string; lotId?: string }>();
  const [snapshot, setSnapshot] = useState<GroceryPoolSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<GroceryForm>(emptyGroceryForm);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formIsError, setFormIsError] = useState(false);
  const [filter, setFilter] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "missing">("all");
  const [groupRenderLimit, setGroupRenderLimit] = useState(groceryGroupRenderBatch);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionLot, setActionLot] = useState<IngredientLotWithName | null>(null);
  const [completionCost, setCompletionCost] = useState("");
  const [actionBrandName, setActionBrandName] = useState("");
  const [actionSourceName, setActionSourceName] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [actionSaving, setActionSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const saveLock = useRef(false);
  const router = useRouter();

  const openLotActions = useCallback((lot: IngredientLotWithName) => {
    setActionLot(lot);
    setCompletionCost("");
    setActionBrandName(lot.brandName ?? "");
    setActionSourceName(lot.sourceName ?? "");
    setActionNotes(lot.notes ?? "");
    setAdjustmentQuantity(String(lot.remainingQuantity));
    setAdjustmentReason("");
    setActionMessage(null);
  }, []);

  const refresh = useCallback(async () => {
    const nextSnapshot = await loadGroceryPoolScreenSnapshot();
    setSnapshot(nextSnapshot);
    return nextSnapshot;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      refresh()
        .then((nextSnapshot) => {
          if (active) {
            setLoadError(null);
            const exactRequestedLot = requestedLotId
              ? nextSnapshot.lots.find((lot) => lot.id === requestedLotId)
              : null;
            const requestedLot =
              exactRequestedLot ??
              (requestedIngredientId
                ? nextSnapshot.lots.find(
                    (lot) => lot.ingredientId === requestedIngredientId,
                  )
                : null);
            if (requestedLot) {
              setFilter("");
              setViewMode("all");
              setShowAddForm(false);
              const requestedGroupIndex = groupLots(nextSnapshot.lots).findIndex(
                (group) => group.ingredientId === requestedLot.ingredientId,
              );
              setGroupRenderLimit(
                Math.max(groceryGroupRenderBatch, requestedGroupIndex + 1),
              );
              openLotActions(requestedLot);
            }
          }
        })
        .catch((error) => {
          logDevError("OwnerGrocery.refresh", error);
          if (active) {
            setLoadError(getFriendlyErrorMessage("Could not load the grocery pool."));
          }
        });

      return () => {
        active = false;
      };
    }, [
      openLotActions,
      refresh,
      requestedIngredientId,
      requestedLotId,
    ]),
  );

  const lowStockIngredientIds = useMemo(
    () => new Set(snapshot?.lowStockIngredients.map((entry) => entry.ingredient.id) ?? []),
    [snapshot?.lowStockIngredients],
  );

  const filteredGroups = useMemo(() => {
    const lots = (snapshot?.lots ?? []).filter(
      (lot) => viewMode === "all" || lot.costState !== "known",
    );
    const query = filter.trim().toLocaleLowerCase();
    if (!query) {
      return groupLots(lots);
    }

    return groupLots(
      lots.filter((lot) =>
        [lot.ingredientName, lot.brandName ?? "", lot.sourceName ?? ""].some((value) => value.toLocaleLowerCase().includes(query)),
      ),
    );
  }, [filter, snapshot?.lots, viewMode]);

  const otherMissingPrices = useMemo(
    () =>
      (snapshot?.missingPrices ?? []).filter(
        (entry) => entry.kind !== "ingredient_lot",
      ),
    [snapshot?.missingPrices],
  );

  const costPreview = useMemo(() => {
    const quantity = parseRequiredNumber(form.quantity, 0);
    const totalCost = parseOptionalStrictNumber(form.totalCost);
    if (
      quantity === "invalid" ||
      totalCost === "invalid" ||
      quantity <= 0 ||
      totalCost === null ||
      totalCost < 0
    ) {
      return null;
    }

    const costPerUnit = totalCost / quantity;
    const previousLot = snapshot?.lots.find(
      (lot) =>
        lot.costState === "known" &&
        lot.recordedTotalCost !== null &&
        lot.ingredientName.toLocaleLowerCase() ===
          form.ingredientName.trim().toLocaleLowerCase() &&
        lot.enteredUnit === form.unit,
    );

    let comparison = "Bagong presyo para sa lot na ito.";
    if (previousLot) {
      const previousCostPerEnteredUnit =
        (previousLot.recordedTotalCost as number) /
        previousLot.enteredQuantity;
      const difference = costPerUnit - previousCostPerEnteredUnit;
      if (Math.abs(difference) < 0.005) {
        comparison = `Kapareho ng huling bili noong ${formatDate(previousLot.purchaseDate)}.`;
      } else {
        comparison = `${formatPeso(Math.abs(difference))} ${difference > 0 ? "mas mahal" : "mas mura"} bawat ${form.unit} kaysa huling bili.`;
      }
    }

    return `${formatPeso(costPerUnit)} bawat ${groceryUnitLabel(form.unit)}. ${comparison}`;
  }, [form.ingredientName, form.quantity, form.totalCost, form.unit, snapshot?.lots]);

  const renderedGroups = filteredGroups.slice(0, groupRenderLimit);
  const remainingGroupCount = Math.max(0, filteredGroups.length - renderedGroups.length);

  async function saveGroceryPurchase() {
    if (saveLock.current) {
      return;
    }

    if (!snapshot?.hasBusiness) {
      setFormMessage("Create your business profile in Owner Settings first.");
      setFormIsError(true);
      return;
    }

    const ingredientName = form.ingredientName.trim();
    if (!ingredientName) {
      setFormMessage("Ilagay ang pangalan ng grocery item. Example: Rice.");
      setFormIsError(true);
      return;
    }

    const quantity = parseRequiredNumber(form.quantity, 0);
    const totalCost = parseOptionalStrictNumber(form.totalCost);
    const customCupMilliliters = parseOptionalStrictNumber(
      form.customCupMilliliters,
    );
    const lowStockThreshold = parseOptionalStrictNumber(form.lowStockThreshold);

    if (
      quantity === "invalid" ||
      totalCost === "invalid" ||
      customCupMilliliters === "invalid" ||
      lowStockThreshold === "invalid"
    ) {
      setFormMessage(numbersOnlyMessage);
      setFormIsError(true);
      return;
    }

    if (quantity <= 0) {
      setFormMessage("Ilagay kung gaano karami ang binili. Example: 10.");
      setFormIsError(true);
      return;
    }

    if (totalCost !== null && totalCost < 0) {
      setFormMessage("Purchase cost cannot be negative.");
      setFormIsError(true);
      return;
    }

    if (
      form.unit === "custom_cup" &&
      (customCupMilliliters === null || customCupMilliliters <= 0)
    ) {
      setFormMessage("Ilagay kung ilang mL ang laman ng kitchen cup ninyo.");
      setFormIsError(true);
      return;
    }

    if (lowStockThreshold !== null && lowStockThreshold < 0) {
      setFormMessage("Low-stock alert cannot be negative.");
      setFormIsError(true);
      return;
    }

    const purchaseDate = form.purchaseDate.trim();
    if (purchaseDate && !isValidIsoDate(purchaseDate)) {
      setFormMessage("Date should look like 2026-07-05. Leave it blank for today.");
      setFormIsError(true);
      return;
    }

    saveLock.current = true;
    setSaving(true);
    setFormMessage(null);
    try {
      const result = await addGroceryPurchase({
        ingredientName,
        brandName: form.brandName.trim() || null,
        sourceName: form.sourceName.trim() || null,
        quantity,
        unit: form.unit,
        customCupMilliliters,
        totalCost,
        purchaseDate: purchaseDate || null,
        lowStockThreshold,
        notes: form.notes.trim() || null,
      });

      setForm((current) => ({ ...emptyGroceryForm, unit: current.unit }));
      setShowOptionalFields(false);
      setFormMessage(
        result.costPerUnit === null
          ? `Naka-save sa phone na ito. ${result.ingredient.name}: No Price muna; quantity at lot evidence ay napanatili.`
          : `Naka-save sa phone na ito. ${result.ingredient.name}: ${formatPeso(result.costPerUnit)} bawat ${result.lot.unit}.`,
      );
      setFormIsError(false);

      try {
        await refresh();
      } catch (refreshError) {
        logDevError("OwnerGrocery.refreshAfterSave", refreshError);
        setLoadError(getFriendlyErrorMessage("Could not reload the grocery list. Balikan ang screen na ito."));
      }
    } catch (error) {
      logDevError("OwnerGrocery.saveGroceryPurchase", error);
      setFormMessage(getUserSafeErrorMessage(error, "Could not save the grocery item."));
      setFormIsError(true);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function addAnotherPurchaseFromLot(lot: IngredientLotWithName) {
    const enteredUnit = groceryPurchaseUnits.includes(
      lot.enteredUnit as GroceryPurchaseUnit,
    )
      ? (lot.enteredUnit as GroceryPurchaseUnit)
      : lot.unit;
    setForm({
      ...emptyGroceryForm,
      ingredientName: lot.ingredientName,
      unit: enteredUnit,
    });
    setActionLot(null);
    setShowAddForm(true);
  }

  async function completeSelectedLotPrice() {
    if (!actionLot || actionSaving) return;
    const parsed = parseOptionalStrictNumber(completionCost);
    if (parsed === "invalid" || parsed === null || parsed < 0) {
      setActionMessage("Enter the actual total purchase cost, including zero when it was truly free.");
      return;
    }
    setActionSaving(true);
    setActionMessage(null);
    try {
      await completeGroceryLotPrice({
        lotId: actionLot.id,
        totalCost: parsed,
        expectedUpdatedAt: actionLot.updatedAt,
      });
      await refresh();
      setActionLot(null);
    } catch (error) {
      logDevError("OwnerGrocery.completePrice", error);
      setActionMessage(
        getUserSafeErrorMessage(error, "Could not complete the missing price."),
      );
    } finally {
      setActionSaving(false);
    }
  }

  async function saveSelectedLotMetadata() {
    if (!actionLot || actionSaving) return;
    setActionSaving(true);
    setActionMessage(null);
    try {
      await updateGroceryLotMetadata({
        lotId: actionLot.id,
        brandName: actionBrandName.trim() || null,
        sourceName: actionSourceName.trim() || null,
        notes: actionNotes.trim() || null,
        expectedUpdatedAt: actionLot.updatedAt,
      });
      await refresh();
      setActionLot(null);
    } catch (error) {
      logDevError("OwnerGrocery.updateLotMetadata", error);
      setActionMessage(
        getUserSafeErrorMessage(error, "Could not update the lot metadata."),
      );
    } finally {
      setActionSaving(false);
    }
  }

  async function saveSelectedStockAdjustment() {
    if (!actionLot || actionSaving) return;
    const parsed = parseOptionalStrictNumber(adjustmentQuantity);
    const reason = adjustmentReason.trim();
    if (
      parsed === "invalid" ||
      parsed === null ||
      parsed < 0 ||
      parsed > actionLot.purchasedQuantity
    ) {
      setActionMessage(
        `Remaining stock must be from 0 to ${formatQuantity(actionLot.purchasedQuantity)} ${actionLot.unit}.`,
      );
      return;
    }
    if (!reason) {
      setActionMessage("Enter a reason for the stock adjustment.");
      return;
    }
    setActionSaving(true);
    setActionMessage(null);
    try {
      await adjustLotRemainingQuantity(actionLot.id, parsed, reason);
      await refresh();
      setActionLot(null);
    } catch (error) {
      logDevError("OwnerGrocery.adjustLot", error);
      setActionMessage(
        getUserSafeErrorMessage(error, "Could not save the stock adjustment."),
      );
    } finally {
      setActionSaving(false);
    }
  }

  function confirmMarkLotEmpty(lot: IngredientLotWithName) {
    const reason = adjustmentReason.trim();
    if (!reason) {
      setActionMessage(
        "Enter an adjustment reason before marking this lot empty.",
      );
      return;
    }
    Alert.alert(
      "Mark this lot empty?",
      `Reason: ${reason}\n\nThis records an adjustment for ${lot.ingredientName}; it does not delete purchase or Recipe history.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark empty",
          style: "destructive",
          onPress: () => {
            setActionSaving(true);
            void markGroceryLotEmpty(lot.id, reason)
              .then(refresh)
              .then(() => setActionLot(null))
              .catch((error) => {
                logDevError("OwnerGrocery.markEmpty", error);
                setActionMessage(
                  getUserSafeErrorMessage(error, "Could not mark the lot empty."),
                );
              })
              .finally(() => setActionSaving(false));
          },
        },
      ],
    );
  }

  function confirmArchiveIngredient(lot: IngredientLotWithName) {
    Alert.alert(
      `Archive ${lot.ingredientName}?`,
      "Archive keeps lots, movements, Recipes, production, COGS, and reports. It removes the ingredient from normal selection.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: () => {
            setActionSaving(true);
            void archiveGroceryIngredient(lot.ingredientId, true)
              .then(refresh)
              .then(() => setActionLot(null))
              .catch((error) => {
                logDevError("OwnerGrocery.archiveIngredient", error);
                setActionMessage(
                  getUserSafeErrorMessage(error, "Could not archive the ingredient."),
                );
              })
              .finally(() => setActionSaving(false));
          },
        },
      ],
    );
  }

  function openMissingPriceOwner(entry: GroceryMissingPriceEntry) {
    if (entry.kind === "recipe_cost") {
      router.push("/owner/recipes");
      return;
    }
    if (entry.kind === "production_plan") {
      router.push("/owner/production");
      return;
    }
    if (entry.kind === "selling_price" || entry.kind === "purchase_cost") {
      router.push("/owner/inventory");
      return;
    }
    if (entry.kind === "ingredient") {
      setForm({
        ...emptyGroceryForm,
        ingredientName: entry.name,
      });
      setFormMessage(null);
      setFormIsError(false);
      setShowAddForm(true);
      return;
    }
    const lot = snapshot?.lots.find(
      (candidate) =>
        (entry.lotId && candidate.id === entry.lotId) ||
        (!entry.lotId && candidate.ingredientId === entry.ingredientId),
    );
    if (lot) openLotActions(lot);
  }

  function openPurchaseSheet() {
    setFormMessage(null);
    setFormIsError(false);
    setShowAddForm(true);
  }

  function closePurchaseSheet() {
    if (saving) {
      return;
    }
    setShowAddForm(false);
    setFormMessage(null);
    setFormIsError(false);
  }

  const hasLots = (snapshot?.lots.length ?? 0) > 0;
  const hasVisibleLotGroups = filteredGroups.length > 0;

  return (
    <ScreenScroll bottomNav>
      <AppTopBar
        eyebrow="Tindahan"
        right={<GabiIconButton accessibilityLabel="Magdagdag ng grocery purchase" icon="add" onPress={openPurchaseSheet} />}
        subtitle="Bawat bili ay hiwalay na lot at presyo"
        title="Grocery"
      />

      <TindahanTabs active="grocery" />

      {loadError ? <GabiNotice message={loadError} title="Hindi ma-load" tone="danger" /> : null}

      {!snapshot ? (
        <GroceryLoadingState />
      ) : !snapshot.hasBusiness ? (
        <GabiCard>
          <GabiEmptyState
            actionLabel="Buksan ang Settings"
            icon="business-outline"
            message="Pumili o gumawa muna ng negosyo bago magtala ng grocery lots."
            onAction={() => router.push("/owner/settings")}
            title="Walang napiling negosyo"
          />
        </GabiCard>
      ) : (
        <>
          <GrocerySummary snapshot={snapshot} />

          <View style={styles.viewModeRow}>
            {viewMode === "all" ? (
              <GabiPrimaryButton compact icon="list-outline" label="All" onPress={() => setViewMode("all")} />
            ) : (
              <GabiSoftButton compact icon="list-outline" label="All" onPress={() => setViewMode("all")} />
            )}
            {viewMode === "missing" ? (
              <GabiPrimaryButton
                compact
                icon="pricetag-outline"
                label={`Missing Prices (${snapshot.missingPrices.length})`}
                onPress={() => setViewMode("missing")}
              />
            ) : (
              <GabiSoftButton
                compact
                icon="pricetag-outline"
                label={`Missing Prices (${snapshot.missingPrices.length})`}
                onPress={() => setViewMode("missing")}
              />
            )}
          </View>

          <GabiSectionHeader
            action={<GabiPrimaryButton compact icon="add" label="Dagdag bili" onPress={openPurchaseSheet} />}
            title="Mga grocery lot"
          />

          {hasLots ? (
            <GabiField
              label="Hanapin"
              onChangeText={(value) => {
                setFilter(value);
                setGroupRenderLimit(groceryGroupRenderBatch);
              }}
              placeholder="Sangkap, brand, o pinagbilhan"
              value={filter}
            />
          ) : null}

          {!hasLots ? (
            <GabiCard>
              <GabiEmptyState
                actionLabel="Idagdag ang unang bili"
                icon="basket-outline"
                message="Halimbawa: Bigas, 10 kilo, ₱650. Ise-save ito bilang sariling lot."
                onAction={openPurchaseSheet}
                title="Wala pang grocery lot"
              />
            </GabiCard>
          ) : !hasVisibleLotGroups ? (
            <GabiCard>
              <GabiEmptyState
                actionLabel={filter ? "I-clear ang search" : "Ipakita lahat"}
                icon={viewMode === "missing" ? "checkmark-circle-outline" : "search-outline"}
                message={
                  viewMode === "missing" && !filter
                    ? "Walang Grocery lot na kulang ang presyo. Tingnan sa ibaba ang ibang records na kailangang kumpletuhin."
                    : "Walang lot na tumutugma sa ingredient, brand, o source."
                }
                onAction={() => {
                  setFilter("");
                  if (!filter) setViewMode("all");
                  setGroupRenderLimit(groceryGroupRenderBatch);
                }}
                title={viewMode === "missing" && !filter ? "Kumpleto ang lot prices" : "Walang nahanap"}
              />
            </GabiCard>
          ) : (
            <View style={styles.groupList}>
              {renderedGroups.map((group) => (
                <View key={group.ingredientId} style={styles.groupSection}>
                  <View style={styles.groupHeader}>
                    <View style={styles.groupTitle}>
                      <GabiText variant="h2">{group.ingredientName}</GabiText>
                      <GabiChip label={`${group.lots.length} ${group.lots.length === 1 ? "lot" : "lots"}`} tone="primary" />
                    </View>
                    <GabiText tone="muted" variant="caption">
                      Hindi pinagsasama ang presyo
                    </GabiText>
                  </View>
                  {group.lots.map((lot) => (
                    <GroceryLotCard
                      key={lot.id}
                      lowStock={lowStockIngredientIds.has(lot.ingredientId)}
                      lot={lot}
                      onOpenActions={() => openLotActions(lot)}
                      recipeUsageCount={snapshot.recipeUsageCountByLot[lot.id] ?? 0}
                    />
                  ))}
                </View>
              ))}
              {remainingGroupCount > 0 ? (
                <GabiSoftButton
                  icon="chevron-down"
                  label={`Ipakita pa (${remainingGroupCount} sangkap)`}
                  onPress={() => setGroupRenderLimit((current) => current + groceryGroupRenderBatch)}
                />
              ) : null}
            </View>
          )}

          {viewMode === "missing" && otherMissingPrices.length > 0 ? (
            <View style={styles.missingPriceSection}>
              <GabiSectionHeader title="Other missing prices" />
              {otherMissingPrices.map((entry) => (
                <MissingPriceCard
                  entry={entry}
                  key={entry.id}
                  onOpen={() => openMissingPriceOwner(entry)}
                />
              ))}
            </View>
          ) : null}
        </>
      )}

      <GroceryPurchaseSheet
        costPreview={costPreview}
        form={form}
        formIsError={formIsError}
        formMessage={formMessage}
        onClose={closePurchaseSheet}
        onFormChange={setForm}
        onSave={saveGroceryPurchase}
        onToggleOptional={() => setShowOptionalFields((visible) => !visible)}
        saving={saving}
        showOptionalFields={showOptionalFields}
        visible={showAddForm}
      />
      <GroceryLotActionsSheet
        adjustmentQuantity={adjustmentQuantity}
        adjustmentReason={adjustmentReason}
        brandName={actionBrandName}
        completionCost={completionCost}
        lot={actionLot}
        message={actionMessage}
        notes={actionNotes}
        onAddAnother={addAnotherPurchaseFromLot}
        onArchive={confirmArchiveIngredient}
        onClose={() => {
          if (!actionSaving) setActionLot(null);
        }}
        onCompletePrice={completeSelectedLotPrice}
        onCompletionCostChange={setCompletionCost}
        onMetadataChange={({ brandName, sourceName, notes }) => {
          if (brandName !== undefined) setActionBrandName(brandName);
          if (sourceName !== undefined) setActionSourceName(sourceName);
          if (notes !== undefined) setActionNotes(notes);
        }}
        onMarkEmpty={confirmMarkLotEmpty}
        onSaveMetadata={saveSelectedLotMetadata}
        onSaveStockAdjustment={saveSelectedStockAdjustment}
        onStockAdjustmentChange={({ quantity, reason }) => {
          if (quantity !== undefined) setAdjustmentQuantity(quantity);
          if (reason !== undefined) setAdjustmentReason(reason);
        }}
        onViewRecipes={() => {
          const ingredientName = actionLot?.ingredientName ?? "this ingredient";
          Alert.alert(
            "Recipe Book opens without an ingredient filter",
            `Ingredient-specific Recipe filtering is not available in this phase. The full Recipe Book will open; search for recipes that use ${ingredientName}.`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Open Recipe Book",
                onPress: () => {
                  setActionLot(null);
                  router.push("/owner/recipes");
                },
              },
            ],
          );
        }}
        saving={actionSaving}
        sourceName={actionSourceName}
      />
    </ScreenScroll>
  );
}

function GroceryLoadingState() {
  return (
    <>
      <GabiCard>
        <GabiSkeleton height={26} width="48%" />
        <GabiSkeleton height={54} />
      </GabiCard>
      <GabiSkeleton height={132} />
      <GabiSkeleton height={132} />
    </>
  );
}

function GrocerySummary({ snapshot }: { snapshot: GroceryPoolSnapshot }) {
  const { palette } = useGabiTheme();
  return (
    <GabiCard>
      <View style={styles.summaryTop}>
        <View style={[styles.summaryIcon, { backgroundColor: palette.softSuccess }]}>
          <Ionicons color={palette.success} name="wallet-outline" size={22} />
        </View>
        <View style={styles.summaryCopy}>
          <GabiText tone="muted" variant="eyebrow">Known remaining grocery value</GabiText>
          <GabiText money variant="heroPeso">{formatPeso(snapshot.totalRemainingValue)}</GabiText>
        </View>
      </View>
      <View style={styles.summaryChips}>
        <GabiChip label={`${snapshot.lotCount} lots`} tone="primary" />
        <GabiChip label={`${snapshot.ingredientCount} sangkap`} tone="success" />
        <GabiChip
          label={`${snapshot.lowStockIngredients.length} paubos`}
          tone={snapshot.lowStockIngredients.length > 0 ? "warning" : "success"}
        />
        <GabiChip label={`${snapshot.recentLotCount} bili nitong 7 araw`} tone="accent" />
        <GabiChip
          label={`${snapshot.missingPriceLotCount} No Price`}
          tone={snapshot.missingPriceLotCount > 0 ? "warning" : "success"}
        />
      </View>
    </GabiCard>
  );
}

function MissingPriceCard({
  entry,
  onOpen,
}: {
  entry: GroceryMissingPriceEntry;
  onOpen: () => void;
}) {
  const ownerLabel =
    entry.kind === "recipe_cost"
      ? "Open Recipe Book"
      : entry.kind === "production_plan"
        ? "Open Production"
        : entry.kind === "selling_price" || entry.kind === "purchase_cost"
          ? "Open Paninda"
          : entry.kind === "ingredient"
            ? "Add Grocery purchase"
            : "Open Grocery lot";
  return (
    <GabiCard raised>
      <View style={styles.missingPriceHeader}>
        <View style={styles.missingPriceCopy}>
          <GabiText variant="cardTitle">{entry.name}</GabiText>
          <GabiText tone="muted" variant="caption">{entry.detail}</GabiText>
        </View>
        <GabiChip label="No Price" tone="warning" />
      </View>
      <GabiSoftButton compact icon="open-outline" label={ownerLabel} onPress={onOpen} />
    </GabiCard>
  );
}

function GroceryLotCard({
  lot,
  lowStock,
  recipeUsageCount,
  onOpenActions,
}: {
  lot: IngredientLotWithName;
  lowStock: boolean;
  recipeUsageCount: number;
  onOpenActions: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  const depleted = lot.remainingQuantity <= 0;
  const hasKnownCost = lot.costState === "known" && lot.recordedCostPerUnit !== null;
  const remainingValue = hasKnownCost
    ? lot.remainingQuantity * (lot.recordedCostPerUnit as number)
    : null;
  const remainingRatio = lot.purchasedQuantity > 0 ? Math.max(0, Math.min(1, lot.remainingQuantity / lot.purchasedQuantity)) : 0;
  const statusTone = depleted ? "danger" : lowStock ? "warning" : "success";
  const statusLabel = depleted ? "Ubos na" : lowStock ? "Paubos" : "May stock";
  const fillColor = depleted ? palette.danger : lowStock ? palette.warning : palette.success;

  return (
    <GabiCard raised style={styles.lotCard}>
      <View style={styles.lotHeader}>
        <View style={[styles.lotIcon, { backgroundColor: depleted ? palette.softDanger : lowStock ? palette.softWarning : palette.softPrimary }]}>
          <Ionicons color={depleted ? palette.danger : lowStock ? palette.warning : palette.primary} name="basket-outline" size={20} />
        </View>
        <View style={styles.lotTitle}>
          <GabiText numberOfLines={2} variant="cardTitle">{lot.brandName ?? "Walang brand"}</GabiText>
          <GabiText tone="muted" variant="caption">
            {lot.sourceName ?? "Hindi nakalagay ang source"} · {formatDate(lot.purchaseDate)}
          </GabiText>
        </View>
        <View style={styles.lotHeaderActions}>
          <GabiChip label={statusLabel} tone={statusTone} />
          {!hasKnownCost ? <GabiChip label="No Price" tone="warning" /> : null}
          <GabiIconButton
            accessibilityLabel={`Mga action para sa ${lot.ingredientName}`}
            icon="ellipsis-horizontal"
            onPress={onOpenActions}
          />
        </View>
      </View>

      <View style={styles.lotFacts}>
        <View style={styles.lotFact}>
          <GabiText tone="muted" variant="caption">Natitira</GabiText>
          <GabiText variant="metricValue">{formatQuantity(lot.remainingQuantity)} {lot.unit}</GabiText>
        </View>
        <View style={styles.lotFact}>
          <GabiText tone="muted" variant="caption">Halaga</GabiText>
          <GabiText money={remainingValue !== null} tone={remainingValue === null ? "muted" : "success"} variant="metricValue">
            {remainingValue === null ? "No Price" : formatPeso(remainingValue)}
          </GabiText>
        </View>
        <View style={styles.lotFact}>
          <GabiText tone="muted" variant="caption">Eksaktong cost</GabiText>
          <GabiText money={hasKnownCost} tone={hasKnownCost ? "primary" : "muted"} variant="metricValue">
            {hasKnownCost ? `${formatPeso(lot.recordedCostPerUnit as number)}/${lot.unit}` : "No Price"}
          </GabiText>
        </View>
      </View>

      <GabiText tone="muted" variant="caption">
        Entered: {formatQuantity(lot.enteredQuantity)} {groceryPurchaseUnits.includes(lot.enteredUnit as GroceryPurchaseUnit)
          ? groceryUnitLabel(lot.enteredUnit as GroceryPurchaseUnit)
          : lot.enteredUnit}
        {lot.enteredUnit !== lot.unit || lot.enteredQuantity !== lot.purchasedQuantity
          ? ` · normalized stock ${formatQuantity(lot.purchasedQuantity)} ${lot.unit}`
          : ""}
      </GabiText>

      <View style={styles.lotProgressRow}>
        <View style={[styles.lotProgressTrack, { backgroundColor: extended.neutralChipBg }]}>
          <View style={[styles.lotProgressFill, { backgroundColor: fillColor, width: `${remainingRatio * 100}%` }]} />
        </View>
        <GabiText tone="muted" variant="caption">
          {formatQuantity(lot.remainingQuantity)} sa {formatQuantity(lot.purchasedQuantity)} {lot.unit}
        </GabiText>
      </View>

      <View style={styles.lotFooter}>
        {recipeUsageCount > 0 ? (
          <GabiChip
            icon="restaurant-outline"
            label={`Ginagamit sa ${recipeUsageCount} ${recipeUsageCount === 1 ? "recipe" : "recipes"}`}
            tone="primary"
          />
        ) : (
          <GabiText tone="faint" variant="caption">Hindi pa ginagamit sa recipe</GabiText>
        )}
        <GabiText tone="muted" variant="caption">
          Bili: {lot.costState === "known" && lot.recordedTotalCost !== null
            ? formatPeso(lot.recordedTotalCost)
            : "Not entered"}
        </GabiText>
      </View>

      {lot.notes ? <GabiNotice message={lot.notes} title="Note sa lot" /> : null}
    </GabiCard>
  );
}

function GroceryPurchaseSheet({
  visible,
  form,
  onFormChange,
  showOptionalFields,
  onToggleOptional,
  costPreview,
  formMessage,
  formIsError,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  form: GroceryForm;
  onFormChange: React.Dispatch<React.SetStateAction<GroceryForm>>;
  showOptionalFields: boolean;
  onToggleOptional: () => void;
  costPreview: string | null;
  formMessage: string | null;
  formIsError: boolean;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Isara ang dagdag bili"
          disabled={saving}
          onPress={onClose}
          style={[styles.modalScrim, { backgroundColor: extended.scrim }]}
        />
        <View style={[styles.purchaseSheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitle}>
              <GabiText variant="h2">Dagdag bili</GabiText>
              <GabiText tone="muted" variant="caption">Isang bili, isang traceable na lot</GabiText>
            </View>
            <GabiSoftButton compact disabled={saving} icon="close" label="Isara" onPress={onClose} />
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <GabiNotice
              message="Hindi pagsasamahin ang presyo nito sa lumang stock. Mananatili ang brand, source, petsa, at exact cost ng lot."
              title="Lot-exact ang costing"
            />

            <GabiField
              autoCapitalize="words"
              disabled={saving}
              label="Ano ang binili mo?"
              onChangeText={(ingredientName) => onFormChange((current) => ({ ...current, ingredientName }))}
              placeholder="Hal. Bigas, toyo, mantika"
              value={form.ingredientName}
            />

            <View style={styles.twoColumn}>
              <View style={styles.quantityField}>
                <GabiField
                  disabled={saving}
                  keyboardType="decimal-pad"
                  label="Gaano karami?"
                  onChangeText={(quantity) => onFormChange((current) => ({ ...current, quantity }))}
                  placeholder="10"
                  value={form.quantity}
                />
              </View>
              <View style={styles.unitField}>
                <RecipeUnitSelector
                  disabled={saving}
                  label="Unit"
                  onChange={(unit) =>
                    onFormChange((current) => ({ ...current, unit }))
                  }
                  options={groceryPurchaseUnits}
                  selected={form.unit}
                />
              </View>
            </View>

            {form.unit === "custom_cup" ? (
              <GabiField
                disabled={saving}
                helperText="Ingredient-specific business measurement; it is not a universal cup."
                keyboardType="decimal-pad"
                label="Our kitchen cup (mL)"
                onChangeText={(customCupMilliliters) =>
                  onFormChange((current) => ({ ...current, customCupMilliliters }))
                }
                placeholder="240"
                value={form.customCupMilliliters}
              />
            ) : null}

            <GabiField
              disabled={saving}
              helperText="Optional. Leave blank to save this lot as No Price and complete it later."
              keyboardType="decimal-pad"
              label="Magkano lahat? (optional)"
              onChangeText={(totalCost) => onFormChange((current) => ({ ...current, totalCost }))}
              placeholder="650"
              value={form.totalCost}
            />

            {costPreview ? <GabiNotice message={costPreview} title="Kuwentang cost" tone="success" /> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showOptionalFields }}
              onPress={onToggleOptional}
              style={[styles.optionalToggle, { backgroundColor: palette.softPrimary }]}
            >
              <View style={styles.optionalCopy}>
                <GabiText variant="buttonSm">Brand, source, petsa, alert, at notes</GabiText>
                <GabiText tone="muted" variant="caption">Optional pero mahalaga sa traceability</GabiText>
              </View>
              <Ionicons color={palette.primary} name={showOptionalFields ? "chevron-up" : "chevron-down"} size={20} />
            </Pressable>

            {showOptionalFields ? (
              <View style={styles.optionalFields}>
                <View style={styles.twoColumn}>
                  <View style={styles.fieldColumn}>
                    <GabiField
                      disabled={saving}
                      label="Brand"
                      onChangeText={(brandName) => onFormChange((current) => ({ ...current, brandName }))}
                      placeholder="Hal. Sinandomeng"
                      value={form.brandName}
                    />
                  </View>
                  <View style={styles.fieldColumn}>
                    <GabiField
                      disabled={saving}
                      label="Pinagbilhan"
                      onChangeText={(sourceName) => onFormChange((current) => ({ ...current, sourceName }))}
                      placeholder="Palengke o grocery"
                      value={form.sourceName}
                    />
                  </View>
                </View>
                <View style={styles.twoColumn}>
                  <View style={styles.fieldColumn}>
                    <GabiField
                      disabled={saving}
                      helperText="Blank = ngayong araw"
                      label="Petsa (YYYY-MM-DD)"
                      onChangeText={(purchaseDate) => onFormChange((current) => ({ ...current, purchaseDate }))}
                      placeholder="2026-07-13"
                      value={form.purchaseDate}
                    />
                  </View>
                  <View style={styles.fieldColumn}>
                    <GabiField
                      disabled={saving}
                      keyboardType="decimal-pad"
                      label="Paubos kapag"
                      onChangeText={(lowStockThreshold) => onFormChange((current) => ({ ...current, lowStockThreshold }))}
                      placeholder="Optional"
                      value={form.lowStockThreshold}
                    />
                  </View>
                </View>
                <GabiField
                  disabled={saving}
                  label="Notes"
                  onChangeText={(notes) => onFormChange((current) => ({ ...current, notes }))}
                  placeholder="Hal. pang-sushi na bigas"
                  value={form.notes}
                />
              </View>
            ) : null}

            {formMessage ? (
              <GabiNotice
                message={formMessage}
                title={formIsError ? "Hindi ma-save" : "Naka-save"}
                tone={formIsError ? "danger" : "success"}
              />
            ) : null}

            <GabiPrimaryButton
              disabled={saving}
              icon="save-outline"
              label={saving ? "Sine-save..." : "I-save ang bili"}
              loading={saving}
              onPress={onSave}
            />
            <GabiSoftButton disabled={saving} icon="close" label="Cancel" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function GroceryLotActionsSheet({
  lot,
  completionCost,
  brandName,
  sourceName,
  notes,
  adjustmentQuantity,
  adjustmentReason,
  message,
  saving,
  onCompletionCostChange,
  onCompletePrice,
  onMetadataChange,
  onSaveMetadata,
  onStockAdjustmentChange,
  onSaveStockAdjustment,
  onAddAnother,
  onViewRecipes,
  onMarkEmpty,
  onArchive,
  onClose,
}: {
  lot: IngredientLotWithName | null;
  completionCost: string;
  brandName: string;
  sourceName: string;
  notes: string;
  adjustmentQuantity: string;
  adjustmentReason: string;
  message: string | null;
  saving: boolean;
  onCompletionCostChange: (value: string) => void;
  onCompletePrice: () => void;
  onMetadataChange: (change: {
    brandName?: string;
    sourceName?: string;
    notes?: string;
  }) => void;
  onSaveMetadata: () => void;
  onStockAdjustmentChange: (change: {
    quantity?: string;
    reason?: string;
  }) => void;
  onSaveStockAdjustment: () => void;
  onAddAnother: (lot: IngredientLotWithName) => void;
  onViewRecipes: () => void;
  onMarkEmpty: (lot: IngredientLotWithName) => void;
  onArchive: (lot: IngredientLotWithName) => void;
  onClose: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  const insets = useSafeAreaInsets();
  if (!lot) return null;
  const hasKnownCost = lot.costState === "known" && lot.recordedTotalCost !== null;

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Isara ang grocery lot actions"
          disabled={saving}
          onPress={onClose}
          style={[styles.modalScrim, { backgroundColor: extended.scrim }]}
        />
        <View style={[styles.purchaseSheet, { backgroundColor: palette.surface, borderColor: palette.border }] }>
          <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitle}>
              <GabiText numberOfLines={2} variant="h2">{lot.ingredientName}</GabiText>
              <GabiText tone="muted" variant="caption">
                {lot.brandName ?? "Walang brand"} · {formatDate(lot.purchaseDate)}
              </GabiText>
            </View>
            <GabiSoftButton compact disabled={saving} icon="close" label="Isara" onPress={onClose} />
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.sheetContent,
              { paddingBottom: Math.max(insets.bottom, spacing.xl) },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.actionSummary}>
              <GabiChip
                label={hasKnownCost ? formatPeso(lot.recordedTotalCost as number) : "No Price"}
                tone={hasKnownCost ? "success" : "warning"}
              />
              <GabiChip
                label={`${formatQuantity(lot.remainingQuantity)} ${lot.unit} remaining`}
                tone={lot.remainingQuantity > 0 ? "primary" : "danger"}
              />
            </View>

            {!hasKnownCost ? (
              <GabiCard>
                <GabiText variant="cardTitle">Complete missing price</GabiText>
                <GabiText tone="muted" variant="caption">
                  This fills previously absent evidence. It cannot rewrite a known price or historical COGS.
                </GabiText>
                <GabiField
                  disabled={saving}
                  helperText="Enter zero only when this purchase was truly free."
                  keyboardType="decimal-pad"
                  label="Actual total purchase cost"
                  onChangeText={onCompletionCostChange}
                  placeholder="650"
                  value={completionCost}
                />
                <GabiPrimaryButton
                  disabled={saving}
                  icon="pricetag-outline"
                  label={saving ? "Sine-save..." : "Save missing price"}
                  loading={saving}
                  onPress={onCompletePrice}
                />
              </GabiCard>
            ) : (
              <GabiNotice
                message="The known purchase price is locked here so evidence already used by Recipes, Production, sales, or reports is not silently rewritten. Add a new purchase for new evidence."
                title="Historical cost protected"
              />
            )}

            <GabiCard>
              <GabiText variant="cardTitle">Edit non-historical metadata</GabiText>
              <GabiText tone="muted" variant="caption">
                Brand, source, and notes can be corrected without changing quantity, unit, purchase cost, or saved cost snapshots.
              </GabiText>
              <View style={styles.twoColumn}>
                <View style={styles.fieldColumn}>
                  <GabiField
                    disabled={saving}
                    label="Brand"
                    onChangeText={(value) => onMetadataChange({ brandName: value })}
                    placeholder="Optional"
                    value={brandName}
                  />
                </View>
                <View style={styles.fieldColumn}>
                  <GabiField
                    disabled={saving}
                    label="Source"
                    onChangeText={(value) => onMetadataChange({ sourceName: value })}
                    placeholder="Optional"
                    value={sourceName}
                  />
                </View>
              </View>
              <GabiField
                disabled={saving}
                label="Notes"
                onChangeText={(value) => onMetadataChange({ notes: value })}
                placeholder="Optional"
                value={notes}
              />
              <GabiSoftButton
                disabled={saving}
                icon="create-outline"
                label="Save metadata"
                onPress={onSaveMetadata}
              />
            </GabiCard>

            <GabiCard>
              <GabiText variant="cardTitle">Adjust remaining stock</GabiText>
              <GabiText tone="muted" variant="caption">
                This creates an adjustment movement. It does not edit the original purchased quantity or cost evidence.
              </GabiText>
              <GabiField
                disabled={saving}
                helperText={`Maximum ${formatQuantity(lot.purchasedQuantity)} ${lot.unit}`}
                keyboardType="decimal-pad"
                label={`Remaining quantity (${lot.unit})`}
                onChangeText={(value) => onStockAdjustmentChange({ quantity: value })}
                value={adjustmentQuantity}
              />
              <GabiField
                disabled={saving}
                label="Adjustment reason"
                onChangeText={(value) => onStockAdjustmentChange({ reason: value })}
                placeholder="Count correction, damage, or spoilage"
                value={adjustmentReason}
              />
              <GabiSoftButton
                disabled={saving}
                icon="swap-vertical-outline"
                label="Save stock adjustment"
                onPress={onSaveStockAdjustment}
              />
            </GabiCard>

            {message ? <GabiNotice message={message} title="Hindi ma-save" tone="danger" /> : null}

            <GabiSoftButton
              disabled={saving}
              icon="add-circle-outline"
              label="Add another purchase"
              onPress={() => onAddAnother(lot)}
            />
            <GabiSoftButton
              disabled={saving}
              icon="restaurant-outline"
              label="Open Recipe Book (not filtered)"
              onPress={onViewRecipes}
            />
            <GabiSoftButton
              disabled={saving || lot.remainingQuantity <= 0}
              icon="remove-circle-outline"
              label={
                lot.remainingQuantity <= 0
                  ? "Lot is already empty"
                  : adjustmentReason.trim()
                    ? "Mark lot empty with entered reason"
                    : "Enter reason above to mark lot empty"
              }
              onPress={() => onMarkEmpty(lot)}
            />
            <GabiSoftButton
              disabled={saving}
              icon="archive-outline"
              label="Archive ingredient"
              onPress={() => onArchive(lot)}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  summaryTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  summaryIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  summaryCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  summaryChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  viewModeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  missingPriceSection: {
    gap: spacing.sm,
  },
  missingPriceHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  missingPriceCopy: {
    flex: 1,
    gap: 2,
    minWidth: 180,
  },
  groupList: {
    gap: spacing.lg,
  },
  groupSection: {
    gap: spacing.sm,
  },
  groupHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  groupTitle: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  lotCard: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  lotHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  lotIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  lotTitle: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  lotHeaderActions: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  lotFacts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  lotFact: {
    flex: 1,
    gap: 2,
    minWidth: 94,
  },
  lotProgressRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  lotProgressTrack: {
    borderRadius: 999,
    flex: 1,
    height: 8,
    minWidth: 120,
    overflow: "hidden",
  },
  lotProgressFill: {
    borderRadius: 999,
    height: "100%",
  },
  lotFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
  },
  purchaseSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: "92%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: "center",
    borderRadius: 999,
    height: 4,
    width: 44,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  sheetTitle: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  sheetContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  actionSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  twoColumn: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quantityField: {
    flex: 1,
    minWidth: 112,
  },
  unitField: {
    flex: 1.4,
    minWidth: 176,
  },
  fieldColumn: {
    flex: 1,
    minWidth: 150,
  },
  unitPicker: {
    gap: spacing.xs,
  },
  unitWrap: {
    gap: spacing.xs,
  },
  unitOption: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.sm,
  },
  optionalToggle: {
    alignItems: "center",
    borderRadius: 16,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    padding: spacing.md,
  },
  optionalCopy: {
    flex: 1,
    gap: 2,
  },
  optionalFields: {
    gap: spacing.md,
  },
});
