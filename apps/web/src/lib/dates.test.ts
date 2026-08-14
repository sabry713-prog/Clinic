/**
 * dates.ts — locale-aware formatting tests (S4.4). The Arabic assertions pin
 * the Hijri Umm al-Qura rendering with Arabic-Indic numerals, so a Node/ICU
 * regression that silently falls back to Gregorian fails loudly here.
 */

import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatTime, isArabic } from "./dates";

// 2026-01-15 = 26 Rajab 1447 AH (Umm al-Qura).
const ISO = "2026-01-15T10:30:00Z";

describe("dates", () => {
  it("formats Gregorian short dates for English", () => {
    expect(formatDate(ISO, "en")).toBe("15 Jan 2026");
  });

  it("formats Hijri (Umm al-Qura, Arabic-Indic numerals) for Arabic", () => {
    const formatted = formatDate(ISO, "ar");
    expect(formatted).toContain("رجب");
    expect(formatted).toContain("١٤٤٧");
    expect(formatted).toContain("هـ"); // Hijri marker
    expect(formatted).not.toContain("Jan"); // never Gregorian in Arabic
  });

  it("treats regional Arabic tags as Arabic", () => {
    expect(isArabic("ar-SA")).toBe(true);
    expect(isArabic("ar")).toBe(true);
    expect(isArabic("en")).toBe(false);
    expect(isArabic(undefined)).toBe(false);
    expect(formatDate(ISO, "ar-SA-u-nu-latn")).toContain("رجب");
  });

  it("formats date+time per locale", () => {
    expect(formatDateTime(ISO, "en")).toBe("15 Jan 2026, 10:30");
    const ar = formatDateTime(ISO, "ar");
    expect(ar).toContain("١٤٤٧");
    expect(ar).toContain(":"); // a time is present
  });

  it("renders time-only in 24h regardless of locale", () => {
    expect(formatTime(ISO)).toBe("10:30");
  });

  it("passes through null and unparseable values unchanged", () => {
    expect(formatDate(null, "ar")).toBe("—");
    expect(formatDate("not-a-date", "en")).toBe("not-a-date");
    expect(formatTime(undefined)).toBe("—");
  });
});
