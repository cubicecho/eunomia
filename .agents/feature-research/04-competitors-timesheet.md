# 04 — Competitors: timer / timesheet / project-based trackers

Research date: 2026-09-12. Goal: what manual/project-based trackers offer that users of an
*automatic* tracker (Eunomia) may also expect.

Confidence legend: facts confirmed by 2026 web sources are stated plainly; items marked
*(pk)* come from prior knowledge (pre-2026 docs) and should be re-verified before quoting.

---

## Market context (2025–2026)

- **Consolidation / price hikes are the dominant story.** Harvest was bought by Bending Spoons
  (mid-2025) and moved to per-seat + *unpublished usage-based fees* (invoices, projects, clients,
  tasks); users report 2x to 6x bills. Clockify (CAKE.com) on 21 Apr 2026 capped Free at 5 users and
  moved billable rates, CSV/Excel export, shared report links, kiosk, estimates and private projects
  to paid, with reports limited to a 1-month range. Timeular rebranded to EARLY (Mar 2025) and was
  acquired by TimeTac (Jun 2025). Toggl Track Starter is now $10/$9 and Premium $20/$18.
  -> A self-hosted, no-per-seat tool has a strong "escape hatch" pitch, *if* it imports from these.
- **Timer tools are all bolting on automatic capture.** Toggl (Timeline + on-device AI entry
  suggestions from window titles), Clockify (Auto Tracker, Free tier), Solidtime desktop (May 2026:
  local window activity + idle detection), EARLY (automatic tracking + AI suggestions), TimeCamp
  (keyword rules). The common pattern: **capture activity locally -> user reviews -> converts to
  entries**. Eunomia goes the other way (automatic first); the gap is the *conversion to
  project/client entries* layer.
- **AI timesheet drafting** (Timely AutoSheet, Rize, EARLY) is the 2026 marketing hook.
- Open-source momentum: Super Productivity (~22k stars), Solidtime (~8.9k), Kimai (~5k), Wakapi
  (coding time, ~4.4k); KimaiNext launching Dec 2026 (browser-local tracking + invoicing).

---

## Per-tool profiles

### Toggl Track
- **Platforms:** web, Windows/macOS desktop (Toggl 2.0 desktop), Linux *(pk: legacy/limited)*,
  iOS/Android, Apple Watch *(pk)*, browser extension with 100+ web-app buttons *(pk)*.
- **Timer UX:** one-click timer, manual entry, calendar view (drag to create), "continue" last entry,
  keyboard shortcuts, Pomodoro mode in desktop *(pk)*.
- **Hierarchy:** workspace -> clients -> projects -> tasks (paid) + tags; billable flag.
- **Billing:** billable rates (workspace/project/member), no native invoicing beyond basic
  *(pk: "invoices" export in Premium)*.
- **Reports:** summary/detailed/weekly, saved & shared reports, scheduled reports (Enterprise),
  PDF/CSV/XLSX, profitability, project forecasts with 80%-budget alerts (2026).
- **Idle / reminders:** idle detection with discard/keep prompt in desktop; tracking reminders;
  "Autotracker" keyword rules that notify or auto-start entries when a matching app opens (Windows).
- **Automatic -> entries:** *Timeline* records every app/site visible >10s (local, desktop), shown
  as "pills" beside calendar events in Calendar view; click to convert. **On-device AI suggestions**
  from entry history + active window titles (never uploaded).
- **Calendar:** Google/Outlook two-way-ish live sync; "auto-track calendar events" converts events
  into entries automatically.
- **Integrations:** browser-extension buttons for Jira, GitHub, Asana, Trello, Linear, Notion, etc.;
  Slack, Salesforce, QuickBooks/Xero *(pk)*.
- **API/webhooks:** REST API v9 (rate limits: 30 req/hr per user for user endpoints), Webhooks
  (Manage -> Integrations).
- **Import/export:** CSV importer, Harvest and ClickUp data importers (keeps structure, rates,
  history). No native Clockify importer.
- **Team:** roles (admin/member/org owner), timesheet approvals (Premium), "Locking Time" to freeze
  past entries, required fields, SSO (Enterprise).
- **Offline:** desktop/mobile queue offline entries *(pk)*.
- **Self-host:** no. **Pricing:** Free (<=5 users), Starter $10 ($9/yr), Premium $20 ($18/yr),
  Enterprise quote.
