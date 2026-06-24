import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { ModuleGuard } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/modules/DashboardPage";
import { CoilMasterPage } from "./pages/modules/CoilMasterPage";
import { SlittingPage } from "./pages/modules/SlittingPage";
import { SunrackReceiptPage } from "./pages/modules/SunrackReceiptPage";
import { ProductionPage } from "./pages/modules/ProductionPage";
import { FinishedGoodsPage } from "./pages/modules/FinishedGoodsPage";
import { QcInspectionPage } from "./pages/modules/QcInspectionPage";
import { DispatchPage } from "./pages/modules/DispatchPage";
import { SiteInstallationPage } from "./pages/modules/SiteInstallationPage";
import { ComplaintPage } from "./pages/modules/ComplaintPage";
import { TraceabilityPage } from "./pages/modules/TraceabilityPage";
import { DocumentsPage } from "./pages/modules/DocumentsPage";
import { UsersRolesPage } from "./pages/modules/UsersRolesPage";
import { ToastProvider } from "./contexts/ToastContext";

function HomeRedirect() {
  const { user } = useAuth();
  const first = user?.accessibleModules[0]?.path ?? "/login";
  return <Navigate to={first} replace />;
}

function ModuleRoute({
  moduleCode,
  children,
}: {
  moduleCode: string;
  children: React.ReactNode;
}) {
  return <ModuleGuard moduleCode={moduleCode}>{children}</ModuleGuard>;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route index element={<HomeRedirect />} />

            <Route
              path="/dashboard"
              element={
                <ModuleRoute moduleCode="dashboard">
                  <DashboardPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/coil-master"
              element={
                <ModuleRoute moduleCode="coil-master">
                  <CoilMasterPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/slitting"
              element={
                <ModuleRoute moduleCode="slitting">
                  <SlittingPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/sunrack-receipt"
              element={
                <ModuleRoute moduleCode="sunrack-receipt">
                  <SunrackReceiptPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/production"
              element={
                <ModuleRoute moduleCode="production">
                  <ProductionPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/qc-inspection"
              element={
                <ModuleRoute moduleCode="qc-inspection">
                  <QcInspectionPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/finished-goods"
              element={
                <ModuleRoute moduleCode="finished-goods">
                  <FinishedGoodsPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/dispatch"
              element={
                <ModuleRoute moduleCode="dispatch">
                  <DispatchPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/site-installation"
              element={
                <ModuleRoute moduleCode="site-installation">
                  <SiteInstallationPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/complaints"
              element={
                <ModuleRoute moduleCode="complaint">
                  <ComplaintPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/traceability"
              element={
                <ModuleRoute moduleCode="traceability">
                  <TraceabilityPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/documents"
              element={
                <ModuleRoute moduleCode="documents">
                  <DocumentsPage />
                </ModuleRoute>
              }
            />
            <Route
              path="/users-roles"
              element={
                <ModuleRoute moduleCode="users-roles">
                  <UsersRolesPage />
                </ModuleRoute>
              }
            />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ToastProvider>
  );
}
