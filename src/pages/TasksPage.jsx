import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { Empty } from '../components/PageHeader';
import Modal from '../components/Modal';

const STATUS_COLS = [
  { key: 'todo', label: 'TO DO', color: 'var(--slate)' },
  { key: 'in_progress', label: 'IN PROGRESS', color: 'var(--crimson)' },
  { key: 'submitted', label: 'SUBMITTED', color: 'var(--warn)' },
  { key: 'approved', label: 'APPROVED', color: 'var(--ok)' }
];

export default function TasksPage({ role, profile }) {
  const [tasks, setTasks] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [filterBusiness, setFilterBusiness] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => { loadAll(); }, [role, profile]);

  async function loadAll() {
    let bq = supabase.from('businesses').select('*').eq('active', true).order('name');
    if (role === 'client' && profile) bq = bq.eq('client_id', profile.id);
    else if (role === 'va' && profile) {
      const { data: a } = await supabase.from('va_assignments').select('business_id').eq('va_id', profile.id);
      const ids = (a || []).map(x => x.business_id);
      if (!ids.length) { setBusinesses([]); setTasks([]); return; }
      bq = bq.in('id', ids);
    }
    const { data: biz } = await bq;
    setBusinesses(biz || []);

    let tq = supabase.from('tasks')
      .select('*, businesses(name), users!tasks_assignee_id_fkey(name)')
      .order('created_at', { ascending: false });
    if (role === 'va' && profile) tq = tq.eq('assignee_id', profile.id);
    const { data: t } = await tq;
    setTasks(t || []);
  }

  async function updateStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // VAs can only move todo/in_progress/revision_requested -> in_progress/submitted
    // Clients can move submitted -> approved/revision_requested
    if (role === 'va') {
      if (!['todo', 'in_progress', 'submitted', 'revision_requested'].includes(newStatus)) return;
    }
    if (role === 'client') {
      if (!['approved', 'revision_requested'].includes(newStatus)) return;
      if (newStatus === 'revision_requested') {
        const reason = prompt('Reason for revision?');
        if (!reason) return;
        const { error } = await supabase.from('tasks').update({
          status: 'revision_requested',
          revision_reason: reason,
          revision_count: (task.revision_count || 0) + 1
        }).eq('id', taskId);
        if (error) return alert(error.message);
        await logAudit('task.revision_requested', 'task', taskId, { reason });
        loadAll();
        return;
      }
      if (newStatus === 'approved') {
        const { error } = await supabase.from('tasks').update({
          status: 'approved',
          approved_at: new Date().toISOString()
        }).eq('id', taskId);
        if (error) return alert(error.message);
        await logAudit('task.approved', 'task', taskId);
        loadAll();
        return;
      }
    }
    // default update
    const patch = { status: newStatus };
    if (newStatus === 'submitted') patch.submitted_at = new Date().toISOString();
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) return alert(error.message);
    await logAudit(`task.status_${newStatus}`, 'task', taskId);
    loadAll();
  }

  function filtered() {
    return tasks.filter(t => {
      if (filterBusiness !== 'all' && t.business_id !== filterBusiness) return false;
      if (filterAssignee === 'me' && t.assignee_id !== profile?.id) return false;
      return true;
    });
  }

  const canCreate = role === 'admin' || role === 'sub_admin' || role === 'client';
  const ts = filtered();

  return (
    <div>
      <PageHeader
        kicker="Execute"
        title="Tasks"
        subtitle="Click a task to view details, comments, and attachments."
        right={canCreate && <button className="btn-sm ink" onClick={() => setNewOpen(true)}>+ NEW TASK</button>}
      />

      <div className="flex gap-2 flex-wrap mb-5 items-center">
        <span className="font-bebas text-[11px] tracking-widest text-muted">FILTER</span>
        <select value={filterBusiness} onChange={e => setFilterBusiness(e.target.value)}>
          <option value="all">All businesses</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
          <option value="all">All assignees</option>
          <option value="me">Assigned to me</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {STATUS_COLS.map(col => {
          const colTasks = ts.filter(t => t.status === col.key);
          return (
            <div key={col.key} className="bg-cream-deep border border-line rounded p-3 min-h-[400px]">
              <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center" style={{ color: col.color }}>
                <span>{col.label}</span>
                <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{colTasks.length}</span>
              </div>
              {colTasks.length === 0 ? (
                <div className="text-xs text-muted italic text-center py-4">Empty</div>
              ) : (
                colTasks.map(t => (
                  <TaskCard key={t.id} task={t} role={role} profile={profile} onClick={() => nav(`/tasks/${t.id}`)} onStatusChange={updateStatus} />
                ))
              )}
            </div>
          );
        })}
        {/* Revision Requested column if any exist */}
        {ts.some(t => t.status === 'revision_requested') && (
          <div className="bg-cream-deep border border-crimson/40 rounded p-3 min-h-[400px] col-span-full">
            <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center text-crimson">
              <span>REVISION REQUESTED</span>
              <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{ts.filter(t => t.status === 'revision_requested').length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ts.filter(t => t.status === 'revision_requested').map(t => (
                <TaskCard key={t.id} task={t} role={role} profile={profile} onClick={() => nav(`/tasks/${t.id}`)} onStatusChange={updateStatus} />
              ))}
            </div>
          </div>
        )}
      </div>

      <NewTaskModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        role={role}
        profile={profile}
        businesses={businesses}
        onCreated={() => { setNewOpen(false); loadAll(); }}
      />
    </div>
  );
}

