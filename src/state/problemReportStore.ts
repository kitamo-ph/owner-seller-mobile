import { create } from "zustand";

import { sanitizeProblemReportBreadcrumb, type ProblemReportBreadcrumb } from "@/domain/problemReports";

const MAX_BREADCRUMBS = 12;

type ProblemReportState = {
  breadcrumbs: ProblemReportBreadcrumb[];
  addBreadcrumb: (breadcrumb: Omit<ProblemReportBreadcrumb, "occurredAt"> & { occurredAt?: string }) => void;
  clearBreadcrumbs: () => void;
};

export const useProblemReportStore = create<ProblemReportState>((set) => ({
  breadcrumbs: [],
  addBreadcrumb: (breadcrumb) =>
    set((state) => {
      const sanitized = sanitizeProblemReportBreadcrumb({
        ...breadcrumb,
        occurredAt: breadcrumb.occurredAt ?? new Date().toISOString(),
      });
      const last = state.breadcrumbs[state.breadcrumbs.length - 1];
      if (last?.kind === sanitized.kind && last.name === sanitized.name) {
        return state;
      }
      return { breadcrumbs: [...state.breadcrumbs, sanitized].slice(-MAX_BREADCRUMBS) };
    }),
  clearBreadcrumbs: () => set({ breadcrumbs: [] }),
}));
