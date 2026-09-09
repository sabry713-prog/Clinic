/**
 * CoderQueuePage — admin-only page hosting the RCM coder review queue.
 * Thin wrapper, matching NphiesAnalyticsPage's page-shell pattern.
 */
import CoderQueue from "../../../components/CoderQueue/CoderQueue";

export default function CoderQueuePage(): JSX.Element {
  return (
    <div className="min-h-screen bg-wash text-ink p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold">Coder Review Queue</h1>
        <CoderQueue />
      </div>
    </div>
  );
}
