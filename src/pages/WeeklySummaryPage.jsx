import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import PageHeader, { SectionTitle } from '../components/PageHeader';
import { formatDate, formatDuration, startOfMonth, startOfWeek, daysLeftInMonth } from '../lib/format';

export default function WeeklySummaryPage() {
  const [businesses, setBusinesses] = useState([]);
  const [bizId, setBizId] = useState('');
  const [range, setRange] = useState('0');
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    supabase.from('businesses').select('id, name, tier, monthly_hours, clients(name, email)').eq('active', true).order('name').then(({ data }) => {
      setBusinesses(data || []);
      if (data?.length) setBizId(data[0].id);
    });
  }, []);

  async function generate() {
    const biz = businesses.find(b => b.id === bizId);
    if (!biz) return;

    const now = new Date();
    let start, end, rangeLabel;
    if (range === 'month') {
      start = startOfMonth(now);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      rangeLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    } else {
      const offset = parseInt(range) || 0;
      start = startOfWeek(now);
      start.setDate(start.getDate() - offset * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59);
      rangeLabel = `Week of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    const { data: entries } = await supabase.from('time_entries')
      .select('*, users(name)')
      .eq('business_id', biz.id)
      .gte('date', start.toISOString())
      .lte('date', end.toISOString())
      .order('date', { ascending: true });

    const totalSec = (entries || []).reduce((s, e) => s + e.duration, 0);
    const totalHrs = totalSec / 3600;

    const som = startOfMonth(now).toISOString();
    const { data: monthEntries } = await supabase.from('time_entries').select('duration').eq('business_id', biz.id).gte('date', som);
    const monthHrs = (monthEntries || []).reduce((s, e) => s + e.duration, 0) / 3600;
    const remaining = Math.max(0, biz.monthly_hours - monthHrs);

    const { data: tasks } = await supabase.from('tasks').select('*').eq('business_id', biz.id);
    const approvedThisPeriod = (tasks || []).filter(t =>
      t.status === 'approved' && t.approved_at && new Date(t.approved_at) >= start && new Date(t.approved_at) <= end
    );
    const activeTasks = (tasks || []).filter(t => t.status !== 'approved');

    const html = buildEmail({
      client: biz.clients, businessName: biz.name, tier: biz.tier, monthlyHours: biz.monthly_hours,
      rangeLabel, entries: entries || [], totalHrs, monthHrs, remaining,
      daysLeft: daysLeftInMonth(), approvedThisPeriod, activeTasks
    });

    const text = buildText({
      client: biz.clients, businessName: biz.name, rangeLabel,
      entries: entries || [], totalHrs, monthHrs, remaining, monthlyHours: biz.monthly_hours,
      daysLeft: daysLeftInMonth(), approvedThisPeriod, activeTasks
    });

    setSummary({
      html, text,
      subject: `808 Weekly Summary — ${biz.name} — ${rangeLabel}`,
      to: biz.clients?.email
    });
  }

  async function copyHTML() {
    if (!summary) return;
    try {
      const htmlBlob = new Blob([summary.html], { type: 'text/html' });
      const textBlob = new Blob([summary.text], { type: 'text/plain' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })]);
      alert('Rich HTML copied. Paste into Gmail compose.');
    } catch {
      await navigator.clipboard.writeText(summary.html);
      alert('HTML source copied.');
    }
  }

  async function copyText() {
    if (!summary) return;
    await navigator.clipboard.writeText(summary.text);
    alert('Plain text copied.');
  }

  function openInGmail() {
    if (!summary?.to) return alert('No client email on file.');
    const mailto = `mailto:${summary.to}?subject=${encodeURIComponent(summary.subject)}&body=${encodeURIComponent(summary.text)}`;
    window.location.href = mailto;
  }

  return (
    <div>
      <PageHeader
        kicker="Client Communication"
        title="Weekly Summary"
        subtitle="Generate retainer status emails to send to your clients."
      />

      <div className="panel">
        <div className="flex gap-2 flex-wrap items-center mb-4">
          <span className="font-bebas text-[11px] tracking-widest text-muted">GENERATE FOR</span>
          <select value={bizId} onChange={e => setBizId(e.target.value)}>
            {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={range} onChange={e => setRange(e.target.value)}>
            <option value="0">This week</option>
            <option value="1">Last week</option>
            <option value="month">This month</option>
          </select>
          <button className="btn-sm ink" onClick={generate}>GENERATE</button>
          {summary && (
            <>
              <button className="btn-sm" onClick={copyHTML}>⧉ COPY HTML</button>
              <button className="btn-sm" onClick={copyText}>⧉ COPY TEXT</button>
              <button className="btn-sm" onClick={openInGmail}>✉ OPEN IN GMAIL</button>
            </>
          )}
        </div>

        {summary && (
          <>
            <div className="bg-cream-deep border border-line px-4 py-3 text-xs font-bebas tracking-widest text-slate808 mb-3">
              SUBJECT: {summary.subject}
            </div>
            <div dangerouslySetInnerHTML={{ __html: summary.html }} />
          </>
        )}
      </div>
    </div>
  );
}

function buildEmail({ client, businessName, tier, monthlyHours, rangeLabel, entries, totalHrs, monthHrs, remaining, daysLeft, approvedThisPeriod, activeTasks }) {
  const pct = (monthHrs / monthlyHours) * 100;
  const statusColor = pct > 100 ? '#a80404' : pct >= 85 ? '#b8860b' : '#2d6a4f';
  const statusLabel = pct > 100 ? 'OVER RETAINER' : pct >= 85 ? 'NEAR CAP' : 'ON TRACK';
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const entriesHTML = entries.length
    ? entries.map(e => `<tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e6dcc6;font-size:13px;color:#4d4e4f;width:110px;">${formatDate(e.date)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e6dcc6;font-size:13px;color:#232323;">${esc(e.description)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e6dcc6;font-size:13px;color:#232323;text-align:right;font-weight:500;width:80px;">${formatDuration(e.duration)}</td>
      </tr>`).join('')
    : `<tr><td colspan="3" style="padding:20px;text-align:center;color:#8a8070;font-style:italic;">No entries logged for this period.</td></tr>`;

  const doneHTML = approvedThisPeriod.length
    ? approvedThisPeriod.slice(0, 8).map(t => `<li style="padding:6px 0;color:#232323;font-size:14px;">✓ ${esc(t.title)}</li>`).join('')
    : `<li style="color:#8a8070;font-style:italic;">No tasks approved this period.</li>`;

  const activeHTML = activeTasks.length
    ? activeTasks.slice(0, 6).map(t => `<li style="padding:6px 0;color:#4d4e4f;font-size:14px;">• ${esc(t.title)}</li>`).join('')
    : `<li style="color:#8a8070;font-style:italic;">No active tasks.</li>`;

  return `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:640px;margin:0 auto;background:#fff6ea;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff6ea;padding:40px 20px;">
<tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#fffdf8;border:1px solid #e6dcc6;">
<tr><td style="background:#232323;padding:32px 36px;">
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:#fff6ea;font-size:24px;letter-spacing:0.14em;">808 TALENT SOURCE</div>
<div style="color:#c8c1b3;font-size:13px;font-style:italic;margin-top:4px;">Weekly Retainer Summary</div>
</td></tr>
<tr><td style="padding:32px 36px 8px 36px;">
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:#a80404;font-size:11px;letter-spacing:0.2em;margin-bottom:6px;">${esc(rangeLabel.toUpperCase())}</div>
<h1 style="font-family:Georgia,serif;font-size:28px;color:#232323;margin:0 0 16px 0;font-weight:700;">Hello, ${esc(client?.name || 'there')}</h1>
<p style="color:#4d4e4f;font-size:15px;line-height:1.6;margin:0;">Here's your ${esc(businessName)} update for this period. Retainer status, completed work, and what's in motion.</p>
</td></tr>
<tr><td style="padding:24px 36px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5ead5;border-left:4px solid ${statusColor};padding:20px 24px;">
<tr><td>
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:${statusColor};font-size:11px;letter-spacing:0.2em;margin-bottom:8px;">${statusLabel} — ${esc(tier)} TIER</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
<td style="padding-right:20px;vertical-align:top;">
<div style="font-family:Georgia,serif;color:#232323;font-size:32px;font-weight:700;line-height:1;">${monthHrs.toFixed(1)}h</div>
<div style="color:#4d4e4f;font-size:12px;margin-top:4px;">of ${monthlyHours}h this month</div>
</td>
<td style="padding-left:20px;border-left:1px solid #e6dcc6;vertical-align:top;">
<div style="font-family:Georgia,serif;color:#232323;font-size:32px;font-weight:700;line-height:1;">${remaining.toFixed(1)}h</div>
<div style="color:#4d4e4f;font-size:12px;margin-top:4px;">remaining, ${daysLeft} days left</div>
</td>
</tr></table>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 36px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e6dcc6;">
<tr><td style="padding:20px 24px;text-align:center;">
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:#a80404;font-size:11px;letter-spacing:0.2em;margin-bottom:6px;">THIS PERIOD</div>
<div style="font-family:Georgia,serif;color:#232323;font-size:36px;font-weight:700;line-height:1;">${totalHrs.toFixed(1)} hours</div>
<div style="color:#8a8070;font-size:13px;margin-top:6px;">${entries.length} entries logged</div>
</td></tr></table></td></tr>
<tr><td style="padding:28px 36px 8px 36px;">
<h2 style="font-family:Georgia,serif;font-size:20px;color:#232323;margin:0 0 4px 0;">Wins & deliverables</h2>
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:#a80404;font-size:10px;letter-spacing:0.22em;margin-bottom:12px;">APPROVED</div>
<ul style="padding-left:20px;margin:0;">${doneHTML}</ul>
</td></tr>
<tr><td style="padding:20px 36px 8px 36px;">
<h2 style="font-family:Georgia,serif;font-size:20px;color:#232323;margin:0 0 4px 0;">In motion</h2>
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:#a80404;font-size:10px;letter-spacing:0.22em;margin-bottom:12px;">ACTIVE</div>
<ul style="padding-left:20px;margin:0;">${activeHTML}</ul>
</td></tr>
<tr><td style="padding:28px 36px 8px 36px;">
<h2 style="font-family:Georgia,serif;font-size:20px;color:#232323;margin:0 0 4px 0;">Time detail</h2>
<div style="font-family:'Bebas Neue',Arial,sans-serif;color:#a80404;font-size:10px;letter-spacing:0.22em;margin-bottom:12px;">FULL LOG</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e6dcc6;border-collapse:collapse;">
<thead><tr style="background:#f5ead5;">
<th style="padding:10px 14px;text-align:left;font-family:'Bebas Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.18em;color:#a80404;border-bottom:1px solid #e6dcc6;font-weight:400;">DATE</th>
<th style="padding:10px 14px;text-align:left;font-family:'Bebas Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.18em;color:#a80404;border-bottom:1px solid #e6dcc6;font-weight:400;">WORK</th>
<th style="padding:10px 14px;text-align:right;font-family:'Bebas Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.18em;color:#a80404;border-bottom:1px solid #e6dcc6;font-weight:400;">HOURS</th>
</tr></thead><tbody>${entriesHTML}</tbody></table>
</td></tr>
<tr><td style="padding:28px 36px 40px 36px;">
<p style="color:#4d4e4f;font-size:14px;line-height:1.7;margin:0;">Questions or priorities to add? Reply to this email and let's talk.</p>
<div style="margin-top:24px;padding-top:20px;border-top:1px solid #e6dcc6;">
<div style="font-family:Georgia,serif;font-style:italic;color:#232323;font-size:16px;">With gratitude,</div>
<div style="color:#4d4e4f;font-size:14px;margin-top:4px;">The 808 Talent Source Team</div>
</div>
</td></tr>
<tr><td style="background:#232323;padding:20px 36px;text-align:center;">
<div style="color:#c8c1b3;font-size:11px;letter-spacing:0.1em;">808 TALENT SOURCE™ • A brand of Impctrs Management Group • © 2026</div>
</td></tr>
</table></td></tr></table></div>`;
}

function buildText({ client, businessName, rangeLabel, entries, totalHrs, monthHrs, remaining, monthlyHours, daysLeft, approvedThisPeriod, activeTasks }) {
  let out = `808 TALENT SOURCE — Weekly Retainer Summary\n${businessName} • ${rangeLabel}\n\n`;
  out += `Hello, ${client?.name || 'there'}\n\n`;
  out += `RETAINER STATUS\n${monthHrs.toFixed(1)}h used of ${monthlyHours}h this month | ${remaining.toFixed(1)}h remaining | ${daysLeft} days left\n\n`;
  out += `THIS PERIOD: ${totalHrs.toFixed(1)} hours (${entries.length} entries)\n\n`;
  out += `WINS & DELIVERABLES:\n`;
  out += approvedThisPeriod.length ? approvedThisPeriod.slice(0, 8).map(t => `  ✓ ${t.title}`).join('\n') : '  (none this period)';
  out += `\n\nIN MOTION:\n`;
  out += activeTasks.length ? activeTasks.slice(0, 6).map(t => `  • ${t.title}`).join('\n') : '  (none)';
  out += `\n\nTIME DETAIL:\n`;
  out += entries.length ? entries.map(e => `  ${formatDate(e.date)} | ${e.description} | ${formatDuration(e.duration)}`).join('\n') : '  (no entries)';
  out += `\n\nQuestions? Reply to this email.\n\nWith gratitude,\nThe 808 Talent Source Team`;
  return out;
}
