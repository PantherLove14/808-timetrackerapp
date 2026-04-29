-- ============================================================================
-- 808 TALENT SOURCE — V3 COMPREHENSIVE FIX MIGRATION
-- 
-- This migration fixes EVERY known RLS, schema, and policy issue.
-- Run in Supabase SQL Editor. Safe to re-run (uses if-exists guards).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. REPAIR is_admin() function — ensure SECURITY DEFINER and stable behavior
-- ----------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
    and role in ('admin', 'sub_admin')
    and active = true
  );
$$;

create or replace function public.is_va() returns boolean
language sql stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
    and role = 'va'
    and active = true
  );
$$;

create or replace function public.is_client() returns boolean
language sql stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.clients where auth_user_id = auth.uid() and active = true
  );
$$;

create or replace function public.current_client_id() returns uuid
language sql stable
security definer
set search_path = public, auth
as $$
  select id from public.clients where auth_user_id = auth.uid() limit 1;
$$;

-- Grant execute to all relevant roles so RLS-evaluated calls work
grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.is_va() to authenticated, anon;
grant execute on function public.is_client() to authenticated, anon;
grant execute on function public.current_client_id() to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. REBUILD all RLS policies cleanly. Drop EVERYTHING and rebuild.
--    This catches situations where policies were modified manually or via
--    earlier migrations and got into inconsistent states.
-- ----------------------------------------------------------------------------

-- USERS
do $$ begin
  drop policy if exists "users select: admin all, self" on public.users;
  drop policy if exists "users insert: admin only" on public.users;
  drop policy if exists "users update: admin all, self limited" on public.users;
  drop policy if exists "users delete: admin only" on public.users;
  drop policy if exists "users_select" on public.users;
  drop policy if exists "users_insert" on public.users;
  drop policy if exists "users_update" on public.users;
  drop policy if exists "users_delete" on public.users;
end $$;

create policy "users_select" on public.users for select using (
  public.is_admin() or id = auth.uid()
);
create policy "users_insert" on public.users for insert with check (public.is_admin());
create policy "users_update" on public.users for update using (public.is_admin() or id = auth.uid());
create policy "users_delete" on public.users for delete using (public.is_admin());

-- CLIENTS
do $$ begin
  drop policy if exists "clients select: admin all, self" on public.clients;
  drop policy if exists "clients insert: admin only" on public.clients;
  drop policy if exists "clients update: admin all, self limited" on public.clients;
  drop policy if exists "clients delete: admin only" on public.clients;
  drop policy if exists "clients_select" on public.clients;
  drop policy if exists "clients_insert" on public.clients;
  drop policy if exists "clients_update" on public.clients;
  drop policy if exists "clients_delete" on public.clients;
end $$;

create policy "clients_select" on public.clients for select using (
  public.is_admin() or auth_user_id = auth.uid()
);
create policy "clients_insert" on public.clients for insert with check (public.is_admin());
create policy "clients_update" on public.clients for update using (
  public.is_admin() or auth_user_id = auth.uid()
);
create policy "clients_delete" on public.clients for delete using (public.is_admin());

-- BUSINESSES
do $$ begin
  drop policy if exists "businesses select: admin/va-assigned/client-owner" on public.businesses;
  drop policy if exists "businesses insert: admin only" on public.businesses;
  drop policy if exists "businesses update: admin only" on public.businesses;
  drop policy if exists "businesses delete: admin only" on public.businesses;
  drop policy if exists "businesses_select" on public.businesses;
  drop policy if exists "businesses_insert" on public.businesses;
  drop policy if exists "businesses_update" on public.businesses;
  drop policy if exists "businesses_delete" on public.businesses;
end $$;

create policy "businesses_select" on public.businesses for select using (
  public.is_admin()
  or id in (select business_id from public.va_assignments where va_id = auth.uid())
  or client_id = public.current_client_id()
);
create policy "businesses_insert" on public.businesses for insert with check (public.is_admin());
create policy "businesses_update" on public.businesses for update using (public.is_admin());
create policy "businesses_delete" on public.businesses for delete using (public.is_admin());

-- VA_ASSIGNMENTS
do $$ begin
  drop policy if exists "va_assignments select: admin all, va self, client own businesses" on public.va_assignments;
  drop policy if exists "va_assignments insert: admin only" on public.va_assignments;
  drop policy if exists "va_assignments delete: admin only" on public.va_assignments;
  drop policy if exists "va_assignments_select" on public.va_assignments;
  drop policy if exists "va_assignments_insert" on public.va_assignments;
  drop policy if exists "va_assignments_delete" on public.va_assignments;
end $$;

create policy "va_assignments_select" on public.va_assignments for select using (
  public.is_admin()
  or va_id = auth.uid()
  or business_id in (select id from public.businesses where client_id = public.current_client_id())
);
create policy "va_assignments_insert" on public.va_assignments for insert with check (public.is_admin());
create policy "va_assignments_delete" on public.va_assignments for delete using (public.is_admin());

