import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { NetworkStatusBadge } from "@/components/common/NetworkStatusBadge";
import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiHeroCard, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll, formatPeso } from "@/components/ui/KitaMoUI";
import { listActiveOwnerAlerts, resolveOwnerAlert } from "@/db/repositories";
import type { OwnerAlert, OwnerAlertSeverity } from "@/domain/types";
import { loadFixedCostsOverview } from "@/services/fixedCosts";
import { loadGroceryPoolSnapshot, type GroceryPoolSnapshot } from "@/services/groceryPool";
import { listRecentKioskOrders, type KioskOrderSummary } from "@/services/kioskSales";
import { getLocalAnalyticsSnapshot, getTodaySalesSummary, type TodaySalesSummary } from "@/services/localAnalytics";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { loadProfitReport, type ProfitReport, type StallReport } from "@/services/profitReports";
import { loadRecipesOverview, type RecipesOverview } from "@/services/recipes";
import { useAppStore } from "@/state/appStore";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

type AttentionItem = {
  message: string;
  href: Href;
  tone: "danger" | "warning";
};

type StallStatus = "good" | "attention" | "loss" | "none" | "inactive";

const severityLabels: Record<OwnerAlertSeverity, string> = {
  info: "Info",
  warning: "Bantayan",
  critical: "Urgent",
};

const severityTones: Record<OwnerAlertSeverity, "neutral" | "warning" | "danger"> = {
  info: "neutral",
  warning: "warning",
  critical: "danger",
};

const quickActions: { label: string; href: Href; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Benta", href: "/kiosk", icon: "storefront-outline" },
  { label: "Grocery", href: "/owner/grocery", icon: "basket-outline" },
  { label: "Paninda", href: "/owner/inventory", icon: "cube-outline" },
  { label: "Recipe", href: "/owner/recipes", icon: "restaurant-outline" },
  { label: "Niluto", href: "/owner/production", icon: "flame-outline" },
  { label: "Bayarin", href: "/owner/fixed-costs", icon: "wallet-outline" },
  { label: "Reports", href: "/owner/reports", icon: "stats-chart-outline" },
];

function formatAlertTime(value: string) {
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Magandang umaga";
  if (hour < 18) return "Magandang hapon";
  return "Magandang gabi";
}

function getStallStatus(stall: StallReport, enabled: boolean): StallStatus {
  if (!enabled) return "inactive";
  if (stall.transactionCount === 0) return "none";
  if (stall.netProfit < 0) return "loss";
  if (stall.estimatedCogsCount > 0) return "attention";
  return "good";
}

function stallStatusLabel(status: StallStatus) {
  if (status === "good") return "OK ngayon";
  if (status === "attention") return "Bantayan";
  if (status === "loss") return "Lugi ngayon";
  if (status === "inactive") return "Naka-off";
  return "Wala pang benta";
}

function stallStatusTone(status: StallStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "good") return "success";
  if (status === "attention") return "warning";
  if (status === "loss") return "danger";
  return "neutral";
}

