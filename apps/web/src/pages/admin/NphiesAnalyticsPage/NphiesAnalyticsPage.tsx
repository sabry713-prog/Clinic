/**
 * NphiesAnalyticsPage — admin-only page hosting the rejection analytics
 * dashboard. Thin wrapper, matching AuditPage's page-shell pattern.
 */

import NphiesRejectionAnalytics from "../../../components/NphiesRejectionAnalytics/NphiesRejectionAnalytics";

export default function NphiesAnalyticsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold">NPHIES Analytics</h1>
        <NphiesRejectionAnalytics />
      </div>
    </div>
  );
}
