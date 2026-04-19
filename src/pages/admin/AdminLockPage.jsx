import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../../components/PageHeader';
import { formatMonthKey, formatDateTime } from '../../lib/format';

export default function AdminLockPage() {
  const [locks, setLocks] = useState([]);
  const [monthToLock, setMonthToLock] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');

  useEffect(() => { load(); checkScheduled(); }, []);

  async function load() {
    const { data } = await supabase.from('month_locks').select('*, locked_by_user:users!month_locks_locked_by_fkey(name)').order('month', { ascending: false });
    setLocks(data || []);
  }

  // On load, check if any scheduled locks have reached their time (client-side fallback)
  async function checkScheduled() {
    const { data } = await supabase
      .from('month_locks')
      .select('*')
      .is('unlocked_at', null)
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', new Date().toISOString());
    // Those are effectively active now. No action needed; they count as locked per the trigger/logic.
  }

  async function lockNow() {
    if (!monthToLock) return alert('Pick a month.');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('month_locks').upsert({
      month: monthToLock + '-01',
      locked_by: user.id,
      scheduled_for: null,
      unlocked_at: null
    }, { onConflict: 'month' });
    if (error) return alert(error.message);
    await logAudit('month.lock', 'month_lock', null, { month: monthToLock });
    load();
    alert(`Locked ${formatMonthKey(monthToLock + '-01')}.`);
  }

  async function scheduleLock() {
    if (!monthToLock || !scheduledFor) return alert('Pick month and schedule time.');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('month_locks').upsert({
      month: monthToLock + '-01',
      locked_by: user.id,
      scheduled_for: new Date(scheduledFor).toISOString(),
      unlocked_at: null
    }, { onConflict: 'month' });
    if (error) return alert(error.message);
    await logAudit('month.schedule_lock', 'month_lock', null, { month: monthToLock, scheduled_for: scheduledFor });
    load();
    alert(`Scheduled lock for ${formatMonthKey(monthToLock + '-01')} at ${new Date(scheduledFor).toLocaleString()}.`);
  }

  async function unlock(lock) {
    const reason = prompt('Reason for unlocking? (required, logged)');
    if (!reason) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('month_locks').update({
      unlocked_at: new Date().toISOString(),
      unlocked_by: user.id,
      unlock_reason: reason
    }).eq('id', lock.id);
    if (error) return alert(error.message);
    await logAudit('month.unlock', 'month_lock', lock.id, { reason });
    load();
  }

  const activeLocks = locks.filter(l => !l.unlocked_at);
  const history = locks.filter(l => l.unlocked_at);

  return (
    <div>
      <PageHeader kicker="Admin" title="Month Lock" subtitle="Close the books for a month. Locked months cannot have time entries added, edited, or deleted." />

      <div className="panel mb-6">
        <div className="text-sm bg-warn/10 border-l-4 border-warn px-4 py-3 mb-5">
          <strong className="font-bebas tracking-wider text-warn">HEADS UP:</strong> Locking prevents all users from modifying entries for that period. Only admins can unlock.
        </div>

        <SectionTitle kicker="Lock immediately">Lock now</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end mb-6">
          <div>
            <label className="field-label">Month</label>
            <input type="month" className="input" value={monthToLock} onChange={e => setMonthToLock(e.target.value)} />
          </div>
          <button className="btn-sm ink" onClick={lockNow}>LOCK NOW</button>
        </div>

        <SectionTitle kicker="Automate closing">Schedule future lock</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="field-label">Month to lock</label>
            <input type="month" className="input" value={monthToLock} onChange={e => setMonthToLock(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Lock at date/time</label>
            <input type="datetime-local" className="input" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
          </div>
          <button className="btn-sm ink" onClick={scheduleLock}>SCHEDULE</button>
        </div>
        <div className="text-xs text-muted mt-2">Example: lock March 2026 on April 5, 2026 at 11:59 PM.</div>
      </div>

      <div className="panel mb-6">
        <SectionTitle kicker="No edits allowed">Active locks</SectionTitle>
        {activeLocks.length === 0 ? (
          <Empty>No months locked.</Empty>
        ) : (
          <table>
            <thead><tr><th>Month</th><th>Status</th><th>Locked by</th><th>At</th><th></th></tr></thead>
            <tbody>
              {activeLocks.map(l => {
                const scheduled = l.scheduled_for && new Date(l.scheduled_for) > new Date();
                return (
                  <tr key={l.id}>
                    <td><strong>{formatMonthKey(l.month)}</strong></td>
                    <td>
                      {scheduled
                        ? <span className="badge pending">SCHEDULED</span>
                        : <span className="badge locked">LOCKED</span>}
                    </td>
                    <td>{l.locked_by_user?.name || '—'}</td>
                    <td>{scheduled ? `Locks at ${formatDateTime(l.scheduled_for)}` : formatDateTime(l.locked_at)}</td>
                    <td><button className="btn-sm danger" onClick={() => unlock(l)}>UNLOCK</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <SectionTitle kicker="Audit trail">Unlock history</SectionTitle>
        {history.length === 0 ? (
          <Empty>No unlocks recorded.</Empty>
        ) : (
          <table>
            <thead><tr><th>Month</th><th>Unlocked at</th><th>Reason</th></tr></thead>
            <tbody>
              {history.map(l => (
                <tr key={l.id}>
                  <td>{formatMonthKey(l.month)}</td>
                  <td>{formatDateTime(l.unlocked_at)}</td>
                  <td className="text-slate808">{l.unlock_reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
