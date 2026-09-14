# Eunomia — Feature Inventory (as built, 2026-09-12)

Grounded in code at commit `e044088` (main). Maturity tags:
**solid** (implemented end-to-end, tested/UI-exposed) · **basic** (works, minimal scope) ·
**partial** (some platforms/paths only, or API-only with no UI) · **stub** (declared, barely used).

One-line positioning: a self-hosted, multi-user, *automatic* app/window tracker in the
ActivityWatch/RescueTime mould (not a Toggl/Clockify/Kimai manual timesheet tool), with a
server-side rules engine, Postgres rollups, a GraphQL API and a read-only MCP endpoint.

---

## 1. Data capture

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Desktop foreground-window sampling | Electron tray agent polls the focused window every 1 s via `@miniben90/x-win`; emits a ping on app/title change or every keep-alive interval (~10 s). | solid | `apps/app/electron/main.ts`, `packages/agent/src/sampler.ts` |
| App identifier | Executable name on desktop (`execName`); Android human label (package name kept in `title`). | solid | `apps/app/electron/main.ts`, `apps/app/src/sync.ts` |
| Window title | Captured on desktop; only the *latest* title per activity row is stored (titles churn in place). Android has no titles (package name substituted). | solid (desktop) / n/a (Android) | `apps/server/src/activity/fold.ts` |
| Browser site (hostname only) | For known browsers (Chrome, Edge, Firefox, Brave, Arc, Safari, Vivaldi, Opera, Zen…) the tab URL is read and reduced to hostname. **Windows/macOS only** — x-win returns no URL on Linux. Full URLs never leave the device. | partial | `apps/app/electron/main.ts` (`browserContext`) |
| Contexts from titles | Server-side per-user regex rules extract a sub-app "context" (project, document, workspace) from the title's first capture group. | solid | `apps/server/src/activity/context.ts`, `rules.ts` |
| Idle / AFK detection | Desktop reports OS idle seconds (`powerMonitor.getSystemIdleTime`); ≥120 s idle accrues nothing and walks back the idle ramp-up. No "AFK" bucket is recorded — idle time is simply absent. | solid | `apps/server/src/activity/fold.ts` |
| Sleep / gap handling | Accrual per ping capped at 30 s, so sleep/shutdown/network silence never accrues. No explicit screen-lock or suspend event handling on desktop. | basic | `fold.ts` (`ACCRUE_CAP_SECONDS`) |
| Android app usage | Kotlin Expo module reads `UsageStatsManager` events (ACTIVITY_RESUMED, SCREEN_INTERACTIVE/NON_INTERACTIVE) and a shared synthesizer retroactively generates pings; screen-off time never accrues. | solid | `apps/app/modules/usage-events/android/.../UsageEventsModule.kt`, `packages/agent/src/synth.ts` |
| Android "launchable apps only" filter | Drops launcher, notification shade, system dialogs (packages without a launcher intent). Default on. | solid | `apps/app/src/sync.ts` |
| Android background capture | Sync on foreground, WorkManager background task (~15 min floor), optional foreground "keep running" service with notification, battery-optimization exemption prompt, boot receiver. | solid | `SyncForegroundService.kt`, `BootReceiver.kt`, `apps/app/src/background.ts` |
| Sampler health reporting | Tray/status screen shows "NOT TRACKING" when the OS read fails, stall detection, 30-min heartbeat in log. | solid | `packages/agent/src/sampler.ts` |
| Manual time entries | None. `recordPing(s)` is the only ingestion path; no create/edit of arbitrary time spans. | absent | — |
| Start/stop timers | None. | absent | — |
| Keystroke/mouse activity counts, screenshots, OCR, audio | None (only idle seconds). | absent | — |
| Editor/IDE heartbeats (WakaTime-style) | None — IDE projects only via title context rules. | absent | — |
| Calendar/meeting capture | None. | absent | — |

