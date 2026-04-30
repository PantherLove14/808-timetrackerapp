# V6 DEPLOYMENT — SYSTEM-WIDE TASK + CHAT FIX

This release does the full system-wide upgrade, not patches. It applies to existing clients, existing OTMs, existing assigned tasks, and every new record going forward.

What v6 fixes (your 10-item list, mapped):

| Fix # | Your concern | What v6 does |
|---|---|---|
| 1 | Client-created tasks not handled correctly OTM-side | `list_otm_tasks` RPC returns assigned + unassigned-on-my-businesses; UI shows Claim button so OTM takes ownership |
| 2 | Time Tracker dropdown not picking up Client tasks | Time Tracker now uses the same expanded RPC so every reachable task appears |
| 3 | Start Task button missing | OTM cards now show: + CLAIM, then Start, In Progress, Submit, Resume, Withdraw |
| 4 | Existing users + records not updating | Migration backfills historical unassigned tasks to the single OTM on each business; flags clients with no auth login |
| 5 | Missing upgrades from older files | All v4 + v5 schema/RLS re-asserted idempotently |
| 6 | Cannot edit assigned tasks | EditTaskModal works for admin (full incl. reassign) and for assignee/creator (details, due date, priority, description) |
| 7 | True chat needed at every status | RLS open at every status; UI has no gate; conversation always renders; system messages auto-post on status changes |
| 8 | OTM-created tasks not on Client side | `list_client_tasks` RPC returns every task across every business they own, regardless of creator |
| 9 | Assigned OTM not auto-populating | `get_business_default_assignee` RPC + NewTaskModal pre-fills the assigned OTM the moment a business is picked |
| 10 | Profile photos in chat bubbles | Each comment now renders an Avatar bubble next to the message using the participant's actual photo (works for clients too — they upload via Profile page) |

Also: the v5 "structure of query does not match function result type" error you screenshotted is fixed — root cause was Postgres enums (`role`, `status`, `priority`) being returned without `::text` casts. Every RPC now casts.

---

## STEP 1 — PUSH THE REACT CODE

In PowerShell:

```powershell
cd C:\timetrackerapp
```

Unzip `timetrackerapp-v6.zip` over the project folder (let it overwrite). Files changed in v6:

| File | Action |
|---|---|
| `src/pages/TasksPage.jsx` | Replace |
| `src/pages/TaskDetailPage.jsx` | Replace |
| `src/pages/TimeTrackerPage.jsx` | Replace |
| `V6_SYSTEM_FIX_MIGRATION.sql` | NEW |
| `supabase/migrations/20260430_v6_system_fix.sql` | NEW |
| `DEPLOY_V6.md` | NEW |

`.env`, `node_modules`, etc. are not in the zip.

Verify locally (recommended):

```powershell
npm install
npm run build
```

Should print `✓ built in X seconds`. If it errors, send me the red output.

Commit and push:

```powershell
git add .
git commit -m "v6: system-wide task + chat fix"
git push origin main
```

Watch Cloudflare auto-deploy. ~90 seconds.

---

## STEP 2 — RUN THE SQL MIGRATION

Supabase → SQL Editor → New query → paste `V6_SYSTEM_FIX_MIGRATION.sql` → RUN.

You should see ONE result row at the bottom:

| status | v6_rpc_count | unassigned_open_tasks_remaining | clients_without_auth_login | realtime_tables_count |
|---|---|---|---|---|
| ✅ V6 MIGRATION COMPLETE - ALL CHECKS PASSED | 8 | 0+ | 0+ | 3 |

Reading the numbers:
- `v6_rpc_count` should be 8 (all the new RPCs landed)
- `unassigned_open_tasks_remaining` is how many open tasks are STILL unassigned after the auto-backfill. If it's > 0, that means those tasks live on businesses with zero or multiple OTMs, so the system can't safely guess who to assign — admin needs to assign manually OR the OTM needs to claim them via the Tasks page.
- `clients_without_auth_login` is how many active clients can't log in because their `auth_user_id` isn't linked. If > 0, fix in Admin → Client Admin.
- `realtime_tables_count` should be 3.

If you see a red `V6 FAIL: ...` row, send me the full error.

You should also see grey "NOTICE" lines like:
```
Backfill: auto-assigned 1 previously unassigned tasks to single-OTM businesses.
```
That's the system-wide upgrade applying to old data.

---

## STEP 3 — VERIFY REALTIME (skip if already done in v5)

Database → Replication → `supabase_realtime` → confirm `task_comments`, `task_attachments`, and `tasks` are toggled ON.

---

## STEP 4 — TEST IT

Hard refresh the live app (Ctrl+Shift+R) so the v5 JS gets dropped.

### Admin test list

