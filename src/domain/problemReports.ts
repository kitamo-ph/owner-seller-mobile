export const problemReportCategories = [
  { value: "app_crashed", label: "App crashed or closed" },
  { value: "app_slow", label: "App is slow or frozen" },
  { value: "button_not_working", label: "Button does not work" },
  { value: "incorrect_information", label: "Incorrect total or information" },
  { value: "confusing_screen", label: "Confusing screen" },
  { value: "pin_problem", label: "Login/PIN problem" },
  { value: "other", label: "Other" },
] as const;

export type ProblemReportCategory = (typeof problemReportCategories)[number]["value"];
export type ProblemReportMode = "owner" | "kiosk";
export type ProblemReportStatus = "open" | "resolved";

export type ProblemReportBreadcrumb = {
  kind: "route" | "action";
  name: string;
  occurredAt: string;
};

export type ProblemReportNetworkContext = {
  type: string;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

export type ProblemReportDiagnostics = {
  appVersion: string;
  buildNumber: string;
  androidVersion: string;
  deviceModel: string;
  mode: ProblemReportMode;
  route: string;
  businessId: string | null;
  branchId: string | null;
  network: ProblemReportNetworkContext | null;
  breadcrumbs: ProblemReportBreadcrumb[];
};

export type ProblemReport = {
  id: string;
  businessId: string | null;
  branchId: string | null;
  mode: ProblemReportMode;
  category: ProblemReportCategory;
  description: string;
  userAction: string;
  expectedResult: string;
  actualResult: string;
  diagnostics: ProblemReportDiagnostics;
  status: ProblemReportStatus;
  createdAt: string;
  updatedAt: string;
  syncStatus: "local" | "pending" | "synced" | "failed";
  deletedAt: string | null;
};

export type ProblemReportFormValues = {
  category: ProblemReportCategory | null;
  description: string;
  userAction: string;
  expectedResult: string;
  actualResult: string;
};

export const emptyProblemReportForm: ProblemReportFormValues = {
  category: null,
  description: "",
  userAction: "",
  expectedResult: "",
  actualResult: "",
};

const categoryValues = new Set<string>(problemReportCategories.map((category) => category.value));

function sanitizeToken(value: unknown, fallback = "unknown", maxLength = 120) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[^a-zA-Z0-9._:/-]/g, "_").slice(0, maxLength);
  return cleaned || fallback;
}

export function sanitizeProblemReportText(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\b(pin|password|passcode|otp)\s*[:=#-]?\s*\d{4,8}\b/gi, "$1 [REDACTED]")
    .trim()
    .slice(0, maxLength);
}

export function validateProblemReportForm(values: ProblemReportFormValues) {
  const errors: Partial<Record<keyof ProblemReportFormValues, string>> = {};
  if (!values.category || !categoryValues.has(values.category)) errors.category = "Pumili ng uri ng problema.";
  if (sanitizeProblemReportText(values.description, 180).length < 5) errors.description = "Maglagay ng maikling paglalarawan.";
  if (sanitizeProblemReportText(values.userAction, 500).length < 3) errors.userAction = "Sabihin kung ano ang ginagawa mo.";
  if (sanitizeProblemReportText(values.expectedResult, 500).length < 3) errors.expectedResult = "Sabihin kung ano ang inaasahan mo.";
  if (sanitizeProblemReportText(values.actualResult, 500).length < 3) errors.actualResult = "Sabihin kung ano ang nangyari.";
  return errors;
}

export function sanitizeProblemReportForm(values: ProblemReportFormValues): ProblemReportFormValues {
  return {
    category: values.category && categoryValues.has(values.category) ? values.category : null,
    description: sanitizeProblemReportText(values.description, 180),
    userAction: sanitizeProblemReportText(values.userAction, 500),
    expectedResult: sanitizeProblemReportText(values.expectedResult, 500),
    actualResult: sanitizeProblemReportText(values.actualResult, 500),
  };
}

export function sanitizeProblemReportBreadcrumb(input: ProblemReportBreadcrumb): ProblemReportBreadcrumb {
  return {
    kind: input.kind === "action" ? "action" : "route",
    name: sanitizeToken(input.name),
    occurredAt: Number.isNaN(Date.parse(input.occurredAt)) ? new Date(0).toISOString() : input.occurredAt,
  };
}

export function sanitizeProblemReportDiagnostics(input: ProblemReportDiagnostics): ProblemReportDiagnostics {
  const network = input.network
    ? {
        type: sanitizeToken(input.network.type, "unknown", 40),
        isConnected: typeof input.network.isConnected === "boolean" ? input.network.isConnected : null,
        isInternetReachable: typeof input.network.isInternetReachable === "boolean" ? input.network.isInternetReachable : null,
      }
    : null;

  return {
    appVersion: sanitizeToken(input.appVersion, "unknown", 40),
    buildNumber: sanitizeToken(input.buildNumber, "unknown", 40),
    androidVersion: sanitizeToken(input.androidVersion, "unknown", 60),
    deviceModel: sanitizeProblemReportText(input.deviceModel, 80) || "unknown",
    mode: input.mode === "kiosk" ? "kiosk" : "owner",
    route: sanitizeToken(input.route, "unknown", 120),
    businessId: input.businessId ? sanitizeToken(input.businessId, "unknown", 120) : null,
    branchId: input.branchId ? sanitizeToken(input.branchId, "unknown", 120) : null,
    network,
    breadcrumbs: input.breadcrumbs.slice(-12).map(sanitizeProblemReportBreadcrumb),
  };
}

export function parseProblemReportDiagnostics(value: string): ProblemReportDiagnostics | null {
  try {
    const parsed = JSON.parse(value) as ProblemReportDiagnostics;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.breadcrumbs)) return null;
    return sanitizeProblemReportDiagnostics(parsed);
  } catch {
    return null;
  }
}

export function getProblemReportCategoryLabel(category: ProblemReportCategory) {
  return problemReportCategories.find((option) => option.value === category)?.label ?? "Other";
}

export function buildProblemReportShareText(report: ProblemReport) {
  const diagnostics = sanitizeProblemReportDiagnostics(report.diagnostics);
  const lines = [
    "KitaMo Problem Report",
    `Report ID: ${sanitizeToken(report.id)}`,
    `Saved: ${report.createdAt}`,
    `Category: ${getProblemReportCategoryLabel(report.category)}`,
    "",
    `Short description: ${sanitizeProblemReportText(report.description, 180)}`,
    `What I was doing: ${sanitizeProblemReportText(report.userAction, 500)}`,
    `Expected result: ${sanitizeProblemReportText(report.expectedResult, 500)}`,
    `Actual result: ${sanitizeProblemReportText(report.actualResult, 500)}`,
    "",
    "Sanitized technical context",
    `App: ${diagnostics.appVersion} (${diagnostics.buildNumber})`,
    `Device: Android ${diagnostics.androidVersion}; ${diagnostics.deviceModel}`,
    `Mode/screen: ${diagnostics.mode}; ${diagnostics.route}`,
    `Business/stall IDs: ${diagnostics.businessId ?? "none"}; ${diagnostics.branchId ?? "none"}`,
    `Network: ${diagnostics.network ? `${diagnostics.network.type}; connected=${String(diagnostics.network.isConnected)}; reachable=${String(diagnostics.network.isInternetReachable)}` : "unavailable"}`,
    `Recent navigation: ${diagnostics.breadcrumbs.map((item) => `${item.kind}:${item.name}`).join(" > ") || "none"}`,
    "",
    "Saved locally. No automatic upload or crash monitoring is active.",
  ];
  return lines.join("\n");
}
