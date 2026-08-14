/**
 * ProviderAvailabilityService — staff/admin-managed recurring weekly
 * availability windows that back the AI Receptionist's slot generation
 * (AvailabilityService). See docs/architecture/ai-receptionist.md.
 * v1 trim: weekly-recurring windows only, no holiday/exception handling.
 */
import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";

export interface ProviderAvailabilityRow {
  readonly id: string;
  readonly department_display: string;
  readonly clinician_display: string | null;
  readonly clinician_gender: "male" | "female" | null;
  readonly day_of_week: number;
  readonly start_time: string;
  readonly end_time: string;
  readonly slot_duration_minutes: number;
  readonly active: boolean;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const COLS = `id, department_display, clinician_display, clinician_gender, day_of_week,
  start_time::text AS start_time, end_time::text AS end_time,
  slot_duration_minutes, active, created_by,
  created_at::text AS created_at, updated_at::text AS updated_at`;

@Injectable()
export class ProviderAvailabilityService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(): Promise<ProviderAvailabilityRow[]> {
    const res = await this.pool.query<ProviderAvailabilityRow>(
      `SELECT ${COLS} FROM app.provider_availability ORDER BY department_display, day_of_week, start_time`,
    );
    return res.rows;
  }

  async create(
    userId: string,
    departmentDisplay: string,
    clinicianDisplay: string | null,
    dayOfWeek: number,
    startTime: string,
    endTime: string,
    slotDurationMinutes: number,
    clinicianGender: "male" | "female" | null,
  ): Promise<ProviderAvailabilityRow> {
    const res = await this.pool.query<ProviderAvailabilityRow>(
      `INSERT INTO app.provider_availability
         (department_display, clinician_display, day_of_week, start_time, end_time, slot_duration_minutes, created_by, clinician_gender)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLS}`,
      [departmentDisplay, clinicianDisplay, dayOfWeek, startTime, endTime, slotDurationMinutes, userId, clinicianGender],
    );
    return res.rows[0]!;
  }

  async setActive(id: string, active: boolean): Promise<ProviderAvailabilityRow> {
    const res = await this.pool.query<ProviderAvailabilityRow>(
      `UPDATE app.provider_availability SET active = $2, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
      [id, active],
    );
    const row = res.rows[0];
    if (!row) throw new NotFoundException("Provider availability row not found");
    return row;
  }
}
