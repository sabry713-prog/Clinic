/**
 * CopilotContext
 *
 * Global state for the persistent Copilot side panel.
 * Any page can set the active patient; the panel opens/closes independently.
 */

import React, { createContext, useCallback, useContext, useState } from "react";

interface CopilotContextValue {
  isOpen: boolean;
  activePatientId: string | null;
  activePatientName: string | null;
  open: (patientId?: string, patientName?: string) => void;
  close: () => void;
  toggle: () => void;
  setPatient: (patientId: string, patientName: string) => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [activePatientName, setActivePatientName] = useState<string | null>(null);

  const open = useCallback((patientId?: string, patientName?: string) => {
    if (patientId) setActivePatientId(patientId);
    if (patientName) setActivePatientName(patientName);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const setPatient = useCallback((patientId: string, patientName: string) => {
    setActivePatientId(patientId);
    setActivePatientName(patientName);
  }, []);

  return (
    <CopilotContext.Provider value={{ isOpen, activePatientId, activePatientName, open, close, toggle, setPatient }}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot must be used within CopilotProvider");
  return ctx;
}
