/**
 * PatientHeader — displays patient identity, allergies, and conditions.
 *
 * Constraints:
 * - No severity color-coding
 * - No clinical interpretation language
 * - All information is plain factual text from the record
 */

interface AllergyItem {
  readonly id: string;
  readonly code_display: string | null;
  readonly reaction: string | null;
  readonly recorded_at: string | null;
}

interface ConditionItem {
  readonly id: string;
  readonly code_display: string | null;
  readonly status: string | null;
  readonly onset_date: string | null;
}

interface PatientHeaderProps {
  readonly id: string;
  readonly mrn: string | null;
  readonly display_name: string | null;
  readonly date_of_birth: string | null;
  readonly sex: string | null;
  readonly preferred_language: string | null;
  readonly ward: string | null;
  readonly allergies: readonly AllergyItem[];
  readonly conditions: readonly ConditionItem[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ageFromDob(dob: string | null): string {
  if (!dob) return "—";
  const birth = new Date(dob);
  const now = new Date();
  const age = now.getFullYear() - birth.getFullYear();
  return `${age}y`;
}

export default function PatientHeader({
  mrn,
  display_name,
  date_of_birth,
  sex,
  preferred_language,
  ward,
  allergies,
  conditions,
}: PatientHeaderProps): JSX.Element {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      {/* Identity row */}
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <p className="text-sm text-slate-400">Patient Name</p>
          <p className="text-lg font-semibold text-white">
            {display_name ?? "Unknown"}
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-400">MRN</p>
          <p className="text-base text-white font-mono">{mrn ?? "—"}</p>
        </div>
        <div>
          <p className="text-sm text-slate-400">Date of Birth</p>
          <p className="text-base text-white">
            {formatDate(date_of_birth)}{" "}
            <span className="text-slate-400 text-sm">({ageFromDob(date_of_birth)})</span>
          </p>
        </div>
        <div>
          <p className="text-sm text-slate-400">Sex</p>
          <p className="text-base text-white capitalize">{sex ?? "—"}</p>
        </div>
        {ward && (
          <div>
            <p className="text-sm text-slate-400">Ward</p>
            <p className="text-base text-white">{ward}</p>
          </div>
        )}
        {preferred_language && (
          <div>
            <p className="text-sm text-slate-400">Language</p>
            <p className="text-base text-white uppercase">{preferred_language}</p>
          </div>
        )}
      </div>

      <hr className="border-slate-700" />

      {/* Allergies */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Allergies</h3>
        {allergies.length === 0 ? (
          <p className="text-sm text-slate-500">None documented</p>
        ) : (
          <ul className="space-y-1">
            {allergies.map((a) => (
              <li key={a.id} className="text-sm text-white">
                {a.code_display ?? "Unknown substance"}
                {a.reaction ? (
                  <span className="text-slate-400"> — Reaction: {a.reaction}</span>
                ) : null}
                {a.recorded_at ? (
                  <span className="text-slate-500 ml-2">(Recorded: {formatDate(a.recorded_at)})</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Conditions */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">
          Conditions / Problems
        </h3>
        {conditions.length === 0 ? (
          <p className="text-sm text-slate-500">None documented</p>
        ) : (
          <ul className="space-y-1">
            {conditions.map((c) => (
              <li key={c.id} className="text-sm text-white">
                {c.code_display ?? "Unknown condition"}
                <span className="text-slate-400 ml-2">
                  Status: {c.status ?? "unknown"}
                </span>
                {c.onset_date ? (
                  <span className="text-slate-500 ml-2">
                    (Onset: {formatDate(c.onset_date)})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
