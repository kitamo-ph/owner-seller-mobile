import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { TindahanTabs } from "@/components/owner/TindahanTabs";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import { ingredientUnits, type IngredientLotWithName } from "@/db/repositories";
import type { IngredientUnit } from "@/domain/types";
import { addGroceryPurchase, loadGroceryPoolScreenSnapshot, type GroceryPoolSnapshot } from "@/services/groceryPool";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";
import { numbersOnlyMessage, parseOptionalStrictNumber, parseRequiredNumber } from "@/utils/numberInput";

type GroceryForm = {
  ingredientName: string;
  brandName: string;
  sourceName: string;
  quantity: string;
  unit: IngredientUnit;
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
  totalCost: "",
  purchaseDate: "",
  lowStockThreshold: "",
  notes: "",
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const groceryGroupRenderBatch = 20;

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
  const [snapshot, setSnapshot] = useState<GroceryPoolSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<GroceryForm>(emptyGroceryForm);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formIsError, setFormIsError] = useState(false);
  const [filter, setFilter] = useState("");
  const [groupRenderLimit, setGroupRenderLimit] = useState(groceryGroupRenderBatch);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showOptionalFields, setShowOptionalFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    const nextSnapshot = await loadGroceryPoolScreenSnapshot();
    setSnapshot(nextSnapshot);
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
          logDevError("OwnerGrocery.refresh", error);
          if (active) {
            setLoadError(getFriendlyErrorMessage("Could not load the grocery pool."));
          }
        });

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  const lowStockIngredientIds = useMemo(
    () => new Set(snapshot?.lowStockIngredients.map((entry) => entry.ingredient.id) ?? []),
    [snapshot?.lowStockIngredients],
  );

  const filteredGroups = useMemo(() => {
    const lots = snapshot?.lots ?? [];
    const query = filter.trim().toLocaleLowerCase();
    if (!query) {
      return groupLots(lots);
    }

    return groupLots(
      lots.filter((lot) =>
        [lot.ingredientName, lot.brandName ?? "", lot.sourceName ?? ""].some((value) => value.toLocaleLowerCase().includes(query)),
      ),
    );
  }, [filter, snapshot?.lots]);

  const costPreview = useMemo(() => {
    const quantity = parseRequiredNumber(form.quantity, 0);
    const totalCost = parseRequiredNumber(form.totalCost, 0);
    if (quantity === "invalid" || totalCost === "invalid" || quantity <= 0 || totalCost <= 0) {
      return null;
    }

    const costPerUnit = totalCost / quantity;
    const previousLot = snapshot?.lots.find(
      (lot) => lot.ingredientName.toLocaleLowerCase() === form.ingredientName.trim().toLocaleLowerCase() && lot.unit === form.unit,
    );

    let comparison = "Bagong presyo para sa lot na ito.";
    if (previousLot) {
      const difference = costPerUnit - previousLot.costPerUnit;
      if (Math.abs(difference) < 0.005) {
        comparison = `Kapareho ng huling bili noong ${formatDate(previousLot.purchaseDate)}.`;
      } else {
        comparison = `${formatPeso(Math.abs(difference))} ${difference > 0 ? "mas mahal" : "mas mura"} bawat ${form.unit} kaysa huling bili.`;
      }
    }

    return `${formatPeso(costPerUnit)} bawat ${form.unit}. ${comparison}`;
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
    const totalCost = parseRequiredNumber(form.totalCost, 0);
    const lowStockThreshold = parseOptionalStrictNumber(form.lowStockThreshold);

    if (quantity === "invalid" || totalCost === "invalid" || lowStockThreshold === "invalid") {
      setFormMessage(numbersOnlyMessage);
      setFormIsError(true);
      return;
    }

    if (quantity <= 0) {
      setFormMessage("Ilagay kung gaano karami ang binili. Example: 10.");
      setFormIsError(true);
      return;
    }

    if (totalCost <= 0) {
      setFormMessage("Ilagay ang total na binayaran. Example: 650.");
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
        totalCost,
        purchaseDate: purchaseDate || null,
        lowStockThreshold,
        notes: form.notes.trim() || null,
      });

      setForm((current) => ({ ...emptyGroceryForm, unit: current.unit }));
      setShowOptionalFields(false);
      setFormMessage(
        `Naka-save sa phone na ito. ${result.ingredient.name}: ${formatPeso(result.costPerUnit)} bawat ${result.lot.unit}.`,
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
          ) : filteredGroups.length === 0 ? (
            <GabiCard>
              <GabiEmptyState
                actionLabel="I-clear ang search"
                icon="search-outline"
                message="Walang lot na tumutugma sa ingredient, brand, o source."
                onAction={() => {
                  setFilter("");
                  setGroupRenderLimit(groceryGroupRenderBatch);
                }}
                title="Walang nahanap"
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
          <GabiText tone="muted" variant="eyebrow">Natitirang grocery value</GabiText>
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
      </View>
    </GabiCard>
  );
}

