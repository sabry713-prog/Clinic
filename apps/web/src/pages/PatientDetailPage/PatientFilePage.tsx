/**
 * PatientFilePage — the read-only patient chart.
 *
 * Identity, allergies, documented conditions, care history, labs,
 * procedures, imaging, medications, and reconciliation — exactly what
 * used to be the "Overview" tab, unchanged in content. Reachable from the
 * sidebar ("Patient File") for doctors who want to navigate the raw
 * record themselves; the default landing view is the Copilot workspace.
 *
 * Constraints:
 * - No color-coding by clinical status
 * - No severity flags
 * - No interpretation language
 * - Plain factual text only
 */

import { useState, useEffect, useCallback } from "react";
import { api, type PatientDetail, type ObservationItem, type MedicationItem, type MedicationReconciliation } from "../../lib/api";
import PatientHeader from "../../components/PatientHeader/PatientHeader";
import PatientBrief from "../../components/PatientBrief/PatientBrief";
import LabPanel from "../../components/LabPanel/LabPanel";
import MedicationPanel from "../../components/MedicationPanel/MedicationPanel";
import ReconciliationPanel from "../../components/ReconciliationPanel/ReconciliationPanel";

export default function PatientFilePage({ patient }: { readonly patient: PatientDetail }): JSX.Element {
  const [observations, setObservations] = useState<ObservationItem[]>([]);
  const [obsNextCursor, setObsNextCursor] = useState<string | null>(null);
  const [medications, setMedications] = useState<MedicationItem[]>([]);
  const [reconciliation, setReconciliation] = useState<MedicationReconciliation | null>(null);
  const [isLoadingObs, setIsLoadingObs] = useState(true);
  const [isLoadingMeds, setIsLoadingMeds] = useState(true);
  const [isLoadingReconciliation, setIsLoadingReconciliation] = useState(true);
  const [isLoadingMoreObs, setIsLoadingMoreObs] = useState(false);

  const patientId = patient.id;

  useEffect(() => {
    setIsLoadingObs(true);
    api.patients
      .observations(patientId, { limit: 50 })
      .then((data) => {
        setObservations(data.data);
        setObsNextCursor(data.next_cursor);
      })
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingObs(false));

    setIsLoadingMeds(true);
    api.patients
      .medications(patientId, { status: "active" })
      .then((data) => setMedications(data.data))
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingMeds(false));

    setIsLoadingReconciliation(true);
    api.patients
      .medicationReconciliation(patientId)
      .then((data) => setReconciliation(data))
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingReconciliation(false));
  }, [patientId]);

  const handleLoadMoreObs = useCallback((): void => {
    if (!obsNextCursor || isLoadingMoreObs) return;
    setIsLoadingMoreObs(true);
    api.patients
      .observations(patientId, { limit: 50, cursor: obsNextCursor })
      .then((data) => {
        setObservations((prev) => [...prev, ...data.data]);
        setObsNextCursor(data.next_cursor);
      })
      .catch(() => { /* handled silently */ })
      .finally(() => setIsLoadingMoreObs(false));
  }, [patientId, obsNextCursor, isLoadingMoreObs]);

  return (
    <div className="space-y-6">
      <PatientHeader
        id={patient.id}
        mrn={patient.mrn}
        display_name={patient.display_name}
        date_of_birth={patient.date_of_birth}
        sex={patient.sex}
        preferred_language={patient.preferred_language}
        ward={patient.ward}
        allergies={patient.allergies}
        conditions={patient.conditions}
      />

      <PatientBrief patientId={patient.id} />

      <LabPanel
        observations={observations}
        isLoading={isLoadingObs}
        onLoadMore={handleLoadMoreObs}
        hasMore={obsNextCursor !== null}
      />

      <MedicationPanel medications={medications} isLoading={isLoadingMeds} />

      <ReconciliationPanel data={reconciliation} isLoading={isLoadingReconciliation} />
    </div>
  );
}
