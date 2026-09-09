/**
 * RequireRoles — client-side role guard for RBAC-restricted routes.
 *
 * The backend enforces permissions on every API call; this guard keeps the
 * UI honest about the same rules so a direct-URL visit to a restricted page
 * shows an access-denied screen instead of a page whose buttons silently
 * 403. Role sets mirror the sidebar visibility conditions in AppShell.
 */

import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";

export const ADMIN_ROLES: readonly string[] = ["hospital_admin", "sysadmin"];
export const FRONT_DESK_ROLES: readonly string[] = ["nurse", "hospital_admin", "sysadmin"];
export const PHARMACY_ROLES: readonly string[] = ["pharmacist"];

interface RequireRolesProps {
  readonly roles: readonly string[];
  readonly children: ReactElement;
}

export default function RequireRoles({ roles, children }: RequireRolesProps): JSX.Element {
  const { user } = useAuth();
  const allowed = user?.roles.some((r) => roles.includes(r)) ?? false;

  if (!allowed) {
    return <AccessDenied needed={roles} />;
  }
  return children;
}

function AccessDenied({ needed }: { readonly needed: readonly string[] }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-wash flex items-center justify-center p-6">
      <div
        role="alert"
        data-testid="access-denied"
        className="w-full max-w-md bg-white border border-line rounded-[18px] shadow-card p-6 text-center space-y-3"
      >
        <ShieldAlert className="h-8 w-8 mx-auto text-status-rej" aria-hidden="true" />
        <h1 className="text-base font-bold text-ink">{t("access.denied_title")}</h1>
        <p className="text-sm text-ink-soft leading-relaxed">{t("access.denied_body")}</p>
        <p className="text-xs text-ink-faint" dir="ltr">
          {t("access.required_roles")}: {needed.join(", ")}
        </p>
        <button
          type="button"
          onClick={() => void navigate("/patients")}
          className="mt-1 px-4 py-2 rounded-full bg-grad-accent text-white text-sm font-semibold shadow-pill hover:brightness-110 transition-all"
        >
          {t("access.back")}
        </button>
      </div>
    </div>
  );
}
