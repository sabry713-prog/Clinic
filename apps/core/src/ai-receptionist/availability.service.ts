/**
 * AvailabilityService — minimal real slot/availability model for the AI
 * Receptionist patient self-service booking flow
 * (docs/architecture/ai-receptionist.md). Generates candidate slots from
 * app.provider_availability's weekly recurring windows, excludes slots
 * already occupied by a scheduled hospital.appointment, and books through a
 * database unique index (appointment_slot_uniqueness) as the real
 * race-safety guarantee -- getSlots()'s exclusion check is only a UX nicety
 * to avoid showing a stale slot, not the safety mechanism itself.
 *
 * v1 trim: all times are treated as UTC-naive local clinic time (no
 * timezone-aware scheduling). Only exact-clinician-match or department-level
 * (clinician_display IS NULL) availability rows serve slots -- no
 * multi-provider "any clinician in department" merge logic.
 */
import { Injectable, Inject, ConflictException, BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { AppointmentService, type AppointmentRow } from "../patient-engagement/appointment.service";

const UNIQUE_VIOLATION = "23505";

export interface BookingSlot {
  readonly start: string;
  readonly departmentDisplay: string;
  readonly clinicianDisplay: string | null;
}

interface AvailabilityRow {
  readonly clinician_display: string | null;
  readonly clinician_gender: "male" | "female" | null;
  readonly day_of_week: number;
  readonly start_time: string;
  readonly end_time: string;
  readonly slot_duration_minutes: number;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly appointments: AppointmentService,
  ) {}

  async getSlots(
    departmentDisplay: string,
    clinicianDisplay: string | null,
    dateFrom: string,
    dateTo: string,
    clinicianGender?: "male" | "female" | null,
  ): Promise<BookingSlot[]> {
    // S4.4 clinician-gender scheduling preference: filter availability rows
    // to the requested gender when a preference is expressed. Rows with an
    // undeclared gender are excluded under a preference — including them
    // would silently violate it; declaring the gender on the availability
    // row is the admin's explicit act.
    const avail = await this.pool.query<AvailabilityRow>(
      `SELECT clinician_display, clinician_gender, day_of_week, start_time::text AS start_time,
              end_time::text AS end_time, slot_duration_minutes
         FROM app.provider_availability
        WHERE active AND department_display = $1
          AND (($2::text IS NULL AND clinician_display IS NULL) OR clinician_display = $2)
          AND ($3::text IS NULL OR clinician_gender = $3::text)`,
      [departmentDisplay, clinicianDisplay, clinicianGender ?? null],
    );
    if (avail.rows.length === 0) return [];

    const candidates = this.generateCandidateSlots(avail.rows, dateFrom, dateTo, departmentDisplay);

    const existing = await this.pool.query<{ scheduled_at: string; clinician_display: string | null }>(
      `SELECT scheduled_at::text AS scheduled_at, clinician_display
         FROM hospital.appointment
        WHERE status = 'scheduled' AND department_display = $1
          AND scheduled_at BETWEEN $2::timestamptz AND $3::timestamptz`,
      [departmentDisplay, `${dateFrom}T00:00:00Z`, `${dateTo}T23:59:59Z`],
    );
    const taken = new Set(
      existing.rows.map((r) => `${r.clinician_display ?? ""}:${new Date(r.scheduled_at).toISOString()}`),
    );

    return candidates
      .filter((c) => !taken.has(`${c.clinicianDisplay ?? ""}:${c.start}`))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async bookSlot(
    patientId: string,
    departmentDisplay: string,
    appointmentType: string,
    clinicianDisplay: string | null,
    slotStart: string,
  ): Promise<AppointmentRow> {
    // Re-derive that slotStart actually falls on a valid generated slot
    // boundary server-side -- never trust a client-supplied time (mirrors
    // ServiceRequestService.confirmAndCreate()'s "re-derive from server
    // truth" discipline).
    const day = slotStart.slice(0, 10);
    const startIso = new Date(slotStart).toISOString();
    const validSlots = await this.getSlots(departmentDisplay, clinicianDisplay, day, day);
    const isValid = validSlots.some((s) => s.start === startIso);
    if (!isValid) {
      throw new BadRequestException({
        error: { code: "SLOT_NOT_AVAILABLE", message: "The requested time is not a valid open slot" },
      });
    }

    try {
      return await this.appointments.scheduleSelfService(
        patientId,
        startIso,
        appointmentType,
        departmentDisplay,
        clinicianDisplay,
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          error: { code: "SLOT_NO_LONGER_AVAILABLE", message: "This slot was just booked by someone else" },
        });
      }
      throw e;
    }
  }

  private generateCandidateSlots(
    rows: readonly AvailabilityRow[],
    dateFrom: string,
    dateTo: string,
    departmentDisplay: string,
  ): BookingSlot[] {
    const slots: BookingSlot[] = [];
    const from = new Date(`${dateFrom}T00:00:00Z`);
    const to = new Date(`${dateTo}T23:59:59Z`);

    for (const row of rows) {
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() !== row.day_of_week) continue;
        const dateStr = d.toISOString().slice(0, 10);
        let cursor = new Date(`${dateStr}T${row.start_time}Z`);
        const end = new Date(`${dateStr}T${row.end_time}Z`);
        while (cursor < end) {
          slots.push({
            start: cursor.toISOString(),
            departmentDisplay,
            clinicianDisplay: row.clinician_display,
          });
          cursor = new Date(cursor.getTime() + row.slot_duration_minutes * 60_000);
        }
      }
    }
    return slots;
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === UNIQUE_VIOLATION;
}
