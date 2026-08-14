import { describe, it, expect } from "vitest";
import { getSimConfig } from "./index";

describe("getSimConfig", () => {
  it("defaults every mode to stub and sim_default to true on an empty env", () => {
    const cfg = getSimConfig({});
    expect(cfg.simNphiesConnector).toBe("stub");
    expect(cfg.simHisFeed).toBe("stub");
    expect(cfg.simSmsOtp).toBe("stub");
    expect(cfg.simDefault).toBe(true);
  });

  it("reads live mode case-insensitively", () => {
    expect(getSimConfig({ SIM_NPHIES_CONNECTOR: "LIVE" }).simNphiesConnector).toBe("live");
  });

  it("falls back to stub on an unrecognised mode value rather than failing open", () => {
    expect(getSimConfig({ SIM_HIS_FEED: "sure why not" }).simHisFeed).toBe("stub");
  });

  it("parses SIM_DEFAULT=false", () => {
    expect(getSimConfig({ SIM_DEFAULT: "false" }).simDefault).toBe(false);
  });

  it("reads each key independently", () => {
    const cfg = getSimConfig({
      SIM_NPHIES_CONNECTOR: "live",
      SIM_HIS_FEED: "stub",
      SIM_SMS_OTP: "live",
    });
    expect(cfg.simNphiesConnector).toBe("live");
    expect(cfg.simHisFeed).toBe("stub");
    expect(cfg.simSmsOtp).toBe("live");
  });

  it("is a pure function -- an explicit env object never touches real process.env", () => {
    const before = process.env.SIM_DEFAULT;
    getSimConfig({ SIM_DEFAULT: "false" });
    expect(process.env.SIM_DEFAULT).toBe(before);
  });
});
