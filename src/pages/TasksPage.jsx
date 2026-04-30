import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { useBusinesses, useToast } from '../components/BusinessSelector';
import { FileAttachPicker, uploadFilesToStorage } from '../components/MediaUploader';
import { getBusinessColor, businessDot } from '../lib/businessColor';

const STATUS_COLS = [
  { key: 'todo', label: 'TO DO', color: 'var(--slate)' },
  { key: 'in_progress', label: 'IN PROGRESS', color: 'var(--crimson)' },
  { key: 'submitted', label: 'SUBMITTED', color: 'var(--warn)' },
  { key: 'approved', label: 'APPROVED', color: 'var(--ok)' }
];

export default function TasksPage({ role, profile }) {
  const [tasks, setTasks] = useState([]);
  const [unreadByTask, setUnreadByTask] = useState({});
  const [newOpen, setNewOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const nav = useNavigate();
  const toast = useToast();
  const { businesses, selected, selectedId } = useBusinesses();

  useEffect(() => { loadAll(); }, [role, profile]);

  async function loadAll() {
    setLoadError('');
    const { data: t, error: tErr } = await supabase.from('tasks')
      .select('*, businesses(name, client_id, clients(name)), users!tasks_assignee_id_fkey(name)')
      .order('created_at', { ascending: false });
    if (tErr) setLoadError(tErr.message);
    setTasks(t || []);

    if (profile && t?.length) {
      const taskIds = t.map(x => x.id);
      const [{ data: allComments }, { data: reads }] = await Promise.all([
        supabase.from('task_comments').select('id, task_id, author_id, created_at').in('task_id', taskIds),
        supabase.from('task_comment_reads').select('comment_id').eq('user_id', profile.id)
      ]);
      const readSet = new Set((reads || []).map(r => r.comment_id));
      const counts = {};
      (allComments || []).forEach(c => {
        if (c.author_id === profile.id) return;
        if (readSet.has(c.id)) return;
        counts[c.task_id] = (counts[c.task_id] || 0) + 1;
      });
      setUnreadByTask(counts);
    }
  }

  async function updateStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (role === 'client') {
      if (newStatus === 'revision_requested') {
        const reason = prompt('Reason for revision?');
        if (!reason) return;
        const { error } = await supabase.from('tasks').update({
          status: 'revision_requested', revision_reason: reason,
          revision_count: (task.revision_count || 0) + 1
        }).eq('id', taskId);
        if (error) return toast.show(error.message, 'error');
        await logAudit('task.revision_requested', 'task', taskId, { reason });
        toast.show(`Revision requested on "${task.title}" for ${task.businesses?.name}.`);
        loadAll();
        return;
      }
      if (newStatus === 'approved') {
        const { error } = await supabase.from('tasks').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', taskId);
        if (error) return toast.show(error.message, 'error');
        await logAudit('task.approved', 'task', taskId);
        toast.show(`"${task.title}" approved for ${task.businesses?.name}.`);
        loadAll();
        return;
      }
    }

    const patch = { status: newStatus };
    if (newStatus === 'submitted') patch.submitted_at = new Date().toISOString();
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) return toast.show(error.message, 'error');
    await logAudit(`task.status_${newStatus}`, 'task', taskId);

    if (newStatus === 'submitted') {
      const clientName = task.businesses?.clients?.name || 'the client';
      toast.show(`"${task.title}" submitted for review on ${task.businesses?.name}. ${clientName} will see it.`);
    } else {
      toast.show(`"${task.title}" moved to ${newStatus.replace('_', ' ')}.`);
    }
    loadAll();
  }

  function filtered() {
    return tasks.filter(t => {
      if (selectedId !== 'all' && t.business_id !== selectedId) return false;
      return true;
    });
  }

  const ts = filtered();

  return (
    <div>
      <PageHeader
        kicker="Execute"
        title="Tasks"
        subtitle={selected ? `Tasks for ${selected.name}.` : 'All tasks across your businesses.'}
        right={<>
          <button className="btn-sm" onClick={loadAll}>↻ Refresh</button>{' '}
          <button className="btn-sm ink" onClick={() => setNewOpen(true)}>+ NEW TASK</button>
        </>}
      />

      {loadError && (
        <div className="panel mb-5" style={{ borderColor: 'var(--crimson)', background: 'rgba(168,4,4,0.06)' }}>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-1">LOAD ERROR</div>
          <div className="text-sm">{loadError}</div>
        </div>
      )}

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
                  <TaskCard
                    key={t.id} task={t} role={role} profile={profile}
                    unread={unreadByTask[t.id] || 0}
                    onClick={() => nav(`/tasks/${t.id}`)}
                    onStatusChange={updateStatus}
                  />
                ))
              )}
            </div>
          );
        })}
        {ts.some(t => t.status === 'revision_requested') && (
          <div className="bg-cream-deep border border-crimson/40 rounded p-3 min-h-[400px] col-span-full">
            <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center text-crimson">
              <span>REVISION REQUESTED</span>
              <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{ts.filter(t => t.status === 'revision_requested').length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {ts.filter(t => t.status === 'revision_requested').map(t => (
                <TaskCard key={t.id} task={t} role={role} profile={profile} unread={unreadByTask[t.id] || 0} onClick={() => nav(`/tasks/${t.id}`)} onStatusChange={updateStatus} />
              ))}
            </div>
          </div>
        )}
      </div>

      <NewTaskModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        role={role} profile={profile}
        businesses={businesses}
        presetBusinessId={selected?.id}
        onCreated={() => { setNewOpen(false); loadAll(); }}
      />
    </div>
  );
}

