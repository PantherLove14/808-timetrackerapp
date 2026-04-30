import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { useBusinesses, useToast } from '../components/BusinessSelector';
import { FileAttachPicker, uploadFilesToStorage } from '../components/MediaUploader';
import { getBusinessColor, businessDot } from '../lib/businessColor';

const STATUS_COLS = [
  { key: 'todo',        label: 'TO DO',       color: 'var(--slate)' },
  { key: 'in_progress', label: 'IN PROGRESS', color: 'var(--crimson)' },
  { key: 'submitted',   label: 'SUBMITTED',   color: 'var(--warn)' },
  { key: 'approved',    label: 'APPROVED',    color: 'var(--ok)' }
];

export default function TasksPage({ role, profile }) {
  const [tasks, setTasks] = useState([]);
  const [unreadByTask, setUnreadByTask] = useState({});
  const [newOpen, setNewOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const nav = useNavigate();
  const toast = useToast();
  const { businesses, selected, selectedId } = useBusinesses();

  const isOTM = role === 'va' || role === 'otm';
  const isClient = role === 'client';
  const isAdmin = role === 'admin' || role === 'sub_admin';

  useEffect(() => { loadAll(); }, [role, profile]);

  async function loadAll() {
    if (!profile) return;
    setLoading(true);
    setLoadError('');
    try {
      let data = [];
      if (isOTM) {
        const r = await supabase.rpc('list_otm_tasks', { p_user_id: profile.id });
        if (r.error) throw r.error;
        data = r.data || [];
      } else if (isClient) {
        const r = await supabase.rpc('list_client_tasks', { p_client_auth_user_id: profile.auth_user_id });
        if (r.error) throw r.error;
        data = r.data || [];
      } else if (isAdmin) {
        // Admin uses /admin/tasks; this page is unused for admin but keep functional
        const r = await supabase.rpc('list_admin_tasks');
        if (r.error) throw r.error;
        data = r.data || [];
      }

      // Normalize so the rest of the page uses one shape regardless of source
      const normalized = data.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        due_date: t.due_date,
        revision_reason: t.revision_reason,
        revision_count: t.revision_count,
        created_at: t.created_at,
        business_id: t.business_id,
        business_name: t.business_name,
        client_id: t.client_id,
        client_name: t.client_name,
        assignee_id: t.assignee_id,
        assignee_name: t.assignee_name,
        creator_id: t.creator_id,
        creator_name: t.creator_name,
        creator_role: t.creator_role,
        is_unclaimed: t.is_unclaimed ?? (t.assignee_id == null),
        comment_count: t.comment_count || 0,
        attachment_count: t.attachment_count || 0
      }));
      setTasks(normalized);

      // Unread badges based on task_comments and task_comment_reads
      if (normalized.length > 0) {
        const ids = normalized.map(t => t.id);
        const [{ data: allComments }, { data: reads }] = await Promise.all([
          supabase.from('task_comments').select('id, task_id, author_id').in('task_id', ids),
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
      } else {
        setUnreadByTask({});
      }
    } catch (e) {
      console.error(e);
      setLoadError(e.message || 'Could not load tasks.');
    } finally {
      setLoading(false);
    }
  }

  async function claimTask(taskId) {
    const { error } = await supabase.rpc('claim_task', { p_task_id: taskId });
    if (error) { toast.show(error.message, 'error'); return; }
    await logAudit('task.claim', 'task', taskId);
    toast.show('Task claimed. You are now the assignee.');
    loadAll();
  }

  async function updateStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    if (isClient && newStatus === 'revision_requested') {
      const reason = prompt('Reason for revision?');
      if (!reason) return;
      const { error } = await supabase.from('tasks').update({
        status: 'revision_requested',
        revision_reason: reason,
        revision_count: (task.revision_count || 0) + 1
      }).eq('id', taskId);
      if (error) return toast.show(error.message, 'error');
      // Auto-post system message
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('task_comments').insert({
        task_id: taskId, author_id: user.id, author_name: profile.name,
        author_role: 'client',
        body: `${profile.name} requested revisions: "${reason}"`,
        system_message: true
      });
      await logAudit('task.revision_requested', 'task', taskId, { reason });
      toast.show(`Revision requested on "${task.title}".`);
      loadAll();
      return;
    }

    const patch = { status: newStatus };
    if (newStatus === 'submitted') patch.submitted_at = new Date().toISOString();
    if (newStatus === 'approved') patch.approved_at = new Date().toISOString();
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) return toast.show(error.message, 'error');

    // System message
    const { data: { user } } = await supabase.auth.getUser();
    let body = `${profile.name} updated status to ${newStatus.replace('_',' ')}.`;
    if (newStatus === 'in_progress') body = `${profile.name} started work on this task.`;
    if (newStatus === 'submitted') body = `${profile.name} submitted this task for review.`;
    if (newStatus === 'approved') body = `${profile.name} approved this task. Nice work.`;
    await supabase.from('task_comments').insert({
      task_id: taskId, author_id: user.id, author_name: profile.name,
      author_role: role === 'otm' ? 'va' : role,
      body, system_message: true
    });
    await logAudit(`task.status_${newStatus}`, 'task', taskId);

    if (newStatus === 'submitted') {
      toast.show(`"${task.title}" submitted for review on ${task.business_name}. ${task.client_name || 'the client'} will see it.`);
    } else {
      toast.show(`"${task.title}" → ${newStatus.replace('_',' ')}.`);
    }
    loadAll();
  }

  // Filter + group
  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (selectedId !== 'all' && t.business_id !== selectedId) return false;
      return true;
    });
  }, [tasks, selectedId]);

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

      {loading ? (
        <div className="panel text-center py-12 text-muted font-display italic">Loading tasks…</div>
      ) : (
        <>
          {/* OTM-only: callout for unassigned tasks they could claim */}
          {isOTM && filtered.some(t => t.is_unclaimed) && (
            <div className="panel mb-5" style={{ background: 'rgba(184,134,11,0.08)', borderColor: 'rgba(184,134,11,0.3)' }}>
              <div className="font-bebas tracking-widest text-xs text-warn mb-1">UNCLAIMED TASKS</div>
              <div className="text-sm">
                {filtered.filter(t => t.is_unclaimed).length} task(s) on your businesses are unassigned. Click <strong>CLAIM</strong> on any card to take ownership and start work.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {STATUS_COLS.map(col => {
              const colTasks = filtered.filter(t => t.status === col.key);
              return (
                <div key={col.key} className="bg-cream-deep border border-line rounded p-3 min-h-[400px]">
                  <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center" style={{ color: col.color }}>
                    <span>{col.label}</span>
                    <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{colTasks.length}</span>
                  </div>
                  {colTasks.length === 0 ? (
                    <div className="text-xs text-muted italic text-center py-4">Empty</div>
                  ) : colTasks.map(t => (
                    <TaskCard
                      key={t.id} task={t} role={role} profile={profile}
                      unread={unreadByTask[t.id] || 0}
                      onClick={() => nav(`/tasks/${t.id}`)}
                      onStatusChange={updateStatus}
                      onClaim={claimTask}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {filtered.some(t => t.status === 'revision_requested') && (
            <div className="bg-cream-deep border border-crimson/40 rounded p-3 min-h-[160px] mt-4">
              <div className="font-bebas tracking-widest text-xs pb-3 mb-3 border-b border-line flex justify-between items-center text-crimson">
                <span>REVISION REQUESTED</span>
                <span className="bg-paper border border-line px-2 py-0.5 rounded-full text-[10px]">{filtered.filter(t => t.status === 'revision_requested').length}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {filtered.filter(t => t.status === 'revision_requested').map(t => (
                  <TaskCard
                    key={t.id} task={t} role={role} profile={profile}
                    unread={unreadByTask[t.id] || 0}
                    onClick={() => nav(`/tasks/${t.id}`)}
                    onStatusChange={updateStatus}
                    onClaim={claimTask}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <NewTaskModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        role={role}
        profile={profile}
        businesses={businesses}
        presetBusinessId={selected?.id}
        onCreated={() => { setNewOpen(false); loadAll(); }}
      />
    </div>
  );
}

// ============================================================================
// Task card
// ============================================================================
function TaskCard({ task, role, profile, unread, onClick, onStatusChange, onClaim }) {
  const color = getBusinessColor(task.business_id);
  const isOTM = role === 'va' || role === 'otm';
  const isClient = role === 'client';
  const overdue = task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== 'approved';
  const ownThis = task.assignee_id === profile?.id;

  return (
    <div
      className="bg-paper border rounded p-3 mb-2 cursor-pointer hover:border-ink transition-all relative"
      style={{ borderLeftWidth: 3, borderLeftColor: color.hex, borderColor: 'var(--line)' }}
      onClick={onClick}
    >
      {unread > 0 && (
        <span className="absolute top-2 right-2 bg-crimson text-cream font-bebas text-[10px] tracking-widest px-2 py-0.5 rounded-full">
          {unread} NEW
        </span>
      )}
      {task.priority === 'urgent' && (
        <span className="absolute top-2 right-2 bg-crimson text-cream font-bebas text-[9px] tracking-widest px-2 py-0.5 rounded-full" style={{ right: unread > 0 ? 60 : 8 }}>URGENT</span>
      )}
      <div className="font-medium text-sm mb-1.5 leading-snug pr-12">{task.title}</div>
      <div className="text-[11px] text-muted flex justify-between gap-2 items-center">
        <span className="flex items-center gap-1.5 truncate">
          <span style={businessDot(task.business_id)} />
          <span className="font-bebas tracking-wider truncate" style={{ color: color.hex }}>{task.business_name || '—'}</span>
        </span>
        <span className="truncate">
          {task.is_unclaimed ? (
            <span className="text-warn font-medium">Unassigned</span>
          ) : (
            task.assignee_name || 'Unassigned'
          )}
        </span>
      </div>
      {task.due_date && (
        <div className={`text-[11px] mt-1 ${overdue ? 'text-crimson font-medium' : 'text-muted'}`}>
          Due {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{overdue ? ' (overdue)' : ''}
        </div>
      )}
      {(task.comment_count > 0 || task.attachment_count > 0) && (
        <div className="flex gap-3 mt-1 text-[10px] text-muted">
          {task.comment_count > 0 && <span>💬 {task.comment_count}</span>}
          {task.attachment_count > 0 && <span>📎 {task.attachment_count}</span>}
        </div>
      )}
      {task.status === 'revision_requested' && task.revision_reason && (
        <div className="text-[11px] bg-crimson/5 border border-crimson/20 text-crimson px-2 py-1 mt-2 rounded">
          <strong>Revision:</strong> {task.revision_reason}
        </div>
      )}

      {/* OTM actions on the card */}
      {isOTM && task.is_unclaimed && (
        <div className="mt-2 flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
          <button className="btn-sm ink" onClick={() => onClaim(task.id)}>+ CLAIM</button>
        </div>
      )}
      {isOTM && ownThis && (
        <div className="mt-2 flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
          {task.status === 'todo' && <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'in_progress')}>Start</button>}
          {task.status === 'in_progress' && <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'submitted')}>Submit</button>}
          {task.status === 'revision_requested' && <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'in_progress')}>Resume</button>}
          {task.status === 'submitted' && <button className="btn-sm" onClick={() => onStatusChange(task.id, 'in_progress')}>Withdraw</button>}
        </div>
      )}
      {isClient && task.status === 'submitted' && (
        <div className="mt-2 flex gap-1" onClick={e => e.stopPropagation()}>
          <button className="btn-sm ink" onClick={() => onStatusChange(task.id, 'approved')}>Approve</button>
          <button className="btn-sm danger" onClick={() => onStatusChange(task.id, 'revision_requested')}>Request revision</button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// New task modal — auto-pre-fills assignee from default OTM
// ============================================================================
function NewTaskModal({ open, onClose, role, profile, businesses, presetBusinessId, onCreated }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assignableOTMs, setAssignableOTMs] = useState([]);
  const [defaultAssignee, setDefaultAssignee] = useState(null);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const isOTM = role === 'va' || role === 'otm';
  const isClient = role === 'client';

  // Load OTMs assigned to this business + the default assignee
  useEffect(() => {
    async function loadOTMs() {
      if (!businessId) {
        setAssignableOTMs([]);
        setDefaultAssignee(null);
        return;
      }

      // Default assignee (RPC — works regardless of who's calling)
      const { data: def } = await supabase.rpc('get_business_default_assignee', { p_business_id: businessId });
      const defaultRow = (def && def[0]) || null;
      setDefaultAssignee(defaultRow);

      // Full list of OTMs assigned (used to render dropdown)
      const { data: a } = await supabase
        .from('va_assignments')
        .select('va_id, users!inner(id, name, active)')
        .eq('business_id', businessId);
      const otms = (a || []).filter(x => x.users?.active).map(x => x.users);
      setAssignableOTMs(otms);

      // Auto-pre-fill assigneeId
      if (otms.length === 0) {
        setAssigneeId('');
      } else if (isOTM && otms.find(o => o.id === profile?.id)) {
        // OTM creating a task defaults to themselves
        setAssigneeId(profile.id);
      } else if (defaultRow) {
        // Client + admin default to the auto-detected default
        setAssigneeId(defaultRow.id);
      } else {
        setAssigneeId(otms[0].id);
      }
    }
    if (open) loadOTMs();
  }, [businessId, open]);

  useEffect(() => {
    if (!open) return;
    const preferredId = presetBusinessId && businesses.find(b => b.id === presetBusinessId)
      ? presetBusinessId
      : (businesses[0]?.id || '');
    setBusinessId(preferredId);
    setTitle(''); setDescription(''); setDue(''); setAssigneeId(''); setPriority('normal');
    setPendingFiles([]); setErr('');
  }, [open, businesses, presetBusinessId]);

  async function save() {
    setErr('');
    if (!title.trim()) return setErr('Task title is required.');
    if (!businessId) return setErr('Pick a business.');
    if (assignableOTMs.length === 0) {
      return setErr('No OTM is assigned to this business yet. Ask the admin to assign one in OTM Team or pick a different business.');
    }

    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('tasks').insert({
      business_id: businessId,
      created_by: user.id,
      assignee_id: assigneeId || null,
      title: title.trim(),
      description: description.trim(),
      due_date: due || null,
      priority,
      status: 'todo'
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

    // Auto-post a "task created" system message so the conversation has history
    await supabase.from('task_comments').insert({
      task_id: data.id,
      author_id: user.id,
      author_name: profile.name,
      author_role: role === 'otm' ? 'va' : role,
      body: `${profile.name} created this task${assigneeId ? ` and assigned it to ${data.users?.name || 'the OTM'}` : ''}.`,
      system_message: true
    });

    await logAudit('task.create', 'task', data.id, { title });
    setBusy(false);
    const bizName = data.businesses?.name;
    const otmName = data.users?.name || 'Unassigned';
    toast.show(`"${title}" created for ${bizName} → ${otmName}${pendingFiles.length > 0 ? ` with ${pendingFiles.length} file(s)` : ''}.`);
    onCreated();
  }

  const selectedBiz = businesses.find(b => b.id === businessId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      subtitle="Create a task and assign it to an OTM."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'CREATING…' : 'CREATE TASK'}</button>
      </>}
    >
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
        {assignableOTMs.length === 0 && businessId ? (
          <div className="text-sm bg-crimson/5 border border-crimson/20 text-crimson p-3 rounded">
            <strong>No OTM assigned yet.</strong> Ask the admin to assign an OTM to <strong>{selectedBiz?.name}</strong> in <em>OTM Team</em>. Until then, a task created here would be unassigned and the OTM wouldn't see it.
          </div>
        ) : (
          <>
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
              {assignableOTMs.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            {defaultAssignee && assigneeId === defaultAssignee.id && (
              <div className="text-xs text-muted mt-1">Pre-filled with <strong>{defaultAssignee.name}</strong> — the OTM assigned to this business.</div>
            )}
            {!isOTM && assignableOTMs.length > 1 && (
              <div className="text-xs text-muted mt-1">{assignableOTMs.length} OTMs are assigned. Pick the right one.</div>
            )}
          </>
        )}
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
