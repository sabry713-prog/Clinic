import { describe, it, expect } from "vitest";
import { resolveSoapBase } from "./CortexContext";

/**
 * The rule that regressed, tested without the provider that hid it.
 *
 * The bug: the encounter's note came from `liveSoap ?? SOAP_STAGES[...]`, so one live call returning an
 * empty note shadowed the staged demo note for the rest of the encounter. The demo form sat blank
 * while the transcript played, and the failure was only visible by watching the running app.
 */
describe("resolveSoapBase — where the note comes from", () => {
  const LIVE: Parameters<typeof resolveSoapBase>[2] = {
    subjective: "typed by the clinician",
    objective: "BP 120/80",
    assessment: "assessment from the live call",
    plan: "plan from the live call",
  };

  it("lets the staged note win in demo mode, whatever a live call returned", () => {
    // The regression, exactly: with a non-empty liveSoap the old rule returned it, so the demo showed
    // a note from a call that was not the demo.
    const base = resolveSoapBase("demo", 9, LIVE);
    expect(base).not.toBe(LIVE);
    expect(base.subjective).not.toBe(LIVE.subjective);
  });

  it("still shows the staged note in demo mode when no live call has happened", () => {
    expect(resolveSoapBase("demo", 9, null)).toBeDefined();
  });

  it("uses the live note in live mode when there is one", () => {
    expect(resolveSoapBase("live", 9, LIVE)).toBe(LIVE);
  });

  it("falls back to the staged note in live mode before any live note exists", () => {
    // An empty live note is not a note; falling back is what keeps the form from being blank.
    const base = resolveSoapBase("live", 9, null);
    expect(base).toBeDefined();
    expect(base).not.toBe(LIVE);
  });
});