-- TASKS — fix the bug where OTMs can't create tasks
do $$ begin
  drop policy if exists "tasks select: admin, assigned VA, business owner client" on public.tasks;
  drop policy if exists "tasks insert: admin or client of the business" on public.tasks;
  drop policy if exists "tasks update: admin, assignee, business owner" on public.tasks;
  drop policy if exists "tasks delete: admin only" on public.tasks;
  drop policy if exists "tasks_select" on public.tasks;
  drop policy if exists "tasks_insert" on public.tasks;
  drop policy if exists "tasks_update" on public.tasks;
  drop policy if exists "tasks_delete" on public.tasks;
end $$;

create policy "tasks_select" on public.tasks for select using (
  public.is_admin()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
  or business_id in (select business_id from public.va_assignments where va_id = auth.uid())
  or business_id in (select id from public.businesses where client_id = public.current_client_id())
);
-- FIX: OTMs now allowed to create tasks for businesses they're assigned to
create policy "tasks_insert" on public.tasks for insert with check (
  public.is_admin()
  or business_id in (select id from public.businesses where client_id = public.current_client_id())
  or business_id in (select business_id from public.va_assignments where va_id = auth.uid())
);
create policy "tasks_update" on public.tasks for update using (
  public.is_admin()
  or assignee_id = auth.uid()
  or business_id in (select id from public.businesses where client_id = public.current_client_id())
);
create policy "tasks_delete" on public.tasks for delete using (
  public.is_admin() or created_by = auth.uid()
);

-- TASK_ATTACHMENTS
do $$ begin
  drop policy if exists "task_attachments select: anyone with task access" on public.task_attachments;
  drop policy if exists "task_attachments insert: anyone with task access" on public.task_attachments;
  drop policy if exists "task_attachments delete: admin or uploader" on public.task_attachments;
  drop policy if exists "task_attachments_select" on public.task_attachments;
  drop policy if exists "task_attachments_insert" on public.task_attachments;
  drop policy if exists "task_attachments_delete" on public.task_attachments;
end $$;

create policy "task_attachments_select" on public.task_attachments for select using (
  task_id in (select id from public.tasks)
);
create policy "task_attachments_insert" on public.task_attachments for insert with check (
  task_id in (select id from public.tasks)
);
create policy "task_attachments_delete" on public.task_attachments for delete using (
  public.is_admin() or uploaded_by = auth.uid()
);

-- TASK_COMMENTS — let admins, OTMs, AND clients all comment on tasks they can see
do $$ begin
  drop policy if exists "task_comments select: anyone with task access" on public.task_comments;
  drop policy if exists "task_comments insert: anyone with task access" on public.task_comments;
  drop policy if exists "task_comments_select" on public.task_comments;
  drop policy if exists "task_comments_insert" on public.task_comments;
  drop policy if exists "task_comments_update" on public.task_comments;
  drop policy if exists "task_comments_delete" on public.task_comments;
end $$;

create policy "task_comments_select" on public.task_comments for select using (
  task_id in (select id from public.tasks)
);
create policy "task_comments_insert" on public.task_comments for insert with check (
  task_id in (select id from public.tasks)
);
create policy "task_comments_update" on public.task_comments for update using (
  author_id = auth.uid() or public.is_admin()
);
create policy "task_comments_delete" on public.task_comments for delete using (
  author_id = auth.uid() or public.is_admin()
);

-- TIME_ENTRIES
do $$ begin
  drop policy if exists "time_entries select: admin, owner, business client" on public.time_entries;
  drop policy if exists "time_entries insert: admin or owner" on public.time_entries;
  drop policy if exists "time_entries update: admin or owner same month" on public.time_entries;
  drop policy if exists "time_entries delete: admin or owner same month" on public.time_entries;
  drop policy if exists "time_entries_select" on public.time_entries;
  drop policy if exists "time_entries_insert" on public.time_entries;
  drop policy if exists "time_entries_update" on public.time_entries;
  drop policy if exists "time_entries_delete" on public.time_entries;
end $$;

create policy "time_entries_select" on public.time_entries for select using (
  public.is_admin()
  or user_id = auth.uid()
  or business_id in (select id from public.businesses where client_id = public.current_client_id())
);
create policy "time_entries_insert" on public.time_entries for insert with check (
  public.is_admin() or user_id = auth.uid()
);
create policy "time_entries_update" on public.time_entries for update using (
  public.is_admin() or user_id = auth.uid()
);
create policy "time_entries_delete" on public.time_entries for delete using (
  public.is_admin() or user_id = auth.uid()
);

-- ROLLOVERS
do $$ begin
  drop policy if exists "rollovers_select" on public.rollovers;
  drop policy if exists "rollovers_insert" on public.rollovers;
  drop policy if exists "rollovers_update" on public.rollovers;
  drop policy if exists "rollovers_delete" on public.rollovers;
end $$;
create policy "rollovers_select" on public.rollovers for select using (
  public.is_admin() or business_id in (select id from public.businesses where client_id = public.current_client_id())
);
create policy "rollovers_insert" on public.rollovers for insert with check (public.is_admin());
create policy "rollovers_update" on public.rollovers for update using (public.is_admin());
create policy "rollovers_delete" on public.rollovers for delete using (public.is_admin());

