import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiHeroCard, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, formatPeso, ScreenScroll } from "@/components/ui/KitaMoUI";
import { getKioskShiftSummary, loadKioskContext, type KioskContext, type KioskShiftSummary } from "@/services/kioskSales";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export default function KioskShiftScreen() {
  const { palette, extended } = useGabiTheme();
  const [summary, setSummary] = useState<KioskShiftSummary | null>(null);
  const [context, setContext] = useState<KioskContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextContext = await loadKioskContext();
      const nextSummary = await getKioskShiftSummary();
      setContext(nextContext);
      setSummary(nextSummary);
      setMessage(null);
    } catch (error) {
      logDevError("KioskShift.refresh", error);
      setMessage(getFriendlyErrorMessage("Could not load shift summary."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return (
    <ScreenScroll kioskNav>
      <AppTopBar eyebrow="KIOSK" subtitle="Lokal na buod para sa stall na ito." title="Shift" />

      {message ? (
        <GabiCard>
          <GabiNotice message={message} title="Hindi mabuksan ang summary" tone="danger" />
          <GabiSoftButton icon="refresh" label="Subukan ulit" onPress={() => void refresh()} />
        </GabiCard>
      ) : null}

      {context?.setupMessage ? <GabiNotice message={context.setupMessage} title="Kailangan ng stall context" tone="warning" /> : null}

      {loading ? (
        <GabiCard>
          <GabiSkeleton height={18} width="38%" />
          <GabiSkeleton height={46} width="64%" />
          <GabiSkeleton height={70} />
        </GabiCard>
      ) : null}

      {!loading && summary ? (
        <>
          <GabiHeroCard>
            <GabiText style={{ color: extended.textOnPrimaryMuted }} variant="caption">Kabuuang benta</GabiText>
            <GabiText money tone="inverse" variant="heroPeso">{formatPeso(summary.grossSales)}</GabiText>
            <View style={styles.heroMeta}>
              <GabiChip icon="receipt-outline" label={`${summary.salesCount} sales`} tone="success" />
              <GabiChip icon="sync-outline" label={`${summary.pendingQueueCount} pending`} tone={summary.pendingQueueCount > 0 ? "warning" : "neutral"} />
            </View>
          </GabiHeroCard>

          <View style={styles.metricGrid}>
            <PaymentMetric background={palette.softSuccess} color={palette.success} icon="cash-outline" label="Cash" value={summary.cashTotal} />
            <PaymentMetric background={palette.softAccent} color={palette.accent} icon="phone-portrait-outline" label="E-wallet" value={summary.gcashTotal + summary.mayaTotal} />
          </View>

          <GabiCard>
            <GabiSectionHeader title="Payment breakdown" />
            <SummaryRow label="Cash" value={formatPeso(summary.cashTotal)} />
            <SummaryRow label="GCash" value={formatPeso(summary.gcashTotal)} />
            <SummaryRow label="Maya" value={formatPeso(summary.mayaTotal)} />
            <SummaryRow label="Bank transfer" value={formatPeso(summary.bankTransferTotal)} />
            <SummaryRow label="Other" value={formatPeso(summary.otherTotal)} />
          </GabiCard>

          <GabiNotice
            message="Ito ang lahat ng local sales para sa confirmed stall sa phone na ito. Wala pang scheduled seller shifts o cloud attendance."
            title="Pilot scope"
            tone="shared"
          />
        </>
      ) : null}
    </ScreenScroll>
  );
}

function PaymentMetric({ label, value, icon, color, background }: { label: string; value: number; icon: React.ComponentProps<typeof Ionicons>["name"]; color: string; background: string }) {
  return (
    <GabiCard style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: background }]}><Ionicons color={color} name={icon} size={21} /></View>
      <GabiText tone="muted" variant="caption">{label}</GabiText>
      <GabiText money style={{ color }} variant="metricValue">{formatPeso(value)}</GabiText>
    </GabiCard>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <GabiText tone="muted" variant="body">{label}</GabiText>
      <GabiText money variant="buttonSm">{value}</GabiText>
    </View>
  );
}

const styles = StyleSheet.create({
  heroMeta: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricGrid: { flexDirection: "row", gap: spacing.sm },
  metricCard: { flex: 1, minWidth: 0 },
  metricIcon: { alignItems: "center", borderRadius: 13, height: 40, justifyContent: "center", width: 40 },
  summaryRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
});
