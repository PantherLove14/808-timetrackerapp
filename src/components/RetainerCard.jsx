import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { daysLeftInMonth, formatHours, startOfMonth } from '../lib/format';

export default function RetainerCard({ business }) {
  const [usedHrs, setUsedHrs] = useState(0);
  const [rolloverIn, setRolloverIn] = useState(0);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const som = startOfMonth(now).toISOString();
      const { data: entries } = await supabase
        .from('time_entries')
        .select('duration')
        .eq('business_id', business.id)
        .gte('date', som);
      const total = (entries || []).reduce((s, e) => s + e.duration, 0) / 3600;
      setUsedHrs(total);

      // Previous month's rollover_out becomes this month's rollover_in
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const { data: ro } = await supabase
        .from('rollovers')
        .select('rollover_out')
        .eq('business_id', business.id)
        .eq('month', prevMonth)
        .maybeSingle();
      setRolloverIn(ro?.rollover_out || 0);
    }
    load();
  }, [business.id]);

  const available = business.monthly_hours + rolloverIn;
  const pct = (usedHrs / available) * 100;
  const state = pct > 100 ? 'over' : pct >= 85 ? 'warn' : 'ok';
  const remaining = Math.max(0, available - usedHrs);

  const borderColor = state === 'over' ? 'var(--crimson)' : state === 'warn' ? 'var(--warn)' : 'var(--line)';
  const fillColor = state === 'over'
    ? 'linear-gradient(90deg, var(--crimson), var(--crimson-dark))'
    : state === 'warn'
    ? 'linear-gradient(90deg, var(--warn), #d4a017)'
    : 'linear-gradient(90deg, var(--ink), var(--slate))';

  return (
    <div className="panel" style={{ borderColor }}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-display text-lg font-semibold leading-tight">{business.name}</div>
          <div className="font-bebas text-[11px] tracking-widest text-crimson mt-1">
            {business.tier} • {business.monthly_hours}h/mo
            {rolloverIn > 0 && ` • +${rolloverIn.toFixed(1)}h rollover`}
          </div>
        </div>
        <span className={`badge ${state === 'over' ? 'hold' : state === 'warn' ? 'pending' : 'active'}`}>
          {state === 'over' ? 'OVER' : state === 'warn' ? 'NEAR CAP' : 'ON TRACK'}
        </span>
      </div>
      <div className="h-2 bg-cream-deep rounded-full overflow-hidden">
        <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: fillColor, transition: 'width 0.5s' }} />
      </div>
      <div className="flex justify-between text-xs text-slate808 mt-2">
        <span><strong className="text-ink">{formatHours(usedHrs)}</strong> used of {formatHours(available)}</span>
        <span>{formatHours(remaining)} remaining • {daysLeftInMonth()}d left</span>
      </div>
    </div>
  );
}
