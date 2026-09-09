import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";

export function LoginPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const { login, loading, error } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  const isRtl = i18n.language === "ar";

  const handleLogin = async (): Promise<void> => {
    setRedirecting(true);
    await login("/");
    // If we reach here, login redirect didn't happen (error)
    setRedirecting(false);
  };

  const toggleLanguage = (): void => {
    const next = i18n.language === "ar" ? "en" : "ar";
    void i18n.changeLanguage(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[#F4F7FE] via-[#F6F4FE] to-white flex items-center justify-center p-4"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Language toggle */}
      <button
        onClick={toggleLanguage}
        className="absolute top-4 end-4 text-sm text-ink-soft hover:text-ink transition-colors px-3 py-1.5 rounded border border-line hover:border-line-strong"
        aria-label="Toggle language"
      >
        {t("login.language_toggle")}
      </button>

      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-[18px] bg-white border border-line shadow-card mb-4 p-3">
            <img src="/logo-icon.png" alt="" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-ink">{t("login.title")}</h1>
          <p className="text-ink-soft mt-1 text-sm">{t("login.subtitle")}</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-line rounded-[18px] p-8 shadow-card">
          <p className="text-ink-deep text-sm text-center mb-6 leading-relaxed">
            {t("login.description")}
          </p>

          {error != null && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl bg-status-rej-bg border border-status-rej-line text-status-rej text-sm text-center"
            >
              {t("login.error")}
            </div>
          )}

          <button
            onClick={() => void handleLogin()}
            disabled={loading || redirecting}
            className="w-full py-3 px-4 rounded-full bg-grad-accent hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold shadow-pill transition-all text-sm flex items-center justify-center gap-2"
            aria-busy={redirecting}
          >
            {redirecting ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                {t("login.loading")}
              </>
            ) : (
              t("login.button")
            )}
          </button>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-ink-faint mt-6">
          {isRtl ? "نظام مرخص للاستخدام من قِبل الكوادر الصحية فقط" : "Licensed for use by authorized healthcare staff only"}
        </p>
      </div>
    </div>
  );
}
