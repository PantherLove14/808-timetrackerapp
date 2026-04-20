import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getBusinessColor, businessDot } from '../lib/businessColor';
import { formatHours, startOfMonth } from '../lib/format';

const BusinessContext = createContext(null);

export function BusinessProvider({ role, profile, children }) {
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    try { return localStorage.getItem('808_selected_business') || 'all'; } catch { return 'all'; }
  });
  const [loading, setLoading] = useState(true);
  const [timerActive, setTimerActive] = useState(false);
  const [activeStats, setActiveStats] = useState({ hoursUsed: 0, monthlyHours: 0, openTasks: 0, otmCount: 0 });

  useEffect(() => {
    try { localStorage.setItem('808_selected_business', selectedId || 'all'); } catch {}
  }, [selectedId]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!profile) return;
      let q = supabase.from('businesses').select('*').eq('active', true).order('name');
      if (role === 'client') q = q.eq('client_id', profile.id);
      else if (role === 'va' || role === 'otm') {
        const { data: a } = await supabase.from('va_assignments').select('business_id').eq('va_id', profile.id);
        const ids = (a || []).map(x => x.business_id);
        if (!ids.length) {
          if (mounted) { setBusinesses([]); setLoading(false); }
          return;
        }
        q = q.in('id', ids);
      }
      const { data } = await q;
      if (mounted) {
        const list = data || [];
        setBusinesses(list);
        if (selectedId !== 'all' && !list.find(b => b.id === selectedId)) {
          setSelectedId('all');
        }
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [profile, role]);

  useEffect(() => {
    async function loadStats() {
      if (!selectedId || selectedId === 'all' || !profile) {
        setActiveStats({ hoursUsed: 0, monthlyHours: 0, openTasks: 0, otmCount: 0 });
        return;
      }
      const biz = businesses.find(b => b.id === selectedId);
      if (!biz) return;
      const som = startOfMonth(new Date()).toISOString();
      const { data: entries } = await supabase
        .from('time_entries').select('duration').eq('business_id', selectedId).gte('date', som);
      const hoursUsed = (entries || []).reduce((s, e) => s + e.duration, 0) / 3600;
      const { count: openTasks } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
        .eq('business_id', selectedId).in('status', ['todo', 'in_progress', 'submitted', 'revision_requested']);
      const { count: otmCount } = await supabase.from('va_assignments').select('id', { count: 'exact', head: true })
        .eq('business_id', selectedId);
      setActiveStats({ hoursUsed, monthlyHours: biz.monthly_hours, openTasks: openTasks || 0, otmCount: otmCount || 0 });
    }
    loadStats();
  }, [selectedId, businesses, profile]);

  const selected = selectedId === 'all' ? null : businesses.find(b => b.id === selectedId) || null;
  const viewingAll = selectedId === 'all';

  return (
    <BusinessContext.Provider value={{
      businesses, selected, selectedId, setSelectedId, viewingAll,
      loading, timerActive, setTimerActive, activeStats
    }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinesses() {
  return useContext(BusinessContext) || {
    businesses: [], selected: null, selectedId: 'all', setSelectedId: () => {},
    viewingAll: true, loading: false, timerActive: false, setTimerActive: () => {},
    activeStats: { hoursUsed: 0, monthlyHours: 0, openTasks: 0, otmCount: 0 }
  };
}

export function BusinessHeaderBar({ role }) {
  const { businesses, selected, selectedId, setSelectedId, timerActive, activeStats } = useBusinesses();
  const [open, setOpen] = useState(false);

  if (!businesses.length || role === 'admin' || role === 'sub_admin') return null;

  const color = selected ? getBusinessColor(selected.id) : null;
  const viewingAll = selectedId === 'all';
  const isOTM = role === 'va' || role === 'otm';

  if (timerActive && selected) {
    return (
      <div className="sticky top-[73px] z-30 mb-6" style={{
        background: 'var(--crimson)',
        borderBottom: '3px solid var(--crimson-dark)',
        padding: '14px 24px',
        color: 'var(--cream)',
        boxShadow: '0 2px 12px rgba(168,4,4,0.25)'
      }}>
        <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#fff6ea', animation: 'pulse 1.2s infinite' }} />
            <div>
              <div className="font-bebas tracking-widest text-xs opacity-90">TRACKING TIME FOR</div>
              <div className="font-display text-xl font-semibold leading-tight">{selected.name}</div>
            </div>
          </div>
          <div className="font-bebas text-[11px] tracking-widest opacity-90">TIMER RUNNING</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-[73px] z-30 mb-6" style={{
      background: viewingAll ? 'var(--cream-deep)' : 'var(--paper)',
      borderLeft: selected ? `4px solid ${color.hex}` : '4px solid var(--ink)',
      borderBottom: '1px solid var(--line)',
      padding: '12px 20px'
    }}>
      <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {selected ? (
            <>
              <span style={businessDot(selected.id)} />
              <div className="min-w-0">
                <div className="font-bebas tracking-widest text-[10px] text-crimson">{isOTM ? 'WORKING ON' : 'VIEWING'}</div>
                <div className="font-display text-lg font-semibold leading-tight truncate">{selected.name}</div>
              </div>
            </>
          ) : (
            <>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--ink)', display: 'inline-block' }} />
              <div>
                <div className="font-bebas tracking-widest text-[10px] text-crimson">OVERVIEW</div>
                <div className="font-display text-lg font-semibold leading-tight">All {isOTM ? 'my businesses' : 'businesses'}</div>
              </div>
            </>
          )}
        </div>

        {selected && (
          <div className="flex items-center gap-6 text-xs">
            <div>
              <div className="font-bebas tracking-widest text-[10px] text-muted">RETAINER</div>
              <div className="font-medium">
                {formatHours(activeStats.hoursUsed)} <span className="text-muted">of {activeStats.monthlyHours}h</span>
              </div>
            </div>
            <div className="hidden md:block">
              <div className="font-bebas tracking-widest text-[10px] text-muted">OPEN TASKS</div>
              <div className="font-medium">{activeStats.openTasks}</div>
            </div>
            {!isOTM && (
              <div className="hidden lg:block">
                <div className="font-bebas tracking-widest text-[10px] text-muted">OTMS</div>
                <div className="font-medium">{activeStats.otmCount}</div>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <button
            className="btn-sm ink flex items-center gap-2"
            onClick={() => setOpen(o => !o)}
          >
            SWITCH ▾
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full mt-2 bg-paper border border-line rounded shadow-lg min-w-[260px] z-50 overflow-hidden">
                <button
                  onClick={() => { setSelectedId('all'); setOpen(false); }}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-cream-deep ${viewingAll ? 'bg-cream-deep' : ''}`}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--ink)' }} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">All {isOTM ? 'my businesses' : 'businesses'}</div>
                    <div className="text-[11px] text-muted">Portfolio view</div>
                  </div>
                  {viewingAll && <span className="text-crimson font-bebas text-[10px]">ACTIVE</span>}
                </button>
                <div className="border-t border-line-soft" />
                {businesses.map(b => {
                  const dotStyle = businessDot(b.id);
                  const active = b.id === selectedId;
                  return (
                    <button key={b.id}
                      onClick={() => { setSelectedId(b.id); setOpen(false); }}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-cream-deep ${active ? 'bg-cream-deep' : ''}`}
                    >
                      <span style={dotStyle} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{b.name}</div>
                        <div className="text-[11px] text-muted">{b.tier} • {b.monthly_hours}h/mo</div>
                      </div>
                      {active && <span className="text-crimson font-bebas text-[10px]">ACTIVE</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Toast notifications for action confirmations
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function show(message, type = 'success', duration = 4000) {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration);
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`panel animate-fadeIn shadow-lg`} style={{
            borderLeft: `4px solid ${t.type === 'error' ? 'var(--crimson)' : t.type === 'warn' ? 'var(--warn)' : 'var(--ok)'}`,
            padding: '12px 16px'
          }}>
            <div className="font-bebas text-[10px] tracking-widest mb-1" style={{ color: t.type === 'error' ? 'var(--crimson)' : t.type === 'warn' ? 'var(--warn)' : 'var(--ok)' }}>
              {t.type === 'error' ? 'ERROR' : t.type === 'warn' ? 'HEADS UP' : 'SENT'}
            </div>
            <div className="text-sm text-ink">{t.message}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext) || { show: (msg) => console.log(msg) };
}
