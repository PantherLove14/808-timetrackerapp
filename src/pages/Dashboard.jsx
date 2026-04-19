import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import PageHeader, { StatCard, SectionTitle, Empty } from '../components/PageHeader';
import RetainerCard from '../components/RetainerCard';
import { formatDuration, formatDate, startOfWeek, startOfMonth, sameDay } from '../lib/format';

export default function Dashboard({ role, profile }) {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [businesses, setBusinesses] = useState([]);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const som = startOfMonth(now).toISOString();
      const sow = startOfWeek(now).toISOString();

      // Load businesses relevant to this user
      let bq = supabase.from('businesses').select('*').eq('active', true).order('name');
      if (role === 'client' && profile) bq = bq.eq('client_id', profile.id);
      const { data: biz } = await bq;
      setBusinesses(biz || []);

      // Time entries
      let eq = supabase.from('time_entries').select('*, businesses(name), users(name)');
      if (role === 'va' && profile) eq = eq.eq('user_id', profile.id);
      const { data: entries } = await eq.order('date', { ascending: false }).limit(500);
      const all = entries || [];

      const monthSec = all.filter(e => new Date(e.date) >= new Date(som)).reduce((s, e) => s + e.duration, 0);
      const weekSec = all.filter(e => new Date(e.date) >= new Date(sow)).reduce((s, e) => s + e.duration, 0);
      const todaySec = all.filter(e => sameDay(new Date(e.date), now)).reduce((s, e) => s + e.duration, 0);

      // Role-specific stats
      if (role === 'admin' || role === 'sub_admin') {
        const [{ count: activeClients }, { count: activeVAs }] = await Promise.all([
          supabase.from('clients').select('id', { count: 'exact', head: true }).eq('active', true),
          supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'va').eq('active', true)
        ]);
        setStats({
          primary: { kicker: 'Month', value: formatDuration(monthSec), sub: 'Total logged' },
          cards: [
            { kicker: 'Week', value: formatDuration(weekSec), sub: 'This week' },
            { kicker: 'Active Clients', value: activeClients || 0, sub: 'On retainer' },
            { kicker: 'Active VAs', value: activeVAs || 0, sub: 'On the team' }
          ]
        });
      } else if (role === 'va') {
        const { count: openTasks } = await supabase.from('tasks').select('id', { count: 'exact', head: true })
          .eq('assignee_id', profile.id).in('status', ['todo', 'in_progress', 'revision_requested']);
        setStats({
          primary: { kicker: 'Today', value: formatDuration(todaySec), sub: 'Hours logged' },
          cards: [
            { kicker: 'Week', value: formatDuration(weekSec), sub: 'Weekly total' },
            { kicker: 'Month', value: formatDuration(monthSec), sub: 'Monthly total' },
            { kicker: 'Open Tasks', value: openTasks || 0, sub: 'Assigned to you' }
          ]
        });
      } else {
        // client
        setStats({
          primary: { kicker: 'Month', value: formatDuration(monthSec), sub: 'Retainer hours used' },
          cards: [
            { kicker: 'Week', value: formatDuration(weekSec), sub: 'This week' },
            { kicker: 'Businesses', value: (biz || []).length, sub: 'Under retainer' }
          ]
        });
      }

      setRecent(all.slice(0, 10));
    }
    load();
  }, [role, profile]);

  const subtitle =
    role === 'admin' || role === 'sub_admin'
      ? "Your portfolio at a glance."
      : role === 'va'
      ? 'Your time, tasks, and recent work.'
      : 'Your retainer status and recent work delivered.';

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

      {businesses.length > 0 && (role === 'admin' || role === 'sub_admin' || role === 'client') && (
        <div className="panel mb-8">
          <SectionTitle kicker="This month">Retainer status</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mt-4">
            {businesses.map(b => <RetainerCard key={b.id} business={b} />)}
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
                {role !== 'va' && <th>VA</th>}
                {role !== 'client' && <th>Business</th>}
                <th>Date</th>
                <th>Description</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(e => (
                <tr key={e.id}>
                  {role !== 'va' && <td>{e.users?.name || '—'}</td>}
                  {role !== 'client' && <td>{e.businesses?.name || '—'}</td>}
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
