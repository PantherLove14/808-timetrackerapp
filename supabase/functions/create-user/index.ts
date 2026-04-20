// Supabase Edge Function: create-user
// Creates an auth user + profile row (users or clients table).
// Called from admin UI. Verifies caller is admin before proceeding.

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
    if (!authHeader) return json({ error: "missing auth" }, 401);

    // Verify caller is an authenticated admin using the anon key client
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { data: me } = await anonClient.from("users").select("role, active").eq("id", user.id).single();
    if (!me || !me.active || !["admin", "sub_admin"].includes(me.role)) {
      return json({ error: "forbidden" }, 403);
    }

    // Admin client (service role) for the privileged ops
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const body = await req.json();
    const { type, email, password, profile } = body;

    if (!email || !password || !profile || !type) {
      return json({ error: "missing fields" }, 400);
    }
    if (password.length < 12) {
      return json({ error: "password too short" }, 400);
    }

    // Create auth user (auto-confirmed so they can sign in immediately)
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { invited_by: user.email }
    });
    if (authErr) return json({ error: authErr.message }, 400);
    const newId = authData.user.id;

    if (type === "user") {
      // Insert profile row into users table
      const { error: rowErr } = await admin.from("users").insert({
        id: newId,
        email: email.trim().toLowerCase(),
        ...profile
      });
      if (rowErr) {
        // Clean up auth user if profile insert failed
        await admin.auth.admin.deleteUser(newId);
        return json({ error: rowErr.message }, 400);
      }
    } else if (type === "client") {
      const { error: rowErr } = await admin.from("clients").insert({
        auth_user_id: newId,
        email: email.trim().toLowerCase(),
        ...profile
      });
      if (rowErr) {
        await admin.auth.admin.deleteUser(newId);
        return json({ error: rowErr.message }, 400);
      }
    } else {
      await admin.auth.admin.deleteUser(newId);
      return json({ error: "invalid type" }, 400);
    }

    return json({ success: true, id: newId, email: email.trim().toLowerCase() });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
});

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
