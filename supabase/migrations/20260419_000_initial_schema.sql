-- ============================================================================
-- 808 TALENT SOURCE - TIME TRACKER DATABASE SCHEMA
-- Run this in Supabase SQL Editor as a single script.
-- Creates all tables, row-level security policies, triggers, and helper functions.
-- ============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================================================
-- ENUMS
-- ============================================================================
create type user_role as enum ('admin', 'sub_admin', 'va');
create type task_status as enum ('todo', 'in_progress', 'submitted', 'approved', 'revision_requested');
create type entry_type as enum ('timer', 'manual');
create type time_off_type as enum ('vacation', 'sick', 'personal', 'bereavement', 'other');
create type request_status as enum ('pending', 'approved', 'denied');
create type priority_level as enum ('low', 'normal', 'high', 'urgent');

-- ============================================================================
-- USERS (internal team: admins, sub-admins, VAs)
-- Linked to Supabase auth.users via id
-- ============================================================================
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text unique not null,
  role user_role not null default 'va',
  phone text,
  hourly_rate numeric(10,2),
  weekly_hours_committed integer,
  start_date date,
  birthday date,
  work_anniversary date,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  shirt_size text,
  childrens_info jsonb default '[]'::jsonb,  -- [{name, birthday}]
  notable_dates jsonb default '[]'::jsonb,   -- [{label, date}]
  admin_notes text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- CLIENTS (the primary contact who logs in)
-- A client contact can own multiple businesses.
-- ============================================================================
create table clients (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  email text unique not null,
  phone text,
  address text,
  birthday date,
  notable_dates jsonb default '[]'::jsonb,
  admin_notes text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- BUSINESSES (each retainer belongs to a business under a client)
-- ============================================================================
create table businesses (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  industry text,
  tax_classification text,
  billing_contact_name text,
  billing_contact_email text,
  stakeholders jsonb default '[]'::jsonb,
  onboarding_date date,
  renewal_date date,
  tier text not null default 'Starter',
  monthly_hours integer not null default 20,
  monthly_fee numeric(10,2) not null default 0,
  rollover_enabled boolean default true,
  rollover_cap_pct integer default 50,
  overage_rate numeric(10,2),
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- VA ASSIGNMENTS (which VAs can work on which businesses)
-- ============================================================================
create table va_assignments (
  id uuid primary key default uuid_generate_v4(),
  va_id uuid not null references users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  assigned_at timestamptz default now(),
  unique(va_id, business_id)
);

-- ============================================================================
-- TASKS
-- ============================================================================
create table tasks (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  assignee_id uuid references users(id),
  title text not null,
  description text,
  audio_instruction_url text,
  status task_status default 'todo',
  priority priority_level default 'normal',
  due_date date,
  submitted_at timestamptz,
  approved_at timestamptz,
  revision_reason text,
  revision_count integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================================
-- TASK ATTACHMENTS
-- ============================================================================
create table task_attachments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  file_name text not null,
  file_path text not null,
  file_size integer,
  mime_type text,
  created_at timestamptz default now()
);

-- ============================================================================
-- TASK COMMENTS (threaded communication)
-- ============================================================================
create table task_comments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  author_name text not null,
  author_role text not null,
  body text not null,
  created_at timestamptz default now()
);

-- ============================================================================
-- TIME ENTRIES
-- ============================================================================
create table time_entries (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  description text not null,
  duration integer not null check (duration > 0),
  date timestamptz not null default now(),
  type entry_type not null default 'timer',
  reason text,
  created_at timestamptz default now()
);

-- ============================================================================
-- ROLLOVERS (monthly calculation per business)
-- ============================================================================
create table rollovers (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  month date not null,
  base_hours numeric(10,2) not null,
  rollover_in numeric(10,2) default 0,
  used_hours numeric(10,2) default 0,
  rollover_out numeric(10,2) default 0,
  computed_at timestamptz default now(),
  unique(business_id, month)
);

-- ============================================================================
-- TIME OFF REQUESTS
-- ============================================================================
create table time_off (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  type time_off_type not null,
  start_date date not null,
  end_date date not null,
  reason text,
  status request_status default 'pending',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz default now()
);

-- ============================================================================
-- PAY STUBS (admin-only access)
-- ============================================================================
create table pay_stubs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  month date not null,
  hours_worked numeric(10,2) not null,
  hourly_rate numeric(10,2) not null,
  base_pay numeric(10,2) not null,
  bonus numeric(10,2) default 0,
  deductions numeric(10,2) default 0,
  net_pay numeric(10,2) not null,
  admin_notes text,
  generated_by uuid not null references users(id),
  generated_at timestamptz default now(),
  unique(user_id, month)
);

