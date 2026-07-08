/**
 * AppShell — persistent icon sidebar + content outlet for authenticated pages.
 *
 * Pure navigation chrome: patient list, per-patient service links (deep-link
 * via ?tab=), Copilot toggle, command bar trigger, role-gated admin links.
 *
 * Constraints (non-SaMD boundary — see CLAUDE.md):
 * - Navigation only. No clinical content, no alerts, no severity indicators
 *   anywhere in the shell.
 */

import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { useCopilot } from "../../context/CopilotContext";
import CommandBar from "../CommandBar/CommandBar";

const ICONS: Record<string, string> = {
  patients: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  overview: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 8.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z",
  search: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
  narrative: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  qa: "M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z",
  handoff: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
  drafts: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10",
  copilot: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z",
  command: "M15.75 15.75V18a2.25 2.25 0 002.25 2.25h.75a2.25 2.25 0 002.25-2.25v-.75a2.25 2.25 0 00-2.25-2.25h-2.25zm0 0V8.25m0 7.5H8.25m7.5-7.5V6a2.25 2.25 0 012.25-2.25h.75A2.25 2.25 0 0121 6v.75a2.25 2.25 0 01-2.25 2.25h-2.25zm0 0H8.25m0 7.5V18a2.25 2.25 0 01-2.25 2.25h-.75A2.25 2.25 0 013 18v-.75a2.25 2.25 0 012.25-2.25h3zm0 0V8.25m0 0V6a2.25 2.25 0 00-2.25-2.25h-.75A2.25 2.25 0 003 6v.75A2.25 2.25 0 005.25 9h3z",
  quarantine: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z",
  audit: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
  users: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z",
  analytics: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  logout: "M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9",
  collapse: "M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5",
};

function Icon({ name, className = "w-5 h-5" }: { readonly name: string; readonly className?: string }): JSX.Element {
  return (
    <svg className={`${className} shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={ICONS[name]} />
    </svg>
  );
}

const PATIENT_VIEWS = ["workspace", "chart"] as const;

interface NavItemProps {
  readonly icon: string;
  readonly label: string;
  readonly active?: boolean;
  readonly collapsed: boolean;
  readonly onClick: () => void;
}

function NavItem({ icon, label, active = false, collapsed, onClick }: NavItemProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
        ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800/60"}
        ${collapsed ? "justify-center" : ""}
      `}
    >
      <Icon name={icon} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );
}

export default function AppShell(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const { activePatientId, activePatientName } = useCopilot();

  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem("shell.collapsed") === "1");
  const [cmdOpen, setCmdOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      localStorage.setItem("shell.collapsed", v ? "0" : "1");
      return !v;
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPatientPage = activePatientId !== null && location.pathname === `/patients/${activePatientId}`;
  const currentView = onPatientPage ? (searchParams.get("view") === "chart" ? "chart" : "workspace") : null;

  const goToView = useCallback(
    (view: string): void => {
      if (!activePatientId) return;
      void navigate(`/patients/${activePatientId}?view=${view}`);
    },
    [activePatientId, navigate],
  );

  const isAdmin = user?.roles.some((r) => r === "hospital_admin" || r === "sysadmin") ?? false;

  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside
        className={`
          sticky top-0 h-screen z-40 flex flex-col
          bg-slate-900 border-e border-slate-800
          transition-[width] duration-150
          ${collapsed ? "w-16" : "w-60"}
        `}
      >
        {/* Brand */}
        <div className={`flex items-center gap-2 px-4 h-14 border-b border-slate-800 ${collapsed ? "justify-center px-0" : ""}`}>
          <Icon name="copilot" className="w-6 h-6 text-blue-400" />
          {!collapsed && (
            <span className="text-sm font-semibold text-white truncate">{t("shell.brand")}</span>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          <NavItem
            icon="patients"
            label={t("shell.patients")}
            active={location.pathname === "/patients"}
            collapsed={collapsed}
            onClick={() => void navigate("/patients")}
          />
          <NavItem
            icon="command"
            label={t("shell.commandBar")}
            collapsed={collapsed}
            onClick={() => setCmdOpen(true)}
          />

          {activePatientId && (
            <>
              <div className={`pt-4 pb-1 ${collapsed ? "text-center" : "px-3"}`}>
                {!collapsed ? (
                  <p className="text-xs text-slate-500 uppercase tracking-wide truncate" title={activePatientName ?? ""}>
                    {activePatientName ?? t("shell.patientFile")}
                  </p>
                ) : (
                  <div className="mx-auto w-6 border-t border-slate-700" />
                )}
              </div>
              {PATIENT_VIEWS.map((view) => (
                <NavItem
                  key={view}
                  icon={view === "workspace" ? "copilot" : "overview"}
                  label={view === "workspace" ? t("shell.copilot") : t("shell.patientFile")}
                  active={currentView === view}
                  collapsed={collapsed}
                  onClick={() => goToView(view)}
                />
              ))}
            </>
          )}

          {isAdmin && (
            <>
              <div className={`pt-4 pb-1 ${collapsed ? "text-center" : "px-3"}`}>
                {!collapsed ? (
                  <p className="text-xs text-slate-500 uppercase tracking-wide">{t("shell.admin")}</p>
                ) : (
                  <div className="mx-auto w-6 border-t border-slate-700" />
                )}
              </div>
              <NavItem
                icon="quarantine"
                label={t("shell.quarantine")}
                active={location.pathname === "/admin/quarantine"}
                collapsed={collapsed}
                onClick={() => void navigate("/admin/quarantine")}
              />
              <NavItem
                icon="audit"
                label={t("shell.audit")}
                active={location.pathname === "/admin/audit"}
                collapsed={collapsed}
                onClick={() => void navigate("/admin/audit")}
              />
              <NavItem
                icon="users"
                label={t("shell.users")}
                active={location.pathname === "/admin/users"}
                collapsed={collapsed}
                onClick={() => void navigate("/admin/users")}
              />
              <NavItem
                icon="analytics"
                label={t("shell.nphiesAnalytics")}
                active={location.pathname === "/admin/nphies"}
                collapsed={collapsed}
                onClick={() => void navigate("/admin/nphies")}
              />
            </>
          )}
        </nav>

        {/* Footer: user + collapse */}
        <div className="border-t border-slate-800 px-2 py-3 space-y-1">
          {!collapsed && user && (
            <p className="px-3 pb-1 text-xs text-slate-500 truncate" title={user.displayName}>
              {user.displayName}
            </p>
          )}
          <NavItem icon="logout" label={t("common.logout")} collapsed={collapsed} onClick={() => void logout()} />
          <NavItem
            icon="collapse"
            label={t("shell.collapse")}
            collapsed={collapsed}
            onClick={toggleCollapsed}
          />
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>

      <CommandBar open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