## 2. Data model & processing

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Stateless ping ingestion | Agents send `{capturedAt, app, title, context, idleSeconds}`; batch mutation `recordPings`. No raw ping storage. | solid | `apps/server/src/graphql/ping-fields.ts` |
| Activity fold (multi-open) | Per device, multiple open activities keyed by `(app, context)`; accrued `activeSeconds`; auto-close after 15 min unfocused; per-device row lock prevents lost updates. | solid | `apps/server/src/activity/fold.ts` |
| Categories | Per-user named buckets with a color; create/delete (no rename/edit mutation). Deleting merges summary seconds into uncategorized. | basic | `apps/server/src/graphql/category-fields.ts` |
| Category rules (auto-categorization) | Priority-ordered case-insensitive regexes over app / title / context (all present must match; first match wins). Applied on every ping; retroactive sweep `applyCategoryRules`. Create/update/delete. | solid | `apps/server/src/activity/rules.ts`, `rule-fields.ts` |
| Manual category assignment | `assignActivity` sets `categorySource=manual`, which rules never override. **API only — no dashboard UI.** | partial | `category-fields.ts` |
| Context rules | Title regex (+ optional app regex) → context; forward-only (not re-applied to history). | solid | `apps/server/src/activity/context.ts` |
| Merge rules (entry identity) | Exact-value `(fromApp[,fromContext]) → (toApp[,toContext])`; applied at fold time and swept over activities **and** summaries; chain resolution; cycles refused. | solid | `apps/server/src/activity/merge-rules.ts` |
| Device merge | Fold a duplicate device's history into another, revoke source key. | solid | `apps/server/src/activity/merge.ts`, `device-fields.ts` |
| Rollups / summaries | Every 15 min, closed activities fold into `summaries` (device, day, app, context, category); category changes on rolled rows move seconds; summary queries merge rolled + live so today is complete. | solid | `apps/server/src/activity/rollup.ts`, `graphql/summaries.ts` |
| Retention | `ACTIVITY_RETENTION_DAYS` (default 90, 0 = forever) prunes raw activities after rollup; summaries kept forever. | solid | `rollup.ts` |
| Timezone / day boundaries | Server-wide `TZ` env drives SQL `date_trunc` day bucketing. Single zone per server (not per user); already-rolled days don't re-bucket. | basic | `apps/server/src/db/client.ts`, `rollup.ts` |
| Productivity score / focus metrics | None (categories carry no productive/distracting weight). | absent | — |

## 3. Privacy & data ownership

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Self-hosted server | Docker compose (app + Postgres 17); all data in your DB. No SaaS. | solid | `docker-compose.yml`, `apps/server/Dockerfile` |
| Client-side ignore list | `ignoreApps` regexes drop pings before they reach disk/outbox. | solid | `packages/agent/src/privacy.ts` |
| Client-side redaction | `redactApps` regexes keep time but strip title + context. | solid | `privacy.ts` |
| Privacy editor UI | Shared Expo "Privacy…" screen (one pattern per line) on Android and desktop setup window; desktop also via `config.json`. | solid | `apps/app/src/PrivacyScreen.tsx` |
| Hostname-only URLs | Full URLs, query strings never captured. | solid | `electron/main.ts` |
| Offline buffering | Crash-safe JSONL outbox, 50,000-ping cap (~1 week), drop-oldest; unprovisioned agent still records locally. | solid | `packages/agent/src/outbox.ts` |
| Data retention control | Server-wide raw-row pruning (see §2). | solid | `rollup.ts` |
| Device deletion | Deletes device, cascades its activities, revokes keys. | solid | `device-fields.ts` |
| Backup/restore | Documented `pg_dump`/`psql` only; no in-app export. | basic (docs) | `README.md` |
| Export (CSV/JSON) / import (e.g. from ActivityWatch) | None. GraphQL reads are the only programmatic export. | absent | — |
| Encryption at rest / E2E | None; plain HTTP container — TLS expected from reverse proxy. Android production builds refuse cleartext. | absent (TLS delegated) | `README.md`, `apps/app/plugins/with-cleartext-traffic.js` |
| Account deletion / per-user data wipe | No mutation. | absent | — |
| Deleting/editing individual activities | No mutation (only re-categorize). | absent | — |

## 4. Reporting & visualization (web dashboard, `apps/web`)