-- ============================================================================
-- MONTH LOCKS
-- ============================================================================
create table month_locks (
  id uuid primary key default uuid_generate_v4(),
  month date not null unique,
  locked_at timestamptz default now(),
  locked_by uuid not null references users(id),
  scheduled_for timestamptz,  -- if null, locked immediately; else, scheduled
  unlock_reason text,
  unlocked_at timestamptz,
  unlocked_by uuid references users(id)
);

-- ============================================================================
-- AUDIT LOG (critical actions)
-- ============================================================================
create table audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor_id uuid references auth.users(id),
  actor_email text,
  actor_role text,
  action text not null,
  entity_type text,
  entity_id uuid,
  ip_address text,
  metadata jsonb,
  created_at timestamptz default now()
);
create index idx_audit_log_created_at on audit_log(created_at desc);
create index idx_audit_log_actor on audit_log(actor_id);

-- ============================================================================
-- HELPER FUNCTIONS FOR RLS
-- ============================================================================

-- Is the current auth user an admin?
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from users
    where id = auth.uid()
    and role in ('admin', 'sub_admin')
    and active = true
  );
$$ language sql stable security definer;

-- Is the current auth user a VA?
create or replace function is_va() returns boolean as $$
  select exists (
    select 1 from users
    where id = auth.uid()
    and role = 'va'
    and active = true
  );
$$ language sql stable security definer;

-- Is the current auth user a client?
create or replace function is_client() returns boolean as $$
  select exists (
    select 1 from clients
    where auth_user_id = auth.uid()
    and active = true
  );
$$ language sql stable security definer;

-- Get the client id for current auth user (if they are a client)
create or replace function current_client_id() returns uuid as $$
  select id from clients where auth_user_id = auth.uid();
$$ language sql stable security definer;

-- Business ids that current user can see
create or replace function accessible_business_ids() returns setof uuid as $$
begin
  if is_admin() then
    return query select id from businesses;
  elsif is_va() then
    return query select business_id from va_assignments where va_id = auth.uid();
  elsif is_client() then
    return query select id from businesses where client_id = current_client_id();
  end if;
end;
$$ language plpgsql stable security definer;

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

alter table users enable row level security;
alter table clients enable row level security;
alter table businesses enable row level security;
alter table va_assignments enable row level security;
alter table tasks enable row level security;
alter table task_attachments enable row level security;
alter table task_comments enable row level security;
alter table time_entries enable row level security;
alter table rollovers enable row level security;
alter table time_off enable row level security;
alter table pay_stubs enable row level security;
alter table month_locks enable row level security;
alter table audit_log enable row level security;

-- ----- USERS -----
create policy "users select: admin all, self" on users
  for select using (is_admin() or id = auth.uid());
create policy "users insert: admin only" on users
  for insert with check (is_admin());
create policy "users update: admin all, self limited" on users
  for update using (is_admin() or id = auth.uid());
create policy "users delete: admin only" on users
  for delete using (is_admin());

-- ----- CLIENTS -----
create policy "clients select: admin all, self" on clients
  for select using (is_admin() or auth_user_id = auth.uid());
create policy "clients insert: admin only" on clients
  for insert with check (is_admin());
create policy "clients update: admin all, self limited" on clients
  for update using (is_admin() or auth_user_id = auth.uid());
create policy "clients delete: admin only" on clients
  for delete using (is_admin());

-- ----- BUSINESSES -----
create policy "businesses select: admin/va-assigned/client-owner" on businesses
  for select using (
    is_admin()
    or id in (select business_id from va_assignments where va_id = auth.uid())
    or client_id = current_client_id()
  );
create policy "businesses insert: admin only" on businesses
  for insert with check (is_admin());
create policy "businesses update: admin only" on businesses
  for update using (is_admin());
create policy "businesses delete: admin only" on businesses
  for delete using (is_admin());

-- ----- VA ASSIGNMENTS -----
create policy "va_assignments select: admin all, va self, client own businesses" on va_assignments
  for select using (
    is_admin()
    or va_id = auth.uid()
    or business_id in (select id from businesses where client_id = current_client_id())
  );
create policy "va_assignments insert: admin only" on va_assignments
  for insert with check (is_admin());
create policy "va_assignments delete: admin only" on va_assignments
  for delete using (is_admin());

-- ----- TASKS -----
create policy "tasks select: admin, assigned VA, business owner client" on tasks
  for select using (
    is_admin()
    or assignee_id = auth.uid()
    or business_id in (select business_id from va_assignments where va_id = auth.uid())
    or business_id in (select id from businesses where client_id = current_client_id())
  );
