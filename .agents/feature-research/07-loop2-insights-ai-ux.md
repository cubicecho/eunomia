# 07 — Loop 2: Insights, AI, UX & Sharing

Research date: 2026-09-12. Builds on 01 (Eunomia inventory), 02/03/04 (competitors). Focus: *how* the best
products do timeline UX, categorization, metrics, goals, AI, sharing and onboarding — and what fits
Eunomia's data model. Effort: **S** ≤ a few days, **M** 1–2 weeks, **L** multi-week / new subsystem.

---

## 0. The data-model constraint that shapes almost everything below

Eunomia stores **activities** keyed by `(device, app, context)` with `startedAt`, `lastActiveAt`,
accrued `activeSeconds`, and `closedAt` (auto-close after 15 min unfocused), plus daily **summaries**
(`apps/server/src/db/schema.ts`). Because activities are *multi-open*, an IDE↔browser hour is two rows
whose spans overlap — great for totals, but it means Eunomia **cannot currently answer**:

- "What was on screen at 14:32?" (no focus intervals → no true timeline)
- "How many times did I switch?" / "longest uninterrupted stretch?" (no switch events → no focus metrics)
- "What did I do between 10:00 and 11:30?" (spans overlap; only whole-row seconds)

Every competitor feature in §1, §3 and much of §5 depends on ordered focus intervals.

**Recommendation (foundation, M):** add a `focus_segments` table written by `fold.ts` — one row each
time the focused `(app, context)` changes or idle begins/ends: `(deviceId, activityId, startedAt, endedAt,
seconds)`. This is one row per *switch*, not per ping (the agent already pings on app/title change), so
volume is modest (Rize reports ~559 switches/day for an average user — ~200k rows/user/year, pruned
with `ACTIVITY_RETENTION_DAYS` like activities). Optionally roll to an hourly table
`(device, hourStart, app, context, category, seconds, switches)` for fast hour-of-day charts after raw
pruning. Everything below marked *(needs segments)* depends on this.

---

## 1. Timeline / day view UX

