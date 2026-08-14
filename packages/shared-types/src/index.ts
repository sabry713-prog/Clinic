// Branded primitive types for type-safe IDs
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type UserId = Brand<string, "UserId">;
export type PatientId = Brand<string, "PatientId">;
export type TenantId = Brand<string, "TenantId">;
export type ConversationId = Brand<string, "ConversationId">;
export type InteractionId = Brand<string, "InteractionId">;
export type AuditEventId = Brand<string, "AuditEventId">;
export type RequestId = Brand<string, "RequestId">;
export type TraceId = Brand<string, "TraceId">;

// Helper to cast to branded type (caller is responsible for validity)
export function asUserId(id: string): UserId {
  return id as UserId;
}
export function asPatientId(id: string): PatientId {
  return id as PatientId;
}
export function asTenantId(id: string): TenantId {
  return id as TenantId;
}
export function asRequestId(id: string): RequestId {
  return id as RequestId;
}

// User roles
export type UserRole =
  | "physician"
  | "pharmacist"
  | "nurse"
  | "hospital_admin"
  | "sysadmin";

// User permissions
export type Permission =
  | "patient:read"
  | "narrative:generate"
  | "qa:ask"
  | "handoff:generate"
  | "condition:write"
  | "service_request:write"
  | "refill_request:write"
  | "refill_request:fulfill"
  | "his_transmission:write"
  | "appointment:write"
  | "intake:write"
  | "reminder:send"
  | "provider_availability:manage"
  | "audit:read"
  | "user:manage";

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> =
  {
    // condition:write — physician documents a diagnosis to the problem list.
    // service_request:write — physician confirms a service request that was
    // extracted from their own documented order (AI extracts, doctor confirms;
    // AI never decides which service to order).
    // refill_request:write — request/cancel a refill for an already-active,
    // already-documented medication (administrative routing only).
    // his_transmission:write — send a clinician-confirmed order/refill to the
    // hospital's HIS for the RECEIVING system's own safety validation; Cortex.ai
    // performs no interaction/allergy/dose checking itself (CLAUDE.md §2).
    physician: ["patient:read", "narrative:generate", "qa:ask", "handoff:generate", "condition:write", "service_request:write", "refill_request:write", "his_transmission:write"],
    // refill_request:fulfill — route/fill/deny a refill request (status only,
    // never a dose/interaction decision). Separation of duties: pharmacists
    // never create their own refill requests.
    pharmacist: ["patient:read", "qa:ask", "refill_request:fulfill"],
    // appointment:write / reminder:send — schedule/manage appointments and send
    // (dummy/stub) reminders, both purely administrative. intake:write — capture
    // staff-assisted check-in intake (contact confirmation + verbatim
    // reason-for-visit text, never interpreted). No dedicated front-desk role
    // exists yet, so nurse (front-line) gets all three; hospital_admin (back-office
    // queue operations) gets appointment:write + reminder:send but not
    // intake:write, since check-in capture is a bedside/desk task.
    nurse: ["patient:read", "handoff:generate", "qa:ask", "refill_request:write", "his_transmission:write", "appointment:write", "intake:write", "reminder:send"],
    // provider_availability:manage — configure the recurring weekly slot
    // windows that back the AI Receptionist's patient self-service booking
    // (docs/architecture/ai-receptionist.md). Admin/back-office only, same
    // as user:manage/audit:read.
    hospital_admin: ["audit:read", "user:manage", "appointment:write", "reminder:send", "provider_availability:manage"],
    sysadmin: ["audit:read", "user:manage", "provider_availability:manage"],
  };

// Auth user shape returned by /api/v1/auth/me
export interface AuthUser {
  readonly id: UserId;
  readonly tenantId: TenantId;
  readonly externalSubject: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly preferredLanguage: "ar" | "en";
  readonly roles: readonly UserRole[];
  readonly permissions: readonly Permission[];
}

// Structured log shape (PHI-free)
export interface StructuredLog {
  readonly ts: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly service: string;
  readonly request_id: string | null;
  readonly trace_id: string | null;
  readonly event: string;
  readonly [key: string]: unknown;
}

// API response envelope
export interface ApiResponse<T> {
  readonly data: T;
}

