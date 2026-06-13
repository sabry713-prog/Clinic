const API_BASE = import.meta.env["VITE_API_BASE_URL"] ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    let code = "UNKNOWN_ERROR";
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(res.status, code, message);
  }

  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface PatientSummary {
  readonly id: string;
  readonly mrn: string | null;
  readonly display_name: string | null;
  readonly date_of_birth: string | null;
  readonly sex: string | null;
  readonly preferred_language: string | null;
  readonly ward: string | null;
}

export interface AllergyItem {
  readonly id: string;
  readonly code_display: string | null;
  readonly reaction: string | null;
  readonly recorded_at: string | null;
}

export interface ConditionItem {
  readonly id: string;
  readonly code_display: string | null;
  readonly status: string | null;
  readonly onset_date: string | null;
}

export interface PatientDetail extends PatientSummary {
  readonly allergies: readonly AllergyItem[];
  readonly conditions: readonly ConditionItem[];
}

export interface ConditionEpisode {
  readonly id: string;
  readonly status: string | null;
  readonly onset_date: string | null;
  readonly encounter: {
    readonly id: string;
    readonly ward: string | null;
    readonly started_at: string | null;
  } | null;
  readonly note: {
    readonly id: string;
    readonly type: string | null;
    readonly authored_at: string | null;
    readonly author_display: string | null;
    readonly content_text: string | null;
  } | null;
}

export interface ConditionHistory {
  readonly code: {
    readonly system: string | null;
    readonly code: string | null;
    readonly display: string | null;
  };
  readonly episodes: readonly ConditionEpisode[];
}

export interface BriefMedication {
  readonly display: string | null;
  readonly dose: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly status: string | null;
}

export interface PatientBrief {
  readonly documented_conditions: readonly {
    readonly code: string | null;
    readonly code_display: string | null;
    readonly status: string | null;
    readonly onset_date: string | null;
    readonly active_medications: readonly BriefMedication[];
  }[];
  readonly clinics: readonly {
    readonly clinic: string;
    readonly symptoms: readonly { display: string; status: string | null; onset_date: string | null }[];
    readonly treatments: readonly { display: string; dose: string | null; route: string | null; frequency: string | null; status: string | null }[];
  }[];
  readonly labs: readonly {
    readonly code: string | null;
    readonly code_display: string | null;
    readonly value_numeric: number | null;
    readonly value_text: string | null;
    readonly unit: string | null;
    readonly ref_range_low: number | null;
    readonly ref_range_high: number | null;
    readonly ref_range_text: string | null;
    readonly effective_at: string | null;
  }[];
  readonly imaging: readonly {
    readonly code_display: string | null;
    readonly value_text: string | null;
    readonly effective_at: string | null;
  }[];
  readonly other_active_medications: readonly BriefMedication[];
}

export interface ObservationItem {
  readonly id: string;
  readonly category: string | null;
  readonly code: string | null;
  readonly code_display: string | null;
  readonly value_numeric: number | null;
  readonly value_text: string | null;
  readonly unit: string | null;
  readonly ref_range_low: number | null;
  readonly ref_range_high: number | null;
  readonly ref_range_text: string | null;
  readonly effective_at: string | null;
}