create policy "tasks insert: admin or client of the business" on tasks
  for insert with check (
    is_admin()
    or business_id in (select id from businesses where client_id = current_client_id())
  );
create policy "tasks update: admin, assignee, business owner" on tasks
  for update using (
    is_admin()
    or assignee_id = auth.uid()
    or business_id in (select id from businesses where client_id = current_client_id())
  );
create policy "tasks delete: admin only" on tasks
  for delete using (is_admin());

-- ----- TASK ATTACHMENTS -----
create policy "task_attachments select: same as tasks" on task_attachments
  for select using (
    task_id in (
      select id from tasks where
        is_admin()
        or assignee_id = auth.uid()
        or business_id in (select business_id from va_assignments where va_id = auth.uid())
        or business_id in (select id from businesses where client_id = current_client_id())
    )
  );
create policy "task_attachments insert: same as task update permissions" on task_attachments
  for insert with check (
    task_id in (
      select id from tasks where
        is_admin()
        or assignee_id = auth.uid()
        or business_id in (select id from businesses where client_id = current_client_id())
    )
  );
create policy "task_attachments delete: admin or uploader" on task_attachments
  for delete using (is_admin() or uploaded_by = auth.uid());

-- ----- TASK COMMENTS -----
create policy "task_comments select: same as tasks" on task_comments
  for select using (
    task_id in (
      select id from tasks where
        is_admin()
        or assignee_id = auth.uid()
        or business_id in (select business_id from va_assignments where va_id = auth.uid())
        or business_id in (select id from businesses where client_id = current_client_id())
    )
  );
create policy "task_comments insert: same" on task_comments
  for insert with check (
    task_id in (
      select id from tasks where
        is_admin()
        or assignee_id = auth.uid()
        or business_id in (select business_id from va_assignments where va_id = auth.uid())
        or business_id in (select id from businesses where client_id = current_client_id())
    )
  );
create policy "task_comments delete: admin or author" on task_comments
  for delete using (is_admin() or author_id = auth.uid());

-- ----- TIME ENTRIES -----
create policy "time_entries select: admin all, va self, client for own businesses" on time_entries
  for select using (
    is_admin()
    or user_id = auth.uid()
    or business_id in (select id from businesses where client_id = current_client_id())
  );
create policy "time_entries insert: admin or VA for assigned businesses" on time_entries
  for insert with check (
    is_admin()
    or (user_id = auth.uid() and business_id in (select business_id from va_assignments where va_id = auth.uid()))
  );
create policy "time_entries update: admin or VA own" on time_entries
  for update using (is_admin() or user_id = auth.uid());
create policy "time_entries delete: admin or VA own" on time_entries
  for delete using (is_admin() or user_id = auth.uid());

-- ----- ROLLOVERS -----
create policy "rollovers select: admin all, assigned VAs, client owner" on rollovers
  for select using (
    is_admin()
    or business_id in (select business_id from va_assignments where va_id = auth.uid())
    or business_id in (select id from businesses where client_id = current_client_id())
  );
create policy "rollovers admin-only write" on rollovers
  for all using (is_admin());

-- ----- TIME OFF -----
create policy "time_off select: admin all, va self" on time_off
  for select using (is_admin() or user_id = auth.uid());
create policy "time_off insert: va self or admin" on time_off
  for insert with check (is_admin() or user_id = auth.uid());
create policy "time_off update: admin only" on time_off
  for update using (is_admin());

-- ----- PAY STUBS (admin only + VA read own) -----
create policy "pay_stubs select: admin all, va self" on pay_stubs
  for select using (is_admin() or user_id = auth.uid());
create policy "pay_stubs admin-only write" on pay_stubs
  for insert with check (is_admin());
create policy "pay_stubs admin-only update" on pay_stubs
  for update using (is_admin());
create policy "pay_stubs admin-only delete" on pay_stubs
  for delete using (is_admin());

-- ----- MONTH LOCKS -----
create policy "month_locks select: authenticated read" on month_locks
  for select using (auth.uid() is not null);
create policy "month_locks admin-only write" on month_locks
  for all using (is_admin());

-- ----- AUDIT LOG (admin read only; insert via trigger) -----
create policy "audit_log select: admin only" on audit_log
  for select using (is_admin());
create policy "audit_log insert: any authenticated" on audit_log
  for insert with check (auth.uid() is not null);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update `updated_at` columns automatically
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger users_updated_at before update on users for each row execute function set_updated_at();
create trigger clients_updated_at before update on clients for each row execute function set_updated_at();
create trigger businesses_updated_at before update on businesses for each row execute function set_updated_at();
create trigger tasks_updated_at before update on tasks for each row execute function set_updated_at();