- **Standout:** polish, Timeline + local AI suggestions, anti-surveillance positioning.
- **Complaints:** per-seat price vs Clockify, slow support, features gated by tier.

### Clockify
- **Platforms:** web, Windows/macOS/Linux desktop, iOS/Android, Chrome/Firefox/Edge extension,
  kiosk (shared device) *(pk: CLI via community only)*.
- **Timer UX:** timer, manual, weekly timesheet grid (copy last week), calendar (drag/drop),
  kiosk PIN/QR clock-in with breaks.
- **Hierarchy:** workspace -> clients -> projects -> tasks + tags; custom fields (paid).
- **Billing:** billable & cost rates (workspace/member/project/task), invoicing, expenses (paid);
  billable moved off Free in Apr 2026.
- **Reports:** summary/detailed/weekly/assignment, shared links (paid since 2026), scheduled emailed
  reports, PDF/CSV/XLSX (CSV/Excel paid since 2026), dashboards.
- **Idle / reminders:** idle detection with "what to do with idle time" prompt (Free); targets
  (e.g. 8h/day) with automatic email reminders; managers remind un-submitted/un-reviewed.
- **Automatic:** desktop **Auto Tracker** records apps and websites; user picks which records
  become time entries. Screenshots, GPS, activity levels on higher tiers (surveillance-ish).
- **Pomodoro:** yes, in desktop app *(pk)*.
- **Calendar:** Google/Outlook calendar events shown in calendar view, convert to entries *(pk)*.
- **Integrations:** extension buttons for 80+ tools (Jira, Asana, Trello, GitHub, Linear...),
  QuickBooks/Xero, Slack, Zapier *(pk)*.
- **API/webhooks:** REST API, webhooks (entry created/updated, timer started, etc.) *(pk)*.
- **Import/export:** Toggl importer, migration guides for Harvest/Toggl/ClickUp, CSV import.
- **Team:** approvals (submitted entries lock, bulk approve/reject), lock timesheets before a date
  (admins only edit), roles (owner/admin/manager/member), time off & holidays, scheduling, SSO.
- **Offline:** desktop/mobile offline mode *(pk)*.
- **Self-host:** no (Enterprise "dedicated/on-prem" *(pk)*). **Pricing:** Free (<=5 users,
  limited), Basic ~$3/user, Standard/Pro/Enterprise ~$7-15/user.
- **Complaints:** 2026 free-plan gutting, sync issues, mobile crashes, low-bandwidth reliability.

### Harvest
- **Platforms:** web, macOS/Windows desktop, iOS/Android, browser extension, Slack app *(pk)*.
- **Timer UX:** timer + day/week timesheet, required notes (Enterprise option), calendar sidebar
  pulling Google/Outlook events into the timesheet as one-click entries.
- **Hierarchy:** clients -> projects -> tasks (tasks carry billable defaults & rates); no tags *(pk)*.
- **Billing:** strongest invoicing: one-click invoices from time+expenses, recurring invoices,
  online payments (Stripe/PayPal), payment reminders, estimates; QuickBooks/Xero sync.
- **Reports:** time, detailed, uninvoiced, expense, budget, profitability (Enterprise, 2026),
  saved/custom reports (Enterprise), CSV/XLSX/PDF.
- **Idle / reminders:** idle detection in desktop app *(pk)*; automatic weekly timesheet
  reminder emails.
- **Integrations:** Asana, Jira, Trello, GitHub, Basecamp, Slack, Forecast (sister scheduling
  product), Zapier *(pk)*.
- **API/webhooks:** REST API v2; no general webhooks *(pk)*.
- **Team:** timesheet approvals (Enterprise), activity log, SAML SSO, roles (admin/manager/member).
- **Self-host:** no. **Pricing:** Free (1 seat, 2 projects); Teams $9/seat ($11 monthly) +
  usage fees; Enterprise $14/seat ($17.50) + usage fees.
- **Complaints:** post-Bending-Spoons pricing (600% jumps reported, unpublished usage rates,
  Enterprise+Annual preselected, contractors billed for full period).

### Kimai (open source, PHP/Symfony)
- **Platforms:** web (responsive PWA), third-party mobile/desktop clients and CLI via API *(pk)*;
  KimaiNext (Dec 2026) adds browser-local tracking.