function TaskCard({ task, role, profile, unread, onClick, onStatusChange }) {
  const color = getBusinessColor(task.business_id);
  const isOTM = role === 'va' || role === 'otm';
  return (
    <div className="bg-paper border rounded p-3 mb-2 cursor-pointer hover:border-ink transition-all relative"
         style={{ borderLeftWidth: 3, borderLeftColor: color.hex, borderColor: 'var(--line)' }}
         onClick={onClick}>
      {unread > 0 && (
        <span className="absolute top-2 right-2 bg-crimson text-cream font-bebas text-[10px] tracking-widest px-2 py-0.5 rounded-full">
          {unread} NEW
        </span>
      )}
      <div className="font-medium text-sm mb-1.5 leading-snug pr-12">{task.title}</div>
      <div className="text-[11px] text-muted flex justify-between gap-2 items-center">
        <span className="flex items-center gap-1.5 truncate">
          <span style={businessDot(task.business_id)} />
          <span className="font-bebas tracking-wider truncate" style={{ color: color.hex }}>{task.businesses?.name || '—'}</span>
        </span>
        <span className="truncate">{task.users?.name || 'Unassigned'}</span>
      </div>
      {task.status === 'revision_requested' && task.revision_reason && (
        <div className="text-[11px] bg-crimson/5 border border-crimson/20 text-crimson px-2 py-1 mt-2 rounded">
          <strong>Revision:</strong> {task.revision_reason}
        </div>
      )}
      {isOTM && task.assignee_id === profile?.id && (
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

function NewTaskModal({ open, onClose, role, profile, businesses, presetBusinessId, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assignableOTMs, setAssignableOTMs] = useState([]);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    async function loadOTMs() {
      if (!businessId) { setAssignableOTMs([]); return; }
      const { data: a } = await supabase.from('va_assignments').select('va_id, users!inner(id, name, active)').eq('business_id', businessId);
      const otms = (a || []).filter(x => x.users?.active).map(x => x.users);
      setAssignableOTMs(otms);
      if (otms.length && !assigneeId) {
        const isOTM = role === 'va' || role === 'otm';
        if (isOTM && otms.find(o => o.id === profile?.id)) {
          setAssigneeId(profile.id);
        } else {
          setAssigneeId(otms[0].id);
        }
      }
    }
    loadOTMs();
  }, [businessId]);

  useEffect(() => {
    if (!open) return;
    const preferredId = presetBusinessId && businesses.find(b => b.id === presetBusinessId)
      ? presetBusinessId : (businesses[0]?.id || '');
    setBusinessId(preferredId);
    setTitle(''); setDescription(''); setDue(''); setAssigneeId(''); setPriority('normal');
    setPendingFiles([]); setErr('');
  }, [open, businesses, presetBusinessId]);

  async function save() {
    setErr('');
    if (!title.trim()) return setErr('Task title is required.');
    if (!businessId) return setErr('Pick a business.');
    const { data: { user } } = await supabase.auth.getUser();
    setBusy(true);
    const { data, error } = await supabase.from('tasks').insert({
      business_id: businessId, created_by: user.id,
      assignee_id: assigneeId || null,
      title: title.trim(), description: description.trim(),
      due_date: due || null, priority, status: 'todo'
    }).select('*, businesses(name), users!tasks_assignee_id_fkey(name)').single();
    if (error) { setBusy(false); return setErr(error.message); }

    // Upload any attachments
    if (pendingFiles.length > 0) {
      const results = await uploadFilesToStorage('task-attachments', pendingFiles, `tasks/${data.id}`);
      const rows = results.filter(r => r.path).map(r => ({
        task_id: data.id,
        uploaded_by: user.id,
        file_name: r.file.name,
        file_path: r.path,
        file_size: r.file.size,
        mime_type: r.file.type
      }));
      if (rows.length > 0) {
        await supabase.from('task_attachments').insert(rows);
      }
    }

    await logAudit('task.create', 'task', data.id, { title });
    setBusy(false);
    const bizName = data.businesses?.name;
    const otmName = data.users?.name || 'Unassigned';
    toast.show(`"${title}" created for ${bizName} → ${otmName}${pendingFiles.length > 0 ? ` with ${pendingFiles.length} file(s)` : ''}.`);
    onCreated();
  }

  const selectedBiz = businesses.find(b => b.id === businessId);

  return (
    <Modal open={open} onClose={onClose} title="New task" subtitle="Create a task and assign it to an OTM."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'CREATING…' : 'CREATE TASK'}</button>
      </>}>
      <div className="mb-3">
        <label className="field-label">Task title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to get done?" />
      </div>
      <div className="mb-3">
        <label className="field-label">Description / instructions</label>
        <textarea className="input" rows="4" value={description} onChange={e => setDescription(e.target.value)}></textarea>
      </div>
      <div className="mb-3">
        <label className="field-label">Business</label>
        <select value={businessId} onChange={e => setBusinessId(e.target.value)}>
          {businesses.length === 0 && <option value="">No businesses available</option>}
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {selectedBiz && (
          <div className="flex items-center gap-2 mt-2 text-xs text-muted">
            <span style={businessDot(selectedBiz.id)} />
            <span>Task will be created for <strong>{selectedBiz.name}</strong></span>
          </div>
        )}
      </div>
      <div className="mb-3">
        <label className="field-label">Assign to OTM</label>
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {assignableOTMs.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="text-xs text-muted mt-1">Only OTMs assigned to this business appear here.</div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Due date</label><input type="date" className="input" value={due} onChange={e => setDue(e.target.value)} /></div>
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
      <div className="mb-3">
        <label className="field-label">Attachments (optional)</label>
        <FileAttachPicker files={pendingFiles} onChange={setPendingFiles} disabled={busy} />
        <div className="text-xs text-muted mt-1">Reference files: images, video, audio, PDFs, docs. Max 100 MB each.</div>
      </div>
      {err && <div className="text-sm text-crimson mt-3">{err}</div>}
    </Modal>
  );
}
