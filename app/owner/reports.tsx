import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiHeroCard, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { KitaTabs } from "@/components/owner/KitaTabs";
import { AppTopBar, formatPeso, formatQuantity, ScreenScroll } from "@/components/ui/KitaMoUI";
import { loadFixedCostsOverview } from "@/services/fixedCosts";
import { loadProfitReport, reportRanges, type ProfitReport, type ReportRange } from "@/services/profitReports";
import { radius } from "@/theme/radius";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export default function OwnerReportsScreen() {
  const { stallId } = useLocalSearchParams<{ stallId?: string }>();
  const highlightedStallId = typeof stallId === "string" ? stallId : undefined;
  const router = useRouter();
  const { palette, extended } = useGabiTheme();
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [overdueCount, setOverdueCount] = useState(0);
  const [range, setRange] = useState<ReportRange>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (nextRange: ReportRange) => {
    setLoading(true);
    try {
      const nextReport = await loadProfitReport(nextRange);
      const fixedOverview = await loadFixedCostsOverview();
      setReport(nextReport);
      setOverdueCount(fixedOverview.overdueCount);
      setError(null);
    } catch (loadError) {
      logDevError("OwnerReports.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load the kita report."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh(range);
    }, [range, refresh]),
  );

  const consolidated = report?.consolidated;
  const hasActivity = (consolidated?.transactionCount ?? 0) > 0 || (consolidated?.fixedCosts ?? 0) > 0;
  const highlightedStall = report?.stalls.find((stall) => stall.branchId === highlightedStallId);

  return (
    <ScreenScroll bottomNav>
      <AppTopBar showBrand subtitle="Benta, puhunan, bayarin, at tubo." title="Kita" />

      <KitaTabs />

      <View style={styles.rangeRow}>
        {reportRanges.map((entry) => {
          const selected = entry.id === range;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: loading }}
              disabled={loading}
              key={entry.id}
              onPress={() => setRange(entry.id)}
              style={[
                styles.rangeChip,
                {
                  backgroundColor: selected ? palette.primary : loading ? extended.disabledBg : palette.surface,
                  borderColor: selected ? palette.primary : loading ? extended.disabledBg : palette.border,
                },
              ]}
            >
              <GabiText style={{ color: selected ? palette.kioskHeaderText : loading ? extended.disabledText : palette.text }} variant="buttonSm">
                {entry.label}
              </GabiText>
            </Pressable>
          );
        })}
      </View>

      {error ? (
        <GabiCard>
          <GabiNotice message={error} title="Hindi mabuksan ang report" tone="danger" />
          <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh(range)} />
        </GabiCard>
      ) : null}

      {loading ? <ReportSkeleton /> : null}

      {!loading && report && !report.hasBusiness ? (
        <GabiCard>
          <GabiEmptyState
            actionLabel="Buksan ang Settings"
            icon="business-outline"
            message="Gumawa muna ng business profile bago magbasa ng financial report."
            onAction={() => router.push("/owner/settings")}
            title="Wala pang business"
          />
        </GabiCard>
      ) : null}

      {!loading && report?.hasBusiness && !hasActivity ? (
        <GabiCard>
          <GabiEmptyState
            icon="bar-chart-outline"
            message="Lalabas dito ang report kapag may benta o bayarin na sa napiling panahon."
            title="Wala pang report data"
          />
        </GabiCard>
      ) : null}

      {!loading && consolidated && hasActivity ? (
        <>
          {highlightedStall ? (
            <GabiNotice message={`Naka-focus ang report sa ${highlightedStall.branchName}. Kasama pa rin sa taas ang buong negosyo.`} tone="owner" />
          ) : null}

          <GabiHeroCard>
            <View style={styles.heroHeader}>
              <View style={styles.flexCopy}>
                <GabiText tone="inverse" variant="caption">Net profit</GabiText>
                <GabiText money style={styles.heroAmount} tone="inverse" variant="heroPeso">
                  {formatPeso(consolidated.netProfit)}
                </GabiText>
              </View>
              <GabiChip
                icon={consolidated.netProfit >= 0 ? "trending-up" : "trending-down"}
                label={consolidated.netProfit >= 0 ? "Positive" : "Negative"}
                tone={consolidated.netProfit >= 0 ? "success" : "danger"}
              />
            </View>
            <View style={styles.heroFormula}>
              <GabiText style={{ color: palette.kioskHeaderText }} variant="buttonSm">Revenue</GabiText>
              <GabiText style={{ color: extended.textOnPrimaryMuted }} variant="caption">
                − Sold COGS − Fixed Costs − Spoilage
              </GabiText>
              <GabiText style={{ color: palette.kioskHeaderText }} variant="buttonSm">= Net Profit</GabiText>
            </View>
          </GabiHeroCard>

          <View style={styles.metricGrid}>
            <FinancialMetric icon="cash-outline" label="Benta" tone="success" value={consolidated.revenue} />
            <FinancialMetric icon="basket-outline" label="Sold COGS" tone="accent" value={consolidated.soldCogs} />
            <FinancialMetric icon="receipt-outline" label="Fixed Costs" tone="warning" value={consolidated.fixedCosts} />
            <FinancialMetric icon="trash-bin-outline" label="Spoilage" tone="danger" value={consolidated.spoilageLoss} />
          </View>

          {consolidated.estimatedCogsCount > 0 ? (
            <GabiCard>
              <GabiNotice
                message={`${consolidated.estimatedCogsCount} benta ang gumamit ng recent-price estimate dahil kulang ang exact cost data.`}
                title="May estimated COGS"
                tone="warning"
              />
              <GabiSoftButton icon="basket-outline" label="Suriin ang Grocery Stock" onPress={() => router.push("/owner/grocery")} />
            </GabiCard>
          ) : null}

          <GabiCard>
            <GabiSectionHeader title="Buong negosyo" />
            <ReportLine label="Transactions" value={String(consolidated.transactionCount)} />
            <ReportLine label="Gross profit" value={formatPeso(consolidated.grossProfit)} />
            <ReportLine label="Natirang paninda" value={formatPeso(consolidated.unsoldGoodsValue)} />
            <ReportLine label="Grocery value" value={formatPeso(consolidated.groceryRemainingValue)} />
            {consolidated.transferCount > 0 ? (
              <ReportLine label="Lipat" value={`${consolidated.transferCount} · ${formatPeso(consolidated.transferValue)}`} />
            ) : null}
            {consolidated.businessWideFixedCosts > 0 ? (
              <GabiText tone="faint" variant="caption">
                Kasama ang {formatPeso(consolidated.businessWideFixedCosts)} na business-wide fixed costs.
              </GabiText>
            ) : null}
          </GabiCard>

          {report.topProducts.length > 0 ? (
            <GabiCard>
              <GabiSectionHeader title="Top paninda" />
              {report.topProducts.map((product, index) => (
                <View key={product.name} style={[styles.rankedRow, index > 0 ? { borderTopColor: palette.border, borderTopWidth: 1 } : null]}>
                  <View style={[styles.rank, { backgroundColor: palette.softAccent }]}>
                    <GabiText tone="accent" variant="buttonSm">{index + 1}</GabiText>
                  </View>
                  <View style={styles.flexCopy}>
                    <GabiText variant="cardTitle">{product.name}</GabiText>
                    <GabiText tone="muted" variant="caption">{formatQuantity(product.quantity)} sold</GabiText>
                  </View>
                  <GabiText money tone="success" variant="buttonSm">{formatPeso(product.salesAmount)}</GabiText>
                </View>
              ))}
            </GabiCard>
          ) : null}

          <GabiSectionHeader title="Per stall" />
          {report.stalls.map((stall) => {
            const highlighted = stall.branchId === highlightedStallId;
            return (
              <GabiCard key={stall.branchId} style={highlighted ? { borderColor: palette.primary, borderWidth: 2 } : undefined}>
                <View style={styles.cardHeader}>
                  <View style={styles.flexCopy}>
                    <GabiText variant="cardTitle">{stall.branchName}</GabiText>
                    <GabiText tone="muted" variant="caption">{stall.transactionCount} transactions</GabiText>
                  </View>
                  <GabiChip label={formatPeso(stall.netProfit)} tone={stall.netProfit >= 0 ? "success" : "danger"} />
                </View>
                <ReportLine label="Benta" value={formatPeso(stall.revenue)} />
                <ReportLine label="Sold COGS" value={formatPeso(stall.soldCogs)} />
                <ReportLine label="Fixed costs" value={formatPeso(stall.fixedCosts)} />
                <ReportLine label="Spoilage" value={formatPeso(stall.spoilageLoss)} />
                {stall.bestSellerName ? (
                  <GabiText tone="faint" variant="caption">
                    Best paninda: {stall.bestSellerName} · {formatQuantity(stall.bestSellerQuantity)} sold
                  </GabiText>
                ) : null}
                {stall.estimatedCogsCount > 0 ? <GabiChip label={`${stall.estimatedCogsCount} estimated cost`} tone="warning" /> : null}
              </GabiCard>
            );
          })}

          {consolidated.lowStockIngredientCount > 0 || overdueCount > 0 ? (
            <GabiCard>
              <GabiSectionHeader title="Paalala" />
              {consolidated.lowStockIngredientCount > 0 ? (
                <AlertRow
                  icon="alert-circle-outline"
                  label={`${consolidated.lowStockIngredientCount} grocery ingredient ang low stock`}
                  onPress={() => router.push("/owner/grocery")}
                  tone="warning"
                />
              ) : null}
              {overdueCount > 0 ? (
                <AlertRow
                  icon="calendar-outline"
                  label={`${overdueCount} bayarin ang overdue`}
                  onPress={() => router.push("/owner/fixed-costs")}
                  tone="danger"
                />
              ) : null}
            </GabiCard>
          ) : null}

          <GabiPrimaryButton icon="receipt-outline" label="Buksan ang Bayarin" onPress={() => router.push("/owner/fixed-costs")} />
        </>
      ) : null}
    </ScreenScroll>
  );
}

