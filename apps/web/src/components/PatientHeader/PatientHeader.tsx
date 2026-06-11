/**
 * PatientHeader — displays patient identity, allergies, and conditions.
 *
 * Conditions are expandable: clicking a row loads every documented episode
 * of the same coded condition with the clinic visit note from that date.
 *
 * Constraints:
 * - No severity color-coding
 * - No clinical interpretation language
 * - All information is plain factual text from the record
 */

import { useState } from "react";
import { api, type ConditionHistory, ApiError } from "../../lib/api";
import { useShowMore, ShowMoreButton } from "../ShowMore/ShowMore";

const INITIAL_ALLERGIES = 3;
const INITIAL_CONDITIONS = 5;
const INITIAL_EPISODES = 3;

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

interface HistoryState {
  readonly loading: boolean;
  readonly error: string | null;
  readonly history: ConditionHistory | null;
}

function EpisodeList({
  history,
}: {
  readonly history: ConditionHistory;
}): JSX.Element {
  const episodes = useShowMore(history.episodes, INITIAL_EPISODES);

  return (
    <>
      <p className="text-xs text-slate-500">
        Code: {history.code.code ?? "—"}
        {history.code.system ? ` (${history.code.system})` : ""}
        {" · "}
        {history.episodes.length} documented episode(s)
      </p>
      <ul className="space-y-2">
        {episodes.visible.map((ep) => (
          <li key={ep.id} className="text-sm">
            <p className="text-white">
              {formatDate(ep.onset_date)}
              <span className="text-slate-400 ml-2">
                Status: {ep.status ?? "unknown"}
              </span>
              {ep.encounter?.ward ? (
                <span className="text-slate-400 ml-2">
                  — {ep.encounter.ward}
                </span>
              ) : null}
            </p>
            {ep.note ? (
              <p className="text-slate-400 mt-0.5">
                {ep.note.type ?? "Note"}
                {ep.note.author_display ? ` — ${ep.note.author_display}` : ""}
                {": "}
                {ep.note.content_text ?? ""}
              </p>
            ) : (
              <p className="text-slate-500 mt-0.5">
                No note documented on this date.
              </p>
            )}
          </li>
        ))}
      </ul>
      <ShowMoreButton state={episodes} itemLabel="episodes" />
    </>
  );
}

function ConditionRow({
  patientId,
  condition,
}: {
  readonly patientId: string;
  readonly condition: ConditionItem;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<HistoryState>({
    loading: false,
    error: null,
    history: null,
  });

  const toggle = (): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && !state.history && !state.loading) {
      setState({ loading: true, error: null, history: null });
      api.patients
        .conditionHistory(patientId, condition.id)
        .then((history) => setState({ loading: false, error: null, history }))
        .catch((err: unknown) => {
          const message =
            err instanceof ApiError ? err.message : "Failed to load history";
          setState({ loading: false, error: message, history: null });
        });
    }
  };

  return (
    <li className="text-sm text-white">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="w-full text-left hover:bg-slate-800 rounded px-1 py-0.5"
      >
        <span className="text-slate-500 mr-1">{expanded ? "▾" : "▸"}</span>
        {condition.code_display ?? "Unknown condition"}
        <span className="text-slate-400 ml-2">
          Status: {condition.status ?? "unknown"}
        </span>
        {condition.onset_date ? (
          <span className="text-slate-500 ml-2">
            (Onset: {formatDate(condition.onset_date)})
          </span>
        ) : null}
      </button>

      {expanded && (
        <div className="ml-5 mt-1 mb-2 border-l border-slate-700 pl-3 space-y-2">
          {state.loading && (
            <p className="text-sm text-slate-500">Loading episode history…</p>
          )}
          {state.error && (
            <p className="text-sm text-slate-400">{state.error}</p>
          )}
          {state.history && <EpisodeList history={state.history} />}
        </div>
      )}
    </li>
  );
}

export default function PatientHeader({
  id,
  mrn,
  display_name,
  date_of_birth,
  sex,
  preferred_language,
  ward,
  allergies,
  conditions,
}: PatientHeaderProps): JSX.Element {
  const allergyList = useShowMore(allergies, INITIAL_ALLERGIES);
  const conditionList = useShowMore(conditions, INITIAL_CONDITIONS);

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
          {/* dir=ltr: keep day-month-year order intact in RTL layouts */}
          <p className="text-base text-white" dir="ltr">
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
          <>
            <ul className="space-y-1">
              {allergyList.visible.map((a) => (
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
            <ShowMoreButton state={allergyList} itemLabel="allergies" />
          </>
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
          <>
            <ul className="space-y-1">
              {conditionList.visible.map((c) => (
                <ConditionRow key={c.id} patientId={id} condition={c} />
              ))}
            </ul>
            <ShowMoreButton state={conditionList} itemLabel="conditions" />
          </>
        )}
      </div>
    </div>
  );
}
