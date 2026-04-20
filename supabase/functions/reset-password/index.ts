// Supabase Edge Function: reset-password
// Sets a new password for a given auth user id. Admin only.

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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { targetAuthUserId, newPassword } = await req.json();
    if (!targetAuthUserId || !newPassword) return json({ error: "missing fields" }, 400);
    if (newPassword.length < 12) return json({ error: "password too short" }, 400);

    const { error } = await admin.auth.admin.updateUserById(targetAuthUserId, { password: newPassword });
    if (error) return json({ error: error.message }, 400);

    return json({ success: true });
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
