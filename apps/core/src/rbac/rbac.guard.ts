/**
 * RBAC guard that checks the authenticated user has the required permission
 * before allowing a route through.
 *
 * Usage: @UseGuards(RbacGuard) @RequirePermission('patient:read')
 */

import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { ROLE_PERMISSIONS, type Permission, type UserRole } from "@clinical-copilot/shared-types";
import { SessionService } from "../auth/session.service";

export const REQUIRE_PERMISSION_KEY = "require_permission";
export const RequirePermission = (perm: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, perm);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredPerm = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRE_PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    const req = ctx.switchToHttp().getRequest<Request>();
    const sessionId = req.cookies["session_id"] as string | undefined;

    if (!sessionId) throw new UnauthorizedException("No session");

    const session = this.sessions.get(sessionId);
    if (!session) throw new UnauthorizedException("Session expired or invalid");

    // Attach to request for downstream use
    req.authenticatedUserId = session.userId;
    req.authenticatedUserRole = session.roles[0] ?? undefined;

    // If no permission required, authentication is enough
    if (!requiredPerm) return true;

    const hasPermission = session.roles.some((role) => {
      const perms = ROLE_PERMISSIONS[role as UserRole];
      return perms?.includes(requiredPerm) ?? false;
    });

    if (!hasPermission) {
      throw new ForbiddenException(`Permission required: ${requiredPerm}`);
    }

    return true;
  }
}
