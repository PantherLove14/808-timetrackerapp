import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../components/PageHeader';
import { useToast } from '../components/BusinessSelector';
import { Avatar } from '../components/Avatar';
import { VoiceRecorder, FileAttachPicker, uploadFilesToStorage } from '../components/MediaUploader';
import { getBusinessColor, businessDot } from '../lib/businessColor';
import { formatDateTime, formatDate } from '../lib/format';
import Modal from '../components/Modal';

const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  submitted: 'Submitted for Review',
  approved: 'Approved',
  revision_requested: 'Revision Requested'
};

const STATUS_BADGES = {
  todo: 'done',
  in_progress: 'pending',
  submitted: 'pending',
  approved: 'active',
  revision_requested: 'hold'
};

export default function TaskDetailPage({ role, profile }) {
  const { taskId } = useParams();
  const toast = useToast();

  // Loading + error state — surfaced in the UI, no silent hangs
  const [loadStage, setLoadStage] = useState('init'); // init | loading | ready | error
  const [loadError, setLoadError] = useState('');

  // Data
  const [task, setTask] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);

  // Composer
  const [newComment, setNewComment] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingVoice, setPendingVoice] = useState(null);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // { id, author_name, body, attachments }
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionedIds, setMentionedIds] = useState([]); // uuids appended to mentions[]
  const textareaRef = useRef(null);

  // Edit task modal
  const [editOpen, setEditOpen] = useState(false);

  // File upload (task-level)
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  // Status-action prompt
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');

  const commentsEndRef = useRef(null);

  const isAdmin = role === 'admin' || role === 'sub_admin';
  const isOTM = role === 'va' || role === 'otm';
  const isClient = role === 'client';

  // Loaders --------------------------------------------------------------------

  const loadTask = useCallback(async () => {
    // Use SECURITY DEFINER RPC so embedded user/client joins don't get blocked
    // by "users select self" / "clients select self" RLS — that's what was
    // making the OTM page hang on Loading…
    const { data, error } = await supabase
      .rpc('get_task_with_context', { p_task_id: taskId });
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Task not found, or you don't have access to it. If this is unexpected, ask an admin to check your role and business assignment.");
    }
    return data[0];
  }, [taskId]);

  const loadParticipants = useCallback(async () => {
    const { data, error } = await supabase
      .rpc('get_task_participants', { p_task_id: taskId });
    if (error) throw error;
    return data || [];
  }, [taskId]);

  const loadComments = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }, [taskId]);

  const loadAttachments = useCallback(async () => {
    const { data, error } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }, [taskId]);

  const loadAll = useCallback(async () => {
    setLoadStage('loading');
    setLoadError('');
    try {
      const [t, p, c, a] = await Promise.all([
        loadTask(),
        loadParticipants(),
        loadComments(),
        loadAttachments()
      ]);
      setTask(t);
      setParticipants(p);
      setComments(c);
      setAttachments(a);
      setLoadStage('ready');
    } catch (e) {
      console.error('Task load failed:', e);
      setLoadError(e.message || 'Could not load this task.');
      setLoadStage('error');
    }
  }, [loadTask, loadParticipants, loadComments, loadAttachments]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Mark unread comments as read
  useEffect(() => {
    if (!profile || comments.length === 0) return;
    const others = comments.filter(c => c.author_id !== profile.id);
    if (others.length === 0) return;
    const rows = others.map(c => ({ comment_id: c.id, user_id: profile.id }));
    supabase
      .from('task_comment_reads')
      .upsert(rows, { onConflict: 'comment_id,user_id' })
      .then(() => {});
  }, [comments, profile]);

  useEffect(() => {
    if (commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comments.length]);

  // Realtime: subscribe to inserts on task_comments and task_attachments and tasks
  useEffect(() => {
    if (!taskId) return;
    const channel = supabase
      .channel(`task:${taskId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
        async () => {
          try { setComments(await loadComments()); } catch (e) { console.warn(e); }
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_attachments', filter: `task_id=eq.${taskId}` },
        async () => {
          try { setAttachments(await loadAttachments()); } catch (e) { console.warn(e); }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `id=eq.${taskId}` },
        async () => {
          try { setTask(await loadTask()); } catch (e) { console.warn(e); }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [taskId, loadComments, loadAttachments, loadTask]);

  // Task-level file upload (kept from v4) ------------------------------------
  async function uploadTaskFile(file, isAudio = false) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      toast.show('Max file size is 100 MB.', 'error');
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ext = file.name.split('.').pop();
      const path = `tasks/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('task-attachments').upload(path, file);
      if (upErr) {
        toast.show('Upload failed: ' + upErr.message, 'error');
        return;
      }
      if (isAudio) {
        const { error: dbErr } = await supabase.from('tasks').update({ audio_instruction_url: path }).eq('id', taskId);
        if (dbErr) { toast.show(dbErr.message, 'error'); return; }
      } else {
        const { error: dbErr } = await supabase.from('task_attachments').insert({
          task_id: taskId,
          uploaded_by: user.id,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type
        });
        if (dbErr) { toast.show(dbErr.message, 'error'); return; }
      }
      await logAudit('task.attachment_add', 'task', taskId, { file_name: file.name });
      toast.show(isAudio ? 'Audio instruction uploaded.' : `${file.name} attached.`);
    } finally {
      setUploading(false);
    }
  }

  async function deleteAttachment(attId, filePath) {
    if (!confirm('Remove this file from the task?')) return;
    const { error } = await supabase.from('task_attachments').delete().eq('id', attId);
    if (error) { toast.show(error.message, 'error'); return; }
    await supabase.storage.from('task-attachments').remove([filePath]).catch(() => {});
    await logAudit('task.attachment_delete', 'task', taskId, { att_id: attId });
    toast.show('Attachment removed.');
  }

  async function downloadFile(path) {
    const { data, error } = await supabase.storage.from('task-attachments').createSignedUrl(path, 60);
    if (error) return toast.show('Download failed: ' + error.message, 'error');
    window.open(data.signedUrl, '_blank');
  }

  // Comment composer ---------------------------------------------------------
  async function postComment() {
    if (posting) return;
    const trimmed = newComment.trim();
    if (!trimmed && !pendingVoice && pendingFiles.length === 0) {
      toast.show('Add a message, voice note, or attachment.', 'warn');
      return;
    }
    setPosting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      const allFiles = [...pendingFiles];
      if (pendingVoice) allFiles.push(pendingVoice);

      let uploadedAttachments = [];
      if (allFiles.length > 0) {
        const results = await uploadFilesToStorage('task-attachments', allFiles, `tasks/${taskId}/comments`);
        const failed = results.filter(r => r.error);
        if (failed.length) {
          toast.show(`Upload failed: ${failed[0].error}`, 'error');
          return;
        }
        uploadedAttachments = results.map(r => ({
          file_name: r.file.name,
          file_path: r.path,
          file_size: r.file.size,
          mime_type: r.file.type,
          is_voice: r.file === pendingVoice
        }));
      }

      const { error } = await supabase.from('task_comments').insert({
        task_id: taskId,
        author_id: user.id,
        author_name: profile.name,
        author_role: role === 'otm' ? 'va' : role,
        body: trimmed || null,
        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : null,
        reply_to_id: replyTo?.id || null,
        mentions: mentionedIds.length > 0 ? mentionedIds : null,
        system_message: false
      }).select().single();

      if (error) { toast.show(error.message, 'error'); return; }

      await logAudit('task.comment', 'task', taskId, {
        has_voice: !!pendingVoice,
        file_count: pendingFiles.length,
        replied_to: replyTo?.id || null,
        mentions: mentionedIds
      });

      // Toast tells you who will see it
      const otherRoleLabel =
        role === 'client' ? (task.assignee_name || 'the OTM') :
        isAdmin ? 'all participants' :
        (task.client_name || 'the client');
      toast.show(`Message posted${otherRoleLabel ? ` — ${otherRoleLabel} will see it` : ''}.`);

      // Reset composer
      setNewComment('');
      setPendingFiles([]);
      setPendingVoice(null);
      setReplyTo(null);
      setMentionedIds([]);
    } finally {
      setPosting(false);
    }
  }

  async function deleteComment(commentId) {
    if (!confirm('Delete this message? This cannot be undone.')) return;
    const { error } = await supabase.from('task_comments').delete().eq('id', commentId);
    if (error) { toast.show(error.message, 'error'); return; }
    await logAudit('task.comment_delete', 'task', taskId, { comment_id: commentId });
    toast.show('Message deleted.');
  }

  async function claimTask() {
    const { error } = await supabase.rpc('claim_task', { p_task_id: taskId });
    if (error) { toast.show(error.message, 'error'); return; }
    await logAudit('task.claim', 'task', taskId);
    toast.show('Task claimed. You are now the assignee.');
    loadAll();
  }

  // Status changes — also auto-post a system message into the conversation
  async function changeStatus(newStatus, reason = null) {
    const patch = { status: newStatus };
    if (newStatus === 'submitted') patch.submitted_at = new Date().toISOString();
    if (newStatus === 'approved') patch.approved_at = new Date().toISOString();
    if (newStatus === 'revision_requested') {
      patch.revision_reason = reason;
      patch.revision_count = (task.revision_count || 0) + 1;
    }
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) { toast.show(error.message, 'error'); return; }
    await logAudit(`task.status_${newStatus}`, 'task', taskId, { reason });

    // Auto-post system message into the conversation
    const { data: { user } } = await supabase.auth.getUser();
    const actorRole = role === 'otm' ? 'va' : role;
    let body = '';
    switch (newStatus) {
      case 'in_progress':
        body = task.status === 'revision_requested'
          ? `${profile.name} resumed work on revisions.`
          : `${profile.name} started work on this task.`;
        break;
      case 'submitted':
        body = `${profile.name} submitted this task for review.`;
        break;
      case 'approved':
        body = `${profile.name} approved this task. Nice work.`;
        break;
      case 'revision_requested':
        body = `${profile.name} requested revisions${reason ? `: "${reason}"` : '.'}`;
        break;
      case 'todo':
        body = `${profile.name} reopened this task.`;
        break;
      default:
        body = `${profile.name} updated status to ${newStatus.replace('_', ' ')}.`;
    }
    await supabase.from('task_comments').insert({
      task_id: taskId,
      author_id: user.id,
      author_name: profile.name,
      author_role: actorRole,
      body,
      system_message: true
    });

    if (newStatus === 'submitted') {
      toast.show(`"${task.title}" submitted to ${task.client_name || 'the client'} (${task.business_name}).`);
    } else if (newStatus === 'approved') {
      toast.show(`"${task.title}" approved.`);
    } else if (newStatus === 'revision_requested') {
      toast.show(`Revision requested. ${task.assignee_name || 'The OTM'} will be notified.`);
    } else {
      toast.show(`Status changed to ${STATUS_LABELS[newStatus] || newStatus}.`);
    }
  }

  function openRequestRevision() {
    setRevisionReason('');
    setRevisionOpen(true);
  }

  async function submitRevisionRequest() {
    if (!revisionReason.trim()) {
      toast.show('Please explain what needs to be revised.', 'warn');
      return;
    }
    setRevisionOpen(false);
    await changeStatus('revision_requested', revisionReason.trim());
  }

  // @-mention picking --------------------------------------------------------
  function onComposerKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      postComment();
      return;
    }
    if (e.key === 'Escape' && (replyTo || mentionOpen)) {
      e.preventDefault();
      setReplyTo(null);
      setMentionOpen(false);
      return;
    }
  }

  function onComposerChange(e) {
    const v = e.target.value;
    setNewComment(v);
    const cursor = e.target.selectionStart || v.length;
    const before = v.slice(0, cursor);
    const m = before.match(/(?:^|\s)@(\w*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[1].toLowerCase());
    } else if (mentionOpen) {
      setMentionOpen(false);
      setMentionQuery('');
    }
  }

  function pickMention(p) {
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart || newComment.length;
    const before = newComment.slice(0, cursor);
    const after = newComment.slice(cursor);
    const replaced = before.replace(/@(\w*)$/, `@${p.name} `);
    const next = replaced + after;
    setNewComment(next);
    setMentionedIds(prev => prev.includes(p.id) ? prev : [...prev, p.id]);
    setMentionOpen(false);
    setMentionQuery('');
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = replaced.length;
      ta?.setSelectionRange(pos, pos);
    });
  }

  const filteredMentionParticipants = useMemo(() => {
    if (!mentionOpen) return [];
    const me = profile?.id;
    return participants
      .filter(p => p.id !== me)
      .filter(p => !mentionQuery || (p.name || '').toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [participants, mentionOpen, mentionQuery, profile]);

  // Render -------------------------------------------------------------------
  if (loadStage === 'loading' || loadStage === 'init') {
    return (
      <div>
        <div className="mb-4">
          <Link to={isAdmin ? '/admin/tasks' : '/tasks'} className="text-crimson text-sm hover:underline">← Back to tasks</Link>
        </div>
        <div className="panel text-center py-12 text-muted font-display italic">
          Loading task…
        </div>
      </div>
    );
  }

  if (loadStage === 'error') {
    return (
      <div>
        <div className="mb-4">
          <Link to={isAdmin ? '/admin/tasks' : '/tasks'} className="text-crimson text-sm hover:underline">← Back to tasks</Link>
        </div>
        <div className="panel" style={{ borderColor: 'var(--crimson)', background: 'rgba(168,4,4,0.06)' }}>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-2">COULD NOT LOAD TASK</div>
          <div className="text-sm text-ink mb-3">{loadError}</div>
          <div className="text-xs text-muted mb-4">Task ID: {taskId}</div>
          <button className="btn-sm ink" onClick={loadAll}>Try again</button>
        </div>
      </div>
    );
  }

  if (!task) return null;

  const color = getBusinessColor(task.business_id);
  const canEditTask = isAdmin || task.assignee_id === profile?.id || task.creator_id === profile?.id;

  // Build a quick lookup for finding the back-fill on a reply quote
  const commentsById = comments.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
  const participantById = participants.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});

  return (
    <div>
      <div className="mb-4">
        <Link to={isAdmin ? '/admin/tasks' : '/tasks'} className="text-crimson text-sm hover:underline">← Back to tasks</Link>
      </div>

      <div className="flex items-center gap-2 mb-3 text-sm flex-wrap">
        <span style={businessDot(task.business_id)} />
        <span className="font-bebas tracking-widest text-xs" style={{ color: color.hex }}>{task.business_name}</span>
        {task.client_name && (
          <>
            <span className="text-muted">/</span>
            <span className="text-muted text-xs">Client: {task.client_name}</span>
          </>
        )}
        <span className="text-muted">/</span>
        <span className="text-slate808 truncate">{task.title}</span>
      </div>

      <PageHeader
        kicker={task.business_name}
        title={task.title}
        subtitle={
          <>
            Created {formatDateTime(task.created_at)} by {task.creator_name || 'system'} • Assigned to {task.assignee_name || 'unassigned'}
            {task.due_date && <> • Due {formatDate(task.due_date)}</>}
            {task.priority && task.priority !== 'normal' && <> • Priority: <strong>{task.priority}</strong></>}
          </>
        }
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${STATUS_BADGES[task.status]}`}>{STATUS_LABELS[task.status]}</span>
            {canEditTask && (
              <button className="btn-sm" onClick={() => setEditOpen(true)}>EDIT TASK</button>
            )}
            <button className="btn-sm" onClick={loadAll}>↻ Refresh</button>
          </div>
        }
      />

      {/* Status + role-aware actions */}
      <div className="panel mb-6" style={{ borderLeft: `4px solid ${color.hex}` }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-bebas text-[11px] tracking-widest text-crimson">STATUS</div>
            <div className="text-lg font-medium mt-1">{STATUS_LABELS[task.status]}</div>
            {task.revision_reason && task.status === 'revision_requested' && (
              <div className="text-sm text-crimson mt-1"><strong>Reason:</strong> {task.revision_reason}</div>
            )}
            {task.revision_count > 0 && (
              <div className="text-xs text-muted mt-1">Revision count: {task.revision_count}</div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* OTM Claim — when task is unassigned and the viewing OTM is on this business */}
            {isOTM && !task.assignee_id && participants.some(p => p.id === profile?.id && p.is_business_otm) && (
              <button className="btn-sm ink" onClick={claimTask}>+ CLAIM THIS TASK</button>
            )}
            {/* OTM actions */}
            {isOTM && task.assignee_id === profile?.id && (
              <>
                {task.status === 'todo' && <button className="btn-sm ink" onClick={() => changeStatus('in_progress')}>START WORK</button>}
                {task.status === 'in_progress' && <button className="btn-sm ink" onClick={() => changeStatus('submitted')}>SUBMIT FOR REVIEW</button>}
                {task.status === 'revision_requested' && <button className="btn-sm ink" onClick={() => changeStatus('in_progress')}>RESUME WORK</button>}
                {task.status === 'submitted' && <button className="btn-sm" onClick={() => changeStatus('in_progress')}>WITHDRAW SUBMISSION</button>}
              </>
            )}
            {/* Client actions */}
            {isClient && task.status === 'submitted' && (
              <>
                <button className="btn-sm ink" onClick={() => changeStatus('approved')}>APPROVE</button>
                <button className="btn-sm danger" onClick={openRequestRevision}>REQUEST REVISION</button>
              </>
            )}
            {/* Admin actions — full control */}
            {isAdmin && (
              <>
                {task.status !== 'in_progress' && <button className="btn-sm" onClick={() => changeStatus('in_progress')}>SET IN PROGRESS</button>}
                {task.status !== 'submitted' && <button className="btn-sm" onClick={() => changeStatus('submitted')}>SET SUBMITTED</button>}
                {task.status !== 'approved' && <button className="btn-sm ink" onClick={() => changeStatus('approved')}>APPROVE</button>}
                {task.status !== 'revision_requested' && <button className="btn-sm danger" onClick={openRequestRevision}>REQUEST REVISION</button>}
                {task.status !== 'todo' && <button className="btn-sm" onClick={() => changeStatus('todo')}>REOPEN</button>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <div className="panel mb-6">
          <SectionTitle kicker="Instructions">Description</SectionTitle>
          <div className="whitespace-pre-wrap text-sm text-ink leading-relaxed">{task.description}</div>
        </div>
      )}

      {/* Audio instruction */}
      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
          <SectionTitle kicker="Listen">Audio instructions</SectionTitle>
          {canEditTask && (
            <>
              <input type="file" accept="audio/*" ref={audioInputRef} style={{ display: 'none' }}
                onChange={e => e.target.files[0] && uploadTaskFile(e.target.files[0], true)} />
              <button className="btn-sm" onClick={() => audioInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'UPLOADING…' : (task.audio_instruction_url ? 'REPLACE AUDIO' : '+ UPLOAD AUDIO')}
              </button>
            </>
          )}
        </div>
        {task.audio_instruction_url ? (
          <SignedAudio path={task.audio_instruction_url} />
        ) : (
          <div className="text-muted text-sm italic">No audio instructions.</div>
        )}
      </div>

      {/* Task-level attachments */}
      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3 flex-wrap gap-2">
          <SectionTitle kicker="Files">Task attachments</SectionTitle>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }}
            onChange={e => e.target.files[0] && uploadTaskFile(e.target.files[0])} />
          <button className="btn-sm ink" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'UPLOADING…' : '+ UPLOAD FILE'}
          </button>
        </div>
        {attachments.length === 0 ? <Empty>No attachments yet.</Empty> : (
          <table>
            <thead><tr><th>File</th><th>Uploaded</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {attachments.map(a => (
                <tr key={a.id}>
                  <td>{a.file_name}</td>
                  <td>{formatDateTime(a.created_at)}</td>
                  <td>{a.file_size ? `${(a.file_size / 1024 / 1024).toFixed(2)} MB` : '—'}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-sm" onClick={() => downloadFile(a.file_path)}>Download</button>{' '}
                    {(isAdmin || a.uploaded_by === profile?.id) && (
                      <button className="btn-sm danger" onClick={() => deleteAttachment(a.id, a.file_path)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Conversation */}
      <div className="panel">
        <div className="flex justify-between items-start flex-wrap gap-2 mb-3">
          <SectionTitle kicker="Communication">Conversation</SectionTitle>
          <ParticipantsStrip participants={participants} />
        </div>
        <div className="text-xs text-muted mb-4">
          Real-time thread between admin, the assigned OTM, and the business client. Send text, files, video, voice notes — whatever helps. Tag someone with @name. {comments.length} message{comments.length === 1 ? '' : 's'}.
        </div>

        <div className="bg-cream-deep border border-line rounded p-3 max-h-[600px] overflow-y-auto mb-4">
          {comments.length === 0 ? (
            <div className="text-center py-6 text-muted italic text-sm">No messages yet. Start the conversation below.</div>
          ) : comments.map(c => (
            <CommentRow
              key={c.id}
              c={c}
              profile={profile}
              isAdmin={isAdmin}
              parent={c.reply_to_id ? commentsById[c.reply_to_id] : null}
              participantById={participantById}
              onReply={() => setReplyTo({ id: c.id, author_name: c.author_name, body: c.body, attachments: c.attachments })}
              onDelete={() => deleteComment(c.id)}
            />
          ))}
          <div ref={commentsEndRef} />
        </div>

        {/* Composer */}
        <div className="pt-2 border-t border-line-soft">
          {replyTo && (
            <div className="bg-cream-deep border-l-4 border-crimson rounded px-3 py-2 mb-2 flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-bebas text-[10px] tracking-widest text-crimson">REPLYING TO {(replyTo.author_name || '').toUpperCase()}</div>
                <div className="text-xs text-slate808 truncate">
                  {replyTo.body || (replyTo.attachments?.length ? `(${replyTo.attachments.length} attachment${replyTo.attachments.length === 1 ? '' : 's'})` : '(message)')}
                </div>
              </div>
              <button onClick={() => setReplyTo(null)} className="text-crimson text-xs">✕</button>
            </div>
          )}

          <div className="relative">
            <textarea
              ref={textareaRef}
              className="input"
              rows="3"
              value={newComment}
              onChange={onComposerChange}
              onKeyDown={onComposerKeyDown}
              placeholder={
                isClient ? `Write a message to ${task.assignee_name || 'the OTM'}…` :
                isOTM ? `Write a message to ${task.client_name || 'the client'}…` :
                'Write a message to all participants…'
              }
            />
            {mentionOpen && filteredMentionParticipants.length > 0 && (
              <div className="absolute z-30 bg-paper border border-line rounded shadow-lg mt-1 min-w-[220px] max-w-[300px]">
                <div className="font-bebas text-[10px] tracking-widest text-crimson px-3 py-2 border-b border-line-soft">MENTION</div>
                {filteredMentionParticipants.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickMention(p)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-cream-deep"
                  >
                    <Avatar url={p.avatar_url} name={p.name} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{p.name}</div>
                      <div className="text-[10px] text-muted">{labelRole(p.role)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 mt-2 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <FileAttachPicker files={pendingFiles} onChange={setPendingFiles} disabled={posting} />
              <VoiceRecorder onRecorded={setPendingVoice} disabled={posting} />
              {pendingVoice && (
                <span className="text-xs bg-cream-deep border border-line rounded px-2 py-1 flex items-center gap-2">
                  🎵 Voice note ready
                  <button onClick={() => setPendingVoice(null)} className="text-crimson">✕</button>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[10px] text-muted">@ to mention • Cmd/Ctrl+Enter to send</div>
              <button className="btn-sm ink" onClick={postComment} disabled={posting}>
                {posting ? 'SENDING…' : 'SEND MESSAGE'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit task modal */}
      <EditTaskModal
        open={editOpen}
        task={task}
        canEdit={canEditTask}
        isAdmin={isAdmin}
        onClose={() => setEditOpen(false)}
        onSaved={() => { setEditOpen(false); loadAll(); }}
      />

      {/* Revision request modal */}
      <Modal
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        title="Request revisions"
        subtitle="Tell the OTM exactly what needs to change. This will be visible in the conversation."
        footer={<>
          <button className="btn-ghost" onClick={() => setRevisionOpen(false)}>Cancel</button>
          <button className="btn-sm danger" onClick={submitRevisionRequest}>SEND REVISION REQUEST</button>
        </>}
      >
        <textarea
          className="input"
          rows="5"
          value={revisionReason}
          onChange={e => setRevisionReason(e.target.value)}
          placeholder="Describe what needs to be revised, with specifics where possible…"
        />
      </Modal>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function ParticipantsStrip({ participants }) {
  if (!participants || participants.length === 0) return null;
  const max = 6;
  const shown = participants.slice(0, max);
  const more = Math.max(0, participants.length - max);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="font-bebas text-[10px] tracking-widest text-muted mr-1">PARTICIPANTS</span>
      {shown.map(p => (
        <div key={`${p.role}-${p.id}`} title={`${p.name} (${labelRole(p.role)})`}>
          <Avatar url={p.avatar_url} name={p.name} size={28} />
        </div>
      ))}
      {more > 0 && (
        <div className="text-[10px] text-muted">+{more}</div>
      )}
    </div>
  );
}

function CommentRow({ c, profile, isAdmin, parent, participantById, onReply, onDelete }) {
  if (c.system_message) {
    return (
      <div className="my-3 flex justify-center">
        <div className="text-[11px] text-muted italic px-3 py-1 bg-paper border border-line-soft rounded-full">
          {c.body} <span className="text-[10px] ml-1">· {formatDateTime(c.created_at)}</span>
        </div>
      </div>
    );
  }

  const mine = c.author_id === profile?.id;
  const roleColor = {
    admin: 'var(--ink)', sub_admin: 'var(--ink)',
    va: 'var(--crimson)', otm: 'var(--crimson)',
    client: '#1e3a5f'
  }[c.author_role] || 'var(--slate)';
  const roleLbl = labelRole(c.author_role);

  // Look up author photo via participants map (works for users + clients)
  const authorParticipant = participantById?.[c.author_id];
  const authorAvatarUrl = mine ? profile?.avatar_url : authorParticipant?.avatar_url;
  const authorName = c.author_name || authorParticipant?.name || '?';

  return (
    <div className={`mb-3 flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <Avatar url={authorAvatarUrl} name={authorName} size={32} />}
      <div
        className="max-w-[72%] bg-paper border border-line rounded-lg p-3 shadow-sm"
        style={mine ? { borderLeft: '3px solid var(--ok)' } : { borderLeft: `3px solid ${roleColor}` }}
      >
        {parent && (
          <div className="bg-cream-deep border-l-2 border-crimson/40 rounded-sm px-2 py-1 mb-2 text-[11px]">
            <div className="font-bebas text-[9px] tracking-widest text-crimson">REPLY TO {(parent.author_name || '').toUpperCase()}</div>
            <div className="text-slate808 truncate">{parent.body || (parent.attachments?.length ? `(${parent.attachments.length} file${parent.attachments.length === 1 ? '' : 's'})` : '(message)')}</div>
          </div>
        )}

        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <strong className="text-sm">{mine ? 'You' : authorName}</strong>
          <span className="badge text-[9px]" style={{ background: roleColor, color: 'var(--cream)' }}>{roleLbl}</span>
          <span className="text-[10px] text-muted">{formatDateTime(c.created_at)}</span>
          {c.edited_at && <span className="text-[10px] text-muted italic">edited</span>}
        </div>

        {c.body && <div className="text-sm text-ink whitespace-pre-wrap">{c.body}</div>}

        {Array.isArray(c.attachments) && c.attachments.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {c.attachments.map((a, i) => <CommentAttachment key={i} a={a} />)}
          </div>
        )}

        <div className="mt-2 flex gap-3 items-center text-[10px]">
          <button onClick={onReply} className="text-slate808 hover:text-crimson">↩ Reply</button>
          {(mine || isAdmin) && (
            <button onClick={onDelete} className="text-slate808 hover:text-crimson">Delete</button>
          )}
        </div>
      </div>
      {mine && <Avatar url={authorAvatarUrl} name={authorName} size={32} />}
    </div>
  );
}

