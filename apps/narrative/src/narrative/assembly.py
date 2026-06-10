"""Assemble structured patient data from the database for prompt filling."""
from __future__ import annotations

import json
import logging
from typing import Any, TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)


class AssembledPatientData(BaseModel):
    """All fields required to fill the narrative prompt template."""

    patient_id: str
    patient_demographics_json: str
    current_encounter_json: str
    conditions_json: str
    allergies_json: str
    active_medications_json: str
    recent_observations_json: str
    recent_documents_json: str
    prior_admissions_json: str

    # Raw lists for provenance matching
    raw_demographics: dict[str, Any] = {}
    raw_conditions: list[dict[str, Any]] = []
    raw_allergies: list[dict[str, Any]] = []
    raw_medications: list[dict[str, Any]] = []
    raw_observations: list[dict[str, Any]] = []
    raw_documents: list[dict[str, Any]] = []
    raw_encounters: list[dict[str, Any]] = []

    model_config = {"arbitrary_types_allowed": True}


def _j(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


async def assemble_patient_data(
    patient_id: str,
    scope: str,
    pool: "asyncpg.Pool[asyncpg.Record] | None",
) -> AssembledPatientData:
    """Query the hospital.* tables and return assembled prompt data.

    Parameters
    ----------
    patient_id:
        UUID of the patient.
    scope:
        ``"full"`` | ``"current_encounter"`` | ``"last_30_days"``
    pool:
        asyncpg connection pool.
    """
    if pool is None:
        # Stub/test mode — return empty assembled data
        return AssembledPatientData(
            patient_id=patient_id,
            patient_demographics_json="{}",
            current_encounter_json="{}",
            conditions_json="[]",
            allergies_json="[]",
            active_medications_json="[]",
            recent_observations_json="[]",
            recent_documents_json="[]",
            prior_admissions_json="[]",
        )

    async with pool.acquire() as conn:
        # Demographics
        patient_row = await conn.fetchrow(
            """
            SELECT id, mrn, display_name, date_of_birth, sex, preferred_language, ward
            FROM hospital.patient
            WHERE id = $1
            """,
            patient_id,
        )

        demographics: dict[str, Any] = {}
        if patient_row:
            demographics = dict(patient_row)
            demographics = {k: str(v) if v is not None else None for k, v in demographics.items()}

        # Active conditions
        condition_rows = await conn.fetch(
            """
            SELECT id, code_display, code, code_system, clinical_status, onset_date
            FROM hospital.condition
            WHERE patient_id = $1
              AND clinical_status != 'inactive'
            ORDER BY onset_date DESC NULLS LAST
            """,
            patient_id,
        )
        conditions = [dict(r) for r in condition_rows]

        # Allergies
        allergy_rows = await conn.fetch(
            """
            SELECT id, code_display, reaction, severity, recorded_at
            FROM hospital.allergy_intolerance
            WHERE patient_id = $1
            ORDER BY recorded_at DESC NULLS LAST
            """,
            patient_id,
        )
        allergies = [dict(r) for r in allergy_rows]

        # Active medications
        med_rows = await conn.fetch(
            """
            SELECT id, medication_display, code, dose, route, frequency, status, started_at
            FROM hospital.medication_request
            WHERE patient_id = $1
              AND status = 'active'
            ORDER BY started_at DESC NULLS LAST
            """,
            patient_id,
        )
        medications = [dict(r) for r in med_rows]

        # Current encounter
        enc_row = await conn.fetchrow(
            """
            SELECT id, encounter_type, status, started_at, ended_at, ward, bed,
                   admitting_diagnosis_display
            FROM hospital.encounter
            WHERE patient_id = $1
              AND status IN ('in-progress', 'arrived')
            ORDER BY started_at DESC NULLS LAST
            LIMIT 1
            """,
            patient_id,
        )
        current_enc: dict[str, Any] = dict(enc_row) if enc_row else {}

        # Prior admissions (completed encounters)
        prior_enc_rows = await conn.fetch(
            """
            SELECT id, encounter_type, status, started_at, ended_at,
                   admitting_diagnosis_display
            FROM hospital.encounter
            WHERE patient_id = $1
              AND status = 'finished'
            ORDER BY started_at DESC NULLS LAST
            LIMIT 10
            """,
            patient_id,
        )
        prior_encounters = [dict(r) for r in prior_enc_rows]

        # Observations — scope-limited
        obs_where = "WHERE patient_id = $1"
        obs_params: list[Any] = [patient_id]
        if scope == "current_encounter" and current_enc:
            obs_where += " AND effective_at >= $2"
            obs_params.append(current_enc.get("started_at"))
        elif scope == "last_30_days":
            obs_where += " AND effective_at >= now() - interval '30 days'"

        obs_rows = await conn.fetch(
            f"""
            SELECT id, category, code, code_display, value_numeric, value_text,
                   unit, ref_range_low, ref_range_high, ref_range_text, effective_at, status
            FROM hospital.observation
            {obs_where}
            ORDER BY effective_at DESC NULLS LAST
            LIMIT 50
            """,
            *obs_params,
        )
        observations = [dict(r) for r in obs_rows]

        # Document references
        doc_rows = await conn.fetch(
            """
            SELECT id, type_display, content_text, author_display, authored_at
            FROM hospital.document_reference
            WHERE patient_id = $1
            ORDER BY authored_at DESC NULLS LAST
            LIMIT 20
            """,
            patient_id,
        )
        documents = [dict(r) for r in doc_rows]

    return AssembledPatientData(
        patient_id=patient_id,
        patient_demographics_json=_j(demographics),
        current_encounter_json=_j(current_enc),
        conditions_json=_j(conditions),
        allergies_json=_j(allergies),
        active_medications_json=_j(medications),
        recent_observations_json=_j(observations),
        recent_documents_json=_j(
            [{"id": d["id"], "type": d.get("type_display"), "author": d.get("author_display"),
              "authored_at": str(d.get("authored_at") or "")} for d in documents]
        ),
        prior_admissions_json=_j(prior_encounters),
        raw_demographics=demographics,
        raw_conditions=[dict(r) for r in conditions],
        raw_allergies=[dict(r) for r in allergies],
        raw_medications=[dict(r) for r in medications],
        raw_observations=[dict(r) for r in observations],
        raw_documents=[dict(r) for r in documents],
        raw_encounters=([dict(current_enc)] if current_enc else []) + [dict(r) for r in prior_encounters],
    )
