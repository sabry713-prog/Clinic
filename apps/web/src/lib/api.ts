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

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  patients: {
    list: (params?: { cursor?: string; limit?: number; q?: string; ward?: string }) => {
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
  },

  quarantine: {
    list: () => request<QuarantineItem[]>("/api/v1/admin/quarantine"),
    resolve: (id: string, action: "merge" | "keep_separate", reason: string) =>
      request<void>(`/api/v1/admin/quarantine/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action, reason }),
      }),
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
