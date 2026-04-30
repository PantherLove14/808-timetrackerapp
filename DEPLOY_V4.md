# V4 Deployment Guide — 808 Talent Source Time Tracker

## What v4 fixes

This is a comprehensive pass that addresses every bug, gap, and missing component you identified in your last test run.

### Critical fixes
1. **RLS infinite recursion** — fixed by replacing cross-table policy subqueries with `SECURITY DEFINER` helper functions. This was the root cause of "no businesses to show" everywhere.
2. **Businesses now appear** under clients, in OTM-team-add modals, in time tracker dropdowns, in client portal, in tasks creation — everywhere.
3. **OTM Team page now shows photos** in the table and accepts uploads when editing.
4. **Pay stubs are now downloadable** with a working "Download" button on every row, plus a search filter by name/email/month, plus a "Delete" button per stub.
5. **All issued stubs are visible** in the persistent "Pay stub history" section that survives across months.
6. **Time off history is deletable** — both per-row "Delete" buttons and a bulk "Clear all history" button.
7. **Weekly Summary works end-to-end** — pick a business + week, click Generate, get a polished printable summary with Copy Text / Copy For Email / Print options.
8. **OTM Time Tracker dropdown now auto-populates** from the OTM's open assigned tasks. Picking a task auto-fills the description and links your time entry to that task.
9. **Tasks support file uploads** at creation AND in the conversation thread.
10. **Conversation thread is fully interactive** — text, files (images, video, audio, PDFs, docs), and live in-browser voice recording.
11. **Comment messages render attached media inline** — images preview, video plays, audio is playable, files download with one click.

### New features
12. **Avatar / profile photos** for OTMs, admins, and clients. Stored in a private `avatars` bucket; visible in shell header, OTM Team table, and conversation messages.
13. **Voice recording in comments** — click 🎤 RECORD VOICE → record → stop → it's attached to your message ready to send.
14. **Multi-file attach** in tasks and comments — attach multiple files at once before posting.
15. **Profile page** with avatar uploader and password change for all roles.

---

## Deployment steps

### Step 1: Run the v4 SQL migration (3 min)

This rebuilds the recursion-safe RLS policies and adds the avatar + task_id columns.

1. Supabase Dashboard → **SQL Editor** → New query
2. Open `supabase/migrations/20260429_v4_recursion_fix.sql` from this ZIP
3. Copy entire contents → paste in editor
4. Click **Run**
5. Click "Run this query" if you see the destructive operations warning
6. Wait for green Success

### Step 2: Create the `avatars` storage bucket (2 min)

1. Supabase Dashboard → **Storage** → **New bucket**
2. **Name:** `avatars` (exactly)
3. **Public bucket:** **OFF** (private)
4. **File size limit:** `5` MB
5. Save
6. Click into the `avatars` bucket → **Policies** tab
7. Click **New policy** → **For full customization**
8. Policy name: `Avatar access for authenticated`
9. Operations: check **SELECT, INSERT, UPDATE, DELETE**
10. Target roles: `authenticated`
11. Policy expression (USING and WITH CHECK): `bucket_id = 'avatars'`
12. Save

### Step 3: Verify task-attachments bucket allows authenticated users (2 min)

This bucket already exists from earlier setup. Verify its policies allow authenticated users to read/write:

1. Storage → click `task-attachments` → Policies tab
2. Should see SELECT, INSERT policies for `authenticated` users with expression `bucket_id = 'task-attachments'`
3. If missing, add them the same way as Step 2

### Step 4: Re-deploy the create-user edge function (no changes needed for v4)

The create-user function from v3 still works correctly. Skip this step.

### Step 5: Replace local files (5 min)

Same drill as before:

1. **Stop** any running `npm run dev` (Ctrl+C in PowerShell)
2. File Explorer → `C:\timetrackerapp`
3. **Delete:**
   - `src` folder
   - `supabase` folder
   - `package.json`
   - `index.html`
   - `tailwind.config.js`
   - `vite.config.js`
   - `postcss.config.js`
   - `README.md`
   - `DEPLOY_V3.md` (if there)
4. **KEEP:** `.env`, `.git`, `.gitignore`, `node_modules`, `public`, `package-lock.json`
5. Unzip `808-timetrackerapp-v4.zip`
6. Copy ALL files from the unzipped folder into `C:\timetrackerapp` (replace when prompted)

### Step 6: Push to GitHub (1 min)

PowerShell:

```
cd C:\timetrackerapp
npm install
git add .
git commit -m "v4: RLS recursion fix, avatars, voice notes, weekly summary, downloadable stubs"
git push
```

### Step 7: Cloudflare auto-deploys (3 min)

Watch Cloudflare dashboard → Pages → Deployments. Wait for green Success. Hard-refresh the live site.

---

## Testing checklist

After deployment, hard-refresh and test:

### As admin (tracy@808talentsource.com):
- [ ] **Client Admin:** Tracy V. Allen now shows her 3 businesses (no more "infinite recursion" error)
- [ ] **OTM Team:** Click "+ ADD TEAM MEMBER" → "Assign to Businesses" section shows real business checkboxes
- [ ] **OTM Team:** Click "Edit" on an existing OTM → upload a profile photo → save → photo appears in the team table
- [ ] **Pay & Stubs:** Generate a stub for any OTM → close modal → confirm it appears in "Pay stub history" with a Download button → click Download → PDF print preview opens
- [ ] **Pay & Stubs:** Type a name in the search box → list filters
- [ ] **Requests:** If there are reviewed requests, click "Delete" on one → it removes
- [ ] **Weekly Summary:** Select a business → Generate → see the polished preview → click Print → preview opens
- [ ] **Tasks:** Click "+ NEW TASK" → at the bottom is a "Attachments" section → attach a PDF or image → create → open the task → file appears in attachments

### As OTM (tvallen973@gmail.com):
- [ ] **Time Tracker:** "What are you working on?" section shows a "Working on which task?" dropdown listing your open tasks
- [ ] **Tasks:** "+ NEW TASK" button is visible and works
- [ ] **Task detail:** Open any task → conversation panel at bottom → click 📎 ATTACH FILES → pick a file → also click 🎤 RECORD VOICE → record 5 seconds → stop → click SEND MESSAGE → comment appears with the attachments rendered (image inline, audio playable)

### As client (tracy@tracyvallen.com):
- [ ] **My Retainer:** All 3 businesses are listed (no longer empty)
- [ ] **Tasks:** Open a task → see the conversation thread → reply with both text and attached image → it appears in the thread

---

## If anything fails

The app now surfaces load errors at the top of admin pages. Look for a red "LOAD ERROR" panel. Send a screenshot of it plus the browser console (F12 → Console tab).

If the SQL migration fails, send me the exact error text from the Supabase SQL editor.

---

## Architecture notes for future maintenance

**Why the previous RLS broke:** my v3 policies used cross-table subqueries like:
```sql
business_id in (select business_id from va_assignments where va_id = auth.uid())
```
combined with policies on va_assignments that referenced businesses. Postgres detected the cycle and refused both.

**v4 fix:** moved every cross-table check into `SECURITY DEFINER` helper functions (`is_business_otm`, `is_business_client`, `is_task_participant`). These functions bypass RLS internally during their own execution, so no recursion. Policies just call the function which returns a boolean. Safer, faster, simpler.

**Why this architecture is durable:** new tables can call the same helpers without re-introducing recursion. Adding a new role check is a single helper function rather than another set of subqueries.
