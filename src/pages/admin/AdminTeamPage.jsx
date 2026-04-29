import { useEffect, useRef, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { Empty, SectionTitle } from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { useToast } from '../../components/BusinessSelector';
import { formatDate, formatDuration, startOfWeek } from '../../lib/format';

export default function AdminTeamPage() {
  const [users, setUsers] = useState([]);
  const [weekStats, setWeekStats] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [credsOpen, setCredsOpen] = useState(false);
  const [credsUser, setCredsUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const { data: u, error: uErr } = await supabase.from('users').select('*').order('name');
      if (uErr) setLoadError(uErr.message);
      setUsers(u || []);
      const sow = startOfWeek(new Date()).toISOString();
      const { data: entries } = await supabase.from('time_entries').select('user_id, duration').gte('date', sow);
      const stats = {};
      (entries || []).forEach(e => { stats[e.user_id] = (stats[e.user_id] || 0) + e.duration; });
      setWeekStats(stats);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(u) {
    const { error } = await supabase.from('users').update({ active: !u.active }).eq('id', u.id);
    if (error) return alert(error.message);
    await logAudit(u.active ? 'user.deactivate' : 'user.activate', 'user', u.id);
    load();
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="OTM Team"
        subtitle="Manage your Outsourced Team Members, admins, and sub-admins."
        right={<>
          <button className="btn-sm" onClick={load}>↻ Refresh</button>{' '}
          <button className="btn-sm ink" onClick={() => { setEditing(null); setModalOpen(true); }}>+ ADD TEAM MEMBER</button>
        </>}
      />

      {loadError && (
        <div className="panel mb-5" style={{ borderColor: 'var(--crimson)', background: 'rgba(168,4,4,0.06)' }}>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-1">LOAD ERROR</div>
          <div className="text-sm">{loadError}</div>
        </div>
      )}

      <div className="panel p-0 overflow-hidden">
        {loading ? (
          <Empty>Loading…</Empty>
        ) : users.length === 0 ? (
          <Empty>No team members yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Rate</th><th>Week hours</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong></td>
                  <td className="text-slate808">{u.email}</td>
                  <td><span className={`badge ${u.role === 'admin' ? 'ink' : 'active'}`}>
                    {u.role === 'va' ? 'OTM' : u.role.toUpperCase().replace('_', '-')}
                  </span></td>
                  <td>{u.hourly_rate ? `$${u.hourly_rate}/hr` : '—'}</td>
                  <td>{formatDuration(weekStats[u.id] || 0)}</td>
                  <td><span className={`badge ${u.active ? 'active' : 'hold'}`}>{u.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="whitespace-nowrap">
                    <button className="btn-sm" onClick={() => { setEditing(u); setModalOpen(true); }}>Edit</button>{' '}
                    {u.role === 'va' && (
                      <button className="btn-sm" onClick={() => { setCredsUser(u); setCredsOpen(true); }}>Credentials</button>
                    )}{' '}
                    <button className="btn-sm" onClick={() => toggleActive(u)}>{u.active ? 'Deactivate' : 'Activate'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        onSaved={() => { setModalOpen(false); load(); }}
      />

      <CredentialsModal
        open={credsOpen}
        onClose={() => setCredsOpen(false)}
        user={credsUser}
      />
    </div>
  );
}

function UserModal({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [businesses, setBusinesses] = useState([]);
  const [businessLoadError, setBusinessLoadError] = useState('');
  const [assigned, setAssigned] = useState(new Set());
  const [children, setChildren] = useState([]);
  const [notableDates, setNotableDates] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const toast = useToast();

  function emptyForm() {
    return {
      name: '', email: '', password: '', role: 'va',
      phone: '', hourly_rate: '', weekly_hours_committed: '',
      start_date: '', birthday: '', work_anniversary: '',
      emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
      shirt_size: '', admin_notes: ''
    };
  }

  // Load businesses every time modal opens (no caching - always fresh)
  useEffect(() => {
    if (!open) return;
    (async () => {
      setBusinessLoadError('');
      const { data, error } = await supabase.from('businesses').select('id, name, active').eq('active', true).order('name');
      if (error) setBusinessLoadError(error.message);
      setBusinesses(data || []);
    })();

    if (editing) {
      setForm({
        name: editing.name || '', email: editing.email || '', password: '', role: editing.role,
        phone: editing.phone || '', hourly_rate: editing.hourly_rate || '',
        weekly_hours_committed: editing.weekly_hours_committed || '',
        start_date: editing.start_date || '', birthday: editing.birthday || '',
        work_anniversary: editing.work_anniversary || '',
        emergency_contact_name: editing.emergency_contact_name || '',
        emergency_contact_phone: editing.emergency_contact_phone || '',
        emergency_contact_relationship: editing.emergency_contact_relationship || '',
        shirt_size: editing.shirt_size || '',
        admin_notes: editing.admin_notes || ''
      });
      setChildren(editing.childrens_info || []);
      setNotableDates(editing.notable_dates || []);
      supabase.from('va_assignments').select('business_id').eq('va_id', editing.id).then(({ data }) => {
        setAssigned(new Set((data || []).map(a => a.business_id)));
      });
    } else {
      setForm(emptyForm()); setChildren([]); setNotableDates([]); setAssigned(new Set());
    }
    setNewPassword('');
    setErr('');
  }, [open, editing]);

  function f(k) { return { value: form[k], onChange: e => setForm(s => ({ ...s, [k]: e.target.value })) }; }

  function generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 16; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    return pwd;
  }

  async function save() {
    setErr('');
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email are required.');
    if (!editing && !form.email.includes('@')) return setErr('Please enter a valid email.');
    setBusy(true);

    try {
      const profileData = {
        name: form.name.trim(),
        role: form.role,
        phone: form.phone || null,
        hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
        weekly_hours_committed: form.weekly_hours_committed ? parseInt(form.weekly_hours_committed) : null,
        start_date: form.start_date || null,
        birthday: form.birthday || null,
        work_anniversary: form.work_anniversary || null,
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
        emergency_contact_relationship: form.emergency_contact_relationship || null,
        shirt_size: form.shirt_size || null,
        childrens_info: children,
        notable_dates: notableDates,
        admin_notes: form.admin_notes || null
      };

      let userId;
      let tempPassword = null;

      if (editing) {
        const { error } = await supabase.from('users').update(profileData).eq('id', editing.id);
        if (error) throw error;
        userId = editing.id;
      } else {
        if (!form.password) {
          tempPassword = generatePassword();
        } else if (form.password.length < 12) {
          throw new Error('Password must be at least 12 characters.');
        } else {
          tempPassword = form.password;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not signed in. Refresh and log in again.');
        const url = import.meta.env.VITE_SUPABASE_URL;
        const resp = await fetch(`${url}/functions/v1/create-user`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
          },
          body: JSON.stringify({
            type: 'user',
            email: form.email.trim().toLowerCase(),
            password: tempPassword,
            profile: profileData
          })
        });

        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || `Edge function returned ${resp.status}`);
        userId = result.user_id || result.id;
        if (!userId) throw new Error('Edge function did not return user_id');
      }

      // Handle assignments
      await supabase.from('va_assignments').delete().eq('va_id', userId);
      if (form.role === 'va' && assigned.size) {
        const rows = Array.from(assigned).map(bid => ({ va_id: userId, business_id: bid }));
        const { error: aErr } = await supabase.from('va_assignments').insert(rows);
        if (aErr) throw new Error('User saved but assignment failed: ' + aErr.message);
      }

      await logAudit(editing ? 'user.update' : 'user.create', 'user', userId, { name: form.name });
      setBusy(false);

      if (tempPassword) {
        setNewPassword(tempPassword);
        toast.show(`${form.name} created. Copy their temporary password below to share securely.`);
      } else {
        toast.show(`${form.name} updated.`);
        onSaved();
      }
    } catch (e) {
      setBusy(false);
      setErr(e.message);
    }
  }

  function toggleAssign(id) {
    const s = new Set(assigned);
    s.has(id) ? s.delete(id) : s.add(id);
    setAssigned(s);
  }

  function addChild() { setChildren([...children, { name: '', birthday: '' }]); }
  function updateChild(i, k, v) { const c = [...children]; c[i][k] = v; setChildren(c); }
  function removeChild(i) { setChildren(children.filter((_, j) => j !== i)); }

  function addDate() { setNotableDates([...notableDates, { label: '', date: '' }]); }
  function updateDate(i, k, v) { const d = [...notableDates]; d[i][k] = v; setNotableDates(d); }
  function removeDate(i) { setNotableDates(notableDates.filter((_, j) => j !== i)); }

  if (newPassword) {
    return (
      <Modal open={open} onClose={() => { setNewPassword(''); onSaved(); }}
        title="Team member created"
        subtitle="Share the credentials below securely with the new team member. This is the only time you'll see this password."
        footer={<button className="btn-sm ink" onClick={() => { setNewPassword(''); onSaved(); }}>DONE</button>}>
        <div className="bg-cream-deep border border-line p-4 rounded mb-4">
          <div className="font-bebas text-[11px] tracking-widest text-crimson mb-2">EMAIL</div>
          <div className="font-mono text-sm mb-3 break-all">{form.email}</div>
          <div className="font-bebas text-[11px] tracking-widest text-crimson mb-2">TEMPORARY PASSWORD</div>
          <div className="font-mono text-sm break-all bg-paper border border-line px-3 py-2 rounded">{newPassword}</div>
          <button
            className="btn-sm mt-3"
            onClick={() => {
              navigator.clipboard.writeText(`Email: ${form.email}\nTemporary password: ${newPassword}\n\nSign in at: ${window.location.origin}\n\nPlease change your password after first login.`);
              toast.show('Credentials copied to clipboard.');
            }}
          >Copy both to clipboard</button>
        </div>
        <div className="text-xs text-muted">
          Tell them to sign in at <strong>{window.location.origin}</strong> and change their password from their Profile page.
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit team member' : 'Add team member'}
      subtitle={editing ? 'Update profile details.' : 'Create an auth login and full profile. A temporary password will be generated.'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : (editing ? 'SAVE CHANGES' : 'CREATE TEAM MEMBER')}</button>
        </>
      }>
      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">CREDENTIALS</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Full name</label><input className="input" {...f('name')} /></div>
        <div>
          <label className="field-label">Email</label>
          <input type="email" className="input" value={form.email} onChange={e => setForm(s => ({ ...s, email: e.target.value }))} disabled={!!editing} />
          {editing && <div className="text-[10px] text-muted mt-1">Email can't be changed after creation.</div>}
        </div>
      </div>
      {!editing && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="field-label">Temporary password (leave blank to auto-generate)</label>
            <input type="text" className="input" {...f('password')} placeholder="Auto-generate" />
          </div>
          <div>
            <label className="field-label">Role</label>
            <select {...f('role')}>
              <option value="va">OTM / Team Member</option>
              <option value="sub_admin">Sub-Admin</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
      )}
      {editing && (
        <div className="mb-4">
          <label className="field-label">Role</label>
          <select {...f('role')}>
            <option value="va">OTM / Team Member</option>
            <option value="sub_admin">Sub-Admin</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      )}

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">CONTACT & HR</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Phone</label><input className="input" {...f('phone')} placeholder="555-555-5555" /></div>
        <div><label className="field-label">Start date</label><input type="date" className="input" {...f('start_date')} /></div>
        <div><label className="field-label">Hourly rate ($)</label><input type="number" step="0.01" className="input" {...f('hourly_rate')} /></div>
        <div><label className="field-label">Weekly hours committed</label><input type="number" className="input" {...f('weekly_hours_committed')} /></div>
        <div><label className="field-label">Birthday</label><input type="date" className="input" {...f('birthday')} /></div>
        <div><label className="field-label">Work anniversary</label><input type="date" className="input" {...f('work_anniversary')} /></div>
        <div><label className="field-label">Shirt size</label><input className="input" {...f('shirt_size')} placeholder="S / M / L / XL" /></div>
      </div>

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">EMERGENCY CONTACT</div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="field-label">Name</label><input className="input" {...f('emergency_contact_name')} /></div>
        <div><label className="field-label">Phone</label><input className="input" {...f('emergency_contact_phone')} placeholder="555-555-5555" /></div>
        <div className="col-span-2"><label className="field-label">Relationship</label><input className="input" {...f('emergency_contact_relationship')} /></div>
      </div>

      <div className="flex justify-between items-center mb-3">
        <div className="font-bebas text-[11px] tracking-widest text-crimson">CHILDREN (FOR CARDS & GIFTS)</div>
        <button className="btn-sm" onClick={addChild} type="button">+ Add child</button>
      </div>
      {children.map((c, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
          <input className="input" placeholder="Child's name" value={c.name} onChange={e => updateChild(i, 'name', e.target.value)} />
          <input type="date" className="input" value={c.birthday} onChange={e => updateChild(i, 'birthday', e.target.value)} />
          <button className="btn-sm danger" onClick={() => removeChild(i)} type="button">✕</button>
        </div>
      ))}

      <div className="flex justify-between items-center mb-3 mt-4">
        <div className="font-bebas text-[11px] tracking-widest text-crimson">OTHER NOTABLE DATES</div>
        <button className="btn-sm" onClick={addDate} type="button">+ Add date</button>
      </div>
      {notableDates.map((d, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
          <input className="input" placeholder="Label" value={d.label} onChange={e => updateDate(i, 'label', e.target.value)} />
          <input type="date" className="input" value={d.date} onChange={e => updateDate(i, 'date', e.target.value)} />
          <button className="btn-sm danger" onClick={() => removeDate(i)} type="button">✕</button>
        </div>
      ))}

      {form.role === 'va' && (
        <>
          <div className="font-bebas text-[11px] tracking-widest text-crimson mb-2 mt-4">ASSIGN TO BUSINESSES</div>
          <div className="bg-cream-deep border border-line p-3 rounded max-h-40 overflow-y-auto">
            {businessLoadError ? (
              <div className="text-xs text-crimson">Could not load businesses: {businessLoadError}</div>
            ) : businesses.length === 0 ? (
              <div className="text-xs text-muted italic">No businesses yet. Add a client first to create a business.</div>
            ) : businesses.map(b => (
              <label key={b.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                <input type="checkbox" checked={assigned.has(b.id)} onChange={() => toggleAssign(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
          <div className="text-xs text-muted mt-1">OTM only sees the businesses you check. {businesses.length} business(es) available.</div>
        </>
      )}

      <div className="mt-4">
        <label className="field-label">Admin notes (internal only)</label>
        <textarea className="input" rows="3" {...f('admin_notes')} />
      </div>

      {editing && (
        <div className="mt-4 pt-4 border-t border-line-soft text-xs text-muted">
          To upload credentials for this OTM, save first, then click the "Credentials" button on their row.
        </div>
      )}

      {err && <div className="text-sm text-crimson mt-3 p-2 bg-crimson/5 border border-crimson/20 rounded">{err}</div>}
    </Modal>
  );
}

function CredentialsModal({ open, onClose, user }) {
  const [creds, setCreds] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState('ID');
  const [newExpiry, setNewExpiry] = useState('');
  const fileRef = useRef();
  const toast = useToast();

  useEffect(() => {
    if (!open || !user) return;
    load();
  }, [open, user]);

  async function load() {
    const { data, error } = await supabase.from('otm_credentials').select('*').eq('user_id', user.id).order('uploaded_at', { ascending: false });
    if (error) toast.show('Could not load credentials: ' + error.message, 'error');
    setCreds(data || []);
  }

  async function uploadFile(file) {
    if (!file || !newLabel.trim()) { toast.show('Label required before upload.', 'warn'); return; }
    if (file.size > 25 * 1024 * 1024) { toast.show('File too large. Max 25 MB.', 'error'); return; }
    if (creds.length >= 4) { toast.show('Max 4 credentials per OTM.', 'warn'); return; }
    setUploading(true);
    const { data: { user: authUser } } = await supabase.auth.getUser();
    const ext = file.name.split('.').pop();
    const path = `otm/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage.from('otm-credentials').upload(path, file);
    if (upErr) { setUploading(false); toast.show('Upload failed: ' + upErr.message, 'error'); return; }

    const { error } = await supabase.from('otm_credentials').insert({
      user_id: user.id,
      label: newLabel.trim(),
      category: newCategory,
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      expires_on: newExpiry || null,
      uploaded_by: authUser.id
    });
    setUploading(false);
    if (error) { toast.show(error.message, 'error'); return; }
    await logAudit('otm_credential.upload', 'user', user.id, { label: newLabel });
    setNewLabel(''); setNewExpiry(''); setNewCategory('ID');
    if (fileRef.current) fileRef.current.value = '';
    toast.show('Credential uploaded.');
    load();
  }

  async function download(cred) {
    const { data, error } = await supabase.storage.from('otm-credentials').createSignedUrl(cred.file_path, 60);
    if (error) return toast.show(error.message, 'error');
    window.open(data.signedUrl, '_blank');
  }

  async function remove(cred) {
    if (!confirm(`Delete "${cred.label}"?`)) return;
    await supabase.storage.from('otm-credentials').remove([cred.file_path]);
    await supabase.from('otm_credentials').delete().eq('id', cred.id);
    await logAudit('otm_credential.delete', 'user', user.id, { label: cred.label });
    load();
  }

  function expiryBadge(d) {
    if (!d) return null;
    const days = Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));
    if (days < 0) return <span className="badge hold">EXPIRED</span>;
    if (days <= 30) return <span className="badge pending">EXPIRES IN {days}D</span>;
    return <span className="badge done">EXPIRES {formatDate(d)}</span>;
  }

  if (!user) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Credentials — ${user.name}`} subtitle="Upload ID documents, certificates, resumes. Admin-only access. Max 4 files, 25MB each."
      footer={<button className="btn-sm ink" onClick={onClose}>CLOSE</button>}>
      <div className="bg-cream-deep border border-line p-4 rounded mb-5">
        <SectionTitle kicker="Upload new">Add credential</SectionTitle>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="field-label">Label</label>
            <input className="input" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. Passport, QB ProAdvisor Cert" />
          </div>
          <div>
            <label className="field-label">Category</label>
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)}>
              <option>ID</option>
              <option>Certificate</option>
              <option>Resume</option>
              <option>Contract</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <div className="mb-3">
          <label className="field-label">Expiration date (optional)</label>
          <input type="date" className="input" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} />
        </div>
        <div>
          <input ref={fileRef} type="file" onChange={e => e.target.files[0] && uploadFile(e.target.files[0])} disabled={uploading || creds.length >= 4} />
          {uploading && <div className="text-xs text-muted mt-2">Uploading…</div>}
          {creds.length >= 4 && <div className="text-xs text-crimson mt-2">Max 4 credentials reached. Delete an existing one to add more.</div>}
        </div>
      </div>

      <SectionTitle kicker="On file">Credentials ({creds.length}/4)</SectionTitle>
      {creds.length === 0 ? (
        <Empty>No credentials uploaded yet.</Empty>
      ) : (
        <table>
          <thead><tr><th>Label</th><th>Type</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            {creds.map(c => (
              <tr key={c.id}>
                <td>
                  <strong>{c.label}</strong>
                  <div className="text-[11px] text-muted">{c.file_name}</div>
                </td>
                <td>{c.category || '—'}</td>
                <td>{expiryBadge(c.expires_on)}</td>
                <td className="whitespace-nowrap">
                  <button className="btn-sm" onClick={() => download(c)}>Download</button>{' '}
                  <button className="btn-sm danger" onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
