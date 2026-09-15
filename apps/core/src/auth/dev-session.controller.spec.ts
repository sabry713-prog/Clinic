/**
 * C07 (readiness assessment): the dev-session endpoint mints a fully
 * authorized session from a known subject with zero authentication. It
 * must fail closed unless DEV_SESSION_ENABLED=true is explicitly set —
 * a demo build that forgets the flag must not mint sessions silently.
 */

import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DevSessionController } from "./dev-session.controller";

function makeController(env: Record<string, string>): DevSessionController {
  const config = {
    get: (key: string): string | undefined => env[key],
  } as unknown as ConfigService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pool: any = { query: jest.fn().mockResolvedValue({ rows: [] }) };
  const sessions = { create: jest.fn().mockReturnValue("sid-1") } as never;
  return new DevSessionController(sessions, config, pool);
}

describe("DevSessionController — C07 fail-closed gating", () => {
  it("rejects when DEV_SESSION_ENABLED is not set (the default)", () => {
    const controller = makeController({ NODE_ENV: "development" });
    expect(controller.createDevSession({ external_subject: "x" }, {} as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects when the flag is set to anything but the exact string true", () => {
    const controller = makeController({ NODE_ENV: "development", DEV_SESSION_ENABLED: "yes" });
    expect(controller.createDevSession({ external_subject: "x" }, {} as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("rejects in production even when the flag is set", () => {
    const controller = makeController({ NODE_ENV: "production", DEV_SESSION_ENABLED: "true" });
    expect(controller.createDevSession({ external_subject: "x" }, {} as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("proceeds to the lookup only when explicitly enabled outside production", () => {
    const controller = makeController({ NODE_ENV: "development", DEV_SESSION_ENABLED: "true" });
    // The user lookup will run and fail (mocked pool returns nothing) —
    // but the gate must NOT have thrown the disabled-exception.
    expect(controller.createDevSession({ external_subject: "x" }, {} as never)).rejects.toThrow(
      "Dev user not found",
    );
  });
});
