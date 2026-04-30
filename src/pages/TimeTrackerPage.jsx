import { useEffect, useRef, useState } from 'react';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../components/PageHeader';
import Modal from '../components/Modal';
import { useBusinesses, useToast } from '../components/BusinessSelector';
import { businessDot } from '../lib/businessColor';
import { formatDate, formatDuration, sameMonth } from '../lib/format';

export default function TimeTrackerPage({ role, profile }) {
  const { businesses, selected, selectedId, setSelectedId, setTimerActive } = useBusinesses();
  const toast = useToast();

  const [myTimeOff, setMyTimeOff] = useState([]);
  const [manualThisMonth, setManualThisMonth] = useState(null);
  const [myTasks, setMyTasks] = useState([]);

  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [description, setDescription] = useState('');
  const [taskId, setTaskId] = useState('');
  const startRef = useRef(null);
  const intervalRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const idleCheckRef = useRef(null);
  const [idleAlert, setIdleAlert] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);

  useEffect(() => { loadData(); }, [profile]);
  useEffect(() => { loadTasks(); }, [profile, selectedId]);

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
    let q = supabase.from('tasks')
      .select('id, title, business_id, status, businesses(name)')
      .eq('assignee_id', profile.id)
      .in('status', ['todo', 'in_progress', 'revision_requested'])
      .order('created_at', { ascending: false });
    if (selectedId !== 'all') q = q.eq('business_id', selectedId);
    const { data } = await q;
    setMyTasks(data || []);
  }

  function startTimer() {
    if (!selected) { toast.show('Pick a business from the header bar first.', 'warn'); return; }
    startRef.current = Date.now();
    setRunning(true);
    setTimerActive(true);
    setElapsed(0);
    lastActivityRef.current = Date.now();
    setIdleAlert(false);

    // If a task is selected and no description yet, prefill from task title
    if (taskId && !description) {
      const t = myTasks.find(x => x.id === taskId);
      if (t) setDescription(t.title);
    }

    intervalRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    idleCheckRef.current = setInterval(() => {
      if (Date.now() - lastActivityRef.current > 10 * 60 * 1000) setIdleAlert(true);
    }, 30000);

    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, markActivity)
    );
  }

  function markActivity() {
    lastActivityRef.current = Date.now();
    if (idleAlert) setIdleAlert(false);
  }

  async function stopTimer() {
    if (!running) return;
    const duration = Math.floor((Date.now() - startRef.current) / 1000);
    const bizForSave = selected;
    if (duration < 10) {
      if (!confirm('Less than 10 seconds tracked. Save anyway?')) { cleanupTimer(); return; }
    }
    const { error } = await supabase.from('time_entries').insert({
      user_id: profile.id,
      business_id: bizForSave.id,
      task_id: taskId || null,
      description: description.trim() || '(no description)',
      duration,
      date: new Date().toISOString(),
      type: 'timer'
    });
    if (error) { toast.show('Failed to save entry: ' + error.message, 'error'); return; }
    await logAudit('time_entry.create', 'time_entry', null, { duration, type: 'timer', role });
    toast.show(`${formatDuration(duration)} logged for ${bizForSave.name}.`);
    cleanupTimer();
    setDescription('');
    setTaskId('');
    loadData();
  }

  function cleanupTimer() {
    setRunning(false);
    setTimerActive(false);
    setElapsed(0);
    setIdleAlert(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (idleCheckRef.current) clearInterval(idleCheckRef.current);
    ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev =>
      document.removeEventListener(ev, markActivity)
    );
  }

  useEffect(() => () => { cleanupTimer(); setTimerActive(false); }, []);

  // When user picks a task from dropdown, auto-fill description if blank
  function handleTaskChange(e) {
    const val = e.target.value;
    setTaskId(val);
    if (val && !description.trim()) {
      const t = myTasks.find(x => x.id === val);
      if (t) setDescription(t.title);
    }
  }

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const display = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const nextMonthName = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
    .toLocaleString('en-US', { month: 'long' });

  const isOTM = role === 'va' || role === 'otm';

  // Filter tasks by selected business if a specific one chosen
  const tasksForDropdown = selectedId === 'all'
    ? myTasks
    : myTasks.filter(t => t.business_id === selectedId);

  return (
    <div>
      <PageHeader kicker="Focus" title="Time Tracker" subtitle="Start the clock and log your work. Your active business shows in the bar above." />

      {!selected && (
        <div className="panel mb-5" style={{ background: 'rgba(184,134,11,0.08)', borderColor: 'rgba(184,134,11,0.3)' }}>
          <div className="text-warn text-sm">
            <strong>Pick a business first.</strong> Use the "Switch ▾" button in the header bar to select which business you're working on.
          </div>
        </div>
      )}

      {idleAlert && (
        <div className="panel mb-5 flex items-center justify-between gap-4" style={{ background: 'rgba(184,134,11,0.08)', borderColor: 'rgba(184,134,11,0.3)' }}>
          <div className="text-warn text-sm">
            <strong>Are you still working?</strong> No activity detected for 10 minutes.
          </div>
          <div className="flex gap-2">
            <button className="btn-sm ink" onClick={() => { markActivity(); }}>YES, KEEP GOING</button>
            <button className="btn-sm" onClick={stopTimer}>STOP TIMER</button>
          </div>
        </div>
      )}

      <div className="panel mb-6 relative overflow-hidden" style={{ paddingRight: 40 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 4, background: running ? 'var(--crimson)' : 'var(--ink)' }} />
        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-10">
          <div>
            <div className="font-bebas font-variant-numeric tabular-nums" style={{ fontSize: 72, letterSpacing: '0.04em', lineHeight: 1, color: running ? 'var(--crimson)' : 'var(--ink)' }}>
              {display}
            </div>
            <div className="font-bebas text-xs tracking-widest mt-2 mb-5" style={{ color: running ? 'var(--crimson)' : 'var(--muted)' }}>
              {running ? (<><span style={{ color: 'var(--crimson)', marginRight: 8, animation: 'pulse 1.5s infinite' }}>●</span>TRACKING</>) : 'READY'}
            </div>
            <div className="flex gap-2">
              {!running ? (
                <button className="btn-ink px-8 py-3" onClick={startTimer} disabled={!selected}>START</button>
              ) : (
                <button className="btn-crimson px-8 py-3" onClick={stopTimer}>STOP</button>
              )}
            </div>
          </div>
          <div className="flex flex-col justify-center">
            {selected && (
              <div className="mb-4 bg-cream-deep border border-line p-3 rounded flex items-center gap-3">
                <span style={businessDot(selected.id)} />
                <div>
                  <div className="font-bebas text-[10px] tracking-widest text-crimson">WORKING ON</div>
                  <div className="font-medium">{selected.name}</div>
                </div>
              </div>
            )}
            {isOTM && tasksForDropdown.length > 0 && (
              <div className="mb-3">
                <label className="field-label">Working on which task?</label>
                <select value={taskId} onChange={handleTaskChange}>
                  <option value="">— No specific task —</option>
                  {tasksForDropdown.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.title}{selectedId === 'all' ? ` — ${t.businesses?.name}` : ''}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-muted mt-1">Picking a task auto-fills the description below and links your time to it.</div>
              </div>
            )}
            <div>
              <label className="field-label">What are you working on?</label>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of your work..." />
              <div className="text-xs text-muted mt-1">This appears on client timesheets.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3">
          <div><SectionTitle kicker="Forgot to clock in?">Manual entry</SectionTitle></div>
          <button className="btn-sm ink" onClick={() => setManualOpen(true)}>+ ADD ENTRY</button>
        </div>
        <div className="text-sm text-slate808 bg-slate808/5 border-l-4 border-slate808 px-4 py-3 mb-2">
          Manual entries are limited to <strong>one per calendar month</strong> and a maximum of <strong>8 hours</strong>.
        </div>
        <div className="text-xs text-muted mt-3">
          {manualThisMonth ? (
            <>You've used your manual entry for {new Date().toLocaleString('en-US', { month: 'long' })}: <strong>{formatDuration(manualThisMonth.duration)}</strong> on {formatDate(manualThisMonth.date)}. Next available: {nextMonthName}.</>
          ) : (
            <>You have <strong>1 manual entry available</strong> this month, up to 8 hours.</>
          )}
        </div>
      </div>

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

      <ManualEntryModal open={manualOpen} onClose={() => setManualOpen(false)} profile={profile} businesses={businesses} myTasks={myTasks} manualThisMonth={manualThisMonth} onSaved={() => { setManualOpen(false); loadData(); }} />
      <TimeOffModal open={timeOffOpen} onClose={() => setTimeOffOpen(false)} profile={profile} onSaved={() => { setTimeOffOpen(false); loadData(); }} />
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
