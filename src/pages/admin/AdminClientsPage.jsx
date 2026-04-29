import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { Empty } from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { useToast } from '../../components/BusinessSelector';
import { BUSINESS_TYPES, BUSINESS_INDUSTRIES } from '../../lib/constants';
import { businessDot } from '../../lib/businessColor';
import { formatHours, startOfMonth } from '../../lib/format';

export default function AdminClientsPage() {
  const [clients, setClients] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [allOTMs, setAllOTMs] = useState([]);
  const [assignmentsByBiz, setAssignmentsByBiz] = useState({});
  const [monthStats, setMonthStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [editClientOpen, setEditClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [bizModalOpen, setBizModalOpen] = useState(false);
  const [editingBiz, setEditingBiz] = useState(null);
  const [presetClientId, setPresetClientId] = useState(null);
  const [otmModalOpen, setOTMModalOpen] = useState(false);
  const [otmModalBiz, setOTMModalBiz] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const [clientsResult, bizResult, otmsResult, assignsResult] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('businesses').select('*').order('name'),
        supabase.from('users').select('id, name, email, active').eq('role', 'va').eq('active', true).order('name'),
        supabase.from('va_assignments').select('va_id, business_id, users(id, name)')
      ]);

      // Surface any RLS / network errors instead of silently showing zero
      const errors = [clientsResult.error, bizResult.error, otmsResult.error, assignsResult.error].filter(Boolean);
      if (errors.length) {
        setLoadError(errors.map(e => e.message).join(' | '));
      }

      setClients(clientsResult.data || []);
      setBusinesses(bizResult.data || []);
      setAllOTMs(otmsResult.data || []);

      // Group assignments by business for quick lookup
      const byBiz = {};
      (assignsResult.data || []).forEach(a => {
        if (!byBiz[a.business_id]) byBiz[a.business_id] = [];
        byBiz[a.business_id].push({ va_id: a.va_id, name: a.users?.name });
      });
      setAssignmentsByBiz(byBiz);

      // Month stats for retainer usage
      const som = startOfMonth(new Date()).toISOString();
      const { data: entries } = await supabase.from('time_entries').select('business_id, duration').gte('date', som);
      const stats = {};
      (entries || []).forEach(e => { stats[e.business_id] = (stats[e.business_id] || 0) + e.duration; });
      setMonthStats(stats);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleClientActive(c) {
    const { error } = await supabase.from('clients').update({ active: !c.active }).eq('id', c.id);
    if (error) return alert(error.message);
    await logAudit(c.active ? 'client.deactivate' : 'client.activate', 'client', c.id);
    load();
  }
  async function toggleBizActive(b) {
    const { error } = await supabase.from('businesses').update({ active: !b.active }).eq('id', b.id);
    if (error) return alert(error.message);
    await logAudit(b.active ? 'business.deactivate' : 'business.activate', 'business', b.id);
    load();
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="Client Accounts"
        subtitle="Manage client contacts and their business retainers. A client can own multiple businesses."
        right={<>
          <button className="btn-sm" onClick={load}>↻ Refresh</button>{' '}
          <button className="btn-sm ink" onClick={() => setAddClientOpen(true)}>+ ADD CLIENT</button>
        </>}
      />

      {loadError && (
        <div className="panel mb-5" style={{ borderColor: 'var(--crimson)', background: 'rgba(168,4,4,0.06)' }}>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-1">LOAD ERROR</div>
          <div className="text-sm">{loadError}</div>
          <div className="text-xs text-muted mt-2">If this persists, check your network or contact your developer.</div>
        </div>
      )}

      {loading ? (
        <div className="panel"><Empty>Loading…</Empty></div>
      ) : clients.length === 0 ? (
        <div className="panel"><Empty>No clients yet. Add your first client to get started.</Empty></div>
      ) : clients.map(c => {
        const clientBusinesses = businesses.filter(b => b.client_id === c.id);
        return (
          <div key={c.id} className="panel mb-5">
            <div className="flex justify-between items-start mb-4 pb-4 border-b border-line-soft">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-display text-xl font-semibold">{c.name}</h3>
                  <span className={`badge ${c.active ? 'active' : 'hold'}`}>{c.active ? 'ACTIVE' : 'INACTIVE'}</span>
                </div>
                <div className="text-sm text-slate808 mt-1">{c.email} • {c.phone || 'No phone on file'}</div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-sm" onClick={() => { setEditingClient(c); setEditClientOpen(true); }}>Edit client</button>
                <button className="btn-sm" onClick={() => toggleClientActive(c)}>{c.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn-sm ink" onClick={() => { setPresetClientId(c.id); setEditingBiz(null); setBizModalOpen(true); }}>+ ADD BUSINESS</button>
              </div>
            </div>
            {clientBusinesses.length === 0 ? (
              <div className="text-sm text-muted italic">No businesses yet. Click "+ ADD BUSINESS" above to add one.</div>
            ) : (
              <table>
                <thead>
                  <tr><th></th><th>Business</th><th>Type / Industry</th><th>Tier / Hrs</th><th>Used this mo</th><th>Fee</th><th>OTMs</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {clientBusinesses.map(b => {
                    const used = (monthStats[b.id] || 0) / 3600;
                    const pct = b.monthly_hours > 0 ? (used / b.monthly_hours) * 100 : 0;
                    const otms = assignmentsByBiz[b.id] || [];
                    return (
                      <tr key={b.id}>
                        <td><span style={businessDot(b.id)} /></td>
                        <td>
                          <strong>{b.name}</strong>
                          {b.website && <><br /><a href={b.website.startsWith('http') ? b.website : `https://${b.website}`} target="_blank" rel="noreferrer" className="text-xs text-crimson hover:underline">{b.website}</a></>}
                        </td>
                        <td>
                          <div className="text-xs">{b.business_type || '—'}</div>
                          <div className="text-xs text-muted">{b.industry || '—'}</div>
                        </td>
                        <td>{b.tier} • {b.monthly_hours}h</td>
                        <td>{formatHours(used)} <span className="text-xs text-muted">({pct.toFixed(0)}%)</span></td>
                        <td>${(b.monthly_fee || 0).toLocaleString()}</td>
                        <td>
                          {otms.length === 0 ? <span className="text-xs text-muted italic">None</span> : (
                            <div className="text-xs">{otms.map(o => o.name).join(', ')}</div>
                          )}
                        </td>
                        <td><span className={`badge ${b.active ? 'active' : 'hold'}`}>{b.active ? 'ACTIVE' : 'OFF'}</span></td>
                        <td className="whitespace-nowrap">
                          <button className="btn-sm" onClick={() => { setPresetClientId(c.id); setEditingBiz(b); setBizModalOpen(true); }}>Edit</button>{' '}
                          <button className="btn-sm" onClick={() => { setOTMModalBiz(b); setOTMModalOpen(true); }}>Assign OTMs</button>{' '}
                          <button className="btn-sm" onClick={() => toggleBizActive(b)}>{b.active ? 'Off' : 'On'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      <AddClientModal open={addClientOpen} onClose={() => setAddClientOpen(false)} onSaved={() => { setAddClientOpen(false); load(); }} />
      <EditClientModal open={editClientOpen} onClose={() => setEditClientOpen(false)} editing={editingClient} onSaved={() => { setEditClientOpen(false); load(); }} />
      <BusinessModal open={bizModalOpen} onClose={() => setBizModalOpen(false)} editing={editingBiz} clientId={presetClientId} onSaved={() => { setBizModalOpen(false); load(); }} />
      <AssignOTMModal open={otmModalOpen} onClose={() => setOTMModalOpen(false)} business={otmModalBiz} otms={allOTMs} currentAssignments={otmModalBiz ? (assignmentsByBiz[otmModalBiz.id] || []) : []} onSaved={() => { setOTMModalOpen(false); load(); }} />
    </div>
  );
}

// Combined client + first business form
function AddClientModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const toast = useToast();

  function emptyForm() {
    return {
      contactName: '', email: '', password: '', phone: '', address: '', birthday: '',
      companyName: '', businessType: 'LLC', industry: '', website: '', ein: '',
      contractStart: '', contractEnd: '',
      tier: 'Starter', monthlyHours: 40, monthlyFee: 0, rolloverEnabled: true, rolloverCapPct: 50, overageRate: ''
    };
  }

  useEffect(() => {
    if (open) { setForm(emptyForm()); setErr(''); setNewPassword(''); }
  }, [open]);

  function f(k) { return { value: form[k], onChange: e => setForm(s => ({ ...s, [k]: e.target.value })) }; }

  function generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 16; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    return pwd;
  }

  async function save() {
    setErr('');
    if (!form.contactName.trim()) return setErr('Contact person name is required.');
    if (!form.email.trim()) return setErr('Email is required.');
    if (!form.email.includes('@')) return setErr('Please enter a valid email.');
    if (!form.companyName.trim()) return setErr('Company name is required.');
    if (!form.industry) return setErr('Pick a business industry.');

    setBusy(true);
    try {
      const tempPassword = form.password || generatePassword();
      if (tempPassword.length < 12) throw new Error('Password must be at least 12 characters.');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in. Please refresh the page and log in again.');
      const url = import.meta.env.VITE_SUPABASE_URL;

      const clientProfile = {
        name: form.contactName.trim(),
        phone: form.phone || null,
        address: form.address || null,
        birthday: form.birthday || null
      };

      const resp = await fetch(`${url}/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          type: 'client',
          email: form.email.trim().toLowerCase(),
          password: tempPassword,
          profile: clientProfile
        })
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || `Edge function returned ${resp.status}`);

      // Use the client_id returned by the edge function (no second fetch needed)
      const clientId = result.client_id;
      if (!clientId) throw new Error('Edge function did not return client_id. Update the edge function code.');

      // Create the first business
      const { error: bizErr } = await supabase.from('businesses').insert({
        client_id: clientId,
        name: form.companyName.trim(),
        business_type: form.businessType,
        industry: form.industry,
        website: form.website || null,
        ein: form.ein || null,
        contract_start_date: form.contractStart || null,
        contract_end_date: form.contractEnd || null,
        tier: form.tier,
        monthly_hours: parseInt(form.monthlyHours) || 40,
        monthly_fee: parseFloat(form.monthlyFee) || 0,
        rollover_enabled: !!form.rolloverEnabled,
        rollover_cap_pct: parseInt(form.rolloverCapPct) || 50,
        overage_rate: form.overageRate ? parseFloat(form.overageRate) : null,
        active: true
      });
      if (bizErr) throw new Error('Client was created but business insert failed: ' + bizErr.message);

      await logAudit('client.create', 'client', clientId, { name: form.contactName, company: form.companyName });

      setBusy(false);
      setNewPassword(tempPassword);
      toast.show(`Client ${form.contactName} created with business ${form.companyName}.`);
    } catch (e) {
      setBusy(false);
      setErr(e.message);
    }
  }

  if (newPassword) {
    return (
      <Modal open={open} onClose={() => { setNewPassword(''); onSaved(); }}
        title="Client created"
        subtitle="Share these credentials securely with the client. This is the only time you'll see this password."
        footer={<button className="btn-sm ink" onClick={() => { setNewPassword(''); onSaved(); }}>DONE</button>}>
        <div className="bg-cream-deep border border-line p-4 rounded mb-4">
          <div className="font-bebas text-[11px] tracking-widest text-crimson mb-2">EMAIL</div>
          <div className="font-mono text-sm mb-3 break-all">{form.email}</div>
          <div className="font-bebas text-[11px] tracking-widest text-crimson mb-2">TEMPORARY PASSWORD</div>
          <div className="font-mono text-sm break-all bg-paper border border-line px-3 py-2 rounded">{newPassword}</div>
          <button
            className="btn-sm mt-3"
            onClick={() => {
              navigator.clipboard.writeText(`Welcome to 808 Talent Source!\n\nSign in at: ${window.location.origin}\n\nEmail: ${form.email}\nTemporary password: ${newPassword}\n\nPlease change your password after first login from your Profile page.`);
              toast.show('Welcome message copied to clipboard.');
            }}
          >Copy welcome message</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Add client" subtitle="Creates the client contact and their first business together."
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'CREATING…' : 'CREATE CLIENT + BUSINESS'}</button>
      </>}>
      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">CONTACT PERSON (PORTAL LOGIN)</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Contact name</label><input className="input" {...f('contactName')} placeholder="Jane Smith" /></div>
        <div><label className="field-label">Email (login)</label><input type="email" className="input" {...f('email')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Phone</label><input className="input" {...f('phone')} placeholder="555-555-5555" /></div>
        <div><label className="field-label">Birthday</label><input type="date" className="input" {...f('birthday')} /></div>
      </div>
      <div className="mb-3">
        <label className="field-label">Address</label>
        <input className="input" {...f('address')} />
      </div>
      <div className="mb-5">
        <label className="field-label">Temporary password (leave blank to auto-generate)</label>
        <input type="text" className="input" {...f('password')} placeholder="Auto-generate secure password" />
      </div>

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">FIRST BUSINESS</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Company name</label><input className="input" {...f('companyName')} /></div>
        <div><label className="field-label">Website</label><input className="input" {...f('website')} placeholder="example.com" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="field-label">Business type</label>
          <select {...f('businessType')}>
            {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Industry</label>
          <select {...f('industry')}>
            <option value="">Select industry…</option>
            {BUSINESS_INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div><label className="field-label">EIN</label><input className="input" {...f('ein')} placeholder="XX-XXXXXXX" /></div>
        <div><label className="field-label">Contract start</label><input type="date" className="input" {...f('contractStart')} /></div>
        <div><label className="field-label">Contract end</label><input type="date" className="input" {...f('contractEnd')} /></div>
      </div>

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3 mt-4">RETAINER</div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="field-label">Tier</label>
          <select {...f('tier')}>
            <option>Starter</option><option>Growth</option><option>Scale</option><option>Custom</option>
          </select>
        </div>
        <div><label className="field-label">Monthly hours</label><input type="number" className="input" {...f('monthlyHours')} /></div>
        <div><label className="field-label">Monthly fee ($)</label><input type="number" className="input" {...f('monthlyFee')} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="field-label">Rollover enabled</label>
          <select value={form.rolloverEnabled ? 'true' : 'false'} onChange={e => setForm(s => ({ ...s, rolloverEnabled: e.target.value === 'true' }))}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </div>
        <div><label className="field-label">Rollover cap (%)</label><input type="number" className="input" {...f('rolloverCapPct')} min="0" max="100" /></div>
        <div><label className="field-label">Overage rate ($/hr)</label><input type="number" className="input" step="0.01" {...f('overageRate')} /></div>
      </div>

      {err && <div className="text-sm text-crimson mt-3 p-2 bg-crimson/5 border border-crimson/20 rounded">{err}</div>}
    </Modal>
  );
}

function EditClientModal({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open && editing) {
      setForm({
        name: editing.name || '',
        phone: editing.phone || '',
        address: editing.address || '',
        birthday: editing.birthday || '',
        admin_notes: editing.admin_notes || ''
      });
      setErr('');
    }
  }, [open, editing]);

  function f(k) { return { value: form[k] || '', onChange: e => setForm(s => ({ ...s, [k]: e.target.value })) }; }

  async function save() {
    setErr('');
    if (!form.name?.trim()) return setErr('Name required.');
    setBusy(true);
    const { error } = await supabase.from('clients').update({
      name: form.name.trim(),
      phone: form.phone || null,
      address: form.address || null,
      birthday: form.birthday || null,
      admin_notes: form.admin_notes || null
    }).eq('id', editing.id);
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit('client.update', 'client', editing.id);
    toast.show('Client updated.');
    onSaved();
  }

  if (!editing) return null;

  return (
    <Modal open={open} onClose={onClose} title="Edit client contact"
      subtitle={editing?.email}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Contact name</label><input className="input" {...f('name')} /></div>
        <div><label className="field-label">Phone</label><input className="input" {...f('phone')} /></div>
      </div>
      <div className="mb-3">
        <label className="field-label">Address</label>
        <input className="input" {...f('address')} />
      </div>
      <div className="mb-3">
        <label className="field-label">Birthday</label>
        <input type="date" className="input" {...f('birthday')} />
      </div>
      <div>
        <label className="field-label">Admin notes</label>
        <textarea className="input" rows="3" {...f('admin_notes')} />
      </div>
      <div className="text-xs text-muted mt-3 pt-3 border-t border-line-soft">
        Email can't be changed after creation. To reset password, use the Credentials Vault page.
      </div>
      {err && <div className="text-sm text-crimson mt-2">{err}</div>}
    </Modal>
  );
}

function BusinessModal({ open, onClose, editing, clientId, onSaved }) {
  const [form, setForm] = useState(empty());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  function empty() {
    return {
      name: '', business_type: 'LLC', industry: '', website: '', ein: '',
      contract_start_date: '', contract_end_date: '',
      tier: 'Starter', monthly_hours: 40, monthly_fee: 0,
      rollover_enabled: true, rollover_cap_pct: 50, overage_rate: ''
    };
  }

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name, business_type: editing.business_type || 'LLC',
        industry: editing.industry || '', website: editing.website || '', ein: editing.ein || '',
        contract_start_date: editing.contract_start_date || '',
        contract_end_date: editing.contract_end_date || '',
        tier: editing.tier, monthly_hours: editing.monthly_hours,
        monthly_fee: editing.monthly_fee,
        rollover_enabled: editing.rollover_enabled,
        rollover_cap_pct: editing.rollover_cap_pct,
        overage_rate: editing.overage_rate || ''
      });
    } else setForm(empty());
    setErr('');
  }, [open, editing]);

  function f(k) { return { value: form[k], onChange: e => setForm(s => ({ ...s, [k]: e.target.value })) }; }

  async function save() {
    setErr('');
    if (!form.name.trim()) return setErr('Business name required.');
    if (!clientId) return setErr('Client id missing.');
    setBusy(true);
    const payload = {
      client_id: clientId,
      name: form.name.trim(),
      business_type: form.business_type || null,
      industry: form.industry || null,
      website: form.website || null,
      ein: form.ein || null,
      contract_start_date: form.contract_start_date || null,
      contract_end_date: form.contract_end_date || null,
      tier: form.tier,
      monthly_hours: parseInt(form.monthly_hours) || 40,
      monthly_fee: parseFloat(form.monthly_fee) || 0,
      rollover_enabled: !!form.rollover_enabled,
      rollover_cap_pct: parseInt(form.rollover_cap_pct) || 50,
      overage_rate: form.overage_rate ? parseFloat(form.overage_rate) : null
    };
    const { error } = editing
      ? await supabase.from('businesses').update(payload).eq('id', editing.id)
      : await supabase.from('businesses').insert({ ...payload, active: true });
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit(editing ? 'business.update' : 'business.create', 'business', editing?.id, { name: form.name });
    toast.show(editing ? 'Business updated.' : 'Business added.');
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit business' : 'Add business'}
      subtitle="Each business has its own retainer and OTM team."
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE'}</button></>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Company name</label><input className="input" {...f('name')} /></div>
        <div><label className="field-label">Website</label><input className="input" {...f('website')} placeholder="example.com" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="field-label">Business type</label>
          <select {...f('business_type')}>
            {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">Industry</label>
          <select {...f('industry')}>
            <option value="">Select…</option>
            {BUSINESS_INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div><label className="field-label">EIN</label><input className="input" {...f('ein')} placeholder="XX-XXXXXXX" /></div>
        <div><label className="field-label">Contract start</label><input type="date" className="input" {...f('contract_start_date')} /></div>
        <div><label className="field-label">Contract end</label><input type="date" className="input" {...f('contract_end_date')} /></div>
      </div>

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">RETAINER</div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="field-label">Tier</label>
          <select {...f('tier')}>
            <option>Starter</option><option>Growth</option><option>Scale</option><option>Custom</option>
          </select>
        </div>
        <div><label className="field-label">Monthly hours</label><input type="number" className="input" {...f('monthly_hours')} /></div>
        <div><label className="field-label">Monthly fee ($)</label><input type="number" className="input" {...f('monthly_fee')} /></div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <label className="field-label">Rollover enabled</label>
          <select value={form.rollover_enabled ? 'true' : 'false'} onChange={e => setForm(s => ({ ...s, rollover_enabled: e.target.value === 'true' }))}>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </div>
        <div><label className="field-label">Rollover cap (%)</label><input type="number" className="input" {...f('rollover_cap_pct')} min="0" max="100" /></div>
        <div><label className="field-label">Overage rate ($/hr)</label><input type="number" className="input" step="0.01" {...f('overage_rate')} /></div>
      </div>

      {err && <div className="text-sm text-crimson mt-3">{err}</div>}
    </Modal>
  );
}

function AssignOTMModal({ open, onClose, business, otms, currentAssignments, onSaved }) {
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) setSelected(new Set(currentAssignments.map(a => a.va_id)));
  }, [open, currentAssignments]);

  if (!business) return null;

  function toggle(id) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }

  async function save() {
    setBusy(true);
    // Wipe and re-insert assignments for this business
    const { error: delErr } = await supabase.from('va_assignments').delete().eq('business_id', business.id);
    if (delErr) { setBusy(false); return toast.show(delErr.message, 'error'); }
    if (selected.size > 0) {
      const rows = Array.from(selected).map(vaId => ({ va_id: vaId, business_id: business.id }));
      const { error: insErr } = await supabase.from('va_assignments').insert(rows);
      if (insErr) { setBusy(false); return toast.show(insErr.message, 'error'); }
    }
    await logAudit('va_assignment.bulk_update', 'business', business.id, { count: selected.size });
    setBusy(false);
    toast.show(`${selected.size} OTM(s) assigned to ${business.name}.`);
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Assign OTMs — ${business.name}`}
      subtitle="Check OTMs who should work on this business."
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE ASSIGNMENTS'}</button></>}>
      {otms.length === 0 ? (
        <Empty>No active OTMs. Add them in the OTM Team page first.</Empty>
      ) : (
        <div className="bg-cream-deep border border-line p-3 rounded">
          {otms.map(o => (
            <label key={o.id} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-paper px-2 rounded">
              <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
              <div>
                <div className="font-medium text-sm">{o.name}</div>
                <div className="text-[11px] text-muted">{o.email}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
