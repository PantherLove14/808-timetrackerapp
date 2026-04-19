import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../../components/PageHeader';
import { formatDate } from '../../lib/format';

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('time_off')
      .select('*, users!time_off_user_id_fkey(name, email)')
      .order('created_at', { ascending: false });
    setRequests(data || []);
  }

  async function review(id, status) {
    const notes = status === 'denied' ? prompt('Reason for denial (visible to VA)?') : null;
    if (status === 'denied' && !notes) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data: me } = await supabase.from('users').select('id').eq('id', user.id).single();
    const { error } = await supabase.from('time_off').update({
      status,
      reviewed_by: me?.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes
    }).eq('id', id);
    if (error) return alert(error.message);
    await logAudit(`time_off.${status}`, 'time_off', id, { notes });
    load();
  }

  const pending = requests.filter(r => r.status === 'pending');
  const reviewed = requests.filter(r => r.status !== 'pending').slice(0, 20);

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="Requests"
        subtitle="Review time off requests from your team."
      />

      <div className="panel mb-6">
        <SectionTitle kicker="Pending">Awaiting your review</SectionTitle>
        {pending.length === 0 ? (
          <Empty>No pending requests.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>VA</th><th>Type</th><th>Dates</th><th>Reason</th><th>Submitted</th><th>Action</th></tr>
            </thead>
            <tbody>
              {pending.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.users?.name || '—'}</strong><br /><span className="text-xs text-muted">{r.users?.email}</span></td>
                  <td>{r.type}</td>
                  <td>{formatDate(r.start_date)} → {formatDate(r.end_date)}</td>
                  <td className="text-slate808 max-w-sm">{r.reason || '—'}</td>
                  <td>{formatDate(r.created_at)}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-sm ink" onClick={() => review(r.id, 'approved')}>APPROVE</button>{' '}
                    <button className="btn-sm danger" onClick={() => review(r.id, 'denied')}>DENY</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <SectionTitle kicker="Last 20 decisions">History</SectionTitle>
        {reviewed.length === 0 ? (
          <Empty>No reviewed requests yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>VA</th><th>Type</th><th>Dates</th><th>Decision</th><th>Reviewed</th></tr>
            </thead>
            <tbody>
              {reviewed.map(r => (
                <tr key={r.id}>
                  <td>{r.users?.name || '—'}</td>
                  <td>{r.type}</td>
                  <td>{formatDate(r.start_date)} → {formatDate(r.end_date)}</td>
                  <td><span className={`badge ${r.status === 'approved' ? 'active' : 'hold'}`}>{r.status.toUpperCase()}</span></td>
                  <td>{formatDate(r.reviewed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
