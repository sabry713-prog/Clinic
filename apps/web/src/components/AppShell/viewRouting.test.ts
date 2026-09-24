import { describe, it, expect } from "vitest";
import { resolveCurrentView, PATIENT_VIEW_DEFAULT } from "./viewRouting";

/**
 * Pins the default that once drifted: the page rendered the Journey while the sidebar lit up
 * Copilot, because two files each decided the default and disagreed. Nothing failed -- the wrong
 * row was highlighted -- so a test is the only durable guard.
 */
describe("resolveCurrentView", () => {
  it("defaults a patient page to the Journey, not the workspace", () => {
    expect(resolveCurrentView(true, null)).toBe("journey");
    expect(resolveCurrentView(true, null)).not.toBe("workspace");
  });

  it("still addresses every view explicitly", () => {
    for (const v of ["journey", "workspace", "chart", "encounter"] as const) {
      expect(resolveCurrentView(true, v)).toBe(v);
    }
  });

  it("ignores an unknown value rather than rendering a blank page", () => {
    expect(resolveCurrentView(true, "nonsense")).toBe(PATIENT_VIEW_DEFAULT);
  });

  it("is null off a patient page, so no item claims to be current", () => {
    expect(resolveCurrentView(false, "journey")).toBeNull();
  });
});
