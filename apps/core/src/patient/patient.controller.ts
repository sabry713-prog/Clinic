import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  Logger,
  HttpCode,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { PatientService } from "./patient.service";
import { PatientScopeService } from "./patient-scope.service";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { PatientListQueryDto } from "./dto/patient-list-query.dto";
import { ObservationsQueryDto } from "./dto/observations-query.dto";
import { MedicationsQueryDto } from "./dto/medications-query.dto";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { Inject } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { v4 as uuidv4 } from "uuid";

function getRequestingUserId(req: Request): string {
  const uid = req.authenticatedUserId;
  if (!uid) throw new Error("No authenticatedUserId on request");
  return uid;
}

@ApiTags("patients")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("patient:read")
@Controller("patients")
export class PatientController {
  private readonly logger = new Logger(PatientController.name);

  constructor(
    private readonly patientService: PatientService,
    private readonly scopeService: PatientScopeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: "List in-scope patients with cursor pagination" })
  async list(@Req() req: Request, @Query() query: PatientListQueryDto) {
    const userId = getRequestingUserId(req);
    const requestId = (req.requestId ?? uuidv4()) as RequestId;

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "PATIENT_LIST_VIEW",
      target_type: "patient_list",
      target_id: null,
      outcome: "SUCCESS",
      metadata_json: {
        q: query.q ?? null,
        ward: query.ward ?? null,
        limit: query.limit ?? 20,
      },
      request_id: requestId,
    });

    return this.patientService.listPatients(userId, query);
  }

  @Get(":id")
  @HttpCode(200)
  @ApiOperation({ summary: "Full aggregated patient view" })
  async getPatient(@Req() req: Request, @Param("id") id: string) {
    const userId = getRequestingUserId(req);
    const requestId = (req.requestId ?? uuidv4()) as RequestId;

    const result = await this.patientService.getPatient(userId, id);

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "PATIENT_VIEW",
      target_type: "patient",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: {},
      request_id: requestId,
    });

    return result;
  }

  @Get(":id/observations")
  @HttpCode(200)
  @ApiOperation({ summary: "Patient observations with filters" })
  async listObservations(
    @Req() req: Request,
    @Param("id") id: string,
    @Query() query: ObservationsQueryDto,
  ) {
    const userId = getRequestingUserId(req);
    const requestId = (req.requestId ?? uuidv4()) as RequestId;

    const result = await this.patientService.listObservations(userId, id, query);

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "PATIENT_OBSERVATIONS_VIEW",
      target_type: "patient",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { code: query.code ?? null, category: query.category ?? null },
      request_id: requestId,
    });

    return result;
  }

  @Get(":id/medications")
  @HttpCode(200)
  @ApiOperation({ summary: "Patient medications with status filter" })
  async listMedications(
    @Req() req: Request,
    @Param("id") id: string,
    @Query() query: MedicationsQueryDto,
  ) {
    const userId = getRequestingUserId(req);
    const requestId = (req.requestId ?? uuidv4()) as RequestId;

    const result = await this.patientService.listMedications(userId, id, query);

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "PATIENT_MEDICATIONS_VIEW",
      target_type: "patient",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { status: query.status ?? null },
      request_id: requestId,
    });

    return result;
  }

  @Get(":id/conditions/:condition_id/history")
  @HttpCode(200)
  @ApiOperation({ summary: "All documented episodes of a coded condition with linked visit notes" })
  async getConditionHistory(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("condition_id") conditionId: string,
  ) {
    const userId = getRequestingUserId(req);
    const requestId = (req.requestId ?? uuidv4()) as RequestId;

    const result = await this.patientService.getConditionHistory(userId, id, conditionId);

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "PATIENT_CONDITION_HISTORY_VIEW",
      target_type: "condition",
      target_id: conditionId,
      outcome: "SUCCESS",
      metadata_json: { patient_id: id },
      request_id: requestId,
    });

    return result;
  }

  @Get(":id/documents/:doc_id")
  @HttpCode(200)
  @ApiOperation({ summary: "Full document content" })
  async getDocument(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("doc_id") docId: string,
  ) {
    const userId = getRequestingUserId(req);
    const requestId = (req.requestId ?? uuidv4()) as RequestId;

    const result = await this.patientService.getDocument(userId, id, docId);

    await writeAuditEvent(this.pool, {
      actor_id: userId as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "PATIENT_DOCUMENTS_VIEW",
      target_type: "document_reference",
      target_id: docId,
      outcome: "SUCCESS",
      metadata_json: { patient_id: id },
      request_id: requestId,
    });

    return result;
  }

  @Get(":id/encounters")
  @HttpCode(200)
  @ApiOperation({ summary: "Patient encounter list" })
  async listEncounters(@Req() req: Request, @Param("id") id: string) {
    const userId = getRequestingUserId(req);
    return this.patientService.listEncounters(userId, id);
  }
}
