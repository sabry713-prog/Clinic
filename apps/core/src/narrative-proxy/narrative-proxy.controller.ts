/**
 * NarrativeProxyController
 *
 * Exposes:
 *   POST /api/v1/patients/:id/narrative
 *   GET  /api/v1/patients/:id/narrative/:narrative_id
 *   GET  /api/v1/patients/:id/narrative/:narrative_id/sources
 *
 * Constraints:
 * - Checks patient scope before calling narrative service
 * - Writes NARRATIVE_GENERATED audit event
 * - No PHI in operational logs
 * - No interpretation language in error messages
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  NotFoundException,
  Logger,
  Inject,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { IsString, IsOptional, IsBoolean } from "class-validator";
import { NarrativeProxyService } from "./narrative-proxy.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";

class GenerateNarrativeDto {
  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;
}

function getRequestingUserId(req: Request): string {
  const uid = req.authenticatedUserId;
  if (!uid) throw new Error("No authenticatedUserId on request");
  return uid;
}

@ApiTags("narrative")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("narrative:generate")
@Controller("patients/:id/narrative")
export class NarrativeProxyController {
  private readonly logger = new Logger(NarrativeProxyController.name);

  constructor(
    private readonly narrativeService: NarrativeProxyService,
    private readonly scopeService: PatientScopeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: "Generate a factual narrative summary for a patient" })
  async generate(
    @Param("id") patientId: string,
    @Body() body: GenerateNarrativeDto,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);

    // Scope check
    await this.scopeService.assertPatientInScope(userId, patientId);

    const language = body.language ?? "en";
    const scope = body.scope ?? "full";
    const forceRegenerate = body.regenerate ?? false;

    const narrative = await this.narrativeService.generate({
      patientId,
      userId,
      language,
      scope,
      forceRegenerate,
    });

    // Audit event (no narrative text in audit event body -- PHI-adjacent)
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "NARRATIVE_GENERATED",
      target_type: "narrative_output",
      target_id: narrative.id,
      outcome: "SUCCESS",
      metadata_json: {
        patient_id: patientId,
        language,
        scope,
        model_version: narrative.model_version,
        prompt_template_version: narrative.prompt_template_version,
        fallback: narrative.text === null,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return narrative;
  }

  @Get(":narrative_id")
  @HttpCode(200)
  @ApiOperation({ summary: "Get a previously generated narrative by ID" })
  async getById(
    @Param("id") patientId: string,
    @Param("narrative_id") narrativeId: string,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const narrative = await this.narrativeService.getById(patientId, narrativeId);
    if (!narrative) {
      throw new NotFoundException({
        error: {
          code: "NARRATIVE_NOT_FOUND",
          message: "Narrative not found",
        },
      });
    }

    return narrative;
  }

  @Post(":narrative_id/patient-recap")
  @HttpCode(200)
  @ApiOperation({ summary: "Restyle an existing narrative into patient-friendly plain language" })
  async patientRecap(
    @Param("id") patientId: string,
    @Param("narrative_id") narrativeId: string,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const recap = await this.narrativeService.patientRecap(patientId, narrativeId);
    if (!recap) {
      throw new NotFoundException({
        error: { code: "NARRATIVE_NOT_FOUND", message: "Narrative not found or has no text to restyle" },
      });
    }

    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "NARRATIVE_PATIENT_RECAP_GENERATED",
      target_type: "narrative_output",
      target_id: narrativeId,
      outcome: "SUCCESS",
      metadata_json: {
        patient_id: patientId,
        prompt_template_version: recap.prompt_template_version,
        fallback: recap.text === null,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return recap;
  }

  @Get(":narrative_id/sources")
  @HttpCode(200)
  @ApiOperation({ summary: "Get source records referenced by a narrative" })
  async getSources(
    @Param("id") patientId: string,
    @Param("narrative_id") narrativeId: string,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const sources = await this.narrativeService.getSources(patientId, narrativeId);
    return { sources };
  }
}
