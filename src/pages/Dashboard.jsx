import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import PageHeader, { StatCard, SectionTitle, Empty } from '../components/PageHeader';
import RetainerCard from '../components/RetainerCard';
import { useBusinesses } from '../components/BusinessSelector';
import { businessDot } from '../lib/businessColor';
import { formatDuration, formatDate, startOfWeek, startOfMonth, sameDay } from '../lib/format';

export default function Dashboard({ role, profile }) {
  const { businesses, selected, selectedId } = useBusinesses();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const som = startOfMonth(now).toISOString();
      const sow = startOfWeek(now).toISOString();

      let eq = supabase.from('time_entries').select('*, businesses(name), users(name)');
      if (role === 'va' || role === 'otm') { if (profile) eq = eq.eq('user_id', profile.id); }
      if (selectedId !== 'all') eq = eq.eq('business_id', selectedId);

      const { data: entries } = await eq.order('date', { ascending: false }).limit(500);
      const all = entries || [];

      const monthSec = all.filter(e => new Date(e.date) >= new Date(som)).reduce((s, e) => s + e.duration, 0);
      const weekSec = all.filter(e => new Date(e.date) >= new Date(sow)).reduce((s, e) => s + e.duration, 0);
      const todaySec = all.filter(e => sameDay(new Date(e.date), now)).reduce((s, e) => s + e.duration, 0);

      if (role === 'admin' || role === 'sub_admin') {
        const [{ count: activeClients }, { count: activeOTMs }] = await Promise.all([
          supabase.from('clients').select('id', { count: 'exact', head: true }).eq('active', true),
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'va').eq('active', true)
        ]);
        setStats({
          primary: { kicker: 'Month', value: formatDuration(monthSec), sub: 'Total logged' },
          cards: [
            { kicker: 'Week', value: formatDuration(weekSec), sub: 'This week' },
            { kicker: 'Active Clients', value: activeClients || 0, sub: 'On retainer' },
            { kicker: 'Active OTMs', value: activeOTMs || 0, sub: 'On the team' }
          ]
        });
      } else if (role === 'va' || role === 'otm') {
        let openTasksQ = supabase.from('tasks').select('id', { count: 'exact', head: true })
          .eq('assignee_id', profile.id).in('status', ['todo', 'in_progress', 'revision_requested']);
        if (selectedId !== 'all') openTasksQ = openTasksQ.eq('business_id', selectedId);
        const { count: openTasks } = await openTasksQ;
        setStats({
          primary: { kicker: 'Today', value: formatDuration(todaySec), sub: 'Hours logged' },
          cards: [
            { kicker: 'Week', value: formatDuration(weekSec), sub: 'Weekly total' },
            { kicker: 'Month', value: formatDuration(monthSec), sub: 'Monthly total' },
            { kicker: 'Open Tasks', value: openTasks || 0, sub: 'Assigned to you' }
          ]
        });
      } else {
        setStats({
          primary: { kicker: 'Month', value: formatDuration(monthSec), sub: 'Retainer hours used' },
          cards: [
            { kicker: 'Week', value: formatDuration(weekSec), sub: 'This week' },
            { kicker: 'Businesses', value: businesses.length, sub: 'Under retainer' }
          ]
        });
      }

      setRecent(all.slice(0, 10));
    }
    load();
  }, [role, profile, selectedId, businesses.length]);

  const subtitle =
    role === 'admin' || role === 'sub_admin'
      ? "Your portfolio at a glance."
      : role === 'va' || role === 'otm'
      ? (selected ? `Your work on ${selected.name}.` : 'Your time, tasks, and recent work across all businesses.')
      : (selected ? `Overview for ${selected.name}.` : 'Your retainer status and recent work across all businesses.');

  const showRetainers = (role === 'admin' || role === 'sub_admin' || role === 'client') && businesses.length > 0;

  return (
    <div>
      <PageHeader kicker="Overview" title="Dashboard" subtitle={subtitle} />

      {stats && (
        <div className={`grid gap-5 mb-8 ${stats.cards.length === 3 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
          <StatCard kicker={stats.primary.kicker} value={stats.primary.value} sub={stats.primary.sub} accent />
          {stats.cards.map((c, i) => (
            <StatCard key={i} kicker={c.kicker} value={c.value} sub={c.sub} />
          ))}
        </div>
      )}

      {showRetainers && selectedId === 'all' && (
        <div className="panel mb-8">
          <SectionTitle kicker="This month">Retainer status — all businesses</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-4">
            {businesses.map(b => <RetainerCard key={b.id} business={b} />)}
          </div>
        </div>
      )}

      {showRetainers && selected && (
        <div className="panel mb-8">
          <SectionTitle kicker="This month">Retainer status — {selected.name}</SectionTitle>
          <div className="mt-4">
            <RetainerCard business={selected} />
          </div>
        </div>
      )}

      <div className="panel">
        <SectionTitle kicker="Last 10 logged">Recent time entries</SectionTitle>
        {recent.length === 0 ? (
          <Empty>No time logged yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                {role !== 'va' && role !== 'otm' && <th>OTM</th>}
                {role !== 'client' && <th>Business</th>}
                <th>Date</th>
                <th>Description</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(e => (
                <tr key={e.id}>
                  {role !== 'va' && role !== 'otm' && <td>{e.users?.name || '—'}</td>}
                  {role !== 'client' && (
                    <td><span className="inline-flex items-center gap-2"><span style={businessDot(e.business_id)} />{e.businesses?.name || '—'}</span></td>
                  )}
                  <td>{formatDate(e.date)}</td>
                  <td className="text-slate808">
                    {e.description}
                    {e.type === 'manual' && <span className="badge manual ml-2">MANUAL</span>}
                  </td>
                  <td><strong>{formatDuration(e.duration)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
