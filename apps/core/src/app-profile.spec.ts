/**
 * Unit tests for the E3 deployment-profile switch (app-profile.ts): parsing,
 * and the module composition each profile reports.
 */
import {
  APP_PROFILE_ENV,
  CLINICAL_AGENT_MODULE_NAMES,
  activeModuleNames,
  appProfile,
  clinicalAgentsLoaded,
  parseAppProfile,
} from "./app-profile";

describe("app-profile", () => {
  const ORIGINAL = process.env[APP_PROFILE_ENV];

  afterEach(() => {
    if (ORIGINAL === undefined) void Reflect.deleteProperty(process.env, APP_PROFILE_ENV);
    else process.env[APP_PROFILE_ENV] = ORIGINAL;
  });

  describe("parseAppProfile", () => {
    it("defaults to clinical when unset", () => {
      void Reflect.deleteProperty(process.env, APP_PROFILE_ENV);
      expect(parseAppProfile(process.env[APP_PROFILE_ENV])).toBe("clinical");
    });

    it("recognises claim-integrity", () => {
      expect(parseAppProfile("claim-integrity")).toBe("claim-integrity");
    });

    it("falls back to clinical on an unrecognised value (fail-safe, never a half-profile)", () => {
      expect(parseAppProfile("claimintegrity")).toBe("clinical");
      expect(parseAppProfile("CLAIM-INTEGRITY")).toBe("clinical");
      expect(parseAppProfile("")).toBe("clinical");
    });
  });

  describe("module composition", () => {
    it("clinical profile loads the clinical agents", () => {
      process.env[APP_PROFILE_ENV] = "clinical";
      const names = activeModuleNames();
      for (const agent of CLINICAL_AGENT_MODULE_NAMES) expect(names).toContain(agent);
      expect(clinicalAgentsLoaded()).toBe(true);
    });

    it("claim-integrity profile loads NO clinical agents but keeps the claim surface", () => {
      process.env[APP_PROFILE_ENV] = "claim-integrity";
      const names = activeModuleNames();
      for (const agent of CLINICAL_AGENT_MODULE_NAMES) expect(names).not.toContain(agent);
      // The claim-integrity product surface is present...
      expect(names).toContain("NphiesModule");
      expect(names).toContain("ClaimIntegrityModule");
      expect(names).toContain("AdminModule");
      // ...and the platform modules it stands on.
      expect(names).toContain("DatabaseModule");
      expect(names).toContain("AuthModule");
      expect(clinicalAgentsLoaded()).toBe(false);
      expect(appProfile()).toBe("claim-integrity");
    });
  });
});