- **Timer UX:** start/stop, multi-timer (concurrent), punch-in/punch-out mode, duration-only mode,
  weekly timesheet ("quick entry"), kiosk with PIN/barcode/RFID (plugin), calendar view.
- **Hierarchy:** customers -> projects -> activities (+ global activities) + tags; custom fields
  (plugin) on any entity; teams with per-team visibility.
- **Billing:** hourly/fixed/internal rates at customer/project/activity/user levels, budgets
  (money + time, monthly budgets), invoicing with templates (HTML/PDF/DOCX/XLSX), XRechnung/e-invoice.
- **Reports:** weekly/monthly per user, project details, export CSV/XLSX/PDF, customer portal
  (share read-only project stats with clients), Controlling plugin for advanced reports.
- **Working time:** working-hours contracts, overtime, vacation/sick/holiday tracking,
  monthly approval of working times *(pk: in core since 2.x)*; approval plugin.
- **Locking:** lockdown periods (entries older than X locked, grace period) *(pk)*.
- **Integrations:** Jira sync, calendar CSV import, Lexoffice/Bexio (via plugins/3rd party).
- **API/webhooks:** JSON REST API with API tokens; webhooks via plugin *(pk)*.
- **Import:** CSV importer (and Toggl/Clockify CSV presets) via Import plugin *(pk)*.
- **Team:** roles (user/teamlead/admin/super-admin) with fine-grained permission matrix,
  LDAP, SAML SSO, multi-timezone, 30+ languages.
- **Self-host:** yes (free core; paid plugins €29-€299/yr); SaaS kimai.cloud (all plugins).
- **Complaints:** dated UI, paid plugins for key features, server/admin overhead.

### Solidtime (open source, AGPL, Laravel + Vue)
- **Platforms:** web, desktop (macOS/Windows/Linux, Tauri/Electron), browser extension; no
  native mobile *(pk: PWA)*.
- **Timer UX:** timer, calendar, weekly timesheet; **July 2026 spreadsheet grid** for bulk entry
  across projects/tasks/days with "copy last week"; break tracking.
- **Hierarchy:** organizations -> clients -> projects -> tasks + tags; public/private projects
  (June 2026); project members with per-member rates.
- **Billing:** billable rates (org/project/member), budgets; invoicing to PDF + EU e-invoices with
  VAT/discounts/templates (premium/cloud module *(pk)*).
- **Reports:** filter/group by member/project/client/task/tag, **shareable read-only reports**,
  PDF/CSV/XLSX export.
- **Automatic:** desktop (May 2026) tracks focused window activity + idle detection, stored locally
  until the user logs it.
- **Import:** one-click import from Toggl, Clockify, Harvest *(pk)*, generic time-entry CSV.
- **Integrations:** issue-tracker integrations; open REST API.
- **Team:** multi-org, roles (owner/admin/manager/employee/placeholder), placeholder users for
  imported data *(pk)*.
- **Self-host:** yes (Docker). Cloud is EU-hosted, GDPR.
- **Standout:** modern Toggl-like UX + self-hosting + importers; closest open-source analog to
  Eunomia's audience. **Complaints:** young; mobile gap; some features cloud/paid-only *(pk)*.

### Everhour
- **Platforms:** web, browser extension (core UX), desktop macOS/Windows, iOS/Android *(pk)*.
- **Timer UX:** timer buttons injected **inside** Asana, ClickUp, Jira, Trello, Basecamp, Monday,
  Notion, GitHub, Linear; weekly timesheet; manual entry.
- **Hierarchy:** mirrors the PM tool's projects/sections/tasks; clients; tags *(pk)*.
- **Billing:** billable/non-billable, rates, budgets with alerts **and blocking** when exceeded,
  invoicing + QuickBooks/Xero export, expenses.
- **Reports:** customizable report builder, saved reports, share with clients, scheduled *(pk)*.
- **Other:** resource planning/schedule, time off, approvals, timesheet locking, idle
  reminders *(pk)*.
- **API/webhooks:** REST API + webhooks *(pk)*. **Import:** Harvest/Toggl CSV *(pk)*.
- **Self-host:** no. **Pricing:** free (limited), Lite $6/user, Team $10/user (min 5).
- **Complaints:** only shines if you live in a supported PM tool; minimum seat counts.

### Tackle (timetackle.com)
- **Model:** calendar-as-source-of-truth. Connects Google + Outlook calendars simultaneously;
  events become time data.
