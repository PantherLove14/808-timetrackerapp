// Supabase Edge Function: create-user
// Creates an auth user + profile row (users or clients table).
// Returns the inserted row's id explicitly so the caller doesn't have to re-query.

// @ts-ignore
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Missing Authorization header." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return json({ error: "Server misconfigured: missing Supabase URL/anon key." }, 500);
    }
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Server misconfigured: missing service role key." }, 500);
    }

    // Verify caller is an authenticated admin
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthenticated." }, 401);

    // Use admin client to check the caller's role (bypasses RLS so this never fails for legitimate admins)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const { data: me, error: meErr } = await admin.from("users").select("role, active").eq("id", user.id).single();
    if (meErr || !me) return json({ error: "Could not verify caller. Make sure your admin user row exists in public.users." }, 403);
    if (!me.active) return json({ error: "Your admin account is inactive." }, 403);
    if (!["admin", "sub_admin"].includes(me.role)) return json({ error: "Forbidden: admin role required." }, 403);

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON body." }, 400);

    const { type, email, password, profile } = body;

    if (!type) return json({ error: "Missing 'type' (must be 'user' or 'client')." }, 400);
    if (!email) return json({ error: "Missing email." }, 400);
    if (!password) return json({ error: "Missing password." }, 400);
    if (!profile) return json({ error: "Missing profile object." }, 400);
    if (password.length < 12) return json({ error: "Password must be at least 12 characters." }, 400);
    if (!email.includes("@")) return json({ error: "Email format is invalid." }, 400);

    const cleanEmail = email.trim().toLowerCase();

    // Check if email already in use
    const { data: existing } = await admin.auth.admin.listUsers();
    if (existing?.users?.some((u: any) => u.email?.toLowerCase() === cleanEmail)) {
      return json({ error: `An account with email ${cleanEmail} already exists.` }, 400);
    }

    // Create the auth user
    const { data: authData, error: createErr } = await admin.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: { invited_by: user.email, role_type: type }
    });
    if (createErr) return json({ error: `Auth user creation failed: ${createErr.message}` }, 400);
    const newAuthId = authData.user.id;

    if (type === "user") {
      const { data: row, error: rowErr } = await admin
        .from("users")
        .insert({ id: newAuthId, email: cleanEmail, ...profile })
        .select("id")
        .single();
      if (rowErr) {
        await admin.auth.admin.deleteUser(newAuthId);
        return json({ error: `Profile insert failed: ${rowErr.message}` }, 400);
      }
      return json({ success: true, user_id: row.id, id: row.id, email: cleanEmail });
    }

    if (type === "client") {
      const { data: row, error: rowErr } = await admin
        .from("clients")
        .insert({ auth_user_id: newAuthId, email: cleanEmail, ...profile })
        .select("id")
        .single();
      if (rowErr) {
        await admin.auth.admin.deleteUser(newAuthId);
        return json({ error: `Client insert failed: ${rowErr.message}` }, 400);
      }
      return json({ success: true, client_id: row.id, auth_user_id: newAuthId, id: row.id, email: cleanEmail });
    }

    await admin.auth.admin.deleteUser(newAuthId);
    return json({ error: `Invalid type '${type}'. Must be 'user' or 'client'.` }, 400);
  } catch (e: any) {
    return json({ error: `Unexpected error: ${e?.message || String(e)}` }, 500);
  }
});

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
