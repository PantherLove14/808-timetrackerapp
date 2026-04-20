-- ============================================================================
-- 808 TALENT SOURCE — V2 MIGRATION
-- Run in Supabase SQL Editor AFTER the initial schema has been applied.
-- This is SAFE to re-run.
-- ============================================================================

-- Add new columns to businesses (some already exist; using "if not exists" for safety)
alter table businesses add column if not exists business_type text;
alter table businesses add column if not exists website text;
alter table businesses add column if not exists ein text;
alter table businesses add column if not exists contract_start_date date;
alter table businesses add column if not exists contract_end_date date;

-- Credentials for OTMs (team members)
create table if not exists otm_credentials (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null,            -- e.g. "Passport", "QuickBooks ProAdvisor Cert"
  category text,                  -- "ID", "Certificate", "Resume", "Other"
  file_path text not null,
  file_name text not null,
  file_size integer,
  mime_type text,
  expires_on date,                -- optional expiration
  uploaded_by uuid references users(id),
  uploaded_at timestamptz default now(),
  notes text
);

create index if not exists idx_otm_credentials_user on otm_credentials(user_id);
create index if not exists idx_otm_credentials_expires on otm_credentials(expires_on) where expires_on is not null;

-- RLS: admin only
alter table otm_credentials enable row level security;

drop policy if exists "otm_credentials_select" on otm_credentials;
drop policy if exists "otm_credentials_insert" on otm_credentials;
drop policy if exists "otm_credentials_update" on otm_credentials;
drop policy if exists "otm_credentials_delete" on otm_credentials;
create policy "otm_credentials_select" on otm_credentials for select using (is_admin());
create policy "otm_credentials_insert" on otm_credentials for insert with check (is_admin());
create policy "otm_credentials_update" on otm_credentials for update using (is_admin());
create policy "otm_credentials_delete" on otm_credentials for delete using (is_admin());

-- Done. Next: create the "otm-credentials" storage bucket in Supabase Storage UI
-- (private, 25MB limit) and add a storage policy allowing authenticated users
-- to SELECT/INSERT/DELETE on bucket_id = 'otm-credentials'.
