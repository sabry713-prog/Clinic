import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  Body,
  HttpCode,
  UnauthorizedException,
  Logger,
} from "@nestjs/common";
import { ApiOperation, ApiTags, ApiCookieAuth } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { IsOptional, IsString } from "class-validator";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";

class LoginDto {
  @IsOptional()
  @IsString()
  return_to?: string;
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  @Post("login")
  @ApiOperation({ summary: "Initiate OIDC login -- returns auth_url" })
  async login(@Body() body: LoginDto): Promise<{ auth_url: string }> {
    const returnTo = body.return_to ?? "/";
    const auth_url = await this.authService.buildAuthUrl(returnTo);
    return { auth_url };
  }

  @Get("callback")
  @ApiOperation({ summary: "OIDC callback -- sets session cookie and redirects" })
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      throw new UnauthorizedException("Missing code or state");
    }

    // Reconstruct current URL for openid-client callback validation
    const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
    const host = req.headers["host"] ?? "localhost:4000";
    const currentUrl = `${protocol}://${host}${req.originalUrl}`;

    const { sessionId, returnTo } = await this.authService.handleCallback(
      code,
      state,
      currentUrl,
    );

    res.cookie("session_id", sessionId, {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });

    const webUrl = process.env["WEB_URL"] ?? process.env["VITE_API_BASE_URL"] ?? "http://localhost:3000";
    res.redirect(302, `${webUrl}${returnTo}`);
  }

  @Post("logout")
  @ApiCookieAuth("session_id")
  @ApiOperation({ summary: "Logout -- invalidates session and returns IdP logout URL" })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ logout_url: string }> {
    const sessionId = req.cookies["session_id"] as string | undefined;
    const logout_url = await this.authService.buildLogoutUrl(sessionId ?? "");
    res.clearCookie("session_id");
    return { logout_url };
  }

  @Get("me")
  @ApiCookieAuth("session_id")
  @ApiOperation({ summary: "Return current authenticated user" })
  me(@Req() req: Request): unknown {
    const sessionId = req.cookies["session_id"] as string | undefined;
    if (!sessionId) throw new UnauthorizedException("No session");

    const session = this.sessionService.get(sessionId);
    if (!session) throw new UnauthorizedException("Session expired or invalid");

    // Attach to request for audit middleware
    req.authenticatedUserId = session.userId;
    if (session.roles[0] !== undefined) req.authenticatedUserRole = session.roles[0];

    return this.sessionService.toAuthUser(session);
  }

  @Post("refresh")
  @HttpCode(204)
  @ApiCookieAuth("session_id")
  @ApiOperation({ summary: "Refresh session -- 204 No Content" })
  refresh(@Req() req: Request): void {
    const sessionId = req.cookies["session_id"] as string | undefined;
    if (!sessionId) throw new UnauthorizedException("No session");
    const session = this.sessionService.get(sessionId);
    if (!session) throw new UnauthorizedException("Session expired");
    // Token refresh implementation in Slice 1 (needs DB-backed sessions)
  }
}
