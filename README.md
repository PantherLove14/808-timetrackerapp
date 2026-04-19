# 808 Talent Source — Time Tracker & Operations Platform

Private operations platform for 808 Talent Source, LLC (a brand of Impctrs Management Group).

---

## What this is

A branded, multi-tenant time tracking and operations system with:

- **VA time tracker** with live timer, 10-minute idle detection, and one-manual-entry-per-month rule
- **Client portal** with retainer status, task creation, and approval workflow
- **Admin backend** for team, client, pay, requests, month lock, credentials, and audit log
- **Multi-business support** so one client contact can own multiple businesses
- **Task workflow** with attachments, audio instructions, threaded comments, and two-stage approval
- **Pay stubs** for VAs with base, bonus, deductions, and downloadable PDF
- **Weekly summary emails** you copy and paste into Gmail
- **Audit logging** of every sensitive action
- **Month lock** (immediate and scheduled) to close the books

Built on Supabase (Postgres + Auth + Storage + Row-Level Security) and React + Vite.

---

## 1. One-time Supabase setup

### 1.1 Create the project

1. Go to https://supabase.com and sign in.
2. Create a new project. Pick a strong database password (save it).
3. Pick a region close to your users (US East is fine).
4. Wait 2–3 minutes for provisioning.

### 1.2 Run the database migration

1. In the Supabase dashboard, open **SQL Editor** (left nav).
2. Click **New query**.
3. Open the file `supabase/migrations/20260419_000_initial_schema.sql` from this project.
4. Copy the entire contents and paste into the SQL editor.
5. Click **Run**.
6. You should see success (a few notices about triggers are normal).

### 1.3 Create the storage bucket for task attachments

1. In Supabase, open **Storage** (left nav).
2. Click **New bucket**.
3. Name: `task-attachments`
4. Public: **OFF** (keep it private)
5. File size limit: 100 MB
6. Click **Save**.

Then set up the storage policy so authenticated users can access their own task files:

1. Click on the `task-attachments` bucket.
2. Go to the **Policies** tab.
3. Click **New policy** → **For full customization** → **Get started quickly** → **Allow access to authenticated users only**.
4. Apply for SELECT, INSERT, and DELETE. Save each.

### 1.4 Grab your API keys

1. Supabase dashboard → **Project Settings** → **API**.
2. Copy the **Project URL** and the **anon public** key.
3. Keep these somewhere safe for step 2.2.

### 1.5 Create your first admin account

Because the app requires an admin to create users, you have to bootstrap your own admin account manually:

1. Supabase dashboard → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email: your personal email (the one you will log in with).
3. Password: set a strong temporary password.
4. Check "Auto Confirm User".
5. Click **Create user**.
6. Copy the UUID of the user you just created (the "ID" column).

Now insert the admin profile. SQL Editor → New query:

```sql
insert into public.users (id, name, email, role, active)
values (
  'PASTE-THE-UUID-HERE',
  'Tracy V. Allen',
  'your-email@example.com',
  'admin',
  true
);
```

Change the name and email to match. Run it.

You now have an admin account and can log in.

---

## 2. Running the app locally

### 2.1 Install Node.js

Check if you have Node:

```bash
node --version
```

You need v18 or higher. If not, install from https://nodejs.org (LTS version).

### 2.2 Install dependencies

From the project folder:

```bash
npm install
```

### 2.3 Set your environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Open `.env` and paste the values from step 1.4:

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

### 2.4 Run the dev server

```bash
npm run dev
```

Open http://localhost:5173 and sign in with the admin credentials from step 1.5.

---

## 3. Deploying to production

Recommended host: **Vercel** (free tier works for this). Alternative: Netlify, Cloudflare Pages.

### 3.1 Push the code to GitHub

