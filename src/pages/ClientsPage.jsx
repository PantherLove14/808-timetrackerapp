import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import PageHeader, { Empty } from '../components/PageHeader';
import RetainerCard from '../components/RetainerCard';

export default function ClientsPage({ role, profile }) {
  const [businesses, setBusinesses] = useState([]);

  useEffect(() => {
    async function load() {
      let q = supabase.from('businesses').select('*').eq('active', true).order('name');
      if (role === 'client' && profile) q = q.eq('client_id', profile.id);
      else if (role === 'va' && profile) {
        const { data: a } = await supabase.from('va_assignments').select('business_id').eq('va_id', profile.id);
        const ids = (a || []).map(x => x.business_id);
        if (!ids.length) { setBusinesses([]); return; }
        q = q.in('id', ids);
      }
      const { data } = await q;
      setBusinesses(data || []);
    }
    load();
  }, [role, profile]);

  return (
    <div>
      <PageHeader
        kicker="Work"
        title={role === 'client' ? 'My Retainer' : 'Clients'}
        subtitle={role === 'client' ? 'Your businesses and their retainer status.' : 'Every retainer and their current status.'}
      />
      {businesses.length === 0 ? (
        <Empty>No businesses to show.</Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {businesses.map(b => <RetainerCard key={b.id} business={b} />)}
        </div>
      )}
    </div>
  );
}