- **UX:** timer button on each Google Calendar event (Chrome extension); rule-based **auto-tagging**
  of events by client/project/properties (attendee domain, title keywords); AI tagging + workflow
  builder.
- **Billing:** tag events billable, rates per project/client, billing-ready timesheets.
- **Reports:** dynamic dashboards; export Excel/Google Sheets/CSV/PDF.
- **Integrations:** Salesforce, HubSpot (CRM account mapping), Slack.
- **Team:** admin controls, team dashboards; SOC 2 Type II. **Self-host:** no. **Pricing:** trial +
  tiers (per-user, not public in sources).
- **Relevance:** proves "auto-categorize a stream of events by rules" is sellable — same shape as
  Eunomia's regex rules, applied to calendars.

### EARLY (formerly Timeular)
- **Platforms:** macOS, Windows, iOS/iPadOS, Android *(pk)*, web; ZEI 8-sided Bluetooth cube ($69).
- **UX:** flip cube side -> timer starts (dock = pause); up to 1,000 activities with quicktrack;
  keyboard shortcuts; "memory"/automatic tracking of tools/docs/websites to create entries;
  AI entry suggestions.
- **Hierarchy:** spaces -> activities (flat-ish) + tags & mentions (`#tag`, `@person`) in notes
  *(pk)*.
- **Calendar:** Google/Outlook connect, events suggested as entries.
- **Other:** productivity insights dashboard, leave/overtime tracking, billable, approvals,
  Zapier (3,000+ apps), API + webhooks *(pk)*.
- **Self-host:** no. **Pricing:** subscription tiers + hardware (not listed in sources).
- **Complaints:** hardware dependency, subscription on top of device cost, acquisition uncertainty.

### TimeCamp (hybrid automatic)
- **Platforms:** web, Windows/macOS/Linux desktop, iOS/Android, browser extension.
- **Automatic:** desktop agent records apps/documents/websites; end-of-day "computer activities"
  timeline to assign to projects; **keyword rules** auto-assign time when a keyword appears in
  window/tab titles or file paths. Productive/unproductive app classification.
- **Timer UX:** timer, manual, timesheet, calendar; attendance module.
- **Hierarchy:** projects -> tasks (nested) + tags.
- **Billing:** billable rates, budgets, invoicing (Premium).
- **Monitoring:** screenshots, idle detection, activity levels (Premium).
- **Integrations:** Jira, Asana, Trello, ClickUp, QuickBooks/Xero, Google Calendar *(pk)*;
  API *(pk)*.
- **Team:** approvals, attendance, time off, roles.
- **Pricing:** Free (unlimited users, 1 project), Starter $2.99, Premium $4.99, higher tiers.
- **Relevance:** TimeCamp's keyword rules == Eunomia's regex category rules, but targeting
  *projects/tasks* rather than categories. Complaints: dated UI, surveillance features, reliability.

### Traggo (open source, Go + GraphQL, GPL-3)
- **Model:** no tasks/projects; only **tagged time spans** with key:value tags (`project:foo`,
  `type:meeting`).
