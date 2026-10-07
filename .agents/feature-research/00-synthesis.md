# Eunomia feature research — synthesis

Research only (2026-09-12). Nothing here is implemented. Sources:

| File | Contents |
| --- | --- |
| [01-eunomia-features.md](01-eunomia-features.md) | What Eunomia does today, grounded in code, with maturity tags + absences |
| [02-competitors-local-first.md](02-competitors-local-first.md) | Loop 1: ActivityWatch, ManicTime, Timing, Screenpipe, Dayflow, Arbtt, Wakapi, Traggo, TimeTagger, Kimai, solidtime desktop, Tockler… |
| [03-competitors-commercial-automatic.md](03-competitors-commercial-automatic.md) | Loop 1: RescueTime, Rize, Timely, WakaTime, Memtime, Hubstaff-class, Screen Time/Digital Wellbeing, Opal/Freedom/Cold Turkey, AI-first (Cronus, Dayflow, Chronoid…) |
| [04-competitors-timesheet.md](04-competitors-timesheet.md) | Loop 1: Toggl, Clockify, Harvest, Kimai, Solidtime, Everhour, Tackle, EARLY, TimeCamp, Super Productivity… |
| [05-loop2-capture-gaps.md](05-loop2-capture-gaps.md) | Loop 2: Wayland, browser extension, media/meeting-aware AFK, iOS, signing/auto-update, WakaTime API, calendars |
| [06-loop2-local-first-data.md](06-loop2-local-first-data.md) | Loop 2: local-first ideals scorecard, standalone mode, sync engines, E2EE, export/import, deletion, install paths |
| [07-loop2-insights-ai-ux.md](07-loop2-insights-ai-ux.md) | Loop 2: timeline UX, categorization fatigue, focus metrics, goals/digests, AI/MCP, privacy-respecting sharing, onboarding |

Each loop-1 file ends with a deduped "Feature superset" list.

---

## 1. Where Eunomia sits

Eunomia is an **automatic, self-hosted, multi-user, cross-device activity tracker**
(Windows/Linux desktop + Android → Postgres server → web dashboard + GraphQL + read-only MCP).

**The market gap it already occupies** (confirmed independently by three agents):
no other tool combines *automatic capture* + *a self-hosted server* + *multiple users* +
*Linux and Android*. ActivityWatch has had a sync issue open for 9 years (180 👍);
ManicTime Server is the closest but proprietary and Windows-centric; Timing is macOS-only;
RescueTime dropped Linux; Rize has no Linux/mobile; commercial tools are all SaaS with
price hikes (Harvest, Clockify, RescueTime, Timing) driving people to look elsewhere.

**What it is not (yet):** local-first, a timesheet/billing tool, a focus/wellbeing tool,
or an insight/AI tool. It records and aggregates well; it doesn't yet help the user *act*
on the data, or *own* it outside the server.

## 2. Comparison matrix (condensed)

✅ solid · 🟡 partial/basic · ❌ absent. AW = ActivityWatch (0.14 beta), MT = ManicTime (+Server), TM = Timing, RT = RescueTime, TG = Toggl Track, ST = solidtime.