export interface ApiError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly request_id: string;
  };
}

// Audit action types
export type AuditAction =
  | "HTTP_REQUEST"
  | "PATIENT_VIEW"
  | "QA_REQUEST"
  | "QA_ANSWERED"
  | "QA_REFUSED"
  | "NARRATIVE_GENERATE"
  | "HANDOFF_GENERATE"
  | "AUTH_LOGIN"
  | "AUTH_LOGOUT"
  | "AUTH_REFRESH"
  | "AUTH_ME";

// Audit outcome
export type AuditOutcome = "SUCCESS" | "FAILURE" | "REFUSED";

// Audit event (matches audit.event table)
export interface AuditEvent {
  readonly id: AuditEventId;
  readonly ts: Date;
  readonly actor_id: UserId | null;
  readonly actor_role: UserRole | null;
  // The literal union is documentation/autocomplete only — `string` absorbs
  // it, which no-redundant-type-constituents flags; keep the intent explicit.
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  readonly action: AuditAction | string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly outcome: AuditOutcome;
  readonly metadata_json: Record<string, unknown>;
  readonly request_id: RequestId | null;
  readonly hash_prev: string | null;
  readonly hash_self: string;
}

// Health check response
export interface HealthResponse {
  readonly status: "ok";
  readonly service: string;
  readonly ts: string;
  /** Deployment profile (E3): which module composition this process booted.
   * "clinical" loads the clinical agents; "claim-integrity" boots the
   * SaMD-free administrative surface without them. */
  readonly profile?: "clinical" | "claim-integrity";
  /** Whether clinical-agent modules (ai-team/ambient/narrative/qa/interpreter/
   * handoff/drafts/ai-receptionist) are loaded in this process. */
  readonly clinical_agents_loaded?: boolean;
  /** Names of the feature modules actually loaded under the active profile. */
  readonly modules?: readonly string[];
}

// Language codes
export type Language = "ar" | "en";

// Pagination
export interface PaginationParams {
  readonly page?: number;
  readonly per_page?: number;
}

export interface PaginatedResponse<T> {
  readonly data: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly per_page: number;
}

// ─── Selective simulation substrate (prototype/demo laptops) ──────────────
//
// See the block comment in .env.example above SIM_NPHIES_CONNECTOR for the
// full picture. Short version: the real LLM and real local ASR run by
// default; this only documents, in a typed way, which external-integration
// SEAMS a given environment is running in stub mode. It does not gate any
// existing real-integration code path by itself — each seam already has its
// own real toggle (NPHIES_CONNECTOR, the HIS connector's mode, etc.).
//
// Deliberately a pure function (05-coding-standards.md "side effects at the
// boundaries"): it takes the env map as a parameter rather than reading
// `process.env` internally, so it is trivially unit-testable with a plain
// object and safe to import from bundled browser code that never calls it
// with a real value. `env` defaults to `process.env` for the ergonomic
// zero-arg call from Node call sites (apps/core, the Python-adjacent
// tooling scripts) — guarded so importing this module never throws in an
// environment where the Node `process` global doesn't exist.
export interface SimulationConfig {
  readonly simNphiesConnector: "stub" | "live";
  readonly simHisFeed: "stub" | "live";
  readonly simSmsOtp: "stub" | "live";
  readonly simDefault: boolean;
}

function parseSimBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return raw.trim().toLowerCase() === "true";
}

function parseSimMode(raw: string | undefined): "stub" | "live" {
  return raw?.trim().toLowerCase() === "live" ? "live" : "stub";
}

const nodeProcessEnv: Record<string, string | undefined> =
  typeof process !== "undefined" && typeof process.env === "object" ? process.env : {};

export function getSimConfig(
  env: Record<string, string | undefined> = nodeProcessEnv,
): SimulationConfig {
  return {
    simNphiesConnector: parseSimMode(env.SIM_NPHIES_CONNECTOR),
    simHisFeed: parseSimMode(env.SIM_HIS_FEED),
    simSmsOtp: parseSimMode(env.SIM_SMS_OTP),
    simDefault: parseSimBool(env.SIM_DEFAULT, true),
  };
}