1. Log in as admin. Top nav has the **Tasks** tab from v5. Click it.
2. The "Social Media" task on Happy Times that was hanging in v5 should now load when you click it. **No "structure of query" error**.
3. Open the task detail page. Scroll to Conversation. Each existing message now has the author's avatar next to it (or initials if no photo).
4. Type `@` in the composer — dropdown shows participants WITH avatars.
5. Click EDIT TASK. Reassign to a different OTM. Save. The system message "Tracy V. Allen assigned this task to X" appears in the conversation.

### OTM test list (the critical one for your fix list)

1. Log in as Last Chance (the OTM from your screenshot).
2. Click Tasks tab. **You should now see "Social Media" — even if it was created by the Client and assigned no one** — because Happy Times has Last Chance assigned, so list_otm_tasks pulls all unassigned tasks on that business.
3. The card shows "Unassigned" in warm gold and a `+ CLAIM` button.
4. Click `+ CLAIM`. Toast: "Task claimed. You are now the assignee." A grey system message appears in the conversation: "Last Chance claimed this task."
5. Now the same card shows your name as the assignee and a `Start` button. Click Start.
6. Click Submit when ready. Click Withdraw if you change your mind. Click Resume if Client requested revisions.
7. Open the Time Tracker tab. The dropdown now shows the task you just claimed.
8. **Chat at every status:** open the task, post a message in `todo`. Post another after Start. Post another after Submit. Post another after Approve. All four work — chat is always open.

### Client test list

1. Log in as Tracy@TracyVAllen's... (the Happy Times client).
2. Click Tasks. **Every task on Happy Times shows up**, including ones the OTM created.
3. Click + NEW TASK. Pick the business. **The OTM dropdown is auto-pre-filled with Last Chance** (the assigned OTM). A small subtitle reads "Pre-filled with Last Chance — the OTM assigned to this business."
4. Type a title, save. Open the task. Post a message: "Need this by Friday, here are the assets." Attach a file. Send.
5. The OTM (in another browser) sees the message in real time with your photo on it.
6. After the OTM submits, you see Approve / Request Revision buttons. Click Request Revision. The modal asks for a reason. Type, send.

### Two-browser realtime test

Open the same task in two windows: OTM in one, Client in the other. Type a message in either side. The other side gets it within 2 seconds without refresh. Each message has the sender's avatar.

---

## TECHNICAL NOTES

**The v5 query type error.** v5's `get_task_with_context` RPC declared the returned `creator_role` column as `text` but the SELECT pulled `cu.role` directly — and `users.role` is the `user_role` enum, not text. Postgres rejects implicit cast in `RETURN QUERY`. v6 explicitly casts every enum + text-domain column with `::text`. Same fix applied to `get_task_participants`, `list_admin_tasks`, plus the new `list_otm_tasks` and `list_client_tasks`.

**Why v5 only worked for "new" records.** v5 didn't actually have a "new vs old" gate — it just so happened that when admin created tasks via the new modal (after v5 deployed), they got an assignee. The Client-created tasks from before were created without an assignee, and the v5 OTM page only filtered by `assignee_id = me`, so those tasks vanished. v6's `list_otm_tasks` unifies both. The migration's auto-backfill assigns historical orphans where it's unambiguous.

**Why Client-created tasks didn't appear OTM-side.** Same root cause as above. The OTM Tasks page query in v4 was `where assignee_id = me`. If the Client created a task and the assignee dropdown didn't auto-populate (because the Client didn't pick anyone), the task was orphaned. Now: (a) the Client modal auto-pre-fills the OTM, and (b) even if it didn't, the OTM would still see it as Unassigned with a Claim button.

**RLS chat policy.** The `task_comments_insert` and `task_comments_select` policies are `is_admin() or is_task_participant(task_id)` — no status check. This was correct in v4 but the v4 UI gated chat behind specific states. v5/v6 UI always renders the conversation regardless of status. Anyone in the participant graph can post any message at any time.

**System messages.** Every status change posts an italic grey message: created, claimed, started, submitted, approved, revision requested, reassigned. Reads like a real project history.

**Realtime.** TaskDetailPage subscribes to `task:<id>` channel filtering on `task_id=eq.<id>` for `task_comments`, `task_attachments`, and `tasks`. Refreshes the local state on any insert/update/delete.

---

## ROLLBACK

Code: `git revert HEAD; git push origin main` — Cloudflare reverts in 90 sec.
DB: v6 only adds + reassigns; never drops. v4/v5 code runs fine against v6 schema. No DB rollback needed.

---

## QUESTIONS WHILE TESTING?

Tell me:
- Screenshot of any red error
- Which step in the test list misbehaved
- Which role (admin / OTM / Client) and which user

I'll diagnose.