| Capability | Eunomia | AW | MT | TM | Rize | RT | TG | ST |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auto app/window capture | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 |
| Browser URL capture | 🟡 host only, no Linux | ✅ ext | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Linux / Wayland | 🟡 X11 only | 🟡 | ❌ | ❌ | ❌ | ❌ | 🟡 | ✅ |
| macOS build | ❌ (code ready) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Android | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 | ✅ | ❌ |
| iOS | ❌ (not really possible) | ❌ | ❌ | 🟡 via Mac | ❌ | 🟡 | ✅ manual | ❌ |
| Editor/IDE plugins | ❌ | 🟡 | 🟡 git | 🟡 paths | ❌ | ❌ | ❌ | ❌ |
| Media/meeting-aware AFK | ❌ | 🟡 audible tab | ✅ audio | ✅ calls | ✅ | 🟡 | ❌ | ❌ |
| Works with no server | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Multi-device merge | ✅ | ❌ (sync beta) | ✅ server | 🟡 sync | ✅ | ✅ | ✅ | ✅ |
| Multi-user self-hosted | ✅ | ❌ | ✅ paid | ❌ | ❌ | ❌ | ❌ | ✅ |
| Privacy ignore/redact at source | ✅ | ✅ 0.14 | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ |
| Regex/auto rules | ✅ | ✅ | ✅ retro | ✅ | AI | ✅ | 🟡 | ❌ |
| Default rule pack / pre-classified DB | ❌ | 🟡 | 🟡 | ✅ | AI | ✅ | ❌ | ❌ |
| Timeline / day view | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ❌ |
| Edit/delete time ranges | ❌ | 🟡 | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ |
| Manual entries / timers | ❌ | ❌ | ✅ | ✅ | 🟡 | 🟡 | ✅ | ✅ |
| Projects / clients / billable | ❌ | 🟡 0.14 | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Productivity/focus score | ❌ | ❌ | ❌ | 🟡 | ✅ | ✅ | ❌ | ❌ |
| Goals / limits / alerts | ❌ | 🟡 0.14 | ❌ | 🟡 | ✅ | ✅ | 🟡 | ❌ |
| Digests / scheduled reports | ❌ | ❌ | 🟡 | 🟡 | ✅ | ✅ | ✅ | 🟡 |
| Export (CSV/JSON) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Import from other trackers | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | ✅ |
| Shared/read-only report links | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ | ✅ | ✅ |
| Teams w/ privacy (aggregates only) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| API | ✅ GraphQL | ✅ REST | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MCP server | 🟡 read-only | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| AI summaries / categorization | ❌ | 🟡 0.14 | 🟡 | ✅ | ✅ | 🟡 | ✅ | ❌ |
| Signed installers / auto-update | ❌ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## 3. What's "missing" for a local-first time tracker

Ordered by how badly the absence undermines the "local-first" claim, not by effort.

### 3a. Foundational (the data model blocks other features)

