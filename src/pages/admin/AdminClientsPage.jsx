import { useEffect, useState } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { Empty } from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { formatHours, startOfMonth } from '../../lib/format';

export default function AdminClientsPage() {
  const [clients, setClients] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [monthStats, setMonthStats] = useState({});
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [bizModalOpen, setBizModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [editingBiz, setEditingBiz] = useState(null);
  const [presetClientId, setPresetClientId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: c } = await supabase.from('clients').select('*').order('name');
    setClients(c || []);
    const { data: b } = await supabase.from('businesses').select('*').order('name');
    setBusinesses(b || []);

    const som = startOfMonth(new Date()).toISOString();
    const { data: entries } = await supabase.from('time_entries').select('business_id, duration').gte('date', som);
    const stats = {};
    (entries || []).forEach(e => { stats[e.business_id] = (stats[e.business_id] || 0) + e.duration; });
    setMonthStats(stats);
  }

  async function toggleClientActive(c) {
    await supabase.from('clients').update({ active: !c.active }).eq('id', c.id);
    await logAudit(c.active ? 'client.deactivate' : 'client.activate', 'client', c.id);
    load();
  }
  async function toggleBizActive(b) {
    await supabase.from('businesses').update({ active: !b.active }).eq('id', b.id);
    await logAudit(b.active ? 'business.deactivate' : 'business.activate', 'business', b.id);
    load();
  }

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title="Client Accounts"
        subtitle="Manage client contacts and their business retainers. One client can own multiple businesses."
        right={<button className="btn-sm ink" onClick={() => { setEditingClient(null); setClientModalOpen(true); }}>+ ADD CLIENT</button>}
      />

      {clients.length === 0 ? (
        <div className="panel"><Empty>No clients yet. Add your first client to get started.</Empty></div>
      ) : clients.map(c => {
        const clientBusinesses = businesses.filter(b => b.client_id === c.id);
        return (
          <div key={c.id} className="panel mb-5">
            <div className="flex justify-between items-start mb-4 pb-4 border-b border-line-soft">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-display text-xl font-semibold">{c.name}</h3>
                  <span className={`badge ${c.active ? 'active' : 'hold'}`}>{c.active ? 'ACTIVE' : 'INACTIVE'}</span>
                </div>
                <div className="text-sm text-slate808 mt-1">{c.email} • {c.phone || 'No phone on file'}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn-sm" onClick={() => { setEditingClient(c); setClientModalOpen(true); }}>Edit</button>
                <button className="btn-sm" onClick={() => toggleClientActive(c)}>{c.active ? 'Deactivate' : 'Activate'}</button>
                <button className="btn-sm ink" onClick={() => { setPresetClientId(c.id); setEditingBiz(null); setBizModalOpen(true); }}>+ ADD BUSINESS</button>
              </div>
            </div>
            {clientBusinesses.length === 0 ? (
              <div className="text-sm text-muted italic">No businesses yet. Add one above.</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Business</th><th>Tier</th><th>Monthly hrs</th><th>Used this mo</th><th>Fee</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {clientBusinesses.map(b => {
                    const used = (monthStats[b.id] || 0) / 3600;
                    const pct = (used / b.monthly_hours) * 100;
                    return (
                      <tr key={b.id}>
                        <td><strong>{b.name}</strong><br /><span className="text-xs text-muted">{b.industry || '—'}</span></td>
                        <td>{b.tier}</td>
                        <td>{b.monthly_hours}h</td>
                        <td>{formatHours(used)} <span className="text-xs text-muted">({pct.toFixed(0)}%)</span></td>
                        <td>${(b.monthly_fee || 0).toLocaleString()}</td>
                        <td><span className={`badge ${b.active ? 'active' : 'hold'}`}>{b.active ? 'ACTIVE' : 'OFF'}</span></td>
                        <td>
                          <button className="btn-sm" onClick={() => { setPresetClientId(c.id); setEditingBiz(b); setBizModalOpen(true); }}>Edit</button>{' '}
                          <button className="btn-sm" onClick={() => toggleBizActive(b)}>{b.active ? 'Deactivate' : 'Activate'}</button>
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

      <ClientModal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        editing={editingClient}
        onSaved={() => { setClientModalOpen(false); load(); }}
      />
      <BusinessModal
        open={bizModalOpen}
        onClose={() => setBizModalOpen(false)}
        editing={editingBiz}
        clientId={presetClientId}
        onSaved={() => { setBizModalOpen(false); load(); }}
      />
    </div>
  );
}

function ClientModal({ open, onClose, editing, onSaved }) {
  const [form, setForm] = useState(empty());
  const [dates, setDates] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function empty() { return { name: '', email: '', password: '', phone: '', address: '', birthday: '', admin_notes: '' }; }

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name || '', email: editing.email || '', password: '',
        phone: editing.phone || '', address: editing.address || '',
        birthday: editing.birthday || '', admin_notes: editing.admin_notes || ''
      });
      setDates(editing.notable_dates || []);
    } else { setForm(empty()); setDates([]); }
  }, [open, editing]);

  function f(k) { return { value: form[k], onChange: e => setForm(s => ({ ...s, [k]: e.target.value })) }; }

  async function save() {
    setErr('');
    if (!form.name.trim() || !form.email.trim()) return setErr('Name and email required.');
    if (!editing && !form.password) return setErr('Password required for new clients.');
    setBusy(true);
    try {
      let authUserId = editing?.auth_user_id;
      if (!editing) {
        const { data: auth, error: aErr } = supabase.auth.admin?.createUser
          ? await supabase.auth.admin.createUser({ email: form.email, password: form.password, email_confirm: true })
          : await supabase.auth.signUp({ email: form.email, password: form.password });
        if (aErr) throw aErr;
        authUserId = auth.user?.id;
      } else if (form.password && supabase.auth.admin?.updateUserById) {
        try { await supabase.auth.admin.updateUserById(editing.auth_user_id, { password: form.password }); } catch (_) {}
      }
      const payload = {
        auth_user_id: authUserId,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone || null,
        address: form.address || null,
        birthday: form.birthday || null,
        notable_dates: dates,
        admin_notes: form.admin_notes || null
      };
      if (editing) {
        const { error } = await supabase.from('clients').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('clients').insert(payload);
        if (error) throw error;
      }
      await logAudit(editing ? 'client.update' : 'client.create', 'client', editing?.id, { name: form.name });
      setBusy(false);
      onSaved();
    } catch (e) { setBusy(false); setErr(e.message); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit client' : 'Add client'}
      subtitle={editing ? 'Update contact and credentials.' : 'Create the client contact (portal login).'}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE'}</button></>}>
      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3">CONTACT & PORTAL LOGIN</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Contact name</label><input className="input" {...f('name')} /></div>
        <div><label className="field-label">Email (login)</label><input type="email" className="input" {...f('email')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">{editing ? 'Reset password (optional)' : 'Temporary password'}</label><input className="input" {...f('password')} /></div>
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
      {err && <div className="text-sm text-crimson mt-2">{err}</div>}
    </Modal>
  );
}

function BusinessModal({ open, onClose, editing, clientId, onSaved }) {
  const [form, setForm] = useState(empty());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function empty() {
    return {
      name: '', industry: '', tax_classification: '',
      billing_contact_name: '', billing_contact_email: '',
      onboarding_date: '', renewal_date: '',
      tier: 'Starter', monthly_hours: 20, monthly_fee: 0,
      rollover_enabled: true, rollover_cap_pct: 50, overage_rate: ''
    };
  }

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name, industry: editing.industry || '',
        tax_classification: editing.tax_classification || '',
        billing_contact_name: editing.billing_contact_name || '',
        billing_contact_email: editing.billing_contact_email || '',
        onboarding_date: editing.onboarding_date || '',
        renewal_date: editing.renewal_date || '',
        tier: editing.tier, monthly_hours: editing.monthly_hours,
        monthly_fee: editing.monthly_fee,
        rollover_enabled: editing.rollover_enabled,
        rollover_cap_pct: editing.rollover_cap_pct,
        overage_rate: editing.overage_rate || ''
      });
    } else setForm(empty());
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
      industry: form.industry || null,
      tax_classification: form.tax_classification || null,
      billing_contact_name: form.billing_contact_name || null,
      billing_contact_email: form.billing_contact_email || null,
      onboarding_date: form.onboarding_date || null,
      renewal_date: form.renewal_date || null,
      tier: form.tier,
      monthly_hours: parseInt(form.monthly_hours) || 20,
      monthly_fee: parseFloat(form.monthly_fee) || 0,
      rollover_enabled: !!form.rollover_enabled,
      rollover_cap_pct: parseInt(form.rollover_cap_pct) || 50,
      overage_rate: form.overage_rate ? parseFloat(form.overage_rate) : null
    };
    const { error } = editing
      ? await supabase.from('businesses').update(payload).eq('id', editing.id)
      : await supabase.from('businesses').insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit(editing ? 'business.update' : 'business.create', 'business', editing?.id, { name: form.name });
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit business' : 'Add business'}
      subtitle="Each business has its own retainer and can have a different VA team."
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE'}</button></>}>
      <div className="mb-3">
        <label className="field-label">Business name</label>
        <input className="input" {...f('name')} />
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Industry</label><input className="input" {...f('industry')} /></div>
        <div><label className="field-label">Tax classification</label><input className="input" {...f('tax_classification')} placeholder="501c3, LLC, Corp..." /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Billing contact name</label><input className="input" {...f('billing_contact_name')} /></div>
        <div><label className="field-label">Billing contact email</label><input className="input" type="email" {...f('billing_contact_email')} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Onboarding date</label><input type="date" className="input" {...f('onboarding_date')} /></div>
        <div><label className="field-label">Renewal date</label><input type="date" className="input" {...f('renewal_date')} /></div>
      </div>

      <div className="font-bebas text-[11px] tracking-widest text-crimson mb-3 mt-4">RETAINER</div>
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
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div><label className="field-label">Rollover cap (%)</label><input type="number" className="input" {...f('rollover_cap_pct')} min="0" max="100" /></div>
        <div><label className="field-label">Overage rate ($/hr)</label><input type="number" className="input" step="0.01" {...f('overage_rate')} /></div>
      </div>
      <div className="text-xs text-muted">Unused hours roll to next month (capped at % of base) and expire if unused.</div>
      {err && <div className="text-sm text-crimson mt-3">{err}</div>}
    </Modal>
  );
}
