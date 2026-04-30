import { useEffect, useState, useMemo } from 'react';
import { supabase, logAudit } from '../../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../../components/PageHeader';
import Modal from '../../components/Modal';
import { useToast } from '../../components/BusinessSelector';
import { BRAND } from '../../lib/constants';
import { formatHours, formatMoney, formatMonthKey, monthKey } from '../../lib/format';

export default function AdminPayPage() {
  const [otms, setOTMs] = useState([]);
  const [hours, setHours] = useState({});
  const [month, setMonth] = useState(monthKey(new Date()));
  const [stubs, setStubs] = useState([]);
  const [allStubs, setAllStubs] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => { load(); }, [month]);
  useEffect(() => { loadAllStubs(); }, []);

  async function load() {
    setLoadError('');
    const { data: us, error: uErr } = await supabase.from('users').select('*').eq('role', 'va').eq('active', true).order('name');
    if (uErr) setLoadError(uErr.message);
    setOTMs(us || []);

    const start = new Date(month + '-01').toISOString();
    const endMonth = new Date(month + '-01');
    endMonth.setMonth(endMonth.getMonth() + 1);
    const end = endMonth.toISOString();

    const { data: entries } = await supabase.from('time_entries').select('user_id, duration')
      .gte('date', start).lt('date', end);
    const h = {};
    (entries || []).forEach(e => { h[e.user_id] = (h[e.user_id] || 0) + e.duration; });
    setHours(h);

    const { data: s } = await supabase.from('pay_stubs').select('*, users(name, email)').eq('month', month + '-01').order('users(name)');
    setStubs(s || []);
  }

  async function loadAllStubs() {
    const { data } = await supabase.from('pay_stubs').select('*, users(name, email)').order('month', { ascending: false }).limit(200);
    setAllStubs(data || []);
  }

  const filteredStubs = useMemo(() => {
    if (!search.trim()) return allStubs;
    const q = search.toLowerCase();
    return allStubs.filter(s =>
      (s.users?.name || '').toLowerCase().includes(q) ||
      (s.users?.email || '').toLowerCase().includes(q) ||
      formatMonthKey(s.month).toLowerCase().includes(q)
    );
  }, [allStubs, search]);

  async function deleteStub(stub) {
    if (!confirm(`Delete stub for ${stub.users?.name || 'OTM'} (${formatMonthKey(stub.month)})? This cannot be undone.`)) return;
    const { error } = await supabase.from('pay_stubs').delete().eq('id', stub.id);
    if (error) return alert(error.message);
    await logAudit('pay_stub.delete', 'pay_stub', stub.id);
    load();
    loadAllStubs();
  }

  return (
    <div>
      <PageHeader kicker="Admin" title="OTM Pay & Stubs" subtitle="Pay calculations and downloadable monthly pay stubs." />

      {loadError && (
        <div className="panel mb-5" style={{ borderColor: 'var(--crimson)', background: 'rgba(168,4,4,0.06)' }}>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-1">LOAD ERROR</div>
          <div className="text-sm">{loadError}</div>
        </div>
      )}

      <div className="panel mb-6">
        <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
          <div><SectionTitle kicker="Generate stubs">Pay period</SectionTitle></div>
          <input type="month" className="input max-w-xs" value={month} onChange={e => setMonth(e.target.value)} />
        </div>

        <table>
          <thead><tr><th>OTM</th><th>Hours</th><th>Rate</th><th>Base pay</th><th>Stub</th><th></th></tr></thead>
          <tbody>
            {otms.length === 0 ? (
              <tr><td colSpan="6"><Empty>No active OTMs.</Empty></td></tr>
            ) : otms.map(v => {
              const hr = (hours[v.id] || 0) / 3600;
              const basePay = v.hourly_rate ? v.hourly_rate * hr : 0;
              const existing = stubs.find(s => s.user_id === v.id);
              return (
                <tr key={v.id}>
                  <td><strong>{v.name}</strong></td>
                  <td>{formatHours(hr)}</td>
                  <td>{v.hourly_rate ? `${formatMoney(v.hourly_rate)}/hr` : 'Rate not set'}</td>
                  <td>{formatMoney(basePay)}</td>
                  <td>{existing ? <span className="badge active">GENERATED</span> : <span className="badge pending">NOT YET</span>}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-sm ink" onClick={() => { setEditing({ ...v, hours: hr, existing }); setModalOpen(true); }}>
                      {existing ? 'EDIT STUB' : 'GENERATE STUB'}
                    </button>
                    {existing && <> <button className="btn-sm" onClick={() => downloadStub(existing)}>Download</button></>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-3">
          <SectionTitle kicker="All issued stubs">Pay stub history</SectionTitle>
          <input type="text" className="input max-w-xs" placeholder="Search by name, email, or month…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {filteredStubs.length === 0 ? <Empty>{search ? `No stubs match "${search}".` : 'No stubs generated yet.'}</Empty> : (
          <table>
            <thead><tr><th>OTM</th><th>Month</th><th>Hours</th><th>Base</th><th>Bonus</th><th>Deductions</th><th>Net</th><th>Generated</th><th></th></tr></thead>
            <tbody>
              {filteredStubs.map(s => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.users?.name || '—'}</strong>
                    <div className="text-[11px] text-muted">{s.users?.email}</div>
                  </td>
                  <td>{formatMonthKey(s.month)}</td>
                  <td>{formatHours(s.hours_worked)}</td>
                  <td>{formatMoney(s.base_pay)}</td>
                  <td>{formatMoney(s.bonus || 0)}</td>
                  <td>{formatMoney(s.deductions || 0)}</td>
                  <td><strong>{formatMoney(s.net_pay)}</strong></td>
                  <td className="text-xs text-muted">{s.generated_at ? new Date(s.generated_at).toLocaleDateString() : '—'}</td>
                  <td className="whitespace-nowrap">
                    <button className="btn-sm" onClick={() => downloadStub(s)}>Download</button>{' '}
                    <button className="btn-sm danger" onClick={() => deleteStub(s)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-xs text-muted mt-3">{filteredStubs.length} of {allStubs.length} total stubs shown.</div>
      </div>

      <PayStubModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        otm={editing}
        month={month}
        onSaved={() => { setModalOpen(false); load(); loadAllStubs(); }}
      />
    </div>
  );
}

function PayStubModal({ open, onClose, otm, month, onSaved }) {
  const [bonus, setBonus] = useState(0);
  const [deductions, setDeductions] = useState(0);
  const [notes, setNotes] = useState('');
  const [rate, setRate] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open || !otm) return;
    if (otm.existing) {
      setBonus(otm.existing.bonus || 0);
      setDeductions(otm.existing.deductions || 0);
      setNotes(otm.existing.admin_notes || '');
      setRate(otm.existing.hourly_rate || otm.hourly_rate || 0);
    } else {
      setBonus(0); setDeductions(0); setNotes(''); setRate(otm.hourly_rate || 0);
    }
  }, [open, otm]);

  if (!otm) return null;

  const base = rate * otm.hours;
  const net = base + (parseFloat(bonus) || 0) - (parseFloat(deductions) || 0);

  async function save() {
    setErr('');
    if (!rate) return setErr('Hourly rate required.');
    const { data: { user } } = await supabase.auth.getUser();
    setBusy(true);
    const payload = {
      user_id: otm.id, month: month + '-01',
      hours_worked: otm.hours, hourly_rate: parseFloat(rate),
      base_pay: base,
      bonus: parseFloat(bonus) || 0,
      deductions: parseFloat(deductions) || 0,
      net_pay: net, admin_notes: notes || null, generated_by: user.id,
      generated_at: new Date().toISOString()
    };
    const { error } = otm.existing
      ? await supabase.from('pay_stubs').update(payload).eq('id', otm.existing.id)
      : await supabase.from('pay_stubs').insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    await logAudit(otm.existing ? 'pay_stub.update' : 'pay_stub.create', 'pay_stub', null, { otm_id: otm.id, month });
    toast.show(`Pay stub ${otm.existing ? 'updated' : 'generated'} for ${otm.name}.`);
    onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Pay stub — ${otm.name}`} subtitle={formatMonthKey(month + '-01')}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-sm ink" onClick={save} disabled={busy}>{busy ? 'SAVING…' : 'SAVE STUB'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Hours worked</label><input className="input" value={otm.hours.toFixed(2)} disabled /></div>
        <div><label className="field-label">Hourly rate</label><input type="number" step="0.01" className="input" value={rate} onChange={e => setRate(e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Base pay</label><input className="input" value={formatMoney(base)} disabled /></div>
        <div><label className="field-label">Net pay</label><input className="input" value={formatMoney(net)} disabled /></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><label className="field-label">Bonus ($)</label><input type="number" step="0.01" className="input" value={bonus} onChange={e => setBonus(e.target.value)} /></div>
        <div><label className="field-label">Deductions ($)</label><input type="number" step="0.01" className="input" value={deductions} onChange={e => setDeductions(e.target.value)} /></div>
      </div>
      <div>
        <label className="field-label">Admin notes (visible to OTM on their stub)</label>
        <textarea className="input" rows="3" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="text-xs text-muted mt-3">Clients never see pay stub data. OTMs only see their own.</div>
      {err && <div className="text-sm text-crimson mt-3">{err}</div>}
    </Modal>
  );
}

function downloadStub(stub) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pay Stub - ${stub.users?.name || 'OTM'} - ${new Date(stub.month).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</title>
<style>
@page { margin: 0.5in; }
body{font-family:'DM Sans',Arial,sans-serif;background:#fff6ea;padding:40px;color:#232323;margin:0;}
.stub{max-width:640px;margin:0 auto;background:#fffdf8;border:1px solid #e6dcc6;padding:40px;}
.head{border-bottom:3px solid #232323;padding-bottom:16px;margin-bottom:24px;}
.brand{font-family:'Bebas Neue',Impact,sans-serif;font-size:24px;letter-spacing:0.14em;color:#232323;}
.sub{font-style:italic;color:#4d4e4f;font-size:14px;margin-top:4px;}
h1{font-family:Georgia,serif;font-size:28px;margin:0 0 4px 0;}
.kicker{font-family:'Bebas Neue',Impact;letter-spacing:0.2em;color:#a80404;font-size:11px;}
.row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0e6d2;}
.total{font-weight:bold;font-size:18px;padding-top:16px;border-top:2px solid #232323;}
.notes{background:#f5ead5;border-left:3px solid #a80404;padding:12px;margin-top:20px;font-size:13px;}
.foot{margin-top:32px;padding-top:16px;border-top:1px solid #e6dcc6;font-size:11px;color:#8a8070;}
@media print {
  body { background: white; padding: 0; }
  .stub { border: 0; }
}
</style></head><body><div class="stub">
<div class="head"><div class="brand">808 TALENT SOURCE</div><div class="sub">OTM Pay Stub</div></div>
<div class="kicker">${new Date(stub.month).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</div>
<h1>${stub.users?.name || 'OTM'}</h1>
<div style="margin:24px 0;">
<div class="row"><span>Hours worked</span><span>${parseFloat(stub.hours_worked).toFixed(2)} hrs</span></div>
<div class="row"><span>Hourly rate</span><span>$${parseFloat(stub.hourly_rate).toFixed(2)}</span></div>
<div class="row"><span>Base pay</span><span>$${parseFloat(stub.base_pay).toFixed(2)}</span></div>
<div class="row"><span>Bonus</span><span>$${parseFloat(stub.bonus || 0).toFixed(2)}</span></div>
<div class="row"><span>Deductions</span><span>-$${parseFloat(stub.deductions || 0).toFixed(2)}</span></div>
<div class="row total"><span>NET PAY</span><span>$${parseFloat(stub.net_pay).toFixed(2)}</span></div>
</div>
${stub.admin_notes ? `<div class="notes"><strong>Notes from admin:</strong><br>${stub.admin_notes}</div>` : ''}
<div class="foot">
© 2026 ${BRAND.companyName}. A brand of ${BRAND.parentCompany}. Confidential.<br>
${BRAND.addressLine1} • ${BRAND.addressLine2} • ${BRAND.phone}<br>
Generated ${stub.generated_at ? new Date(stub.generated_at).toLocaleString() : 'unknown'}
</div></div>
<script>setTimeout(()=>window.print(),300);</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    alert('Popup blocked. Please allow popups for this site to download stubs.');
    return;
  }
  w.document.write(html);
  w.document.close();
}
