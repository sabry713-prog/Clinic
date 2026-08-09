/**
 * Express Request augmentation — adds authenticated user properties
 * set by RBAC guard and auth controller.
 */
declare namespace Express {
  interface Request {
    authenticatedUserId?: string;
    authenticatedUserRole?: string;
    /**
     * Set by PatientBookingSessionGuard for the AI Receptionist patient
     * self-service flow (docs/architecture/ai-receptionist.md). Deliberately
     * separate from authenticatedUserId -- a patient booking session is a
     * different, much more restricted principal than a staff session and
     * must never be confused with one.
     */
    bookingSessionPatientId?: string;
  }
}
