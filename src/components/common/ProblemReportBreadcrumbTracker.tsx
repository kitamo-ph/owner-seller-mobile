import { usePathname } from "expo-router";
import { useEffect } from "react";

import { useProblemReportStore } from "@/state/problemReportStore";

export function ProblemReportBreadcrumbTracker() {
  const pathname = usePathname();
  const addBreadcrumb = useProblemReportStore((state) => state.addBreadcrumb);

  useEffect(() => {
    addBreadcrumb({ kind: "route", name: pathname });
  }, [addBreadcrumb, pathname]);

  return null;
}
