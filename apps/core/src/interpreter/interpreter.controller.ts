/**
 * InterpreterController
 *
 * Exposes:
 *   POST /api/v1/patients/:id/interpreter/translate
 *
 * Constraints:
 * - Checks patient scope before calling the interpreter service
 * - Writes INTERPRETER_TRANSLATION_GENERATED audit event
 * - No PHI in operational logs
 * - No interpretation language in error messages
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
import { IsString, MaxLength } from "class-validator";
import { InterpreterService } from "./interpreter.service";
import { PatientScopeService } from "../patient/patient-scope.service";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";

class TranslateMessageDto {
  @IsString()
  @MaxLength(2000)
  text!: string;

  @IsString()
  @MaxLength(20)
  source_language!: string;

  @IsString()
  @MaxLength(20)
  target_language!: string;
}

function getRequestingUserId(req: Request): string {
  const uid = req.authenticatedUserId;
  if (!uid) throw new Error("No authenticatedUserId on request");
  return uid;
}

@ApiTags("interpreter")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("narrative:generate")
@Controller("patients/:id/interpreter")
export class InterpreterController {
  private readonly logger = new Logger(InterpreterController.name);

  constructor(
    private readonly interpreterService: InterpreterService,
    private readonly scopeService: PatientScopeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("translate")
  @HttpCode(200)
  @ApiOperation({ summary: "Translate an ad-hoc clinician<->patient communication message" })
  async translate(
    @Param("id") patientId: string,
    @Body() body: TranslateMessageDto,
    @Req() req: Request,
  ): Promise<object> {
    const userId = getRequestingUserId(req);
    await this.scopeService.assertPatientInScope(userId, patientId);

    const result = await this.interpreterService.translate(
      body.text,
      body.source_language,
      body.target_language,
    );

    // Audit event (message text not in audit event body -- PHI-adjacent)
    await writeAuditEvent(this.pool, {
      actor_id: userId as import("@clinical-copilot/shared-types").UserId,
      actor_role: null,
      action: "INTERPRETER_TRANSLATION_GENERATED",
      target_type: "patient",
      target_id: patientId as import("@clinical-copilot/shared-types").PatientId,
      outcome: "SUCCESS",
      metadata_json: {
        source_language: body.source_language,
        target_language: body.target_language,
        prompt_template_version: result.prompt_template_version,
        fallback: result.text === null,
      },
      request_id: (req.headers["x-request-id"] as string | undefined ?? null) as import("@clinical-copilot/shared-types").RequestId | null,
    });

    return result;
  }
}
