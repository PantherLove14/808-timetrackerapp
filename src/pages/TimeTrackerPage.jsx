import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../components/PageHeader';
import Modal from '../components/Modal';
import { useBusinesses, useToast } from '../components/BusinessSelector';
import { useTimer, formatElapsed } from '../components/TimerProvider';
import { businessDot } from '../lib/businessColor';
import { formatDate, formatDuration, sameMonth } from '../lib/format';

export default function TimeTrackerPage({ role, profile }) {
  const { businesses, selected, selectedId, setSelectedId } = useBusinesses();
  const { active, elapsed, maxSeconds, startTimer, stopTimer, cancelTimer, updateTimer } = useTimer();
  const toast = useToast();

  const [myTimeOff, setMyTimeOff] = useState([]);
  const [manualThisMonth, setManualThisMonth] = useState(null);
  const [myTasks, setMyTasks] = useState([]);

  const [description, setDescription] = useState('');
  const [taskId, setTaskId] = useState('');

  const [manualOpen, setManualOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  useEffect(() => { loadData(); }, [profile]);
  useEffect(() => { loadTasks(); }, [profile, selectedId]);

  // If a timer is running but description is empty in our local state, sync from active
  useEffect(() => {
    if (active) {
      if (!description) setDescription(active.description || '');
      if (!taskId && active.taskId) setTaskId(active.taskId);
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the user types or picks a task, update the global timer state too
  // so it persists with the timer record across page navigation.
  useEffect(() => {
    if (active) updateTimer({ description });
  }, [description]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (active) updateTimer({ taskId: taskId || null });
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    if (!profile) return;
    const now = new Date();
    const som = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const { data: manual } = await supabase
      .from('time_entries').select('*').eq('user_id', profile.id).eq('type', 'manual')
      .gte('date', som).order('date', { ascending: false }).limit(1);
    setManualThisMonth(manual?.[0] || null);

    const { data: to } = await supabase.from('time_off').select('*').eq('user_id', profile.id)
      .order('created_at', { ascending: false }).limit(5);
    setMyTimeOff(to || []);
  }

  async function loadTasks() {
    if (!profile) return;
    const isOTM = role === 'va' || role === 'otm';
    if (!isOTM) { setMyTasks([]); return; }
    const { data, error } = await supabase.rpc('list_otm_tasks', { p_user_id: profile.id });
    if (error) { setMyTasks([]); return; }
    const filtered = (data || []).filter(t =>
      ['todo', 'in_progress', 'revision_requested'].includes(t.status)
      && (selectedId === 'all' || t.business_id === selectedId)
    );
    setMyTasks(filtered.map(t => ({
      id: t.id,
      title: t.title + (t.is_unclaimed ? ' (unclaimed — claim from Tasks page)' : ''),
      business_id: t.business_id,
      status: t.status,
      businesses: { name: t.business_name }
    })));
  }

  function handleStart() {
    if (!selected) {
      toast.show('Pick a business from the header bar first.', 'warn');
      return;
    }
    let finalDescription = description.trim();
    if (taskId && !finalDescription) {
      const t = myTasks.find(x => x.id === taskId);
      if (t) finalDescription = t.title;
    }
    const result = startTimer({
      businessId: selected.id,
      businessName: selected.name,
      taskId: taskId || null,
      description: finalDescription
    });
    if (result?.error) {
      toast.show(result.error, 'error');
      return;
    }
    setDescription(finalDescription);
    toast.show(`Timer started on ${selected.name}. Keeps running across pages and even if you close this tab.`);
  }

  async function handleStop() {
    const result = await stopTimer();
    if (result?.error) {
      toast.show('Failed to save: ' + result.error, 'error');
      return;
    }
    if (result?.autoStop) {
      toast.show(`Timer auto-stopped at 8 hours. ${formatDuration(result.duration)} logged.`);
    } else {
      toast.show(`${formatDuration(result.duration)} logged.`);
    }
    setDescription('');
    setTaskId('');
    loadData();
  }

  function handleCancel() {
    if (!confirm('Cancel timer without saving the time?')) return;
    cancelTimer();
    setDescription('');
    setTaskId('');
    toast.show('Timer cancelled. Nothing saved.', 'warn');
  }

  // When user picks a task from dropdown, auto-fill description if blank
  function handleTaskChange(e) {
    const val = e.target.value;
    setTaskId(val);
    if (val && !description.trim()) {
      const t = myTasks.find(x => x.id === val);
      if (t) setDescription(t.title);
    }
  }

  const display = formatElapsed(elapsed);
  const pctTo8 = Math.min(100, (elapsed / maxSeconds) * 100);
  const remaining = maxSeconds - elapsed;
  const remainingHrs = Math.max(0, Math.floor(remaining / 3600));
  const remainingMin = Math.max(0, Math.floor((remaining % 3600) / 60));

  return (
    <div>
      <PageHeader kicker="Focus" title="Time Tracker" subtitle="Start the clock and log your work. Your timer keeps running even when you switch pages, switch tabs, or close your browser. It auto-stops at 8 hours." />

      {!selected && !active && (
        <div className="panel mb-5" style={{ background: 'rgba(184,134,11,0.08)', borderColor: 'rgba(184,134,11,0.3)' }}>
          <div className="text-warn text-sm">
            <strong>Pick a business first.</strong> Use the "Switch ▾" button in the header bar to select which business you're working on.
          </div>
        </div>
      )}

      {/* Live timer panel */}
      <div className="panel mb-6 relative overflow-hidden" style={{ paddingRight: 40 }}>
        {active && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: `linear-gradient(90deg, var(--crimson) ${pctTo8}%, var(--line) ${pctTo8}%)`
          }} />
        )}

        <div className="flex justify-between items-start flex-wrap gap-4">
          <div style={{ minWidth: 200 }}>
            <div className="font-bebas text-[11px] tracking-widest text-crimson mb-1">
              {active ? 'TRACKING' : 'READY'}
            </div>
            <div className="font-display font-bold text-ink leading-none" style={{ fontSize: 56 }}>
              {display}
            </div>
            {active && (
              <div className="mt-2 text-xs text-muted">
                Started {new Date(active.startedAt).toLocaleTimeString()}.
                {' '}{remainingHrs > 0 ? `${remainingHrs}h ` : ''}{remainingMin}m left until 8-hour auto-stop.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3" style={{ minWidth: 300, flex: 1 }}>
            <div>
              <label className="field-label">Working on</label>
              {active ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-cream-deep border border-line rounded">
                  <span style={businessDot(active.businessId)} />
                  <strong>{active.businessName || selected?.name || '—'}</strong>
                </div>
              ) : selected ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-cream-deep border border-line rounded">
                  <span style={businessDot(selected.id)} />
                  <strong>{selected.name}</strong>
                </div>
              ) : (
                <div className="text-sm text-muted italic px-3 py-2">No business selected</div>
              )}
            </div>

            {(role === 'va' || role === 'otm') && myTasks.length > 0 && (
              <div>
                <label className="field-label">Task (optional)</label>
                <select value={taskId} onChange={handleTaskChange}>
                  <option value="">— No specific task —</option>
                  {myTasks.map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="field-label">What are you doing?</label>
              <input
                className="input"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description of your work"
              />
              <div className="text-xs text-muted mt-1">This appears on client timesheets.</div>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-line-soft flex gap-3 flex-wrap">
          {!active ? (
            <>
              <button className="btn-ink" onClick={handleStart} disabled={!selected}>
                START TIMER
              </button>
              <button className="btn-ghost" onClick={() => setManualOpen(true)}>
                + MANUAL ENTRY
              </button>
            </>
          ) : (
            <>
              <button className="btn-crimson" onClick={handleStop}>
                STOP & SAVE
              </button>
              <button className="btn-ghost" onClick={handleCancel}>
                CANCEL (no save)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Time off */}
      <div className="panel">
        <div className="flex justify-between items-start mb-3">
          <div><SectionTitle kicker="Request PTO">Time off</SectionTitle></div>
          <button className="btn-sm ink" onClick={() => setTimeOffOpen(true)}>+ REQUEST TIME OFF</button>
        </div>
        {myTimeOff.length === 0 ? (
          <Empty>No requests submitted yet.</Empty>
        ) : (
          <table>
            <thead><tr><th>Type</th><th>Dates</th><th>Submitted</th><th>Status</th></tr></thead>
            <tbody>
              {myTimeOff.map(t => (
                <tr key={t.id}>
                  <td>{t.type}</td>
                  <td>{formatDate(t.start_date)} → {formatDate(t.end_date)}</td>
                  <td>{formatDate(t.created_at)}</td>
                  <td><span className={`badge ${t.status === 'approved' ? 'active' : t.status === 'denied' ? 'hold' : 'pending'}`}>{t.status.toUpperCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ManualEntryModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        profile={profile}
        businesses={businesses}
        myTasks={myTasks}
        manualThisMonth={manualThisMonth}
        onSaved={() => { setManualOpen(false); loadData(); }}
      />
      <TimeOffModal
        open={timeOffOpen}
        onClose={() => setTimeOffOpen(false)}
        profile={profile}
        onSaved={() => { setTimeOffOpen(false); loadData(); }}
      />
    </div>
  );
}

function ManualEntryModal({ open, onClose, profile, businesses, myTasks, manualThisMonth, onSaved }) {
  const [businessId, setBusinessId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [desc, setDesc] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open && businesses.length && !businessId) setBusinessId(businesses[0].id);
  }, [open, businesses]);

  const tasksForBiz = myTasks.filter(t => t.business_id === businessId);

  async function save() {
    setErr('');
    if (!businessId) return setErr('Pick a business.');
    const h = parseFloat(hours) || 0;
    const m = parseFloat(minutes) || 0;
    if (h === 0 && m === 0) return setErr('Enter some time.');
    if (!desc.trim()) return setErr('Describe the work.');
    if (!reason.trim()) return setErr('Add a reason for the manual entry.');
    const total = h * 3600 + m * 60;
    if (total > 8 * 3600) return setErr('Maximum is 8 hours.');
    const entryDate = new Date(date);
    if (!sameMonth(entryDate, new Date())) return setErr('Manual entries must be in the current month.');

    setBusy(true);
    const { error } = await supabase.from('time_entries').insert({
      user_id: profile.id, business_id: businessId,
      task_id: taskId || null,
      description: desc.trim(), duration: total,
      date: entryDate.toISOString(), type: 'manual', reason: reason.trim()
    });
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit('time_entry.create', 'time_entry', null, { type: 'manual', duration: total });
    const biz = businesses.find(b => b.id === businessId);
    toast.show(`${formatDuration(total)} manual entry logged for ${biz?.name || 'business'}.`);
    setBusinessId(''); setTaskId(''); setHours(''); setMinutes(''); setDesc(''); setReason('');
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Manual time entry" subtitle="Use when you forgot to start the timer. Limits apply."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy || !!manualThisMonth}>{busy ? 'SAVING…' : 'LOG ENTRY'}</button>
      </>}>
      {manualThisMonth ? (
        <div className="text-sm bg-crimson/5 border border-crimson/20 text-crimson p-3 rounded mb-4">
          <strong>LIMIT REACHED.</strong> You already used your manual entry this month ({formatDuration(manualThisMonth.duration)} on {formatDate(manualThisMonth.date)}).
        </div>
      ) : (
        <div className="text-sm bg-warn/10 border border-warn/30 text-warn p-3 rounded mb-4">
          <strong>HEADS UP.</strong> This is your one manual entry for this month. Maximum 8 hours.
        </div>
      )}

      <div className="mb-3">
        <label className="field-label">Business</label>
        <select value={businessId} onChange={e => { setBusinessId(e.target.value); setTaskId(''); }}>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      {tasksForBiz.length > 0 && (
        <div className="mb-3">
          <label className="field-label">Task (optional)</label>
          <select value={taskId} onChange={e => {
            setTaskId(e.target.value);
            const t = tasksForBiz.find(x => x.id === e.target.value);
            if (t && !desc) setDesc(t.title);
          }}>
            <option value="">— No specific task —</option>
            {tasksForBiz.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
      )}
      <div className="mb-3">
        <label className="field-label">Date</label>
        <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Hours</label><input type="number" className="input" min="0" max="8" step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></div>
        <div><label className="field-label">Minutes</label><input type="number" className="input" min="0" max="59" value={minutes} onChange={e => setMinutes(e.target.value)} /></div>
      </div>
      <div className="mb-3"><label className="field-label">What did you work on?</label><textarea className="input" rows="3" value={desc} onChange={e => setDesc(e.target.value)}></textarea></div>
      <div className="mb-3"><label className="field-label">Why are you logging manually?</label><input className="input" value={reason} onChange={e => setReason(e.target.value)} /></div>
      {err && <div className="text-sm text-crimson mt-2">{err}</div>}
    </Modal>
  );
}

function TimeOffModal({ open, onClose, profile, onSaved }) {
  const [type, setType] = useState('vacation');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    setErr('');
    if (!start || !end) return setErr('Pick start and end dates.');
    if (new Date(start) > new Date(end)) return setErr('End date must be after start.');
    setBusy(true);
    const { error } = await supabase.from('time_off').insert({
      user_id: profile.id, type, start_date: start, end_date: end, reason: reason.trim()
    });
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit('time_off.request', 'time_off', null, { type });
    toast.show('Time off request submitted for admin review.');
    setStart(''); setEnd(''); setReason('');
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="Request time off" subtitle="Submit to admin for review."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SUBMITTING…' : 'SUBMIT REQUEST'}</button>
      </>}>
      <div className="mb-3">
        <label className="field-label">Type</label>
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="vacation">Vacation</option>
          <option value="sick">Sick leave</option>
          <option value="personal">Personal day</option>
          <option value="bereavement">Bereavement</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Start date</label><input type="date" className="input" value={start} onChange={e => setStart(e.target.value)} /></div>
        <div><label className="field-label">End date</label><input type="date" className="input" value={end} onChange={e => setEnd(e.target.value)} /></div>
      </div>
      <div><label className="field-label">Reason / notes</label><textarea className="input" rows="3" value={reason} onChange={e => setReason(e.target.value)}></textarea></div>
      {err && <div className="text-sm text-crimson mt-2">{err}</div>}
    </Modal>
  );
}
