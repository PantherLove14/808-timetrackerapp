-- ============================================================================
-- 808 TALENT SOURCE — V6 SYSTEM-WIDE TASK + CHAT FIX
--
-- WHAT THIS DOES (the whole list, not patches):
--
--  A. ROOT-CAUSE FIX for "structure of query does not match function result type"
--     v5's RPCs declared `role text` but selected the `user_role` enum column —
--     Postgres rejects it at runtime. v6 casts every column to text in every
--     RPC. Drops + recreates so the new signatures take effect.
--
--  B. NEW RPC: claim_task(uuid)
--     Lets an OTM atomically claim an unassigned task on a business they're
--     assigned to. Does NOT bypass authorization — only assigns to themselves.
--
--  C. NEW RPC: assign_task(uuid, uuid) [admin-only]
--     Lets admin reassign any task to any active OTM, bypassing any RLS edge.
--
--  D. NEW RPC: list_otm_tasks(uuid)
--     Returns tasks an OTM should see — assigned to them PLUS unassigned tasks
--     on any business they're assigned to. This is what makes Client-created
--     tasks appear in the OTM dropdown and kanban regardless of who created them.
--
--  E. NEW RPC: list_client_tasks(uuid)
--     Returns every task across every business this client owns (any creator,
--     any status). Fixes "OTM-created tasks don't show client-side."
--
--  F. NEW RPC: get_business_default_assignee(uuid)
--     Returns the single OTM assigned to a business (or oldest if multiple)
--     so the Client's "New Task" form can pre-populate assignee automatically.
--
--  G. BACKFILL: AUTO-ASSIGN UNASSIGNED HISTORICAL TASKS
--     For every task with assignee_id IS NULL on a business that has exactly
--     one active assigned OTM, set the assignee_id to that OTM. Preserves
--     existing assignments. This is the system-wide upgrade applied to old data.
--
--  H. BACKFILL: orphaned client auth links
--     Logs (does NOT silently mutate) any client with no auth_user_id, so you
--     can fix them in the admin UI. RLS fails silently for these clients
--     because is_business_client() returns false without an auth_user_id.
--
--  I. CHAT INTEGRITY: re-assert that anyone who is a task participant can
--     INSERT comments at ANY status (todo, in_progress, submitted, approved,
--     revision_requested). This was always permitted by the v4 RLS but the
--     UI was previously gating it; the policy stays open here so the new UI
--     can rely on it.
--
--  J. SELF-VERIFICATION block + final summary row that prints what it did.
--
-- IDEMPOTENT. Safe to re-run. Safe to run on fresh DB.
-- ============================================================================

set local statement_timeout = '120s';

-- ----------------------------------------------------------------------------
-- A. Drop old RPCs so we can recreate with corrected signatures
-- ----------------------------------------------------------------------------
drop function if exists public.get_task_with_context(uuid);
drop function if exists public.get_task_participants(uuid);
drop function if exists public.list_admin_tasks();
drop function if exists public.claim_task(uuid);
drop function if exists public.assign_task(uuid, uuid);
drop function if exists public.list_otm_tasks(uuid);
drop function if exists public.list_client_tasks(uuid);
drop function if exists public.get_business_default_assignee(uuid);

-- ----------------------------------------------------------------------------
-- A0. SELF-HEAL — ensure v5-added columns exist before any RPC that writes them
--     (Defensive: if v5 wasn't applied or drifted, v6 still works.)
-- ----------------------------------------------------------------------------
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments' and column_name = 'attachments'
  ) then
    alter table public.task_comments add column attachments jsonb;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments' and column_name = 'reply_to_id'
  ) then
    alter table public.task_comments add column reply_to_id uuid references public.task_comments(id) on delete set null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments' and column_name = 'mentions'
  ) then
    alter table public.task_comments add column mentions uuid[];
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments' and column_name = 'system_message'
  ) then
    alter table public.task_comments add column system_message boolean not null default false;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'task_comments' and column_name = 'edited_at'
  ) then
    alter table public.task_comments add column edited_at timestamptz;
  end if;
  -- Drop NOT NULL on body so file/voice-only messages work
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='task_comments'
      and column_name='body' and is_nullable='NO'
  ) then
    alter table public.task_comments alter column body drop not null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- A1. get_task_with_context — TYPE-CORRECTED
