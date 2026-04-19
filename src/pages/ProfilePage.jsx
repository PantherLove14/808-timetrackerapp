import { useState } from 'react';
import { supabase, logAudit } from '../lib/supabase';
import PageHeader, { SectionTitle } from '../components/PageHeader';
import Modal from '../components/Modal';
import { formatDate } from '../lib/format';

export default function ProfilePage({ role, profile }) {
  const [pwdOpen, setPwdOpen] = useState(false);

  if (!profile) return null;

  const displayRole = role === 'sub_admin' ? 'Sub-Admin'
    : role === 'admin' ? 'Admin'
    : role === 'va' ? 'VA / Contractor'
    : 'Client';

  return (
    <div>
      <PageHeader
        kicker="Account"
        title="My Profile"
        subtitle="Your personal details and login."
        right={<button className="btn-sm ink" onClick={() => setPwdOpen(true)}>CHANGE PASSWORD</button>}
      />

      <div className="panel mb-6">
        <SectionTitle kicker="Contact">Personal</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <Field label="Name" value={profile.name} />
          <Field label="Email (login)" value={profile.email} />
          <Field label="Phone" value={profile.phone || '—'} />
          <Field label="Role" value={displayRole} />
          {role === 'va' && <Field label="Start date" value={profile.start_date ? formatDate(profile.start_date) : '—'} />}
          {role === 'va' && <Field label="Birthday" value={profile.birthday ? formatDate(profile.birthday) : '—'} />}
          {role === 'va' && <Field label="Work anniversary" value={profile.work_anniversary ? formatDate(profile.work_anniversary) : '—'} />}
          {role === 'va' && <Field label="Hourly rate" value={profile.hourly_rate ? `$${profile.hourly_rate}/hr` : '—'} />}
          {role === 'client' && <Field label="Address" value={profile.address || '—'} />}
          {role === 'client' && <Field label="Birthday" value={profile.birthday ? formatDate(profile.birthday) : '—'} />}
        </div>
      </div>

      {role === 'va' && (profile.emergency_contact_name || profile.emergency_contact_phone) && (
        <div className="panel mb-6">
          <SectionTitle kicker="In case of emergency">Emergency contact</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <Field label="Name" value={profile.emergency_contact_name || '—'} />
            <Field label="Phone" value={profile.emergency_contact_phone || '—'} />
            <Field label="Relationship" value={profile.emergency_contact_relationship || '—'} />
          </div>
        </div>
      )}

      <div className="panel">
        <SectionTitle kicker="Important">To update these fields</SectionTitle>
        <p className="text-sm text-slate808 leading-relaxed">
          Profile changes beyond your password are handled by your 808 administrator. Reach out to them directly for any updates to your rate, assignments, or personal details.
        </p>
      </div>

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} email={profile.email} />
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-1">{label}</div>
      <div className="text-ink">{value}</div>
    </div>
  );
}

function ChangePasswordModal({ open, onClose, email }) {
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr('');
    if (newPwd.length < 12) return setErr('New password must be at least 12 characters.');
    if (newPwd !== confirm) return setErr('Passwords do not match.');

    setBusy(true);
    // Re-authenticate with current password
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: currentPwd });
    if (signInErr) { setBusy(false); return setErr('Current password is incorrect.'); }

    const { error } = await supabase.auth.updateUser({ password: newPwd });
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit('account.password_change', null, null, {});
    setCurrentPwd(''); setNewPwd(''); setConfirm('');
    onClose();
    alert('Password updated.');
  }

  return (
    <Modal open={open} onClose={onClose} title="Change password" subtitle="Use at least 12 characters. Mix letters, numbers, and symbols."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'UPDATE PASSWORD'}</button>
      </>}>
      <div className="mb-3">
        <label className="field-label">Current password</label>
        <input type="password" className="input" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className="field-label">New password</label>
        <input type="password" className="input" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Confirm new password</label>
        <input type="password" className="input" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </div>
      {err && <div className="text-sm text-crimson mt-3 p-2 bg-crimson/5 border border-crimson/20 rounded">{err}</div>}
    </Modal>
  );
}
