/**
 * Guard for the AI Receptionist patient self-service booking routes.
 * Deliberately NOT RbacGuard -- a booking session is a different, much more
 * restricted principal than a staff session (no permissions, no roles, no
 * clinical-data access, scoped to exactly one patientId). Reads a distinctly
 * named cookie so it can never collide with the staff session_id cookie.
 */
import { Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PatientBookingSessionService } from "./patient-booking-session.service";

export const BOOKING_SESSION_COOKIE = "patient_booking_session";

@Injectable()
export class PatientBookingSessionGuard implements CanActivate {
  constructor(private readonly bookingSessions: PatientBookingSessionService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = req.cookies[BOOKING_SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException("No booking session");

    const patientId = this.bookingSessions.get(token);
    if (!patientId) throw new UnauthorizedException("Booking session expired or invalid");

    req.bookingSessionPatientId = patientId;
    return true;
  }
}
