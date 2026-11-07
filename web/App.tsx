import { lazy, Suspense } from "react";
import type { PropsWithChildren } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { StatusBadge } from "@/components/ui";
import { ChangePasswordPage } from "@/features/auth/ChangePasswordPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/AuthProvider";
import { EmployeesPage } from "@/features/admin/EmployeesPage";
import { MasterPage } from "@/features/admin/MasterPage";

const ReportPage = lazy(() => import("@/features/reports/ReportPage")
  .then((module) => ({ default: module.ReportPage })));
const MeetingPage = lazy(() => import("@/features/meetings/MeetingPage")
  .then((module) => ({ default: module.MeetingPage })));
const ActionRegisterPage = lazy(() => import("@/features/actions/ActionRegisterPage")
  .then((module) => ({ default: module.ActionRegisterPage })));
const ActionTrackingPage = lazy(() => import("@/features/actions/ActionTrackingPage")
  .then((module) => ({ default: module.ActionTrackingPage })));
const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage")
  .then((module) => ({ default: module.DashboardPage })));
const AiBotPage = lazy(() => import("@/features/ai/AiBotPage")
  .then((module) => ({ default: module.AiBotPage })));

function LoadingScreen() {
  return (
    <main className="route-loading" aria-busy="true" aria-label="사용자 정보를 확인하는 중">
      <span className="spinner" aria-hidden="true" />
      <span>사용자 정보를 확인하고 있습니다.</span>
    </main>
  );
}

function LazyReportPage() {
  return <Suspense fallback={<LoadingScreen />}><ReportPage /></Suspense>;
}

function LazyMeetingPage() {
  return <Suspense fallback={<LoadingScreen />}><MeetingPage /></Suspense>;
}

function LazyActionRegisterPage() {
  return <Suspense fallback={<LoadingScreen />}><ActionRegisterPage /></Suspense>;
}

function LazyActionTrackingPage() {
  return <Suspense fallback={<LoadingScreen />}><ActionTrackingPage /></Suspense>;
}

function LazyDashboardPage() {
  return <Suspense fallback={<LoadingScreen />}><DashboardPage /></Suspense>;
}

function LazyAiBotPage() {
  return <Suspense fallback={<LoadingScreen />}><AiBotPage /></Suspense>;
}

function PublicOnlyRoute({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function PasswordRoute({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function ProtectedRoute({ children }: PropsWithChildren) {
  const location = useLocation();
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return children;
}

function AdminRoute({ children }: PropsWithChildren) {
  const { user } = useAuth();
  if (!user?.isAdmin) return <ForbiddenPage />;
  return children;
}

function ForbiddenPage() {
  return (
    <main className="workspace-page">
      <section className="workspace-empty card">
        <StatusBadge tone="danger">403</StatusBadge>
        <h1>접근 권한이 없습니다.</h1>
        <p>이 화면을 이용하려면 시스템 관리자 권한이 필요합니다.</p>
      </section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/change-password"
        element={
          <PasswordRoute>
            <ChangePasswordPage />
          </PasswordRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<LazyDashboardPage />} />
        <Route path="reports" element={<LazyReportPage />} />
        <Route path="reports/:departmentCode/:week" element={<LazyReportPage />} />
        <Route path="meetings" element={<LazyMeetingPage />} />
        <Route path="meetings/:meetingId" element={<LazyMeetingPage />} />
        <Route path="actions/register" element={<LazyActionRegisterPage />} />
        <Route path="actions/tracking" element={<LazyActionTrackingPage />} />
        <Route path="ai" element={<LazyAiBotPage />} />
        <Route
          path="admin/master"
          element={
            <AdminRoute>
              <MasterPage />
            </AdminRoute>
          }
        />
        <Route
          path="admin/employees"
          element={
            <AdminRoute>
              <EmployeesPage />
            </AdminRoute>
          }
        />
        <Route path="forbidden" element={<ForbiddenPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
