import { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import Logo from './Logo';

export default function Shell({ children, role, profile }) {
  const loc = useLocation();
  const nav = useNavigate();
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    if (role === 'admin' || role === 'sub_admin') {
      supabase.from('time_off').select('id', { count: 'exact' }).eq('status', 'pending')
        .then(({ count }) => setPendingRequests(count || 0));
    }
  }, [role, loc.pathname]);

  const tabs = buildTabs(role, pendingRequests);
  const initial = (profile?.name || 'U').charAt(0).toUpperCase();
  const isAdmin = role === 'admin' || role === 'sub_admin';
  const displayRole = role === 'sub_admin' ? 'SUB-ADMIN' : (role || '').toUpperCase();

  async function handleLogout() {
    await signOut();
    nav('/', { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Topbar */}
      <header
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-40"
        style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="flex items-center gap-3">
          <Logo size={38} />
          <div>
            <div className="font-bebas text-xl tracking-widest text-ink leading-none">808 TALENT SOURCE</div>
            <div className="font-display italic text-xs text-slate808">Time Tracker</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <NavLink to="/profile" className="flex items-center gap-3 px-3 py-1.5 rounded-full border border-line bg-cream-deep hover:border-ink transition-colors">
            <div className="w-8 h-8 rounded-full grid place-items-center text-cream font-bebas text-xs" style={{ background: isAdmin ? 'var(--crimson)' : 'var(--ink)' }}>
              {initial}
            </div>
            <div className="text-left">
              <div className="text-sm font-medium leading-none">{profile?.name || '—'}</div>
              <div className="font-bebas text-[10px] tracking-widest text-crimson mt-0.5">{displayRole}</div>
            </div>
          </NavLink>
          <button className="btn-ghost" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      {/* Nav tabs */}
      <nav className="flex gap-1 px-8 overflow-x-auto" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
        {tabs.map(t => (
          <NavLink
            key={t.path}
            to={t.path}
            className={({ isActive }) =>
              `px-5 py-3.5 font-bebas text-xs tracking-widest whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'text-crimson border-crimson'
                  : 'text-slate808 border-transparent hover:text-ink'
              }`
            }
          >
            {t.label}
            {t.count > 0 && (
              <span className="ml-2 bg-crimson text-cream rounded-full text-[9px] px-2 py-0.5">{t.count}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Content */}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-8 py-10">
        {children}
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-line" style={{ background: 'var(--paper)' }}>
        <div className="max-w-[1400px] mx-auto px-8 py-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-lg">
              <div className="font-bebas tracking-widest text-ink text-sm">808 TALENT SOURCE™</div>
              <div className="font-display italic text-slate808 text-sm mt-1">A brand of Impctrs Management Group</div>
              <div className="text-xs text-muted mt-3 leading-relaxed">
                © 2026 808 Talent Source, LLC. All rights reserved. Incorporated in Florida. Serving businesses nationwide. 866-808-1994
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-xs">
              <a href="https://808talentsource.com/privacy-policy" target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Privacy Policy</a>
              <a href="https://808talentsource.com/terms-of-service" target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Terms of Service</a>
              <a href="https://808talentsource.com/acceptable-use" target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Acceptable Use</a>
              <a href="https://808talentsource.com/contact" target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Contact</a>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-line-soft text-[11px] text-muted leading-relaxed">
            <strong>Confidentiality notice:</strong> All data within this system is confidential and proprietary. Access is restricted to authorized users and all activity is logged. Unauthorized access, disclosure, or use is prohibited and may result in civil or criminal liability.
          </div>
        </div>
      </footer>
    </div>
  );
}

function buildTabs(role, pendingRequests) {
  if (role === 'admin' || role === 'sub_admin') {
    return [
      { path: '/dashboard', label: 'Dashboard' },
      { path: '/clients', label: 'Clients' },
      { path: '/timesheets', label: 'Timesheets' },
      { path: '/summary', label: 'Weekly Summary' },
      { path: '/admin/team', label: 'Team' },
      { path: '/admin/clients', label: 'Client Admin' },
      { path: '/admin/pay', label: 'Pay & Stubs' },
      { path: '/admin/requests', label: 'Requests', count: pendingRequests },
      { path: '/admin/lock', label: 'Month Lock' },
      { path: '/admin/credentials', label: 'Credentials' },
      { path: '/admin/audit', label: 'Audit Log' }
    ];
  }
  if (role === 'va') {
    return [
      { path: '/dashboard', label: 'Dashboard' },
      { path: '/tracker', label: 'Time Tracker' },
      { path: '/tasks', label: 'Tasks' },
      { path: '/timesheets', label: 'My Timesheets' }
    ];
  }
  // client
  return [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/clients', label: 'My Retainer' },
    { path: '/tasks', label: 'Tasks' },
    { path: '/timesheets', label: 'Timesheets' }
  ];
}