export interface MedicationItem {
  readonly id: string;
  readonly medication_display: string | null;
  readonly code: string | null;
  readonly dose: string | null;
  readonly route: string | null;
  readonly frequency: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

export interface EncounterItem {
  readonly id: string;
  readonly encounter_type: string | null;
  readonly status: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly ward: string | null;
}

export interface DocumentItem {
  readonly id: string;
  readonly type: string | null;
  readonly authored_at: string | null;
  readonly author_display: string | null;
  readonly content_text: string | null;
}

export interface QuarantineItem {
  readonly id: string;
  readonly candidate_a_id: string;
  readonly candidate_b_id: string;
  readonly confidence: number;
  readonly features_json: Record<string, unknown>;
  readonly status: string;
  readonly created_at: string;
}

export interface SourceRef {
  readonly type: string;
  readonly id: string;
  readonly field: string;
}

export interface ProvenanceEntry {
  readonly sentence_index: number;
  readonly char_range: readonly [number, number];
  readonly sources: readonly SourceRef[];
}

export interface NarrativeItem {
  readonly id: string;
  readonly patient_id: string;
  readonly generated_at: string;
  readonly language: string;
  readonly scope: string;
  readonly text: string | null;
  readonly fallback_message: string | null;
  readonly provenance: readonly ProvenanceEntry[];
  readonly model_version: string | null;
  readonly prompt_template_version: string;
  readonly disclaimer: string;
}

export interface AnswerSource {
  readonly fact_segment: string;
  readonly type: string;
  readonly id: string;
  readonly code: string;
  readonly source_system: string;
  readonly field: string;
}

export interface QAResponse {
  readonly interaction_id: string;
  readonly patient_id: string;
  readonly conversation_id: string;
  readonly question: string;
  readonly classification: "ALLOWED" | "REFUSED";
  readonly classifier_confidence: number;
  readonly refusal_category: string | null;
  readonly rule_matches: readonly string[];
  readonly language: string;
  readonly answer_text: string;
  readonly sources: readonly AnswerSource[];
  readonly model_version: string;
  readonly prompt_template_version: string;
  readonly latency_ms: number;
  readonly disclaimer: string;
  readonly blocklist_triggered: boolean;
}

// ─── Handoff types ─────────────────────────────────────────────────────────

export interface HandoffSection {
  readonly identity_and_admission: readonly string[];
  readonly documented_today: readonly string[];
  readonly current_medications: readonly string[];
  readonly recent_vitals: readonly string[];
  readonly recent_labs: readonly string[];
  readonly pending_orders: readonly string[];
}

export interface HandoffProvenance {
  readonly section: string;
  readonly row_index: number;
  readonly source_type: string;
  readonly source_id: string;
  readonly field: string;
}

export interface HandoffOutput {
  readonly id: string;
  readonly patient_id: string;
  readonly ward_id: string | null;
  readonly generated_at: string;
  readonly language: string;
  readonly scope: string;
  readonly text: string;
  readonly sections: HandoffSection;
  readonly provenance: readonly HandoffProvenance[];
  readonly disclaimer: string;
}

export interface WardHandoffOutput {
  readonly ward_id: string;
  readonly scope: string;
  readonly language: string;
  readonly generated_at: string;
  readonly patient_count: number;
  readonly handoffs: readonly HandoffOutput[];
}

// ─── Audit types ────────────────────────────────────────────────────────────

export interface AuditActor {
  readonly id: string | null;
  readonly display_name: string | null;
  readonly role: string | null;
}

export interface AuditEventItem {
  readonly id: string;
  readonly ts: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly outcome: string;
  readonly metadata_json: Record<string, unknown>;
  readonly request_id: string | null;
}

export interface AuditVerifyResult {
  readonly passed: boolean;
  readonly events_verified: number;
  readonly violations: readonly { event_id: string; reason: string }[];
  readonly started_at: string;
  readonly finished_at: string;
}

// ─── DSR types ──────────────────────────────────────────────────────────────

export interface DsrRequest {
  readonly id: string;
  readonly type: "access" | "erase";
  readonly status: string;
  readonly due_at: string | null;
  readonly requested_at: string;
}

// ─── Admin user types ───────────────────────────────────────────────────────

export interface AdminUser {
  readonly id: string;
  readonly display_name: string | null;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly disabled_at: string | null;
  readonly created_at: string;
}

export interface QAInteractionSummary {
  readonly id: string;
  readonly conversation_id: string | null;
  readonly patient_id: string;
  readonly classification: string;
  readonly refusal_category: string | null;
  readonly language: string;
  readonly created_at: string;
}

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  patients: {
    list: (params?: {
      cursor?: string | undefined;
      limit?: number | undefined;
      q?: string | undefined;
      ward?: string | undefined;
    }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      if (params?.q) qs.set("q", params.q);
      if (params?.ward) qs.set("ward", params.ward);
      const query = qs.toString();
      return request<{
        data: PatientSummary[];
        next_cursor: string | null;
        total: number | null;
      }>(`/api/v1/patients${query ? `?${query}` : ""}`);
    },

    get: (id: string) => request<PatientDetail>(`/api/v1/patients/${id}`),

    observations: (
      id: string,
      params?: {
        code?: string;
        category?: string;
        since?: string;
        until?: string;
        cursor?: string;
        limit?: number;
      },
    ) => {
      const qs = new URLSearchParams();
      if (params?.code) qs.set("code", params.code);
      if (params?.category) qs.set("category", params.category);
      if (params?.since) qs.set("since", params.since);
      if (params?.until) qs.set("until", params.until);
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return request<{
        data: ObservationItem[];
        next_cursor: string | null;
        total: number | null;
      }>(`/api/v1/patients/${id}/observations${query ? `?${query}` : ""}`);
    },

    medications: (id: string, params?: { status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      const query = qs.toString();
      return request<{
        data: MedicationItem[];
        next_cursor: string | null;
        total: number | null;
      }>(`/api/v1/patients/${id}/medications${query ? `?${query}` : ""}`);
    },

    encounters: (id: string) =>
      request<{ data: EncounterItem[]; next_cursor: string | null; total: number | null }>(
        `/api/v1/patients/${id}/encounters`,
      ),

    document: (patientId: string, docId: string) =>
      request<DocumentItem>(`/api/v1/patients/${patientId}/documents/${docId}`),

    conditionHistory: (patientId: string, conditionId: string) =>
      request<ConditionHistory>(
        `/api/v1/patients/${patientId}/conditions/${conditionId}/history`,
      ),

    brief: (patientId: string) =>
      request<PatientBrief>(`/api/v1/patients/${patientId}/brief`),
  },

  narrative: {
    generate: (
      patientId: string,
      params: { language: string; scope: string; regenerate?: boolean },
    ) =>
      request<NarrativeItem>(`/api/v1/patients/${patientId}/narrative`, {
        method: "POST",
        body: JSON.stringify({
          language: params.language,
          scope: params.scope,
          regenerate: params.regenerate ?? false,
        }),
      }),

    get: (patientId: string, narrativeId: string) =>
      request<NarrativeItem>(`/api/v1/patients/${patientId}/narrative/${narrativeId}`),

    sources: (patientId: string, narrativeId: string) =>
      request<{ sources: readonly SourceRef[] }>(
        `/api/v1/patients/${patientId}/narrative/${narrativeId}/sources`,
      ),
  },

  quarantine: {
    list: () => request<QuarantineItem[]>("/api/v1/admin/quarantine"),
    resolve: (id: string, action: "merge" | "keep_separate", reason: string) =>
      request<void>(`/api/v1/admin/quarantine/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action, reason }),
      }),
  },

  qa: {
    ask: (
      patientId: string,
      params: { question: string; language: string; conversation_id: string | null },
    ) =>
      request<QAResponse>(`/api/v1/patients/${patientId}/qa`, {
        method: "POST",
        body: JSON.stringify(params),
      }),

    get: (patientId: string, qaId: string) =>
      request<QAResponse>(`/api/v1/patients/${patientId}/qa/${qaId}`),

    list: (patientId: string, params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return request<{ data: QAInteractionSummary[]; next_cursor: string | null }>(
        `/api/v1/patients/${patientId}/qa${query ? `?${query}` : ""}`,
      );
    },

    deleteConversation: (conversationId: string) =>
      request<void>(`/api/v1/conversations/${conversationId}`, { method: "DELETE" }),
  },

  handoff: {
    generatePatient: (
      patientId: string,
      params: { scope?: string; language?: string },
    ) =>
      request<HandoffOutput>(`/api/v1/patients/${patientId}/handoff`, {
        method: "POST",
        body: JSON.stringify(params),
      }),

    generateWard: (
      wardId: string,
      params: { scope?: string; language?: string },
    ) =>
      request<WardHandoffOutput>(`/api/v1/wards/${wardId}/handoff`, {
        method: "POST",
        body: JSON.stringify(params),
      }),
  },

  admin: {
    listUsers: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return request<{ data: AdminUser[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        `/api/v1/admin/users${query ? `?${query}` : ""}`,
      );
    },

    createUser: (body: {
      external_subject: string;
      display_name: string;
      email: string;
      preferred_language?: "ar" | "en";
      roles: string[];
    }) =>
      request<{ id: string }>("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),

    updateUserRoles: (id: string, roles: string[]) =>
      request<{ message: string }>(`/api/v1/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ roles }),
      }),

    disableUser: (id: string) =>
      request<{ message: string }>(`/api/v1/admin/users/${id}`, {
        method: "DELETE",
      }),

    listAudit: (filters?: {
      actor_id?: string | undefined;
      target_type?: string | undefined;
      target_id?: string | undefined;
      action?: string | undefined;
      since?: string | undefined;
      until?: string | undefined;
      outcome?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    }) => {
      const qs = new URLSearchParams();
      if (filters?.actor_id) qs.set("actor_id", filters.actor_id);
      if (filters?.target_type) qs.set("target_type", filters.target_type);
      if (filters?.target_id) qs.set("target_id", filters.target_id);
      if (filters?.action) qs.set("action", filters.action);
      if (filters?.since) qs.set("since", filters.since);
      if (filters?.until) qs.set("until", filters.until);
      if (filters?.outcome) qs.set("outcome", filters.outcome);
      if (filters?.cursor) qs.set("cursor", filters.cursor);
      if (filters?.limit !== undefined) qs.set("limit", String(filters.limit));
      const query = qs.toString();
      return request<{ data: AuditEventItem[]; pagination: { next_cursor: string | null; has_more: boolean } }>(
        `/api/v1/admin/audit${query ? `?${query}` : ""}`,
      );
    },

    verifyAudit: () =>
      request<AuditVerifyResult>("/api/v1/admin/audit/verify", { method: "POST" }),
  },

  dsr: {
    access: (subjectId: string, reason: string) =>
      request<DsrRequest>("/api/v1/dsr/access", {
        method: "POST",
        body: JSON.stringify({ subject_id: subjectId, reason }),
      }),

    erase: (subjectId: string, reason: string) =>
      request<DsrRequest & { note: string }>("/api/v1/dsr/erase", {
        method: "POST",
        body: JSON.stringify({ subject_id: subjectId, reason }),
      }),

    getStatus: (id: string) =>
      request<DsrRequest>(`/api/v1/dsr/${id}`),
  },

  auth: {
    login: (returnTo?: string) =>
      request<{ auth_url: string }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ return_to: returnTo ?? "/" }),
      }),

    logout: () =>
      request<{ logout_url: string }>("/api/v1/auth/logout", {
        method: "POST",
      }),

    me: () =>
      request<{
        id: string;
        displayName: string;
        email: string | null;
        preferredLanguage: "ar" | "en";
        roles: string[];
      }>("/api/v1/auth/me"),

    refresh: () =>
      request<void>("/api/v1/auth/refresh", { method: "POST" }),
  },
};
