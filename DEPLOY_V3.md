# V3 Deployment Guide — 808 Talent Source Time Tracker

## What's in v3

This is a comprehensive bug-fix and feature-completeness pass. Everything that was broken or missing is now fixed.

### Fixed bugs

1. **OTMs can now create tasks** — RLS policy allows OTMs to insert tasks for businesses they're assigned to
2. **Add Client now works end-to-end** — edge function returns the new client_id directly so the UI never has to re-query
3. **Businesses now appear under clients** — RLS policies fully rebuilt; admins can see everything as expected
4. **Add Team Member modal now refreshes business list every time it opens** — no more stale "no businesses yet" when businesses exist
5. **Month lock display shows correct month name** — fixed timezone bug where April showed as March
6. **Date display fixed across the app** — same TZ bug eliminated everywhere
7. **Edit client + edit business** — both now have full field coverage

### New features

8. **Real conversation thread on every task** — chat-style messaging between admin/OTM/client with role-color-coded messages, alignment by sender, "you" labeling, and Cmd+Enter to send
9. **Unread comment badges on task cards** — see at a glance which tasks have new messages waiting for you
10. **Read receipts** — comments are marked read when viewed, badges update automatically
11. **Assign OTMs from the Client Admin page** — new "Assign OTMs" button next to each business
12. **OTM count column on Client Admin** — see at a glance which businesses have which OTMs
13. **Refresh buttons on Client Admin and OTM Team pages** — instant data refresh
14. **Visible load errors** — if RLS or network fails, you see why instead of empty state
15. **GoHighLevel iframe support** — proper CSP headers allow embedding the app inside GHL

---

## Deployment steps

### Step 1: Run the v3 SQL migration (3 min)

This SQL **fixes all the data-layer bugs** by rebuilding every RLS policy from scratch. Safe to run multiple times.

1. Supabase Dashboard → **SQL Editor** → New query
2. Open `supabase/migrations/20260420_v3_comprehensive_fix.sql` from this ZIP
3. Copy the entire contents → paste in the editor
4. Click **Run**
5. Click "Run this query" if you see the destructive operations warning
6. Wait for green Success

**Verify it worked:**

```sql
-- Should show 4+ policies for businesses table
select policyname from pg_policies where tablename = 'businesses';

-- Should return 3 (or more, depending on what's been added)
select count(*) from pg_policies where tablename = 'tasks';

-- Should return 1
select count(*) from pg_policies where tablename = 'task_comment_reads';
```

### Step 2: Re-deploy the create-user edge function (2 min)

The edge function code in v3 returns more useful response data and validates inputs better.

1. Supabase Dashboard → **Edge Functions** → click `create-user`
2. Click the **Code** tab
3. Open `supabase/functions/create-user/index.ts` from this ZIP
4. Copy entire contents
5. In the Supabase code editor: Ctrl+A, Ctrl+V to replace
6. Click **Deploy** at the bottom
7. After deploy completes, click the **Settings** tab and verify "Verify JWT with legacy secret" is **OFF**

**reset-password doesn't need updating** — it's unchanged from v2.

### Step 3: Replace local files (5 min)

Same drill as v2:

1. **Stop** any running `npm run dev` in PowerShell (Ctrl+C)
2. Open File Explorer → `C:\timetrackerapp`
3. **Delete:**
   - `src` folder
   - `supabase` folder
   - `package.json`
   - `index.html`
   - `README.md`
   - `tailwind.config.js`
   - `vite.config.js`
   - `postcss.config.js`
   - `DEPLOY_V2.md` (if present)
4. **KEEP:** `.env`, `.git` folder, `.gitignore`, `node_modules`, `public`, `package-lock.json`

5. **Unzip** `808-timetrackerapp-v3.zip` somewhere temporary
6. From the unzipped `808-timetrackerapp-v3` folder, **copy ALL contents** into `C:\timetrackerapp`
7. When Windows asks about replacing, click **"Replace the files in the destination"**

### Step 4: Push to GitHub (2 min)

PowerShell:

```
cd C:\timetrackerapp
npm install
git add .
git commit -m "v3: comprehensive bug fixes, OTM tasks, conversations, GHL embed support"
git push
```

### Step 5: Wait for Cloudflare auto-deploy (3 min)

Cloudflare Pages will rebuild and deploy automatically. Check the Deployments tab. When it shows green Success, hard-refresh the live site (Ctrl+Shift+R).

---

## Testing checklist

After deployment, run through these to verify everything works:

