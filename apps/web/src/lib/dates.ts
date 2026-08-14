/**
 * Locale-aware date formatting (S4.4 localisation quick wins).
 *
 * Arabic renders dates in the Hijri (Umm al-Qura) calendar with Arabic-Indic
 * numerals — the calendar Saudi patients live by — while English keeps the
 * Gregorian form clinicians' paperwork uses. Pure formatting of existing
 * timestamps: no clinical content is produced or interpreted here.
 *
 * Node and modern browsers support the `islamic-umalqura` calendar natively
 * via ICU, so this needs no date library.
 */

const HIJRI_LOCALE = "ar-SA-u-ca-islamic-umalqura-nu-arab";
const GREGORIAN_EN = "en-GB";

export function isArabic(language: string | undefined | null): boolean {
  return (language ?? "").toLowerCase().startsWith("ar");
}

/** "15 Jan 2026" (en) or "٢٦ رجب ١٤٤٧ هـ" (ar, Hijri Umm al-Qura). */
export function formatDate(iso: string | null | undefined, language: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  if (isArabic(language)) {
    return new Intl.DateTimeFormat(HIJRI_LOCALE, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat(GREGORIAN_EN, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Date + time; Hijri with Arabic-Indic numerals in Arabic. */
export function formatDateTime(
  iso: string | null | undefined,
  language: string | undefined | null,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  if (isArabic(language)) {
    return new Intl.DateTimeFormat(HIJRI_LOCALE, {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(date);
  }
  return new Intl.DateTimeFormat(GREGORIAN_EN, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** Time only (24h in both locales — clinic schedules use 24h). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(GREGORIAN_EN, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date);
}

/** Slot label: weekday + date, then 24h time — e.g. "Thu, 15 Jan 2026 · 10:30"
 * (en) or "الخميس، ٢٦ رجب ١٤٤٧ هـ · ١٠:٣٠" (ar, Hijri). */
export function formatSlotLabel(
  iso: string | null | undefined,
  language: string | undefined | null,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  if (isArabic(language)) {
    const day = new Intl.DateTimeFormat(HIJRI_LOCALE, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
    const time = new Intl.DateTimeFormat("ar-SA-u-nu-arab", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(date);
    return `${day} · ${time}`;
  }
  const day = new Intl.DateTimeFormat(GREGORIAN_EN, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `${day} · ${formatTime(iso)}`;
}