### How the best do it
| Product | What it looks like | Actions on the timeline |
| --- | --- | --- |
| **ManicTime** | Day view with stacked horizontal **swimlanes**: Computer usage (active/away), Tags, Applications, Documents/URLs, screenshots. Grey boxes = **untagged active time**. | Drag across lanes to select (snaps to activity boundaries), Ctrl-drag for multi-select, double-click a block to select it + auto-filter, checkboxes in the summary grid below. Modes **"Select all" / "Select only untagged" / "Show only untagged"** prevent double tagging. Then tag / edit / delete tags. Advanced search → "show only untagged activities" across any period. ([selecting time](https://docs.manictime.com/win-client/selecting-time), [blog](https://blog.manictime.com/articles/2025-nov/selecting-time/)) |
| **Timing** | Vertical day timeline; coloured project blocks with a "+" = *suggested* time entry; optional AI summary text inside each block. Separate **Review** screen with activity list grouped by app/path/URL. | Click-drag a range → create entry; double-click suggestion to accept (⌥ to put AI summary in notes); −5/+5 m / prev / next boundary nudges; right-click delete. **⌥-drag an activity onto a project = create a rule** (only from Review). ([reviewing your day](https://timingapp.com/help/2-reviewing-your-day), [projects & rules](https://timingapp.com/help/3-projects-and-rules)) |
| **ActivityWatch** | Timeline view: vis-timeline swimlanes per bucket (window, afk, web, editor per host), day ±1; recent "keep zoom anchored to cursor". Newer chronological timeline in Activity view (PR #380). | View only — no select-to-categorize. Long-standing request for Gantt-like lanes + infinite scroll ([aw-webui #50](https://github.com/ActivityWatch/aw-webui/issues/50)); complaints about performance with many events (#516). |
| **Toggl Track** | Desktop **Timeline** lane next to the calendar of time entries; records apps/sites >10 s, private to the user. | Click a pill → details (duration, active time, apps list) → **"copy as time entry"**; double-click empty area to create. Users ask for "create entry from *selected* activities" and hiding already-tracked portions ([community](https://community.toggl.com/t/new-timeline-autotracked-features-create-specific-time-entry-from-selected-activities-separate-pills-based-on-tracking-portions-hide-portion-of-pill-already-tracked/2387), [KB](https://support.toggl.com/en-us/article/the-timeline-feature-1txzwm1/)) |
| **Rize** | Day calendar with automatic **sessions** (focus / meeting / break) as blocks; pending AI-drafted entries in a docked **review inbox**. | Approve/reject/edit drafted entries; docs recommend a *daily inbox review* to train accuracy ([FAQ](https://docs.rize.io/getting-started/faq)). |
| **Memtime** | Zoomable timeline in 5/6-minute increments per day. | Drag blocks into time entries for 100+ tools. |

**Praise:** seeing the day "as it happened" is the #1 trust builder (you can verify the tracker). Rule-from-timeline
(Timing) and untagged-only selection (ManicTime) are the most-cited power features.
**Complaints:** ManicTime dense/dated; ActivityWatch timeline slow and view-only; Toggl can't act on a multi-selection.

### Recommendation for Eunomia
1. **Day view page** (M, *needs segments*): x-axis = hours (default to the day's first→last activity, not 00–24),
   one **lane per device** plus an optional merged "all devices" lane; blocks coloured by category, label =
   app · context; hover = title, seconds. Zoom via range brush (hour → 15 min). Idle gaps rendered as empty,
   not "away". Keep it canvas/SVG with blocks merged below a pixel threshold to avoid the AW perf trap.
2. **Select-a-range → act** (M): drag-select a range (across lanes) → side panel listing the `(app, context)`
   entries in the selection with seconds → actions: **Assign category** (manual, `assignActivity` already
   exists — it just needs UI), **Create rule from this** (pre-filled app/context regex, escaped, with the
   existing live preview), **Merge entry**. Defer "delete time" until activity deletion exists (S–M extra;
   requires summary adjustment like category moves).
3. **Uncategorized review queue** (S, no segments needed): a card/tab "Uncategorized — 3 h 12 m this week"
   listing uncategorized `(app, context)` sorted by seconds, each row with category chips (one click = rule
   `^app$` + context) and "ignore/mark neutral". This is the highest ROI UX item: it converts the regex
   editor into a triage flow and works on summaries alone.
4. Avoid "convert to time entry" until/unless manual entries/projects exist (not a timesheet tool — see 04).

---

## 2. Reducing categorization setup fatigue

### How the best do it
- **Qbserve** ships a pre-classified database of **~8,100 sites, apps and games** as Productive / Neutral /
  Distracting, and distinguishes Slack teams, subreddits, YouTube videos; users reclassify
  ([qotoqot](https://qotoqot.com/qbserve/)).
- **RescueTime**: global default productivity level per activity, inherited from category, overridable; its
  own docs admit defaults misfire (marketer on Facebook) and custom/internal web apps land in
  "Uncategorized" ([help](https://help.rescuetime.com/article/83-what-are-reasonable-numbers-for-productivity-pulse)).
- **ActivityWatch**: hierarchical categories with a small default set (Work/Programming, Media/Games/Video/Social,
  Comms…) — the defaults are thin and "barebones on first run" is a top complaint; issue #174 notes the
  pitfalls of defaults: non-unique app names (Files, Navigator), app names appearing inside titles, overly
  broad regexes being *worse* than uncategorized ([#174](https://github.com/ActivityWatch/aw-webui/issues/174)).
  0.14 adds **field-scoped rules**, a **priority** field and **preset category sets**.
- **Timing**: rules over keyword/domain/URL/path/title/app/device/time-of-day/day-of-week with nested
  Any/All; **first matching project wins, reorderable**; rules are **not retroactive by default** — explicit
  "re-apply rules to date range" that preserves manual assignments; ⌥-drag creates rules; auto-rule suggested
  when a project name matches ([rules in depth](https://timingapp.com/help/rules)).
- **ManicTime AutoTags**: wildcard/regex with capture groups (extract project code from a path), retroactive,
  "absorb" (generic tools inherit surrounding tag), auto-fill small gaps.
- **Rize**: on sign-up, **creates categories and rules from your job title**; AI tagging with confidence
  threshold + custom instructions; **Sept 4 2026 deprecated categories** in favour of AI **labels** on entries
  plus a single "App & Website Rules" page where each app is marked focus / meeting / idle / do-not-track /
  blocked ([changelog](https://rize.io/changelog/deprecating-categories)). Complaints: setup "annoying",
  AI categorization metered by credits.
- **Cronus**: no rules — onboarding asks your projects/goals; an LLM classifies *relative to goals*
  (LinkedIn for recruiting = work, doom-scroll = distraction); **redaction on device**, classification on their
  servers ([how it works](https://cronushq.com/blog/how-cronus-works-complete-guide-ai-productivity-tracker)).
- **Local LLM precedent**: `aw-llm-worker` classifies ActivityWatch 30-min windows via LLM
  ([GitHub](https://github.com/Srakai/aw-llm-worker)); Dayflow runs Ollama/LM Studio locally. Low-temperature,
  constrained-output zero-shot classification is well-trodden.

**Pattern:** best UX = good defaults + one-click correction that generalizes into a rule + (optionally) AI that
*proposes* rules/assignments the user approves. Pure AI (Cronus/Rize labels) removes setup but costs trust,
money, and privacy; pure regex (AW, Eunomia today) is precise but empty on day one.

### Recommendation for Eunomia
Eunomia already has priority-ordered, field-scoped (app/title/context), retroactive (`applyCategoryRules`),
manual-override-safe rules — i.e. it's *ahead* of AW and Timing on mechanics. The gap is content + flow.
1. **Starter rule pack** (S–M): a versioned JSON pack in the repo (`packages/rule-packs/`) — ~8–12 categories
   (Development, Communication, Meetings, Docs/Writing, Design, Browsing-Reference, Social, Video/Entertainment,
   Games, Shopping, System/Utilities) with *anchored* rules on exec names (Win/Linux/mac variants), Android
   package names, and hostnames (contexts). Offered at first run and in Categories tab ("Import pack →
   preview N matches against your last 7 days → apply"). Store `source: 'pack:<id>@<ver>'` on rules so packs can
   be updated without clobbering user edits. Seed from AW defaults + a few hundred top apps/domains; community PRs grow it.
   Heed AW #174: match `^exact$` on app, hostname suffix on context, never bare words on title.
2. **Uncategorized queue + one-click rule** (S) — §1.3. Also "Create rule" from top-apps rows on the dashboard.
3. **Category edit/rename + optional parent** (S) — currently missing; hierarchy only if cheap.
4. **LLM-suggested categorization, opt-in, BYO endpoint** (M): server setting `LLM_BASE_URL`/`LLM_MODEL`
   (OpenAI-compatible → works with Ollama, LM Studio, vLLM, or a cloud key). Batch job takes the top-N
   **uncategorized `(app, context)` pairs only** (no titles by default; titles opt-in per user), plus the user's
   category names and a few example rules, and returns *suggested rules* (JSON schema-constrained) into the
   review queue with "why". Never auto-applies; user accepts → normal rule. Respects `redactApps` (redacted rows
   have no title/context anyway). This is the privacy-preserving middle: Eunomia's rules stay deterministic and
   explainable; the LLM only drafts them. Avoid per-activity LLM classification (cost, nondeterminism, rollup churn).
5. Optional later: "goal-relative" categories (Cronus) — skip; conflicts with deterministic rollups.

---

## 3. Productivity / focus metrics

### Formulas in the wild
- **RescueTime Productivity Pulse** = `((D·0 + P·1 + N·2 + OW·3 + FW·4) / (total·4)) · 100` over levels
  Distracting / Personal / Neutral / Other Work / Focus Work ([help](https://help.rescuetime.com/article/73-how-is-my-productivity-pulse-calculated)).
  Simple and explainable, but RescueTime itself concedes it's a *value judgement* that differs per person;
  it rewards classification, not outcomes.
- **Rize Focus Time**: a 15-minute window counts as focus if **≥75%** of it is in focus-eligible apps;
  **Focus Quality Score** /100 from 20+ attributes (switch frequency, distracting apps, session length, focus
  time/day); sessions without app-switching or idle gaps = deep work; Weekly Productivity Assessment
  ([FAQ](https://docs.rize.io/getting-started/faq), [productivity](https://rize.io/features/productivity),
  [context switching data](https://rize.io/blog/the-hidden-cost-of-context-switching)). Opaque composite.
- **Hubstaff Insights**: focus session = **≥30 min** on one project/task uninterrupted
  ([support](https://support.hubstaff.com/hubstaff-insights-add-on/)).
- **Microsoft Viva Insights**: legacy "focus hours" = blocks **≥2 h** between meetings; new platform splits
  **Uninterrupted / Interrupted / Fragmented hours** ([metric changes](https://github.com/MicrosoftDocs/viva/blob/public/Viva/insights/advanced/reference/metric-improvements.md)).
- **Monitoring tools (Hubstaff/Time Doctor activity %)**: input-based — widely resented, gamed by mouse
  jigglers (see 03 §3). Anti-pattern for Eunomia.

### Valued vs gimmicky (synthesis of reviews/forums)
- **Valued:** total tracked time and trend vs last week; time per category/project; *longest uninterrupted
  stretch* / deep-work blocks per day; context switches per hour (as a *diagnostic*, shown with top
  interrupters); meeting load; after-hours / weekend work (burnout signal); first/last activity of the day.
- **Gimmicky or contested:** single 0–100 composite scores without explanation (Rize FQS opaque, Pulse
  contested); gamification streaks; cross-user benchmarks; activity %.

### Recommendation for Eunomia (all *explainable*, all show their formula in a tooltip)
1. **Category "kind" instead of a score first** (S): add optional `kind` to categories — `focus | work | neutral | personal | distracting`
   (RescueTime's 5 levels). Unlocks Pulse (computable today from summaries: pure SQL over `categorySummary`)
   and goals. Show Pulse as a secondary number, not the hero.
2. **Trends** (S): week-over-week deltas on stat tiles; category-over-time line (AW's #1 requested view).
3. **Work pattern stats** (S–M): first/last active time per day, after-hours seconds (configurable work hours,
   per-user TZ needed eventually), weekend share. First/last is possible from activities today (`min(startedAt)`,
   `max(lastActiveAt)`) until pruned.
4. **Deep-work blocks & fragmentation** (M, *needs segments*): define a **focus block** = maximal run of segments
   in `focus|work` categories where no interruption (non-focus segment or idle) exceeds a grace of **60–120 s**
   and total ≥ **25 min** (configurable; Hubstaff uses 30). Report: deep-work hours/day, longest block, count.
   **Switches/hour** = focused-`(app,context)` changes where the new segment lasts ≥ 5–10 s (debounce alt-tab
   noise; count app-level switches separately from context-level). **Top interrupters** = apps/contexts that most
   often start a segment that ends a focus block.
5. **Meeting time** (S–M): simplest robust path is a "Meetings" category in the starter pack (zoom, teams,
   meet.google.com, slack huddle titles) — note idle detection would drop meeting time where no input occurs;
   flag rule/category as "counts while idle" would need agent/fold support (M). Calendar integration = L, defer.
6. **Don't** ship a 20-attribute composite; if a single score is wanted, use Pulse (documented) or
   "deep-work share = deep-work seconds / work seconds".

---

## 4. Goals, limits, alerts, digests, focus/blocking

### How the best do it
- **RescueTime**: unlimited goals ("≥ N h Focus Work", "≤ N h Distracting"), instant **alerts**; alerts can
  *trigger* a FocusTime session (e.g. after 30 min distracting); **Focus Zones** predicted from history appear in a
  Morning Forecast; FocusTime blocks Personal/Distracting sites with a block page offering *start session /
  continue anyway / turn off* ([focus settings](https://help.rescuetime.com/article/377-focus-settings),
  [blocking](https://help.rescuetime.com/article/337-how-do-i-block-activities-during-a-focus-session)).
  Weekly email = time distribution, goal progress, daily highlights ([goals reporting](https://help.rescuetime.com/article/125-reporting-on-your-goals-and-progress)).
- **Rize**: automatic focus/meeting/break sessions; smart break reminders; "session ending in 5 min"
  notification; **Distraction Blocker** fires after a configurable threshold on a distracting app/site, as a
  window or system notification, optional **10-s "urge surfing"** undismissable delay
  ([blocker docs](https://docs.rize.io/distraction-blocker/configure-distraction-blocker)).
- **ActivityWatch `aw-notify`**: category thresholds with `positive=true` ("Goal reached!") or `false` ("Time
  spent"), hourly check-in and end-of-day summary notifications; advice to start with long thresholds because
  too many notifications backfire. AW deliberately doesn't block — points users to Cold Turkey/LeechBlock
  ([aw-notify](https://github.com/ActivityWatch/aw-notify)).
- **Wakapi / WakaTime**: weekly email reports; coding-time goals (Wakapi goals is a requested issue).
- **Blocking tools** (03 §5): bypasses, VPN battery drain on mobile, "binge after session". Android Digital
  Wellbeing already provides app timers and Focus mode for free.

### Recommendation for Eunomia
1. **Goals** (S–M): per-user `goals(categoryId|kind, direction at_least|at_most, seconds, period day|week, daysOfWeek)`.
   Progress computed from summaries (live-merged) — dashboard progress bars + GraphQL/MCP query. No agent change.
2. **Weekly (and optional daily) email digest** (M): SMTP already exists for magic links; rollup scheduler exists.
   Content: total vs last week, top categories with deltas, top 5 apps/contexts, goals hit/missed, deep-work hours
   (once segments land), uncategorized time with a "triage" link. Per-user opt-in + send day/hour; must
   respect per-user TZ (currently server TZ — note limitation). Plain-text + minimal HTML.
3. **Threshold notifications** (M): server evaluates goals on each rollup tick / ping batch and exposes
   `pendingNotifications`; the desktop tray agent and Android app poll on sync and show native notifications
   (Electron `Notification`, Expo notifications). Keeps logic server-side and cross-device ("2 h Social across
   phone + laptop"), which no local-first tool can do — a genuine differentiator. Optional webhook/ntfy/Gotify
   target (S) — very popular with self-hosters.
4. **Break reminders** (S, desktop agent-local): "continuous active > N min" from local idle data. Low priority.
5. **Blocking: don't build it** (recommend explicit non-goal). Enforcement is a separate hard problem, OS-specific,
   and bypass complaints dominate that category; it also shifts Eunomia's positioning from "honest mirror" to
   "enforcer". Instead: (a) nudges (notification when an at-most goal is crossed), (b) document pairing with
   Cold Turkey/LeechBlock/Digital Wellbeing, (c) expose goal state over API/webhook so users can script blockers.

---

## 5. AI features in 2026 trackers

### Survey
| Product | AI features | MCP tools / write access | Model |
| --- | --- | --- | --- |
| **Timing** | AI summaries per timeline block & day; suggestions with AI titles | **14 tools** over OAuth (Connect plan + Sync): read `get_activity_hierarchy`, `list_projects`, `show_project`, `list_time_entries`, `show_time_entry`, `show_latest_time_entry`, `show_running_timer`; write `create/update/delete_project`, `create/update/delete_time_entry`, `batch_update_time_entries`, `start/stop_timer`; destructive ops may prompt for confirmation ([MCP help](https://timingapp.com/help/mcp)) | Summaries via **OpenAI**, opt-in, data deleted after 30 d, not used for training ([AI summaries](https://timingapp.com/help/ai-summaries)); MCP = your client's model |
| **ManicTime** | MCP turns raw activity into tagged, timesheet-ready entries | Desktop (2026.1) local MCP: timelines, activities, summaries, groups, tags, screenshots, current date/time, total duration; **write: tags only**. Server/Cloud (2026.2/Apr): + users & teams ([docs](https://docs.manictime.com/ai-mcp-server/desktop), [blog](https://blog.manictime.com/articles/2026-feb/ai-automatic-time-tracking-manictime-mcp/)) | BYO client (Claude, ChatGPT, Copilot, Codex) |
| **Rize** | AI tagging w/ confidence, AI entry descriptions, AI chat, automations; credits-metered | `https://mcp.rize.io/mcp` OAuth; **Pro = read-only personal**; Team/Enterprise = read-write incl. approving drafted entries, profitability, workload ([MCP](https://rize.io/features/mcp)) | Hosted |
| **Screenpipe** | pipes (day recap, standup, meeting notes), search memory | MCP: search screen/OCR, audio transcripts, input events, frames, **raw SQL**, video export ([docs](https://docs.screenpipe.com/mcp-server)) | Local Ollama or cloud |
| **Dayflow** | timeline cards, daily/weekly summary, chat, **one-click standup** (yesterday highlights, today priorities, blockers) | — | Local Ollama/LM Studio or BYO Gemini/ChatGPT/Claude ([README](https://github.com/JerryZLiu/Dayflow)) |
| **ActivityWatch 0.14** | client-side AI summary page; community MCP servers incl. category read/write | community | BYO |
| **Timely** | AutoSheet / AI Timesheet Assistant drafts entries (3 styles) | — | Hosted |
| **Clockify (community)** | — | e.g. 112-tool MCP with **3-tier access model: read / time-tracking / full** ([clockify-mcp](https://github.com/tracegazer/clockify-mcp)) | BYO |

**Patterns:** (1) MCP is now table stakes; (2) *read-only by default, scoped writes by tier* (Rize Pro read-only,
ManicTime writes only tags, Clockify 3 tiers, Timing confirmation on destructive); (3) OAuth for remote MCP;
(4) BYO/local model is praised, metered credits resented; (5) "summaries + standup" are the most-used AI outputs.

### Recommendation for Eunomia
Eunomia's `/mcp` projects every GraphQL query — powerful but generic. Improvements, in order:
1. **Purpose-built read tools** (S): the auto-projected tools are table-shaped (`activities(where, orderBy…)`),
   which LLMs misuse. Add a few SDL queries designed for agents, which the projector exposes automatically:
   `daySummary(date)` (totals, categories, top apps/contexts, first/last active, uncategorized), `compareRanges(a, b)`,
   `searchActivity(text, from, to)` (app/context/title ILIKE), `timeline(date, deviceId)` (*needs segments*),
   `goalsProgress`, `uncategorized(from,to)`. Good descriptions matter more than count. Consider hiding the raw
   generated table readers from MCP (tool-list noise) via an allowlist if `graphql-mcp` supports one.
2. **Scoped write tools, opt-in per API key** (M): add key permission scopes `read` (default) / `categorize`
   (createCategory, create/updateCategoryRule, assignActivity, applyCategoryRules, createMergeRule, goals). Never
   expose login/device/ingestion mutations. Mirrors ManicTime "tags only" and Clockify tiers. This makes the
   killer workflow possible: *"look at my uncategorized time this week and propose + create rules"* using the
   user's own Claude/ChatGPT — zero LLM infra in Eunomia. Consider `dryRun: true` args that return a preview
   (reuse rule live-preview) so agents show before writing.
3. **MCP prompts/resources** (S): ship MCP prompts `standup` (yesterday by context/project, today so far),
   `weekly-review`, `triage-uncategorized` — cheap, and they make BYO-client AI feel like a feature.
4. **Built-in AI via OpenAI-compatible endpoint, opt-in** (M): same `LLM_BASE_URL` setting as §2.4 powers
   (a) rule suggestions, (b) daily summary text in the dashboard / weekly digest, (c) standup draft button.
   Send aggregates (app/context/category seconds + time bands), **not titles** unless the user opts in; document
   exactly what leaves the server; default off. Local Ollama as the documented happy path.
5. **"Chat with your data" in the dashboard** — skip (L); MCP + the user's existing assistant already covers it.
6. **Remote MCP auth**: API keys work for Claude Code/Desktop config; OAuth (better-auth has an MCP/OIDC
   provider plugin) would enable claude.ai/ChatGPT connectors (M) — worth checking later.

---

## 6. Privacy-respecting sharing & teams

### Models in the wild
- **Timely**: raw Memory timeline **private to the individual**; managers see only entries the user logs/approves
  ([Timely privacy](https://www.timely.com/privacy-at-timely/)). Canonical ethical split.
- **Timing for Teams**: admins see **only aggregate time on team projects**; never which apps/docs/sites;
  private projects invisible; roles Administrator / Contributor / Restricted
  ([teams admin](https://timingapp.com/help/teams-admin), [FAQ](https://timingapp.com/help/teams-faq)).
- **Rize Team**: admins see only entries tagged to team clients/projects.
- **solidtime desktop (May 2026)**: activity stays **local** until converted into an entry
  ([blog](https://www.solidtime.io/blog/activity-tracking-and-idle-detection)).
- **Memtime**: data only on device, "cannot be used for monitoring" as positioning.
- **WakaTime**: embeddable charts/JSON via **one-time unique URL, retractable**; public profiles/leaderboards opt-in
  ([share](https://wakatime.com/share), [FAQ](https://wakatime.com/faq)).
- **Clockify / Toggl**: saved reports shareable by **public read-only link**, with **"lock dates"** so viewers
  can't browse other ranges; export PDF/CSV ([Clockify](https://clockify.me/help/reports/sharing-reports),
  [Toggl](https://support.toggl.com/en/articles/11003864-saving-sharing-and-scheduling-reports)).
- **Family**: Apple Screen Time / Family Link are parent-control (limits + remote management) — surveillance by
  design; Hubstaff/Cattr are the bossware end (see 03 §3) with jiggler counter-market.
- **Requests in OSS**: teams (Wakapi #413, TimeTagger #142), shared timesheets (Traggo #126), public profiles (Wakapi #572).

### Recommendation: minimal model for a self-hosted multi-user tool
Eunomia's users on one instance are likely a household, a small friend group, or a small team/co-op. Keep
"every row fenced to its owner" and add **outbound, owner-controlled, aggregate-only** sharing:
1. **Share links** (M, best first step): owner creates a `share` = `{scope: categories-only | categories+apps |
   categories+apps+contexts, range: fixed dates | rolling last-N-days, deviceIds?, categoryIds?, expiresAt}` →
   unguessable token URL rendering a read-only dashboard (reuse components). Revocable, `lastViewedAt`, never
   titles, never timeline granularity finer than day by default. Covers "show my accountability partner / coach /
   client", embeds, and family transparency — voluntarily.
2. **Groups with aggregate views** (L, only if demand): `groups` + `memberships(role owner|member)`; each member
   chooses per group which categories (or category kinds) are shared; group view shows **per-member daily totals
   for shared categories only** and group totals; no app/context/title, no timeline, no real-time "currently
   active". Admin role on the *instance* (user management, signup policy) stays separate from any data access —
   an instance admin should **not** get a UI to read others' activity (they own the DB, but the product shouldn't
   normalize it; state this in README).
3. **Anti-surveillance positioning** (S, docs): explicit principles in README — no screenshots/keystrokes, no
   manager access to raw data, sharing is opt-in by the tracked person, revocable. Borrow Timely's framing.
4. Skip: leaderboards, approval workflows, timesheet submission (timesheet-tool territory).

---

## 7. Onboarding & first-run

### Observations
- **Time-to-first-insight** is the dominant retention predictor; a blank dashboard creates "choice paralysis"
  and churn; recommended fixes: pre-seeded/sample data, a "shape of success" ghost preview, one obvious next
  action ([empty states playbook](https://www.72technologies.com/blog/empty-states-as-onboarding-surface),
  [10Web TTV](https://10web.io/blog/how-instant-start-onboarding-fixes-ttv/)).
- **Rize** creates categories and rules from your **job title** at signup; **Cronus** asks for projects/goals
  during onboarding; **Timing** has a 10-step Quick Start and asks for AI opt-in on first launch
  ([quick start](https://timingapp.com/help/quick-start?lang=en)).
- **ActivityWatch**: "barebones UI on first run, nothing set up" (#827, #174) — the anti-example.
- **Permissions**: macOS Accessibility / Screen Recording (Timing, Cronus uses Accessibility only to avoid Screen
  Recording), Android Usage Access + battery optimization exemption — trackers that explain *why* before the OS
  prompt and verify afterwards ("tracking is working ✓") have fewer "it shows nothing" reports. Eunomia already
  has sampler health / NOT TRACKING — good base.

### Recommendation for Eunomia
1. **Dashboard empty state** (S): when no devices → a 3-step checklist: *Download agent (Win/Linux/Android links)
   → sign in on the device → see data* with live "waiting for first ping…" that flips when `lastSeenAt` appears.
   When a device exists but <1 h data → show "Today so far" (live summaries already include open activities) plus
   "Pick a starter category pack".
2. **First-run wizard** (S–M): after first login: (a) pick a starter pack / persona (Developer, Writer/Student,
   Designer, General) → rules with live preview once data exists, (b) privacy defaults (ignore/redact suggestions:
   password managers, banking, private browsing windows), (c) optional weekly digest opt-in, (d) timezone.
3. **Demo/sample data** (S): `npm run seed:demo` / `DEMO_MODE` user with a synthetic week — good for screenshots,
   docs, and letting evaluators see the dashboard before installing agents. Not in production accounts.
4. **Agent first-run verification** (S): after provisioning, the agent shows "Captured: <app> — <title>" from the
   last sample and "Server received ✓" after first upload; Android: explicit Usage Access explainer before
   deep-link, then a check.
5. **"Day 1 insight" notification/email** (S, after digest infra): next morning, "Yesterday you tracked 6 h 12 m;
   38 min uncategorized — triage".

---

## Prioritized roadmap (insights / AI / UX / sharing)

| # | Item | Effort | Why now |
| --- | --- | --- | --- |
| 1 | Uncategorized review queue + one-click rule / assign UI (+ category edit) | S | Biggest setup-fatigue win; uses existing mutations |
| 2 | Starter rule packs + first-run wizard/empty state | S–M | Fixes AW's #1 first-run complaint; time-to-first-insight |
| 3 | Category `kind` + goals + trends (WoW deltas) + Pulse | S–M | Unlocks goals, digests, metrics from summaries alone |
| 4 | `focus_segments` in fold (+ hourly rollup) | M | Foundation for timeline, switches, deep work |
| 5 | Day view timeline with per-device lanes, select-range → categorize/create rule | M | Trust + power UX (ManicTime/Timing parity) |
| 6 | Agent-oriented MCP queries + MCP prompts (standup, weekly review, triage) | S | Cheap AI table stakes with BYO model |
| 7 | Scoped MCP write tools (`categorize` key scope, dry-run) | M | "Let my assistant categorize my week" |
| 8 | Weekly email digest + threshold notifications via agents / webhook (ntfy) | M | Cross-device alerts = differentiator |
| 9 | Deep-work blocks, switches/hour, top interrupters, after-hours | M | Valued metrics; explainable formulas |
| 10 | Opt-in OpenAI-compatible LLM (Ollama) for rule suggestions + daily summary/standup | M | Privacy-preserving AI; drafts, never auto-applies |
| 11 | Share links (aggregate, revocable, locked range) | M | Minimal ethical sharing |
| 12 | Groups with aggregate-only per-category views | L | Only with demand |
| — | Blocking / focus enforcement, in-app chat, leaderboards, 20-factor scores | — | Explicit non-goals |

Prereq noted across items: **per-user timezone** (digests, after-hours, day view) — currently server-wide `TZ`.

## Sources (additional to 02–04)
- ManicTime: [selecting time](https://docs.manictime.com/win-client/selecting-time), [tagging](https://docs.manictime.com/win-client/tagging), [MCP desktop](https://docs.manictime.com/ai-mcp-server/desktop), [MCP blog](https://blog.manictime.com/articles/2026-feb/ai-automatic-time-tracking-manictime-mcp/), [Cloud MCP](https://blog.manictime.com/articles/2026-apr/manictime-cloud-mcp-connection/)
- Timing: [MCP](https://timingapp.com/help/mcp), [rules](https://timingapp.com/help/rules), [review day](https://timingapp.com/help/2-reviewing-your-day), [projects](https://timingapp.com/help/3-projects-and-rules), [AI summaries](https://timingapp.com/help/ai-summaries), [teams admin](https://timingapp.com/help/teams-admin), [teams FAQ](https://timingapp.com/help/teams-faq)
- Rize: [FAQ](https://docs.rize.io/getting-started/faq), [MCP](https://rize.io/features/mcp), [MCP changelog](https://rize.io/changelog/rize-mcp), [categories deprecation](https://rize.io/changelog/deprecating-categories), [distraction blocker](https://docs.rize.io/distraction-blocker/configure-distraction-blocker), [breaks](https://docs.rize.io/breaks/configure-break-sessions), [context switching](https://rize.io/blog/the-hidden-cost-of-context-switching), [productivity](https://rize.io/features/productivity)
- RescueTime: [pulse](https://help.rescuetime.com/article/73-how-is-my-productivity-pulse-calculated), [reasonable pulse](https://help.rescuetime.com/article/83-what-are-reasonable-numbers-for-productivity-pulse), [focus settings](https://help.rescuetime.com/article/377-focus-settings), [block during session](https://help.rescuetime.com/article/337-how-do-i-block-activities-during-a-focus-session), [focus zones](https://help.rescuetime.com/article/364-focus-zones), [goals reporting](https://help.rescuetime.com/article/125-reporting-on-your-goals-and-progress)
- ActivityWatch: [categorization docs](https://docs.activitywatch.net/en/latest/features/categorization.html), [aw-webui #174](https://github.com/ActivityWatch/aw-webui/issues/174), [aw-webui #50](https://github.com/ActivityWatch/aw-webui/issues/50), [aw-notify](https://github.com/ActivityWatch/aw-notify), [aw-llm-worker](https://github.com/Srakai/aw-llm-worker), [blocking forum](https://forum.activitywatch.net/t/block-limit-access-to-sites-apps-after-some-amount-of-usage/37)
- Toggl: [timeline](https://support.toggl.com/en-us/article/the-timeline-feature-1txzwm1/), [community request](https://community.toggl.com/t/new-timeline-autotracked-features-create-specific-time-entry-from-selected-activities-separate-pills-based-on-tracking-portions-hide-portion-of-pill-already-tracked/2387), [shared reports](https://support.toggl.com/en/articles/11003864-saving-sharing-and-scheduling-reports)
- Clockify: [sharing reports](https://clockify.me/help/reports/sharing-reports), [clockify-mcp tiers](https://github.com/tracegazer/clockify-mcp)
- Others: [Qbserve](https://qotoqot.com/qbserve/), [Cronus how it works](https://cronushq.com/blog/how-cronus-works-complete-guide-ai-productivity-tracker), [Dayflow](https://github.com/JerryZLiu/Dayflow), [Screenpipe MCP](https://docs.screenpipe.com/mcp-server), [Timely privacy](https://www.timely.com/privacy-at-timely/), [solidtime activity tracking](https://www.solidtime.io/blog/activity-tracking-and-idle-detection), [WakaTime share](https://wakatime.com/share), [Hubstaff Insights](https://support.hubstaff.com/hubstaff-insights-add-on/), [Viva metrics](https://github.com/MicrosoftDocs/viva/blob/public/Viva/insights/advanced/reference/metric-improvements.md), [empty states playbook](https://www.72technologies.com/blog/empty-states-as-onboarding-surface), [10Web TTV](https://10web.io/blog/how-instant-start-onboarding-fixes-ttv/)
