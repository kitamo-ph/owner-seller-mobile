import { useLocalSearchParams } from "expo-router";

import { ProblemReportFormScreen } from "@/components/problemReports/ProblemReportFormScreen";

export default function OwnerReportProblemScreen() {
  const params = useLocalSearchParams<{ reportId?: string }>();
  const reportId = Array.isArray(params.reportId) ? params.reportId[0] : params.reportId;
  return <ProblemReportFormScreen mode="owner" reportId={reportId} />;
}
