-- ============================================================================
-- FIRST ADMIN BOOTSTRAP
-- Run this AFTER you've created your auth user via Supabase Dashboard
-- (Authentication > Users > Add user).
--
-- Step 1: Create auth user in Supabase Dashboard with your email + password.
-- Step 2: Copy the auth user's UUID (from the Users table).
-- Step 3: Replace the placeholders below and run this script.
-- ============================================================================

-- REPLACE THESE THREE VALUES:
insert into public.users (id, name, email, role, active)
values (
  '00000000-0000-0000-0000-000000000000',  -- <- paste your auth user UUID here
  'Tracy V. Allen',                         -- <- your name
  'your-email@example.com',                 -- <- same email you used in auth
  'admin',
  true
);

-- Verify it worked:
select id, name, email, role, active from public.users;

-- You should see your admin row. Now log into the app with that email+password.
