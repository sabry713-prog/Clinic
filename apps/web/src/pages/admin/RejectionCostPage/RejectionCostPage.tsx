/**
 * RejectionCostPage — admin-only page hosting the rejection-cost dashboard.
 * Thin wrapper, matching NphiesAnalyticsPage's page-shell pattern.
 */

import RejectionCostDashboard from "../../../components/RejectionCostDashboard/RejectionCostDashboard";

export default function RejectionCostPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-wash text-ink p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold">Rejection Cost Dashboard</h1>
        <RejectionCostDashboard />
      </div>
    </div>
  );
}
