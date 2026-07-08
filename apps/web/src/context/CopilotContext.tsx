/**
 * CopilotContext
 *
 * Tracks which patient is currently open so the sidebar and command bar
 * can show per-patient navigation (Copilot workspace / Patient File) and
 * deep-link into it from anywhere in the app.
 */

import React, { createContext, useCallback, useContext, useState } from "react";

interface CopilotContextValue {
  activePatientId: string | null;
  activePatientName: string | null;
  setPatient: (patientId: string, patientName: string) => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [activePatientName, setActivePatientName] = useState<string | null>(null);

  const setPatient = useCallback((patientId: string, patientName: string) => {
    setActivePatientId(patientId);
    setActivePatientName(patientName);
  }, []);

  return (
    <CopilotContext.Provider value={{ activePatientId, activePatientName, setPatient }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used within CopilotProvider");
  return ctx;
}
