-- ============================================================================
-- 808 TALENT SOURCE — V4 COMPREHENSIVE FIX
--
-- Fixes:
-- 1. RLS infinite recursion (businesses <-> va_assignments)
-- 2. Cross-table policies that triggered recursion errors
-- 3. Adds avatar_url to users + clients
-- 4. Adds task_id to time_entries (link work to a task)
-- 5. Adds storage bucket policy for task-attachments
-- 6. Allows OTMs/clients to upload to task-attachments
--
-- Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SECURITY DEFINER helper functions that bypass RLS internally
--    These break the recursion: businesses_select can call accessible_business_ids()
--    without that function re-triggering businesses RLS.
-- ----------------------------------------------------------------------------

-- Returns array of business IDs the current auth user can access
create or replace function public.accessible_business_ids() returns uuid[]
language sql stable security definer
set search_path = public, auth
as $$
  select coalesce(
    array_agg(distinct b.id),
    array[]::uuid[]
  )
  from public.businesses b
  where
    public.is_admin()
    or b.id in (select business_id from public.va_assignments where va_id = auth.uid())
    or b.client_id in (select id from public.clients where auth_user_id = auth.uid());
$$;

-- Direct check: is the current user the client-owner of this business?
create or replace function public.is_business_client(p_business_id uuid) returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.businesses b
    join public.clients c on c.id = b.client_id
    where b.id = p_business_id and c.auth_user_id = auth.uid()
  );
$$;

-- Direct check: is the current user assigned as OTM to this business?
create or replace function public.is_business_otm(p_business_id uuid) returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.va_assignments
    where business_id = p_business_id and va_id = auth.uid()
  );
$$;

-- Direct check: is the current user the assignee of this task or its creator
create or replace function public.is_task_participant(p_task_id uuid) returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists(
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (
        t.assignee_id = auth.uid()
        or t.created_by = auth.uid()
        or public.is_business_client(t.business_id)
        or public.is_business_otm(t.business_id)
      )
  );
$$;