-- Enforce manual entry rules: 1 per month, 8h max, current month only
create or replace function enforce_manual_entry_rules() returns trigger as $$
declare
  existing_manual_count integer;
  entry_month date;
  current_month date;
  month_lock_exists boolean;
begin
  if new.type = 'manual' then
    -- Must be current month
    entry_month := date_trunc('month', new.date)::date;
    current_month := date_trunc('month', now())::date;
    if entry_month != current_month then
      raise exception 'Manual entries must be in the current month. Contact admin for prior months.';
    end if;
    -- Max 8 hours (28800 seconds)
    if new.duration > 28800 then
      raise exception 'Manual entries cannot exceed 8 hours. Contact admin for larger amounts.';
    end if;
    -- Reason required
    if new.reason is null or trim(new.reason) = '' then
      raise exception 'A reason is required for manual entries.';
    end if;
    -- One per month per user
    select count(*) into existing_manual_count
    from time_entries
    where user_id = new.user_id
      and type = 'manual'
      and date_trunc('month', date) = date_trunc('month', new.date);
    if existing_manual_count > 0 then
      raise exception 'You have already used your manual entry for this month. Contact admin.';
    end if;
  end if;

  -- Block any entry in a locked month
  select exists(
    select 1 from month_locks
    where month = date_trunc('month', new.date)::date
      and unlocked_at is null
  ) into month_lock_exists;
  if month_lock_exists and not is_admin() then
    raise exception 'This month is locked. Contact admin to make entries.';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger time_entries_rules before insert on time_entries
for each row execute function enforce_manual_entry_rules();

-- Auto-populate comment author fields from users/clients
create or replace function populate_comment_author() returns trigger as $$
declare
  u_name text;
  u_role text;
  c_name text;
begin
  if new.author_name is null or new.author_role is null then
    select name, role::text into u_name, u_role from users where id = new.author_id;
    if u_name is not null then
      new.author_name := u_name;
      new.author_role := u_role;
    else
      select name into c_name from clients where auth_user_id = new.author_id;
      if c_name is not null then
        new.author_name := c_name;
        new.author_role := 'client';
      end if;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger task_comments_author_fill before insert on task_comments
for each row execute function populate_comment_author();

-- ============================================================================
-- ROLLOVER CALCULATION FUNCTION
-- ============================================================================
-- Run this monthly (cron or admin button). Computes rollover for each business.
create or replace function compute_monthly_rollover(target_month date default date_trunc('month', now())::date) 
returns void as $$
declare
  b record;
  prev_month date;
  used_sec bigint;
  used_hrs numeric;
  prev_rollover numeric;
  available_hrs numeric;
  unused_hrs numeric;
  capped_rollover numeric;
begin
  prev_month := target_month - interval '1 month';

  for b in select id, monthly_hours, rollover_enabled, rollover_cap_pct from businesses where active = true loop
    -- Usage for target_month
    select coalesce(sum(duration), 0) into used_sec
    from time_entries
    where business_id = b.id
      and date >= target_month
      and date < target_month + interval '1 month';
    used_hrs := used_sec::numeric / 3600;

    -- Rollover coming in (from prev month)
    select coalesce(rollover_out, 0) into prev_rollover
    from rollovers
    where business_id = b.id and month = prev_month;
    if prev_rollover is null then prev_rollover := 0; end if;

    available_hrs := b.monthly_hours + prev_rollover;
    unused_hrs := greatest(0, available_hrs - used_hrs);

    -- Cap rollover at % of base monthly hours
    if b.rollover_enabled then
      capped_rollover := least(unused_hrs, (b.monthly_hours * b.rollover_cap_pct::numeric / 100));
    else
      capped_rollover := 0;
    end if;

    insert into rollovers (business_id, month, base_hours, rollover_in, used_hours, rollover_out)
    values (b.id, target_month, b.monthly_hours, prev_rollover, used_hrs, capped_rollover)
    on conflict (business_id, month) do update
      set base_hours = excluded.base_hours,
          rollover_in = excluded.rollover_in,
          used_hours = excluded.used_hours,
          rollover_out = excluded.rollover_out,
          computed_at = now();
  end loop;
end;
$$ language plpgsql security definer;

-- ============================================================================
-- STORAGE BUCKET (run via Supabase Storage UI or the app will handle it)
-- Name: task-attachments, private, max 100MB per file
-- ============================================================================

comment on table users is '808 Talent Source: internal team including admins and VAs';
comment on table clients is '808 Talent Source: client contacts who have portal access';
comment on table businesses is '808 Talent Source: individual business accounts under a client';
