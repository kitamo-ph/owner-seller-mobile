import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState, type ComponentProps } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { RecipeMakeableCard } from "@/components/owner/RecipeMakeableCard";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import type { ProductionBatchWithNames } from "@/db/repositories";
import { planProduction } from "@/domain/productionMath";
import { loadGroceryPoolSnapshot, type GroceryPoolSnapshot } from "@/services/groceryPool";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { listRecentProduction, recordProduction, type ProductionResult } from "@/services/production";
import { buildCostingLines, loadRecipesOverview, type RecipesOverview } from "@/services/recipes";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";
import { numbersOnlyMessage, parseRequiredNumber } from "@/utils/numberInput";

export default function OwnerProductionScreen() {
  const { recipeId: requestedRecipeId } = useLocalSearchParams<{ recipeId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette, extended } = useGabiTheme();

  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [overview, setOverview] = useState<RecipesOverview | null>(null);
  const [grocery, setGrocery] = useState<GroceryPoolSnapshot | null>(null);
  const [recent, setRecent] = useState<ProductionBatchWithNames[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [lastResult, setLastResult] = useState<ProductionResult | null>(null);
  const [lastBranchId, setLastBranchId] = useState<string | null>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);

  const refresh = useCallback(async () => {
    const nextStatus = await loadOwnerSetupStatus();
    const nextOverview = await loadRecipesOverview();
    const nextGrocery = await loadGroceryPoolSnapshot();
    const nextRecent = await listRecentProduction(6);
    const activeBranches = nextStatus.branches.filter((branch) => branch.active);
    const selectableRecipes = nextOverview.items.filter(
      (item) => item.recipe.isActive && item.lines.length > 0 && item.recipe.productionMode === "prepared_before_selling",
    );

    setStatus(nextStatus);
    setOverview(nextOverview);
    setGrocery(nextGrocery);
    setRecent(nextRecent);
    setSelectedBranchId((current) => {
      if (current && activeBranches.some((branch) => branch.id === current)) return current;
      if (nextStatus.activeBranch && activeBranches.some((branch) => branch.id === nextStatus.activeBranch?.id)) {
        return nextStatus.activeBranch.id;
      }
      return null;
    });
    setSelectedRecipeId((current) => {
      if (requestedRecipeId && selectableRecipes.some((item) => item.recipe.id === requestedRecipeId)) return requestedRecipeId;
      if (current && selectableRecipes.some((item) => item.recipe.id === current)) return current;
      return null;
    });
  }, [requestedRecipeId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setReady(false);
      void refresh()
        .then(() => {
          if (active) setLoadError(null);
        })
        .catch((error) => {
          logDevError("OwnerProduction.refresh", error);
          if (active) setLoadError(getFriendlyErrorMessage("Hindi ma-load ang local production data."));
        })
        .finally(() => {
          if (active) setReady(true);
        });
      return () => {
        active = false;
      };
    }, [refresh]),
  );

  const branches = useMemo(() => (status?.branches ?? []).filter((branch) => branch.active), [status?.branches]);
  const activeRecipes = useMemo(
    () =>
      (overview?.items ?? []).filter(
        (item) => item.recipe.isActive && item.lines.length > 0 && item.recipe.productionMode === "prepared_before_selling",
      ),
    [overview?.items],
  );
  const cookOnlyRecipes = useMemo(
    () =>
      (overview?.items ?? []).some(
        (item) => item.recipe.isActive && item.lines.length > 0 && item.recipe.productionMode === "cook_upon_order",
      ),
    [overview?.items],
  );
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId) ?? null;
  const selectedItem = activeRecipes.find((item) => item.recipe.id === selectedRecipeId) ?? null;
  const selectedProduct = status?.products.find((product) => product.id === selectedItem?.recipe.outputProductId) ?? null;
  const lotMap = useMemo(() => new Map((grocery?.lots ?? []).map((lot) => [lot.id, lot])), [grocery?.lots]);
  const parsedQuantity = parseRequiredNumber(quantity, 0);

  const plan = useMemo(() => {
    if (!selectedItem || parsedQuantity === "invalid" || parsedQuantity <= 0) return null;
    return planProduction(buildCostingLines(selectedItem.lines, lotMap), selectedItem.recipe.outputQuantity, parsedQuantity);
  }, [lotMap, parsedQuantity, selectedItem]);

  const deductionDetails = useMemo(
    () =>
      (plan?.deductions ?? []).map((deduction) => {
        const lot = lotMap.get(deduction.lotId);
        const before = lot?.remainingQuantity ?? 0;
        return { ...deduction, before, after: Math.max(0, before - deduction.quantity) };
      }),
    [lotMap, plan?.deductions],
  );

  const maxMakeable = selectedItem?.makeable.stockLimited ? (selectedItem.makeable.units ?? 0) : null;
  const oneBatch = selectedItem?.recipe.outputQuantity ?? 0;
  const twoBatches = oneBatch * 2;
  const hasBusiness = Boolean(status?.activeBusiness);
  const saveDisabled = saving || !selectedBranch || !selectedItem || !plan || !plan.ok;

  function chooseRecipe(recipeId: string) {
    setSelectedRecipeId(recipeId);
    setQuantity("");
    setMessage(null);
    setLastResult(null);
  }

  function applyQuickQuantity(value: number) {
    if (value <= 0) return;
    setQuantity(String(value));
    setMessage(null);
  }

  function openReview() {
    if (!selectedBranch) {
      setMessage("Piliin muna kung saang stall mapupunta ang niluto.");
      setMessageIsError(true);
      return;
    }
    if (!selectedItem) {
      setMessage("Piliin muna ang recipe na lulutuin.");
      setMessageIsError(true);
      return;
    }
    if (parsedQuantity === "invalid") {
      setMessage(numbersOnlyMessage);
      setMessageIsError(true);
      return;
    }
    if (parsedQuantity <= 0) {
      setMessage("Ilagay kung ilang piraso ang niluto. Example: 12.");
      setMessageIsError(true);
      return;
    }
    if (!plan?.ok) {
      setMessage("Ayusin muna ang kulang o incompatible na grocery lot.");
      setMessageIsError(true);
      return;
    }
    setMessage(null);
    setReviewVisible(true);
  }

  async function saveProduction() {
    if (saveLock.current || !selectedBranchId || !selectedItem || parsedQuantity === "invalid" || parsedQuantity <= 0) return;

    saveLock.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const result = await recordProduction({
        recipeId: selectedItem.recipe.id,
        branchId: selectedBranchId,
        producedQuantity: parsedQuantity,
        notes: notes.trim() || null,
      });

      setLastResult(result);
      setLastBranchId(selectedBranchId);
      setQuantity("");
      setNotes("");
      setReviewVisible(false);
      setSuccessVisible(true);
      setMessageIsError(false);

      try {
        await refresh();
      } catch (refreshError) {
        logDevError("OwnerProduction.refreshAfterSave", refreshError);
        setLoadError(getFriendlyErrorMessage("Naka-save ang luto, pero hindi na-reload ang screen. Balikan ito."));
      }
    } catch (error) {
      logDevError("OwnerProduction.saveProduction", error);
      setMessage(getUserSafeErrorMessage(error, "Hindi ma-save ang production."));
      setMessageIsError(true);
      setReviewVisible(false);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  function closeSuccess() {
    setSuccessVisible(false);
    setLastResult(null);
  }

  function openKioskAfterProduction() {
    const branchId = lastBranchId;
    setSuccessVisible(false);
    setLastResult(null);
    if (branchId) router.replace({ pathname: "/kiosk", params: { branchId } });
    else router.replace("/kiosk");
  }

  return (
    <>
      <ScreenScroll bottomNav>
        <AppTopBar
          backHref="/owner/inventory"
          subtitle="Eksaktong lot deduction at cost snapshot"
          title="Niluto / Production"
        />

        {loadError ? (
          <>
            <GabiNotice message={loadError} title="Hindi ma-load ang local production" tone="danger" />
            <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh()} />
          </>
        ) : null}

        {!ready ? (
          <GabiCard>
            <GabiSkeleton height={58} />
            <GabiSkeleton height={72} />
            <GabiSkeleton height={132} />
          </GabiCard>
        ) : null}

        {ready && !hasBusiness ? (
          <GabiCard>
            <GabiEmptyState
              actionLabel="Pumili ng negosyo"
              icon="business-outline"
              message="Kailangan ng business context bago mag-record ng production."
              onAction={() => router.push("/owner/context")}
              title="Walang napiling negosyo"
            />
          </GabiCard>
        ) : null}

        {ready && hasBusiness && branches.length === 0 ? (
          <GabiCard>
            <GabiEmptyState
              actionLabel="Pamahalaan ang stalls"
              icon="storefront-outline"
              message="Kailangan ng active stall para malaman kung saan mapupunta ang finished stock."
              onAction={() => router.push("/owner/business-settings")}
              title="Walang active stall"
            />
          </GabiCard>
        ) : null}

        {ready && hasBusiness && activeRecipes.length === 0 ? (
          <GabiCard>
            <GabiEmptyState
              actionLabel="Buksan ang Recipes"
              icon="restaurant-outline"
              message={
                cookOnlyRecipes
                  ? "Cook-upon-order lang ang recipes. Awtomatikong cost at deduction ang mga iyon sa Kiosk sale."
                  : "Gumawa muna ng prepared-before-selling recipe na may ingredient lines."
              }
              onAction={() => router.push("/owner/recipes")}
              title="Walang recipe para sa production"
            />
          </GabiCard>
        ) : null}

        {ready && hasBusiness && branches.length > 0 && activeRecipes.length > 0 ? (
          <>
            <GabiSectionHeader title="1. Saan mapupunta ang niluto?" />
            <View style={styles.selectionList}>
              {branches.map((branch) => (
                <SelectionRow
                  description={branch.location ?? "Local stall"}
                  icon="storefront-outline"
                  key={branch.id}
                  onPress={() => {
                    setSelectedBranchId(branch.id);
                    setMessage(null);
                  }}
                  selected={branch.id === selectedBranchId}
                  title={branch.branchName}
                />
              ))}
            </View>
            {!selectedBranch ? (
              <GabiNotice message="Operational action ito, kaya kailangan ng explicit stall selection." tone="warning" />
            ) : null}

            <GabiSectionHeader title="2. Anong recipe ang niluto?" />
            <View style={styles.selectionList}>
              {activeRecipes.map((item) => (
                <SelectionRow
                  description={`${formatPeso(item.costPerOutputUnit)}/${item.recipe.outputUnit} · ${formatQuantity(item.recipe.outputQuantity)} ${item.recipe.outputUnit} bawat batch`}
                  icon="restaurant-outline"
                  key={item.recipe.id}
                  onPress={() => chooseRecipe(item.recipe.id)}
                  selected={item.recipe.id === selectedRecipeId}
                  title={item.recipe.name}
                />
              ))}
            </View>
            {!selectedItem ? (
              <GabiNotice message="Pumili ng prepared recipe. Hindi kasama rito ang cook-upon-order." tone="owner" />
            ) : null}

            {selectedItem ? (
              <>
                <RecipeMakeableCard
                  makeable={selectedItem.makeable}
                  outputUnit={selectedItem.recipe.outputUnit}
                  productionMode={selectedItem.recipe.productionMode}
                />

                <GabiSectionHeader title="3. Ilang piraso ang niluto mo?" />
                <GabiCard raised style={styles.quantityCard}>
                  <TextInput
                    accessibilityLabel={`Quantity produced in ${selectedItem.recipe.outputUnit}`}
                    editable={!saving}
                    keyboardType="decimal-pad"
                    onChangeText={(value) => {
                      setQuantity(value);
                      setMessage(null);
                    }}
                    placeholder="0"
                    placeholderTextColor={extended.textFaint}
                    selectTextOnFocus
                    style={[styles.quantityInput, { color: palette.primary }]}
                    value={quantity}
                  />
                  <GabiText tone="faint" variant="buttonSm">{selectedItem.recipe.outputUnit}</GabiText>
                </GabiCard>

                <View style={styles.quickRow}>
                  <QuickQuantity
                    disabled={maxMakeable !== null && oneBatch > maxMakeable}
                    label={`1 batch · ${formatQuantity(oneBatch)}`}
                    onPress={() => applyQuickQuantity(oneBatch)}
                  />
                  <QuickQuantity
                    disabled={maxMakeable !== null && twoBatches > maxMakeable}
                    label={`2 batch · ${formatQuantity(twoBatches)}`}
                    onPress={() => applyQuickQuantity(twoBatches)}
                  />
                  {maxMakeable !== null ? (
                    <QuickQuantity
                      disabled={maxMakeable <= 0}
                      label={`MAX · ${formatQuantity(maxMakeable)}`}
                      onPress={() => applyQuickQuantity(maxMakeable)}
                      warning
                    />
                  ) : null}
                </View>
                <View style={styles.helperRow}>
                  <Ionicons color={palette.mutedText} name="calculator-outline" size={16} />
                  <GabiText tone="muted" variant="caption">
                    Puwede ang kalahating batch. Fractional production scaling ay suportado ng engine.
                  </GabiText>
                </View>

                {parsedQuantity === "invalid" ? <GabiNotice message={numbersOnlyMessage} tone="danger" /> : null}

                {plan ? (
                  <>
                    {!plan.ok ? (
                      <GabiCard>
                        {plan.shortfalls.map((shortfall) => (
                          <GabiNotice
                            key={shortfall.lotId}
                            message={`Kailangan ${formatQuantity(shortfall.neededQuantity)} ${shortfall.unit}; ${formatQuantity(shortfall.availableQuantity)} ${shortfall.unit} lang ang meron.`}
                            title={`Kulang ang ${shortfall.label}`}
                            tone="danger"
                          />
                        ))}
                        {plan.incompatibleLabels.map((label) => (
                          <GabiNotice
                            key={label}
                            message="Hindi tugma ang recipe unit sa exact grocery lot. g/kg at ml/L lang ang awtomatikong conversion."
                            title={label}
                            tone="danger"
                          />
                        ))}
                        <View style={styles.buttonRow}>
                          {maxMakeable !== null && maxMakeable > 0 ? (
                            <View style={styles.buttonGrow}>
                              <GabiSoftButton
                                compact
                                icon="resize-outline"
                                label={`Gawing MAX ${formatQuantity(maxMakeable)}`}
                                onPress={() => applyQuickQuantity(maxMakeable)}
                              />
                            </View>
                          ) : null}
                          <View style={styles.buttonGrow}>
                            <GabiSoftButton
                              compact
                              icon="basket-outline"
                              label="Buksan ang Grocery"
                              onPress={() => router.push("/owner/grocery")}
                            />
                          </View>
                        </View>
                      </GabiCard>
                    ) : null}

                    <GabiCard>
                      <GabiSectionHeader
                        action={<GabiChip label={`${formatQuantity(plan.batchMultiplier)} batch`} tone="primary" />}
                        title="Gagamitin sa exact lots"
                      />
                      {deductionDetails.map((deduction) => (
                        <View key={deduction.lotId} style={[styles.deductionRow, { borderBottomColor: palette.border }]}>
                          <View style={styles.deductionCopy}>
                            <GabiText variant="buttonSm">{deduction.label}</GabiText>
                            <GabiText tone="muted" variant="caption">
                              {formatQuantity(deduction.before)} → {formatQuantity(deduction.after)} {deduction.unit} natitira
                            </GabiText>
                          </View>
                          <GabiText money tone="danger" variant="buttonSm">
                            −{formatQuantity(deduction.quantity)} {deduction.unit}
                          </GabiText>
                        </View>
                      ))}
                      {plan.lines.filter((line) => line.isCustom).map((line, index) => (
                        <View key={`${line.label}_${index}`} style={[styles.deductionRow, { borderBottomColor: palette.border }]}>
                          <View style={styles.deductionCopy}>
                            <GabiText variant="buttonSm">{line.label}</GabiText>
                            <GabiText tone="muted" variant="caption">Custom cost · walang grocery deduction</GabiText>
                          </View>
                          <GabiText money variant="buttonSm">{formatPeso(line.lineCost)}</GabiText>
                        </View>
                      ))}
                    </GabiCard>

                    <View style={[styles.costBar, { backgroundColor: palette.kioskHeader }]}>
                      <View style={styles.costBarCopy}>
                        <GabiText tone="inverse" variant="caption">
                          Gastos ng lutong ito · {formatPeso(plan.costPerOutputUnit)}/{selectedItem.recipe.outputUnit}
                        </GabiText>
                        <GabiText money tone="inverse" variant="heroPeso">{formatPeso(plan.totalCost)}</GabiText>
                      </View>
                      <GabiChip label={plan.ok ? "Ready" : "Blocked"} tone={plan.ok ? "success" : "danger"} />
                    </View>

                    {selectedProduct ? (
                      <View style={[styles.stockDelta, { backgroundColor: palette.softSuccess }]}>
                        <View>
                          <GabiText tone="success" variant="eyebrow">Idadagdag sa paninda</GabiText>
                          <GabiText tone="muted" variant="caption">
                            {formatQuantity(selectedProduct.stockQty)} ngayon + {formatQuantity(parsedQuantity === "invalid" ? 0 : parsedQuantity)} niluto
                          </GabiText>
                        </View>
                        <GabiText money tone="success" variant="heroPeso">
                          {formatQuantity(selectedProduct.stockQty + (parsedQuantity === "invalid" ? 0 : parsedQuantity))}
                        </GabiText>
                      </View>
                    ) : null}
                  </>
                ) : null}

                <View style={styles.field}>
                  <GabiText variant="buttonSm">Notes (optional)</GabiText>
                  <TextInput
                    editable={!saving}
                    onChangeText={setNotes}
                    placeholder="Example: umagang luto"
                    placeholderTextColor={extended.textFaint}
                    style={[styles.input, { backgroundColor: extended.field, borderColor: palette.border, color: palette.text }]}
                    value={notes}
                  />
                </View>

                {message ? <GabiNotice message={message} tone={messageIsError ? "danger" : "success"} /> : null}

                <GabiPrimaryButton
                  disabled={saveDisabled}
                  icon="checkmark-circle-outline"
                  label="Suriin bago i-save"
                  onPress={openReview}
                />
                {saveDisabled ? (
                  <GabiText tone="faint" variant="caption">
                    Kumpletuhin ang stall, recipe, quantity, at sapat na grocery stock para magpatuloy.
                  </GabiText>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {ready && recent.length > 0 ? (
          <>
            <GabiSectionHeader title="Recent production" />
            <GabiCard>
              {recent.map((batch) => (
                <View key={batch.id} style={[styles.recentRow, { borderBottomColor: palette.border }]}>
                  <View style={[styles.recentIcon, { backgroundColor: palette.softPrimary }]}>
                    <Ionicons color={palette.primary} name="restaurant-outline" size={18} />
                  </View>
                  <View style={styles.recentCopy}>
                    <GabiText variant="buttonSm">
                      +{formatQuantity(batch.outputQuantity)} {batch.outputUnit} · {batch.outputProductName ?? batch.recipeName}
                    </GabiText>
                    <GabiText tone="muted" variant="caption">
                      {batch.branchName ?? "Stall unavailable"} · {new Date(batch.createdAt).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </GabiText>
                  </View>
                  <GabiText money variant="metricValue">{formatPeso(batch.totalBatchCost)}</GabiText>
                </View>
              ))}
            </GabiCard>
          </>
        ) : null}
      </ScreenScroll>

      <Modal animationType="fade" onRequestClose={() => !saving && setReviewVisible(false)} transparent visible={reviewVisible}>
        <View style={[styles.scrim, { backgroundColor: extended.scrim }]}>
          <View style={[styles.sheet, { backgroundColor: palette.surface, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={[styles.sheetHandle, { backgroundColor: palette.border }]} />
            <GabiText variant="h1">Suriin bago i-save</GabiText>

            {selectedItem && selectedBranch && plan && parsedQuantity !== "invalid" ? (
              <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
                <View style={[styles.reviewSummary, { backgroundColor: palette.softPrimary }]}>
                  <GabiText money tone="primary" variant="heroPeso">{formatQuantity(parsedQuantity)}</GabiText>
                  <View style={styles.reviewCopy}>
                    <GabiText variant="buttonSm">{selectedItem.recipe.outputUnit} {selectedItem.recipe.outputProductName}</GabiText>
                    <GabiText tone="muted" variant="caption">
                      {selectedBranch.branchName} · {formatQuantity(plan.batchMultiplier)} batch · {formatPeso(plan.totalCost)}
                    </GabiText>
                  </View>
                </View>

                <GabiText tone="faint" variant="eyebrow">Babawasin sa grocery</GabiText>
                {deductionDetails.map((deduction) => (
                  <View key={deduction.lotId} style={[styles.deductionRow, { borderBottomColor: palette.border }]}>
                    <View style={styles.deductionCopy}>
                      <GabiText variant="buttonSm">{deduction.label}</GabiText>
                      <GabiText tone="muted" variant="caption">
                        Matitira: {formatQuantity(deduction.after)} {deduction.unit}
                      </GabiText>
                    </View>
                    <GabiText tone="danger" variant="buttonSm">−{formatQuantity(deduction.quantity)} {deduction.unit}</GabiText>
                  </View>
                ))}

                {selectedProduct ? (
                  <View style={[styles.stockDelta, { backgroundColor: palette.softSuccess }]}>
                    <View>
                      <GabiText tone="success" variant="eyebrow">{selectedProduct.name} sa stock</GabiText>
                      <GabiText tone="muted" variant="caption">
                        {formatQuantity(selectedProduct.stockQty)} + {formatQuantity(parsedQuantity)} niluto
                      </GabiText>
                    </View>
                    <GabiText money tone="success" variant="heroPeso">
                      {formatQuantity(selectedProduct.stockQty + parsedQuantity)}
                    </GabiText>
                  </View>
                ) : null}

                <GabiPrimaryButton
                  icon="save-outline"
                  label="Tama — i-save ang luto"
                  loading={saving}
                  onPress={() => void saveProduction()}
                />
                <GabiSoftButton disabled={saving} label="Bumalik" onPress={() => setReviewVisible(false)} />
                <GabiNotice
                  message="Isang SQLite transaction: bawas-lots, dagdag-paninda, movements, at cost snapshot. Hindi puwedeng kalahati."
                  tone="owner"
                />
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={closeSuccess} visible={successVisible}>
        <View style={[styles.successScreen, { backgroundColor: palette.background, paddingTop: insets.top + spacing.xl, paddingBottom: Math.max(insets.bottom, spacing.xl) }]}>
          {lastResult ? (
            <>
              <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}>
                <Ionicons color={palette.success} name="checkmark" size={48} />
              </View>
              <GabiText tone="success" variant="h2">Naitala ang luto!</GabiText>
              <GabiText money style={styles.successAmount} variant="displayPeso">
                +{formatQuantity(lastResult.producedQuantity)} {selectedItem?.recipe.outputUnit ?? "pcs"}
              </GabiText>
              <GabiText style={styles.successCenter} variant="h1">{lastResult.productName}</GabiText>
              <GabiText style={styles.successCenter} tone="muted" variant="body">
                Paninda: {formatQuantity(lastResult.newStockQty - lastResult.producedQuantity)} → {formatQuantity(lastResult.newStockQty)} · Gastos {formatPeso(lastResult.totalCost)} · {formatPeso(lastResult.costPerOutputUnit)} bawat unit
              </GabiText>
              <GabiChip label={lastResult.batchId} tone="neutral" />
              <View style={styles.successActions}>
                <GabiPrimaryButton
                  icon="storefront-outline"
                  label="Benta na — pumili at kumpirmahin ang Kiosk"
                  onPress={openKioskAfterProduction}
                />
                <GabiSoftButton icon="refresh" label="Magluto ulit" onPress={closeSuccess} />
              </View>
              <GabiNotice
                message="Naka-snapshot ang cost. Ito ang gagamiting COGS kapag naibenta ang finished stock."
                tone="success"
              />
            </>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

function SelectionRow({
  icon,
  title,
  description,
  selected,
  onPress,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.selectionRow,
        { backgroundColor: selected ? palette.softPrimary : palette.surface, borderColor: selected ? palette.primary : palette.border },
      ]}
    >
      <View style={[styles.selectionIcon, { backgroundColor: palette.softPrimary }]}>
        <Ionicons color={palette.primary} name={icon} size={19} />
      </View>
      <View style={styles.selectionCopy}>
        <GabiText variant="buttonSm">{title}</GabiText>
        <GabiText tone="muted" variant="caption">{description}</GabiText>
      </View>
      <View style={[styles.radio, { borderColor: selected ? palette.primary : extended.radioOff }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: palette.primary }]} /> : null}
      </View>
    </Pressable>
  );
}

function QuickQuantity({
  label,
  onPress,
  disabled = false,
  warning = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  warning?: boolean;
}) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.quickButton,
        {
          backgroundColor: disabled ? extended.disabledBg : warning ? palette.softWarning : palette.surface,
          borderColor: disabled ? extended.disabledBg : warning ? palette.warning : palette.border,
        },
      ]}
    >
      <GabiText
        style={{ color: disabled ? extended.disabledText : warning ? extended.warningDeep : palette.primary }}
        variant="buttonSm"
      >
        {label}
      </GabiText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  selectionList: {
    gap: spacing.sm,
  },
  selectionRow: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
  },
  selectionIcon: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  selectionCopy: {
    flex: 1,
    gap: 2,
  },
  radio: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  radioDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  quantityCard: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: spacing.lg,
  },
  quantityInput: {
    fontSize: 46,
    fontWeight: "800",
    lineHeight: 54,
    minWidth: 92,
    padding: 0,
    textAlign: "center",
  },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickButton: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  helperRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  buttonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  buttonGrow: {
    flex: 1,
    minWidth: 145,
  },
  deductionRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  deductionCopy: {
    flex: 1,
    gap: 2,
  },
  costBar: {
    alignItems: "center",
    borderRadius: radius.lg,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  costBarCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  stockDelta: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  field: {
    gap: spacing.xs,
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
  recentRow: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingVertical: spacing.sm,
  },
  recentIcon: {
    alignItems: "center",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  recentCopy: {
    flex: 1,
    gap: 2,
  },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    gap: spacing.md,
    maxHeight: "88%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: "center",
    borderRadius: radius.pill,
    height: 4,
    width: 44,
  },
  sheetContent: {
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  reviewSummary: {
    alignItems: "center",
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  reviewCopy: {
    flex: 1,
    gap: 2,
  },
  successScreen: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  successIcon: {
    alignItems: "center",
    borderRadius: 42,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  successAmount: {
    fontSize: 38,
    lineHeight: 44,
    textAlign: "center",
  },
  successCenter: {
    textAlign: "center",
  },
  successActions: {
    alignSelf: "stretch",
    gap: spacing.sm,
  },
});
