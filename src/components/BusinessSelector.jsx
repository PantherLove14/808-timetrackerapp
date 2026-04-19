import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const BusinessContext = createContext(null);

export function BusinessProvider({ role, profile, children }) {
  const [businesses, setBusinesses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!profile) return;
      let q = supabase.from('businesses').select('*').eq('active', true).order('name');
      if (role === 'client') q = q.eq('client_id', profile.id);
      const { data } = await q;
      if (mounted) {
        const list = data || [];
        setBusinesses(list);
        if (list.length && !selectedId) setSelectedId(list[0].id);
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [profile, role]);

  const selected = businesses.find(b => b.id === selectedId) || null;

  return (
    <BusinessContext.Provider value={{ businesses, selected, selectedId, setSelectedId, loading }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinesses() {
  return useContext(BusinessContext) || { businesses: [], selected: null, selectedId: null, setSelectedId: () => {}, loading: false };
}

export function BusinessSelector({ role, profile, showAllOption = true, value, onChange, label = 'Business' }) {
  const [businesses, setBusinesses] = useState([]);

  useEffect(() => {
    async function load() {
      let q = supabase.from('businesses').select('*').eq('active', true).order('name');
      if (role === 'client' && profile) q = q.eq('client_id', profile.id);
      else if (role === 'va' && profile) {
        const { data: assignments } = await supabase.from('va_assignments').select('business_id').eq('va_id', profile.id);
        const ids = (assignments || []).map(a => a.business_id);
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
      {label && <label className="field-label">{label}</label>}
      <select value={value || ''} onChange={e => onChange(e.target.value)}>
        {showAllOption && <option value="all">All businesses</option>}
        {!showAllOption && <option value="">Select a business…</option>}
        {businesses.map(b => (
          <option key={b.id} value={b.id}>{b.name} ({b.tier})</option>
        ))}
      </select>
    </div>
  );
}
