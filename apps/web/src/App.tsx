import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { useTranslation } from "react-i18next";
import { CopilotProvider } from "./context/CopilotContext";
import AppShell from "./components/AppShell/AppShell";
import RequireRoles, {
  ADMIN_ROLES,
  FRONT_DESK_ROLES,
  PHARMACY_ROLES,
} from "./components/common/RequireRoles";

const PatientListPage = lazy(() => import("./pages/PatientListPage/PatientListPage"));
const PatientDetailPage = lazy(() => import("./pages/PatientDetailPage/PatientDetailPage"));
const QuarantinePage = lazy(() => import("./pages/admin/QuarantinePage/QuarantinePage"));
const AuditPage = lazy(() => import("./pages/admin/AuditPage/AuditPage"));
const UserManagementPage = lazy(() => import("./pages/admin/UserManagementPage/UserManagementPage"));
const NphiesAnalyticsPage = lazy(() => import("./pages/admin/NphiesAnalyticsPage/NphiesAnalyticsPage"));
const RejectionCostPage = lazy(() => import("./pages/admin/RejectionCostPage/RejectionCostPage"));
const ClaimSimulatorPage = lazy(() => import("./pages/admin/ClaimSimulatorPage/ClaimSimulatorPage"));
const CoderQueuePage = lazy(() => import("./pages/admin/CoderQueuePage/CoderQueuePage"));
const PharmacyQueuePage = lazy(() => import("./pages/PharmacyQueuePage/PharmacyQueuePage"));
const FrontDeskQueuePage = lazy(() => import("./pages/FrontDeskQueuePage/FrontDeskQueuePage"));
const AiReceptionistPage = lazy(() => import("./pages/AiReceptionistPage/AiReceptionistPage"));
const ProviderAvailabilityPage = lazy(() => import("./pages/admin/ProviderAvailabilityPage/ProviderAvailabilityPage"));

function AppRoutes(): JSX.Element {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="min-h-screen bg-wash flex items-center justify-center">
        <span className="text-ink-soft text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user != null ? <Navigate to="/" replace /> : <LoginPage />}
      />
      {/* Public, unauthenticated -- no staff session dependency, reachable with no login */}
      <Route path="/receptionist" element={<AiReceptionistPage />} />
      <Route element={user != null ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route path="/patients" element={<PatientListPage />} />
        <Route path="/patients/:id" element={<PatientDetailPage />} />
        {/* Role-guarded routes — the API enforces the same permissions;
            the guard keeps the UI from rendering pages whose actions would
            silently 403 (see docs/testing/test-round-2026-09-09.md). */}
        <Route path="/admin/quarantine" element={<RequireRoles roles={ADMIN_ROLES}><QuarantinePage /></RequireRoles>} />
        <Route path="/admin/audit" element={<RequireRoles roles={ADMIN_ROLES}><AuditPage /></RequireRoles>} />
        <Route path="/admin/users" element={<RequireRoles roles={ADMIN_ROLES}><UserManagementPage /></RequireRoles>} />
        <Route path="/admin/nphies" element={<RequireRoles roles={ADMIN_ROLES}><NphiesAnalyticsPage /></RequireRoles>} />
        <Route path="/admin/rejection-cost" element={<RequireRoles roles={ADMIN_ROLES}><RejectionCostPage /></RequireRoles>} />
        <Route path="/admin/claim-simulator" element={<RequireRoles roles={ADMIN_ROLES}><ClaimSimulatorPage /></RequireRoles>} />
        <Route path="/admin/coder-queue" element={<RequireRoles roles={ADMIN_ROLES}><CoderQueuePage /></RequireRoles>} />
        <Route path="/admin/provider-availability" element={<RequireRoles roles={ADMIN_ROLES}><ProviderAvailabilityPage /></RequireRoles>} />
        <Route path="/pharmacy/queue" element={<RequireRoles roles={PHARMACY_ROLES}><PharmacyQueuePage /></RequireRoles>} />
        <Route path="/front-desk/appointments" element={<RequireRoles roles={FRONT_DESK_ROLES}><FrontDeskQueuePage /></RequireRoles>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <CopilotProvider>
        <Suspense>
          <AppRoutes />
        </Suspense>
      </CopilotProvider>
    </BrowserRouter>
  );
}
