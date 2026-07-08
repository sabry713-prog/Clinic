/**
 * NphiesController — claim-readiness endpoint.
 *
 * GET /patients/:id/nphies/claim-readiness
 * Deterministic administrative validation only (see ClaimReadinessService).
 */

import { Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { v4 as uuidv4 } from "uuid";
import { RbacGuard, RequirePermission } from "../rbac/rbac.guard";
import { writeAuditEvent } from "@clinical-copilot/audit";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import type { RequestId, UserId, UserRole } from "@clinical-copilot/shared-types";
import { ClaimReadinessService } from "./claim-readiness.service";
import { IcdCodingService } from "./icd-coding.service";
import { SbsCodingService } from "./sbs-coding.service";
import { LinkageService } from "./linkage.service";
import { NphiesConnectorService } from "./connector.service";

function uid(req: Request): string {
  const u = req.authenticatedUserId;
  if (!u) throw new Error("No authenticatedUserId on request");
  return u;
}

@ApiTags("nphies")
@ApiCookieAuth("session_id")
@UseGuards(RbacGuard)
@Controller()
export class NphiesController {
  constructor(
    private readonly readiness: ClaimReadinessService,
    private readonly coding: IcdCodingService,
    private readonly sbsCoding: SbsCodingService,
    private readonly linkage: LinkageService,
    private readonly connector: NphiesConnectorService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async audit(req: Request, action: string, targetId: string | null, meta: Record<string, unknown>): Promise<void> {
    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action,
      target_type: "nphies_coding",
      target_id: targetId,
      outcome: "SUCCESS",
      metadata_json: meta,
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });
  }

  @Get("patients/:id/nphies/coding")
  @RequirePermission("patient:read")
  @ApiOperation({
    summary:
      "ICD-10-AM coding status for active conditions, with deterministic reference-map suggestions",
  })
  async codingStatus(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.coding.status(uid(req), patientId);
    await this.audit(req, "NPHIES_CODING_VIEW", patientId, {
      conditions: result.conditions.length,
    });
    return result;
  }

  @Post("patients/:id/nphies/coding/:conditionId/confirm")
  @RequirePermission("condition:write")
  @ApiOperation({
    summary:
      "Clinician confirms the reference-map ICD-10-AM code for a documented condition",
  })
  async confirmCoding(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Param("conditionId") conditionId: string,
  ) {
    const result = await this.coding.confirm(uid(req), patientId, conditionId);
    await this.audit(req, "NPHIES_CODING_CONFIRM", conditionId, {
      patient_id: patientId,
      icd10am_code: result.confirmed?.icd10am_code ?? null,
    });
    return result;
  }

  @Delete("patients/:id/nphies/coding/:conditionId")
  @RequirePermission("condition:write")
  @ApiOperation({ summary: "Remove a previously confirmed ICD-10-AM code (clinician correction)" })
  async unconfirmCoding(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Param("conditionId") conditionId: string,
  ) {
    await this.coding.unconfirm(uid(req), patientId, conditionId);
    await this.audit(req, "NPHIES_CODING_UNCONFIRM", conditionId, { patient_id: patientId });
    return { ok: true };
  }

  @Get("patients/:id/nphies/order-coding")
  @RequirePermission("patient:read")
  @ApiOperation({
    summary: "SBS coding status for active orders, with deterministic reference-map suggestions",
  })
  async orderCodingStatus(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.sbsCoding.status(uid(req), patientId);
    await this.audit(req, "NPHIES_ORDER_CODING_VIEW", patientId, {
      orders: result.orders.length,
    });
    return result;
  }

  @Post("patients/:id/nphies/order-coding/:orderId/confirm")
  @RequirePermission("service_request:write")
  @ApiOperation({
    summary: "Clinician confirms the reference-map SBS code for a confirmed order",
  })
  async confirmOrderCoding(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Param("orderId") orderId: string,
  ) {
    const result = await this.sbsCoding.confirm(uid(req), patientId, orderId);
    await this.audit(req, "NPHIES_ORDER_CODING_CONFIRM", orderId, {
      patient_id: patientId,
      sbs_code: result.confirmed?.sbs_code ?? null,
    });
    return result;
  }

  @Delete("patients/:id/nphies/order-coding/:orderId")
  @RequirePermission("service_request:write")
  @ApiOperation({ summary: "Remove a previously confirmed SBS code (clinician correction)" })
  async unconfirmOrderCoding(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Param("orderId") orderId: string,
  ) {
    await this.sbsCoding.unconfirm(uid(req), patientId, orderId);
    await this.audit(req, "NPHIES_ORDER_CODING_UNCONFIRM", orderId, { patient_id: patientId });
    return { ok: true };
  }

  @Get("patients/:id/nphies/linkage")
  @RequirePermission("patient:read")
  @ApiOperation({
    summary:
      "Order→diagnosis linkage status (clinician-captured; the system does not suggest linkages)",
  })
  async linkageStatus(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.linkage.status(uid(req), patientId);
    await this.audit(req, "NPHIES_LINKAGE_VIEW", patientId, { orders: result.orders.length });
    return result;
  }

  @Post("patients/:id/nphies/linkage/:orderId/:conditionId")
  @RequirePermission("service_request:write")
  @ApiOperation({ summary: "Clinician links a confirmed order to a documented diagnosis" })
  async linkDiagnosis(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Param("orderId") orderId: string,
    @Param("conditionId") conditionId: string,
  ) {
    await this.linkage.link(uid(req), patientId, orderId, conditionId);
    await this.audit(req, "NPHIES_LINKAGE_LINK", orderId, {
      patient_id: patientId,
      condition_id: conditionId,
    });
    return { ok: true };
  }

  @Delete("patients/:id/nphies/linkage/:orderId/:conditionId")
  @RequirePermission("service_request:write")
  @ApiOperation({ summary: "Clinician removes an order→diagnosis link" })
  async unlinkDiagnosis(
    @Req() req: Request,
    @Param("id") patientId: string,
    @Param("orderId") orderId: string,
    @Param("conditionId") conditionId: string,
  ) {
    await this.linkage.unlink(uid(req), patientId, orderId, conditionId);
    await this.audit(req, "NPHIES_LINKAGE_UNLINK", orderId, {
      patient_id: patientId,
      condition_id: conditionId,
    });
    return { ok: true };
  }

  @Get("patients/:id/nphies/claim-draft")
  @RequirePermission("patient:read")
  @ApiOperation({
    summary: "Assemble the FHIR claim draft from clinician-confirmed codes and linkages",
  })
  async claimDraft(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.connector.assembleClaimDraft(uid(req), patientId);
    await this.audit(req, "NPHIES_CLAIM_DRAFT_VIEW", patientId, {
      ready: result.ready,
      blockers: result.blockers.length,
    });
    return result;
  }

  @Post("patients/:id/nphies/eligibility")
  @RequirePermission("service_request:write")
  @ApiOperation({ summary: "Run an NPHIES eligibility check (stub connector in dev)" })
  async checkEligibility(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.connector.checkEligibility(uid(req), patientId);
    await this.audit(req, "NPHIES_ELIGIBILITY_CHECK", patientId, {
      status: result.status,
      mode: result.mode,
    });
    return result;
  }

  @Post("patients/:id/nphies/claims")
  @RequirePermission("service_request:write")
  @ApiOperation({ summary: "Submit the assembled claim (stub connector in dev)" })
  async submitClaim(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.connector.submitClaim(uid(req), patientId);
    await this.audit(req, "NPHIES_CLAIM_SUBMIT", result.id, {
      patient_id: patientId,
      status: result.status,
      mode: result.mode,
      items: result.item_count,
    });
    return result;
  }

  @Get("patients/:id/nphies/claims")
  @RequirePermission("patient:read")
  @ApiOperation({ summary: "List submitted claims for a patient" })
  async listClaims(@Req() req: Request, @Param("id") patientId: string) {
    const data = await this.connector.listClaims(uid(req), patientId);
    await this.audit(req, "NPHIES_CLAIMS_VIEW", patientId, { count: data.length });
    return { data };
  }

  @Get("patients/:id/nphies/claim-readiness")
  @RequirePermission("patient:read")
  @ApiOperation({
    summary:
      "Deterministic NPHIES claim-completeness checks for a patient (administrative only)",
  })
  async claimReadiness(@Req() req: Request, @Param("id") patientId: string) {
    const result = await this.readiness.evaluate(uid(req), patientId);

    await writeAuditEvent(this.pool, {
      actor_id: uid(req) as UserId,
      actor_role: (req.authenticatedUserRole ?? null) as UserRole | null,
      action: "NPHIES_CLAIM_READINESS_VIEW",
      target_type: "patient",
      target_id: patientId,
      outcome: "SUCCESS",
      metadata_json: { overall: result.overall, checks: result.checks.length },
      request_id: (req.requestId ?? uuidv4()) as RequestId,
    });

    return result;
  }
}
