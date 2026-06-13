/**
 * PatientBrief — a factual, at-a-glance reproduction of the patient's
 * documented record: problem-list conditions, per-clinic symptoms and
 * treatment, latest labs, and imaging reports.
 *
 * Constraints (non-SaMD boundary — see CLAUDE.md sections 2-3):
 * - NO risk classification, NO "high/low/abnormal" flags, NO severity colour.
 * - Reference ranges are shown exactly as the source lab reported them.
 * - Everything here restates documented facts; it makes no clinical judgement.
 */

import { useEffect, useState } from "react";
import { api, type PatientBrief as Brief, ApiError } from "../../lib/api";
import { useShowMore, ShowMoreButton } from "../ShowMore/ShowMore";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function labValue(l: Brief["labs"][number]): string {
  const v = l.value_numeric !== null ? `${l.value_numeric}${l.unit ? ` ${l.unit}` : ""}` : (l.value_text ?? "—");
  let ref = "";
  if (l.ref_range_text) ref = ` [${l.ref_range_text}]`;
  else if (l.ref_range_low !== null && l.ref_range_high !== null) ref = ` [${l.ref_range_low}–${l.ref_range_high}${l.unit ? ` ${l.unit}` : ""}]`;
  return `${v}${ref}`;
}

function ClinicCard({ clinic }: { readonly clinic: Brief["clinics"][number] }): JSX.Element {
  const symptoms = useShowMore(clinic.symptoms, 4);
  return (
    <div className="border border-slate-700 rounded-lg p-3">
      <p className="text-sm font-medium text-white mb-1.5">{clinic.clinic}</p>
      <div className="mb-2">
        <p className="text-xs text-slate-400 mb-0.5">Symptoms reported</p>
        {clinic.symptoms.length === 0 ? (
          <p className="text-xs text-slate-500">None documented</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {symptoms.visible.map((s, i) => (
                <li key={i} className="text-sm text-white" dir="ltr">
                  {s.display}
                  <span className="text-slate-500 ml-1">({s.status ?? "—"}, {formatDate(s.onset_date)})</span>
                </li>
              ))}
            </ul>
            <ShowMoreButton state={symptoms} itemLabel="symptoms" />
          </>
        )}
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-0.5">Treatment documented</p>
        {clinic.treatments.length === 0 ? (
          <p className="text-xs text-slate-500">None documented</p>
        ) : (
          <ul className="space-y-0.5">
            {clinic.treatments.map((t, i) => (
              <li key={i} className="text-sm text-white" dir="ltr">
                {t.display}
                <span className="text-slate-500 ml-1">
                  {[t.dose, t.route, t.frequency].filter(Boolean).join(", ")}{t.status ? ` — ${t.status}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PatientBrief({ patientId }: { readonly patientId: string }): JSX.Element {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.patients
      .brief(patientId)
      .then((b) => { if (active) { setBrief(b); setError(null); } })
      .catch((err: unknown) => { if (active) setError(err instanceof ApiError ? err.message : "Failed to load brief"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  const labs = useShowMore(brief?.labs ?? [], 6);
  const conditions = useShowMore(brief?.documented_conditions ?? [], 6);

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
        <p className="text-sm text-slate-500">Loading patient brief…</p>
      </div>
    );
  }
  if (error || !brief) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
        <p className="text-sm text-slate-400">{error ?? "No brief available"}</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-white">Patient Brief</h2>
        <span className="text-xs text-slate-500">Factual reproduction — not a clinical risk assessment</span>
      </div>

      {/* Documented conditions (problem list) with their active medications */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">
          Documented conditions &amp; current medications
        </h3>
        {brief.documented_conditions.length === 0 ? (
          <p className="text-sm text-slate-500">None documented</p>
        ) : (
          <>
            <ul className="space-y-2">
              {conditions.visible.map((c, i) => (
                <li key={i} className="border border-slate-700 rounded px-3 py-2">
                  <p className="text-sm text-white" dir="ltr">
                    {c.code_display ?? "Unknown"}
                    <span className="text-slate-500 ml-1">({c.status ?? "—"}, {formatDate(c.onset_date)})</span>
                  </p>
                  {c.active_medications.length > 0 ? (
                    <ul className="mt-1 ml-3 space-y-0.5">
                      {c.active_medications.map((m, j) => (
                        <li key={j} className="text-sm text-slate-300" dir="ltr">
                          • {m.display}
                          <span className="text-slate-500 ml-1">
                            {[m.dose, m.route, m.frequency].filter(Boolean).join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 ml-3 text-xs text-slate-500">
                      No medication with a documented indication for this condition
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <ShowMoreButton state={conditions} itemLabel="conditions" />
          </>
        )}
        {brief.other_active_medications.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-slate-400 mb-1">
              Other active medications (no documented condition indication)
            </p>
            <ul className="ml-3 space-y-0.5">
              {brief.other_active_medications.map((m, i) => (
                <li key={i} className="text-sm text-slate-300" dir="ltr">
                  • {m.display}
                  <span className="text-slate-500 ml-1">
                    {[m.dose, m.route, m.frequency].filter(Boolean).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Care history by clinic */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Care history by clinic</h3>
        {brief.clinics.length === 0 ? (
          <p className="text-sm text-slate-500">No clinic visits documented</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {brief.clinics.map((c) => <ClinicCard key={c.clinic} clinic={c} />)}
          </div>
        )}
      </div>

      {/* Lab investigations */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Lab investigations (latest per test)</h3>
        {brief.labs.length === 0 ? (
          <p className="text-sm text-slate-500">None documented</p>
        ) : (
          <>
            <ul className="grid gap-1 sm:grid-cols-2">
              {labs.visible.map((l, i) => (
                <li key={i} className="text-sm" dir="ltr">
                  <span className="text-slate-300">{l.code_display ?? l.code}: </span>
                  <span className="text-white font-mono">{labValue(l)}</span>
                  <span className="text-slate-500 ml-1">{formatDate(l.effective_at)}</span>
                </li>
              ))}
            </ul>
            <ShowMoreButton state={labs} itemLabel="labs" />
          </>
        )}
      </div>

      {/* Procedures / interventions */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Procedures &amp; interventions</h3>
        {brief.procedures.length === 0 ? (
          <p className="text-sm text-slate-500">None documented</p>
        ) : (
          <ul className="space-y-1.5">
            {brief.procedures.map((p, i) => (
              <li key={i} className="text-sm text-white">
                <span dir="ltr">{p.code_display}</span>
                <span className="text-slate-500 ml-1">
                  ({p.status ?? "—"}, {formatDate(p.performed_at)})
                </span>
                {p.performer_display ? <span className="text-slate-500 ml-1">— {p.performer_display}</span> : null}
                {p.note ? <p className="text-slate-400 mt-0.5">{p.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Imaging */}
      <div>
        <h3 className="text-sm font-medium text-slate-300 mb-2">Imaging reports</h3>
        {brief.imaging.length === 0 ? (
          <p className="text-sm text-slate-500">None documented</p>
        ) : (
          <ul className="space-y-1.5">
            {brief.imaging.map((im, i) => (
              <li key={i} className="text-sm text-white">
                <span className="text-slate-300">{im.code_display}</span>
                <span className="text-slate-500 ml-1">({formatDate(im.effective_at)})</span>
                {im.value_text ? <p className="text-slate-400 mt-0.5">{im.value_text}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
