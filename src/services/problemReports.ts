import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { Platform, Share } from "react-native";

import { openKitamoDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrations";
import {
  createProblemReport,
  getProblemReportById,
  listProblemReports,
  type RepositoryDatabase,
} from "@/db/repositories";
import {
  buildProblemReportShareText,
  sanitizeProblemReportDiagnostics,
  sanitizeProblemReportForm,
  validateProblemReportForm,
  type ProblemReport,
  type ProblemReportDiagnostics,
  type ProblemReportFormValues,
  type ProblemReportMode,
} from "@/domain/problemReports";
import { useAppStore } from "@/state/appStore";
import { useProblemReportStore } from "@/state/problemReportStore";

type ContextRow = {
  business_id: string | null;
  branch_id: string | null;
};

const reportWrites = new Map<string, Promise<ProblemReport>>();

export function makeProblemReportId() {
  return `problem_${Crypto.randomUUID()}`;
}

export function recordProblemReportAction(name: string) {
  useProblemReportStore.getState().addBreadcrumb({ kind: "action", name });
}

function sourceRouteFromBreadcrumbs() {
  const route = [...useProblemReportStore.getState().breadcrumbs]
    .reverse()
    .find(
      (breadcrumb) =>
        breadcrumb.kind === "route" &&
        !breadcrumb.name.includes("report-problem") &&
        !breadcrumb.name.includes("problem-reports"),
    );
  return route?.name ?? "unknown";
}

async function getSafeNetworkContext() {
  try {
    const state = await Network.getNetworkStateAsync();
    return {
      type: String(state.type),
      isConnected: typeof state.isConnected === "boolean" ? state.isConnected : null,
      isInternetReachable: typeof state.isInternetReachable === "boolean" ? state.isInternetReachable : null,
    };
  } catch {
    return null;
  }
}

export async function collectProblemReportDiagnostics(mode: ProblemReportMode): Promise<ProblemReportDiagnostics> {
  const appContext = useAppStore.getState();
  const network = await getSafeNetworkContext();
  const androidVersion = Platform.OS === "android" ? Platform.constants.Release : String(Platform.Version);
  const deviceModel = Platform.OS === "android" ? Platform.constants.Model : "unknown";

  return sanitizeProblemReportDiagnostics({
    appVersion: Constants.expoConfig?.version ?? "unknown",
    buildNumber: String(Constants.expoConfig?.android?.versionCode ?? "unknown"),
    androidVersion,
    deviceModel,
    mode,
    route: sourceRouteFromBreadcrumbs(),
    businessId: appContext.activeBusinessId,
    branchId: appContext.activeBranchId,
    network,
    breadcrumbs: useProblemReportStore.getState().breadcrumbs,
  });
}

async function resolveValidProblemReportContext(
  businessId: string | null,
  branchId: string | null,
  db: RepositoryDatabase,
) {
  if (!businessId) return { businessId: null, branchId: null };
  const row = await db.getFirstAsync<ContextRow>(
    `
      SELECT b.id AS business_id, br.id AS branch_id
      FROM (SELECT 1) seed
      LEFT JOIN businesses b
        ON b.id = ? AND b.deleted_at IS NULL
      LEFT JOIN branches br
        ON br.id = ? AND br.business_id = b.id AND br.deleted_at IS NULL
      LIMIT 1
    `,
    [businessId, branchId],
  );
  return {
    businessId: row?.business_id ?? null,
    branchId: row?.branch_id ?? null,
  };
}

export async function saveLocalProblemReport({
  reportId,
  mode,
  values,
  db = openKitamoDatabase(),
}: {
  reportId: string;
  mode: ProblemReportMode;
  values: ProblemReportFormValues;
  db?: RepositoryDatabase;
}) {
  const existingWrite = reportWrites.get(reportId);
  if (existingWrite) return existingWrite;

  const operation = (async () => {
    await runMigrations(db);
    const sanitized = sanitizeProblemReportForm(values);
    const errors = validateProblemReportForm(sanitized);
    if (Object.keys(errors).length > 0 || !sanitized.category) {
      throw new Error("Complete the required problem report fields.");
    }

    const diagnostics = await collectProblemReportDiagnostics(mode);
    const validContext = await resolveValidProblemReportContext(
      diagnostics.businessId,
      diagnostics.branchId,
      db,
    );
    const report = await createProblemReport(
      {
        id: reportId,
        businessId: validContext.businessId,
        branchId: validContext.branchId,
        mode,
        category: sanitized.category,
        description: sanitized.description,
        userAction: sanitized.userAction,
        expectedResult: sanitized.expectedResult,
        actualResult: sanitized.actualResult,
        diagnostics,
      },
      db,
    );
    recordProblemReportAction("problem_report_saved");
    return report;
  })().finally(() => {
    reportWrites.delete(reportId);
  });

  reportWrites.set(reportId, operation);
  return operation;
}

export async function loadLocalProblemReports(mode: ProblemReportMode, db = openKitamoDatabase()) {
  await runMigrations(db);
  if (mode === "owner") {
    return listProblemReports({ limit: 100 }, db);
  }
  const branchId = useAppStore.getState().kioskSessionBranchId;
  if (!branchId) return [];
  return listProblemReports({ mode: "kiosk", branchId, limit: 50 }, db);
}

export async function loadLocalProblemReport(reportId: string, mode: ProblemReportMode, db = openKitamoDatabase()) {
  await runMigrations(db);
  const report = await getProblemReportById(reportId, db);
  if (!report) return null;
  if (mode === "owner") return report;
  const branchId = useAppStore.getState().kioskSessionBranchId;
  return report.mode === "kiosk" && report.branchId === branchId ? report : null;
}

export async function copyProblemReport(report: ProblemReport) {
  await Clipboard.setStringAsync(buildProblemReportShareText(report));
}

export async function shareProblemReport(report: ProblemReport) {
  await Share.share({ message: buildProblemReportShareText(report) });
}
