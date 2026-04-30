import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { BRAND } from '../lib/constants';
import Logo from './Logo';
import { Avatar } from './Avatar';
import { BusinessHeaderBar } from './BusinessSelector';

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
  const displayRole =
    role === 'sub_admin' ? 'SUB-ADMIN' :
    role === 'admin' ? 'ADMIN' :
    role === 'va' || role === 'otm' ? 'OTM' :
    role === 'client' ? 'CLIENT' : (role || '').toUpperCase();

  async function handleLogout() {
    await signOut();
    nav('/', { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-40"
        style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="flex items-center gap-3">
          <Logo size={38} />
          <div>
            <div className="font-bebas text-xl tracking-widest text-ink leading-none">808 TALENT SOURCE</div>
            <div className="font-display italic text-xs text-slate808">Time Tracker & Operations</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <NavLink to="/profile" className="flex items-center gap-3 px-3 py-1.5 rounded-full border border-line bg-cream-deep hover:border-ink transition-colors">
            <Avatar url={profile?.avatar_url} name={profile?.name || '?'} size={32} />
            <div className="text-left">
              <div className="text-sm font-medium leading-none">{profile?.name || '—'}</div>
              <div className="font-bebas text-[10px] tracking-widest text-crimson mt-0.5">{displayRole}</div>
            </div>
          </NavLink>
          <button className="btn-ghost" onClick={handleLogout}>Log out</button>
        </div>
      </header>

      <nav className="flex gap-1 px-8 overflow-x-auto" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
        {tabs.map(t => (
          <NavLink
            key={t.path}
            to={t.path}
            className={({ isActive }) =>
              `px-5 py-3.5 font-bebas text-xs tracking-widest whitespace-nowrap border-b-2 transition-colors ${
                isActive ? 'text-crimson border-crimson' : 'text-slate808 border-transparent hover:text-ink'
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

      {/* Business header bar appears here for clients and OTMs */}
      <BusinessHeaderBar role={role} />

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-8 py-4">
        {children}
      </main>

      <footer className="mt-12 border-t border-line" style={{ background: 'var(--paper)' }}>
        <div className="max-w-[1400px] mx-auto px-8 py-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="max-w-lg">
              <div className="font-bebas tracking-widest text-ink text-sm">808 TALENT SOURCE™</div>
              <div className="font-display italic text-slate808 text-sm mt-1">A brand of {BRAND.parentCompany}</div>
              <div className="text-xs text-muted mt-3 leading-relaxed">
                © 2026 {BRAND.companyName}. All rights reserved. Incorporated in Florida. Serving businesses nationwide.
              </div>
              <div className="text-xs text-muted mt-2 leading-relaxed">
                {BRAND.addressLine1} • {BRAND.addressLine2}<br />
                {BRAND.phone} • <a href={`mailto:${BRAND.email}`} className="hover:text-crimson">{BRAND.email}</a>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-xs">
              <a href={BRAND.privacyUrl} target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Privacy Policy</a>
              <a href={BRAND.termsUrl} target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Terms of Service</a>
              <a href={BRAND.acceptableUseUrl} target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">Acceptable Use</a>
              <a href={`https://${BRAND.website}`} target="_blank" rel="noreferrer" className="text-slate808 hover:text-crimson">{BRAND.website}</a>
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
      { path: '/admin/tasks', label: 'Tasks' },
      { path: '/timesheets', label: 'Timesheets' },
      { path: '/summary', label: 'Weekly Summary' },
      { path: '/admin/team', label: 'OTM Team' },
      { path: '/admin/clients', label: 'Client Admin' },
      { path: '/admin/pay', label: 'Pay & Stubs' },
      { path: '/admin/requests', label: 'Requests', count: pendingRequests },
      { path: '/admin/lock', label: 'Month Lock' },
      { path: '/admin/credentials', label: 'Credentials' },
      { path: '/admin/audit', label: 'Audit Log' }
    ];
  }
  if (role === 'va' || role === 'otm') {
    return [
      { path: '/dashboard', label: 'Dashboard' },
      { path: '/tracker', label: 'Time Tracker' },
      { path: '/tasks', label: 'Tasks' },
      { path: '/timesheets', label: 'My Timesheets' }
    ];
  }
  return [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/clients', label: 'My Retainer' },
    { path: '/tasks', label: 'Tasks' },
    { path: '/timesheets', label: 'Timesheets' }
  ];
}