function ReportSkeleton() {
  return (
    <>
      <GabiCard>
        <GabiSkeleton height={16} width="34%" />
        <GabiSkeleton height={46} width="64%" />
        <GabiSkeleton height={48} />
      </GabiCard>
      <View style={styles.metricGrid}>
        {[0, 1, 2, 3].map((item) => (
          <GabiCard key={item} style={styles.metricCard}>
            <GabiSkeleton height={18} width="56%" />
            <GabiSkeleton height={26} width="78%" />
          </GabiCard>
        ))}
      </View>
    </>
  );
}

function FinancialMetric({ icon, label, value, tone }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: number; tone: "success" | "accent" | "warning" | "danger" }) {
  const { palette } = useGabiTheme();
  const foreground = tone === "success" ? palette.success : tone === "accent" ? palette.accent : tone === "warning" ? palette.warning : palette.danger;
  const background = tone === "success" ? palette.softSuccess : tone === "accent" ? palette.softAccent : tone === "warning" ? palette.softWarning : palette.softDanger;
  return (
    <GabiCard style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: background }]}>
        <Ionicons color={foreground} name={icon} size={20} />
      </View>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText money style={{ color: foreground }} variant="metricValue">{formatPeso(value)}</GabiText>
    </GabiCard>
  );
}

function ReportLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.reportLine}>
      <GabiText tone="muted" variant="body">{label}</GabiText>
      <GabiText money variant="buttonSm">{value}</GabiText>
    </View>
  );
}

function AlertRow({ icon, label, onPress, tone }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; tone: "warning" | "danger" }) {
  const { palette } = useGabiTheme();
  const foreground = tone === "warning" ? palette.warning : palette.danger;
  const background = tone === "warning" ? palette.softWarning : palette.softDanger;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.alertRow, { backgroundColor: pressed ? palette.softPrimary : background }]}>
      <Ionicons color={foreground} name={icon} size={22} />
      <GabiText style={[styles.flexCopy, { color: foreground }]} variant="buttonSm">{label}</GabiText>
      <Ionicons color={foreground} name="chevron-forward" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flexCopy: { flex: 1 },
  rangeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rangeChip: { borderRadius: radius.pill, borderWidth: 1, minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  heroHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  heroAmount: { fontSize: 36, lineHeight: 43 },
  heroFormula: { gap: 2 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricCard: { flexBasis: "47%", flexGrow: 1, minWidth: 138 },
  metricIcon: { alignItems: "center", borderRadius: 12, height: 38, justifyContent: "center", width: 38 },
  reportLine: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  rankedRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 58, paddingVertical: spacing.sm },
  rank: { alignItems: "center", borderRadius: radius.pill, height: 32, justifyContent: "center", width: 32 },
  cardHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  alertRow: { alignItems: "center", borderRadius: radius.md, flexDirection: "row", gap: spacing.sm, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
