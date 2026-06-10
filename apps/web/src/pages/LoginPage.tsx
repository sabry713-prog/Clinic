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
      className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4"
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Language toggle */}
      <button
        onClick={toggleLanguage}
        className="absolute top-4 end-4 text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
        aria-label="Toggle language"
      >
        {t("login.language_toggle")}
      </button>

      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            {/* Medical cross icon */}
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-3-3v6M12 3a9 9 0 110 18A9 9 0 0112 3z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">{t("login.title")}</h1>
          <p className="text-blue-300 mt-1 text-sm">{t("login.subtitle")}</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl">
          <p className="text-slate-300 text-sm text-center mb-6 leading-relaxed">
            {t("login.description")}
          </p>

          {error != null && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm text-center"
            >
              {t("login.error")}
            </div>
          )}

          <button
            onClick={() => void handleLogin()}
            disabled={loading || redirecting}
            className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors text-sm flex items-center justify-center gap-2"
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
        <p className="text-center text-xs text-slate-600 mt-6">
          {isRtl ? "نظام مرخص للاستخدام من قِبل الكوادر الصحية فقط" : "Licensed for use by authorized healthcare staff only"}
        </p>
      </div>
    </div>
  );
}
