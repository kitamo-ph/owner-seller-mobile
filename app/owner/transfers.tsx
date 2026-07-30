import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import {
  listTransferableProducts,
  loadTransferCostPreview,
  recordTransfer,
  type TransferableProduct,
  type TransferResult,
} from "@/services/transfers";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, getUserSafeErrorMessage, logDevError } from "@/utils/errors";
import { numbersOnlyMessage, parseRequiredNumber } from "@/utils/numberInput";

export default function OwnerTransfersScreen() {
  const router = useRouter();
  const { palette } = useGabiTheme();
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [products, setProducts] = useState<TransferableProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [toBranchId, setToBranchId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [costSource, setCostSource] = useState<"production_average" | "product_cost" | null>(null);
  const [costLoading, setCostLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [lastResult, setLastResult] = useState<TransferResult | null>(null);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);

  const refresh = useCallback(async () => {
    const nextStatus = await loadOwnerSetupStatus();
    const nextProducts = await listTransferableProducts();
    setStatus(nextStatus);
    setProducts(nextProducts);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void refresh()
        .then(() => { if (active) setLoadError(null); })
        .catch((error) => {
          logDevError("OwnerTransfers.refresh", error);
          if (active) setLoadError(getFriendlyErrorMessage("Could not load transfers."));
        });
      return () => { active = false; };
    }, [refresh]),
  );

  useEffect(() => {
    let active = true;
    if (!selectedProductId) {
      setUnitCost(null);
      setCostSource(null);
      return () => { active = false; };
    }
    setCostLoading(true);
    void loadTransferCostPreview(selectedProductId)
      .then((preview) => {
        if (active) {
          setUnitCost(preview.unitCost);
          setCostSource(preview.source);
        }
      })
      .catch((error) => {
        logDevError("OwnerTransfers.loadCostPreview", error);
        if (active) {
          setUnitCost(null);
          setCostSource(null);
          setMessage(getFriendlyErrorMessage("Could not read the exact transfer cost. Piliin ulit ang product o subukan mamaya."));
          setMessageIsError(true);
        }
      })
      .finally(() => { if (active) setCostLoading(false); });
    return () => { active = false; };
  }, [selectedProductId]);

  const branches = useMemo(() => status?.branches ?? [], [status?.branches]);
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const destinationBranches = useMemo(() => branches.filter((branch) => branch.id !== selectedProduct?.branchId), [branches, selectedProduct?.branchId]);
  const selectedDestination = destinationBranches.find((branch) => branch.id === toBranchId) ?? null;
  const parsedQuantity = parseRequiredNumber(quantity, 0);
  const validQuantity = parsedQuantity !== "invalid" && parsedQuantity > 0 && Boolean(selectedProduct) && parsedQuantity <= (selectedProduct?.stockQty ?? 0);
  const previewTotal = validQuantity && unitCost !== null ? parsedQuantity * unitCost : null;

  async function saveTransfer() {
    if (saveLock.current) return;
    if (!selectedProduct) {
      setMessage("Piliin ang product na ililipat.");
      setMessageIsError(true);
      return;
    }
    if (!toBranchId) {
      setMessage("Piliin kung saang stall ililipat.");
      setMessageIsError(true);
      return;
    }
    if (parsedQuantity === "invalid") {
      setMessage(numbersOnlyMessage);
      setMessageIsError(true);
      return;
    }
    if (parsedQuantity <= 0) {
      setMessage("Ilagay kung ilang piraso ang ililipat. Example: 5.");
      setMessageIsError(true);
      return;
    }
    if (parsedQuantity > selectedProduct.stockQty) {
      setMessage(`Hindi puwedeng mas mataas sa current stock (${formatQuantity(selectedProduct.stockQty)} ${selectedProduct.unitType}).`);
      setMessageIsError(true);
      return;
    }
    saveLock.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const result = await recordTransfer({ productId: selectedProduct.id, toBranchId, quantity: parsedQuantity, notes: notes.trim() || null });
      setQuantity("");
      setNotes("");
      setSelectedProductId(null);
      setToBranchId(null);
      setLastResult(result);
      setMessage(`Saved locally on this device. ${formatQuantity(result.quantity)} ${result.productName} inilipat sa ${result.toBranchName}.`);
      setMessageIsError(false);
      try {
        await refresh();
      } catch (refreshError) {
        logDevError("OwnerTransfers.refreshAfterSave", refreshError);
        setLoadError(getFriendlyErrorMessage("Could not reload transfers. Balikan ang screen na ito."));
      }
    } catch (error) {
      logDevError("OwnerTransfers.saveTransfer", error);
      setMessage(getUserSafeErrorMessage(error, "Could not save the transfer."));
      setMessageIsError(true);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  const hasBusiness = Boolean(status?.activeBusiness);
  const enoughBranches = branches.length >= 2;

  return (
    <ScreenScroll bottomNav>
      <AppTopBar backHref="/owner/inventory" showBrand subtitle="Paninda at value, sabay ilipat." title="Lipat" />

      {loadError ? (
        <GabiCard>
          <GabiNotice message={loadError} title="Hindi mabuksan ang Lipat" tone="danger" />
          <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh()} />
        </GabiCard>
      ) : null}

      {!status ? <TransferSkeleton /> : null}

      {!hasBusiness && status ? (
        <GabiCard>
          <GabiEmptyState actionLabel="Buksan ang Settings" icon="business-outline" message="Kailangan muna ng active business." onAction={() => router.push("/owner/settings")} title="Wala pang business" />
        </GabiCard>
      ) : null}

      {hasBusiness && !enoughBranches ? (
        <GabiCard>
          <GabiEmptyState actionLabel="Manage stalls" icon="git-branch-outline" message="Kailangan ng at least dalawang active stall para makapag-lipat." onAction={() => router.push("/owner/business-settings")} title="Magdagdag muna ng stall" />
        </GabiCard>
      ) : null}

      {hasBusiness && enoughBranches && products.length === 0 && status ? (
        <GabiCard>
          <GabiEmptyState icon="cube-outline" message="Products with stock na naka-assign sa isang stall ang puwedeng ilipat." title="Walang puwedeng ilipat" />
        </GabiCard>
      ) : null}

      {products.length > 0 && enoughBranches ? (
        <>
          <GabiCard>
            <GabiSectionHeader title="1. Piliin ang paninda" />
            <View style={styles.choiceWrap}>
              {products.map((product) => (
                <SelectionChip
                  disabled={saving}
                  key={product.id}
                  label={`${product.name} · ${formatQuantity(product.stockQty)} ${product.unitType}`}
                  onPress={() => {
                    setSelectedProductId(product.id);
                    setToBranchId(null);
                    setMessage(null);
                  }}
                  selected={selectedProductId === product.id}
                />
              ))}
            </View>
          </GabiCard>

          {selectedProduct ? (
            <GabiCard>
              <GabiSectionHeader title="2. Piliin ang destination" />
              <View style={styles.routeRow}>
                <RouteStop icon="storefront-outline" label="Galing" name={selectedProduct.branchName} />
                <Ionicons color={palette.primary} name="arrow-forward" size={22} />
                <RouteStop icon="location-outline" label="Papunta" name={selectedDestination?.branchName ?? "Pumili"} />
              </View>
              <View style={styles.choiceWrap}>
                {destinationBranches.map((branch) => (
                  <SelectionChip disabled={saving} key={branch.id} label={branch.branchName} onPress={() => setToBranchId(branch.id)} selected={toBranchId === branch.id} />
                ))}
              </View>
            </GabiCard>
          ) : null}

          {selectedProduct && selectedDestination ? (
            <GabiCard>
              <GabiSectionHeader title="3. Dami at review" />
              <GabiField
                disabled={saving}
                errorMessage={parsedQuantity === "invalid" ? numbersOnlyMessage : parsedQuantity > selectedProduct.stockQty ? `Hanggang ${formatQuantity(selectedProduct.stockQty)} ${selectedProduct.unitType} lang.` : undefined}
                helperText={`Available: ${formatQuantity(selectedProduct.stockQty)} ${selectedProduct.unitType}`}
                keyboardType="decimal-pad"
                label="Quantity"
                onChangeText={setQuantity}
                placeholder="Example: 5"
                value={quantity}
              />
              <GabiField disabled={saving} label="Notes (optional)" onChangeText={setNotes} placeholder="Example: pang-hapon sa booth" value={notes} />

              {validQuantity ? (
                <View style={[styles.preview, { backgroundColor: palette.softPrimary }]}>
                  <GabiText variant="buttonSm">Transfer preview</GabiText>
                  <PreviewLine label={selectedProduct.branchName} value={`${formatQuantity(selectedProduct.stockQty)} → ${formatQuantity(selectedProduct.stockQty - parsedQuantity)} ${selectedProduct.unitType}`} />
                  <PreviewLine label={selectedDestination.branchName} value={`+${formatQuantity(parsedQuantity)} ${selectedProduct.unitType}`} />
                  <PreviewLine label="Value moved" value={costLoading ? "Reading exact cost…" : previewTotal === null ? "Unavailable" : formatPeso(previewTotal)} />
                  {costSource ? <GabiText tone="faint" variant="caption">Cost basis: {costSource === "production_average" ? "average produced cost" : "saved product cost"}.</GabiText> : null}
                </View>
              ) : null}

              <GabiNotice message="Source stock, destination stock, value, and both movement rows are saved together in one local SQLite transaction." title="Atomic local save" tone="owner" />
              {message ? <GabiNotice message={message} tone={messageIsError ? "danger" : "success"} /> : null}
              <GabiPrimaryButton disabled={!validQuantity || costLoading} icon="swap-horizontal" label="Save Transfer" loading={saving} onPress={() => void saveTransfer()} />
            </GabiCard>
          ) : null}
        </>
      ) : null}

      {lastResult ? (
        <GabiCard>
          <GabiSectionHeader title="Nailipat na" action={<GabiChip icon="checkmark-circle" label="Saved" tone="success" />} />
          <View style={styles.successRoute}>
            <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}><Ionicons color={palette.success} name="swap-horizontal" size={24} /></View>
            <View style={styles.flexCopy}>
              <GabiText variant="cardTitle">{formatQuantity(lastResult.quantity)} {lastResult.productName}</GabiText>
              <GabiText tone="muted" variant="body">{lastResult.fromBranchName} → {lastResult.toBranchName}</GabiText>
            </View>
          </View>
          <PreviewLine label="Value moved" value={`${formatPeso(lastResult.totalCost)} · ${formatPeso(lastResult.unitCost)} each`} />
          {lastResult.createdDestinationProduct ? <GabiNotice message="Gumawa ng matching product entry sa destination stall." tone="success" /> : null}
        </GabiCard>
      ) : null}
    </ScreenScroll>
  );
}