grant execute on function public.accessible_business_ids() to authenticated, anon;
grant execute on function public.is_business_client(uuid) to authenticated, anon;
grant execute on function public.is_business_otm(uuid) to authenticated, anon;
grant execute on function public.is_task_participant(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 2. REBUILD policies WITHOUT cross-table subqueries that cause recursion
-- ----------------------------------------------------------------------------

-- BUSINESSES
do $$ begin
  drop policy if exists "businesses_select" on public.businesses;
  drop policy if exists "businesses_insert" on public.businesses;
  drop policy if exists "businesses_update" on public.businesses;
  drop policy if exists "businesses_delete" on public.businesses;
end $$;

create policy "businesses_select" on public.businesses for select using (
  public.is_admin()
  or public.is_business_otm(id)
  or public.is_business_client(id)
);
create policy "businesses_insert" on public.businesses for insert with check (public.is_admin());
create policy "businesses_update" on public.businesses for update using (public.is_admin());
create policy "businesses_delete" on public.businesses for delete using (public.is_admin());

-- VA_ASSIGNMENTS — non-recursive: just check if YOU own the row, or you're admin,
-- or it's for a business you own as client
do $$ begin
  drop policy if exists "va_assignments_select" on public.va_assignments;
  drop policy if exists "va_assignments_insert" on public.va_assignments;
  drop policy if exists "va_assignments_delete" on public.va_assignments;
end $$;

create policy "va_assignments_select" on public.va_assignments for select using (
  public.is_admin()
  or va_id = auth.uid()
  or public.is_business_client(business_id)
);
create policy "va_assignments_insert" on public.va_assignments for insert with check (public.is_admin());
create policy "va_assignments_delete" on public.va_assignments for delete using (public.is_admin());

-- TASKS — use SECURITY DEFINER helpers
do $$ begin
  drop policy if exists "tasks_select" on public.tasks;
  drop policy if exists "tasks_insert" on public.tasks;
  drop policy if exists "tasks_update" on public.tasks;
  drop policy if exists "tasks_delete" on public.tasks;
end $$;

create policy "tasks_select" on public.tasks for select using (
  public.is_admin()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
  or public.is_business_otm(business_id)
  or public.is_business_client(business_id)
);
create policy "tasks_insert" on public.tasks for insert with check (
  public.is_admin()
  or public.is_business_otm(business_id)
  or public.is_business_client(business_id)
);
create policy "tasks_update" on public.tasks for update using (
  public.is_admin()
  or assignee_id = auth.uid()
  or public.is_business_client(business_id)
  or public.is_business_otm(business_id)
);
create policy "tasks_delete" on public.tasks for delete using (
  public.is_admin() or created_by = auth.uid()
);

-- TASK_ATTACHMENTS
do $$ begin
  drop policy if exists "task_attachments_select" on public.task_attachments;
  drop policy if exists "task_attachments_insert" on public.task_attachments;
  drop policy if exists "task_attachments_delete" on public.task_attachments;
end $$;
create policy "task_attachments_select" on public.task_attachments for select using (
  public.is_admin() or public.is_task_participant(task_id)
);
create policy "task_attachments_insert" on public.task_attachments for insert with check (
  public.is_admin() or public.is_task_participant(task_id)
);
create policy "task_attachments_delete" on public.task_attachments for delete using (
  public.is_admin() or uploaded_by = auth.uid()
);

-- TASK_COMMENTS
do $$ begin
  drop policy if exists "task_comments_select" on public.task_comments;
  drop policy if exists "task_comments_insert" on public.task_comments;
  drop policy if exists "task_comments_update" on public.task_comments;
  drop policy if exists "task_comments_delete" on public.task_comments;
end $$;
create policy "task_comments_select" on public.task_comments for select using (
  public.is_admin() or public.is_task_participant(task_id)
);
create policy "task_comments_insert" on public.task_comments for insert with check (
  public.is_admin() or public.is_task_participant(task_id)
);
create policy "task_comments_update" on public.task_comments for update using (
  public.is_admin() or author_id = auth.uid()
);
create policy "task_comments_delete" on public.task_comments for delete using (
  public.is_admin() or author_id = auth.uid()
);

-- TIME_ENTRIES — use accessible_business_ids() to avoid recursion
do $$ begin
  drop policy if exists "time_entries_select" on public.time_entries;
  drop policy if exists "time_entries_insert" on public.time_entries;
  drop policy if exists "time_entries_update" on public.time_entries;
  drop policy if exists "time_entries_delete" on public.time_entries;
end $$;
create policy "time_entries_select" on public.time_entries for select using (
  public.is_admin()
  or user_id = auth.uid()
  or public.is_business_client(business_id)
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
  public.is_admin() or public.is_business_client(business_id)
);
create policy "rollovers_insert" on public.rollovers for insert with check (public.is_admin());
create policy "rollovers_update" on public.rollovers for update using (public.is_admin());
create policy "rollovers_delete" on public.rollovers for delete using (public.is_admin());

-- TIME_OFF history clearing — admins can delete reviewed requests
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

-- ----------------------------------------------------------------------------
-- 3. Add new columns: avatar_url, task_id on time_entries
-- ----------------------------------------------------------------------------
alter table public.users add column if not exists avatar_url text;
alter table public.clients add column if not exists avatar_url text;
alter table public.time_entries add column if not exists task_id uuid references public.tasks(id) on delete set null;

create index if not exists idx_time_entries_task on public.time_entries(task_id) where task_id is not null;

-- ----------------------------------------------------------------------------
-- 4. Storage policy for task-attachments bucket
--    Needs to allow authenticated users to read/write objects there
-- ----------------------------------------------------------------------------
-- Note: storage policies are managed in the storage schema, not here.
-- This section is documentation only — set policies in the Supabase Storage UI:
--   bucket "task-attachments": policy for SELECT, INSERT, DELETE allowed for authenticated
--   bucket "avatars": policy for SELECT public, INSERT/UPDATE/DELETE for authenticated
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 5. Audit log: tighten select to admins only (already there but ensure)
-- ----------------------------------------------------------------------------
do $$ begin
  drop policy if exists "audit_log_select" on public.audit_log;
  drop policy if exists "audit_log_insert" on public.audit_log;
end $$;
create policy "audit_log_select" on public.audit_log for select using (public.is_admin());
create policy "audit_log_insert" on public.audit_log for insert with check (true);

-- Done.