function TaskCard({ task, role, profile, onClick, onStatusChange }) {
  return (
    <div className="bg-paper border border-line rounded p-3 mb-2 cursor-pointer hover:border-ink transition-all" onClick={onClick}>
      <div className="font-medium text-sm mb-1.5 leading-snug">{task.title}</div>
      <div className="text-[11px] text-muted flex justify-between gap-2">
        <span className="font-bebas tracking-wider text-crimson">{task.businesses?.name || '—'}</span>
        <span>{task.users?.name || 'Unassigned'}</span>
      </div>
      {task.status === 'revision_requested' && task.revision_reason && (
        <div className="text-[11px] bg-crimson/5 border border-crimson/20 text-crimson px-2 py-1 mt-2 rounded">
          <strong>Revision:</strong> {task.revision_reason}
        </div>
      )}
      {role === 'va' && task.assignee_id === profile?.id && (
        <div className="mt-2 flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
          {task.status === 'todo' && <button className="btn-sm" onClick={() => onStatusChange(task.id, 'in_progress')}>Start</button>}
          {task.status === 'in_progress' && <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'submitted')}>Submit</button>}
          {task.status === 'revision_requested' && <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'in_progress')}>Resume</button>}
        </div>
      )}
      {role === 'client' && task.status === 'submitted' && (
        <div className="mt-2 flex gap-1" onClick={e => e.stopPropagation()}>
          <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'approved')}>Approve</button>
          <button className="btn-sm danger" onClick={() => onStatusChange(task.id, 'revision_requested')}>Request revision</button>
        </div>
      )}
    </div>
  );
}

function NewTaskModal({ open, onClose, role, profile, businesses, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assignableVAs, setAssignableVAs] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function loadVAs() {
      if (!businessId) { setAssignableVAs([]); return; }
      const { data: a } = await supabase.from('va_assignments').select('va_id, users!inner(id, name, active)').eq('business_id', businessId);
      const vas = (a || []).filter(x => x.users?.active).map(x => x.users);
      setAssignableVAs(vas);
      if (vas.length && !assigneeId) setAssigneeId(vas[0].id);
    }
    loadVAs();
  }, [businessId]);

  useEffect(() => {
    if (open && businesses.length && !businessId) setBusinessId(businesses[0].id);
  }, [open, businesses]);

  async function save() {
    setErr('');
    if (!title.trim()) return setErr('Task title is required.');
    if (!businessId) return setErr('Pick a business.');
    const { data: { user } } = await supabase.auth.getUser();
    setBusy(true);
    const { data, error } = await supabase.from('tasks').insert({
      business_id: businessId,
      created_by: user.id,
      assignee_id: assigneeId || null,
      title: title.trim(),
      description: description.trim(),
      due_date: due || null,
      priority,
      status: 'todo'
    }).select().single();
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit('task.create', 'task', data.id, { title });
    setTitle(''); setDescription(''); setDue(''); setAssigneeId('');
    onCreated();
  }

  return (
    <Modal open={open} onClose={onClose} title="New task" subtitle="Create a task and assign it to a VA."
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'CREATING…' : 'CREATE TASK'}</button>
        </>
      }>
      <div className="mb-3">
        <label className="field-label">Task title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to get done?" />
      </div>
      <div className="mb-3">
        <label className="field-label">Description / instructions</label>
        <textarea className="input" rows="4" value={description} onChange={e => setDescription(e.target.value)} placeholder="Detailed instructions for the VA..."></textarea>
      </div>
      <div className="mb-3">
        <label className="field-label">Business</label>
        <select value={businessId} onChange={e => setBusinessId(e.target.value)}>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div className="mb-3">
        <label className="field-label">Assign to VA</label>
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {assignableVAs.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="text-xs text-muted mt-1">Only VAs assigned to this business appear here.</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Due date</label>
          <input type="date" className="input" value={due} onChange={e => setDue(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Priority</label>
          <select value={priority} onChange={e => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
      <div className="text-xs text-muted mt-4 pt-3 border-t border-line-soft">
        You can add file attachments, audio instructions, and comments after creating the task.
      </div>
      {err && <div className="text-sm text-crimson mt-2">{err}</div>}
    </Modal>
  );
}
