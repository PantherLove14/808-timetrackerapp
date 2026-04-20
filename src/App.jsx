import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import Shell from './components/Shell';
import { BusinessProvider, ToastProvider } from './components/BusinessSelector';
import Dashboard from './pages/Dashboard';
import TimeTrackerPage from './pages/TimeTrackerPage';
import TimesheetsPage from './pages/TimesheetsPage';
import TasksPage from './pages/TasksPage';
import TaskDetailPage from './pages/TaskDetailPage';
import ClientsPage from './pages/ClientsPage';
import WeeklySummaryPage from './pages/WeeklySummaryPage';
import AdminTeamPage from './pages/admin/AdminTeamPage';
import AdminClientsPage from './pages/admin/AdminClientsPage';
import AdminRequestsPage from './pages/admin/AdminRequestsPage';
import AdminLockPage from './pages/admin/AdminLockPage';
import AdminPayPage from './pages/admin/AdminPayPage';
import AdminCredentialsPage from './pages/admin/AdminCredentialsPage';
import AuditLogPage from './pages/admin/AuditLogPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  const { session, role, loading, profile } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="font-bebas tracking-widest text-slate808">LOADING</div>
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  // Normalize role — database still uses 'va' internally but we present as OTM
  const normalizedRole = role === 'va' ? 'otm' : role;

  return (
    <ToastProvider>
      <BusinessProvider role={normalizedRole} profile={profile}>
        <Shell role={normalizedRole} profile={profile}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard role={normalizedRole} profile={profile} />} />
            <Route path="/profile" element={<ProfilePage role={normalizedRole} profile={profile} />} />

            {(normalizedRole === 'otm' || normalizedRole === 'admin' || normalizedRole === 'sub_admin') && (
              <Route path="/tracker" element={<TimeTrackerPage role={normalizedRole} profile={profile} />} />
            )}

            <Route path="/timesheets" element={<TimesheetsPage role={normalizedRole} profile={profile} />} />
            <Route path="/tasks" element={<TasksPage role={normalizedRole} profile={profile} />} />
            <Route path="/tasks/:taskId" element={<TaskDetailPage role={normalizedRole} profile={profile} />} />
            <Route path="/clients" element={<ClientsPage role={normalizedRole} profile={profile} />} />

            {(normalizedRole === 'admin' || normalizedRole === 'sub_admin') && (
              <>
                <Route path="/summary" element={<WeeklySummaryPage />} />
                <Route path="/admin/team" element={<AdminTeamPage />} />
                <Route path="/admin/clients" element={<AdminClientsPage />} />
                <Route path="/admin/requests" element={<AdminRequestsPage />} />
                <Route path="/admin/lock" element={<AdminLockPage />} />
                <Route path="/admin/pay" element={<AdminPayPage />} />
                <Route path="/admin/credentials" element={<AdminCredentialsPage profile={profile} />} />
                <Route path="/admin/audit" element={<AuditLogPage />} />
              </>
            )}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Shell>
      </BusinessProvider>
    </ToastProvider>
  );
}