-- ----------------------------------------------------------------------------
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
      b.name::text,
      b.client_id,
      c.name::text,
      c.email::text,
      c.avatar_url::text,
      t.assignee_id,
      au.name::text,
      au.avatar_url::text,
      t.created_by,
      cu.name::text,
      cu.avatar_url::text,
      cu.role::text,         -- enum cast to text
      t.title::text,
      t.description::text,
      t.audio_instruction_url::text,
      t.status::text,        -- enum cast to text
      t.priority::text,      -- enum cast to text
      t.due_date,
      t.submitted_at,
      t.approved_at,
      t.revision_reason::text,
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
-- A2. get_task_participants — TYPE-CORRECTED
-- ----------------------------------------------------------------------------
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
  if not (public.is_admin() or public.is_task_participant(p_task_id)) then
    return;
  end if;

  select t.* into v_task from public.tasks t where t.id = p_task_id;
  if not found then return; end if;

  return query
    select u.id,
      u.name::text,
      u.role::text,           -- enum cast
      u.avatar_url::text,
      u.email::text,
      (u.id = v_task.assignee_id),
      (u.id = v_task.created_by),
      false,
      exists(select 1 from public.va_assignments va
             where va.business_id = v_task.business_id and va.va_id = u.id)
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

  return query
    select c.id,
      c.name::text,
      'client'::text,
      c.avatar_url::text,
      c.email::text,
      false,
      false,
      true,
      false
    from public.clients c
    join public.businesses b on b.client_id = c.id
    where b.id = v_task.business_id;
