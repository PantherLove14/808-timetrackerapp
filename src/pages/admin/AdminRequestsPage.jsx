import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../../components/PageHeader';
import { useToast } from '../../components/BusinessSelector';
import { formatDate } from '../../lib/format';

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState([]);
  const toast = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase
      .from('time_off')
      .select('*, users!time_off_user_id_fkey(name, email)')
      .order('created_at', { ascending: false });
    setRequests(data || []);
  }

  async function review(id, status) {
    const notes = status === 'denied' ? prompt('Reason for denial (visible to OTM)?') : null;
    if (status === 'denied' && !notes) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('time_off').update({
      status, reviewed_by: user.id,
      reviewed_at: new Date().toISOString(), review_notes: notes
    }).eq('id', id);
    if (error) return toast.show(error.message, 'error');
    await logAudit(`time_off.${status}`, 'time_off', id, { notes });
    toast.show(`Request ${status}.`);
    load();
  }

  async function deleteRequest(id) {
    if (!confirm('Delete this request from history? This cannot be undone.')) return;
    const { error } = await supabase.from('time_off').delete().eq('id', id);
    if (error) return toast.show(error.message, 'error');
    await logAudit('time_off.delete', 'time_off', id);
    toast.show('Request deleted.');
    load();
  }

  async function clearAllHistory() {
    if (!confirm('Delete ALL reviewed (approved/denied) requests? Pending requests will be kept. This cannot be undone.')) return;
    const { error } = await supabase.from('time_off').delete().in('status', ['approved', 'denied']);
    if (error) return toast.show(error.message, 'error');
    await logAudit('time_off.clear_history');
    toast.show('History cleared.');
    load();
  }

  const pending = requests.filter(r => r.status === 'pending');
  const reviewed = requests.filter(r => r.status !== 'pending');

  return (
    <div>
      <PageHeader kicker="Admin" title="Requests" subtitle="Review time off requests from your OTM team." />

      <div className="panel mb-6">
        <SectionTitle kicker="Pending">Awaiting your review</SectionTitle>
        {pending.length === 0 ? <Empty>No pending requests.</Empty> : (
          <table>
            <thead><tr><th>OTM</th><th>Type</th><th>Dates</th><th>Reason</th><th>Submitted</th><th>Action</th></tr></thead>
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
        <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
          <SectionTitle kicker="Reviewed">History ({reviewed.length})</SectionTitle>
          {reviewed.length > 0 && (
            <button className="btn-sm danger" onClick={clearAllHistory}>CLEAR ALL HISTORY</button>
          )}
        </div>
        {reviewed.length === 0 ? <Empty>No reviewed requests yet.</Empty> : (
          <table>
            <thead><tr><th>OTM</th><th>Type</th><th>Dates</th><th>Decision</th><th>Reviewed</th><th></th></tr></thead>
            <tbody>
              {reviewed.map(r => (
                <tr key={r.id}>
                  <td>{r.users?.name || '—'}</td>
                  <td>{r.type}</td>
                  <td>{formatDate(r.start_date)} → {formatDate(r.end_date)}</td>
                  <td><span className={`badge ${r.status === 'approved' ? 'active' : 'hold'}`}>{r.status.toUpperCase()}</span></td>
                  <td>{formatDate(r.reviewed_at)}</td>
                  <td><button className="btn-sm danger" onClick={() => deleteRequest(r.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