Tabs: **Dashboard · Categories & rules · Merge entries · Devices · API keys** (`apps/web/src/App.tsx`).

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Date range picker | Presets Today / 7 / 30 / 90 days + custom from/to. | solid | `components/dashboard/range-picker.tsx` |
| Device filter | Filter all charts to one device; shows each device's share. | solid | `components/dashboard/device-picker.tsx` |
| Stat tiles | Tracked total, daily average, top category, top app. | basic | `components/dashboard/stat-tiles.tsx` |
| Per-day stacked bar chart | Seconds per day stacked by category. | solid | `components/dashboard/day-chart.tsx` |
| Category totals chart | Horizontal bar per category. | basic | `components/dashboard/category-chart.tsx` |
| Top apps with context drill-down | Bar list split by category color; expand app to see contexts (sites/projects). | solid | `components/dashboard/top-apps.tsx` |
| Rule live preview | While editing a rule, shows matches against recent activities. | solid | `components/rules/preview.tsx` |
| Entries inventory | Every recorded (app, context) entry with totals, filterable, merge action. | solid | `components/merges/entries-card.tsx` |
| Dashboard on devices | Desktop tray "Open Dashboard" window and Android WebView, auto-signed-in via short-lived session from device key. | solid | `apps/app/electron/dashboard.ts`, `apps/app/src/DashboardScreen.tsx` |
| Timeline / hour-of-day view | None — no intraday timeline, no raw activity list view. | absent | — |
| Period comparisons, trends, week-over-week | None. | absent | — |
| Scheduled reports / email digests | None. | absent | — |
| Search | Only a text filter on the merge-entries list. | stub | `entries-card.tsx` |

## 5. Organization

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Categories (flat, colored) | Per-user; no hierarchy. | basic | `schema.ts` `categories` |
| Contexts as de-facto projects | Sub-app divisions (site/project/book) extracted by rules. | solid | `context.ts` |
| Tags, projects, clients, billable rates, invoicing | None. | absent | — |
| Goals / limits / alerts / focus mode / blocking | None. | absent | — |
| Productivity scoring | None. | absent | — |

## 6. Multi-user / team

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Multiple isolated users | Every row fenced to its owner (CASL field gates + generated-read scoping). | solid | `apps/server/src/graphql/permissions.ts`, `scope.ts` |
| Passwordless magic-link login | Email link (SMTP or console); accounts auto-created on first login. | solid | `apps/server/src/auth.ts`, `email.ts` |
| Email/password signUp/signIn | Present in API (better-auth), not exposed in dashboard. | partial | `domain.graphql` |
| Registration policy | `ALLOWED_EMAILS` (domain wildcards), `DISABLE_SIGNUP`, rate limiting (5/addr, 100 global per 15 min). | solid | `registration.ts`, `rate-limit.ts` |
| `UNSAFE_LOCAL_NETWORK` LAN login | Returns magic token directly (no inbox). | solid (by design unsafe) | `auth.ts` |
| Teams/orgs, sharing, admin role, manager views, SSO/OIDC | None. | absent | — |

## 7. Devices & sync

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Device provisioning | Setup UI (server URL + email magic link) → `registerDevice` issues device API key; CLI `--provision` on desktop. | solid | `packages/agent/src/provision.ts`, `apps/app/src/SetupScreen.tsx` |
| Reconnect / re-key | "Change server / API key" re-keys the existing device on the same server (`rotateDeviceKey`) so history is kept. | solid | `provision.ts`, `device-fields.ts` |
| Rename / merge / delete devices | Dashboard Devices tab. | solid | `apps/web/src/components/devices-view.tsx` |
| Liveness | `devices.lastSeenAt` (receipt time); dashboard flags stale / never-seen devices. | solid | `schema.ts`, `devices-view.tsx` |
| Multi-device aggregation | Summaries sum across devices; `deviceSummary` split. No cross-device de-duplication of simultaneous time. | basic | `graphql/summaries.ts` |
| Configurable sync interval | Default 60 s, floor 10 s; per-device setting. | solid | `packages/agent/src/config.ts` |
| Upload status | Tray/status screen shows queued count and upload errors. | solid | `electron/main.ts`, `StatusScreen.tsx` |
| Agent log viewer | In-app log screen + "Show log file" (512 KB cap). | solid | `apps/app/src/LogScreen.tsx`, `electron/log.ts` |

