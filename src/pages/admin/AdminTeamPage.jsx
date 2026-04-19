import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { Empty } from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { formatDate, formatDuration, startOfWeek } from '../../lib/format';

export default function AdminTeamPage() {
  const [users, setUsers] = useState([]);
  const [weekStats, setWeekStats] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: u } = await supabase.from('users').select('*').order('name');
    setUsers(u || []);

    const sow = startOfWeek(new Date()).toISOString();
    const { data: entries } = await supabase.from('time_entries').select('user_id, duration').gte('date', sow);
    const stats = {};
    (entries || []).forEach(e => { stats[e.user_id] = (stats[e.user_id] || 0) + e.duration; });
    setWeekStats(stats);
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
        title="Team Management"
        subtitle="Add, edit, and deactivate team members."
        right={<button className="btn-sm ink" onClick={() => { setEditing(null); setModalOpen(true); }}>+ ADD USER</button>}
      />

      <div className="panel p-0 overflow-hidden">
        {users.length === 0 ? (
          <Empty>No users yet.</Empty>
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
                  <td><span className={`badge ${u.role === 'admin' ? 'ink' : 'active'}`}>{u.role.toUpperCase().replace('_', '-')}</span></td>
                  <td>{u.hourly_rate ? `$${u.hourly_rate}/hr` : '—'}</td>
                  <td>{formatDuration(weekStats[u.id] || 0)}</td>
                  <td><span className={`badge ${u.active ? 'active' : 'hold'}`}>{u.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="whitespace-nowrap">
                    <button className="btn-sm" onClick={() => { setEditing(u); setModalOpen(true); }}>Edit</button>{' '}
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
    </div>
  );
}

function UserModal({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [businesses, setBusinesses] = useState([]);
  const [assigned, setAssigned] = useState(new Set());
  const [children, setChildren] = useState([]);
  const [notableDates, setNotableDates] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function emptyForm() {
    return {
      name: '', email: '', password: '', role: 'va',
      phone: '', hourly_rate: '', weekly_hours_committed: '',
      start_date: '', birthday: '', work_anniversary: '',
      emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
      shirt_size: '', admin_notes: ''
    };
  }

  useEffect(() => {
    if (!open) return;
    supabase.from('businesses').select('id, name').eq('active', true).order('name').then(({ data }) => setBusinesses(data || []));
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
  }, [open, editing]);

  function f(k) { return { value: form[k], onChange: e => setForm(s => ({ ...s, [k]: e.target.value })) }; }

  async function save() {
    setErr('');
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email are required.');
    if (!editing && !form.password) return setErr('Password is required for new users.');
    setBusy(true);

    try {
      let userId = editing?.id;
      if (!editing) {
        // Create auth user via signUp (requires admin approval or email verification depending on Supabase settings)
        const { data: authData, error: authErr } = await supabase.auth.admin
          ? await supabase.auth.admin.createUser({ email: form.email, password: form.password, email_confirm: true })
          : await supabase.auth.signUp({ email: form.email, password: form.password });
        if (authErr) throw authErr;
        userId = authData.user?.id;
        if (!userId) throw new Error('Failed to create auth user.');
      } else if (form.password) {
        // Password reset (requires admin API or separate flow in production)
        // For demo: store via update; in production wire to admin.updateUserById
        try {
          if (supabase.auth.admin?.updateUserById) {
            await supabase.auth.admin.updateUserById(editing.id, { password: form.password });
          }
        } catch (_) {}
      }

      const payload = {
        id: userId,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
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

      if (editing) {
        const { error } = await supabase.from('users').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('users').insert(payload);
        if (error) throw error;
      }

      // Handle assignments
      await supabase.from('va_assignments').delete().eq('va_id', userId);
      if (form.role === 'va' && assigned.size) {
        const rows = Array.from(assigned).map(bid => ({ va_id: userId, business_id: bid }));
        await supabase.from('va_assignments').insert(rows);
      }

      await logAudit(editing ? 'user.update' : 'user.create', 'user', userId, { name: form.name });
      setBusy(false);
      onSaved();
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

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit user' : 'Add user'}
      subtitle={editing ? 'Update details. Leave password blank to keep current.' : 'Create login credentials and full profile.'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : (editing ? 'SAVE CHANGES' : 'CREATE USER')}</button>
        </>
      }>
      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">CREDENTIALS</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Full name</label><input className="input" {...f('name')} /></div>
        <div><label className="field-label">Email</label><input type="email" className="input" {...f('email')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div><label className="field-label">{editing ? 'New password (optional)' : 'Temporary password'}</label><input type="text" className="input" {...f('password')} /></div>
        <div>
          <label className="field-label">Role</label>
          <select {...f('role')}>
            <option value="va">VA / Contractor</option>
            <option value="sub_admin">Sub-Admin</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">CONTACT & HR</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Phone</label><input className="input" {...f('phone')} /></div>
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
        <div><label className="field-label">Phone</label><input className="input" {...f('emergency_contact_phone')} /></div>
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
          <input className="input" placeholder="Label (e.g. wedding anniversary)" value={d.label} onChange={e => updateDate(i, 'label', e.target.value)} />
          <input type="date" className="input" value={d.date} onChange={e => updateDate(i, 'date', e.target.value)} />
          <button className="btn-sm danger" onClick={() => removeDate(i)} type="button">✕</button>
        </div>
      ))}

      {form.role === 'va' && (
        <>
          <div className="font-bebas text-[11px] tracking-widest text-crimson mb-2 mt-4">ASSIGN TO BUSINESSES</div>
          <div className="bg-cream-deep border border-line p-3 rounded max-h-40 overflow-y-auto">
            {businesses.length === 0 ? (
              <div className="text-xs text-muted italic">No businesses yet. Add a client first.</div>
            ) : businesses.map(b => (
              <label key={b.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer">
                <input type="checkbox" checked={assigned.has(b.id)} onChange={() => toggleAssign(b.id)} />
                {b.name}
              </label>
            ))}
          </div>
          <div className="text-xs text-muted mt-1">VA only sees the businesses you check.</div>
        </>
      )}

      <div className="mt-4">
        <label className="field-label">Admin notes (internal only)</label>
        <textarea className="input" rows="3" {...f('admin_notes')} />
      </div>

      {err && <div className="text-sm text-crimson mt-3 p-2 bg-crimson/5 border border-crimson/20 rounded">{err}</div>}
    </Modal>
  );
}
