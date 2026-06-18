import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import ar from "./ar.json";
import en from "./en.json";

/**
 * Keep the document's lang/dir in sync with the active language, app-wide.
 * index.html ships lang="ar"/dir="rtl"; without this, an English-detected or
 * English-switched session would still render RTL. Centralising it here means
 * every language change (boot, detector, or toggle) flips direction correctly.
 */
function applyDocumentDir(lng: string | undefined): void {
  if (typeof document === "undefined") return;
  const lang = (lng ?? "ar").toLowerCase().startsWith("ar") ? "ar" : "en";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ar: { translation: ar },
      en: { translation: en },
    },
    fallbackLng: "ar",
    supportedLngs: ["ar", "en"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  })
  .then(() => applyDocumentDir(i18n.language))
  .catch(() => { /* i18n init failure is non-fatal for direction */ });

i18n.on("languageChanged", applyDocumentDir);

export default i18n;
