# 03 — Commercial automatic / productivity / screen-time trackers

Research date: 2026-09-12. Sources are review sites, vendor pages, forums (links inline). Pricing moves often; treat numbers as "as of mid/late 2026". Items marked *(unverified)* came from a single third-party source.

Eunomia reference point: self-hosted, multi-user, Electron desktop agent (Win/mac/Linux: focused app + window title + contexts like browser site / open project), Android agent (UsageStatsManager), Postgres, web dashboard, categories, regex auto-categorization rules, rollups, ignore/redact privacy lists.

---

## 1. Personal automatic trackers (closest competitors)

### RescueTime
- **Platforms:** Windows, macOS desktop; iOS + Android apps (mobile data siloed, low store ratings 2.7 iOS / 3.3 Android). **Linux dropped in 2024** — still requested on their forum as of Aug 2026. ([help](https://help.rescuetime.com/article/117-linux), [forum](https://community.rescuetime.com/t/rescuetime-on-linux/179))
- **Captures:** app names and website domains/time; explicitly *not* keystrokes, form input, screenshots, page content. Offline/manual time entries. ([rescuetime.com](https://www.rescuetime.com/))
- **Reporting:** Productivity report, daily pattern report, timeline/calendar view of work hours, custom categories, weekly email.
- **Productivity scoring:** **Productivity Pulse** 0–100 = time-weighted average over 5 levels (very distracting 0 … very productive 4), `((vd*0+d*1+n*2+p*3+vp*4)/(total*4))*100`. Level inherited from category, overridable per activity. Newer UI renames levels to Focus Work / Other Work / Neutral / Personal / Distracting. ([help](https://help.rescuetime.com/article/73-how-is-my-productivity-pulse-calculated))
- **Goals/alerts/focus:** goals (e.g. at least N hours focus work, under N hours distracting) with alerts; FocusTime sessions that block sites/apps; "real-time alerts" on poor focus patterns; burnout/overwork warnings; "The Assistant" guidance.
- **AI:** light — reviewers say it has *not* shipped AI summaries/smart categorization/AI timesheets comparable to competitors; "Smart Fill hints" for timesheets.
- **Calendar:** calendar view of work; team calendar.
- **Team:** Team plans with team productivity report, key tools & categories, RBAC.
- **Timesheets module:** projects/clients, billable rates, rounding.
- **Integrations/export:** API historically (data API), Zapier-style integrations; CSV export *(details unverified 2026)*.
- **Privacy:** cloud-only; "never shared, sold, or used for advertising".
- **Pricing:** Solo Focus $7/mo annual ($9 monthly), Solo+ $12/$15; Team Focus $10/$12 per user, Team+ $16/$18; 14-day trial. Free "Lite" gutted/hidden since 2023. ([pricing](https://www.rescuetime.com/pricing))
- **Standout:** the original "productivity score" + goals model; long history.
- **Complaints:** removal of free plan; price for individuals; categorization of custom/internal web apps lands in "Uncategorized", neutral sites mislabeled; mobile sync issues/data loss; Linux abandonment; perceived stagnation vs AI-era tools. ([connecteam](https://connecteam.com/reviews/rescuetime/), [offerseye](https://offerseye.com/rescuetime/), [timing blog](https://timingapp.com/blog/rescuetime-alternatives/))

### Rize
- **Platforms:** macOS (10.14.6+), Windows 10/11; Linux "coming soon"; mobile app only on Enterprise. No web tracker. ([pricing](https://rize.io/pricing))
- **Captures:** foreground app, website/URL, document; calendar events. No screenshots/keystrokes/screen content.
- **Reporting:** daily/weekly/monthly reports (emailed PDFs), client reports & scheduled reports (PDF/CSV) on Pro, "AI efficiency dashboard", personal trends.
- **Scoring:** **Focus Quality Score** /100 from ~20 attributes (sustained single-app focus vs fragmented switching); per-session breakdown of focus vs distracting categories, context-switch count, top interrupting apps/sites. ([Rize productivity](https://rize.io/features/productivity), [Ness Labs](https://nesslabs.com/rize-featured-tool))
- **Goals/alerts/focus:** automatic **sessions** (focus / meeting / break), session timer, smart break reminders tuned to habits, "worked N hours" alerts, **Distraction Blocker** triggered by detected context-switch patterns, focus music.
- **AI:** AI auto-categorization & tagging to client/project/task with confidence scores; AI-generated entry descriptions; "AI chat" over your data; "AI automations & agents"; **metered by AI credits** (500/1,000/3,000 per month). ([changelog](https://rize.io/changelog/the-rize-session-timer))
- **Calendar:** Google/Outlook; meetings become sessions, event text scanned for project keywords.
- **Team:** team plan; pending-entry review panel docked to day calendar; admins see only entries tagged to team clients/projects, personal activity stays private.
- **Integrations/export:** ClickUp (2-way), Asana, Linear, QuickBooks, Slack, Zapier; API, webhooks, **MCP server** (Pro+); CSV/PDF exports.
- **Privacy:** cloud (AWS), encrypted at rest/in transit; SOC 2, SSO/SCIM on Enterprise.
- **Pricing:** Basic $9.99/mo annual ($12.99 monthly), Pro $23.99/$27.99, Max $39.99/$47.99; Team $29.99/$39.99 per seat; 7-day trial, no free tier.
- **Standout:** focus-quality metric + automatic session segmentation + break coaching; MCP.
- **Complaints:** expensive, AI categorization turned into a consumable (credits run out); no mobile/web/Linux; setup/tweaking categories "annoying and a waste of time"; no free tier. ([thebusinessdive](https://thebusinessdive.com/rize-review), [cronushq](https://cronushq.com/blog/best-rize-io-alternatives), [checkthat](https://checkthat.ai/brands/rize/reviews))

### Timely (Memory tracker + AutoSheet)
- **Platforms:** Memory desktop tracker for Windows/macOS; web app; iOS/Android apps (timer/entry). Integrations capture cloud activity (Gmail, calendar, Zoom, Teams…).
- **Captures:** each "memory" = app/website + document/page title + start + duration; grouped into continuous blocks per app; idle detection; location tracking. ([Memory 101](https://www.timely.com/help/handbook/autosheet/memory-101/))
- **Reporting:** snapshot reports, project dashboards, budget tracking, people dashboard, capacity, live & branded reports; CSV/PDF/XLS export.
- **Scoring:** none per se — oriented to billable time, utilization/capacity.
- **AI:** **AutoSheet** — drafts a complete timesheet from memories for one-click review; 2026 "AI Timesheet Assistant" with three drafting styles; AI project categorization learns from past logging. ([hubstaff blog](https://hubstaff.com/blog/best-ai-time-tracking-software/))
- **Calendar/meetings:** Google/Outlook calendar, Zoom, Teams imported onto timeline.
- **Team:** capacity planning, team leads, locked entries, required notes, Tasks add-on ($5/person).
- **Integrations:** 50+ (Asana, Jira, ClickUp, Linear, monday, Gmail, GCal, Zoom, Teams, QuickBooks).
- **Privacy:** strong "privacy promise": Memory timeline 100% private to the individual; managers see only entries the user logs; no screenshots/keystrokes; data deletable. Cloud (AWS), GDPR/SOC2. ([privacy](https://www.timely.com/privacy-at-timely/))
- **Pricing:** Starter $9/user annual ($11 monthly, max 5 users/20 projects), Premium $16/$20, Unlimited $22/$28, Enterprise custom; 14-day trial. ([pricing](https://www.timely.com/pricing))
- **Standout:** "private raw timeline → user-approved public timesheet" split is the canonical ethical team model.
- **Complaints:** pricey per-seat and forced tier jumps; add-on costs; struggles with short activities & phone calls; AI accuracy; no offline tracking; limited advanced reporting. ([G2](https://www.g2.com/products/timely-time-tracking/reviews?qs=pros-and-cons), [connecteam](https://connecteam.com/reviews/timely/))

### Timing (macOS)
- **Platforms:** macOS native only (not Electron); web app; imports iPhone/iPad usage via **Apple Screen Time import** (only third-party Mac app that can). ([timingapp.com](https://timingapp.com/))
- **Captures:** apps, window titles, **full document file paths**, full URLs, idle time, calls (Zoom/Teams/Slack/Meet), automatic meeting detection. Private/incognito tabs auto-excluded; custom exclusion lists.
- **Reporting:** timeline with drag-drop assignment, smart grouping, customizable reports (PDF/XLSX/CSV/HTML), productivity score over time, filters.
- **Rules:** ⌥-drag to create **rules** that permanently auto-assign activity to projects (keyword/app/path/URL matching); suggestions from patterns; "Entry-O-Matic".
- **AI:** **AI Summaries** — natural-language recaps of the day, grouping topics, surfacing distractions/trends; **MCP** integration on Connect plan so an AI assistant can query/manage your time.
- **Calendar:** Calendar & Reminders integration.
- **Team:** shared projects; team admins see only aggregate time on team projects.
- **Integrations:** GrandTotal invoicing, ClickUp/Linear (1-way on Expert, 2-way + Clio on Connect), Web API, AppleScript, Zapier.
- **Privacy:** local by default, never leaves Mac unless sync is enabled.
- **Pricing:** Professional ~$10–11/mo (1 Mac), Expert ~$14 (2 Macs), Connect ~$20/user (3 Macs); ≤20% annual discount; 30-day trial; lifetime licenses discontinued. ([pricing](https://timingapp.com/pricing?lang=en))
- **Standout:** rule creation directly from timeline, file-path granularity, Screen Time import, local-first.
- **Complaints:** Mac-only; switch from one-time to subscription; UI initially overwhelming; per-Mac device caps. ([getapp](https://www.getapp.com/project-management-planning-software/a/timing/), [alternativeto](https://alternativeto.net/software/timing-lite/about))

### Memtime
- **Platforms:** Windows (incl. Server 2016–2025, i.e. terminal servers), macOS, **Linux**. ([memtime.com](https://www.memtime.com/))
- **Captures:** active window only (with input), program, file names, email subjects, browser tab titles, meetings/video calls, phone calls.
- **Reporting:** zoomable visual timeline in 5/6-minute increments for any past day; drag-drop into time entries.
- **Scoring/focus/AI:** none (no AI interpretation).
- **Integrations:** 100+ (Harvest, Jira/Tempo, Toggl, Clockify, Asana, ClickUp, Xero, QuickBooks Time, Clio, Autotask, Figma…) — the product's main value is *transferring* entries into existing PM/billing tools.
- **Privacy:** **offline-first, data only on device**; not accessible to bosses or Memtime; marketed as unusable for monitoring.
- **Pricing:** Basic ~$12/user/mo (2-yr) or $14 annual; Connect $18/$21; Premium up to ~$29–35; no free plan, no monthly. ([timely comparison](https://www.timely.com/blog/memtime-pricing/))
- **Standout:** Linux + terminal-server support, strictly local.
- **Complaints:** no AI, dated UI, long commitments/no monthly billing, no cross-device aggregation (by design).

### WakaTime (developer-specific)
- **Platforms:** 90+ editor/IDE plugins (open source), plus desktop app, browser extensions, terminal; web dashboard. 600+ languages.
- **Captures:** heartbeats — project, file, language, branch, editor, OS, machine, commits/PRs; **AI coding detection** (Claude Code, Copilot, AI chat panes) → AI-vs-human code insights, AI spend. ([HN](https://news.ycombinator.com/item?id=44630481))
- **Reporting:** dashboards by project/language/editor/file, weekly/daily email reports, shareable embeddable charts & badges, **yearly "Wrapped"**, meetings vs coding comparison.
- **Goals:** coding-time goals (1 free / 3 basic / unlimited premium); public & private leaderboards.
- **Team:** team dashboards, AI adoption insights, commit/PR stats, SSO/SCIM on Business.
- **Integrations/export:** GitHub/GitLab/Bitbucket, Slack, calendar, API; data export (Premium+).
- **Privacy:** per-config `hide_file_names`, `hide_project_names` (random names), `hide_project_folder` (relative paths), `hide_branch_names`, POSIX-regex `exclude`/`include`, offline queue. ([USAGE.md](https://github.com/wakatime/wakatime-cli/blob/develop/USAGE.md)) Cloud-only; self-host clones exist (Wakapi, Hakatime) using the same plugin protocol.
- **Pricing:** Free (1 week history), Basic $8.25/mo annual ($9) 2 weeks, Premium $12.83/$14 full history + AI insights + export, Team $19.25/$21 per dev, Business $22/$24. ([pricing](https://wakatime.com/pricing))
- **Standout:** open-source plugin ecosystem + heartbeat protocol; leaderboards; AI-coding attribution.
- **Complaints:** history paywall (free sees 1 week); cloud storage of code metadata; plugin creates `.wakatime-project` files; notoriously gameable "time", leaderboard vanity.

---

## 2. AI-first trackers (2024–2026 wave)

### Cronus
- macOS (Windows unclear, mobile "coming soon"). Reads app name, window title, browser URL via Accessibility only (no Screen Recording permission). ([cronushq.com](https://cronushq.com/))
- **LLM categorization relative to user-stated goals/projects** set during onboarding (reasoning about context rather than domain rules) — e.g. productive vs doom-scroll YouTube/social.
- Notch Timer (live work/distraction counter, gamified), goal-aware distraction nudges, calendar AI for off-computer time, **on-device redaction** before upload, pause anytime. $6/mo, 21-day trial.

### Dayflow (open source, MIT)
- macOS 14+, Windows waitlist. **Records screen at ~1 fps / 1 frame per 10s**, sends batches every ~15 min to a chosen VLM (local Ollama/LM Studio, Gemini, ChatGPT, Claude) that writes **timeline cards** with summaries; categories Research/Coding/Communication/Planning/Distraction. ([GitHub](https://github.com/JerryZLiu/Dayflow), [dayflow.so](https://www.dayflow.so/))
- Daily/weekly summaries, chat with your day, GitHub-style activity grid, **one-click standup** (yesterday highlights, today priorities, blockers), distraction limits. Local storage; free + Pro tier. ~6.9k GitHub stars.

### Chronoid
- macOS, local-only storage, **one-time purchase**. Automatic app/site/document tracking, auto-assign to client projects, AI chat over local data ("what distracted me most?"), Pomodoro & scheduled focus sessions, website blocker. ([chronoid.app](https://www.chronoid.app/))

### Screenpipe
- Open-source, local 24/7 screen + audio capture with OCR/Whisper; searchable "digital memory"; "pipes" for meeting notes, daily digests, time tracking; **MCP** so Claude Desktop etc. can query screen history. Heavy CPU/GPU/disk. Free core + paid managed/support tiers. ([screenpipe blog](https://screenpipe.com/blog/best-ai-screen-recorder-2026))

### Carly AI (agent-style timesheets)
- No desktop capture; reads calendar, CRM, meeting transcripts, task systems to **autonomously generate time entries** into Toggl/Clockify/Harvest etc.; learns project↔client mapping. ~$35/mo. ([usecarly](https://www.usecarly.com/blog/best-ai-tools-time-tracking/))

### Incumbents bolting on AI (2025–2026)
- **Toggl Track:** desktop Activity Timeline (apps/sites >10 s, private), AI Autotracker suggestions, rules; free for ≤5 users. ([timely comparison](https://www.timely.com/blog/clockify-vs-toggl/))
- **Clockify:** auto tracker recording apps/sites but entries still manual; screenshots/GPS/kiosk on paid.
- **TimeCamp:** background tracking with keyword-based auto-assignment to projects, productivity ratings, AI features marketed.
- **DeskTime:** app/URL logs, arrival & effectiveness metrics, AI work summaries.
- **Early (ex-Timeular):** Bluetooth tracking cube; semi-automatic.

---

## 3. Employee-monitoring end (brief)

| | Hubstaff | Time Doctor | Monitask |
|---|---|---|---|
| Pricing (annual, /seat/mo) | Starter $4.99, Grow $7.50, Team $10, Enterprise $25 | Basic $6.67, Standard $11.67, Premium $16.70 | Pro $5.99, Business $8.99, Enterprise $19.99 |
| Captures | timer-based; keyboard/mouse **activity %**; up to 3 screenshots/10 min (blurrable); apps/URLs; GPS/geofencing (mobile) | screenshots (blur/disable per user), app/URL, idle, offline | frequent screenshots, keyboard activity, search queries |
| Scoring | activity %, role-based productive/unproductive app classification | manager-set productivity ratings per app; **Benchmarks AI** vs 250k users | activity levels |
| AI | Insights add-on: focus time, meeting load, AI-tool usage tracking, burnout/capacity signals, anomaly detection | **Unusual Activity Report** (ML on input patterns to catch mouse jigglers), burnout risk | minimal |
| Other | payroll, invoicing, scheduling, attendance | payroll, distraction alerts, integrations | lightweight |

Sources: [insightful](https://www.insightful.io/blog/hubstaff-vs--time-doctor), [Time Doctor UAR](https://www.timedoctor.com/blog/unusual-activity-report/), [Hubstaff Insights](https://hubstaff.com/insights), [hubstaff vs monitask](https://hubstaff.com/hubstaff-vs-monitask).

**Complaints:** "bossware" — Hubstaff 2.3/5 Trustpilot, WSJ/NPR stories on morale damage; 2025 xAI required tutors to install Hubstaff on personal laptops ([Wikipedia](https://en.wikipedia.org/wiki/Hubstaff)); activity % punishes reading/thinking/meetings; screenshots of personal devices. A counter-market of **mouse-jiggler/activity simulators** (e.g. Lumous, $4–5/mo, hides from tracker screenshots) exists specifically to defeat these metrics ([lumous](https://lumous.app/)) — evidence that input-activity scoring is gamed.

---

## 4. OS-level screen time

### Apple Screen Time (iOS/iPadOS 26, macOS Tahoe)
- **Captures:** per-app and per-website (Safari) usage, pickups, first app after pickup, notifications per app, category totals; aggregated across devices on the same Apple ID ("share across devices").
- **Reports:** daily/weekly charts, weekly summary notification, averages vs last week.
- **Limits/blocking:** Downtime schedules, App Limits per app/category (iOS 26: **0-minute limit = full block**), Always Allowed, Communication Limits, Content & Privacy restrictions; Family Sharing remote management (iOS 26 fully remote child setup; PIN required to revoke; in-app browsers blocked in Downtime). ([techlockdown](https://www.techlockdown.com/articles/ios-26-screen-time-changes))
- **Third-party:** Screen Time API (FamilyControls/DeviceActivity) powers Opal etc.; no raw data export (Timing uses an import workaround).
- **AI/team/integrations:** none; no export.
- **Pricing:** free.
- **Complaints:** inaccurate/phantom usage (esp. iOS 26.2 bug adding time never spent, limits firing early), usage during sleep hours, cross-device sync gaps and timezone issues, "one minute" limit applying to all apps, easy "ignore limit" bypass. ([Apple Community](https://discussions.apple.com/thread/255847988), [idownloadblog](https://www.idownloadblog.com/2026/03/12/fix-app-limits-not-working/), [macobserver](https://www.macobserver.com/tips/how-to/ios-screen-time-issue-one-minute-setting-affects-all-apps-on-iphone/))

### Android Digital Wellbeing
- **Captures:** screen time per app, unlocks, notifications received (same UsageStatsManager data Eunomia's Android agent reads); Chrome site time.
- **Controls:** daily **app timers** (app greys out/pauses until midnight), **Focus mode** (pause chosen apps + their notifications; scheduled), **Bedtime mode** (grayscale + DND, schedule, charging-trigger), pause app, work-profile toggle; Family Link for parental control. ([Google help](https://support.google.com/android/answer/9346420?hl=en))
- **AI/team/export:** none; no export; OEM variants (Samsung) differ.
- **Pricing:** free.
- **Complaints:** inaccurate totals that "auto-correct" on refresh, missing video time, trivially bypassable ("5 more minutes"/disable for today), occasional performance issues. ([Samsung community](https://r2.community.samsung.com/t5/Tech-Talk/Digital-wellbeing-data-inaccurate/m-p/8474850))

---

## 5. Focus / blocking tools

### Opal
- iOS (Screen Time API), Android, macOS. Focus Sessions (scheduled/timed), app groups blocking, **Deep Focus** (unbypassable), app limits, pickups & productive/distracting time analytics, focus-hours weekly report, gamification (gems, streaks, milestones), friction screens. ([makeheadway](https://makeheadway.com/blog/opal-app-review/))
- Pricing: free tier; Pro $99.99/yr or $19.99/mo; $399 lifetime.
- Complaints: subscription cost (category-wide #1 complaint), limits marked met without opening app (iOS 26 bug), bugs adding apps, bypassable non-deep sessions, weak Mac blocker (back-button loads blocked page). ([tryhugo](https://www.tryhugo.app/blog/opal-app-review-2026), [unstar](https://unstar.app/blog/opal-forest-freedom-one-sec-jomo-screen-time-apps-ranked-2026))

### Freedom
- Mac, Windows, iOS, Android, Chrome/Linux(browser); block sites, apps, or whole internet; unlimited blocklists; scheduled/recurring sessions; **synced sessions across up to 6 devices**; **Locked Mode** (no edits during session); ambient focus sounds. ([freedom.to](https://freedom.to/))
- Pricing: free limited; $8.99/mo, ~$3.33/mo annual, lifetime ~$99–199.
- Complaints: VPN-based mobile blocking drains battery and is flaky; Windows blocking weak/bypassable (other browser, kill process, uninstall); blocking doesn't fix impulse, binge after session. ([blok](https://www.blok.so/resources/freedom-app-review-does-blocking-websites-and-apps-actually-work))

### Cold Turkey Blocker
- Windows/macOS only. Block lists of sites **and desktop apps**, schedules, allowances, **locked blocks** (can't override, resist uninstall), **Frozen Turkey** (locks entire computer), usage statistics. Pro $39 one-time lifetime. Sister products: Writer, Micromanager. ([pricing](https://getcoldturkey.com/pricing/))
- Complaints: desktop-only (doesn't help phone), can be too strict (locked out), UI dated.

---

## 6. Timeboxing / planners that touch tracking

### Sunsama
- Guided daily planning/shutdown ritual; tasks pulled from Asana/Jira/Linear/Gmail/Notion etc.; **timeboxing onto Google/Outlook calendar**; tracks **actual time vs estimate per task** and planned-vs-done stats; weekly objectives. $20/mo ($16 annual *(unverified exact)*). ([morgen](https://www.morgen.so/blog-posts/sunsama-vs-motion))
- Complaints: expensive for a planner; manual effort; no automatic capture.

### Motion
- AI auto-scheduling of tasks around meetings, re-prioritizes on change; 2026 expanded into project management, AI notes, agent workflows. No actual-time measurement. $29–49/mo. Complaints: price, loss of control from auto-rescheduling, complexity.

---

## Key takeaways for Eunomia
1. **No commercial product combines self-hosted + multi-user + Linux + Android + desktop.** Linux is dropped (RescueTime) or "coming soon" (Rize); Memtime has Linux but is local-only single-device.
2. **Privacy split is the ethical team model:** private raw timeline, user-approved sharing (Timely, Rize team, Timing team). Input-activity scores/screenshots breed resentment and jiggler counter-tools.
3. **Rules from the timeline** (Timing ⌥-drag) and **LLM categorization with user goals** (Cronus, Rize) are the two categorization UX poles; metering AI (Rize credits) is resented — BYO model/local LLM (Dayflow) is appreciated.
4. **AI table stakes in 2026:** day summaries, chat-with-your-data, draft timesheets/standups, MCP server.
5. **Scores:** RescueTime Pulse (weighted levels) vs Rize Focus Quality (fragmentation/context switching). Both are explicable formulas worth copying.
6. OS screen-time tools are free but inaccurate, siloed, and unexportable — a cross-device, exportable, trustworthy record is a real gap.
7. Blocking is a separate, hard problem (bypasses, VPN battery drain); goals + nudges are cheaper to ship than enforcement.

---

## Feature superset

Abbreviations: RT RescueTime, RZ Rize, TL Timely, TM Timing, MT Memtime, WT WakaTime, CR Cronus, DF Dayflow, CH Chronoid, SP Screenpipe, CA Carly, TG Toggl Track, CK Clockify, TC TimeCamp, DT DeskTime, HS Hubstaff, TD Time Doctor, MK Monitask, AST Apple Screen Time, DW Android Digital Wellbeing, OP Opal, FR Freedom, CT Cold Turkey, SU Sunsama, MO Motion.

### Platforms & capture
- Windows desktop agent — RT, RZ, TL, MT, WT, TG, CK, TC, DT, HS, TD, MK, FR, CT, OP(no)
- macOS desktop agent — RT, RZ, TL, TM, MT, WT, CR, DF, CH, SP, TG, CK, TC, DT, HS, TD, MK, AST, OP, FR, CT
- Linux desktop agent — MT, WT, SP, (RT dropped 2024; RZ "coming soon"), HS, CK *(HS/CK unverified)*
- Windows Server / terminal-server support — MT
- Android usage capture — RT, DW, OP, FR, HS (GPS), RZ (Enterprise only)
- iOS usage capture — RT, AST, OP, FR; import of iOS Screen Time into desktop — TM
- Editor/IDE plugins (heartbeats) — WT
- Browser extension for URL capture — WT, FR, TG, CK *(varies)*
- Foreground app name — all automatic trackers
- Window title — TL, TM, MT, CR, RZ, TG
- Full URL / domain — RT (domain), RZ, TL, TM, CR, HS, TD
- Document / full file path — TM, MT, TL, RZ
- Email subject — MT
- Project / language / branch / file for code — WT
- Commits & PR stats — WT
- AI coding tool detection (Claude Code, Copilot) / AI-vs-human code — WT; AI-tool usage tracking org-wide — HS
- Meetings / video-call detection — TM, MT, TL, RZ (calendar), WT (meetings vs coding)
- Phone call tracking — TM, MT
- Idle detection / exclude idle — TM, TL, TG, CK, TD, HS
- Offline tracking with later sync — WT, TD, MT (always local)
- Manual / offline time entries — RT, TM, TL, TG, CK
- Manual timer alongside automatic — TM, TL, TG, CK, HS
- Screen recording / screenshots analyzed by VLM — DF, SP
- Audio transcription capture — SP
- Periodic screenshots for managers — HS, TD, MK, CK
- Keyboard/mouse activity % — HS, TD, MK
- Search query capture — MK
- GPS / geofencing — HS, CK, TL (location)
- Pickups / unlocks count — AST, DW, OP
- Notifications-per-app count — AST, DW
- Physical tracking device (cube) — Early

### Organization & categorization
- User-defined categories — RT, RZ, TM, TL, DF (fixed set), TC
- Productivity level per activity/category (productive ↔ distracting) — RT, TM, HS, TD, TC, DT, OP
- Manager-assigned productivity ratings per role — HS, TD
- Keyword/rule-based auto-assignment — TM (⌥-drag rules), TC, TG, RT (default classifications), WT (regex include/exclude)
- Rule creation directly from timeline selection — TM
- Pattern-learned suggestions — TM, TL, TG, RZ
- LLM/AI auto-categorization — RZ, TL, CR, DF, CH
- Goal/project-aware AI categorization (user describes projects/goals) — CR, RZ
- Context-sensitive same-site classification (research vs entertainment YouTube) — CR, DF
- Confidence scores on AI assignment — RZ
- Clients / projects / tasks hierarchy — RZ, TL, TM, MT, RT (Timesheets), TG, CK, HS
- Tags — TL, RZ
- Automatic session segmentation (focus / meeting / break) — RZ, DF (cards)
- Smart grouping of consecutive activity — TM, TL
- Billable rates / billing status / rounding — RT, TL, TM, HS, TG

### Reporting & insights
- Daily timeline view — TM, TL, MT, RT, RZ, DF, TG
- Zoomable/fixed-increment timeline (5–6 min) — MT
- Daily/weekly/monthly dashboards — all
- Emailed daily/weekly reports (PDF) — RT, RZ, WT
- Scheduled & client reports — RZ, TL (branded/live)
- Customizable reports — TM, TL
- Export CSV/PDF/XLSX/HTML — TM, TL, RZ, WT (Premium), TG
- Shareable/embeddable public charts & badges — WT
- Yearly "Wrapped" recap — WT
- GitHub-style activity heatmap — DF
- Week-over-week comparison / averages — AST, DW, RT
- Pickups & most-notifying apps — AST, DW
- Planned vs actual / estimate accuracy — SU
- Capacity, utilization, budget tracking — TL, HS
- Team benchmarks vs industry data — TD, HS (Global Work Index)
- History limits by tier — WT

### Scores
- 0–100 weighted productivity score — RT (Productivity Pulse), TM (productivity score), DT (effectiveness)
- Focus quality score from fragmentation/context switches — RZ
- Context-switch count & top interrupters — RZ
- Deep-work vs shallow-work classification — RZ, HS (focus time)
- Activity % from input — HS, TD, MK
- Gamification (streaks, gems, milestones, live counters) — OP, CR (Notch Timer), WT (leaderboards)
- Leaderboards (public/private) — WT

### Goals, alerts, focus
- Time goals (min focus / max distraction / coding hours) — RT, WT, RZ, OP
- Real-time alerts / nudges on distraction — RT, RZ, CR, TD
- Hours-worked / overwork / burnout alerts — RT, RZ, TD, HS
- Break reminders (adaptive) — RZ
- Focus session timer / Pomodoro — RT, RZ, CH, TG, OP, FR
- Focus music / ambient sounds — RZ, FR
- Website blocking — RT, RZ, CH, OP, FR, CT
- Desktop app blocking — RT, CT, FR, OP (mobile apps)
- Automatic blocking triggered by detected distraction pattern — RZ
- Scheduled / recurring block sessions — FR, CT, OP, CH, DW (Focus mode), AST (Downtime)
- Locked / unbypassable sessions — FR (Locked Mode), CT (locked blocks), OP (Deep Focus)
- Whole-computer lockout — CT (Frozen Turkey)
- Block entire internet — FR
- Cross-device synced blocking — FR
- Daily per-app time limits — AST, DW, OP, CT (allowances)
- Downtime / bedtime (grayscale, DND) — AST, DW
- Distraction limits per day — DF
- Parental / family remote management — AST, DW (Family Link)
- Doom-scroll detection — CR

### AI
- Natural-language day/week summaries — TM, DF, DT, SP (digests)
- Chat with your activity data — RZ, DF, CH
- AI-drafted timesheets / time entries — TL (AutoSheet), RZ (entry descriptions), CA (from calendar/CRM), TG (Autotracker suggestions), RT (Smart Fill hints)
- Standup / progress update generation — DF
- AI automations / agents — RZ, MO
- MCP server exposing time data to AI assistants — RZ, TM, SP
- BYO model / local LLM option — DF, SP
- Metered AI credits — RZ
- Anomaly / jiggler detection — TD (Unusual Activity Report), HS
- Burnout/capacity prediction — TD, HS, RT
- AI auto-scheduling of future time — MO
- AI productivity insights/recommendations — RZ, RT (Assistant), CR

### Calendar & meetings
- Google/Outlook calendar import into timeline — RZ, TL, TM, RT, TG, CR, CA
- Meeting events auto-attributed to projects via keywords — RZ
- Zoom/Teams activity import — TL, TM
- Timeboxing tasks onto calendar — SU, MO
- Team calendar — RT

### Team features
- Private personal timeline; managers see only user-shared/tagged entries — TL, RZ, TM (aggregate only)
- Team dashboards / aggregated reports — RT, WT, RZ, TL, HS, TD
- Role-based access control — RT, TL, HS
- Team leads, locked entries, required notes, approvals — TL, HS
- Pending-entry review panel — RZ
- Shared projects across team — TM, TL
- SSO / SCIM — RZ (Ent), WT (Business)
- Payroll / invoicing / attendance — HS, TD, TL, TM (GrandTotal)
- Private leaderboards — WT

### Integrations & export
- PM tool sync (Asana, Jira, ClickUp, Linear, monday) — TL, RZ, TM, MT (100+), TG, SU
- Accounting/invoicing (QuickBooks, Xero, FreshBooks) — TL, RZ, MT, HS
- Push entries into other time trackers (Toggl, Harvest, Clockify, Tempo) — MT, CA
- Slack — RZ, WT
- Zapier — RZ, TM, RT
- Public REST API — RZ, TM, WT, RT
- Webhooks — RZ
- AppleScript / scripting — TM
- Open-source plugin protocol (self-host compatible) — WT (Wakapi), DF, SP
- Raw data export — WT, TM, TL, RZ; none for AST/DW

### Privacy posture
- No screenshots / keystrokes / content — RT, RZ, TL, TM, MT, CR
- Local-only storage by default — TM, MT, DF, CH, SP
- Opt-in cloud sync — TM
- Open-source / auditable — DF, SP, WT plugins
- Auto-exclude private/incognito tabs — TM
- User exclusion lists (apps/sites) — TM, WT (regex exclude)
- Obfuscate/hide names (file, project, branch, folder) — WT
- On-device redaction before upload — CR
- Pause tracking — CR, RZ, TL
- User can delete own data — TL, DF
- Anti-monitoring guarantee (data inaccessible to employer) — MT, TL
- Compliance (SOC 2, GDPR) — TL, RZ (Ent), CR (GDPR)

### Commercial model
- Free tier — WT, TG, CK, OP, FR, AST, DW, DF, SP, RT (Lite, hidden)
- One-time / lifetime purchase — CT, CH, OP ($399), FR
- Subscription only — RZ, TL, TM, MT, CR
- Per-device caps — TM (1–3 Macs), FR (6 devices)
- Long-term commitment discounts (2-year) — MT
