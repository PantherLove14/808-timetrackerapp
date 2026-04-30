import { useState, useEffect } from 'react';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle } from '../components/PageHeader';
import { AvatarUploader } from '../components/Avatar';
import { useToast } from '../components/BusinessSelector';

export default function ProfilePage({ role, profile }) {
  const [me, setMe] = useState(null);
  const [editing, setEditing] = useState({});
  const [busy, setBusy] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const toast = useToast();

  const isClient = role === 'client';
  const tableName = isClient ? 'clients' : 'users';

  useEffect(() => { load(); }, [profile]);

  async function load() {
    if (!profile) return;
    const { data } = await supabase.from(tableName).select('*').eq('id', profile.id).single();
    setMe(data);
    setEditing({
      name: data?.name || '',
      phone: data?.phone || '',
      address: data?.address || '',
      birthday: data?.birthday || ''
    });
  }

  async function save() {
    setBusy(true);
    const payload = {
      name: editing.name.trim(),
      phone: editing.phone || null,
      address: editing.address || null,
      birthday: editing.birthday || null
    };
    const { error } = await supabase.from(tableName).update(payload).eq('id', profile.id);
    setBusy(false);
    if (error) return toast.show(error.message, 'error');
    await logAudit('profile.update');
    toast.show('Profile saved.');
    load();
  }

  async function changePassword() {
    if (!pwd.next) return toast.show('Enter a new password.', 'warn');
    if (pwd.next.length < 12) return toast.show('Password must be at least 12 characters.', 'warn');
    if (pwd.next !== pwd.confirm) return toast.show('Passwords do not match.', 'warn');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd.next });
    setBusy(false);
    if (error) return toast.show(error.message, 'error');
    await logAudit('profile.password_change');
    toast.show('Password changed successfully.');
    setPwd({ current: '', next: '', confirm: '' });
  }

  if (!me) return <div className="text-center py-20 text-muted">Loading…</div>;

  return (
    <div>
      <PageHeader kicker="Account" title="My Profile" subtitle="Update your information and password." />

      <div className="panel mb-6">
        <SectionTitle kicker="Photo">Profile picture</SectionTitle>
        <AvatarUploader
          avatarUrl={me.avatar_url}
          ownerType={isClient ? 'client' : 'user'}
          ownerId={me.id}
          name={me.name}
          onChange={() => load()}
        />
        <div className="text-xs text-muted mt-3">Your photo is visible to admins, your assigned OTMs, and your clients (where applicable).</div>
      </div>

      <div className="panel mb-6">
        <SectionTitle kicker="Contact">Personal info</SectionTitle>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div><label className="field-label">Full name</label><input className="input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
          <div><label className="field-label">Email</label><input className="input" value={me.email} disabled /></div>
          <div><label className="field-label">Phone</label><input className="input" value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} /></div>
          <div><label className="field-label">Birthday</label><input type="date" className="input" value={editing.birthday} onChange={e => setEditing({ ...editing, birthday: e.target.value })} /></div>
        </div>
        <div className="mb-3">
          <label className="field-label">Address</label>
          <input className="input" value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} />
        </div>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE PROFILE'}</button>
      </div>

      <div className="panel">
        <SectionTitle kicker="Security">Change password</SectionTitle>
        <div className="grid grid-cols-2 gap-3 mb-3 max-w-lg">
          <div className="col-span-2">
            <label className="field-label">New password (min 12 chars)</label>
            <input type="password" className="input" value={pwd.next} onChange={e => setPwd({ ...pwd, next: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="field-label">Confirm new password</label>
            <input type="password" className="input" value={pwd.confirm} onChange={e => setPwd({ ...pwd, confirm: e.target.value })} />
          </div>
        </div>
        <button className="btn-sm" onClick={changePassword} disabled={busy}>CHANGE PASSWORD</button>
      </div>
    </div>
  );
}