1. **No raw event history anywhere.** The server folds pings into `activities` and discards
   them (`apps/server/src/db/schema.ts:238`); the agent outbox deletes after upload and
   drops the oldest past 50k. Consequences: no rebuild after rule changes, no
   import/backfill (server rejects pings older than a device's last), no partial-day
   deletion of rolled-up data, no export of what was actually captured.
   → *Append-only ping log on the agent* (daily files, outbox = cursor) **and/or** raw
   pings server-side with a per-device replay (06 §rec 1–2).
2. **No ordering/sequence data.** Multi-open activities with overlapping spans keep
   *duration* but not *sequence*, so a timeline, context-switch counts, deep-work blocks,
   and "select a range and categorize it" are all impossible today.
   → `focus_segments` (one row per focus change, written in `fold.ts`, pruned with retention) (07).
3. **Server-wide timezone only.** Digests, day views and goals need per-user TZ (01, 07).

### 3b. Local-first ideals not met (Ink & Switch scorecard in 06)

4. **No standalone / serverless mode.** Nothing to see without a server. ActivityWatch,
   ManicTime, Timing and solidtime-desktop all work alone. The server already runs on
   PGlite in tests → an Electron-embedded server with "connect to a server later" that
   uploads the local log (06). Android: cached read-only dashboard until native PGlite.
5. **No export / import / account bundle.** Every competitor exports; backup is `pg_dump`.
   → Full account export (JSON bundle), ActivityWatch-bucket-compatible raw export,
   importers: ActivityWatch first, RescueTime second (06).
6. **No user-controlled deletion.** No per-range/app delete, no "off the record" pause,
   no per-user retention, no account deletion (01, 06).
7. **Encryption.** No at-rest story. Full E2EE would break server rules/rollups/MCP —
   don't. Do TLS guidance + at-rest + ManicTime-style per-device "what to send" levels
   (app only / + context / + title) (06).
8. **Longevity/licensing.** **The repo has no LICENSE file** — a trust issue for a
   privacy tool (Screenpipe's MIT→commercial switch drew heavy backlash) and a blocker
   for SignPath free OSS signing (05).

### 3c. Capture parity (05)

9. **Media/meeting-aware AFK** (S–M) — #4 complaint across local trackers.
10. **Local agent endpoint** (token-protected loopback) → enables a **browser extension**
    (fixes Linux/Firefox URLs, incognito handling, avoids double-counting), shell cwd
    hooks, and an **ActivityWatch-compatible listener** (reuse awatcher/aw-watcher-web as-is).
11. **Wayland** (GNOME ext via x-win, KWin script, wlr protocol) + note Electron idle is
    unreliable on Wayland, so AFK is probably wrong there today.
12. **Signed Windows builds + electron-updater**; **macOS build** ($99/yr, Screen Recording
    permission for titles).
13. **WakaTime-compatible heartbeat endpoint** — enrich editor activity with project/branch.
14. **ICS/CalDAV calendar import** (skip Google OAuth for self-hosters) — after timeline exists.
15. **iOS: accept it's not possible**; at most an experimental Mac-side Screen Time import.

## 4. Beyond local-first: improving the product for users

### Make the data useful (insights)
- **Uncategorized review queue** + category rename/edit + UI for existing `assignActivity` (S) — cheapest win against setup fatigue.
- **Starter rule packs** (versioned; app names, Android packages, hostnames) + **first-run checklist** (S–M). Time-to-first-insight is the onboarding metric that matters.
- **Category "kind"** (focus/work/neutral/personal/distracting) → goals, week-over-week trends, a transparent RescueTime-style pulse (S–M, computable from existing summaries).
- **Day timeline** with per-device lanes and drag-select → categorize/create rule/delete (M, needs `focus_segments`).
- **Transparent focus metrics**: deep-work blocks, switches/hour, top interrupters — show the formula, avoid opaque scores (M).
- **Retroactive rules with priorities** and field-targeted matching (app/title/URL), à la AW 0.14 and ManicTime.

### Nudge, don't police
- **Weekly email digest** + goal/limit alerts via agent notifications or webhooks (ntfy etc.) (M). Cross-device totals are something single-device tools can't do.
- **Explicit non-goals**: app/site blocking (leaky, top complaint category), keystroke/mouse "activity scores", screenshots, leaderboards. Position as anti-surveillance.

### AI, opt-in and bring-your-own-model
- MCP: agent-shaped queries (`daySummary`, `searchActivity`, `uncategorized`) + prompts (standup, weekly review, triage) (S); **scoped write tools** limited to categorization, API-key scope, dry-run preview (M).
- Optional OpenAI-compatible endpoint (Ollama documented): drafts rule suggestions and daily summaries only; by default sends app/context names + totals, not titles; never auto-applies (M).

### Bridge to timesheets (optional track)
Timer vendors are all converging on "capture locally → review → convert to entries" (Toggl Timeline, Clockify Auto Tracker, solidtime desktop, Timely AutoSheet). If Eunomia wants the freelancer/consultant audience fleeing Harvest/Clockify pricing:
- Projects/clients as a rule target alongside categories, billable flag/rate.
- Timeline range → entry; idle-return prompt (discard/keep/assign).
- Manual entries for offline work; Toggl/Clockify/Harvest CSV import only once entries exist.
This is a strategic choice (scope roughly doubles) — decide deliberately.

### Sharing without surveillance
- Read-only, aggregate-only, revocable **share links** with a fixed range (M).
- Later, groups/households where members see **only aggregates the individual chooses to share** (Timely model) (L — wait for demand).

### Operations & adoption
- LICENSE (S, do first).
- Single-user container image: auto-generated secret, printed setup code instead of SMTP (S–M).
- `tailscale serve` recipe (HTTPS → fixes Android cleartext refusal; identity headers for auth).
- Umbrel / CasaOS / Unraid templates — Kimai and solidtime are on Umbrel; no automatic window tracker is.
- Prometheus `/metrics` (S); Play Store / F-Droid listing for Android.
- OIDC login is a frequent self-hoster request (Kimai issues) — pairs well with the existing better-auth setup.

## 5. Suggested sequencing

| Phase | Theme | Items |
| --- | --- | --- |
| 0 | Trust basics | LICENSE · export bundle · account/range deletion · signed Windows + auto-update |
| 1 | Data foundation | agent ping log · server raw pings + replay · `focus_segments` · per-user TZ |
| 2 | Make it useful | uncategorized queue · starter rule packs · onboarding · category kinds + goals · day timeline |
| 3 | Capture parity | media/meeting AFK · local agent endpoint → browser extension + AW-compat listener · Wayland · macOS |
| 4 | Local-first | Electron standalone mode (embedded PGlite server) · ActivityWatch importer · per-device send levels |
| 5 | Reach | digests/alerts · MCP writes + prompts · BYO-LLM summaries · share links · homelab templates · WakaTime endpoint · ICS |
| ? | Strategic | timesheet bridge (projects/billable/entries) — only if targeting freelancers |

Rationale: phase 0–1 are cheap-to-medium and unblock most of 2–5; the timeline, deletion,
import, and standalone mode all depend on having raw/ordered events.

## 6. Caveats
- Competitor facts come from web sources as of Sep 2026; single-source or prior-knowledge claims are flagged in the per-file reports (`(pk)`, `(unverified)`). Re-check pricing before quoting.
- Effort sizes (S/M/L) are research estimates, not scoped designs.
