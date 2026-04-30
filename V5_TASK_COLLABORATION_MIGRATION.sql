-- ============================================================================
-- 808 TALENT SOURCE — V5 TASK COLLABORATION MIGRATION
--
-- WHAT THIS DOES
-- ---------------
-- 1. Hardens task_comments table for full project-management style dialogue:
--    - attachments jsonb (multi-file per message)            [if not exists]
--    - reply_to_id uuid (quote a previous comment)           [if not exists]
--    - mentions uuid[] (@-mention array)                     [if not exists]
--    - system_message boolean (status-change auto-posts)     [if not exists]
--    - body made nullable so voice-only/file-only msgs work  [if still NOT NULL]
--
-- 2. Adds SECURITY DEFINER helper get_task_participant_minimal(uuid) that
--    returns minimal name+role+avatar for everyone on a task, bypassing the
--    "users select self" RLS that was breaking the OTM detail page join.
--
-- 3. Re-asserts the v4 RLS policies on tasks / task_comments / task_attachments
--    so admin, the assigned OTM, the business client, the creator, and any
--    OTM assigned to the business can all read AND write to the conversation.
--
-- 4. Enables Supabase Realtime publication on task_comments + task_attachments
--    so messages stream into open task pages in real time.
--
-- 5. Self-verifies at the end with assertion block that prints
--    ✅ V5 MIGRATION COMPLETE - ALL CHECKS PASSED
--
-- This migration is IDEMPOTENT and safe to re-run.
-- ============================================================================

set local statement_timeout = '60s';

-- ----------------------------------------------------------------------------
-- 1. SCHEMA: task_comments columns
-- ----------------------------------------------------------------------------

-- Ensure attachments jsonb column exists (handoff doc says this exists, but
-- harden in case the v4 bulletproof migration was applied unevenly)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments' and column_name = 'attachments'
  ) then
    alter table public.task_comments add column attachments jsonb;
  end if;
end $$;

-- Drop NOT NULL on body so voice-only / file-only messages can be posted
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments'
      and column_name = 'body' and is_nullable = 'NO'
  ) then
    alter table public.task_comments alter column body drop not null;
  end if;
end $$;

-- Reply-to threading
alter table public.task_comments
  add column if not exists reply_to_id uuid references public.task_comments(id) on delete set null;

-- @-mentions (array of user IDs that were tagged)
alter table public.task_comments
  add column if not exists mentions uuid[];

-- System messages (auto-posted on status changes; rendered differently in UI)
alter table public.task_comments
  add column if not exists system_message boolean not null default false;

-- Edited tracking
alter table public.task_comments
  add column if not exists edited_at timestamptz;

create index if not exists idx_task_comments_task_created
  on public.task_comments(task_id, created_at);
create index if not exists idx_task_comments_reply_to
  on public.task_comments(reply_to_id) where reply_to_id is not null;

-- ----------------------------------------------------------------------------
-- 2. NEW HELPER FUNCTION: get_task_participants(task_id)
--
-- Returns a minimal projection (id, name, role, avatar_url) of every user
-- and client who can see/participate in a task. Runs as SECURITY DEFINER so
-- it bypasses the strict "users select self" / "clients select self" RLS
-- that was causing the OTM TaskDetailPage to hang when it tried to embed
-- the assignee's or creator's user row through a regular join.
--
-- Returned roles: 'admin' | 'sub_admin' | 'va' | 'client'
-- ----------------------------------------------------------------------------
drop function if exists public.get_task_participants(uuid);
create or replace function public.get_task_participants(p_task_id uuid)
returns table (
  id uuid,
  name text,
  role text,
  avatar_url text,
  email text,
  is_assignee boolean,
  is_creator boolean,
  is_business_client boolean,
  is_business_otm boolean
)
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  v_task record;
begin
  -- Caller must be an admin or a participant of this task
  if not (public.is_admin() or public.is_task_participant(p_task_id)) then
    return;
  end if;

  select t.* into v_task from public.tasks t where t.id = p_task_id;
  if not found then return; end if;

  -- Admins (always shown so OTM/Client know who can step in)
  return query
    select u.id, u.name, u.role, u.avatar_url, u.email,
      (u.id = v_task.assignee_id) as is_assignee,
      (u.id = v_task.created_by) as is_creator,
      false as is_business_client,
      exists(select 1 from public.va_assignments va
             where va.business_id = v_task.business_id and va.va_id = u.id) as is_business_otm
    from public.users u
    where u.active = true
      and (
        u.role in ('admin','sub_admin')
        or u.id = v_task.assignee_id
        or u.id = v_task.created_by
        or exists(
          select 1 from public.va_assignments va
          where va.business_id = v_task.business_id and va.va_id = u.id
        )
      );

  -- Business client(s)
  return query
    select c.id, c.name, 'client'::text, c.avatar_url, c.email,
      false as is_assignee,
      false as is_creator,
      true as is_business_client,
      false as is_business_otm
    from public.clients c
    join public.businesses b on b.client_id = c.id
    where b.id = v_task.business_id;
