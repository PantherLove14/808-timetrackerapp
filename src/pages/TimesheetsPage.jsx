import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import PageHeader, { Empty } from '../components/PageHeader';
import { useBusinesses } from '../components/BusinessSelector';
import { businessDot } from '../lib/businessColor';
import { formatDate, formatDuration, startOfMonth, startOfWeek } from '../lib/format';

export default function TimesheetsPage({ role, profile }) {
  const { selectedId } = useBusinesses();
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [lockedMonths, setLockedMonths] = useState([]);

  const [filterRange, setFilterRange] = useState('month');
  const [filterUser, setFilterUser] = useState('all');

  useEffect(() => {
    async function load() {
      if (role === 'admin' || role === 'sub_admin') {
        const { data: u } = await supabase.from('users').select('id, name').order('name');
        setUsers(u || []);
      }
      const { data: locks } = await supabase.from('month_locks').select('month').is('unlocked_at', null);
      setLockedMonths((locks || []).map(l => l.month));
      loadEntries();
    }
    load();
  }, [role, profile]);

  useEffect(() => { loadEntries(); }, [selectedId, filterRange, filterUser]);

  async function loadEntries() {
    let q = supabase.from('time_entries').select('*, businesses(name), users(name)').order('date', { ascending: false });

    if (role === 'va' || role === 'otm') { if (profile) q = q.eq('user_id', profile.id); }
    if ((role === 'admin' || role === 'sub_admin') && filterUser !== 'all') q = q.eq('user_id', filterUser);

    if (selectedId !== 'all') q = q.eq('business_id', selectedId);

    const now = new Date();
    if (filterRange === 'today') {
      q = q.gte('date', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString());
    } else if (filterRange === 'week') {
      q = q.gte('date', startOfWeek(now).toISOString());
    } else if (filterRange === 'month') {
      q = q.gte('date', startOfMonth(now).toISOString());
    } else if (filterRange === 'lastmonth') {
      const startLast = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
      const startThis = startOfMonth(now).toISOString();
      q = q.gte('date', startLast).lt('date', startThis);
    }

    const { data } = await q.limit(500);
    setEntries(data || []);
  }

  async function deleteEntry(id) {
    if (!confirm('Delete this entry?')) return;
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) return alert(error.message);
    loadEntries();
  }

  function exportCSV() {
    const rows = [['Date', 'OTM', 'Business', 'Description', 'Type', 'Reason', 'Hours']];
    entries.forEach(e => {
      rows.push([
        formatDate(e.date), e.users?.name || '—', e.businesses?.name || '—',
        (e.description || '').replace(/"/g, '""'), e.type,
        (e.reason || '').replace(/"/g, '""'), (e.duration / 3600).toFixed(2)
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `808-timesheets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function isEntryLocked(entry) {
    const mk = entry.date.slice(0, 7) + '-01';
    return lockedMonths.includes(mk);
  }

  const canDelete = (entry) => {
    if (isEntryLocked(entry)) return false;
    if (role === 'admin' || role === 'sub_admin') return true;
    if ((role === 'va' || role === 'otm') && entry.user_id === profile?.id) return true;
    return false;
  };

  return (
    <div>
      <PageHeader
        kicker="Report"
        title="Timesheets"
        subtitle="All logged time. Use the header bar to filter by business."
        right={<button className="btn-sm ink" onClick={exportCSV}>⬇ EXPORT CSV</button>}
      />

      <div className="flex gap-2 flex-wrap mb-5 items-center">
        <span className="font-bebas text-[11px] tracking-widest text-muted">FILTER</span>
        <select value={filterRange} onChange={e => setFilterRange(e.target.value)}>
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
          <option value="lastmonth">Last month</option>
        </select>
        {(role === 'admin' || role === 'sub_admin') && (
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}>
            <option value="all">All OTMs</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
      </div>

      <div className="panel p-0 overflow-hidden">
        {entries.length === 0 ? <Empty>No entries for this filter.</Empty> : (
          <table>
            <thead>
              <tr><th>Date</th><th>OTM</th><th>Business</th><th>Description</th><th>Type</th><th>Duration</th><th></th></tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const locked = isEntryLocked(e);
                return (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.users?.name || '—'}</td>
                    <td><span className="inline-flex items-center gap-2"><span style={businessDot(e.business_id)} />{e.businesses?.name || '—'}</span></td>
                    <td className="text-slate808">
                      {e.description}
                      {e.reason && <div className="text-xs text-warn mt-1">Reason: {e.reason}</div>}
                    </td>
                    <td>
                      {e.type === 'manual' ? <span className="badge manual">MANUAL</span> : <span className="badge done">TIMER</span>}
                      {locked && <span className="badge locked ml-1">LOCKED</span>}
                    </td>
                    <td><strong>{formatDuration(e.duration)}</strong></td>
                    <td>{canDelete(e) && <button className="btn-sm danger" onClick={() => deleteEntry(e.id)}>Delete</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