## 8. Integrations & API

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| GraphQL API | Full surface: generated table reads (devices, activities, categories, rules, merges, summaries rows) + SDL domain (auth, devices, keys, ingestion, rules, `categorySummary`/`appSummary`/`deviceSummary`). Committed `schema.graphql`; typed SDK via codegen. | solid | `schema.graphql`, `apps/server/src/graphql/` |
| Integration API keys | Dashboard-issued, optional 30/90/365-day expiry, shown once, hashed, rename/revoke, `lastUsedAt`; session-only management (keys can't mint keys). | solid | `apps/server/src/api-keys.ts`, `apps/web/src/components/api-keys-view.tsx` |
| MCP endpoint (`/mcp`) | `@cubicecho/graphql-mcp` projects every GraphQL **query** as an MCP tool over Streamable HTTP, same schema instance and auth as `/graphql`. Read-only (`includeMutations: false`). | solid | `apps/server/src/mcp.ts` |
| Health endpoint | `GET /healthz` with DB round-trip. | solid | `apps/server/src/health.ts` |
| Webhooks, Zapier, calendar sync, Jira/GitHub, IDE plugins, browser extension, REST API | None. | absent | — |
| Import from other trackers | None. | absent | — |

## 9. Deployment & ops

| Feature | Description | Maturity | Key path |
| --- | --- | --- | --- |
| Single-container server | Serves dashboard at `/`, GraphQL, MCP on one port; migrations on start; refuses to boot without a real `BETTER_AUTH_SECRET`. | solid | `apps/server/src/index.ts`, `env.ts` |
| Docker images | semantic-release → GHCR + Docker Hub on main. | solid | `.github/workflows/release.yml` |
| Windows desktop agent | One-click per-user NSIS installer (unsigned), launch at login, built on Windows runner, attached to GitHub release. | solid | `.github/workflows/desktop.yml`, `apps/app/electron/build/installer.nsh` |
| Linux desktop agent | AppImage, XDG autostart. X11 focus works via x-win; no browser hostname; Wayland titles a stated non-goal. | partial | `apps/app/package.json` (`dist:linux`) |
| macOS desktop agent | Code paths exist (`darwin` platform, login item) but **no build target or CI packaging**. | stub | `apps/app/electron/config.ts` |
| Android agent | EAS-built sideloadable APK (not Play Store); OTA JS updates via expo-updates with fingerprint-based build-vs-update decision. | solid | `.github/workflows/android.yml`, `apps/app/BUILDING.md` |
| Autostart | Default on, tray toggle, setup checkbox, `config.json` switch. | solid | `apps/app/electron/autostart.ts` |
| Single-instance guard | Second launch surfaces the running agent (unreliable on Linux). | basic | `electron/main.ts` |
| CI | Lint, typecheck, tests (PGlite), schema drift check, web export, desktop bundle, Android config, cleartext guard, asar content check. | solid | `.github/workflows/ci.yml` |
| Desktop auto-update | None (stated non-goal). | absent | — |
| iOS | None (research: platform makes it impossible). | absent | `.agents/research.md` §2.5 |

---

## 10. Notable absences (explicit)

1. **No iOS agent** (platform-blocked) and **no macOS build/release** (code only).
2. **No browser extension**; browser site capture is hostname-only and Windows/macOS-only (none on Linux).
3. **No Linux Wayland support** for window titles (declared non-goal); no GNOME extension.
4. **No manual time entries, timers, or editing/deleting individual activities.**
5. **No data export/import** (CSV/JSON, ActivityWatch import); backup is `pg_dump`.
6. **No projects/clients/tags/billable rates/invoicing** — not a timesheet tool.
7. **No goals, limits, alerts, notifications, focus mode, or app/site blocking.**
8. **No productivity scoring**; categories are unweighted labels.
9. **No timeline/intraday view, raw activity browser, trend comparisons, or scheduled reports.**
10. **No category rename/edit or hierarchy**; manual `assignActivity` has no UI.
11. **No teams/orgs, sharing, roles, admin panel, SSO/OIDC**; password auth exists only in the API.
12. **No account deletion** or per-user data wipe.
13. **No IDE plugins / WakaTime-style heartbeats, calendar integration, webhooks, REST API.**
14. **No encryption at rest / E2E**, no built-in TLS.
15. **No per-user timezone** (server-wide `TZ`); no AFK/idle time bucket or screen-lock events recorded.
16. **No keyboard/mouse activity metrics, screenshots, OCR/screen recording** (Screenpipe/ManicTime/Memtime territory).
17. **No desktop auto-update**; Windows installer unsigned; Android not on Play Store.
18. **MCP is read-only** (no write tools such as categorizing via an AI agent).
