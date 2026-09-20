import { Controller, Get, Put, Param, Query, Body, Req, UseGuards, Inject, HttpCode } from "@nestjs/common";
import type { Request } from "express";
import { ApiTags, ApiOperation, ApiCookieAuth } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional } from "class-validator";
import type { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { DocumentationService, type DocumentationSource } from "./documentation.service";

class SetDocumentationDto {
  @IsIn(["ambient", "manual"])
  source!: DocumentationSource;

  @IsOptional()
  @IsBoolean()
  recording_declined?: boolean;
}

function uid(req: Request): string {
  const id = req.authenticatedUserId;
  if (!id) throw new Error("No authenticatedUserId");
  return id;
}

@ApiTags("documentation")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
// The physician documenting the encounter is the one who knows how it was captured.
@RequirePermission("condition:write")
@Controller()
export class DocumentationController {
  constructor(
    private readonly documentation: DocumentationService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Get("patients/:id/documentation")
  @ApiOperation({ summary: "How this encounter's note was captured (ambient capture or written)" })
  async get(@Req() req: Request, @Param("id") id: string, @Query("encounter_id") encounterId: string) {
    return { data: await this.documentation.get(uid(req), id, (encounterId ?? "").toString()) };
  }

  @Put("patients/:id/documentation")
  @HttpCode(200)
  @ApiOperation({ summary: "Record how the note was captured, and a refusal to be recorded" })
  async set(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("encounter_id") encounterId: string,
    @Body() body: SetDocumentationDto,
  ) {
    const out = await this.documentation.set(
      uid(req),
      id,
      (encounterId ?? "").toString(),
      body.source,
      body.recording_declined ?? false,
    );
    // Provenance, not clinical content: which mechanism, and whether the patient declined.
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "ENCOUNTER_DOCUMENTATION_SET",
      target_type: "patient",
      target_id: id,
      outcome: "SUCCESS",
      metadata_json: { source: out.source, recording_declined: out.recording_declined },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
    return out;
  }
}