function GroceryLotCard({ lot, lowStock, recipeUsageCount }: { lot: IngredientLotWithName; lowStock: boolean; recipeUsageCount: number }) {
  const { palette, extended } = useGabiTheme();
  const depleted = lot.remainingQuantity <= 0;
  const remainingValue = lot.remainingQuantity * lot.costPerUnit;
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
        <GabiChip label={statusLabel} tone={statusTone} />
      </View>

      <View style={styles.lotFacts}>
        <View style={styles.lotFact}>
          <GabiText tone="muted" variant="caption">Natitira</GabiText>
          <GabiText variant="metricValue">{formatQuantity(lot.remainingQuantity)} {lot.unit}</GabiText>
        </View>
        <View style={styles.lotFact}>
          <GabiText tone="muted" variant="caption">Halaga</GabiText>
          <GabiText money tone="success" variant="metricValue">{formatPeso(remainingValue)}</GabiText>
        </View>
        <View style={styles.lotFact}>
          <GabiText tone="muted" variant="caption">Eksaktong cost</GabiText>
          <GabiText money tone="primary" variant="metricValue">{formatPeso(lot.costPerUnit)}/{lot.unit}</GabiText>
        </View>
      </View>

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
        <GabiText tone="muted" variant="caption">Bili: {formatPeso(lot.totalCost)}</GabiText>
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
            contentContainerStyle={styles.sheetContent}
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
                <UnitPicker
                  disabled={saving}
                  onSelect={(unit) => onFormChange((current) => ({ ...current, unit }))}
                  selected={form.unit}
                />
              </View>
            </View>

            <GabiField
              disabled={saving}
              keyboardType="decimal-pad"
              label="Magkano lahat?"
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

function UnitPicker({ selected, onSelect, disabled = false }: { selected: IngredientUnit; onSelect: (unit: IngredientUnit) => void; disabled?: boolean }) {
  const { palette, extended } = useGabiTheme();

  return (
    <View style={styles.unitPicker}>
      <GabiText variant="buttonSm">Unit</GabiText>
      <ScrollView contentContainerStyle={styles.unitWrap} horizontal showsHorizontalScrollIndicator={false}>
        {ingredientUnits.map((unit) => {
          const isSelected = unit === selected;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              key={unit}
              onPress={() => onSelect(unit)}
              style={[
                styles.unitOption,
                {
                  backgroundColor: disabled ? extended.disabledBg : isSelected ? palette.kioskHeader : palette.surface,
                  borderColor: disabled ? extended.disabledBg : isSelected ? palette.kioskHeader : palette.border,
                },
              ]}
            >
              <GabiText style={{ color: disabled ? extended.disabledText : isSelected ? palette.kioskHeaderText : palette.text }} variant="caption">
                {unit}
              </GabiText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
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
