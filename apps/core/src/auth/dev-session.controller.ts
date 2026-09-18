/**
 * Dev-only endpoint to create a session without OIDC flow.
 * Disabled in production environments.
 * Used by E2E tests.
 */

import {
  Controller,
  Post,
  Body,
  Res,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { SessionService } from "./session.service";
import { Inject } from "@nestjs/common";
import { PG_POOL } from "../database/database.module";
import type { Pool } from "pg";
import { IsString } from "class-validator";

class DevSessionDto {
  @IsString()
  external_subject!: string;
}

@Controller("dev")
export class DevSessionController {
  private readonly logger = new Logger(DevSessionController.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post("session")
  async createDevSession(
    @Body() body: DevSessionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ session_id: string }> {
    // C07 (readiness assessment): this endpoint mints a fully-authorized
    // session from a known subject with zero authentication. It now
    // requires an explicit opt-in flag (DEV_SESSION_ENABLED=true) in
    // addition to not being production — a demo build that forgets to
    // set the flag fails closed instead of minting sessions silently.
    const env = this.config.get<string>("NODE_ENV") ?? "development";
    const explicitlyEnabled = this.config.get<string>("DEV_SESSION_ENABLED") === "true";
    if (env === "production" || !explicitlyEnabled) {
      throw new ForbiddenException("Dev session endpoint disabled (set DEV_SESSION_ENABLED=true in development)");
    }

    // Look up the user by external_subject
    const userResult = await this.pool.query<{
      id: string;
      display_name: string;
      preferred_language: string;
    }>(
      `SELECT id, display_name, preferred_language
       FROM app."user"
       WHERE external_subject = $1 AND tenant_id = '00000000-0000-0000-0000-000000000001'
       LIMIT 1`,
      [body.external_subject],
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new ForbiddenException(`Dev user not found: ${body.external_subject}`);
    }

    const rolesResult = await this.pool.query<{ role: string }>(
      `SELECT role FROM app.user_role WHERE user_id = $1`,
      [user.id],
    );

    const sessionId = await this.sessions.create({
      userId: user.id,
      tenantId: "00000000-0000-0000-0000-000000000001",
      externalSubject: body.external_subject,
      displayName: user.display_name,
      email: null,
      preferredLanguage: (user.preferred_language as "ar" | "en") ?? "ar",
      roles: rolesResult.rows.map((r) => r.role),
      accessToken: "dev-token",
      refreshToken: null,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
    });

    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000,
    });

    this.logger.log({
      event: "dev_session_created",
      external_subject: body.external_subject,
      user_id: user.id,
    });

    return { session_id: sessionId };
  }
}
