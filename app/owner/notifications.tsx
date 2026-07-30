import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import { listRecentOwnerAlerts, resolveOwnerAlert } from "@/db/repositories";
import type { OwnerAlert, OwnerAlertSeverity } from "@/domain/types";
import { loadOwnerSetupStatus, type OwnerSetupStatus } from "@/services/ownerSetup";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

type AlertView = "active" | "resolved";
type AlertScope = "all" | "business" | "activeStall";

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

export default function OwnerNotificationsScreen() {
  const [alerts, setAlerts] = useState<OwnerAlert[]>([]);
  const [status, setStatus] = useState<OwnerSetupStatus | null>(null);
  const [branchNames, setBranchNames] = useState<Record<string, string>>({});
  const [view, setView] = useState<AlertView>("active");
  const [scope, setScope] = useState<AlertScope>("all");
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolveLock = useRef(false);
  const { palette, extended } = useGabiTheme();
  const router = useRouter();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await loadOwnerSetupStatus();
      const nextAlerts = nextStatus.activeBusiness ? await listRecentOwnerAlerts(nextStatus.activeBusiness.id, 100) : [];
      setStatus(nextStatus);
      setAlerts(nextAlerts);
      setBranchNames(Object.fromEntries(nextStatus.branches.map((branch) => [branch.id, branch.branchName])));
      setScope((current) => (current === "activeStall" && !nextStatus.activeBranch ? "all" : current));
      setError(null);
    } catch (loadError) {
      logDevError("OwnerNotifications.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load local alerts."));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const activeCount = useMemo(() => alerts.filter((alert) => alert.status === "active").length, [alerts]);
  const resolvedCount = alerts.length - activeCount;
  const visibleAlerts = useMemo(
    () =>
      alerts.filter((alert) => {
        if (alert.status !== view) return false;
        if (scope === "business") return alert.branchId === null;
        if (scope === "activeStall") return Boolean(status?.activeBranch && alert.branchId === status.activeBranch.id);
        return true;
      }),
    [alerts, scope, status?.activeBranch, view],
  );

  async function resolve(alertId: string) {
    if (resolveLock.current) return;

    resolveLock.current = true;
    setResolvingId(alertId);
    try {
      await resolveOwnerAlert(alertId);
      await refresh();
    } catch (resolveError) {
      logDevError("OwnerNotifications.resolve", resolveError);
      setError(getFriendlyErrorMessage("Could not resolve the alert."));
    } finally {
      resolveLock.current = false;
      setResolvingId(null);
    }
  }

  return (
    <ScreenScroll bottomNav>
      <AppTopBar
        backHref="/owner"
        eyebrow="LOCAL ALERTS"
        right={<GabiIconButton accessibilityLabel="Settings" icon="settings-outline" onPress={() => router.push("/owner/settings")} />}
        subtitle="Mga abisong naka-save sa phone na ito"
        title="Notifications"
      />

      <GabiNotice
        message="Dito lang sa shared device lumalabas ang Kiosk alerts. Wala pang push notification, remote ping, o cloud delivery."
        title="Local notifications only"
        tone="owner"
      />

      {error ? <GabiNotice message={error} title="Hindi ma-load ang alerts" tone="danger" /> : null}

      <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: extended.neutralChipBg }]}>
        <AlertTab count={activeCount} label="Aktibo" onPress={() => setView("active")} selected={view === "active"} />
        <AlertTab count={resolvedCount} label="Resolved" onPress={() => setView("resolved")} selected={view === "resolved"} />
      </View>

      <View style={styles.scopeRow}>
        <ScopeChip label="Lahat" onPress={() => setScope("all")} selected={scope === "all"} />
        <ScopeChip label="Business-wide" onPress={() => setScope("business")} selected={scope === "business"} />
        <ScopeChip
          disabled={!status?.activeBranch}
          label={status?.activeBranch?.branchName ?? "Walang active stall"}
          onPress={() => setScope("activeStall")}
          selected={scope === "activeStall"}
        />
      </View>

      {loading ? (
        <GabiCard>
          <GabiSkeleton height={18} showImmediately width="42%" />
          <GabiSkeleton height={112} showImmediately />
          <GabiSkeleton height={112} showImmediately />
        </GabiCard>
      ) : null}

      {!loading && visibleAlerts.length === 0 ? (
        <GabiEmptyState
          icon={view === "active" ? "notifications-off-outline" : "checkmark-done-outline"}
          message={view === "active" ? "Lalabas dito ang bagong same-device Kiosk alerts." : "Mananatili rito ang resolved alerts para sa local review."}
          title={view === "active" ? "Walang active alert" : "Wala pang resolved alert"}
        />
      ) : null}

      {!loading && visibleAlerts.length > 0 ? (
        <View style={styles.alertSection}>
          <GabiSectionHeader
            action={<GabiChip label={`${visibleAlerts.length}`} tone={view === "active" ? "warning" : "success"} />}
            title={view === "active" ? "Kailangang tingnan" : "Alert history"}
          />
          {visibleAlerts.map((alert) => (
            <GabiCard key={alert.id} raised={alert.severity === "critical"}>
              <View style={styles.alertHeader}>
                <View style={[styles.alertIcon, { backgroundColor: alert.severity === "critical" ? palette.softDanger : alert.severity === "warning" ? palette.softWarning : palette.softPrimary }]}>
                  <Ionicons
                    color={alert.severity === "critical" ? palette.danger : alert.severity === "warning" ? palette.warning : palette.primary}
                    name={alert.severity === "critical" ? "alert-circle" : alert.severity === "warning" ? "warning" : "information-circle"}
                    size={21}
                  />
                </View>
                <View style={styles.alertTitleCopy}>
                  <GabiText variant="cardTitle">{alert.title}</GabiText>
                  <GabiText numberOfLines={2} tone="muted" variant="caption">
                    {alert.branchId ? branchNames[alert.branchId] ?? "Saved stall" : "Business-wide"} · {formatSource(alert.source)}
                  </GabiText>
                </View>
                <GabiChip label={severityLabels[alert.severity]} tone={severityTones[alert.severity]} />
              </View>
              <GabiText tone="muted" variant="body">{alert.message}</GabiText>
              <View style={styles.alertFooter}>
                <GabiText tone="faint" variant="caption">{formatAlertTime(alert.createdAt)}</GabiText>
                {alert.status === "active" ? (
                  <GabiSoftButton
                    compact
                    disabled={resolvingId !== null}
                    icon="checkmark-circle-outline"
                    label={resolvingId === alert.id ? "Inaayos..." : "Ayos na"}
                    loading={resolvingId === alert.id}
                    onPress={() => resolve(alert.id)}
                  />
                ) : (
                  <GabiChip label="Resolved" tone="success" />
                )}
              </View>
            </GabiCard>
          ))}
        </View>
      ) : null}
    </ScreenScroll>
  );
}

