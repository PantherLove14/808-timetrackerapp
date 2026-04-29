import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../components/PageHeader';
import { useToast } from '../components/BusinessSelector';
import { getBusinessColor, businessDot } from '../lib/businessColor';
import { formatDateTime } from '../lib/format';

export default function TaskDetailPage({ role, profile }) {
  const { taskId } = useParams();
  const toast = useToast();
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const commentsEndRef = useRef(null);

  useEffect(() => { load(); }, [taskId]);

  // Mark all comments as read by current user when they view
  useEffect(() => {
    if (!profile || comments.length === 0) return;
    const otherComments = comments.filter(c => c.author_id !== profile.id);
    if (otherComments.length === 0) return;
    const rows = otherComments.map(c => ({ comment_id: c.id, user_id: profile.id }));
    // upsert (ignore conflict on PK)
    supabase.from('task_comment_reads').upsert(rows, { onConflict: 'comment_id,user_id' }).then(() => {});
  }, [comments, profile]);

  // Scroll comments to bottom on load
  useEffect(() => {
    if (commentsEndRef.current) commentsEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  async function load() {
    const { data: t } = await supabase
      .from('tasks')
      .select('*, businesses(name, client_id, clients(name)), users!tasks_assignee_id_fkey(name), creator:users!tasks_created_by_fkey(name)')
      .eq('id', taskId).single();
    setTask(t);

    const { data: c } = await supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
    setComments(c || []);

    const { data: a } = await supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at', { ascending: false });
    setAttachments(a || []);
  }

  async function uploadFile(file, isAudio = false) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { toast.show('Max file size is 100MB.', 'error'); return; }
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const ext = file.name.split('.').pop();
    const path = `tasks/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('task-attachments').upload(path, file);
    if (upErr) { setUploading(false); toast.show('Upload failed: ' + upErr.message, 'error'); return; }

    if (isAudio) {
      await supabase.from('tasks').update({ audio_instruction_url: path }).eq('id', taskId);
    } else {
      await supabase.from('task_attachments').insert({
        task_id: taskId, uploaded_by: user.id,
        file_name: file.name, file_path: path,
        file_size: file.size, mime_type: file.type
      });
    }
    await logAudit('task.attachment_add', 'task', taskId, { file_name: file.name });
    toast.show(isAudio ? 'Audio instruction uploaded.' : `${file.name} attached.`);
    setUploading(false);
    load();
  }

  async function downloadFile(path) {
    const { data, error } = await supabase.storage.from('task-attachments').createSignedUrl(path, 60);
    if (error) return toast.show('Download failed: ' + error.message, 'error');
    window.open(data.signedUrl, '_blank');
  }

  async function postComment() {
    if (!newComment.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('task_comments').insert({
      task_id: taskId, author_id: user.id,
      author_name: profile.name, author_role: role === 'otm' ? 'va' : role,
      body: newComment.trim()
    });
    if (error) return toast.show(error.message, 'error');
    await logAudit('task.comment', 'task', taskId);
    const recipient = role === 'client'
      ? (task.users?.name || 'the OTM')
      : (task.businesses?.clients?.name || 'the client');
    toast.show(`Comment posted on ${task.businesses?.name}. ${recipient} will see it.`);
    setNewComment('');
    load();
  }

  async function changeStatus(newStatus, reason = null) {
    const patch = { status: newStatus };
    if (newStatus === 'submitted') patch.submitted_at = new Date().toISOString();
    if (newStatus === 'approved') patch.approved_at = new Date().toISOString();
    if (newStatus === 'revision_requested') {
      patch.revision_reason = reason;
      patch.revision_count = (task.revision_count || 0) + 1;
    }
    const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
    if (error) return toast.show(error.message, 'error');
    await logAudit(`task.status_${newStatus}`, 'task', taskId, { reason });

    if (newStatus === 'submitted') {
      const clientName = task.businesses?.clients?.name || 'the client';
      toast.show(`"${task.title}" submitted to ${clientName} (${task.businesses?.name}).`);
    } else if (newStatus === 'approved') {
      toast.show(`"${task.title}" approved.`);
    } else if (newStatus === 'revision_requested') {
      toast.show(`Revision requested. ${task.users?.name || 'The OTM'} will be notified.`);
    } else {
      toast.show(`Status changed to ${newStatus.replace('_', ' ')}.`);
    }
    load();
  }

  async function approve() { await changeStatus('approved'); }
  async function requestRevision() {
    const reason = prompt('What revision is needed?');
    if (!reason) return;
    await changeStatus('revision_requested', reason);
  }

  if (!task) return <div className="text-center py-20 text-muted">Loading…</div>;

  const statusLabel = {
    todo: 'To Do', in_progress: 'In Progress',
    submitted: 'Submitted for Review', approved: 'Approved',
    revision_requested: 'Revision Requested'
  }[task.status];

  const statusBadge = {
    todo: 'done', in_progress: 'pending', submitted: 'pending',
    approved: 'active', revision_requested: 'hold'
  }[task.status];

  const color = getBusinessColor(task.business_id);
  const isOTM = role === 'va' || role === 'otm';
  const isAdmin = role === 'admin' || role === 'sub_admin';

  return (
    <div>
      <div className="mb-4">
        <Link to="/tasks" className="text-crimson text-sm hover:underline">← Back to tasks</Link>
      </div>

      <div className="flex items-center gap-2 mb-3 text-sm">
        <span style={businessDot(task.business_id)} />
        <span className="font-bebas tracking-widest text-xs" style={{ color: color.hex }}>{task.businesses?.name}</span>
        <span className="text-muted">/</span>
        <span className="text-slate808 truncate">{task.title}</span>
      </div>

      <PageHeader
        kicker={task.businesses?.name}
        title={task.title}
        subtitle={<>Created {formatDateTime(task.created_at)} by {task.creator?.name || 'system'} • Assigned to {task.users?.name || 'unassigned'}</>}
        right={<span className={`badge ${statusBadge}`}>{statusLabel}</span>}
      />

      <div className="panel mb-6" style={{ borderLeft: `4px solid ${color.hex}` }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-bebas text-[11px] tracking-widest text-crimson">STATUS</div>
            <div className="text-lg font-medium mt-1">{statusLabel}</div>
            {task.revision_reason && task.status === 'revision_requested' && (
              <div className="text-sm text-crimson mt-1">Reason: {task.revision_reason}</div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {isOTM && task.assignee_id === profile?.id && (
              <>
                {task.status === 'todo' && <button className="btn-sm ink" onClick={() => changeStatus('in_progress')}>START</button>}
                {task.status === 'in_progress' && <button className="btn-sm ink" onClick={() => changeStatus('submitted')}>SUBMIT FOR REVIEW</button>}
                {task.status === 'revision_requested' && <button className="btn-sm ink" onClick={() => changeStatus('in_progress')}>RESUME</button>}
              </>
            )}
            {role === 'client' && task.status === 'submitted' && (
              <>
                <button className="btn-sm ink" onClick={approve}>APPROVE</button>
                <button className="btn-sm danger" onClick={requestRevision}>REQUEST REVISION</button>
              </>
            )}
            {isAdmin && (
              <>
                {task.status === 'submitted' && <button className="btn-sm ink" onClick={approve}>APPROVE</button>}
                {task.status === 'submitted' && <button className="btn-sm danger" onClick={requestRevision}>REQUEST REVISION</button>}
              </>
            )}
          </div>
        </div>
      </div>

      {task.description && (
        <div className="panel mb-6">
          <SectionTitle kicker="Instructions">Description</SectionTitle>
          <div className="whitespace-pre-wrap text-sm text-ink leading-relaxed">{task.description}</div>
        </div>
      )}

      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3">
          <SectionTitle kicker="Listen">Audio instructions</SectionTitle>
          {(isAdmin || role === 'client') && (
            <>
              <input type="file" accept="audio/*" ref={audioInputRef} style={{ display: 'none' }}
                onChange={e => e.target.files[0] && uploadFile(e.target.files[0], true)} />
              <button className="btn-sm" onClick={() => audioInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'UPLOADING…' : (task.audio_instruction_url ? 'REPLACE AUDIO' : '+ UPLOAD AUDIO')}
              </button>
            </>
          )}
        </div>
        {task.audio_instruction_url ? <AudioPlayer path={task.audio_instruction_url} /> : (
          <div className="text-muted text-sm italic">No audio instructions.</div>
        )}
      </div>

      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3">
          <SectionTitle kicker="Files">Attachments</SectionTitle>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }}
            onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} />
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
                  <td><button className="btn-sm" onClick={() => downloadFile(a.file_path)}>Download</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <SectionTitle kicker="Communication">Conversation</SectionTitle>
        <div className="text-xs text-muted mb-4">All messages here are visible to admins, the assigned OTM, and the business client. {comments.length} message{comments.length === 1 ? '' : 's'}.</div>

        <div className="bg-cream-deep border border-line rounded p-3 max-h-[450px] overflow-y-auto mb-4">
          {comments.length === 0 ? (
            <div className="text-center py-6 text-muted italic text-sm">No messages yet. Start the conversation below.</div>
          ) : comments.map(c => {
            const mine = c.author_id === profile?.id;
            const roleColors = { admin: 'var(--ink)', sub_admin: 'var(--ink)', va: 'var(--crimson)', client: 'var(--navy, #1e3a5f)' };
            const roleLabel = c.author_role === 'va' ? 'OTM' : c.author_role.toUpperCase().replace('_', '-');
            return (
              <div key={c.id} className={`mb-3 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] ${mine ? 'bg-paper border border-line' : 'bg-paper border border-line'} rounded-lg p-3 shadow-sm`}
                  style={mine ? { borderLeft: '3px solid var(--ok)' } : { borderLeft: `3px solid ${roleColors[c.author_role] || 'var(--slate)'}` }}>
                  <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                    <strong className="text-sm">{mine ? 'You' : c.author_name}</strong>
                    <span className="badge text-[9px]" style={{ background: roleColors[c.author_role] || 'var(--slate)', color: 'var(--cream)' }}>{roleLabel}</span>
                    <span className="text-[10px] text-muted">{formatDateTime(c.created_at)}</span>
                  </div>
                  <div className="text-sm text-ink whitespace-pre-wrap">{c.body}</div>
                </div>
              </div>
            );
          })}
          <div ref={commentsEndRef} />
        </div>

        <div className="pt-2 border-t border-line-soft">
          <textarea
            className="input"
            rows="3"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder={`Write a message to ${
              role === 'client'
                ? (task.users?.name || 'the OTM')
                : role === 'admin' || role === 'sub_admin'
                  ? 'the team'
                  : (task.businesses?.clients?.name || 'the client')
            }...`}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                postComment();
              }
            }}
          />
          <div className="flex justify-between items-center mt-2">
            <div className="text-[10px] text-muted">Press Cmd/Ctrl+Enter to send.</div>
            <button className="btn-sm ink" onClick={postComment} disabled={!newComment.trim()}>SEND MESSAGE</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AudioPlayer({ path }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    supabase.storage.from('task-attachments').createSignedUrl(path, 3600).then(({ data }) => {
      if (data) setUrl(data.signedUrl);
    });
  }, [path]);
  if (!url) return <div className="text-muted text-sm">Loading audio…</div>;
  return <audio controls src={url} className="w-full" />;
}