1. Create a new **private** GitHub repo named `808-timetrackerapp`.
2. In this project folder:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/808-timetrackerapp.git
git push -u origin main
```

### 3.2 Deploy on Vercel

1. Go to https://vercel.com and sign in with your GitHub account.
2. Click **Add New → Project**.
3. Pick the `808-timetrackerapp` repo.
4. Framework preset: **Vite** (auto-detected).
5. Environment variables — add two:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
6. Click **Deploy**.

In about 2 minutes you'll have a `*.vercel.app` URL.

### 3.3 Connect your custom domain

1. In Vercel, open the project → **Settings** → **Domains**.
2. Add `timetrackerapp.808talentsource.com` (or your preferred subdomain).
3. Vercel will give you a DNS record to add. Options:
   - **CNAME**: `timetrackerapp` → `cname.vercel-dns.com`
4. Go to your DNS provider (likely wherever 808talentsource.com is hosted — GoHighLevel, Cloudflare, GoDaddy, etc.) and add the CNAME record.
5. Wait 5–30 minutes for DNS propagation. Vercel will auto-issue an SSL cert.

### 3.4 Lock down Supabase auth URLs

1. Supabase → **Authentication** → **URL Configuration**.
2. Site URL: `https://timetrackerapp.808talentsource.com`
3. Add Redirect URLs for both local dev and production:
   - `http://localhost:5173/**`
   - `https://timetrackerapp.808talentsource.com/**`

---

## 4. Operations runbook

### 4.1 Adding your team

1. Log in as admin.
2. **Team** tab → **+ ADD USER**.
3. Fill in name, email, and a temporary password.
4. Pick role (VA, Sub-Admin, or Admin).
5. Add HR fields (hourly rate, start date, birthday, emergency contact, children, etc.) for cards and gift tracking.
6. If VA, assign them to specific businesses.
7. Share the temporary password through a secure channel (not email). Tell them to change it on first login from their Profile page.

### 4.2 Adding clients and businesses

1. **Client Admin** tab → **+ ADD CLIENT**.
2. One client contact = one login. If they own multiple businesses, you add businesses under them after creating the client.
3. After creating the client, click **+ ADD BUSINESS** next to their card for each business they retain.
4. Set tier, monthly hours, monthly fee, rollover settings per business.

### 4.3 Month-end close

1. **Month Lock** tab.
2. Pick the month (e.g., March 2026).
3. Click **LOCK NOW** for immediate, or set a datetime for scheduled lock.
4. Run the rollover calculation by executing this in Supabase SQL Editor:

```sql
select compute_monthly_rollover('2026-03-01');
```

Change the date to the month you just closed. This creates rollover entries that carry unused hours (capped at 50%) into the next month.

### 4.4 Generating pay stubs

1. **Pay & Stubs** tab.
2. Pick the month.
3. Each VA shows hours worked and calculated base pay.
4. Click **GENERATE STUB** → review, add bonus/deductions/notes → **SAVE STUB**.
5. Click **Download PDF** to print or save the stub.
6. VAs see their own stubs in their portal. Clients never see this data.

### 4.5 Resetting a password

Two options:

**Option A (easiest):** Supabase dashboard → Authentication → Users → find the user → click **...** → **Send password recovery**. Supabase emails them a reset link.

**Option B (admin panel):** The Credentials Vault in the app attempts to use Supabase Admin API. This requires setting up a service role edge function (not yet built out). For now, use Option A.

### 4.6 Viewing the audit log

**Audit Log** tab shows every action: logins, task updates, time entry creates, user invites, lock/unlock events, credentials access. Export to CSV for record-keeping.

### 4.7 Backing up data

Supabase automatically backs up your database daily (paid tier) or you can manually export:

1. Supabase → **Database** → **Backups** (paid plans).
2. Or **SQL Editor** → run `pg_dump` commands via the Supabase CLI.
3. Or the simplest: in each admin table, hit **CSV export** buttons.

---

## 5. Known limitations and next steps

These are documented because they're real:

### 5.1 Admin user creation from the app

The app's "Add User" and "Add Client" buttons attempt to create Supabase auth users. This works in two modes:

- **Preferred (service role):** Requires a Supabase edge function with the service role key. Not yet built out. Without this, the app falls back to `signUp()` which may require email confirmation depending on your Supabase settings.
- **Current workaround:** Turn OFF "Confirm email" in Supabase → Authentication → Providers → Email. Users will be auto-confirmed. Or manually create auth users in the Supabase dashboard (like you did for yourself), then add the profile row.

To build the edge function later, you'll create `supabase/functions/create-user/index.ts` that uses the service role key and is invoked from the admin panel. Ask me when you're ready to add this.

### 5.2 Rollover automation

The `compute_monthly_rollover()` SQL function exists but is not auto-run. You either call it manually after closing a month (see 4.3) or set up a Supabase Cron (paid tier) to run it on the 1st of each month.

### 5.3 Email sending

The Weekly Summary page generates the HTML and opens your mail client (via mailto). Direct sending from the app requires a transactional email service (Resend, SendGrid, Postmark). Can be added in Phase 2.

### 5.4 Supabase Admin API calls from the browser

The Credentials Vault's "Reset Password" and some user-creation paths use `supabase.auth.admin.*`. These work only if the service role key is used (server-side). For production, move these calls to an edge function. See 5.1.

---

## 6. Security notes

- Passwords are stored in Supabase auth as bcrypt hashes. Nobody, including you, can see the actual password. The Credentials Vault shows emails and allows you to set new passwords, not to view existing ones.
- Row-Level Security policies enforce that VAs only see their assigned businesses, clients only see their own businesses, and all sensitive admin data is admin-only at the database level.
- Every sensitive action writes to the `audit_log` table.
- `.env` is in `.gitignore` — do not commit real API keys to a public repo.
- The footer's Privacy Policy, Terms of Service, and Acceptable Use links point to pages on 808talentsource.com. Make sure those pages exist before going live.

---

## 7. File structure

```
808-timetrackerapp/
├── supabase/
│   └── migrations/
│       └── 20260419_000_initial_schema.sql    # Full DB schema + RLS + triggers
├── src/
│   ├── components/
│   │   ├── BusinessSelector.jsx
│   │   ├── Logo.jsx
│   │   ├── Modal.jsx
│   │   ├── PageHeader.jsx
│   │   ├── RetainerCard.jsx
│   │   └── Shell.jsx                           # Topbar, nav, footer with legal
│   ├── hooks/
│   │   └── useAuth.js                          # Session & role resolution
│   ├── lib/
│   │   ├── format.js                           # Date, duration, money helpers
│   │   └── supabase.js                         # Client + audit logger
│   ├── pages/
│   │   ├── admin/
│   │   │   ├── AdminClientsPage.jsx
│   │   │   ├── AdminCredentialsPage.jsx
│   │   │   ├── AdminLockPage.jsx
│   │   │   ├── AdminPayPage.jsx
│   │   │   ├── AdminRequestsPage.jsx
│   │   │   ├── AdminTeamPage.jsx
│   │   │   └── AuditLogPage.jsx
│   │   ├── ClientsPage.jsx
│   │   ├── Dashboard.jsx
│   │   ├── LoginPage.jsx
│   │   ├── ProfilePage.jsx
│   │   ├── TaskDetailPage.jsx
│   │   ├── TasksPage.jsx
│   │   ├── TimeTrackerPage.jsx
│   │   ├── TimesheetsPage.jsx
│   │   └── WeeklySummaryPage.jsx
│   ├── styles/
│   │   └── index.css                           # Tailwind + brand CSS vars
│   ├── App.jsx                                 # Role-based router
│   └── main.jsx                                # Entry point
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
└── vite.config.js
```

---

## 8. Support

This is a privately-owned application. No outside support. When something breaks:

1. Check the audit log for what was just happening.
2. Check the browser console for errors.
3. Check the Supabase logs (Logs → API logs).
4. If you need to make changes, ask Claude in a new thread with enough context — share the file you want changed and the goal.

© 2026 808 Talent Source, LLC. A brand of Impctrs Management Group. All rights reserved.
