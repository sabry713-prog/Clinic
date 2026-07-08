import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { useTranslation } from "react-i18next";
import { CopilotProvider } from "./context/CopilotContext";
import AppShell from "./components/AppShell/AppShell";

const PatientListPage = lazy(() => import("./pages/PatientListPage/PatientListPage"));
const PatientDetailPage = lazy(() => import("./pages/PatientDetailPage/PatientDetailPage"));
const QuarantinePage = lazy(() => import("./pages/admin/QuarantinePage/QuarantinePage"));
const AuditPage = lazy(() => import("./pages/admin/AuditPage/AuditPage"));
const UserManagementPage = lazy(() => import("./pages/admin/UserManagementPage/UserManagementPage"));
const NphiesAnalyticsPage = lazy(() => import("./pages/admin/NphiesAnalyticsPage/NphiesAnalyticsPage"));

function AppRoutes(): JSX.Element {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <span className="text-slate-400 text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user != null ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route element={user != null ? <AppShell /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<Navigate to="/patients" replace />} />
        <Route path="/patients" element={<PatientListPage />} />
        <Route path="/patients/:id" element={<PatientDetailPage />} />
        <Route path="/admin/quarantine" element={<QuarantinePage />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/users" element={<UserManagementPage />} />
        <Route path="/admin/nphies" element={<NphiesAnalyticsPage />} />
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
