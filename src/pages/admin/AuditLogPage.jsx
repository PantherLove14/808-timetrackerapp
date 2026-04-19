import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import PageHeader, { Empty } from '../../components/PageHeader';
import { formatDateTime } from '../../lib/format';

export default function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => { load(); }, [filter]);

  async function load() {
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    if (filter !== 'all') q = q.ilike('action', `${filter}%`);
    const { data } = await q;
    setLogs(data || []);
  }

  function exportCSV() {
    const rows = [['Timestamp', 'Actor', 'Role', 'Action', 'Entity', 'Metadata']];
    logs.forEach(l => {
      rows.push([
        formatDateTime(l.created_at),
        l.actor_email || '—',
        l.actor_role || '—',
        l.action,
        l.entity_type || '—',
        JSON.stringify(l.metadata || {}).replace(/"/g, '""')
      ]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `808-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="Audit Log"
        subtitle="Every logged action. Filter and export for review."
        right={<button className="btn-sm ink" onClick={exportCSV}>⬇ EXPORT CSV</button>}
      />
      <div className="flex gap-2 mb-4">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All actions</option>
          <option value="user">User actions</option>
          <option value="client">Client actions</option>
          <option value="business">Business actions</option>
          <option value="time_entry">Time entries</option>
          <option value="task">Tasks</option>
          <option value="time_off">Time off</option>
          <option value="pay_stub">Pay stubs</option>
          <option value="month">Month locks</option>
          <option value="credentials">Credentials access</option>
        </select>
      </div>

      <div className="panel p-0 overflow-hidden">
        {logs.length === 0 ? (
          <Empty>No log entries.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>When</th><th>Who</th><th>Role</th><th>Action</th><th>Entity</th></tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l.id}>
                  <td>{formatDateTime(l.created_at)}</td>
                  <td>{l.actor_email || '—'}</td>
                  <td>{l.actor_role ? <span className="badge ink">{l.actor_role.toUpperCase()}</span> : '—'}</td>
                  <td><code className="text-xs bg-cream-deep px-2 py-0.5 rounded">{l.action}</code></td>
                  <td className="text-xs text-slate808">
                    {l.entity_type}{l.entity_id ? ` #${l.entity_id.slice(0, 8)}` : ''}
                    {l.metadata && Object.keys(l.metadata).length > 0 && (
                      <div className="text-[11px] text-muted mt-1">{JSON.stringify(l.metadata)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