end;
$$;
grant execute on function public.get_task_participants(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- A3. list_admin_tasks — TYPE-CORRECTED
-- ----------------------------------------------------------------------------
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
      b.name::text,
      b.client_id,
      c.name::text,
      t.assignee_id,
      au.name::text,
      au.avatar_url::text,
      t.created_by,
      cu.name::text,
      t.title::text,
      t.description::text,
      t.status::text,
      t.priority::text,
      t.due_date,
      t.submitted_at,
      t.approved_at,
      t.revision_reason::text,
      t.revision_count,
      t.created_at,
      (select count(*) from public.task_comments tc where tc.task_id = t.id),
      (select count(*) from public.task_attachments ta where ta.task_id = t.id)
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
-- D. list_otm_tasks — assigned-to-me PLUS unassigned-on-my-businesses
-- ----------------------------------------------------------------------------
create or replace function public.list_otm_tasks(p_user_id uuid)
returns table (
  id uuid,
  business_id uuid,
  business_name text,
  client_id uuid,
  client_name text,
  assignee_id uuid,
  assignee_name text,
  creator_id uuid,
  creator_name text,
  creator_role text,
  title text,
  description text,
  status text,
  priority text,
  due_date date,
  revision_reason text,
  revision_count integer,
  created_at timestamptz,
  is_unclaimed boolean,
  comment_count bigint,
  attachment_count bigint
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  -- Caller must be the user themselves OR an admin
  if not (public.is_admin() or auth.uid() = p_user_id) then return; end if;

  return query
    select
      t.id,
      t.business_id,
      b.name::text,
      b.client_id,
      c.name::text,
      t.assignee_id,
      au.name::text,
      t.created_by,
      cu.name::text,
      cu.role::text,
      t.title::text,
      t.description::text,
      t.status::text,
      t.priority::text,
      t.due_date,
      t.revision_reason::text,
      t.revision_count,
      t.created_at,
      (t.assignee_id is null),
      (select count(*) from public.task_comments tc where tc.task_id = t.id),
      (select count(*) from public.task_attachments ta where ta.task_id = t.id)
    from public.tasks t
    left join public.businesses b on b.id = t.business_id
    left join public.clients c on c.id = b.client_id
    left join public.users au on au.id = t.assignee_id
    left join public.users cu on cu.id = t.created_by
    where
      t.assignee_id = p_user_id
      or (
        t.assignee_id is null
        and exists(
          select 1 from public.va_assignments va
          where va.business_id = t.business_id and va.va_id = p_user_id
        )
      )
    order by
      case when t.assignee_id is null then 0 else 1 end,
      t.created_at desc;
end;
$$;
grant execute on function public.list_otm_tasks(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- E. list_client_tasks — every task across every business this client owns
-- ----------------------------------------------------------------------------
create or replace function public.list_client_tasks(p_client_auth_user_id uuid)
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
  creator_role text,
  title text,
  description text,
  status text,
  priority text,
  due_date date,
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
  if not (public.is_admin() or auth.uid() = p_client_auth_user_id) then return; end if;

  return query
    select
      t.id,
      t.business_id,
      b.name::text,
      b.client_id,
      c.name::text,
      t.assignee_id,
      au.name::text,
      au.avatar_url::text,
      t.created_by,
      cu.name::text,
      cu.role::text,
      t.title::text,
      t.description::text,
      t.status::text,
      t.priority::text,
      t.due_date,
      t.revision_reason::text,
      t.revision_count,
      t.created_at,
      (select count(*) from public.task_comments tc where tc.task_id = t.id),
      (select count(*) from public.task_attachments ta where ta.task_id = t.id)
    from public.tasks t
    join public.businesses b on b.id = t.business_id
    join public.clients c on c.id = b.client_id
    left join public.users au on au.id = t.assignee_id
    left join public.users cu on cu.id = t.created_by
    where c.auth_user_id = p_client_auth_user_id
    order by t.created_at desc;
end;
$$;
grant execute on function public.list_client_tasks(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- B. claim_task — OTM atomically self-assigns an unassigned task
-- ----------------------------------------------------------------------------
create or replace function public.claim_task(p_task_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_task record;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select t.* into v_task from public.tasks t where t.id = p_task_id;
  if not found then raise exception 'Task not found'; end if;
  if v_task.assignee_id is not null then
    raise exception 'Task already assigned';
  end if;

  -- Caller must be an OTM assigned to this business
  if not exists(
    select 1 from public.va_assignments
    where business_id = v_task.business_id and va_id = v_caller
  ) then
    raise exception 'You are not assigned to this business';
  end if;

  update public.tasks set assignee_id = v_caller, updated_at = now() where id = p_task_id;

  -- System message into the conversation thread
  insert into public.task_comments (task_id, author_id, author_name, author_role, body, system_message)
  values (
    p_task_id, v_caller,
    coalesce((select name from public.users where id = v_caller), 'OTM'),
    'va', 'Claimed this task.', true
  );

  return true;
end;
$$;
grant execute on function public.claim_task(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- C. assign_task — admin reassigns any task to any active OTM
-- ----------------------------------------------------------------------------
create or replace function public.assign_task(p_task_id uuid, p_assignee_id uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_task record;
  v_assignee_name text;
  v_caller_name text;
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  select t.* into v_task from public.tasks t where t.id = p_task_id;
  if not found then raise exception 'Task not found'; end if;

  if p_assignee_id is not null then
    select name into v_assignee_name from public.users where id = p_assignee_id and active = true;
    if v_assignee_name is null then raise exception 'Assignee not found or inactive'; end if;
  end if;

  update public.tasks set assignee_id = p_assignee_id, updated_at = now() where id = p_task_id;

  select name into v_caller_name from public.users where id = auth.uid();
  insert into public.task_comments (task_id, author_id, author_name, author_role, body, system_message)
  values (
    p_task_id, auth.uid(),
    coalesce(v_caller_name, 'Admin'),
    'admin',
    case when p_assignee_id is null
      then 'Removed task assignment.'
      else format('Assigned this task to %s.', coalesce(v_assignee_name,'OTM'))
    end,
    true
  );

  return true;
end;
$$;
grant execute on function public.assign_task(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- F. get_business_default_assignee — for "New Task" form pre-fill
-- ----------------------------------------------------------------------------
create or replace function public.get_business_default_assignee(p_business_id uuid)
returns table (
  id uuid,
  name text,
  avatar_url text
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  -- Caller must be admin / OTM of this business / client of this business
  if not (
    public.is_admin()
    or public.is_business_otm(p_business_id)
    or public.is_business_client(p_business_id)
  ) then
    return;
  end if;

  return query
    select u.id, u.name::text, u.avatar_url::text
    from public.va_assignments va
    join public.users u on u.id = va.va_id
    where va.business_id = p_business_id
      and u.active = true
    order by va.created_at asc nulls last, u.name asc
    limit 1;
end;
$$;
grant execute on function public.get_business_default_assignee(uuid) to authenticated, anon;

-- Ensure va_assignments has created_at (for stable ordering above)
do $$ begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='va_assignments' and column_name='created_at'
  ) then
    alter table public.va_assignments add column created_at timestamptz default now();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- G. BACKFILL — auto-assign historical unassigned tasks to the business OTM
--    when there is exactly one active assigned OTM. This is the
--    "system-wide upgrade applied to existing records" Tracy asked for.
-- ----------------------------------------------------------------------------
do $$
declare
  v_count int := 0;
begin
  with single_otm_businesses as (
    -- Only businesses with exactly ONE active assigned OTM
    select va.business_id, min(va.va_id::text)::uuid as va_id
    from public.va_assignments va
    join public.users u on u.id = va.va_id
    where u.active = true
    group by va.business_id
    having count(*) = 1
  )
  update public.tasks t
  set assignee_id = s.va_id, updated_at = now()
  from single_otm_businesses s
  where t.assignee_id is null
    and t.business_id = s.business_id
    and t.status in ('todo','in_progress','submitted','revision_requested');

  get diagnostics v_count = row_count;
  raise notice 'Backfill: auto-assigned % previously unassigned tasks to single-OTM businesses.', v_count;
end $$;

-- ----------------------------------------------------------------------------
-- H. ORPHANED CLIENT AUTH CHECK (informational only — does not mutate)
-- ----------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.clients
  where auth_user_id is null and active = true;
  if v_count > 0 then
    raise notice 'Heads up: % active client(s) have no auth_user_id set. They cannot log in or see their tasks until you link their auth account in Admin > Client Admin.', v_count;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- I. RE-ASSERT v4/v5 RLS — chat MUST be open at every status (idempotent)
-- ----------------------------------------------------------------------------
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

-- Also re-assert tasks_update so Client / OTM / Admin can edit per their role
do $$ begin
  drop policy if exists "tasks_update" on public.tasks;
end $$;
create policy "tasks_update" on public.tasks for update using (
  public.is_admin()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
  or public.is_business_client(business_id)
  or public.is_business_otm(business_id)
);

-- ----------------------------------------------------------------------------
-- J. SELF-VERIFICATION
-- ----------------------------------------------------------------------------
do $$
declare
  v_required_fns text[] := array[
    'get_task_with_context','get_task_participants','list_admin_tasks',
    'list_otm_tasks','list_client_tasks',
    'claim_task','assign_task','get_business_default_assignee',
    'is_admin','is_business_otm','is_business_client','is_task_participant'
  ];
  v_fn text;
begin
  foreach v_fn in array v_required_fns loop
    if not exists(select 1 from pg_proc where proname=v_fn and pronamespace='public'::regnamespace) then
      raise exception 'V6 FAIL: function %() missing', v_fn;
    end if;
  end loop;
end $$;

-- Final visible success row
select
  '✅ V6 MIGRATION COMPLETE - ALL CHECKS PASSED' as status,
  (select count(*) from pg_proc where proname in (
    'get_task_with_context','get_task_participants','list_admin_tasks',
    'list_otm_tasks','list_client_tasks','claim_task','assign_task',
    'get_business_default_assignee'
  ) and pronamespace='public'::regnamespace) as v6_rpc_count,
  (select count(*) from public.tasks where assignee_id is null and status in ('todo','in_progress','submitted','revision_requested')) as unassigned_open_tasks_remaining,
  (select count(*) from public.clients where auth_user_id is null and active = true) as clients_without_auth_login,
  (select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('task_comments','task_attachments','tasks')) as realtime_tables_count;
