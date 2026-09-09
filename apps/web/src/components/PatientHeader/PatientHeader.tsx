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
import { formatDate } from "../../lib/dates";
import i18n from "../../i18n";
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
      <p className="text-xs text-ink-soft">
        Code: {history.code.code ?? "—"}
        {history.code.system ? ` (${history.code.system})` : ""}
        {" · "}
        {history.episodes.length} documented episode(s)
      </p>
      <ul className="space-y-2">
        {episodes.visible.map((ep) => (
          <li key={ep.id} className="text-sm">
            <p className="text-ink">
              {formatDate(ep.onset_date, i18n.language)}
              <span className="text-ink-soft ml-2">
                Status: {ep.status ?? "unknown"}
              </span>
              {ep.encounter?.ward ? (
                <span className="text-ink-soft ml-2">
                  — {ep.encounter.ward}
                </span>
              ) : null}
            </p>
            {ep.note ? (
              <p className="text-ink-soft mt-0.5">
                {ep.note.type ?? "Note"}
                {ep.note.author_display ? ` — ${ep.note.author_display}` : ""}
                {": "}
                {ep.note.content_text ?? ""}
              </p>
            ) : (
              <p className="text-ink-soft mt-0.5">
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
    <li className="text-sm text-ink">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="w-full text-left hover:bg-veil rounded px-1 py-0.5"
      >
        <span className="text-ink-soft mr-1">{expanded ? "▾" : "▸"}</span>
        {condition.code_display ?? "Unknown condition"}
        <span className="text-ink-soft ml-2">
          Status: {condition.status ?? "unknown"}
        </span>
        {condition.onset_date ? (
          <span className="text-ink-soft ml-2">
            (Onset: {formatDate(condition.onset_date, i18n.language)})
          </span>
        ) : null}
      </button>

      {expanded && (
        <div className="ml-5 mt-1 mb-2 border-l border-line pl-3 space-y-2">
          {state.loading && (
            <p className="text-sm text-ink-soft">Loading episode history…</p>
          )}
          {state.error && (
            <p className="text-sm text-ink-soft">{state.error}</p>
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
    <div className="bg-white border border-line rounded-[18px] shadow-card p-6 space-y-4">
      {/* Identity row */}
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Patient Name</p>
          <p className="text-lg font-semibold text-ink">
            {display_name ?? "Unknown"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">MRN</p>
          <p className="text-base text-ink font-mono">{mrn ?? "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Date of Birth</p>
          {/* dir=ltr: keep day-month-year order intact in RTL layouts */}
          <p className="text-base text-ink" dir="ltr">
            {formatDate(date_of_birth, i18n.language)}{" "}
            <span className="text-ink-soft text-sm">({ageFromDob(date_of_birth)})</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Sex</p>
          <p className="text-base text-ink capitalize">{sex ?? "—"}</p>
        </div>
        {ward && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Ward</p>
            <p className="text-base text-ink">{ward}</p>
          </div>
        )}
        {preferred_language && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">Language</p>
            <p className="text-base text-ink uppercase">{preferred_language}</p>
          </div>
        )}
      </div>

      <hr className="border-line/70" />

      {/* Allergies */}
      <div>
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-2">Allergies</h3>
        {allergies.length === 0 ? (
          <p className="text-sm text-ink-soft">None documented</p>
        ) : (
          <>
            <ul className="space-y-1">
              {allergyList.visible.map((a) => (
                <li key={a.id} className="text-sm text-ink">
                  {a.code_display ?? "Unknown substance"}
                  {a.reaction ? (
                    <span className="text-ink-soft"> — Reaction: {a.reaction}</span>
                  ) : null}
                  {a.recorded_at ? (
                    <span className="text-ink-soft ml-2">(Recorded: {formatDate(a.recorded_at, i18n.language)})</span>
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
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-faint mb-2">
          Conditions / Problems
        </h3>
        {conditions.length === 0 ? (
          <p className="text-sm text-ink-soft">None documented</p>
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