### As admin (you):
- [ ] Hard-refresh `https://timetrackerapp.808talentsource.com`
- [ ] Go to **Client Admin** — you should see Tracy V. Allen + her 3 businesses
- [ ] Click **"Assign OTMs"** on a business — you should see a list of OTMs to check
- [ ] Click **"Add Client"** — fill out the form — should create a client + first business and show you the temp password
- [ ] Go to **OTM Team** — open Add Team Member — the "Assign to Businesses" section should now list businesses
- [ ] Try uploading a credential to an existing OTM
- [ ] Go to **Tasks** — click "+ NEW TASK" — pick a business — assign it — should work
- [ ] Click on the task — leave a comment — should appear with green left border (you = "You")

### As OTM (sign out, log in as tvallen973@gmail.com):
- [ ] Should see the businesses you assigned them to in the header bar
- [ ] Go to **Tasks** — should see "+ NEW TASK" button (this is new in v3 — OTMs can now create tasks)
- [ ] Open the task you created — you should see the comment from admin with crimson left border
- [ ] Reply to the comment — should appear aligned right, marked "You"
- [ ] Sign out

### As client (sign in as tracy@tracyvallen.com):
- [ ] Should see business switcher with the 3 businesses
- [ ] Go to **Tasks** — see the task — open it
- [ ] Should see the conversation between admin and OTM
- [ ] Reply — should appear with navy left border
- [ ] If task is "submitted" status — should see Approve / Request Revision buttons

### Month lock (back as admin):
- [ ] Go to **Month Lock** page
- [ ] Schedule a lock for any month
- [ ] The "Active locks" section should show the **correct month name** (no more March-when-you-picked-April)

---

## Embedding in GoHighLevel

The app now sets proper CSP headers that allow embedding inside iframes from GoHighLevel domains.

### To embed:

In GHL, add a Custom HTML / iframe block with:

```html
<iframe
  src="https://timetrackerapp.808talentsource.com"
  width="100%"
  height="900"
  style="border: 0;"
  allow="microphone"
  title="808 Time Tracker">
</iframe>
```

The `microphone` permission is included so audio comments and voice notes still work inside the embed.

If you're embedding inside a custom domain that isn't `808talentsource.com` or a GHL domain, edit `public/_headers` to add your domain to the `frame-ancestors` directive, then redeploy.

---

## If anything doesn't work

Send a screenshot of:
1. The exact page where the bug shows up
2. The browser console (F12 → Console tab) — any red errors

The app now surfaces load errors at the top of admin pages instead of failing silently. If something is wrong with RLS or network, you'll see a "LOAD ERROR" panel telling you what.

---

## Files in this package

```
.env.example                                       # template
.gitignore
DEPLOY_V3.md                                       # this file
README.md
index.html
package.json                                       # dependencies
package-lock.json
postcss.config.js
public/
  _headers                                         # NEW: CSP for GHL embed
  ... (logo, favicon)
src/
  App.jsx                                          # routing wrapper
  main.jsx
  components/
    BusinessSelector.jsx                           # context + header bar + toasts
    Logo.jsx
    Modal.jsx
    PageHeader.jsx
    RetainerCard.jsx
    Shell.jsx                                      # nav + footer
  hooks/
    useAuth.js
  lib/
    businessColor.js
    constants.js                                   # BRAND, dropdowns
    format.js                                      # FIXED: timezone bug
    supabase.js
  pages/
    ClientsPage.jsx
    Dashboard.jsx
    LoginPage.jsx
    ProfilePage.jsx
    TaskDetailPage.jsx                             # FIXED: conversation thread
    TasksPage.jsx                                  # FIXED: OTM can create
    TimeTrackerPage.jsx
    TimesheetsPage.jsx
    WeeklySummaryPage.jsx
    admin/
      AdminClientsPage.jsx                         # FIXED: businesses display, assign OTMs
      AdminCredentialsPage.jsx
      AdminLockPage.jsx
      AdminPayPage.jsx
      AdminRequestsPage.jsx
      AdminTeamPage.jsx                            # FIXED: business list refresh
      AuditLogPage.jsx
  styles/
    index.css
supabase/
  functions/
    create-user/
      index.ts                                     # FIXED: returns ids in response
    reset-password/
      index.ts
  migrations/
    20260419_000_initial_schema.sql                # for reference / fresh installs
    20260420_v2_updates.sql                        # v2 schema additions
    20260420_v3_comprehensive_fix.sql              # NEW: rebuilds all RLS policies
tailwind.config.js
vite.config.js
```