- **UX:** web UI with timer, list and calendar views, multiple themes.
- **Reports:** customizable dashboards with charts (pie/bar/line) over tag queries.
- **API:** GraphQL (same shape as Eunomia's server). Built-in user management. SQLite. Self-host only.
- **Status:** ~1.6k stars, 60 open issues, slow development; no mobile, no idle, no import.
- **Relevance:** tag-dimension dashboards are a clean model for flexible grouping.

### Super Productivity (open source, Angular/Electron, MIT)
- **Platforms:** web/PWA, Windows/macOS/Linux, Android, iOS.
- **Model:** task manager first; time tracked against tasks/subtasks/projects/tags, estimates,
  daily "work log", end-of-day summary.
- **Idle:** desktop idle detection with prompt to assign idle time to a task or break;
  break reminders; "take a break" nudges.
- **Pomodoro:** built-in, plus focus mode.
- **Integrations:** Jira, GitHub, GitLab, Gitea, OpenProject, Trello, Linear, ClickUp, Azure DevOps,
  CalDAV (calendar events -> tasks); worklog push to Jira *(pk)*.
- **Export:** timesheets / work summaries CSV for company systems.
- **Sync/offline:** local-first; sync via SuperSync (E2E encrypted), Dropbox, WebDAV.
- **Team:** none (individual). **Pricing:** free.
- **Relevance:** proves offline-first + idle-assign prompt + issue-tracker linking is what devs
  expect from a personal tracker.

### Anuko Time Tracker (open source, PHP)
- **Platforms:** web; mobile web pages *(pk)*. v1.8, updated 2026-07-13 (LDAP auth, client role).
- **Model:** groups/subgroups; track time only, by project, or by project+task; custom fields;
  expenses.
- **Plugins (toggle-able):** charts, puncher (punch in/out), clients, invoices, paid status,
  **locking on schedule**, week view, **timesheets with approval**, attachments, notifications,
  work units, templates *(pk for last three)*.
- **Roles:** user/client/supervisor/co-manager/manager/admin.
- **Self-host:** yes (free); hosted version available.
- **Relevance:** feature-toggle "plugins" to keep UI simple; client role for read-only access.

### Notable newcomers / adjacent 2025–2026
- **Timely (Memory):** automatic capture + **AutoSheet** AI drafts full timesheet for one-click
  review. Closest commercial analog to "automatic -> entries".
- **Rize:** automatic capture with ML categorization by client/project, no approval step; focus
  scores, break nudges.
- **BetterFlow:** verifies entries against work output (commits, docs) — anti-fraud angle.
- **KimaiNext (Dec 2026):** browser-local free tracking + invoicing; free Jira sync/tagging/calendar
  import/XRechnung plugins.
- **Wakapi / Hackatime / Ziit:** self-hosted WakaTime-compatible coding-time trackers (editor
  heartbeats) — a data source Eunomia could ingest.
- **TimeTagger:** self-hosted timeline UI, tag-based, Pomodoro, PDF/CSV.
- **Timewarrior:** CLI intervals + tags, scriptable, Taskwarrior hooks.
- **TimeScribe:** desktop time tracking with insights (~900 stars).

---

## Implications for Eunomia (short)

1. **Project/client layer on top of categories**: rules that map activity (app/title/url regex,
   calendar event, git repo) to *project/client/task* + billable, not just category. TimeCamp
   keyword rules, Tackle auto-tagging, Toggl Autotracker all do this.
2. **Review & convert UI**: timeline of raw activity beside a calendar of entries; select a range
   -> create entry; AI/heuristic suggestions (Toggl, Timely AutoSheet, Solidtime desktop).
3. **Idle prompt**: "you were idle 23 min — discard / keep / assign to X" (Clockify, Toggl, SP).
4. **Manual entries & timers** for off-computer work (meetings, calls) — even automatic-first users
   need them; plus calendar import.
5. **Exports and importers** (Toggl/Clockify/Harvest CSV/API) — 2026 price shocks make migration a
   top acquisition channel.
6. **Shared read-only report links, scheduled email reports, PDF/CSV.**
7. **Team hygiene** (if multi-user orgs matter): roles, approvals, locking, targets/reminders.

---

## Feature superset

Abbreviations: TG Toggl Track, CF Clockify, HV Harvest, KM Kimai, ST Solidtime, EH Everhour,
TK Tackle, EA EARLY/Timeular, TC TimeCamp, TR Traggo, SP Super Productivity, AN Anuko,
TL Timely, RZ Rize, TT TimeTagger, TW Timewarrior. *(pk)* caveats from profiles apply.

### Capture / entry
- Start/stop timer — TG, CF, HV, KM, ST, EH, TK, EA, TC, TR, SP, AN(puncher), TT, TW
- Manual entry (start/end or duration) — all
- Weekly timesheet grid / bulk entry, copy last week — CF, HV, KM, ST, EH, TC, AN(week view)
- Calendar view with drag-to-create/resize — TG, CF, KM, ST, TC, TR, TT
- Multiple concurrent timers — KM
- Punch-in/punch-out / attendance clock — KM, CF, AN, TC
- Kiosk mode (shared device, PIN/QR/barcode/RFID) — CF, KM(plugin)
- Break tracking — ST, CF(kiosk), SP
- Hardware tracker device — EA
- "Continue"/restart previous entry, favorites/templates — TG, CF, AN *(pk)*
- Required notes/fields on entries — HV, TG, CF
- Duration rounding — TG, CF, KM *(pk)*
- Keyboard shortcuts / global hotkeys — TG, EA, SP
- CLI — TW (others only via community API clients)

### Automatic capture & conversion
- Background app/window/website recording — TG(Timeline), CF(Auto Tracker), ST(desktop 2026),
  EA, TC, TL, RZ
- Local-only storage of raw activity until logged — TG, ST, EA *(pk)*
- Review timeline beside entries, click to convert — TG, CF, TC, TL, EA
- Keyword/regex rules auto-assigning activity to project/task — TC, TG(Autotracker), TK(events)
- Auto-start/notify timer when matching app opens — TG
- AI entry suggestions / drafted timesheets — TG(on-device), EA, TL(AutoSheet), RZ, TK
- Productive/unproductive classification & productivity insights — TC, EA, RZ
- Verify entries against work output (commits/docs) — BetterFlow
- Editor/coding heartbeats — Wakapi/Hackatime/Ziit

### Idle, reminders, focus
- Idle detection with discard/keep/assign prompt — TG, CF, ST, SP, TC, HV *(pk)*, EH *(pk)*
- Reminders to track / forgotten-timer reminders — TG, CF, HV, EH
- Daily/weekly targets with automated reminders — CF
- Manager reminders to submit/approve — CF, HV
- Break reminders — SP, RZ
- Pomodoro / focus mode — SP, TT, TG *(pk)*, CF *(pk)*

### Calendar
- Google/Outlook events shown alongside entries — TG, HV, CF, EA, TK
- Auto-convert calendar events into entries — TG, TK
- Timer button inside calendar events — TK
- Rule-based auto-tagging of events — TK
- CalDAV events -> tasks — SP
- Calendar CSV import — KM(KimaiNext plugin)

### Organization model
- Clients — TG, CF, HV, KM, ST, EH, AN(plugin), TK
- Projects — all except TR (tags only)
- Tasks/activities under projects — TG, CF, HV, KM, ST, EH, TC, SP, AN
- Tags — TG, CF, KM, ST, EH, TC, SP, TR, TT, TW, EA
- Key:value tag dimensions only (no projects) — TR, TT, TW
- Custom fields — CF, KM(plugin), AN
- Public/private project visibility, project members — ST, CF, KM(teams), TG
- Multiple workspaces/organizations — TG, CF, ST, KM(teams)
- Task estimates — CF, EH, SP, TG *(pk)*
- Tasks mirrored from PM tool — EH, SP

### Money
- Billable flag — TG, CF, HV, KM, ST, EH, TK, TC, EA
- Hourly rates at workspace/client/project/task/member levels — TG, CF, HV, KM, ST, EH, TK, TC
- Cost/internal rates & profitability — HV, CF, TG, KM
- Budgets (time/money) with alerts — TG(80% forecast), EH(alerts + blocking), KM, ST, HV, TC
- Invoicing from tracked time (PDF) — HV, KM, ST, CF, EH, TC, AN(plugin)
- E-invoicing (XRechnung / EU VAT) — KM, ST
- Recurring invoices, online payments, payment reminders, estimates — HV
- Expenses — CF, HV, KM(plugin), EH, AN
- Paid/unpaid status on entries — AN
- Accounting sync (QuickBooks/Xero/Lexoffice/Bexio) — HV, CF, EH, KM(3rd-party)

### Reports
- Summary/detailed/weekly reports with filter & group-by — all team tools
- Custom dashboards/charts — TR, TK, CF, TC
- Saved reports — TG, CF, HV, EH
- Shareable read-only report links — ST, CF(paid), TG, EH
- Client/customer portal — KM
- Scheduled emailed reports — TG(Enterprise), CF
- Export PDF — TG, CF, HV, KM, ST, TK, TT
- Export CSV/XLSX — TG, CF(paid), HV, KM, ST, TK, SP, TT
- Export to Google Sheets — TK
- Forecasts / project health — TG, EH

### Team / admin
- Roles & permissions — TG, CF, HV, KM(fine-grained), ST, AN, EH, TC, TR(basic)
- Timesheet submission & approval — CF, HV, TG, KM(plugin), EH, AN(plugin), TC, EA
- Locking past periods — TG, CF, KM, AN(plugin), EH
- Audit trail / activity log — HV, KM(plugin)
- Working hours, overtime, vacation/sick/holidays — KM, CF, EA, TC, EH
- Scheduling/resource planning — CF, EH, HV(Forecast)
- Screenshots/GPS/activity-level monitoring — CF, TC
- SSO (SAML/LDAP) — TG, CF, HV, KM, AN(LDAP)
- Placeholder users for imported data — ST *(pk)*
- Client (read-only) role — AN, KM(portal)

### Integrations / platform
- Browser extension with buttons in third-party web apps — TG, CF, EH, HV, TK
- Jira — TG, CF, HV, KM, EH, TC, SP, ST(issue trackers)
- GitHub/GitLab/Gitea — TG, CF, EH, SP
- Linear — TG, EH, SP
- Asana/Trello/ClickUp/Basecamp/Monday/Notion — TG, CF, HV, EH, TC, SP
- Slack — TG, HV, TK
- CRM (Salesforce/HubSpot) — TK, EH, TG
- Zapier/Make — TG, CF, HV, EA
- REST API — TG, CF, HV, KM, ST, EH, EA
- GraphQL API — TR
- Webhooks — TG, CF, EH *(pk)*, EA *(pk)*, KM(plugin)
- Importers from other trackers (Toggl/Clockify/Harvest/ClickUp/CSV) — ST, CF, TG, KM, EH
- Mobile apps — TG, CF, HV, EH, EA, TC, SP
- Desktop apps (Linux) — CF, ST, TC, SP
- Offline tracking with later sync — SP(local-first), TG, CF, EA *(pk)*
- End-to-end encrypted sync / BYO sync (WebDAV/Dropbox) — SP
- Self-hosting — KM, ST, TR, SP, AN, TT, TW, Wakapi
- Feature toggles/plugins to simplify UI — AN, KM
- Multi-language/multi-timezone — KM, CF, TG

---

## Sources
- Toggl pricing 2026: https://ellieplanner.com/productivity-copilot/toggl-pricing , https://www.timecamp.com/blog/what-is-toggl-track/
- Toggl Timeline / AI suggestions / Autotracker / calendar: https://support.toggl.com/the-timeline-feature , https://toggl.com/track/autotrack-your-time/ , https://support.toggl.com/toggl-track-desktop-app-for-windows
- Toggl import/webhooks: https://support.toggl.com/en-us/article/importing-data-from-other-apps-into-toggl-track-ysio3g/ , https://support.toggl.com/toggl-track-webhooks
- Toggl complaints: https://www.hivedesk.com/toggl-review
- Clockify: https://apploye.com/clockify-review , https://clockify.me/features/kiosk , https://clockify.me/features/timesheet , https://clockify.me/help/getting-started/getting-started-as-admin-and-workspace-owner/migrate-from-harvest-toggl-or-clickup-to-clockify
- Clockify 2026 free plan change: https://vibacloud.com/blog/clockify-free-plan-changes-2026 , https://www.jibble.io/news/changes-clockify-free-pricing-users-impact
- Harvest: https://productive.io/blog/harvest-price-increase/ , https://www.actitime.com/software-collections/harvest-review , https://support.getharvest.com/hc/en-us/articles/360048180932
- Kimai: https://www.kimai.org/en/open-source-time-tracker , https://kimai.de/en/ , https://www.kimai.org/en/blog/2026/popular-integrations , https://github.com/kimai/kimai
- Solidtime: https://www.solidtime.io/ , https://github.com/solidtime-io/solidtime
- Everhour: https://everhour.com/blog/what-is-everhour/ , https://thedigitalprojectmanager.com/tools/everhour-review/
- Tackle: https://www.timetackle.com/ , https://www.timetackle.com/google-calendar-time-tracking/
- EARLY/Timeular: https://early.app/blog/timeular-is-now-early/ , https://github.com/ever-works/awesome-time-tracking/blob/develop/details/early-formerly-timeular.md , https://early.app/ai-time-tracker/
- TimeCamp: https://www.actitime.com/software-collections/timecamp-review , https://apploye.com/timecamp-review
- Traggo: https://github.com/traggo/server
- Super Productivity: https://github.com/super-productivity/super-productivity , https://super-productivity.com/blog/best-open-source-time-tracking-apps-2026/
- Anuko: https://www.anuko.com/time-tracker/user-guide/plugins.htm , https://github.com/anuko/timetracker
- Newcomers/AI: https://hubstaff.com/blog/best-ai-time-tracking-software/ , https://rize.io/blog/best-automated-time-tracking-software , https://openalternative.co/categories/time-tracking/self-hosted
