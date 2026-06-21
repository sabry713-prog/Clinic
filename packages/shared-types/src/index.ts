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
  | "audit:read"
  | "user:manage";

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> =
  {
    // condition:write — physician documents a diagnosis to the problem list
    // (doctor authors + confirms the coded term; AI never decides).
    physician: ["patient:read", "narrative:generate", "qa:ask", "handoff:generate", "condition:write"],
    pharmacist: ["patient:read", "qa:ask"],
    nurse: ["patient:read", "handoff:generate", "qa:ask"],
    hospital_admin: ["audit:read", "user:manage"],
    sysadmin: ["audit:read", "user:manage"],
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