function CommentAttachment({ a }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let active = true;
    supabase.storage.from('task-attachments').createSignedUrl(a.file_path, 3600).then(({ data }) => {
      if (active && data) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [a.file_path]);

  const isImage = (a.mime_type || '').startsWith('image/');
  const isVideo = (a.mime_type || '').startsWith('video/');
  const isAudio = (a.mime_type || '').startsWith('audio/') || a.is_voice;

  if (!url) return <div className="text-xs text-muted">Loading {a.file_name}…</div>;

  if (isImage) {
    return (
      <div>
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={a.file_name} style={{ maxWidth: 320, maxHeight: 240, borderRadius: 4, display: 'block' }} />
        </a>
        <div className="text-[10px] text-muted mt-1">{a.file_name}</div>
      </div>
    );
  }
  if (isVideo) {
    return (
      <div>
        <video controls src={url} style={{ maxWidth: 360, maxHeight: 240, borderRadius: 4 }} />
        <div className="text-[10px] text-muted mt-1">{a.file_name}</div>
      </div>
    );
  }
  if (isAudio) {
    return (
      <div>
        <audio controls src={url} style={{ width: '100%', maxWidth: 360 }} />
        <div className="text-[10px] text-muted mt-1">{a.is_voice ? '🎤 Voice note' : a.file_name}</div>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="bg-cream-deep border border-line rounded px-2 py-1 text-xs inline-flex items-center gap-2 hover:border-ink w-fit">
      📎 {a.file_name}
      <span className="text-muted">({a.file_size ? (a.file_size / 1024).toFixed(0) + ' KB' : ''})</span>
    </a>
  );
}

function SignedAudio({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let active = true;
    supabase.storage.from('task-attachments').createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path]);
  if (!url) return <div className="text-muted text-sm">Loading audio…</div>;
  return <audio controls src={url} className="w-full" />;
}

function labelRole(r) {
  if (!r) return '';
  if (r === 'va' || r === 'otm') return 'OTM';
  if (r === 'sub_admin') return 'SUB-ADMIN';
  if (r === 'admin') return 'ADMIN';
  if (r === 'client') return 'CLIENT';
  return r.toUpperCase();
}

// ============================================================================
// Edit task modal
// ============================================================================
function EditTaskModal({ open, task, canEdit, isAdmin, onClose, onSaved }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [otms, setOtms] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title || '');
    setDescription(task.description || '');
    setDueDate(task.due_date || '');
    setPriority(task.priority || 'normal');
    setAssigneeId(task.assignee_id || '');
    setErr('');
    if (isAdmin && task.business_id) {
      supabase
        .from('va_assignments')
        .select('va_id, users!inner(id, name, active)')
        .eq('business_id', task.business_id)
        .then(({ data }) => {
          setOtms((data || []).filter(x => x.users?.active).map(x => x.users));
        });
    }
  }, [open, task, isAdmin]);

  if (!task) return null;

  async function save() {
    if (!canEdit) return;
    setErr('');
    if (!title.trim()) return setErr('Title is required.');
    setBusy(true);
    try {
      const patch = {
        title: title.trim(),
        description: description.trim() || null,
        due_date: dueDate || null,
        priority
      };
      if (isAdmin) patch.assignee_id = assigneeId || null;
      const { error } = await supabase.from('tasks').update(patch).eq('id', task.id);
      if (error) { setErr(error.message); return; }
      await logAudit('task.update', 'task', task.id, patch);
      toast.show('Task updated.');
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask() {
    if (!confirm(`Delete "${task.title}"? All comments and attachments will be removed. This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) { setErr(error.message); return; }
      await logAudit('task.delete', 'task', task.id, { title: task.title });
      toast.show(`"${task.title}" deleted.`);
      window.location.href = isAdmin ? '/admin/tasks' : '/tasks';
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit task"
      subtitle="Adjust the details, deadline, or assignee."
      footer={<>
        {isAdmin && <button className="btn-sm danger" onClick={deleteTask} disabled={busy}>DELETE TASK</button>}
        <span style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy || !canEdit}>{busy ? 'SAVING…' : 'SAVE CHANGES'}</button>
      </>}
    >
      <div className="mb-3">
        <label className="field-label">Title</label>
        <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="field-label">Description</label>
        <textarea className="input" rows="5" value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="field-label">Due date</label>
          <input type="date" className="input" value={dueDate || ''} onChange={e => setDueDate(e.target.value)} />
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
      {isAdmin && (
        <div className="mb-3">
          <label className="field-label">Assignee (OTM)</label>
          <select value={assigneeId || ''} onChange={e => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {otms.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="text-xs text-muted mt-1">Only OTMs assigned to {task.business_name} appear here.</div>
        </div>
      )}
      {err && <div className="text-sm text-crimson mt-2">{err}</div>}
    </Modal>
  );
}
