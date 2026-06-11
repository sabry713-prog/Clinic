/**
 * CopilotPanel
 *
 * Persistent fixed right-side panel. Wraps QAConversation.
 * Visible on all authenticated pages without tab navigation.
 *
 * Constraints:
 * - No clinical interpretation in UI chrome
 * - Panel does not auto-open; doctor controls it
 * - Patient context set by the page currently being viewed
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCopilot } from "../../context/CopilotContext";
import QAConversation from "../QAConversation/QAConversation";

export default function CopilotPanel(): React.ReactElement {
  const { isOpen, activePatientId, activePatientName, close, toggle } = useCopilot();
  const { t } = useTranslation();
  const [language, setLanguage] = useState<"en" | "ar">("en");

  return (
    <>
      {/* Floating toggle button — always visible */}
      <button
        onClick={toggle}
        aria-label={isOpen ? "Close AI Copilot" : "Open AI Copilot"}
        className={`
          fixed bottom-6 right-6 z-50
          w-14 h-14 rounded-full shadow-2xl
          flex items-center justify-center
          transition-all duration-200
          ${isOpen
            ? "bg-slate-700 hover:bg-slate-600 text-white"
            : "bg-blue-600 hover:bg-blue-500 text-white"
          }
        `}
      >
        {isOpen ? (
          /* X icon */
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          /* Sparkle / copilot icon */
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
          </svg>
        )}
      </button>

      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 lg:hidden"
          onClick={close}
          aria-hidden="true"
        />
      )}

      {/* Side panel */}
      <aside
        className={`
          fixed top-0 right-0 z-40 h-full
          w-full sm:w-[400px]
          bg-white shadow-2xl border-l border-gray-200
          flex flex-col
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
        aria-label="AI Copilot"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            {/* Copilot icon */}
            <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">AI Copilot</p>
              {activePatientName && (
                <p className="text-xs text-slate-400 leading-tight truncate max-w-[220px]">
                  {activePatientName}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={close}
            aria-label="Close panel"
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activePatientId ? (
            <QAConversation
              patientId={activePatientId}
              language={language}
              onLanguageToggle={() => setLanguage((l) => (l === "en" ? "ar" : "en"))}
            />
          ) : (
            <NoPatientState />
          )}
        </div>
      </aside>
    </>
  );
}

function NoPatientState(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
        <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-slate-700">No patient selected</p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Open a patient record to start asking factual questions about their documented data.
        </p>
      </div>
    </div>
  );
}
