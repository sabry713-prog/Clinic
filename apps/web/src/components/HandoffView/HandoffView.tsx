/**
 * HandoffView — displays a structured handoff summary.
 *
 * Constraints:
 * - No color-coding by clinical status
 * - No severity flags
 * - No interpretation language
 * - Plain factual text only
 * - Disclaimer at bottom
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { HandoffOutput } from "../../lib/api";

interface SectionPanelProps {
  title: string;
  items: readonly string[];
}

function SectionPanel({ title, items }: SectionPanelProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden mb-3">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-800 text-white text-sm font-medium text-left"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <span className="text-slate-400 text-xs">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="px-4 py-3 bg-slate-900 text-slate-200 text-sm">
          {items.length === 0 ? (
            <p className="text-slate-500 italic">None documented</p>
          ) : (
            <ul className="space-y-1">
              {items.map((item, idx) => (
                <li key={idx} className="leading-relaxed">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface HandoffViewProps {
  handoff: HandoffOutput;
  isLoading?: boolean;
}

export default function HandoffView({ handoff, isLoading }: HandoffViewProps): JSX.Element {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="bg-slate-900 rounded-xl p-6">
        <p className="text-slate-400 text-sm">{t("common.loading")}</p>
      </div>
    );
  }

  const handlePrint = (): void => {
    window.print();
  };

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(handoff.text);
  };

  const sections: Array<{ key: keyof typeof handoff.sections; label: string }> = [
    { key: "identity_and_admission", label: t("handoff.section.identity") },
    { key: "documented_today", label: t("handoff.section.documented_today") },
    { key: "current_medications", label: t("handoff.section.medications") },
    { key: "recent_vitals", label: t("handoff.section.vitals") },
    { key: "recent_labs", label: t("handoff.section.labs") },
    { key: "pending_orders", label: t("handoff.section.orders") },
  ];

  return (
    <div className="bg-slate-950 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white text-base font-semibold">{t("handoff.title")}</h2>
          <p className="text-slate-400 text-xs mt-1">
            {t("handoff.generated_at")}: {new Date(handoff.generated_at).toLocaleString()} ·{" "}
            {t("handoff.scope")}: {handoff.scope} · {t("handoff.language")}: {handoff.language.toUpperCase()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded px-3 py-1"
            aria-label={t("handoff.copy")}
          >
            {t("handoff.copy")}
          </button>
          <button
            onClick={handlePrint}
            className="text-xs text-slate-400 hover:text-white border border-slate-700 rounded px-3 py-1"
            aria-label={t("handoff.print")}
          >
            {t("handoff.print")}
          </button>
        </div>
      </div>

      <div>
        {sections.map(({ key, label }) => (
          <SectionPanel
            key={key}
            title={label}
            items={handoff.sections[key]}
          />
        ))}
      </div>

      <div className="border-t border-slate-800 pt-4 mt-4">
        <p className="text-slate-500 text-xs leading-relaxed">{handoff.disclaimer}</p>
      </div>
    </div>
  );
}
