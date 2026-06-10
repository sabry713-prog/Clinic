import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { useAuth } from "./hooks/useAuth";
import { LoginPage } from "./pages/LoginPage";
import { HomePage } from "./pages/HomePage";
import { useTranslation } from "react-i18next";

const PatientListPage = lazy(() => import("./pages/PatientListPage/PatientListPage"));
const PatientDetailPage = lazy(() => import("./pages/PatientDetailPage/PatientDetailPage"));
const QuarantinePage = lazy(() => import("./pages/admin/QuarantinePage/QuarantinePage"));
const AuditPage = lazy(() => import("./pages/admin/AuditPage/AuditPage"));
const UserManagementPage = lazy(() => import("./pages/admin/UserManagementPage/UserManagementPage"));

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
      <Route
        path="/"
        element={user != null ? <HomePage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/patients"
        element={user != null ? <PatientListPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/patients/:id"
        element={user != null ? <PatientDetailPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/admin/quarantine"
        element={user != null ? <QuarantinePage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/admin/audit"
        element={user != null ? <AuditPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/admin/users"
        element={user != null ? <UserManagementPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Suspense>
        <AppRoutes />
      </Suspense>
    </BrowserRouter>
  );
}