function SelectionChip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.choice,
        {
          backgroundColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.surface,
          borderColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.border,
        },
      ]}
    >
      <GabiText style={{ color: disabled ? extended.disabledText : selected ? palette.kioskHeaderText : palette.text }} variant="buttonSm">{label}</GabiText>
    </Pressable>
  );
}

function RouteStop({ icon, label, name }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; name: string }) {
  const { palette } = useGabiTheme();
  return (
    <View style={styles.routeStop}>
      <View style={[styles.routeIcon, { backgroundColor: palette.softPrimary }]}><Ionicons color={palette.primary} name={icon} size={19} /></View>
      <GabiText tone="faint" variant="caption">{label}</GabiText>
      <GabiText numberOfLines={2} variant="buttonSm">{name}</GabiText>
    </View>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.previewLine}>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText money variant="buttonSm">{value}</GabiText>
    </View>
  );
}

function TransferSkeleton() {
  return (
    <GabiCard>
      <GabiSkeleton height={24} width="54%" />
      <GabiSkeleton height={54} />
      <GabiSkeleton height={54} />
    </GabiCard>
  );
}

const styles = StyleSheet.create({
  flexCopy: { flex: 1 },
  choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { borderRadius: radius.pill, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  routeRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  routeStop: { alignItems: "center", flex: 1, gap: spacing.xs },
  routeIcon: { alignItems: "center", borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  preview: { borderRadius: radius.md, gap: spacing.sm, padding: spacing.md },
  previewLine: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  successRoute: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  successIcon: { alignItems: "center", borderRadius: 16, height: 48, justifyContent: "center", width: 48 },
});