function buildAttentionItems(input: {
  overdueCount: number;
  dueSoonCount: number;
  groceryLowStockCount: number;
  productLowStockCount: number;
  estimatedCogsCount: number;
  lowMakeableCount: number;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (input.overdueCount > 0 || input.dueSoonCount > 0) {
    items.push({
      message:
        input.overdueCount > 0
          ? `May ${input.overdueCount} overdue na bayarin${input.dueSoonCount > 0 ? ` at ${input.dueSoonCount} due soon` : ""}.`
          : `May ${input.dueSoonCount} bayarin sa susunod na 7 araw.`,
      href: "/owner/fixed-costs",
      tone: input.overdueCount > 0 ? "danger" : "warning",
    });
  }

  if (input.groceryLowStockCount > 0) {
    items.push({
      message: `${input.groceryLowStockCount} grocery ingredient${input.groceryLowStockCount === 1 ? "" : "s"} ang low stock.`,
      href: "/owner/grocery",
      tone: "warning",
    });
  }

  if (input.productLowStockCount > 0) {
    items.push({
      message: `${input.productLowStockCount} paninda ang low stock.`,
      href: "/owner/inventory",
      tone: "warning",
    });
  }

  if (input.estimatedCogsCount > 0) {
    items.push({
      message: `${input.estimatedCogsCount} benta today ang estimated pa ang cost.`,
      href: "/owner/reports",
      tone: "warning",
    });
  }

  if (input.lowMakeableCount > 0) {
    items.push({
      message: `${input.lowMakeableCount} recipe ang konti na lang ang kayang lutuin.`,
      href: "/owner/recipes",
      tone: "warning",
    });
  }

  return items;
}

export default function OwnerHomeScreen() {
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [today, setToday] = useState<TodaySalesSummary | null>(null);
  const [todayReport, setTodayReport] = useState<ProfitReport | null>(null);
  const [grocery, setGrocery] = useState<GroceryPoolSnapshot | null>(null);
  const [recipesOverview, setRecipesOverview] = useState<RecipesOverview | null>(null);
  const [recentOrders, setRecentOrders] = useState<KioskOrderSummary[]>([]);
  const [alerts, setAlerts] = useState<OwnerAlert[]>([]);
  const [productLowStockCount, setProductLowStockCount] = useState(0);
  const [estimatedCogsCount, setEstimatedCogsCount] = useState(0);
  const [fixedCostAttention, setFixedCostAttention] = useState({ overdue: 0, dueSoon: 0 });
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveLock = useRef(false);
  const setOwnerContext = useAppStore((state) => state.setOwnerContext);
  const { palette, extended } = useGabiTheme();
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      let active = true;

      async function loadStatus() {
        try {
          const nextStatus = await loadOwnerSetupStatus();
          const businessId = nextStatus.activeBusiness?.id ?? null;
          // The shared SQLite handle is intentionally read sequentially on SDK 54.
          const nextToday = await getTodaySalesSummary(businessId);
          const nextReport = await loadProfitReport("today");
          const nextGrocery = await loadGroceryPoolSnapshot();
          const nextRecipes = await loadRecipesOverview();
          const orders = await listRecentKioskOrders(2);
          const nextAnalytics = await getLocalAnalyticsSnapshot("today");
          const fixedOverview = await loadFixedCostsOverview();
          const nextAlerts = businessId ? await listActiveOwnerAlerts(businessId) : [];

          if (!active) return;

          setStatus(nextStatus);
          setToday(nextToday);
          setTodayReport(nextReport);
          setGrocery(nextGrocery);
          setRecipesOverview(nextRecipes);
          setRecentOrders(orders);
          setAlerts(nextAlerts);
          setProductLowStockCount(nextAnalytics.lowStock.lowStockCount);
          setEstimatedCogsCount(nextAnalytics.lifecycle.estimatedCogsCountToday);
          setFixedCostAttention({ overdue: fixedOverview.overdueCount, dueSoon: fixedOverview.dueSoonCount });
          setOwnerContext(nextStatus.activeBusiness, nextStatus.activeBranch);
          setError(null);
        } catch (loadError) {
          logDevError("OwnerHome.loadStatus", loadError);
          if (active) setError(getFriendlyErrorMessage("Could not load your local workspace."));
        }
      }

      loadStatus();
      return () => {
        active = false;
      };
    }, [setOwnerContext]),
  );

  async function resolveAlert(alert: OwnerAlert) {
    if (resolveLock.current) return;

    resolveLock.current = true;
    setResolvingAlertId(alert.id);
    try {
      await resolveOwnerAlert(alert.id);
      const businessId = status?.activeBusiness?.id;
      setAlerts(businessId ? await listActiveOwnerAlerts(businessId) : []);
    } catch (resolveError) {
      logDevError("OwnerHome.resolveAlert", resolveError);
      setError(getFriendlyErrorMessage("Could not resolve the alert."));
    } finally {
      resolveLock.current = false;
      setResolvingAlertId(null);
    }
  }

  const setupComplete = Boolean(status?.activeBusiness && status.activeBranch && status.productCount > 0);
  const salesTotal = today?.salesTotal ?? 0;
  const costTotal = today?.costTotal ?? 0;
  const bayarinToday = todayReport?.consolidated.fixedCosts ?? 0;
  const nasayangToday = todayReport?.consolidated.spoilageLoss ?? 0;
  const tuboToday = todayReport?.consolidated.netProfit ?? salesTotal - costTotal;
  const stallReports = todayReport?.stalls ?? [];

  const attentionItems = useMemo(
    () =>
      buildAttentionItems({
        overdueCount: fixedCostAttention.overdue,
        dueSoonCount: fixedCostAttention.dueSoon,
        groceryLowStockCount: grocery?.lowStockIngredients.length ?? 0,
        productLowStockCount,
        estimatedCogsCount,
        lowMakeableCount: recipesOverview?.lowMakeableCount ?? 0,
      }),
    [estimatedCogsCount, fixedCostAttention, grocery?.lowStockIngredients.length, productLowStockCount, recipesOverview?.lowMakeableCount],
  );

  return (
    <ScreenScroll bottomNav>
      <AppTopBar
        eyebrow={`OWNER · ${new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`}
        right={
          <View style={styles.topActions}>
            <GabiIconButton
              accessibilityLabel="Notifications"
              badgeCount={alerts.length}
              icon="notifications-outline"
              onPress={() => router.push("/owner/notifications")}
            />
            <GabiIconButton accessibilityLabel="Settings" icon="settings-outline" onPress={() => router.push("/owner/settings")} />
          </View>
        }
        subtitle="Lahat ng negosyo at stall, isang tingin"
        title={`${greetingForHour(new Date().getHours())}!`}
      />

      {error ? <GabiNotice message={error} title="Hindi ma-load ang lahat" tone="danger" /> : null}

      {!status ? (
        <GabiCard>
          <GabiSkeleton height={18} showImmediately width="42%" />
          <GabiSkeleton height={46} showImmediately />
          <GabiSkeleton height={86} showImmediately />
        </GabiCard>
      ) : !status.activeBusiness ? (
        <GabiEmptyState
          actionLabel="Pumili o gumawa"
          message={status.businesses.length ? "Pumili ng negosyo para makita ang stalls at reports nito." : "Gumawa ng local business profile para makapagsimula."}
          icon="business-outline"
          onAction={() => router.push(status.businesses.length ? "/owner/context" : "/owner/business-settings")}
          title={status.businesses.length ? "Walang napiling negosyo" : "I-set up ang negosyo"}
        />
      ) : (
        <>
          <GabiHeroCard>
            <View style={styles.heroHeader}>
              <View style={styles.heroCopy}>
                <GabiText style={{ color: palette.kioskHeaderText }} variant="eyebrow">NET PROFIT TODAY</GabiText>
                <GabiText
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  money
                  numberOfLines={1}
                  style={[styles.heroAmount, { color: palette.kioskHeaderText }]}
                  variant="heroPeso"
                >
                  {formatPeso(tuboToday)}
                </GabiText>
                <GabiText style={{ color: extended.textOnPrimaryMuted }} variant="caption">
                  Revenue − Sold COGS − Fixed Costs − Spoilage
                </GabiText>
              </View>
              <View style={[styles.heroIcon, { backgroundColor: palette.softAccent }]}>
                <Ionicons color={extended.accentTextOn} name="trending-up" size={25} />
              </View>
            </View>
            <View style={styles.heroMetrics}>
              <HeroMetric label="Benta" value={formatPeso(salesTotal)} />
              <HeroMetric label="Puhunan" value={formatPeso(costTotal)} />
              <HeroMetric label="Bayarin" value={formatPeso(bayarinToday)} />
              <HeroMetric label="Nasayang" value={formatPeso(nasayangToday)} />
            </View>
            <View style={styles.heroFooter}>
              <GabiText style={{ color: extended.textOnPrimaryMuted }} variant="caption">
                {today?.transactionCount ?? 0} benta · {status.stallCount} stall{status.stallCount === 1 ? "" : "s"}
              </GabiText>
              <NetworkStatusBadge compact pendingQueueCount={status.pendingQueueCount} />
            </View>
          </GabiHeroCard>

          {!setupComplete ? (
            <GabiNotice
              message="Kailangan ng active stall at paninda bago makapagbenta. Walang awtomatikong gagawing stall."
              title="Tapusin ang setup"
              tone="warning"
            />
          ) : null}

          <View style={styles.sectionGap}>
            <GabiSectionHeader
              action={
                <Pressable accessibilityRole="button" onPress={() => router.push("/owner/business-settings")}>
                  <GabiText tone="primary" variant="buttonSm">Pamahalaan</GabiText>
                </Pressable>
              }
              title="Mga stall"
            />
            <GabiText tone="muted" variant="caption">Piliin at kumpirmahin ang stall bago buksan ang Kiosk.</GabiText>
          </View>

          {stallReports.length > 0 ? (
            <View style={styles.stallList}>
              {stallReports.map((stall) => {
                const branch = status.branches.find((item) => item.id === stall.branchId);
                return (
                  <StallFinanceCard
                    enabled={branch?.active ?? false}
                    isSelected={status.activeBranch?.id === stall.branchId}
                    key={stall.branchId}
                    stall={stall}
                  />
                );
              })}
            </View>
          ) : (
            <GabiEmptyState
              actionLabel="Magdagdag ng stall"
              message="Kailangan ng stall bago buksan ang shared-device Kiosk."
              icon="storefront-outline"
              onAction={() => router.push("/owner/business-settings")}
              title="Wala pang stall"
            />
          )}

          {alerts.length > 0 ? (
            <View style={styles.sectionGap}>
              <GabiSectionHeader
                action={
                  <Pressable accessibilityRole="button" onPress={() => router.push("/owner/notifications")}>
                    <GabiText tone="primary" variant="buttonSm">Lahat</GabiText>
                  </Pressable>
                }
                title="Mga abiso"
              />
              {alerts.slice(0, 2).map((alert) => (
                <GabiCard key={alert.id} style={styles.alertCard}>
                  <View style={styles.alertHeader}>
                    <View style={styles.alertCopy}>
                      <GabiText variant="buttonSm">{alert.title}</GabiText>
                      <GabiText tone="muted" variant="caption">{formatAlertTime(alert.createdAt)}</GabiText>
                    </View>
                    <GabiChip label={severityLabels[alert.severity]} tone={severityTones[alert.severity]} />
                  </View>
                  <GabiText tone="muted" variant="body">{alert.message}</GabiText>
                  <View style={styles.alertAction}>
                    <GabiSoftButton
                      compact
                      disabled={resolvingAlertId !== null}
                      icon="checkmark-circle-outline"
                      label={resolvingAlertId === alert.id ? "Inaayos..." : "Ayos na"}
                      loading={resolvingAlertId === alert.id}
                      onPress={() => resolveAlert(alert)}
                    />
                  </View>
                </GabiCard>
              ))}
            </View>
          ) : null}

          <GabiCard>
            <GabiSectionHeader title="Mabilis na gawain" />
            <View style={styles.quickGrid}>
              {quickActions.map((action) => (
                <Pressable
                  accessibilityLabel={action.label}
                  accessibilityRole="button"
                  key={action.label}
                  onPress={() => router.push(action.href)}
                  style={({ pressed }) => [styles.quickAction, { backgroundColor: pressed ? palette.softPrimary : palette.background }]}
                >
                  <View style={[styles.quickIcon, { backgroundColor: palette.softPrimary }]}>
                    <Ionicons color={palette.primary} name={action.icon} size={20} />
                  </View>
                  <GabiText numberOfLines={1} tone="muted" variant="caption">{action.label}</GabiText>
                </Pressable>
              ))}
            </View>
          </GabiCard>

          {attentionItems.length > 0 ? (
            <GabiCard>
              <GabiSectionHeader action={<GabiChip label={`${attentionItems.length}`} tone="warning" />} title="Bantayan" />
              {attentionItems.slice(0, 3).map((item) => (
                <Pressable
                  accessibilityRole="button"
                  key={item.message}
                  onPress={() => router.push(item.href)}
                  style={[styles.attentionRow, { backgroundColor: item.tone === "danger" ? palette.softDanger : palette.softWarning }]}
                >
                  <Ionicons color={item.tone === "danger" ? palette.danger : palette.warning} name="warning-outline" size={20} />
                  <GabiText style={styles.attentionCopy} variant="body">{item.message}</GabiText>
                  <Ionicons color={extended.textFaint} name="chevron-forward" size={18} />
                </Pressable>
              ))}
            </GabiCard>
          ) : null}

          <GabiCard>
            <GabiSectionHeader
              action={
                <Pressable accessibilityRole="button" onPress={() => router.push("/owner/records")}>
                  <GabiText tone="primary" variant="buttonSm">Logbook</GabiText>
                </Pressable>
              }
              title="Huling benta"
            />
            {recentOrders.length === 0 ? (
              <GabiEmptyState
                message="Lalabas dito ang mga lokal na checkout matapos ang unang benta."
                icon="receipt-outline"
                title="Wala pang benta today"
              />
            ) : (
              <View style={styles.recentList}>
                {recentOrders.map((order) => (
                  <View key={order.id} style={[styles.recentRow, { borderColor: palette.border }]}>
                    <View style={[styles.recentIcon, { backgroundColor: palette.softSuccess }]}>
                      <Ionicons color={palette.success} name="receipt-outline" size={19} />
                    </View>
                    <View style={styles.recentCopy}>
                      <GabiText numberOfLines={1} variant="buttonSm">{order.transactionNo}</GabiText>
                      <GabiText tone="muted" variant="caption">{order.itemCount} item(s) · {order.paymentMethod}</GabiText>
                    </View>
                    <GabiText money numberOfLines={1} tone="success" variant="metricValue">{formatPeso(order.amount)}</GabiText>
                  </View>
                ))}
              </View>
            )}
          </GabiCard>
        </>
      )}
    </ScreenScroll>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  const { palette, extended } = useGabiTheme();
  return (
    <View style={[styles.heroMetric, { borderColor: extended.textOnPrimaryMuted }]}>
      <GabiText style={{ color: extended.textOnPrimaryMuted }} variant="caption">{label}</GabiText>
      <GabiText adjustsFontSizeToFit minimumFontScale={0.7} money numberOfLines={1} style={{ color: palette.kioskHeaderText }} variant="metricValue">
        {value}
      </GabiText>
    </View>
  );
}

