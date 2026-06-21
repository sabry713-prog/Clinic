import {
  Controller, Get, Post, Patch, Param, Body, Req, UseGuards, HttpCode, Inject,
} from "@nestjs/common";
import type { Request } from "express";
import { ApiTags, ApiCookieAuth, ApiOperation } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { IsString, IsOptional, IsIn } from "class-validator";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { UserId, UserRole, RequestId } from "@clinical-copilot/shared-types";
import { DraftService, type DocumentType } from "./draft.service";

const DOC_TYPES = ["discharge_summary", "referral_letter", "transfer_note", "visit_summary"];

class CreateDraftDto {
  @IsString()
  @IsIn(DOC_TYPES)
  document_type!: DocumentType;

  @IsOptional()
  @IsString()
  language?: string;
}

class TranscribeDto {
  @IsString()
  audio_base64!: string;

  @IsOptional()
  @IsString()
  language?: string;
}

class ReformatDto {
  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  language?: string;
}

class UpdateDraftDto {
  @IsString()
  edited_text!: string;
}

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("drafts")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@RequirePermission("narrative:generate")
@Controller()
export class DraftController {
  constructor(
    private readonly drafts: DraftService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async audit(req: Request, action: string, targetId: string, meta: Record<string, unknown>): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "document_draft",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Post("patients/:id/drafts")
  @HttpCode(201)
  @ApiOperation({ summary: "Generate a grounded document draft (unsigned)" })
  async create(@Req() req: Request, @Param("id") id: string, @Body() body: CreateDraftDto) {
    const draft = await this.drafts.generate(uid(req), id, body.document_type, body.language ?? "en");
    await this.audit(req, "DRAFT_GENERATED", draft.id, { document_type: draft.document_type, patient_id: id });
    return draft;
  }

  @Post("patients/:id/transcribe")
  @HttpCode(200)
  @ApiOperation({ summary: "Transcribe dictation (on-prem STT; transcribe + light reformat only)" })
  async transcribe(@Req() req: Request, @Param("id") id: string, @Body() body: TranscribeDto) {
    const out = await this.drafts.transcribe(uid(req), id, body.audio_base64, body.language ?? "en");
    // PHI: audit metadata only — never the audio or transcript content.
    await this.audit(req, "DICTATION_TRANSCRIBED", id, { engine: out.engine, chars: out.text.length });
    return out;
  }

  @Post("patients/:id/reformat")
  @HttpCode(200)
  @ApiOperation({ summary: "Faithfully polish clinician-typed text (on-prem; no new content)" })
  async reformat(@Req() req: Request, @Param("id") id: string, @Body() body: ReformatDto) {
    const out = await this.drafts.reformat(uid(req), id, body.text, body.language ?? "en");
    await this.audit(req, "DOCUMENT_REFORMATTED", id, { reformat: out.reformat, chars: out.text.length });
    return out;
  }

  @Get("drafts/:draftId")
  @ApiOperation({ summary: "Get a draft" })
  async get(@Req() req: Request, @Param("draftId") draftId: string) {
    return this.drafts.get(uid(req), draftId);
  }

  @Patch("drafts/:draftId")
  @ApiOperation({ summary: "Edit a draft (clinician-authored)" })
  async update(@Req() req: Request, @Param("draftId") draftId: string, @Body() body: UpdateDraftDto) {
    const draft = await this.drafts.update(uid(req), draftId, body.edited_text);
    await this.audit(req, "DRAFT_EDITED", draftId, {});
    return draft;
  }

  @Post("drafts/:draftId/sign")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign a draft (explicit, audited)" })
  async sign(@Req() req: Request, @Param("draftId") draftId: string) {
    const draft = await this.drafts.sign(uid(req), draftId);
    await this.audit(req, "DRAFT_SIGNED", draftId, {});
    return draft;
  }

  @Get("drafts/:draftId/export")
  @ApiOperation({ summary: "Export a signed draft (unsigned drafts are denied)" })
  async export(@Req() req: Request, @Param("draftId") draftId: string) {
    const out = await this.drafts.export(uid(req), draftId);
    await this.audit(req, "DRAFT_EXPORTED", draftId, {});
    return out;
  }
}