-- TIME_OFF
do $$ begin
  drop policy if exists "time_off_select" on public.time_off;
  drop policy if exists "time_off_insert" on public.time_off;
  drop policy if exists "time_off_update" on public.time_off;
  drop policy if exists "time_off_delete" on public.time_off;
end $$;
create policy "time_off_select" on public.time_off for select using (
  public.is_admin() or user_id = auth.uid()
);
create policy "time_off_insert" on public.time_off for insert with check (
  public.is_admin() or user_id = auth.uid()
);
create policy "time_off_update" on public.time_off for update using (public.is_admin());
create policy "time_off_delete" on public.time_off for delete using (public.is_admin());

-- PAY_STUBS
do $$ begin
  drop policy if exists "pay_stubs_select" on public.pay_stubs;
  drop policy if exists "pay_stubs_insert" on public.pay_stubs;
  drop policy if exists "pay_stubs_update" on public.pay_stubs;
  drop policy if exists "pay_stubs_delete" on public.pay_stubs;
end $$;
create policy "pay_stubs_select" on public.pay_stubs for select using (
  public.is_admin() or user_id = auth.uid()
);
create policy "pay_stubs_insert" on public.pay_stubs for insert with check (public.is_admin());
create policy "pay_stubs_update" on public.pay_stubs for update using (public.is_admin());
create policy "pay_stubs_delete" on public.pay_stubs for delete using (public.is_admin());

-- MONTH_LOCKS
do $$ begin
  drop policy if exists "month_locks_select" on public.month_locks;
  drop policy if exists "month_locks_insert" on public.month_locks;
  drop policy if exists "month_locks_update" on public.month_locks;
  drop policy if exists "month_locks_delete" on public.month_locks;
end $$;
create policy "month_locks_select" on public.month_locks for select using (true);
create policy "month_locks_insert" on public.month_locks for insert with check (public.is_admin());
create policy "month_locks_update" on public.month_locks for update using (public.is_admin());
create policy "month_locks_delete" on public.month_locks for delete using (public.is_admin());

-- AUDIT_LOG
do $$ begin
  drop policy if exists "audit_log_select" on public.audit_log;
  drop policy if exists "audit_log_insert" on public.audit_log;
end $$;
create policy "audit_log_select" on public.audit_log for select using (public.is_admin());
create policy "audit_log_insert" on public.audit_log for insert with check (true);

-- OTM_CREDENTIALS
do $$ begin
  drop policy if exists "otm_credentials_select" on public.otm_credentials;
  drop policy if exists "otm_credentials_insert" on public.otm_credentials;
  drop policy if exists "otm_credentials_update" on public.otm_credentials;
  drop policy if exists "otm_credentials_delete" on public.otm_credentials;
end $$;
alter table public.otm_credentials enable row level security;
create policy "otm_credentials_select" on public.otm_credentials for select using (public.is_admin());
create policy "otm_credentials_insert" on public.otm_credentials for insert with check (public.is_admin());
create policy "otm_credentials_update" on public.otm_credentials for update using (public.is_admin());
create policy "otm_credentials_delete" on public.otm_credentials for delete using (public.is_admin());

-- ----------------------------------------------------------------------------
-- 3. Ensure all tables have RLS enabled
-- ----------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.clients enable row level security;
alter table public.businesses enable row level security;
alter table public.va_assignments enable row level security;
alter table public.tasks enable row level security;
alter table public.task_attachments enable row level security;
alter table public.task_comments enable row level security;
alter table public.time_entries enable row level security;
alter table public.rollovers enable row level security;
alter table public.time_off enable row level security;
alter table public.pay_stubs enable row level security;
alter table public.month_locks enable row level security;
alter table public.audit_log enable row level security;

-- ----------------------------------------------------------------------------
-- 4. New: task_comments_read_receipts table — track who has seen comments
--    (for unread-count badges)
-- ----------------------------------------------------------------------------
create table if not exists public.task_comment_reads (
  comment_id uuid not null references public.task_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz default now(),
  primary key (comment_id, user_id)
);
alter table public.task_comment_reads enable row level security;

drop policy if exists "task_comment_reads_select" on public.task_comment_reads;
drop policy if exists "task_comment_reads_insert" on public.task_comment_reads;
create policy "task_comment_reads_select" on public.task_comment_reads for select using (
  user_id = auth.uid() or public.is_admin()
);
create policy "task_comment_reads_insert" on public.task_comment_reads for insert with check (
  user_id = auth.uid()
);

-- ----------------------------------------------------------------------------
-- 5. Ensure profile insert tolerance — when service-role inserts into clients
--    or users, RLS check shouldn't fail (it bypasses anyway, but for safety).
--    No-op kept here as documentation.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 6. Verify count of v2 columns (if migration didn't fully apply, fix)
-- ----------------------------------------------------------------------------
alter table public.businesses add column if not exists business_type text;
alter table public.businesses add column if not exists website text;
alter table public.businesses add column if not exists ein text;
alter table public.businesses add column if not exists contract_start_date date;
alter table public.businesses add column if not exists contract_end_date date;

-- Done. Re-run is safe.
