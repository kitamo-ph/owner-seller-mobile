import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import { listProductStockLots, type ProductionBatchWithNames } from "@/db/repositories";
import { presentPanindaEntry } from "@/domain/tindahanPresentation";
import {
  loadCatalogReadiness,
  loadPanindaCatalog,
  type PanindaCatalogEntry,
} from "@/services/catalogItems";
import { listInventoryCatalogItemForSale } from "@/services/itemLifecycle";
import { loadOwnerSetupStatus } from "@/services/ownerSetup";
import { listRecentProduction } from "@/services/production";
import { spacing } from "@/theme/spacing";
import { getUserSafeErrorMessage, logDevError } from "@/utils/errors";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fil-PH", { dateStyle: "medium" }).format(new Date(value));
}

export default function OwnerProductDetailScreen() {
  const { catalogItemId } = useLocalSearchParams<{ catalogItemId?: string }>();
  const router = useRouter();
  const [entry, setEntry] = useState<PanindaCatalogEntry | null>(null);
  const [batches, setBatches] = useState<ProductionBatchWithNames[]>([]);
  const [lotCount, setLotCount] = useState(0);
  const [kioskBranchId, setKioskBranchId] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; danger?: boolean } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = await loadOwnerSetupStatus();
      if (!status.activeBusiness || !catalogItemId) {
        setEntry(null);
        setKioskBranchId(null);
        return;
      }
      const catalog = await loadPanindaCatalog(status.activeBusiness.id);
      const found = catalog.find((item) => item.catalogItemId === catalogItemId) ?? null;
      setEntry(found);
      setPrice(found && found.product.price > 0 ? String(found.product.price) : "");
      if (found) {
        const readiness = await loadCatalogReadiness(
          found.catalogItemId,
          status.activeBranch?.id ?? null,
        );
        setKioskBranchId(
          status.activeBranch &&
            readiness?.productId === found.product.id &&
            readiness.readiness.availableInKiosk
            ? status.activeBranch.id
            : null,
        );
        const [recent, lots] = await Promise.all([
          listRecentProduction(50),
          listProductStockLots(found.product.id),
        ]);
        setBatches(recent.filter((batch) => batch.outputProductId === found.product.id));
        setLotCount(lots.filter((lot) => lot.status === "active" && lot.remainingQuantity > 0).length);
      } else {
        setKioskBranchId(null);
      }
    } catch (error) {
      logDevError("OwnerProductDetail.refresh", error);
      setNotice({ message: getUserSafeErrorMessage(error, "Hindi mabuksan ang detalye."), danger: true });
    } finally {
      setLoading(false);
    }
  }, [catalogItemId]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  async function listForSale() {
    if (!entry || saving) return;
    const parsed = Number(price);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setNotice({ message: "Maglagay ng presyong higit sa zero.", danger: true });
      return;
    }
    setSaving(true);
    try {
      const result = await listInventoryCatalogItemForSale({
        catalogItemId: entry.catalogItemId,
        ownerAuthorized: true,
        sellingPrice: parsed,
      });
      if (result.outcome !== "listed") {
        setNotice({ message: "May kulang pa bago mailagay sa Tindahan.", danger: true });
        return;
      }
      setNotice({ message: `${entry.product.name} nasa Tindahan na sa ${formatPeso(result.sellingPrice)}.` });
      await refresh();
    } catch (error) {
      logDevError("OwnerProductDetail.listForSale", error);
      setNotice({ message: getUserSafeErrorMessage(error, "Hindi mailagay sa Tindahan."), danger: true });
    } finally {
      setSaving(false);
    }
  }

  const presentation = entry ? presentPanindaEntry(entry) : null;
  const knownCost = entry?.purchaseCostState === "known";
  const knownPrice = entry?.sellingPriceState === "known" && (entry?.product.price ?? 0) > 0;
  const margin = entry && knownCost && knownPrice ? entry.product.price - entry.product.cost : null;

  return (
    <ScreenScroll bottomNav>
      <AppTopBar backHref="/owner/inventory" eyebrow="Paninda" subtitle="Stock, presyo, at production history" title={entry?.product.name ?? "Detalye ng paninda"} />

      {notice ? <GabiNotice message={notice.message} tone={notice.danger ? "danger" : "success"} /> : null}

      {loading ? (
        <GabiCard><GabiSkeleton height={112} showImmediately /></GabiCard>
      ) : !entry || !presentation ? (
        <GabiCard><GabiEmptyState actionLabel="Bumalik sa Paninda" icon="cube-outline" message="Maaaring nailipat o na-archive na ang item." onAction={() => router.replace("/owner/inventory")} title="Hindi makita ang paninda" /></GabiCard>
      ) : (
        <>
          <GabiCard raised>
            <View style={styles.heroRow}>
              <View style={styles.heroIcon}><Ionicons name={entry.activeRecipeId ? "restaurant-outline" : "basket-outline"} size={24} /></View>
              <View style={styles.heroCopy}>
                <GabiText variant="h2">{entry.product.name}</GabiText>
                <GabiText tone="muted" variant="body">{presentation.sourceLabel} · {entry.product.category}</GabiText>
              </View>
              <GabiChip label={presentation.stockLabel} tone={presentation.stockTone} />
            </View>
            {presentation.reason ? <GabiNotice message={presentation.reason} tone="warning" /> : null}
            <View style={styles.metrics}>
              <Metric label="Presyo" value={knownPrice ? formatPeso(entry.product.price) : "Walang presyo"} />
              <Metric label="Puhunan" value={knownCost ? formatPeso(entry.product.cost) : "Hindi pa alam"} />
              <Metric label="Tubo / unit" value={margin === null ? "Hindi pa makwenta" : formatPeso(margin)} />
            </View>
          </GabiCard>

          {entry.actions.listForSale ? (
            <GabiCard>
              <GabiSectionHeader title="Ilagay sa Tindahan" />
              <GabiField keyboardType="decimal-pad" label="Presyo kada unit" onChangeText={setPrice} placeholder="Halimbawa 35" value={price} />
              <GabiPrimaryButton disabled={saving} icon="storefront-outline" label={saving ? "Sine-save..." : "Ilagay sa Tindahan"} loading={saving} onPress={() => void listForSale()} />
            </GabiCard>
          ) : null}

          <View style={styles.actions}>
            {kioskBranchId ? (
              <GabiPrimaryButton
                icon="storefront-outline"
                label="Benta na — buksan ang Kiosk"
                onPress={() => router.push({ pathname: "/kiosk", params: { branchId: kioskBranchId } })}
              />
            ) : entry.activeRecipeId ? (
              <GabiPrimaryButton icon="flame-outline" label="Mag-production" onPress={() => router.push({ pathname: "/owner/production", params: { recipeId: entry.activeRecipeId ?? "" } })} />
            ) : null}
            {kioskBranchId && entry.activeRecipeId ? (
              <GabiSoftButton icon="flame-outline" label="Mag-production pa" onPress={() => router.push({ pathname: "/owner/production", params: { recipeId: entry.activeRecipeId ?? "" } })} />
            ) : null}
            {entry.activeRecipeId || entry.draftId ? <GabiSoftButton icon="book-outline" label="Buksan ang Recipe" onPress={() => {
              if (entry.draftId) router.push({ pathname: "/owner/recipe-editor", params: { draftId: entry.draftId } });
              else router.push({ pathname: "/owner/recipe-detail", params: { recipeId: entry.activeRecipeId ?? "" } });
            }} /> : null}
            {!entry.activeRecipeId ? <GabiSoftButton icon="bag-add-outline" label="Magdagdag ng bili sa Paninda" onPress={() => router.replace("/owner/inventory")} /> : null}
          </View>

          <GabiCard>
            <GabiSectionHeader action={<GabiChip label={`${lotCount} active lot${lotCount === 1 ? "" : "s"}`} tone="neutral" />} title="Stock ngayon" />
            <GabiText variant="metricValue">{formatQuantity(entry.product.stockQty)} {entry.product.unitType}</GabiText>
            <GabiText tone="muted" variant="caption">Paubos alert sa {formatQuantity(entry.product.lowStockThreshold)} {entry.product.unitType}. Ang stock at lot records pa rin ang source of truth.</GabiText>
          </GabiCard>

          <GabiCard>
            <GabiSectionHeader title="Production history" />
            {batches.length === 0 ? (
              <GabiText tone="muted" variant="body">Wala pang recorded production para sa item na ito.</GabiText>
            ) : batches.slice(0, 8).map((batch) => (
              <View key={batch.id} style={styles.historyRow}>
                <View style={styles.heroCopy}>
                  <GabiText variant="buttonSm">{formatQuantity(batch.outputQuantity)} {batch.outputUnit}</GabiText>
                  <GabiText tone="muted" variant="caption">{formatDate(batch.createdAt)} · {batch.branchName ?? "Business-wide"}</GabiText>
                </View>
                <GabiText money variant="buttonSm">{formatPeso(batch.totalBatchCost)}</GabiText>
              </View>
            ))}
          </GabiCard>
        </>
      )}
    </ScreenScroll>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><GabiText tone="muted" variant="caption">{label}</GabiText><GabiText numberOfLines={2} variant="buttonSm">{value}</GabiText></View>;
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  heroCopy: { flex: 1, gap: 2, minWidth: 0 },
  heroIcon: { alignItems: "center", borderRadius: 14, height: 48, justifyContent: "center", width: 48 },
  heroRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  historyRow: { alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing.sm, minHeight: 58, paddingVertical: spacing.sm },
  metric: { flex: 1, gap: 3, minWidth: 92 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
