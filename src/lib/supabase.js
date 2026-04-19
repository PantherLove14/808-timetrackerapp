import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing Supabase env vars. Check your .env file.');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Log audit events from the client side
export async function logAudit(action, entityType = null, entityId = null, metadata = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('audit_log').insert({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: metadata.role || null,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata
    });
  } catch (e) {
    // non-fatal
    console.warn('Audit log failed:', e);
  }
}
