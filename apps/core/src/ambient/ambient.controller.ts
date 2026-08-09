/**
 * AmbientController
 *
 * Exposes:
 *   POST /api/v1/patients/:id/ambient/segment
 *
 * Constraints:
 * - Checks patient scope before calling the segmentation service
 * - Writes AMBIENT_TRANSCRIPT_SEGMENTED audit event
 * - No transcript text (PHI-adjacent) in operational logs or audit metadata
 */

import {
  Controller,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  Logger,
  Inject,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiOperation, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import { IsString, IsArray, MaxLength, ValidateNested, ArrayMaxSize } from "class-validator";
import { Type } from "class-transformer";
import { AmbientService } from "./ambient.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";

class SectionSpecDto {
  @IsString()
  @MaxLength(50)
  key!: string;

  @IsString()
  @MaxLength(100)
  title!: string;
}

class SegmentTranscriptDto {
  @IsString()
  @MaxLength(20000)
  text!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SectionSpecDto)
  sections!: SectionSpecDto[];

  @IsString()
  @MaxLength(20)
  language!: string;
}

class CondenseSectionDto {
  @IsString()
  @MaxLength(50)
  sectionKey!: string;

  @IsString()
  @MaxLength(5000)
  text!: string;

  @IsString()
  @MaxLength(20)
  language!: string;
}

class ExtractTermsDto {
  @IsString()
  @MaxLength(20000)
  text!: string;

  @IsString()
  @MaxLength(20)
  language!: string;
}

function getRequestingUserId(req: Request): string {
  const uid = req.authenticatedUserId;
  if (!uid) throw new Error("No authenticatedUserId on request");
  return uid;
}

@ApiTags("ambient")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("narrative:generate")
@Controller("patients/:id/ambient")
export class AmbientController {
  private readonly logger = new Logger(AmbientController.name);

  constructor(
    private readonly ambientService: AmbientService,
    private readonly scopeService: PatientScopeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("segment")
  @HttpCode(200)
  @ApiOperation({ summary: "Classify an ambient-capture transcript into note sections (verbatim-only)" })
  async segment(
    @Param("id") patientId: string,
    @Body() body: SegmentTranscriptDto,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.ambientService.segment(body.text, body.sections, body.language);

    // Audit event (transcript text not in audit event body -- PHI-adjacent)
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AMBIENT_TRANSCRIPT_SEGMENTED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {
        section_keys: result.sections.map((s) => s.key),
        has_unclassified: result.unclassified_text.length > 0,
        retries: result.retries,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }

  @Post("condense")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Lightly condense a non-judgment note section (chief_complaint/history only -- gated by blocklist + " +
      "word-containment, pending sign-off, see docs/prompts/ambient-condensation-prompt.md)",
  })
  async condense(
    @Param("id") patientId: string,
    @Body() body: CondenseSectionDto,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.ambientService.condense(body.sectionKey, body.text, body.language);

    // Audit event (section text not in audit event body -- PHI-adjacent)
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AMBIENT_SECTION_CONDENSED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {
        section_key: body.sectionKey,
        condensed: result.condensed,
        retries: result.retries,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }

  @Post("extract-terms")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Point out medical terminology already present in a dictation transcript -- reference-only, " +
      "never submitted into a draft (pending sign-off, see docs/prompts/ambient-term-extraction-prompt.md)",
  })
  async extractTerms(
    @Param("id") patientId: string,
    @Body() body: ExtractTermsDto,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.ambientService.extractTerms(body.text, body.language);

    // Audit event (transcript text and extracted terms not in audit event body -- PHI-adjacent)
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "AMBIENT_TERMS_EXTRACTED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {
        term_count: result.terms.length,
        retries: result.retries,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }
}