end;
$$;

grant execute on function public.get_task_participants(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 3. NEW HELPER FUNCTION: get_task_with_context(task_id)
--
-- Returns ONE row with the task plus name/avatar of business, client, assignee,
-- creator. Bypasses the user/client select-self RLS so the OTM/Client task
-- detail page never silently fails on an embedded join again.
-- ----------------------------------------------------------------------------
drop function if exists public.get_task_with_context(uuid);
create or replace function public.get_task_with_context(p_task_id uuid)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  business_client_id uuid,
  client_name text,
  client_email text,
  client_avatar_url text,
  assignee_id uuid,
  assignee_name text,
  assignee_avatar_url text,
  creator_id uuid,
  creator_name text,
  creator_avatar_url text,
  creator_role text,
  title text,
  description text,
  audio_instruction_url text,
  status text,
  priority text,
  due_date date,
  submitted_at timestamptz,
  approved_at timestamptz,
  revision_reason text,
  revision_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not (public.is_admin() or public.is_task_participant(p_task_id)) then
    return;
  end if;

  return query
    select
      t.id,
      t.business_id,
      b.name as business_name,
      b.client_id as business_client_id,
      c.name as client_name,
      c.email as client_email,
      c.avatar_url as client_avatar_url,
      t.assignee_id,
      au.name as assignee_name,
      au.avatar_url as assignee_avatar_url,
      t.created_by as creator_id,
      cu.name as creator_name,
      cu.avatar_url as creator_avatar_url,
      cu.role as creator_role,
      t.title,
      t.description,
      t.audio_instruction_url,
      t.status::text,
      t.priority::text,
      t.due_date,
      t.submitted_at,
      t.approved_at,
      t.revision_reason,
      t.revision_count,
      t.created_at,
      t.updated_at
    from public.tasks t
    left join public.businesses b on b.id = t.business_id
    left join public.clients c on c.id = b.client_id
    left join public.users au on au.id = t.assignee_id
    left join public.users cu on cu.id = t.created_by
    where t.id = p_task_id;
end;
$$;

grant execute on function public.get_task_with_context(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. NEW HELPER: list_admin_tasks() — admin global view
--
-- Returns every task with the same shape as get_task_with_context but for
-- ALL tasks. Admin-only. Used by the new AdminTasksPage so admin can see
-- and join any task conversation without logging in as OTM or Client.
-- ----------------------------------------------------------------------------
drop function if exists public.list_admin_tasks();
create or replace function public.list_admin_tasks()
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  client_id uuid,
  client_name text,
  assignee_id uuid,
  assignee_name text,
  assignee_avatar_url text,
  creator_id uuid,
  creator_name text,
  title text,
  description text,
  status text,
  priority text,
  due_date date,
  submitted_at timestamptz,
  approved_at timestamptz,
  revision_reason text,
  revision_count integer,
  created_at timestamptz,
  comment_count bigint,
  attachment_count bigint
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then return; end if;

  return query
    select
      t.id,
      t.business_id,
      b.name as business_name,
      b.client_id,
      c.name as client_name,
      t.assignee_id,
      au.name as assignee_name,
      au.avatar_url as assignee_avatar_url,
      t.created_by as creator_id,
      cu.name as creator_name,
      t.title,
      t.description,
      t.status::text,
      t.priority::text,
      t.due_date,
      t.submitted_at,
      t.approved_at,
      t.revision_reason,
      t.revision_count,
      t.created_at,
      (select count(*) from public.task_comments tc where tc.task_id = t.id) as comment_count,
      (select count(*) from public.task_attachments ta where ta.task_id = t.id) as attachment_count
    from public.tasks t
    left join public.businesses b on b.id = t.business_id
    left join public.clients c on c.id = b.client_id
    left join public.users au on au.id = t.assignee_id
    left join public.users cu on cu.id = t.created_by
    order by t.created_at desc;
end;
$$;

grant execute on function public.list_admin_tasks() to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. RE-ASSERT v4 RLS policies (idempotent — safe if v4 already ran)
--
-- These match V4_BULLETPROOF_MIGRATION semantics and are repeated here so
-- v5 self-heals if the live database drifted.
-- ----------------------------------------------------------------------------

-- TASKS
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

-- TASK_COMMENT_READS — keep v3 policies, re-assert with same semantics
do $$ begin
  drop policy if exists "task_comment_reads_select" on public.task_comment_reads;
  drop policy if exists "task_comment_reads_insert" on public.task_comment_reads;
end $$;
create policy "task_comment_reads_select" on public.task_comment_reads for select using (
  user_id = auth.uid() or public.is_admin()
);
create policy "task_comment_reads_insert" on public.task_comment_reads for insert with check (
  user_id = auth.uid()
);

-- ----------------------------------------------------------------------------
-- 6. SUPABASE REALTIME — add task_comments + task_attachments to publication
-- ----------------------------------------------------------------------------
do $$ begin
  -- Add task_comments to realtime publication if not present
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.task_comments';
  end if;
exception when others then
  -- swallow if publication doesn't exist on this project (older Supabase)
  raise notice 'Realtime publication setup skipped: %', sqlerrm;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_attachments'
  ) then
    execute 'alter publication supabase_realtime add table public.task_attachments';
  end if;
exception when others then
  raise notice 'Realtime publication setup skipped: %', sqlerrm;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.tasks';
  end if;
exception when others then
  raise notice 'Realtime publication setup skipped: %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- 7. SELF-VERIFICATION — assertion block prints success row when all pass
-- ----------------------------------------------------------------------------
do $$
declare
  v_attachments_col_exists boolean;
  v_reply_to_col_exists boolean;
  v_mentions_col_exists boolean;
  v_system_message_col_exists boolean;
  v_body_nullable boolean;
  v_get_task_participants boolean;
  v_get_task_with_context boolean;
  v_list_admin_tasks boolean;
  v_tasks_select_policy boolean;
  v_task_comments_insert_policy boolean;
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_comments' and column_name='attachments') into v_attachments_col_exists;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_comments' and column_name='reply_to_id') into v_reply_to_col_exists;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_comments' and column_name='mentions') into v_mentions_col_exists;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_comments' and column_name='system_message') into v_system_message_col_exists;
  select (is_nullable = 'YES') into v_body_nullable from information_schema.columns where table_schema='public' and table_name='task_comments' and column_name='body';
  select exists(select 1 from pg_proc where proname='get_task_participants' and pronamespace='public'::regnamespace) into v_get_task_participants;
  select exists(select 1 from pg_proc where proname='get_task_with_context' and pronamespace='public'::regnamespace) into v_get_task_with_context;
  select exists(select 1 from pg_proc where proname='list_admin_tasks' and pronamespace='public'::regnamespace) into v_list_admin_tasks;
  select exists(select 1 from pg_policies where schemaname='public' and tablename='tasks' and policyname='tasks_select') into v_tasks_select_policy;
  select exists(select 1 from pg_policies where schemaname='public' and tablename='task_comments' and policyname='task_comments_insert') into v_task_comments_insert_policy;

  if not v_attachments_col_exists then raise exception 'V5 FAIL: task_comments.attachments column missing'; end if;
  if not v_reply_to_col_exists then raise exception 'V5 FAIL: task_comments.reply_to_id column missing'; end if;
  if not v_mentions_col_exists then raise exception 'V5 FAIL: task_comments.mentions column missing'; end if;
  if not v_system_message_col_exists then raise exception 'V5 FAIL: task_comments.system_message column missing'; end if;
  if not v_body_nullable then raise exception 'V5 FAIL: task_comments.body still NOT NULL'; end if;
  if not v_get_task_participants then raise exception 'V5 FAIL: get_task_participants() helper missing'; end if;
  if not v_get_task_with_context then raise exception 'V5 FAIL: get_task_with_context() helper missing'; end if;
  if not v_list_admin_tasks then raise exception 'V5 FAIL: list_admin_tasks() helper missing'; end if;
  if not v_tasks_select_policy then raise exception 'V5 FAIL: tasks_select policy missing'; end if;
  if not v_task_comments_insert_policy then raise exception 'V5 FAIL: task_comments_insert policy missing'; end if;
end $$;

-- Final visible success row in the SQL Editor results pane
select
  '✅ V5 MIGRATION COMPLETE - ALL CHECKS PASSED' as status,
  (select count(*) from pg_policies where schemaname='public' and tablename in ('tasks','task_comments','task_attachments','task_comment_reads')) as task_policies_count,
  (select count(*) from pg_proc where proname in ('get_task_participants','get_task_with_context','list_admin_tasks','is_task_participant','is_business_otm','is_business_client') and pronamespace='public'::regnamespace) as helper_functions_count,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='task_comments' and column_name in ('attachments','reply_to_id','mentions','system_message','edited_at')) as task_comments_new_columns,
  (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('task_comments','task_attachments','tasks')) as realtime_tables_count;
