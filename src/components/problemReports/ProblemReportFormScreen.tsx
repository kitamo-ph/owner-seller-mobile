import Ionicons from "@expo/vector-icons/Ionicons";
import { type Href, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { GabiPrimaryButton, GabiSoftButton } from "@/components/gabi/GabiButton";
import { GabiField, GabiRadioRow } from "@/components/gabi/GabiControls";
import { GabiEmptyState, GabiNotice, GabiSkeleton } from "@/components/gabi/GabiFeedback";
import { GabiCard, GabiChip, GabiSectionHeader } from "@/components/gabi/GabiSurface";
import { GabiText } from "@/components/gabi/GabiText";
import { AppTopBar, ScreenScroll } from "@/components/ui/KitaMoUI";
import {
  emptyProblemReportForm,
  getProblemReportCategoryLabel,
  problemReportCategories,
  validateProblemReportForm,
  type ProblemReport,
  type ProblemReportFormValues,
  type ProblemReportMode,
} from "@/domain/problemReports";
import {
  copyProblemReport,
  loadLocalProblemReport,
  makeProblemReportId,
  recordProblemReportAction,
  saveLocalProblemReport,
  shareProblemReport,
} from "@/services/problemReports";
import { spacing } from "@/theme/spacing";
import { useGabiTheme } from "@/theme/useGabiTheme";
import { getFriendlyErrorMessage, logDevError } from "@/utils/errors";

type FieldErrors = Partial<Record<keyof ProblemReportFormValues, string>>;

export function ProblemReportFormScreen({ mode, reportId }: { mode: ProblemReportMode; reportId?: string }) {
  const [values, setValues] = useState<ProblemReportFormValues>(emptyProblemReportForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [savedReport, setSavedReport] = useState<ProblemReport | null>(null);
  const [loading, setLoading] = useState(Boolean(reportId));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; message: string } | null>(null);
  const [draftReportId] = useState(() => reportId ?? makeProblemReportId());
  const saveLock = useRef(false);
  const router = useRouter();
  const { palette, extended } = useGabiTheme();
  const backHref = (mode === "owner" ? "/owner/settings" : "/kiosk/help") as Href;
  const listHref = (mode === "owner" ? "/owner/problem-reports" : "/kiosk/problem-reports") as Href;

  useEffect(() => {
    if (!reportId) {
      recordProblemReportAction(`open_${mode}_problem_report`);
      return;
    }

    let active = true;
    setLoading(true);
    loadLocalProblemReport(reportId, mode)
      .then((report) => {
        if (active) setSavedReport(report);
      })
      .catch((error) => {
        logDevError("ProblemReportForm.load", error);
        if (active) setNotice({ tone: "danger", message: getFriendlyErrorMessage("Could not open this local report.") });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, reportId]);

  function updateField<K extends keyof ProblemReportFormValues>(key: K, value: ProblemReportFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setNotice(null);
  }

  async function saveReport() {
    if (saveLock.current || saving) return;
    const nextErrors = validateProblemReportForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setNotice({ tone: "danger", message: "Pakikumpleto ang mga kailangang detalye sa ibaba." });
      return;
    }

    saveLock.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const report = await saveLocalProblemReport({
        reportId: draftReportId,
        mode,
        values,
      });
      setSavedReport(report);
      setNotice({ tone: "success", message: "Naka-save sa phone ang problem report." });
    } catch (error) {
      logDevError("ProblemReportForm.save", error);
      setNotice({ tone: "danger", message: getFriendlyErrorMessage("Could not save the problem report.") });
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function copyReport() {
    if (!savedReport) return;
    try {
      await copyProblemReport(savedReport);
      setNotice({ tone: "success", message: "Nakopya ang sanitized report." });
    } catch (error) {
      logDevError("ProblemReportForm.copy", error);
      setNotice({ tone: "danger", message: "Hindi makopya ang report sa phone na ito." });
    }
  }

  async function shareReport() {
    if (!savedReport) return;
    try {
      await shareProblemReport(savedReport);
    } catch (error) {
      logDevError("ProblemReportForm.share", error);
      setNotice({ tone: "danger", message: "Hindi mabuksan ang Android share menu." });
    }
  }

  if (loading) {
    return (
      <ScreenScroll bottomNav={mode === "owner"} kioskNav={mode === "kiosk"}>
        <AppTopBar backHref={backHref} eyebrow="LOCAL SUPPORT" subtitle="Saved only on this phone" title="Report Problem" />
        <GabiCard>
          <GabiSkeleton height={22} showImmediately width="45%" />
          <GabiSkeleton height={72} showImmediately />
          <GabiSkeleton height={110} showImmediately />
        </GabiCard>
      </ScreenScroll>
    );
  }

  if (reportId && !savedReport) {
    return (
      <ScreenScroll bottomNav={mode === "owner"} kioskNav={mode === "kiosk"}>
        <AppTopBar backHref={listHref} eyebrow="LOCAL SUPPORT" subtitle="Saved only on this phone" title="Problem Report" />
        {notice ? <GabiNotice message={notice.message} title="Hindi mabuksan" tone="danger" /> : null}
        <GabiEmptyState
          actionLabel="Bumalik sa reports"
          icon="document-text-outline"
          message="Hindi available ang report para sa kasalukuyang local context."
          onAction={() => router.replace(listHref)}
          title="Report not found"
        />
      </ScreenScroll>
    );
  }

  if (savedReport) {
    return (
      <ScreenScroll bottomNav={mode === "owner"} kioskNav={mode === "kiosk"}>
        <AppTopBar backHref={reportId ? listHref : backHref} eyebrow="SAVED LOCALLY" subtitle="Walang automatic upload" title="Problem Report" />
        {notice ? <GabiNotice message={notice.message} title={notice.tone === "success" ? "Okay na" : "May problema"} tone={notice.tone} /> : null}

        <GabiCard raised>
          <View style={styles.successHeader}>
            <View style={[styles.successIcon, { backgroundColor: palette.softSuccess }]}>
              <Ionicons color={palette.success} name="checkmark-circle" size={25} />
            </View>
            <View style={styles.successCopy}>
              <GabiText variant="h2">Naka-save ang report</GabiText>
              <GabiText selectable tone="primary" variant="buttonSm">{savedReport.id}</GabiText>
            </View>
            <GabiChip label="Local" tone="success" />
          </View>
          <GabiNotice
            message="Ikaw ang magko-copy o magsha-share nito. Hindi ito kusang ipinapadala at wala pang automatic crash reporting."
            title="Manual report"
            tone="owner"
          />
        </GabiCard>

        <SavedReportDetails report={savedReport} />

        <View style={styles.actionWrap}>
          <GabiPrimaryButton icon="share-outline" label="Share Report" onPress={shareReport} />
          <GabiSoftButton icon="copy-outline" label="Copy Report" onPress={copyReport} />
          <GabiSoftButton icon="documents-outline" label="My Problem Reports" onPress={() => router.push(listHref)} />
        </View>
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll bottomNav={mode === "owner"} kioskNav={mode === "kiosk"}>
      <AppTopBar backHref={backHref} eyebrow="LOCAL SUPPORT" subtitle="Mabilis na report para sa Internal Testing" title="Report Problem" />

      {notice ? <GabiNotice message={notice.message} title={notice.tone === "success" ? "Okay na" : "Pakicheck"} tone={notice.tone} /> : null}
      <GabiNotice
        message="Huwag ilagay ang Owner PIN, password, customer name, receipt details, o buong sales/inventory records."
        title="I-share lang ang kailangan"
        tone="warning"
      />

      <GabiCard>
        <GabiSectionHeader action={<GabiChip label="Required" tone="warning" />} title="Anong problema?" />
        <View accessibilityRole="radiogroup" style={styles.categoryList}>
          {problemReportCategories.map((category) => (
            <GabiRadioRow
              description={category.value === "app_crashed" ? "Manual report ito; wala pang automatic crash monitoring." : undefined}
              key={category.value}
              onPress={() => updateField("category", category.value)}
              selected={values.category === category.value}
              title={category.label}
            />
          ))}
        </View>
        {errors.category ? <GabiText tone="danger" variant="caption">{errors.category}</GabiText> : null}
      </GabiCard>

      <GabiCard>
        <GabiSectionHeader title="Maikling detalye" />
        <GabiField
          errorMessage={errors.description}
          label="Short description"
          maxLength={180}
          onChangeText={(value) => updateField("description", value)}
          placeholder="Hal. Hindi gumagana ang Save button"
          returnKeyType="next"
          value={values.description}
        />
        <GabiField
          errorMessage={errors.userAction}
          label="What were you doing?"
          maxLength={500}
          multiline
          onChangeText={(value) => updateField("userAction", value)}
          placeholder="Hal. Nasa Checkout ako at pinindot ang Save"
          style={styles.longField}
          textAlignVertical="top"
          value={values.userAction}
        />
        <GabiField
          errorMessage={errors.expectedResult}
          label="Expected result"
          maxLength={500}
          multiline
          onChangeText={(value) => updateField("expectedResult", value)}
          placeholder="Ano sana ang dapat nangyari?"
          style={styles.longField}
          textAlignVertical="top"
          value={values.expectedResult}
        />
        <GabiField
          errorMessage={errors.actualResult}
          label="Actual result"
          maxLength={500}
          multiline
          onChangeText={(value) => updateField("actualResult", value)}
          placeholder="Ano talaga ang nangyari?"
          style={styles.longField}
          textAlignVertical="top"
          value={values.actualResult}
        />
      </GabiCard>

      <GabiCard style={{ backgroundColor: extended.neutralChipBg }}>
        <GabiText variant="buttonSm">Safe app info lang ang isasama</GabiText>
        <GabiText tone="muted" variant="caption">
          Report ID, oras, app/build, Android at phone model, Owner/Kiosk mode, screen, business/stall IDs, local network state, at recent navigation.
        </GabiText>
      </GabiCard>

      <GabiPrimaryButton
        accessibilityHint="Saves one sanitized report in local SQLite"
        disabled={saving}
        icon="save-outline"
        label={saving ? "Sine-save..." : "Save Problem Report"}
        loading={saving}
        onPress={saveReport}
      />
      <GabiSoftButton icon="documents-outline" label="My Problem Reports" onPress={() => router.push(listHref)} />
    </ScreenScroll>
  );
}

function SavedReportDetails({ report }: { report: ProblemReport }) {
  const networkLabel = report.diagnostics.network
    ? `${report.diagnostics.network.type} · ${report.diagnostics.network.isConnected === false ? "offline" : "connected/unknown"}`
    : "Unavailable";
  return (
    <>
      <GabiCard>
        <View style={styles.detailHeader}>
          <GabiText variant="h2">{getProblemReportCategoryLabel(report.category)}</GabiText>
          <GabiChip label={report.mode === "owner" ? "Owner" : "Kiosk"} tone={report.mode === "owner" ? "primary" : "accent"} />
        </View>
        <Detail label="Short description" value={report.description} />
        <Detail label="What I was doing" value={report.userAction} />
        <Detail label="Expected result" value={report.expectedResult} />
        <Detail label="Actual result" value={report.actualResult} />
      </GabiCard>
      <GabiCard>
        <GabiSectionHeader title="Kasamang app info" />
        <Detail label="App" value={`${report.diagnostics.appVersion} (${report.diagnostics.buildNumber})`} />
        <Detail label="Phone" value={`Android ${report.diagnostics.androidVersion} · ${report.diagnostics.deviceModel}`} />
        <Detail label="Screen" value={report.diagnostics.route} />
        <Detail label="Network" value={networkLabel} />
        <GabiText tone="faint" variant="caption">No PIN, receipt text, customer details, or database contents are attached.</GabiText>
      </GabiCard>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { extended } = useGabiTheme();
  return (
    <View style={[styles.detail, { borderColor: extended.hairline }]}>
      <GabiText tone="faint" variant="caption">{label}</GabiText>
      <GabiText selectable variant="body">{value}</GabiText>
    </View>
  );
}

const styles = StyleSheet.create({
  categoryList: {
    gap: spacing.sm,
  },
  longField: {
    minHeight: 96,
  },
  actionWrap: {
    gap: spacing.sm,
  },
  successHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  successIcon: {
    alignItems: "center",
    borderRadius: 14,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  successCopy: {
    flex: 1,
    gap: 2,
  },
  detailHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  detail: {
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
});
