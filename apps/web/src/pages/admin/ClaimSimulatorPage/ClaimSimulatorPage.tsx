/**
 * ClaimSimulatorPage — admin-only page hosting the claim-integrity batch
 * simulator. Thin wrapper, matching NphiesAnalyticsPage's page-shell pattern.
 */
import ClaimSimulator from "../../../components/ClaimSimulator/ClaimSimulator";

export default function ClaimSimulatorPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold">Claim Simulator</h1>
        <ClaimSimulator />
      </div>
    </div>
  );
}
