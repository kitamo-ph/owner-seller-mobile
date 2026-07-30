import Ionicons from "@expo/vector-icons/Ionicons";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiIconButton, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import { getProblemReportCategoryLabel, type ProblemReport, type ProblemReportMode } from "@/domain/problemReports";
import { loadLocalProblemReports, recordProblemReportAction } from "@/services/problemReports";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

export function ProblemReportsListScreen({ mode }: { mode: ProblemReportMode }) {
  const [reports, setReports] = useState<ProblemReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const formHref = (mode === "owner" ? "/owner/report-problem" : "/kiosk/report-problem") as Href;
  const backHref = (mode === "owner" ? "/owner/settings" : "/kiosk/help") as Href;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await loadLocalProblemReports(mode));
      setError(null);
    } catch (loadError) {
      logDevError("ProblemReportsList.refresh", loadError);
      setError(getFriendlyErrorMessage("Could not load local problem reports."));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      recordProblemReportAction(`open_${mode}_problem_reports`);
      void refresh();
    }, [mode, refresh]),
  );

  function openReport(report: ProblemReport) {
    router.push(`${String(formHref)}?reportId=${encodeURIComponent(report.id)}` as Href);
  }

  return (
    <ScreenScroll bottomNav={mode === "owner"} kioskNav={mode === "kiosk"}>
      <AppTopBar
        backHref={backHref}
        eyebrow="SAVED LOCALLY"
        right={<GabiIconButton accessibilityLabel="Gumawa ng problem report" icon="add" onPress={() => router.push(formHref)} />}
        subtitle="Nasa phone lang; walang automatic upload"
        title="My Problem Reports"
      />

      {error ? <GabiNotice message={error} title="Hindi ma-load" tone="danger" /> : null}
      <GabiNotice
        message={mode === "kiosk" ? "Mga Kiosk report lang para sa kasalukuyang stall ang makikita rito." : "Makikita rito ang Owner at Kiosk reports na naka-save sa phone."}
        title="Local report history"
        tone="owner"
      />

      {loading ? (
        <GabiCard>
          <GabiSkeleton height={72} showImmediately />
          <GabiSkeleton height={72} showImmediately />
          <GabiSkeleton height={72} showImmediately />
        </GabiCard>
      ) : null}

      {!loading && reports.length === 0 ? (
        <GabiEmptyState
          actionLabel="Report a problem"
          icon="chatbox-ellipses-outline"
          message="Kapag nag-save ka ng report, lalabas ito rito at puwedeng buksan, kopyahin, o i-share."
          onAction={() => router.push(formHref)}
          title="Wala pang problem report"
        />
      ) : null}

      {!loading && reports.length > 0 ? (
        <GabiCard>
          <GabiSectionHeader action={<GabiChip label={`${reports.length} saved`} tone="success" />} title="Reports on this phone" />
          <View style={styles.list}>
            {reports.map((report) => <ProblemReportRow key={report.id} onPress={() => openReport(report)} report={report} />)}
          </View>
        </GabiCard>
      ) : null}
    </ScreenScroll>
  );
}

function ProblemReportRow({ report, onPress }: { report: ProblemReport; onPress: () => void }) {
  const { palette, extended } = useGabiTheme();
  const savedAt = new Date(report.createdAt);
  return (
    <Pressable
      accessibilityHint="Opens the saved local report"
      accessibilityLabel={`${getProblemReportCategoryLabel(report.category)}, ${report.description}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? palette.softPrimary : palette.surface,
          borderColor: extended.hairline,
        },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: report.mode === "kiosk" ? palette.softAccent : palette.softPrimary }]}>
        <Ionicons color={report.mode === "kiosk" ? palette.accent : palette.primary} name={report.mode === "kiosk" ? "storefront-outline" : "person-outline"} size={20} />
      </View>
      <View style={styles.rowCopy}>
        <View style={styles.rowTitleLine}>
          <GabiText numberOfLines={2} style={styles.rowTitle} variant="buttonSm">{getProblemReportCategoryLabel(report.category)}</GabiText>
          <GabiChip label={report.mode === "kiosk" ? "Kiosk" : "Owner"} tone={report.mode === "kiosk" ? "accent" : "primary"} />
        </View>
        <GabiText numberOfLines={2} tone="muted" variant="caption">{report.description}</GabiText>
        <GabiText numberOfLines={1} tone="faint" variant="caption">
          {savedAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })} · {report.id}
        </GabiText>
      </View>
      <Ionicons color={extended.textFaint} name="chevron-forward" size={19} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 82,
    padding: spacing.sm,
  },
  rowIcon: {
    alignItems: "center",
    borderRadius: 13,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  rowCopy: {
    flex: 1,
    gap: 3,
  },
  rowTitleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
  },
  rowTitle: {
    flex: 1,
  },
});
