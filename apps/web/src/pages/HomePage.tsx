import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";

export function HomePage(): JSX.Element {
  const { t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top nav */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M12 3a9 9 0 110 18A9 9 0 0112 3z" />
            </svg>
          </div>
          <span className="font-semibold text-sm">{t("login.title")}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">{user?.displayName}</span>
          <button
            onClick={() => void logout()}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            {t("common.logout")}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-2">{t("home.title")}</h1>
        <p className="text-slate-400 mb-8">
          {t("home.welcome")}, {user?.displayName}
        </p>

        {/* Placeholder patient list card */}
        <div className="border border-dashed border-white/20 rounded-xl p-12 text-center">
          <p className="text-slate-500 text-sm">{t("home.patients_placeholder")}</p>
        </div>
      </main>
    </div>
  );
}
