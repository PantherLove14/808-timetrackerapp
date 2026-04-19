import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../components/PageHeader';
import { formatDateTime } from '../lib/format';

export default function TaskDetailPage({ role, profile }) {
  const { taskId } = useParams();
  const nav = useNavigate();
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);

  useEffect(() => { load(); }, [taskId]);

  async function load() {
    const { data: t } = await supabase
      .from('tasks')
      .select('*, businesses(name, client_id), users!tasks_assignee_id_fkey(name)')
      .eq('id', taskId).single();
    setTask(t);

    const { data: c } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setComments(c || []);

    const { data: a } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    setAttachments(a || []);
  }

  async function uploadFile(file, isAudio = false) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { alert('Max file size is 100MB.'); return; }
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const ext = file.name.split('.').pop();
    const path = `tasks/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('task-attachments').upload(path, file);
    if (upErr) { setUploading(false); return alert('Upload failed: ' + upErr.message); }

    if (isAudio) {
      await supabase.from('tasks').update({ audio_instruction_url: path }).eq('id', taskId);
    } else {
      await supabase.from('task_attachments').insert({
        task_id: taskId,
        uploaded_by: user.id,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type
      });
    }
    await logAudit('task.attachment_add', 'task', taskId, { file_name: file.name });
    setUploading(false);
    load();
  }

  async function downloadFile(path, name) {
    const { data, error } = await supabase.storage.from('task-attachments').createSignedUrl(path, 60);
    if (error) return alert('Download failed: ' + error.message);
    window.open(data.signedUrl, '_blank');
  }

  async function postComment() {
    if (!newComment.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('task_comments').insert({
      task_id: taskId,
      author_id: user.id,
      author_name: profile.name,
      author_role: role,
      body: newComment.trim()
    });
    if (error) return alert(error.message);
    await logAudit('task.comment', 'task', taskId);
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
    if (error) return alert(error.message);
    await logAudit(`task.status_${newStatus}`, 'task', taskId, { reason });
    load();
  }

  async function approve() {
    await changeStatus('approved');
  }
  async function requestRevision() {
    const reason = prompt('What revision is needed?');
    if (!reason) return;
    await changeStatus('revision_requested', reason);
  }

  if (!task) return <div className="text-center py-20 text-muted">Loading…</div>;

  const statusLabel = {
    todo: 'To Do',
    in_progress: 'In Progress',
    submitted: 'Submitted for Review',
    approved: 'Approved',
    revision_requested: 'Revision Requested'
  }[task.status];

  const statusBadge = {
    todo: 'done',
    in_progress: 'pending',
    submitted: 'pending',
    approved: 'active',
    revision_requested: 'hold'
  }[task.status];

  return (
    <div>
      <div className="mb-4">
        <Link to="/tasks" className="text-crimson text-sm hover:underline">← Back to tasks</Link>
      </div>

      <PageHeader
        kicker={task.businesses?.name}
        title={task.title}
        subtitle={<>Created {formatDateTime(task.created_at)} • Assigned to {task.users?.name || 'unassigned'}</>}
        right={<span className={`badge ${statusBadge}`}>{statusLabel}</span>}
      />

      {/* Status action bar */}
      <div className="panel mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-bebas text-[11px] tracking-widest text-crimson">STATUS</div>
            <div className="text-lg font-medium mt-1">{statusLabel}</div>
            {task.revision_reason && task.status === 'revision_requested' && (
              <div className="text-sm text-crimson mt-1">Reason: {task.revision_reason}</div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {role === 'va' && task.assignee_id === profile?.id && (
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
            {(role === 'admin' || role === 'sub_admin') && (
              <>
                {task.status === 'submitted' && <button className="btn-sm ink" onClick={approve}>APPROVE</button>}
                {task.status === 'submitted' && <button className="btn-sm danger" onClick={requestRevision}>REQUEST REVISION</button>}
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

      {/* Audio instructions */}
      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3">
          <SectionTitle kicker="Listen">Audio instructions</SectionTitle>
          {(role === 'admin' || role === 'sub_admin' || role === 'client') && (
            <>
              <input type="file" accept="audio/*" ref={audioInputRef} style={{ display: 'none' }}
                onChange={e => e.target.files[0] && uploadFile(e.target.files[0], true)} />
              <button className="btn-sm" onClick={() => audioInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'UPLOADING…' : (task.audio_instruction_url ? 'REPLACE AUDIO' : '+ UPLOAD AUDIO')}
              </button>
            </>
          )}
        </div>
        {task.audio_instruction_url ? (
          <AudioPlayer path={task.audio_instruction_url} />
        ) : (
          <div className="text-muted text-sm italic">No audio instructions.</div>
        )}
      </div>

      {/* Attachments */}
      <div className="panel mb-6">
        <div className="flex justify-between items-start mb-3">
          <SectionTitle kicker="Files">Attachments</SectionTitle>
          <>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }}
              onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} />
            <button className="btn-sm ink" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'UPLOADING…' : '+ UPLOAD FILE'}
            </button>
          </>
        </div>
        {attachments.length === 0 ? (
          <Empty>No attachments yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>File</th><th>Uploaded</th><th>Size</th><th></th></tr>
            </thead>
            <tbody>
              {attachments.map(a => (
                <tr key={a.id}>
                  <td>{a.file_name}</td>
                  <td>{formatDateTime(a.created_at)}</td>
                  <td>{a.file_size ? `${(a.file_size / 1024 / 1024).toFixed(2)} MB` : '—'}</td>
                  <td><button className="btn-sm" onClick={() => downloadFile(a.file_path, a.file_name)}>Download</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Comments */}
      <div className="panel">
        <SectionTitle kicker="Communication">Comments</SectionTitle>
        <div className="space-y-3 mb-4">
          {comments.length === 0 ? (
            <Empty>No comments yet. Start the conversation below.</Empty>
          ) : comments.map(c => (
            <div key={c.id} className="border-l-2 border-line pl-4 py-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <strong className="text-sm">{c.author_name}</strong>
                <span className="badge ink text-[9px]">{c.author_role.toUpperCase()}</span>
                <span className="text-xs text-muted">{formatDateTime(c.created_at)}</span>
              </div>
              <div className="text-sm text-ink mt-1 whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
        <div className="pt-4 border-t border-line-soft">
          <textarea
            className="input"
            rows="3"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            placeholder="Write a comment..."
          />
          <div className="flex justify-end mt-2">
            <button className="btn-sm ink" onClick={postComment} disabled={!newComment.trim()}>POST COMMENT</button>
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
