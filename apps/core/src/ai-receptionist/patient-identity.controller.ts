/**
 * PatientIdentityController — public phone+OTP verification endpoints for
 * the AI Receptionist self-service flow (docs/architecture/ai-receptionist.md).
 * Deliberately NOT guarded by RbacGuard or PatientBookingSessionGuard --
 * these are the entry points that establish identity in the first place.
 */
import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsString, Length, Matches } from "class-validator";
import { v4 as uuidv4 } from "uuid";
import type { Pool } from "pg";
import { PG_POOL } from "../database/database.module";
import { writeAuditEvent } from "@clinical-copilot/audit";
import type { RequestId } from "@clinical-copilot/shared-types";
import { PatientOtpService } from "./patient-otp.service";
import { checkOtpRequestRateLimit, checkOtpVerifyRateLimit } from "./otp-rate-limit";
import { BOOKING_SESSION_COOKIE } from "./patient-booking-session.guard";

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

class RequestOtpDto {
  @IsString()
  @Matches(PHONE_RE, { message: "Invalid phone number" })
  phone!: string;
}

class VerifyOtpDto {
  @IsString()
  @Matches(PHONE_RE, { message: "Invalid phone number" })
  phone!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

function clientIp(req: Request): string {
  return req.ip ?? "unknown";
}

function rateLimited(): never {
  throw new HttpException(
    { error: { code: "RATE_LIMITED", message: "Too many requests, try again later" } },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@ApiTags("ai-receptionist")
@Controller("booking/otp")
export class PatientIdentityController {
  constructor(
    private readonly otpSvc: PatientOtpService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("request")
  @HttpCode(204)
  @ApiOperation({ summary: "Request a one-time verification code (dummy/stub delivery, no real SMS provider)" })
  async request(@Req() req: Request, @Body() body: RequestOtpDto): Promise<void> {
    if (!checkOtpRequestRateLimit(body.phone, clientIp(req))) rateLimited();

    const patientId = await this.otpSvc.requestOtp(body.phone);
    // Audited only on a real match -- an unmatched phone gets no DB/audit
    // row at all, consistent with the anti-enumeration posture (the HTTP
    // response above is identical either way).
    if (patientId) {
      await writeAuditEvent(this.pool, {
        actor_id: null,
        actor_role: null,
        action: "PATIENT_SELF_SERVICE_OTP_REQUESTED",
        target_type: "patient",
        target_id: patientId,
        outcome: "SUCCESS",
        metadata_json: { patient_id: patientId },
        request_id: (req.requestId ?? uuidv4()) as RequestId,
      });
    }
  }

  @Post("verify")
  @ApiOperation({ summary: "Verify a one-time code and start a patient booking session" })
  async verify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: VerifyOtpDto,
  ): Promise<{ verified: true }> {
    if (!checkOtpVerifyRateLimit(body.phone)) rateLimited();

    try {
      const { sessionToken, patientId } = await this.otpSvc.verifyOtp(body.phone, body.code);
      res.cookie(BOOKING_SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        secure: process.env["NODE_ENV"] === "production",
        sameSite: "lax",
        maxAge: 25 * 60 * 1000,
      });
      await writeAuditEvent(this.pool, {
        actor_id: null,
        actor_role: null,
        action: "PATIENT_SELF_SERVICE_OTP_VERIFIED",
        target_type: "patient",
        target_id: patientId,
        outcome: "SUCCESS",
        metadata_json: { patient_id: patientId },
        request_id: (req.requestId ?? uuidv4()) as RequestId,
      });
      return { verified: true };
    } catch (e) {
      await writeAuditEvent(this.pool, {
        actor_id: null,
        actor_role: null,
        action: "PATIENT_SELF_SERVICE_OTP_VERIFY_FAILED",
        target_type: "patient",
        target_id: null,
        outcome: "REFUSED",
        metadata_json: {},
        request_id: (req.requestId ?? uuidv4()) as RequestId,
      });
      throw e;
    }
  }
}
