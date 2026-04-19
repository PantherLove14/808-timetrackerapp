import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Resolves the current authenticated user into a profile row.
// Returns { session, user, role, profile, loading }
// role is one of: 'admin' | 'sub_admin' | 'va' | 'client' | null
export function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function resolve(sess) {
      if (!sess?.user) {
        if (mounted) { setProfile(null); setRole(null); setLoading(false); }
        return;
      }

      // Try internal user
      const { data: u } = await supabase
        .from('users')
        .select('*')
        .eq('id', sess.user.id)
        .maybeSingle();

      if (u) {
        if (mounted) { setProfile(u); setRole(u.role); setLoading(false); }
        return;
      }

      // Try client
      const { data: c } = await supabase
        .from('clients')
        .select('*')
        .eq('auth_user_id', sess.user.id)
        .maybeSingle();

      if (c) {
        if (mounted) { setProfile(c); setRole('client'); setLoading(false); }
        return;
      }

      // Authenticated but no profile row — sign out
      await supabase.auth.signOut();
      if (mounted) { setProfile(null); setRole(null); setLoading(false); }
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      resolve(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      resolve(sess);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  return { session, user: session?.user, profile, role, loading };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

export async function signOut() {
  await supabase.auth.signOut();
}