function StallFinanceCard({ stall, enabled, isSelected }: { stall: StallReport; enabled: boolean; isSelected: boolean }) {
  const { palette, extended } = useGabiTheme();
  const status = getStallStatus(stall, enabled);
  const router = useRouter();

  return (
    <GabiCard raised={isSelected} style={[styles.stallCard, isSelected ? { borderColor: palette.primary } : undefined]}>
      <View style={styles.stallHeader}>
        <View style={styles.stallTitle}>
          <GabiText numberOfLines={1} variant="cardTitle">{stall.branchName}</GabiText>
          {isSelected ? <GabiText tone="primary" variant="caption">Aktibong Owner context</GabiText> : null}
        </View>
        <GabiChip label={stallStatusLabel(status)} tone={stallStatusTone(status)} />
      </View>
      <View style={styles.stallMetrics}>
        <StallMetric label="Benta" value={formatPeso(stall.revenue)} />
        <StallMetric label="Puhunan" value={formatPeso(stall.soldCogs)} />
        <StallMetric label="Tubo" tone={stall.netProfit >= 0 ? "success" : "danger"} value={formatPeso(stall.netProfit)} />
      </View>
      <GabiText tone="muted" variant="caption">
        {stall.transactionCount} benta today{stall.bestSellerName ? ` · Top: ${stall.bestSellerName}` : ""}
      </GabiText>
      <View style={styles.stallActions}>
        <View style={styles.stallActionCell}>
          <GabiSoftButton
            compact
            icon="stats-chart-outline"
            label="Report"
            onPress={() => router.push(`/owner/reports?stallId=${stall.branchId}` as Href)}
          />
        </View>
        <View style={styles.stallActionCell}>
          <GabiPrimaryButton
            accessibilityHint={enabled ? "Dadaan sa pagpili at kumpirmasyon ng stall" : "Inactive ang stall"}
            compact
            disabled={!enabled}
            icon="storefront-outline"
            label={enabled ? "Buksan Kiosk" : "Naka-off"}
            onPress={() => router.push({ pathname: "/kiosk", params: { branchId: stall.branchId } })}
          />
        </View>
      </View>
      {!enabled ? (
        <GabiText style={{ color: extended.disabledText }} variant="caption">I-activate muna ang stall sa Business & Stalls.</GabiText>
      ) : null}
    </GabiCard>
  );
}

function StallMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "danger" }) {
  return (
    <View style={styles.stallMetric}>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText adjustsFontSizeToFit minimumFontScale={0.7} money numberOfLines={1} tone={tone} variant="metricValue">{value}</GabiText>
    </View>
  );
}

const styles = StyleSheet.create({
  topActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  heroHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  heroCopy: {
    flex: 1,
    gap: 3,
  },
  heroAmount: {
    fontSize: 34,
    lineHeight: 40,
  },
  heroIcon: {
    alignItems: "center",
    borderRadius: 18,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  heroMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  heroMetric: {
    borderLeftWidth: 1,
    flexBasis: "46%",
    flexGrow: 1,
    gap: 2,
    paddingLeft: spacing.sm,
  },
  heroFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  sectionGap: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  stallList: {
    gap: spacing.md,
  },
  stallCard: {
    padding: 14,
  },
  stallHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  stallTitle: {
    flex: 1,
    gap: 2,
  },
  stallMetrics: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stallMetric: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  stallActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  stallActionCell: {
    flex: 1,
    minWidth: 0,
  },
  alertCard: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  alertCopy: {
    flex: 1,
    gap: 2,
  },
  alertAction: {
    alignSelf: "flex-end",
  },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickAction: {
    alignItems: "center",
    borderRadius: 16,
    flexBasis: "22%",
    flexGrow: 1,
    gap: 5,
    minHeight: 68,
    minWidth: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  quickIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  attentionRow: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 52,
    padding: spacing.sm,
  },
  attentionCopy: {
    flex: 1,
  },
  recentList: {
    gap: spacing.sm,
  },
  recentRow: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingBottom: spacing.sm,
  },
  recentIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  recentCopy: {
    flex: 1,
    gap: 2,
  },
});
