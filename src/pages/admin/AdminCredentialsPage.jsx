import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { SectionTitle } from '../../components/PageHeader';

export default function AdminCredentialsPage({ profile }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);

  async function verify(e) {
    e.preventDefault();
    setErr('');
    // Re-authenticate by signing in with current email + entered password
    const { error } = await supabase.auth.signInWithPassword({ email: profile.email, password: pwd });
    if (error) {
      setErr('Wrong password. Try again.');
      return;
    }
    await logAudit('credentials.view_unlock', null, null, { by: profile.email });
    const { data: u } = await supabase.from('users').select('id, name, email, role, active').order('name');
    const { data: c } = await supabase.from('clients').select('id, name, email, active').order('name');
    setUsers(u || []);
    setClients(c || []);
    setUnlocked(true);
    setPwd('');
  }

  function relock() {
    setUnlocked(false);
    setUsers([]);
    setClients([]);
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="Credentials Vault"
        subtitle="Emergency reference for user logins. Requires password re-entry for access."
      />

      {!unlocked ? (
        <div className="panel max-w-md mx-auto">
          <div className="text-sm bg-crimson/5 border-l-4 border-crimson px-4 py-3 mb-5">
            <strong className="font-bebas tracking-wider text-crimson">RESTRICTED AREA</strong>
            <p className="text-slate808 mt-1">For security, re-enter your admin password to view user credentials. All access is logged.</p>
          </div>
          <form onSubmit={verify}>
            <label className="field-label">Your password</label>
            <input type="password" className="input" value={pwd} onChange={e => setPwd(e.target.value)} required autoFocus />
            {err && <div className="text-sm text-crimson mt-2">{err}</div>}
            <button className="btn-ink w-full py-3 mt-4">UNLOCK</button>
          </form>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-center mb-5">
            <div className="text-sm bg-warn/10 border-l-4 border-warn px-4 py-3 flex-1 mr-4">
              <strong className="font-bebas tracking-wider text-warn">UNLOCKED</strong>
              <span className="text-slate808 ml-2">Your access to this page has been logged. Do not share credentials outside authorized channels.</span>
            </div>
            <button className="btn-sm" onClick={relock}>RE-LOCK</button>
          </div>

          <div className="panel mb-6">
            <SectionTitle kicker="Team">Team members</SectionTitle>
            <p className="text-sm text-slate808 mb-4">
              Supabase stores passwords as one-way bcrypt hashes for security. You cannot view the actual password. For a user who has forgotten theirs, use "Reset password" to assign a new one.
            </p>
            <table>
              <thead><tr><th>Name</th><th>Email (login)</th><th>Role</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.email}</td>
                    <td><span className={`badge ${u.role === 'admin' ? 'ink' : 'active'}`}>{u.role.toUpperCase().replace('_', '-')}</span></td>
                    <td><span className={`badge ${u.active ? 'active' : 'hold'}`}>{u.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                    <td><button className="btn-sm" onClick={() => resetPassword('user', u)}>Reset password</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <SectionTitle kicker="Clients">Client portal logins</SectionTitle>
            <table>
              <thead><tr><th>Contact</th><th>Email (login)</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {clients.map(c => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.email}</td>
                    <td><span className={`badge ${c.active ? 'active' : 'hold'}`}>{c.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                    <td><button className="btn-sm" onClick={() => resetPassword('client', c)}>Reset password</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );

  async function resetPassword(type, record) {
    const newPwd = prompt(`Set a new password for ${record.name}. Share it with them through a secure channel.`);
    if (!newPwd || newPwd.length < 12) {
      if (newPwd) alert('Password must be at least 12 characters.');
      return;
    }
    try {
      const targetAuthId = type === 'user' ? record.id : (await supabase.from('clients').select('auth_user_id').eq('id', record.id).single()).data.auth_user_id;
      if (supabase.auth.admin?.updateUserById) {
        const { error } = await supabase.auth.admin.updateUserById(targetAuthId, { password: newPwd });
        if (error) throw error;
      } else {
        throw new Error('Supabase Admin API not available in client. See notes in README for service role setup.');
      }
      await logAudit('credentials.password_reset', type, record.id, { target_email: record.email });
      alert(`Password reset. Share this securely:\n\n${newPwd}`);
    } catch (e) {
      alert('Failed: ' + e.message + '\n\nYou may need to run this via the Supabase dashboard or a secure admin edge function.');
    }
  }
}
