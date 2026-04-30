import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import PageHeader, { SectionTitle, Empty } from '../components/PageHeader';
import { useToast } from '../components/BusinessSelector';
import { BRAND } from '../lib/constants';
import { formatDate, formatDuration, startOfWeek } from '../lib/format';

export default function WeeklySummaryPage() {
  const [businesses, setBusinesses] = useState([]);
  const [businessId, setBusinessId] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [summary, setSummary] = useState(null);
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // Default to start of current week
    const sow = startOfWeek(new Date());
    setWeekStart(sow.toISOString().slice(0, 10));
    // Load businesses
    supabase.from('businesses').select('id, name, monthly_hours, clients(name, email)').eq('active', true).order('name').then(({ data }) => {
      setBusinesses(data || []);
    });
  }, []);

  async function generate() {
    if (!businessId) { toast.show('Pick a business first.', 'warn'); return; }
    if (!weekStart) { toast.show('Pick a week.', 'warn'); return; }

    setGenerating(true);
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);

    const business = businesses.find(b => b.id === businessId);

    // Get all entries for this business in the week
    const { data: entries } = await supabase.from('time_entries')
      .select('*, users(name), tasks(title)')
      .eq('business_id', businessId)
      .gte('date', start.toISOString())
      .lt('date', end.toISOString())
      .order('date');

    // Get tasks updated in the week
    const { data: tasks } = await supabase.from('tasks')
      .select('id, title, status, submitted_at, approved_at, created_at, users!tasks_assignee_id_fkey(name)')
      .eq('business_id', businessId)
      .or(`submitted_at.gte.${start.toISOString()},approved_at.gte.${start.toISOString()},created_at.gte.${start.toISOString()}`);

    // Aggregate by OTM
    const byOTM = {};
    (entries || []).forEach(e => {
      const name = e.users?.name || 'Unknown';
      if (!byOTM[name]) byOTM[name] = { name, hours: 0, items: [] };
      byOTM[name].hours += e.duration / 3600;
      byOTM[name].items.push({
        date: e.date,
        description: e.description,
        duration: e.duration,
        task: e.tasks?.title
      });
    });

    const totalHours = (entries || []).reduce((s, e) => s + e.duration, 0) / 3600;
    const tasksCompleted = (tasks || []).filter(t => t.status === 'approved' && t.approved_at && new Date(t.approved_at) >= start && new Date(t.approved_at) < end);
    const tasksSubmitted = (tasks || []).filter(t => t.submitted_at && new Date(t.submitted_at) >= start && new Date(t.submitted_at) < end);
    const tasksCreated = (tasks || []).filter(t => new Date(t.created_at) >= start && new Date(t.created_at) < end);

    setSummary({
      business,
      weekStart: start,
      weekEnd: new Date(end.getTime() - 1),
      byOTM: Object.values(byOTM),
      totalHours,
      tasksCompleted,
      tasksSubmitted,
      tasksCreated,
      retainerUsed: totalHours,
      retainerCap: business?.monthly_hours || 0
    });

    setGenerating(false);
    toast.show(`Summary generated for ${business?.name}.`);
  }

  function copyToClipboard() {
    if (!summary) return;
    const text = generateTextSummary(summary);
    navigator.clipboard.writeText(text);
    toast.show('Summary copied to clipboard.');
  }

  function copyHtmlForEmail() {
    if (!summary) return;
    const html = generateHtmlSummary(summary);
    // Use clipboard API with HTML format if supported
    if (navigator.clipboard && window.ClipboardItem) {
      const blob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([generateTextSummary(summary)], { type: 'text/plain' });
      navigator.clipboard.write([
        new ClipboardItem({ 'text/html': blob, 'text/plain': textBlob })
      ]).then(() => toast.show('HTML email copied. Paste into Gmail/Outlook.'))
        .catch(() => { copyToClipboard(); });
    } else {
      copyToClipboard();
    }
  }

  function printSummary() {
    if (!summary) return;
    const html = generatePrintableHtml(summary);
    const w = window.open('', '_blank');
    if (!w) { toast.show('Popup blocked. Allow popups for this site.', 'error'); return; }
    w.document.write(html);
    w.document.close();
  }

  return (
    <div>
      <PageHeader kicker="Communicate" title="Weekly Summary" subtitle="Generate a polished weekly recap to send to a client." />

      <div className="panel mb-6">
        <SectionTitle kicker="Setup">Generate for</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="field-label">Business</label>
            <select value={businessId} onChange={e => setBusinessId(e.target.value)}>
              <option value="">Select a business…</option>
              {businesses.length === 0 && <option disabled>No businesses available — add a client first</option>}
              {businesses.map(b => (
                <option key={b.id} value={b.id}>{b.name}{b.clients?.name ? ` (${b.clients.name})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label">Week starting (Monday)</label>
            <input type="date" className="input" value={weekStart} onChange={e => setWeekStart(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-ink w-full" onClick={generate} disabled={generating || !businessId}>
              {generating ? 'GENERATING…' : 'GENERATE SUMMARY'}
            </button>
          </div>
        </div>
        <div className="text-xs text-muted">
          The summary covers all logged time, tasks created, submitted, and approved during the selected week — for the chosen business only.
        </div>
      </div>

      {summary && (
        <div className="panel">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <SectionTitle kicker="Preview">Summary</SectionTitle>
            <div className="flex gap-2">
              <button className="btn-sm" onClick={copyToClipboard}>COPY TEXT</button>
              <button className="btn-sm" onClick={copyHtmlForEmail}>COPY FOR EMAIL</button>
              <button className="btn-sm ink" onClick={printSummary}>PRINT / PDF</button>
            </div>
          </div>

          <SummaryPreview summary={summary} />
        </div>
      )}
    </div>
  );
}

function SummaryPreview({ summary }) {
  return (
    <div className="bg-cream-deep border border-line p-6 rounded">
      <div className="font-bebas tracking-widest text-[11px] text-crimson mb-1">WEEKLY SUMMARY</div>
      <h3 className="font-display text-2xl font-semibold mb-1">{summary.business?.name}</h3>
      <div className="text-sm text-slate808 mb-5">
        {formatDate(summary.weekStart.toISOString())} — {formatDate(summary.weekEnd.toISOString())}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-paper border border-line p-3 rounded">
          <div className="font-bebas tracking-widest text-[10px] text-muted">HOURS LOGGED</div>
          <div className="font-display text-2xl font-semibold mt-1">{formatDuration(summary.totalHours * 3600)}</div>
          {summary.retainerCap > 0 && (
            <div className="text-xs text-muted mt-1">{((summary.retainerUsed / summary.retainerCap) * 100).toFixed(0)}% of {summary.retainerCap}h monthly</div>
          )}
        </div>
        <div className="bg-paper border border-line p-3 rounded">
          <div className="font-bebas tracking-widest text-[10px] text-muted">TASKS COMPLETED</div>
          <div className="font-display text-2xl font-semibold mt-1">{summary.tasksCompleted.length}</div>
          <div className="text-xs text-muted mt-1">{summary.tasksSubmitted.length} submitted, {summary.tasksCreated.length} created</div>
        </div>
        <div className="bg-paper border border-line p-3 rounded">
          <div className="font-bebas tracking-widest text-[10px] text-muted">TEAM MEMBERS</div>
          <div className="font-display text-2xl font-semibold mt-1">{summary.byOTM.length}</div>
          <div className="text-xs text-muted mt-1">working this week</div>
        </div>
      </div>

      {summary.tasksCompleted.length > 0 && (
        <div className="mb-4">
          <div className="font-bebas tracking-widest text-xs text-crimson mb-2">COMPLETED THIS WEEK</div>
          <ul className="text-sm space-y-1">
            {summary.tasksCompleted.map(t => (
              <li key={t.id} className="flex items-start gap-2">
                <span className="text-ok">✓</span>
                <span>{t.title} <span className="text-muted">— {t.users?.name}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.tasksSubmitted.length > 0 && (
        <div className="mb-4">
          <div className="font-bebas tracking-widest text-xs text-crimson mb-2">SUBMITTED FOR YOUR REVIEW</div>
          <ul className="text-sm space-y-1">
            {summary.tasksSubmitted.map(t => (
              <li key={t.id} className="flex items-start gap-2">
                <span className="text-warn">⏵</span>
                <span>{t.title} <span className="text-muted">— {t.users?.name}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.byOTM.length > 0 && (
        <div>
          <div className="font-bebas tracking-widest text-xs text-crimson mb-2">TIME BY TEAM MEMBER</div>
          <table>
            <thead><tr><th>OTM</th><th>Hours</th><th>Highlights</th></tr></thead>
            <tbody>
              {summary.byOTM.map((o, i) => (
                <tr key={i}>
                  <td><strong>{o.name}</strong></td>
                  <td>{formatDuration(o.hours * 3600)}</td>
                  <td className="text-xs text-slate808">{o.items.slice(0, 3).map(it => it.description).join('; ')}{o.items.length > 3 ? `… +${o.items.length - 3} more` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function generateTextSummary(s) {
  const lines = [];
  lines.push(`WEEKLY SUMMARY — ${s.business?.name}`);
  lines.push(`${formatDate(s.weekStart.toISOString())} to ${formatDate(s.weekEnd.toISOString())}`);
  lines.push('');
  lines.push(`Hours logged: ${formatDuration(s.totalHours * 3600)}`);
  if (s.retainerCap > 0) {
    lines.push(`Retainer usage: ${((s.retainerUsed / s.retainerCap) * 100).toFixed(0)}% of ${s.retainerCap}h monthly`);
  }
  lines.push('');
  if (s.tasksCompleted.length) {
    lines.push('COMPLETED:');
    s.tasksCompleted.forEach(t => lines.push(`  ✓ ${t.title} (${t.users?.name})`));
    lines.push('');
  }
  if (s.tasksSubmitted.length) {
    lines.push('SUBMITTED FOR REVIEW:');
    s.tasksSubmitted.forEach(t => lines.push(`  → ${t.title} (${t.users?.name})`));
    lines.push('');
  }
  if (s.byOTM.length) {
    lines.push('TIME BY TEAM MEMBER:');
    s.byOTM.forEach(o => lines.push(`  ${o.name}: ${formatDuration(o.hours * 3600)}`));
    lines.push('');
  }
  lines.push(`— Sent from 808 Talent Source • ${BRAND.email}`);
  return lines.join('\n');
}

function generateHtmlSummary(s) {
  return `<div style="font-family:'DM Sans',Arial,sans-serif;color:#232323;">
<h2 style="margin:0 0 4px 0;font-family:Georgia,serif;">${s.business?.name}</h2>
<div style="color:#4d4e4f;font-size:13px;margin-bottom:16px;">Weekly Summary • ${formatDate(s.weekStart.toISOString())} to ${formatDate(s.weekEnd.toISOString())}</div>
<table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
<tr><td style="padding:8px;border:1px solid #e6dcc6;background:#fff6ea;"><strong>${formatDuration(s.totalHours * 3600)}</strong> logged${s.retainerCap > 0 ? ` • ${((s.retainerUsed / s.retainerCap) * 100).toFixed(0)}% of ${s.retainerCap}h` : ''}</td></tr>
</table>
${s.tasksCompleted.length ? `<h3 style="font-family:Georgia,serif;font-size:14px;margin:16px 0 8px;">Completed</h3><ul>${s.tasksCompleted.map(t => `<li>${t.title} <span style="color:#8a8070;">— ${t.users?.name || ''}</span></li>`).join('')}</ul>` : ''}
${s.tasksSubmitted.length ? `<h3 style="font-family:Georgia,serif;font-size:14px;margin:16px 0 8px;">Submitted for review</h3><ul>${s.tasksSubmitted.map(t => `<li>${t.title} <span style="color:#8a8070;">— ${t.users?.name || ''}</span></li>`).join('')}</ul>` : ''}
${s.byOTM.length ? `<h3 style="font-family:Georgia,serif;font-size:14px;margin:16px 0 8px;">Time by team member</h3><table style="border-collapse:collapse;"><tr><th style="text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #ccc;">OTM</th><th style="text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #ccc;">Hours</th></tr>${s.byOTM.map(o => `<tr><td style="padding:4px 12px 4px 0;">${o.name}</td><td style="padding:4px 12px 4px 0;">${formatDuration(o.hours * 3600)}</td></tr>`).join('')}</table>` : ''}
<p style="color:#8a8070;font-size:11px;margin-top:24px;border-top:1px solid #e6dcc6;padding-top:12px;">Sent from 808 Talent Source • <a href="mailto:${BRAND.email}">${BRAND.email}</a> • ${BRAND.phone}</p>
</div>`;
}

function generatePrintableHtml(s) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Weekly Summary - ${s.business?.name} - ${formatDate(s.weekStart.toISOString())}</title>
<style>
@page { margin: 0.5in; }
body { font-family: 'DM Sans', Arial, sans-serif; color: #232323; padding: 40px; max-width: 720px; margin: 0 auto; }
h1 { font-family: Georgia, serif; font-size: 28px; margin: 0 0 4px 0; }
h2 { font-family: 'Bebas Neue', Impact, sans-serif; letter-spacing: 0.15em; color: #a80404; font-size: 13px; margin: 24px 0 8px; }
.kicker { font-family: 'Bebas Neue', Impact; letter-spacing: 0.2em; color: #a80404; font-size: 11px; }
.subtitle { color: #4d4e4f; margin: 0 0 24px 0; font-size: 14px; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; }
.stat { padding: 12px; border: 1px solid #e6dcc6; background: #fff6ea; }
.stat .v { font-family: Georgia, serif; font-size: 22px; font-weight: bold; }
.stat .l { font-size: 10px; letter-spacing: 0.15em; color: #8a8070; text-transform: uppercase; }
ul { padding-left: 20px; }
li { margin: 4px 0; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid #e6dcc6; }
th { font-size: 10px; letter-spacing: 0.15em; color: #8a8070; text-transform: uppercase; }
.foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e6dcc6; font-size: 11px; color: #8a8070; }
@media print { body { padding: 0; } }
</style></head><body>
<div class="kicker">WEEKLY SUMMARY</div>
<h1>${s.business?.name}</h1>
<p class="subtitle">${formatDate(s.weekStart.toISOString())} — ${formatDate(s.weekEnd.toISOString())}</p>

<div class="stats">
  <div class="stat"><div class="l">Hours Logged</div><div class="v">${formatDuration(s.totalHours * 3600)}</div></div>
  <div class="stat"><div class="l">Tasks Completed</div><div class="v">${s.tasksCompleted.length}</div></div>
  <div class="stat"><div class="l">Team Members</div><div class="v">${s.byOTM.length}</div></div>
</div>

${s.tasksCompleted.length ? `<h2>Completed this week</h2><ul>${s.tasksCompleted.map(t => `<li><strong>${t.title}</strong> — ${t.users?.name || ''}</li>`).join('')}</ul>` : ''}
${s.tasksSubmitted.length ? `<h2>Submitted for your review</h2><ul>${s.tasksSubmitted.map(t => `<li><strong>${t.title}</strong> — ${t.users?.name || ''}</li>`).join('')}</ul>` : ''}
${s.byOTM.length ? `<h2>Time by team member</h2><table><thead><tr><th>OTM</th><th>Hours</th></tr></thead><tbody>${s.byOTM.map(o => `<tr><td>${o.name}</td><td>${formatDuration(o.hours * 3600)}</td></tr>`).join('')}</tbody></table>` : ''}

<div class="foot">
© 2026 ${BRAND.companyName}. A brand of ${BRAND.parentCompany}.<br>
${BRAND.addressLine1} • ${BRAND.addressLine2} • ${BRAND.phone} • ${BRAND.email}<br>
Generated ${new Date().toLocaleString()}
</div>
<script>setTimeout(()=>window.print(), 300);</script>
</body></html>`;
}
