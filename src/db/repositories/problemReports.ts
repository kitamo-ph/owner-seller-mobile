import { z } from "zod";

import {
  parseProblemReportDiagnostics,
  problemReportCategories,
  sanitizeProblemReportDiagnostics,
  sanitizeProblemReportForm,
  type ProblemReport,
  type ProblemReportCategory,
  type ProblemReportDiagnostics,
  type ProblemReportFormValues,
  type ProblemReportMode,
} from "@/domain/problemReports";
import type { SyncStatus } from "@/domain/types";

import { getRepositoryDatabase, nowIso, type RepositoryDatabase } from "./shared";

const problemReportCategoryValues = new Set<string>(problemReportCategories.map((category) => category.value));

const createProblemReportSchema = z.object({
  id: z.string().min(12).max(120),
  businessId: z.string().nullable(),
  branchId: z.string().nullable(),
  mode: z.enum(["owner", "kiosk"]),
  category: z.string().refine((value) => problemReportCategoryValues.has(value)),
  description: z.string(),
  userAction: z.string(),
  expectedResult: z.string(),
  actualResult: z.string(),
  diagnostics: z.custom<ProblemReportDiagnostics>(),
});

export type CreateProblemReportInput = {
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
};

type ProblemReportRow = {
  id: string;
  business_id: string | null;
  branch_id: string | null;
  mode: ProblemReportMode;
  category: ProblemReportCategory;
  description: string;
  user_action: string;
  expected_result: string;
  actual_result: string;
  diagnostics_json: string;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  deleted_at: string | null;
};

function fallbackDiagnostics(row: ProblemReportRow): ProblemReportDiagnostics {
  return {
    appVersion: "unknown",
    buildNumber: "unknown",
    androidVersion: "unknown",
    deviceModel: "unknown",
    mode: row.mode,
    route: "unknown",
    businessId: row.business_id,
    branchId: row.branch_id,
    network: null,
    breadcrumbs: [],
  };
}

function mapProblemReport(row: ProblemReportRow): ProblemReport {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    mode: row.mode,
    category: row.category,
    description: row.description,
    userAction: row.user_action,
    expectedResult: row.expected_result,
    actualResult: row.actual_result,
    diagnostics: parseProblemReportDiagnostics(row.diagnostics_json) ?? fallbackDiagnostics(row),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: row.sync_status,
    deletedAt: row.deleted_at,
  };
}

export async function createProblemReport(input: CreateProblemReportInput, db?: RepositoryDatabase) {
  const parsed = createProblemReportSchema.parse(input);
  const database = getRepositoryDatabase(db);
  const form = sanitizeProblemReportForm({
    category: parsed.category as ProblemReportCategory,
    description: parsed.description,
    userAction: parsed.userAction,
    expectedResult: parsed.expectedResult,
    actualResult: parsed.actualResult,
  } satisfies ProblemReportFormValues);
  if (!form.category) throw new Error("A problem report category is required.");

  const createdAt = nowIso();
  const diagnostics = sanitizeProblemReportDiagnostics(parsed.diagnostics);
  await database.runAsync(
    `
      INSERT OR IGNORE INTO problem_reports (
        id, business_id, branch_id, mode, category, description, user_action,
        expected_result, actual_result, diagnostics_json, status,
        created_at, updated_at, sync_status, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 'local', NULL)
    `,
    [
      parsed.id,
      parsed.businessId,
      parsed.branchId,
      parsed.mode,
      form.category,
      form.description,
      form.userAction,
      form.expectedResult,
      form.actualResult,
      JSON.stringify(diagnostics),
      createdAt,
      createdAt,
    ],
  );

  const report = await getProblemReportById(parsed.id, database);
  if (!report) throw new Error("The local problem report was not saved.");
  return report;
}

export async function getProblemReportById(id: string, db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<ProblemReportRow>(
    "SELECT * FROM problem_reports WHERE id = ? AND deleted_at IS NULL LIMIT 1",
    [id],
  );
  return row ? mapProblemReport(row) : null;
}

export async function listProblemReports(
  filters: { mode?: ProblemReportMode; businessId?: string | null; branchId?: string | null; limit?: number } = {},
  db?: RepositoryDatabase,
) {
  const conditions = ["deleted_at IS NULL"];
  const params: (string | number)[] = [];
  if (filters.mode) {
    conditions.push("mode = ?");
    params.push(filters.mode);
  }
  if (filters.businessId) {
    conditions.push("business_id = ?");
    params.push(filters.businessId);
  }
  if (filters.branchId) {
    conditions.push("branch_id = ?");
    params.push(filters.branchId);
  }
  params.push(Math.min(Math.max(filters.limit ?? 50, 1), 100));

  const rows = await getRepositoryDatabase(db).getAllAsync<ProblemReportRow>(
    `
      SELECT * FROM problem_reports
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ?
    `,
    params,
  );
  return rows.map(mapProblemReport);
}

export async function countProblemReports(db?: RepositoryDatabase) {
  const row = await getRepositoryDatabase(db).getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM problem_reports WHERE deleted_at IS NULL",
  );
  return row?.count ?? 0;
}
