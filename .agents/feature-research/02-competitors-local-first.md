# Competitors: automatic / local-first / open-source trackers

Researched 2026-09-12. Sources: official sites and docs, GitHub repos and releases (via `gh api`), GitHub issues sorted by reactions, HN threads, review aggregators. Star counts and last-push dates come from the GitHub API on the research date. Items marked *(unverified)* came only from third-party aggregators or older memory.

Relevance key for Eunomia: **[D]** direct overlap (automatic capture), **[A]** adjacent (manual timers / self-hosted business time tracking), **[M]** "screen memory" (continuous recording + AI).

---

## 1. ActivityWatch [D]
- **Repo:** ActivityWatch/activitywatch. MPL-2.0, about 18.9k stars, very active. v0.14.0 betas b1 to b5 shipped Jul to Sep 2026 (b5 on 2026-09-07). The last stable is still v0.13.2 (Oct 2023). There is also a "Research Edition" prerelease channel for study participants, with a privacy filter and a preset category map.
- **Platforms:** Windows, macOS, Linux (X11; Wayland only through third-party watchers such as `awatcher` and `aw-watcher-window-wayland`/hyprland), Android (`aw-android`, UsageStats API, labelled "very work-in-progress"). No iOS (issue #751, 28 reactions). There are two shells: the aw-qt tray app and the newer aw-tauri, which gained auto-update in 0.14.
- **Architecture and capture:** a local REST server (aw-server-rust, SQLite) on localhost:5600. "Watchers" are separate processes that send **heartbeats** (events that merge when their data is unchanged) into **buckets**, one per watcher per host.
  - `aw-watcher-window`: app name and window title. On macOS it also reads the URL, now including Firefox-based browsers via the accessibility tree (0.14).
  - `aw-watcher-afk`: keyboard and mouse idle (3-minute default). 0.14 adds gamepad input on Linux.
  - `aw-watcher-web`: browser extension for Chrome/Edge/Firefox capturing URL, title, audible and incognito state. No Safari extension (#62).
  - Editor watchers: vim/nvim, VS Code, JetBrains, Emacs, Visual Studio, Sublime, Zed, Obsidian. They capture file, language and project.
  - Community watchers: Spotify, media-player, last.fm, input (keypress counts, mouse distance), utilization (CPU/RAM), Steam/PlayStation, tmux, Anki.
- **Query language (query2):** a small scripting DSL run server-side. Example: `flood(query_bucket(find_bucket("aw-watcher-window_")))`, then `filter_keyvals(afk,"status",["not-afk"])`, then `filter_period_intersect(window, afk)`, then `merge_events_by_keys(events,["app","title"])`, then `categorize(events, rules)`, `sort_by_duration`, `limit_events`, `split_url_events`, `RETURN = ...`. The web UI's Query Explorer gained **saved query presets** in 0.14.
- **AFK handling:** time is only counted when the window events intersect "not-afk" periods. `flood()` fills small gaps, and in 0.14 it was normalised so events no longer overlap.
- **Categorization:** hierarchical categories (e.g. `Work > Programming > Eunomia`) with regex rules. The deepest matching category wins. Categories have colours and can be marked productive. 0.14 adds **field-scoped regex rules** (match app vs title vs URL), an optional **priority field** on rules, and preset category sets shipped with a build. Rules live in web-UI settings and apply at query time, so they are retroactive. Categorising by URL was a long-standing gap (#352, 35 reactions) until field scoping arrived.
- **Privacy:** local only, no accounts. 0.14 adds a **heartbeat-level privacy filter engine** plus a filter editor in settings, regex exclusion of window titles (0.13.2), **opt-in SQLCipher database encryption**, and an app-to-category map that stores only a category instead of titles for non-browser apps (Research Edition). There is no authentication on the local API (#1199, "Please add SOME authentication").
- **Sync (aw-sync):** the most-requested feature (#35, 180 reactions, open since 2017). A Rust daemon exports and imports buckets to a shared folder every 5 minutes, and you move that folder yourself with Syncthing or Dropbox. It is still "in testing", and 0.14 stopped re-syncing buckets that came from other hosts. There is **no central server and no multi-user support**; teams build their own aggregation (e.g. third-party `aw-sync-suite` pushes into Prometheus and Grafana). A `--profile` flag for isolated instances was added in 0.14.
- **Reporting:** Activity view (top apps, titles, domains, categories), Timeline (swimlanes per bucket), category sunburst and treemap, Stopwatch (manual), Query Explorer, custom visualisation panels. 0.14 adds a **BillingView** (billable hours grouped by category, with export), a client-side **AI activity summary page**, and i18n. A "Trends" view (category over time) is still requested (aw-webui #289).
- **Manual time/projects/billing:** minimal. There is a stopwatch bucket and the new BillingView; no clients, projects or invoices.
- **Goals/alerts:** `aw-notify` (0.14 adds a settings panel) sends category-time notifications and hourly/daily summaries.
- **Integrations/API/export:** full REST API, Python and JS clients (`aw-client` gains `--format json`), JSON export of buckets, CSV from some views, import of JSON.
- **AI:** client-side AI summary page (0.14). Community MCP servers exist.
- **Pricing:** free; donations. 0.14 added an "engagement-gated supporter nudge".
- **Standouts:** watcher plugin ecosystem, the query DSL, retroactive regex categories, local-first design, editor watchers.
- **Top complaints (GitHub reactions and reviews):**
  - No real sync or multi-device merge (#35)
  - Wayland (#92)
  - Video/media time is counted as AFK (#261)
  - URL categorization (#352)
  - No iOS, and arm64 builds missing (#641)
  - No auth on the API
  - Barebones UI on first run, and nothing to set up categories out of the box (#827, #174)
  - Fragile Linux installs (AppImage failures, Ubuntu 24.04, Fedora 40)
  - Browser activity not showing in the Activity view (aw-watcher-web #102)
  - Timeline performance with a lot of data (aw-webui #516)
  - macOS "loginwindow" periods recorded when the lid is closed (#810)
  - Android stability
  - Invalid regex crashes the UI (#585)
  - Five years without a stable release

## 2. Screenpipe [M]
- **Repo:** screenpipe/screenpipe, about 21.5k stars, YC S26. **The licence changed from MIT to the source-available "Screenpipe Commercial License" on 2026-06-09.** Personal, non-commercial, education and research use is free; commercial use of the source needs a licence at any company size; individual licences cover up to 4 people per company.
- **Platforms:** macOS (Apple Silicon and Intel), Windows 10/11, Linux. Needs 8 GB RAM and uses about 5–10 GB of disk per month.
- **Capture:** event-driven screenshots (a frame is stored only when something changes) paired with the **OS accessibility tree** for text, falling back to OCR. Also system audio and mic with local Whisper transcription, keyboard input, app switches, window titles, and meeting detection (e.g. Slack huddles, browser meetings). Stored in local SQLite plus JPEGs (about 300 MB per 8 hours).
- **Local-first/sync:** 100% local by default, with optional encrypted sync and optional cloud enterprise plans.
- **Privacy:** local ML **PII redaction**, per-pipe YAML AI data permissions with OS-level enforcement, app/window exclusion. Telemetry (PostHog, Sentry) is **on by default** but can be disabled.
- **Categorization/reporting:** no rules engine. Time breakdowns come from AI "pipes" (day recap, standup, time breakdown, meeting notes).
- **Integrations/API:** REST API on localhost:3030 (search, frames, audio, UI elements), raw SQL access, JS/TS SDK, **MCP server** for Claude Desktop, Cursor, VS Code and others, "pipes" (scheduled agents defined as markdown files in `~/.screenpipe/pipes/`), import of external agent chats (Claude/Codex).
- **AI:** central to the product. Local LLMs via Ollama or cloud providers. 2026 positioning is "record how you work and turn it into agents".
- **Pricing:** free CLI/personal use. Paid app plans are Standard $25/mo, Pro $50/seat/mo and Enterprise from $150/seat/mo, plus lifetime $400 or $600 *(aggregator figures)*. Earlier desktop pricing jumps (to about $332) drew HN criticism.
- **Complaints:**
  - Backlash over the licence change ("betrayed FOSS origins")
  - Distrust of "local" claims: one HN user reported API keys going to external endpoints, and people fear a future cloud pivot
  - Early CPU heat on M1 Macs
  - Very large databases: a 63 GB database hit a WAL "db_wedge" relaunch loop (#6982)
  - macOS code-signing and keychain prompts on every launch (#6981)
  - GDPR/AI-Act worries about recording other people in meetings
  - Telemetry on by default

## 3. Dayflow (new, 2025–26) [M]
- **Repo:** JerryZLiu/Dayflow. MIT, about 7.1k stars, very active. **macOS 14+ only** (native Swift). Windows/Linux (#318) and Intel Macs (#136) are requested.
- **Capture:** one screen frame every 10 seconds (about 100 MB RAM, under 1% CPU). An LLM turns batches of frames into an **automatic timeline of labelled activity cards** and a daily summary, with no tags or rules. It can tell "researching on YouTube" from "watching cat videos".
- **AI:** local (Ollama, LM Studio) or cloud (Gemini, ChatGPT, Claude via their CLIs). Also natural-language chat over your journal, standup prep, weekly analytics, distraction tracking.
- **Privacy:** recordings stay local, with storage limits and auto-cleanup. Cloud AI sends frames to the provider (this sparked a "Recall alternative" privacy debate).
- **Export:** timeline as Markdown.
- **Complaints and requests:** iCal export (#183), audio capture (#196), **per-app privacy rules and provider routing** (#299), configurable capture interval (#286), off-peak processing (#288), custom user prompt (#184), fragile provider compatibility (#378).

## 4. ManicTime (Desktop + Server + Cloud) [D]
- **Platforms:** Windows (flagship), macOS, Linux, Android, iOS. ManicTime Server runs on-prem (Windows/Linux/Docker); a Cloud version is also offered.
- **Capture ("timelines"):**
  - Computer usage: active vs idle from keyboard and mouse
  - Applications: process and window title
  - Documents/URLs: file paths and sites
  - Extra context: named virtual desktops, remote-desktop IPs, **git repository and branch detection**, workplace/location, plus optional **periodic screenshots** (WebP by default since 2026.1)
  - Calendar-based tags
- **Local-first/sync:** the desktop app works fully offline with a local database. Its data can sync to self-hosted Server or Cloud for multi-device and team reporting.
- **Privacy:** "Off the record" mode (pause for 1–15 minutes, until tomorrow, or indefinitely, with a red tray icon). Exclusions by exact or partial process name, website or document. Server has an experimental **data retention** feature for GDPR (2025.3). Team reports can be limited.
- **Categorization:** **AutoTags**, which match rules against app, title, URL, document path and git data using wildcards and regex with capture groups (e.g. pull a project code from a path). Rules apply retroactively. Other features:
  - **Absorb**: generic tools inherit the surrounding tag
  - **Auto-fill small gaps**
  - Overwrite, append and prepend behaviours
  - Hierarchical tags such as `Client, Project, Task`, with billable flags
  - Productivity values and categories
  - Folders to group apps and sites
- **Reporting:** day view with swimlane timelines, a tag timeline, timesheets, statistics (top 100), productivity and categories reports, shared dashboards, per-user email reports, "show only untagged time".
- **Manual/projects/billing:** manual tag entries, a stopwatch, timesheets, **invoices** (Server), leave and half-day leave, overtime rules.
- **Goals/alerts:** alerts when usage passes a time threshold.
- **Integrations:** Jira (including on-prem OAuth), Asana, Azure DevOps, SingleCase (two-way), calendars. **MCP server** on desktop since 2026.1 and **AI/MCP on Server** since 2026.2, so AI can query timelines, summaries, tags, screenshots, users and teams, and tag time while respecting allowed tags.
- **Pricing:** free edition (limited); Pro perpetual licence about $87 per user (price change June 2025; volume discounts down to about $20). **Server needs no extra fee, only per-user licences.** Cloud is $7/mo (Standard, 3 devices) or Ultimate (5 devices plus cloud screenshots).
- **Complaints:** dated, dense UI; screenshots slow down older PCs; setup complexity (every app must be categorised before reports are useful; "not plug-and-play"); off-computer work such as calls and whiteboarding shows up as "Away"; Windows-first, so other platforms lag.

## 5. Timing (macOS) [D]
- **Platforms:** macOS agent; web app (timers from a phone); **iOS Screen Time import**.
- **Capture:** apps, window titles, **document paths**, website URLs (Safari, Chrome, Firefox, Brave, Edge), 50+ app integrations (VS Code, Slack, Zoom, Office, Notion, Final Cut…), idle detection, **automatic meeting and call detection** with prompts to log calls.
- **Local-first/sync:** stored locally; optional cloud sync across Macs and backup; team features.
- **Privacy:** private/incognito tabs discarded automatically; exclusion list; teams see aggregate reporting only ("no personal data shared").
- **Categorization:** project **rules** (created by ⌥-drag onto a project), keyword rules, "Entry-O-Matic" automation, smart grouping suggestions, per-project productivity score.
- **Reporting:** day, week and hour; customizable reports; PDF, XLSX, CSV and HTML export; report rounding.
- **Manual/billing:** manual entries, timers, **GrandTotal** invoicing integration, Clio (legal), ClickUp and Linear task import (two-way sync on Connect).
- **AI:** **AI activity summaries**; **MCP integration** ("let your AI assistant manage your time").
- **API:** AppleScript scripting, Web API, Zapier (Connect tier).
- **Pricing:** subscription. Professional about $10/mo, Expert (mid tier), Connect $168/yr *(partial figures; the site renders prices dynamically)*. 30-day trial.
- **Complaints:** Mac only; subscription-only (no perpetual option); the web API and two-way integrations are locked to the top tier; limited reports on the cheapest tier. *(No strong Reddit signal found.)*

## 6. Arbtt [D]
- **Repo:** nomeata/arbtt. GPL-2.0, 361 stars, still maintained (pushed Aug 2026). Written in Haskell.
- **Capture:** `arbtt-capture` samples **all open windows** (title, program, desktop) every 60 seconds, plus idle time, into a compact binary log. It records all windows, not just the focused one.
- **Categorization:** a textual rules DSL in `categorize.cfg`. Example: `current window $program == "firefox" && current window $title =~ /GitHub - (.*)/ ==> tag Project:$1`. It supports `$time`, `$idle`, `$date`, `$desktop`, conditions over any window, and tag namespaces (`Category:Value`). Raw samples are kept, so rules are always **retroactive**.
- **Reporting:** `arbtt-stats` CLI (per-tag totals, `--filter`, `--intervals`, per-category breakdown, CSV output); `arbtt-dump` exports as text or JSON.
- **Platforms:** Linux X11 and Windows; macOS historically weak.
- **Privacy:** local file only. The docs warn the log "might contain very sensitive private data".
- **Complaints:** no GUI; the DSL is hard to learn; no Wayland; no sync.

## 7. Selfspy [D]
- **Repo:** selfspy/selfspy. GPL-3.0, about 2.5k stars, **unmaintained since 2019**. Python.
- **Capture:** window titles and processes, **every keystroke** (encrypted), mouse clicks and movement, into local SQLite. Encryption is Blowfish with an MD5-derived key, which is weak by modern standards.
- **Reporting:** `selfstats` CLI queries (e.g. "what did I type in window X", active time per process, key frequencies).
- **Platforms:** X11, macOS, Windows (flaky).
- **Complaints:** abandoned; Python 2 era; keylogging is a security and liability risk; weak crypto (raised in a Debian review, #160).

## 8. ulogme (Karpathy) [D]
- **Repo:** karpathy/ulogme, about 1.2k stars, no licence, **dead since 2020**.
- **Capture:** active window title (sampled) plus **keystroke frequency** (counts only, not content), on Ubuntu and macOS.
- **Reporting:** a local HTML dashboard per day, with category mapping via a JS config of regex to title group, daily "notes" and a per-day blog field, and an overview across days.
- **Standout:** pioneered lightweight daily "notes plus activity" journaling.
- **Complaints:** abandoned; hacky shell scripts; X11 only.

## 9. Wakapi [D, coding-only]
- **Repo:** muety/wakapi. MIT, about 4.4k stars, active. Go; runs on SQLite, MySQL/MariaDB or Postgres.
- **Capture:** reuses **WakaTime editor plugins**, which send heartbeats (file, project, language, editor, OS, machine, branch). It is compatible with the WakaTime API, so any WakaTime plugin works.
- **Features:** stats by project, language, editor, host, OS and label; aliases and mapping rules (rename or merge languages/projects); project labels; badges; **weekly email reports**; **Prometheus export**; relay/forwarding to WakaTime; import from WakaTime; public leaderboard; OIDC/SSO, trusted-header auth, WebAuthn.
- **Hosting:** multi-user self-hosted, or free hosted at wakapi.dev.
- **Complaints and requests:**
  - WakaTime OAuth (#94)
  - **Teams and organizations** (#413)
  - Public profiles (#572)
  - **Goals** (#166)
  - Retroactive name unification (#800)
  - Richer mapping rules (#823)
  - Durations API (#500)
  - **Timezone bugs with Postgres** (#771)

## 10. Hakatime [D, coding-only]
- **Repo:** mujx/hakatime. Unlicense, about 690 stars, **stale since Nov 2024**. Haskell plus Postgres.
- **Features:** WakaTime-compatible server, dashboard (by project and language, day-of-week and hour-of-day heatmaps), **leaderboards across instance users**, badges, WakaTime import by API token and date range, time spent per GitHub commit, heartbeat forwarding to another server, UI registration.
- **Complaints:** maintenance has stalled; Haskell builds are hard to contribute to.

## 11. Traggo [A]
- **Repo:** traggo/server. GPL-3.0, about 1.6k stars, slow but alive (Jul 2026). Go with a **GraphQL API** (gqlgen), SQLite (Postgres requested, #76).
- **Features:** manual time spans with **key:value tags** (e.g. `project:eunomia type:dev`) instead of a project hierarchy, customizable dashboards with charts, list and calendar views, simple multi-user, themes.
- **Complaints and requests:**
  - **CSV/JSON export and import** (#67, the top request)
  - SSO via Authelia (#95)
  - **Shared timesheets between users** (#126)
  - Postgres (#76)
  - CLI (#69)
  - Mobile app (#83)
  - GraphQL docs (#49)
  - Daily/weekly totals in the list view (#196)
  - CalDAV (#156)
  - Grouping tags in dashboards (#203)

## 12. TimeTagger [A]
- **Repo:** almarklein/timetagger. GPL-3.0, about 1.8k stars. Async Python with a PScript frontend.
- **Features:** an interactive, zoomable **timeline UI**; `#hashtag` tags inside descriptions; daily, weekly and monthly **targets/goals**; PDF and CSV reports; experimental Pomodoro; web API and CLI; offline-capable PWA with sync.
- **Auth:** BCrypt credentials or reverse-proxy header auth.
- **Hosting:** self-host via Docker, or hosted at timetagger.app for €3/mo. A community Android client (Tagius) exists.
- **Complaints and requests:**
  - Reminders when a record has run for X hours (#55)
  - Tag hierarchy/inheritance (#368)
  - Tag distribution charts (#125, #555)
  - **A desktop app that tracks activity automatically** (#45)
  - OIDC (#582)
  - Notes on records (#375)
  - Teams (#142)
  - Bulk tag management (#366)

## 13. Super Productivity [A]
- **Repo:** super-productivity/super-productivity. MIT, about 22k stars, very active.
- **Platforms:** Windows, macOS, Linux, Android, iOS, web.
- **Features:**
  - Todo list with **task-based time tracking**
  - Timeboxing/day planner, Pomodoro, break reminders, **idle detection** (asks what to do with idle time)
  - Estimates, worklog and timesheet export, habit and metrics tracking
  - Projects and tags, notes, attachments and bookmarks
  - Plugins, themes
- **Integrations:** Jira, GitHub, GitLab, Gitea, OpenProject, Trello, Linear, ClickUp, Azure DevOps (issues pulled in as tasks); basic CalDAV.
- **Sync:** local-first. Options are SuperSync (their E2E-encrypted, self-hostable server), Dropbox, WebDAV or a local file. No accounts and no telemetry.
- **Complaints and requests:**
  - Todoist integration (#548), TickTick/Vikunja (#2312)
  - Task dependencies (#2173) and deeper subtask nesting (#2657)
  - Bulk edits (#4645, #7058)
  - **An API for automations** such as Apple Shortcuts (#3515)
  - Two-way calendar sync (#5001)
  - **Recording start and end timestamps** for time entries, not just durations (#6378)
  - Trash bin (#2778), full CalDAV (#3938)
  - **Sync reliability**: conflicts after hibernate (#7330); last-write-wins resolution silently losing or resurrecting data (#8956)

## 14. Qbserve (macOS) [D]
- **Vendor:** QotoQot. Current version 1.9, which includes Sequoia tracking fixes; development pace is slow.
- **Capture:** apps, browser URLs (Chrome, Safari, Firefox, Vivaldi, Opera, Yandex), documents, **individual YouTube videos and Slack teams**; a built-in database of about 8,100 sites and apps pre-classified as productive, neutral or distracting.
- **Features:**
  - Real-time **menu-bar productivity score**
  - Customizable **alerts and goals** (e.g. distraction limits)
  - Projects via rules on document paths and URLs; billable time
  - **Invoice generation** (18 languages)
  - Timesheets; daily, weekly and monthly reports
  - Manual time suggestions for idle gaps
  - Private-tab ignore, pause
- **Export:** JSON and CSV, including **scheduled automatic exports**; AppleScript, IFTTT and Zapier.
- **Pricing:** one-time purchase (historically about $40 *(unverified)*), 15-day trial.
- **Complaints:** Mac only; infrequent updates; no sync or multi-device; no team or server option.

## 15. Memtime [D]
- **Platforms:** Windows (including Windows Server 2016–2025), macOS, Linux.
- **Capture:** programs, documents, **emails**, browser tabs, shown as an activity timeline in 5- or 6-minute increments (built around legal billing).
- **Privacy positioning:** data **stays only on the device**; it explicitly cannot be used for employee monitoring.
- **Workflow:** review the timeline, then assign blocks to projects and tasks, then push to 100+ tools (Jira, Asana, ClickUp, Harvest, Toggl, QuickBooks, FreshBooks…).
- **Pricing:** subscription after a 14-day trial with no card needed *(prices not published on the page fetched)*.
- **Complaints:** assignment is still manual; no reports beyond what the target tools offer; no multi-device view, by design.

> **"Memex-style":** WorldBrain Memex (about 4.7k stars) is a browser annotation and knowledge tool, not a time tracker. The screen-memory category it evokes, **Rewind/Limitless, shut down**: Meta acquired Limitless on 2025-12-05 and Rewind capture was disabled on 2025-12-19, with users in some regions losing access immediately. That event pushed users to Screenpipe, Dayflow, OpenRecall and Windrecorder, and it is a strong "your data can vanish with a vendor" argument for self-hosting.

## 16. Kimai [A]
- **Repo:** kimai/kimai. AGPL-3.0, about 5k stars, very active. PHP/Symfony, multi-user web app, self-hosted or Kimai Cloud.
- **Features:**
  - Timesheets, timers, punch-clock mode
  - Customers, projects and activities with **budgets** (time and money) and order numbers
  - Hourly, fixed and internal rates; **invoicing** with templates; expenses; working-hour accounts
  - Teams, **fine-grained roles and permissions**, approval (plugin), customer portal
  - Exports to PDF, DOCX, XLSX, CSV, HTML; audit logs
- **Auth and extensibility:** LDAP, SAML (Google Workspace, Azure AD), 2FA, JSON REST API, **plugin marketplace**, 30+ languages.
- **Apps:** mobile and desktop clients are third-party or plugin-based. There is **no automatic capture**.
- **Pricing:** self-host free. Cloud Standard €2.99 and Professional €3.99 per user/month (annual), 30-day trial.
- **Complaints and requests:**
  - Default customer and project (#403) and default activity (#699)
  - **Pause button** (#963)
  - Calendar integration and subscription (#5287, #1789, #361 CalDAV)
  - **OIDC** (#2469)
  - **Webhooks** (#1407)
  - Enforcing 2FA (#6010)
  - Creating projects on the fly (#4439)
  - General: the UI feels heavy for solo users

## 17. Other notable newer or relevant tools
- **solidtime** (AGPL-3.0, about 8.9k stars; Laravel and Vue; self-host or EU cloud). A modern Toggl/Clockify clone: projects, tasks, clients, billable rates, multi-org roles, import from Toggl, Clockify and CSV. **The desktop app (May 2026) added background window-activity tracking plus idle detection. Activity is stored locally only, never sent to the server, until the user turns it into time entries.** This is the closest "privacy-split" model to Eunomia's.
- **Tockler** (GPL-2.0, about 1.1k stars; Electron and React). Tracks active window title and idle time into a timeline plus a calendar, fully local. Requests: categorising apps (#211), Flatpak, not being trusted on Windows because it is unsigned (#174), idle status while watching media (#308).
- **awatcher** (MPL-2.0). Rust window and idle watcher for X11 and Wayland that feeds ActivityWatch.
- **OpenRecall** (AGPL-3.0, about 2.9k stars, stale since Sep 2025) and **Windrecorder** (GPL-2.0, about 3.9k stars, Windows). Open-source Recall/Rewind clones: periodic screenshots, OCR, semantic search. Windrecorder adds activity statistics.
- **TimeScribe** (GPL-3.0; macOS and Windows). Offline work-hours, break and overtime tracker with auto start and stop and work-schedule configuration; no account.
- **Cattr** (SSPL). Self-hosted *employee-monitoring* tracker: desktop clients, screenshots, keyboard and mouse activity levels, app and URL usage, Postgres, manager dashboards. This is the "boss surveillance" end of the spectrum that Eunomia should explicitly avoid resembling.
- **Timewarrior** (MIT). CLI interval tracker with tags, reports and a Taskwarrior hook.
- **Tie Tracker**. Local-first mobile/PWA manual tracker (no server).
- **TimeTracker (HN "Show HN" 2025)**. Flask, HTMX and WebSockets; server-side persistent timers that survive browser closes; multi-user; Raspberry Pi friendly.
- Closed-source AI trackers that competitors benchmark against: Rize, Timely/Memory (AI timesheets), Chronoid (on-device AI categorization), Cronus.

---

## Cross-cutting themes of user complaints
1. **Multi-device sync and a central server are missing or unreliable.** Examples: ActivityWatch #35 (the top request for 9 years), Super Productivity last-write-wins data loss, Qbserve/Tockler/Dayflow having none. Few tools combine automatic capture with a *self-hosted multi-user server*; ManicTime Server is the main one, and it is proprietary.
2. **Linux Wayland and packaging:** ActivityWatch #92, AppImage failures, Flatpak requests, unsigned Windows binaries (Tockler).
3. **Categorization is too much work up front:** ManicTime "not plug-and-play", ActivityWatch's empty defaults. At the same time, advanced users want **field-scoped, prioritised, retroactive regex rules** and URL/project matching.
4. **Idle is not the same as not working:** video and meetings count as AFK (ActivityWatch #261, Tockler #308), and calls show as "Away" (ManicTime). Timing and Screenpipe address this with meeting and media detection.
5. **Privacy vs usefulness:** keyloggers (Selfspy), continuous screenshots (Screenpipe, Dayflow, ManicTime) and cloud AI create unease. Users ask for per-app privacy rules (Dayflow #299), telemetry off by default, API auth (ActivityWatch #1199), encryption at rest and retention limits.
6. **Licence and vendor risk:** Screenpipe's MIT-to-commercial switch; Rewind's shutdown after the Meta acquisition; abandoned OSS (Selfspy, ulogme, Hakatime).
7. **Export and interoperability:** Traggo's CSV/JSON export is its top request; people ask for webhooks and OIDC (Kimai), an API for automations (Super Productivity), iCal (Dayflow).
8. **Timezone correctness:** Wakapi's Postgres timezone bugs.
9. **Performance at scale:** ActivityWatch timeline performance, Screenpipe's 63 GB database wedge, ManicTime screenshots slowing PCs.
10. **Teams without surveillance:** requested for Wakapi, Traggo and TimeTagger; Timing and Memtime market aggregate-only or no-boss-access designs.

---

## Feature superset

Legend:

| Code | Tool |
|---|---|
| AW | ActivityWatch |
| SP | Screenpipe |
| DF | Dayflow |
| MT | ManicTime |
| TI | Timing |
| AR | Arbtt |
| SS | Selfspy |
| UL | ulogme |
| WK | Wakapi |
| HK | Hakatime |
| TG | Traggo |
| TT | TimeTagger |
| SUP | Super Productivity |
| QB | Qbserve |
| MM | Memtime |
| KI | Kimai |
| SO | solidtime |
| TO | Tockler |
| OR | OpenRecall/Windrecorder |
| CA | Cattr |
| TS | TimeScribe |
| TW | Timewarrior |

### Capture
- Focused app and window title: AW, MT, TI, AR, SS, UL, QB, MM, SO (desktop), TO, SP, CA
- All open windows sampled, not just the focused one: AR
- Browser URL via extension: AW (aw-watcher-web)
- Browser URL via OS accessibility/AppleScript: AW (macOS), TI, QB, MT, SP
- Private/incognito tabs ignored automatically: TI, QB, AW (flag captured)
- Document/file path tracking: MT, TI, QB, MM
- Email subject tracking: MM
- Editor/IDE heartbeats (file, language, project, branch): AW (editor watchers), WK, HK
- Git repo and branch detection: MT, WK/HK (via plugins)
- Virtual desktop, remote-desktop IP, workplace/location context: MT
- YouTube video and Slack team granularity: QB
- Media playback (Spotify, media player, last.fm): AW (community)
- Gaming (Steam/PlayStation) and gamepad-based activity: AW
- tmux/terminal session tracking: AW (community)
- System utilization (CPU/RAM): AW (community)
- Keystroke and mouse counts: AW (aw-watcher-input), UL, CA
- Full keystroke logging: SS
- Periodic screenshots: MT, CA, DF (frames), OR
- Event-driven screenshots with the accessibility tree and OCR: SP, OR (OCR)
- Audio and mic transcription: SP
- Meeting/call detection with prompts: TI, SP
- Calendar events as activity/tags: MT, TI
- Idle/AFK detection from keyboard and mouse: AW, MT, TI, AR, QB, SO, TO, SUP, CA, TS
- Idle-return prompt (keep, discard or assign idle time): SO, SUP, QB (suggestions)
- Android usage (UsageStatsManager): AW (aw-android), MT (Android app)
- iOS Screen Time import: TI
- Wayland support: AW (third-party awatcher)
- Heartbeat merge model (events extend while unchanged): AW, WK, HK
- Configurable sampling interval: AR, DF (requested), MT (screenshots)

### Storage, sync and deployment
- Local-only storage by default: AW, SP, DF, AR, SS, UL, QB, MM, TO, OR, TS, SO (activity data), MT (desktop), TI
- Opt-in database encryption at rest: AW (SQLCipher), SS (keystrokes), SUP (E2E sync)
- Folder-based sync (Syncthing/Dropbox): AW (aw-sync)
- WebDAV/Dropbox sync: SUP
- Vendor cloud sync: TI, MT Cloud, SP (encrypted, optional), TT hosted, SUP (SuperSync)
- Self-hosted central server with multi-user support: MT Server, WK, HK, TG, TT, KI, SO, CA
- Activity data kept on the client, only explicit time entries sent to the server: SO, MM
- Multi-device merged reporting: MT, TI, SUP (sync), WK/HK (per machine)
- Isolated profiles/instances: AW (`--profile`)
- Multi-organization/workspace: SO, KI (teams)
- Docker deployment: WK, HK, TG, TT, KI, SO, MT Server, CA
- Auto-update: AW (aw-tauri), MT, TI
- Start at login/autostart toggle: AW, MT, TI, TS
- Offline-capable web/PWA: TT, SUP
- Data retention/auto-cleanup limits: MT Server (GDPR retention), DF (storage limits)

### Privacy
- App/site exclusion (ignore) lists: MT, TI, AW (privacy filter), SP, QB
- Regex window-title exclusion or redaction: AW
- Heartbeat-level privacy filter engine with editor: AW
- Store only the category, not raw titles (for some apps): AW (Research Edition)
- ML-based PII redaction: SP
- Pause/"off the record" with durations: MT, QB, SP
- Per-plugin data permissions for AI: SP
- Per-app routing of AI provider (requested): DF
- Team views limited to aggregates, no personal detail: TI, MM (no boss access)
- Telemetry opt-out: SP (on by default), SUP (none)
- Local API authentication (requested): AW

### Categorization and rules
- Regex rules on app/title: AW, MT, TI, AR, UL, QB
- Field-scoped rules (app vs title vs URL vs path): AW (0.14), MT, TI
- Rule priority/ordering: AW (0.14), AR (first match), MT
- Hierarchical categories (deepest match wins): AW
- Hierarchical tags (Client, Project, Task): MT
- Key:value tags: TG, AR (`Category:Value`)
- #hashtag tags in descriptions: TT
- Capture-group-derived tags (e.g. project code from path): AR, MT
- Retroactive re-application of rules to history: AW, AR, MT, TI
- Rule DSL in a config file: AR
- Create a rule from a timeline item (right-click or drag): MT, TI
- Absorb (generic tools inherit the surrounding tag): MT
- Auto-fill small untagged gaps: MT
- "Show only untagged time" triage: MT
- Productivity scores (productive/neutral/distracting): AW, MT, TI, QB
- Prebuilt categorization database of sites and apps: QB (8,100+), AW (preset category sets)
- Name aliases and mapping rules (merge project/language names): WK
- AI categorization with no rules at all: DF, SP (pipes)
- Smart grouping suggestions: TI

### Reporting and visualization
- Swimlane timeline per source: AW, MT, TO, TI, DF (cards)
- Zoomable interactive timeline: TT, AW
- Top apps, titles, domains and categories summaries: AW, MT, TI, QB, TO
- Sunburst/treemap category charts: AW
- Calendar view: TG, TO
- Custom dashboards and widgets: TG, AW (custom panels), MT (shared dashboards)
- Trends over time (category per day/week): QB, TI; requested in AW
- Day-of-week and hour-of-day heatmaps: HK, WK (requested radar)
- Leaderboards: HK, WK
- Embeddable badges: WK, HK
- Daily menu-bar productivity score: QB
- Scheduled email reports: WK (weekly), MT Server (per user)
- Scheduled automatic exports: QB
- Query DSL/query explorer with saved presets: AW
- CLI reports: AR, SS, TW, TT
- Report rounding (e.g. 6-minute increments): TI, MM
- Weekly analytics and distraction tracking: DF, QB

### Manual time, projects and billing
- Manual time entries: MT, TI, TT, TG, KI, SO, SUP, QB, TW, TS
- Start/stop timers: TI (web), TT, KI, SO, SUP, TS, AW (stopwatch)
- Server-persistent timers: KI, SO, HN TimeTracker
- Punch clock and work hours/overtime/breaks: KI, TS, MT
- Leave/half-day leave: MT Server
- Task-based tracking with estimates: SUP, SO (tasks), KI (tasks plugin)
- Pomodoro/timeboxing/day planner: SUP, TT
- Break reminders: SUP, TS
- Clients/customers and projects: KI, SO, MT, TI, QB
- Billable flags and hourly rates: KI, SO, MT, TI, QB
- Billable hours grouped by category, with export: AW (BillingView)
- Budgets (time or money): KI
- Invoices: KI, QB, MT Server, TI (via GrandTotal)
- Expenses: KI
- Timesheet approval: KI (plugin)
- Customer portal: KI
- Turn automatic activity into time entries: SO, MM, MT, TI, DF (timeline cards)

### Goals and alerts
- Daily/weekly/monthly targets: TT, WK (requested), QB
- Usage-threshold alerts: MT, QB, AW (aw-notify)
- Category-time notifications and summaries: AW (aw-notify)
- Long-running-timer reminders (requested): TT
- Habit tracking: SUP

### Integrations, API and export
- REST/JSON API: AW, KI, WK, TT, SP, TI (Connect), SUP (requested), MT Server
- GraphQL API: TG
- Client libraries/SDKs: AW (Python/JS), SP (JS/TS)
- Raw SQL access to the local database: SP
- MCP server for AI assistants: SP, MT (desktop and Server), TI; community for AW
- Plugins/extensions: AW (watchers), SUP, KI (marketplace), SP (pipes)
- Issue-tracker import (Jira/GitHub/GitLab/Linear/ClickUp…): SUP, TI, MT, MM
- Two-way sync with PM or legal tools: TI (Connect), MT (SingleCase)
- Push time to 100+ tools (Harvest, Toggl, QuickBooks…): MM
- Zapier/IFTTT/AppleScript: TI, QB
- Webhooks: requested in KI
- Prometheus export: WK; AW (third-party aw-sync-suite)
- Import from other trackers (Toggl, Clockify, WakaTime, CSV): SO, WK, HK
- Heartbeat relay/forwarding to another server: WK, HK
- CSV export: KI, TT, QB, TI, AW (partial), SO; requested for TG
- PDF/XLSX/DOCX/HTML export: KI, TI, TT (PDF)
- JSON export/import of raw data: AW, QB, AR (dump)
- Markdown/iCal export: DF (Markdown; iCal requested)
- CalDAV/calendar sync: SUP (basic); requested for KI, TG, DF

### Auth and multi-user
- Multi-user accounts: WK, HK, TG, TT, KI, SO, MT Server, CA
- Roles and permissions: KI, SO, MT Server
- Teams with aggregate views: MT, TI, KI, SO; requested for WK, TG, TT
- Shared timesheets and reports: MT (shared reports); requested for TG
- OIDC/SSO: WK; KI (SAML/LDAP; OIDC requested); SO (SSO)
- Trusted reverse-proxy header auth: WK, TT
- WebAuthn/2FA: WK (WebAuthn), KI (2FA)
- API keys/tokens: WK, HK, KI, TT

### AI
- AI daily summaries and recaps: AW (client-side), TI, SP, DF, MT (via MCP)
- Natural-language chat over activity history: DF, SP, MT/TI (via MCP)
- AI-generated timeline with no rules: DF
- Standup and meeting notes generation: DF, SP
- Local LLM support (Ollama/LM Studio): DF, SP
- Semantic/OCR search of screen history: SP, OR

### Platform and UX
- Windows/macOS/Linux desktop: AW, SP, MT, MM, TO, SUP, CA
- macOS only: TI, QB, DF
- Android: AW, MT, SUP
- iOS: MT, SUP; TI (Screen Time import)
- Web dashboard: AW (local), MT Server, WK, HK, TG, TT, KI, SO, TI (web app)
- i18n: AW, KI (30+ languages), QB (invoices in 18 languages)
- Themes: TG, SUP