function AlertTab({ label, count, selected, onPress }: { label: string; count: number; selected: boolean; onPress: () => void }) {
  const { palette } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.segment, selected ? { backgroundColor: palette.surface } : undefined]}
    >
      <GabiText tone={selected ? "primary" : "muted"} variant="buttonSm">{label}</GabiText>
      <View style={[styles.tabCount, { backgroundColor: selected ? palette.softPrimary : palette.background }]}>
        <GabiText tone={selected ? "primary" : "muted"} variant="caption">{count}</GabiText>
      </View>
    </Pressable>
  );
}

function ScopeChip({ label, selected, disabled = false, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  const { palette, extended } = useGabiTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.scopeChip,
        {
          backgroundColor: disabled ? extended.disabledBg : selected ? palette.softPrimary : palette.surface,
          borderColor: disabled ? extended.disabledBg : selected ? palette.primary : palette.border,
        },
      ]}
    >
      <GabiText
        maxFontSizeMultiplier={1.25}
        numberOfLines={1}
        style={disabled ? { color: extended.disabledText } : undefined}
        tone={selected ? "primary" : "muted"}
        variant="buttonSm"
      >
        {label}
      </GabiText>
    </Pressable>
  );
}

function formatAlertTime(value: string) {
  return new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}

function formatSource(source: string) {
  return source === "kiosk_stock" ? "Kiosk Stock" : source.replaceAll("_", " ");
}

const styles = StyleSheet.create({
  segmented: {
    borderRadius: 14,
    flexDirection: "row",
    gap: spacing.xs,
    padding: 3,
  },
  segment: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 44,
  },
  tabCount: {
    alignItems: "center",
    borderRadius: 10,
    minWidth: 22,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  scopeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  scopeChip: {
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  alertSection: {
    gap: spacing.md,
  },
  alertHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  alertIcon: {
    alignItems: "center",
    borderRadius: 12,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  alertTitleCopy: {
    flex: 1,
    gap: 2,
  },
  alertFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
});
