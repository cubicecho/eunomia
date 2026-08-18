# Research: Multiplatform Activity Tracker MVP (Eunomia)

> Researched 2026-08-15 via parallel web research (platform APIs, prior art, TS stack).
> Goal: MVP that tracks the current foreground app + device usage on desktop (Windows first,
> all platforms kept open), sends events to a self-hosted multi-user server (eventual SaaS),
> and lets users assign activities to types/categories. Author's primary language: TypeScript.

---

## TL;DR — Recommended MVP

| Layer | Choice | Why |
|---|---|---|
| Desktop agent | **Electron 43, tray-only (no window)** | Tray, login-item, idle detection, macOS permissions, code signing, auto-update are all first-party and pre-solved. ~100 MB tax is acceptable for MVP; port to Tauri later if it offends. |
| Foreground app | **`@miniben90/x-win`** (or `get-windows`) | Maintained napi-rs bindings, Win/macOS/X11 + GNOME-Wayland shim; `get-windows` (ex-`active-win`) is the fallback (no Wayland). |
| Idle detection | **Electron `powerMonitor.getSystemIdleTime()`** | The only maintained cross-platform idle API in the JS ecosystem; every standalone npm idle package is abandoned. |
| Server | **GraphQL Yoga + `@vantreeseba/drizzle-graphql` → Drizzle 1.0 RC → Postgres**, docker-compose (app + pg) | User decision (2026-08-16). GraphQL schema auto-generated from the Drizzle schema via the user's own fork of drizzle-graphql (v2.0.0 on npm, requires `drizzle-orm@rc`); codegen only if/when needed for client typing. No Pothos, no hand-written SDL. **PGlite** as the test database (in-process Postgres, no container in CI). |
| GraphQL authz | **`@vantreeseba/graphql-casl`** (user's package) | CASL abilities per request (better-auth actor) enforced via graphql-middleware over generated + custom resolvers — solves scoping of the auto-generated CRUD. |
| GraphQL mocking | **`@vantreeseba/graphql-mocks`** (user's package) | Faker-based graph-connected mock data from the schema for dashboard dev + test fixtures; complements PGlite tests. |
| Auth | **better-auth 1.6.x** — session cookies for dashboard, `apiKey` plugin for device agents | The clear 2026 answer (Auth.js is in maintenance mode and joined Better Auth; Lucia deprecated). |
| Data model | **ActivityWatch's bucket/event/heartbeat model + user_id/device_id columns** | Proven; storage scales with context switches, not polling rate; stateless clients. |
| Categories | **Server-side per-user regex rules, applied at query time** | Rules can change retroactively; raw data stays pristine. Fixes AW's localStorage-rules mistake. |
| Repo | **npm workspaces** (`apps/server`, `apps/desktop`, `packages/shared`) | User decision: no pnpm. npm workspaces are built-in and sufficient; shared Zod schemas + typed GraphQL documents are the real cross-platform reuse layer. |
| Android (later) | **Expo dev build + ~150-line local Kotlin Expo Module** wrapping `UsageStatsManager` + `expo-background-task` sync | No foreground service needed — the OS records usage retrospectively. Self-distribute the APK to skip Play declarations. |
| iOS | **Out of scope permanently** for server-synced tracking | Platform restriction, not a stack choice — see §2.5. |

**Key architectural insight:** nothing on desktop meaningfully shares *tracking* code with
Android — even Tauri-mobile and ActivityWatch end up writing Kotlin for the tracking layer.
So choose the desktop client on desktop merits alone, and make the **shared TS packages**
(event schema, API client, outbox/sync logic) the reuse layer. This is exactly WakaTime's
architecture: dumb thin platform clients + shared protocol.

---

## 1. Prior Art

### 1.1 ActivityWatch (MPL-2.0) — the closest prior art, and the gap we fill

Actively maintained, open source, Win/macOS/Linux/Android. **Local-first by design — no
cloud/multi-user offering exists**, and that gap is precisely this project's white space:

- **aw-server has zero auth or HTTPS.** Docs explicitly call shared remote servers
  "not secure and not supported." Browser-watcher bucket IDs don't include hostname, so two
  machines collide on one server.
- **aw-sync** is device sync via a shared folder (Syncthing/Dropbox), not multi-user, and has
  been "MVP not quite ready" for years.
- No credible third-party multi-user aw-server reimplementation was found.

**Architecture (copy this):** independent *watchers* (`aw-watcher-window`, `aw-watcher-afk`,
browser extensions) push data via a client library to a REST server; the web UI talks only
through the same REST API (good dogfooding pattern).

**Data model (⚠️ superseded 2026-08-16: do NOT adopt directly — per project decision the
AW bucket/event/heartbeat model is reference material only; the actual data model will be
designed from scratch in a review discussion. Kept below for context):**

- **Bucket** = container for events from one (watcher, host) pair:
  `{id, created, name, type, client, hostname}`. Types like `currentwindow`, `afkstatus`,
  `web.tab.current`.
- **Event** = `{timestamp: ISO8601 UTC, duration: seconds (float), data: JSON}`.
  For `currentwindow`, `data = {app, title}`.
- **Heartbeat merge** (`POST /buckets/<id>/heartbeat?pulsetime=N`): the server merges an
  incoming heartbeat into the bucket's last event iff `data` is **identical** and the gap is
  within `pulsetime` seconds — extending the existing event's `duration` instead of inserting
  a row. Reference cadence: poll ~1s, `pulsetime = poll_interval + 1`, client batches with a
  ~4s commit interval. **This is the single best idea to copy** — storage becomes proportional
  to *context switches*, not polling frequency, and clients stay stateless (a dropped
  heartbeat loses only seconds).

**Categorization:** user-defined category tree, each category a **regex matched against
`app` and `title`**, computed at query/read time, not stored on events. AW stores rules in
browser localStorage (a notorious pain point) — we store them server-side per user instead.

**License:** MPL-2.0 is file-level copyleft — reusing individual watcher files is fine even
alongside proprietary code (changes to those files stay MPL), but the cleaner MVP move is to
adopt the protocol/data model (ideas aren't copyrightable) and write fresh code. Optional
strategy: stay wire-compatible so existing AW watchers could report to our server.

### 1.2 Wakapi (MIT, Go) — the best blueprint for the server tier

Self-hosted, single binary, multi-user WakaTime-compatible server (~4.4k stars, active):

- Per-user API keys; cookie/API-key/OIDC auth; GORM over SQLite/MySQL/Postgres.
- Data model: raw `heartbeats` table + scheduled aggregation into `summaries`
  (per project/language/machine) — dashboards read summaries, not raw rows.
- MIT license: freely reusable ideas and code.

### 1.3 WakaTime — the SaaS shape

- ~70 open-source editor plugins → one shared open-source CLI (offline queue, heartbeat
  delivery) → proprietary cloud. Validated model: **open clients + proprietary/hosted server,
  free tier throttled by history retention** (free = 1-week dashboard; paid $9–24/mo).
- Server-side sessionization: durations inferred by grouping heartbeats within a timeout
  window (vs AW's ingest-time pulsetime merge — either works; ingest-time merge keeps the DB
  smaller).

### 1.4 Commercial comparators (pricing context for SaaS)

| Product | Tracks | Pricing (2026) |
|---|---|---|
| RescueTime | App + website, categories, productivity scores | Free lite; ~$7–9/mo |
| Rize | App/site + AI coaching (mac/Win) | $12.99–49.99/mo (AI-credit tiers) |
| Timing | macOS-only, per-document depth, local-first | $9–16/mo |
| WakaTime | Coding only | Free–$24/mo |

### 1.5 Not relevant (different category)

Kimai, Traggo, solidtime, super-productivity are **manual** time trackers. tockler
(GPL-2.0, Electron/TS) is an automatic local-only tracker — reference for Electron window
capture, but GPL = ideas only. **In the automatic × self-hosted × multi-user quadrant, only
Wakapi (coding-only) exists. Eunomia = AW's watcher/heartbeat model × Wakapi's multi-user
server shape.**

### 1.6 Lessons — copy / avoid

**Copy:** AW event model + heartbeat merge; watcher separation (window + AFK as independent
signals, joined at query time — AFK filtering is a query step, not baked into stored events);
Wakapi's per-user API keys and raw-events + rollup split; WakaTime's retention-limited free
tier; UI talks only to the public API.

**Avoid:** no-auth server; category rules in client localStorage; encoding hostname in bucket
IDs (make device a first-class column); file-folder sync; two parallel server implementations
(AW's Python/Rust split cost them years); storing category on the event.

---

## 2. Platform Tracking APIs

### 2.1 Windows (MVP target — easiest platform)

- **Foreground app:** `GetForegroundWindow()` → `GetWindowTextW()` (title),
  `GetWindowThreadProcessId()` + `QueryFullProcessImageNameW` (process). Event-driven
  alternative: `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, ...)`. UWP caveat: HWND may belong to
  `ApplicationFrameHost.exe`; walk child windows for the real process.
- **Idle:** `GetLastInputInfo()` vs `GetTickCount()`. Lock events:
  `WTSRegisterSessionNotification()` → `WM_WTSSESSION_CHANGE`.
- **Permissions:** none. Fully feasible as a per-user tray app (not a session-0 service,
  which can't see the user's foreground window).

### 2.2 macOS

- **Frontmost app** (no permission): `NSWorkspace.shared.frontmostApplication` +
  `didActivateApplicationNotification`.
- **Window titles require Screen Recording permission** (`kCGWindowName` via
  `CGWindowListCopyWindowInfo` is silently empty without it — no dialog is triggered).
  Browser URLs / focused-window detail need Accessibility/Automation permission instead.
- **Idle** (no permission): `CGEventSource.secondsSinceLastEventType`. Lock: undocumented-but-
  stable `com.apple.screenIsLocked`/`Unlocked` distributed notifications.
- **macOS Tahoe (26.x) gotcha:** only **bundled, signed .app** executables can be granted
  Screen Recording — bare CLI binaries no longer appear in the privacy pane. This is the main
  argument against a plain-Node daemon for distribution: you need a real app bundle anyway.
- Most trackers (AW, Timing, RescueTime) distribute outside the Mac App Store.

### 2.3 Linux

- **X11 (easy):** `_NET_ACTIVE_WINDOW` / `_NET_WM_NAME` / `WM_CLASS` via EWMH; subscribe to
  `PropertyNotify` on the root window. Idle: XScreenSaver extension. No permissions.
- **Wayland (hard — accept degraded coverage):** core Wayland deliberately hides focus info.
  Per-compositor matrix required:
  - wlroots family (Sway, Hyprland, river) + KWin: `wlr-foreign-toplevel-management` /
    `ext-foreign-toplevel-list-v1` protocols, or compositor IPC (`swaymsg`, `hyprctl`).
  - **GNOME/Mutter: no protocol support** — requires a shell extension ("Focused Window
    D-Bus" / "Window Calls") exposing focus over D-Bus. (Unverified whether Mutter merged
    ext-foreign-toplevel-list by Aug 2026; assume not.)
  - Idle: `ext-idle-notify-v1` (wlroots/KWin), `org.gnome.Mutter.IdleMonitor` (GNOME),
    `org.freedesktop.login1` for lock/suspend (most portable).
  - Best reference implementation: **`awatcher`** (Rust AW watcher covering X11 + all the
    Wayland backends).

### 2.4 Android (later — viable)

- **`UsageStatsManager`** (API 21+): `queryEvents()` with `ACTIVITY_RESUMED` events is the
  reliable foreground-app source; `queryUsageStats()` for aggregates. Package + activity class
  only — no window titles (that would need AccessibilityService, which Play policy restricts
  to genuine accessibility use; don't).
- **Permission:** `PACKAGE_USAGE_STATS` — special access, no runtime dialog; deep-link the
  user to Settings → Usage access; check grant via `AppOpsManager`. Play allows it for
  digital-wellbeing-style apps with disclosure; **self-distributing the APK skips Play
  declarations entirely** (incl. `QUERY_ALL_PACKAGES` for app-name resolution).
- **Screen state:** `SCREEN_INTERACTIVE`/`NON_INTERACTIVE`, `KEYGUARD_*` UsageEvents (API 28+).
- **Key simplification: tracking is retrospective** — the OS records usage whether or not our
  app runs; `queryEvents` data is retained a few days. So **no foreground service needed**:
  sync on app-open + `expo-background-task` (WorkManager, 15-min minimum) every few hours.
  Avoids Doze/OEM-killer pain and Android 15/16 FGS quotas.

### 2.5 iOS — honest assessment: not possible

Third-party per-app usage tracking that exports to a server **does not exist on iOS**:

- No public API returns the foreground app; no background execution model for monitoring.
- The Screen Time API stack (FamilyControls + DeviceActivity + DeviceActivityReport) only
  lets a **sandboxed report extension render** usage data — the extension has **no network
  access and cannot pass data to the host app** (App Groups silently return nothing). Apps
  are identified by opaque tokens; even names resolve only inside Apple's UI components.
- The `com.apple.developer.family-controls` distribution entitlement requires manual Apple
  review (days–weeks) and a genuine parental-control/wellbeing use case.
- This is a platform restriction — no framework (Flutter, RN, Tauri) changes it. The most an
  iOS app could ever do: display Apple-rendered usage reports in-app, or threshold-based
  events. Park iOS indefinitely; document it as out of scope.

### 2.6 Library landscape (the deciding dependencies)

| Package | Status (Aug 2026) | Platforms | Notes |
|---|---|---|---|
| **`get-windows`** (renamed from `active-win` at v9) | 9.3.0, maintained (sindresorhus) | macOS 10.14+, Win 7+, **Linux X11 only — no Wayland** | ESM-only; N-API on Windows, signed Swift helper on macOS; handles Screen Recording/Accessibility permission states |
| **`@miniben90/x-win`** | 3.6.0 (Aug 2026), **most active** | Win, macOS, X11, **Wayland via GNOME-extension shim (GNOME 41+)** | Rust/napi-rs prebuilds, subscription API, documented Electron usage. Arguably the better pick |
| `@paymoapp/active-window` | 2.1.4, maintained (production tracker vendor) | Win/macOS/X11, no Wayland | `subscribe()` API, macOS `requestPermissions()` helper |
| `node-window-manager`, `windows-active-process`, `desktop-idle` | **abandoned — skip** | — | npm idle detection is dead; use Electron `powerMonitor` |
| `active-win-pos-rs` (Rust) | 0.11, maintained | Win/macOS/Linux (claims KWin/Hyprland Wayland — unverified) | For a future Tauri port |
| `x-win` (Rust crate) | active | Win/macOS/X11/GNOME | Same author as `@miniben90/x-win` |
| `awatcher` (Rust, reference impl) | active | X11 + full Wayland matrix | Not a library, but the map for Linux support |
| RN Android usage-stats packages | **all dead** (2018–2024) | — | Write our own ~150-line Kotlin Expo Module |

---

## 3. Client Framework Decision

### Electron (recommended for MVP)

- Tray-only pattern: create `Tray`, never a `BrowserWindow`; macOS `LSUIElement: "1"`.
- Auto-launch: `app.setLoginItemSettings()` (macOS 13+ maps to SMAppService; covers Windows
  too); `auto-launch` pkg for Linux.
- `powerMonitor.getSystemIdleTime()` + `lock-screen`/`unlock-screen` events — solves the
  idle-detection gap for free.
- electron-builder + electron-updater: signed installers + delta auto-update on all 3 OSes,
  boring and solved. Produces the signed .app bundle macOS TCC now effectively requires.
- Cost: ~80–150 MB RSS (estimate; no published tray-only benchmark), ~8-week major cadence.
- **Verdict: overkill in resources, not in effort.** Every hard problem is pre-solved
  first-party. Ships in days.

### Tauri v2 (the footprint upgrade path, not the MVP)

- Desktop-mature (Spacedrive, AppFlowy); tray first-class; ~3–10 MB bundle, ~5–20 MB RSS.
- But: no official active-window plugin (open request #4827) — you embed `active-win-pos-rs`
  and write **~200–400 lines of your own Rust** (polling, idle — no canonical cross-platform
  Rust idle crate — HTTP, permissions edge cases) and debug it across 3 OSes.
- Linux tray caveat: appindicator = context menu only, no click events.
- **Mobile nuance that kills the "Tauri for Android too" argument:** Tauri mobile shares only
  the webview UI — Android tracking still requires a Kotlin plugin regardless.
- Plan: if/when Electron's footprint matters, port the agent shell to Tauri (~a week); the
  outbox/API/schema logic lives in `packages/shared` and ports for free.

### Plain Node daemon (rejected for distribution)

- Works technically (`node` + `get-windows` loop), but: single-binary packaging of native
  addons + get-windows' Swift helper is fragile (`pkg` archived; Node SEA sore on addons; bun
  `--compile` untested for the spawned-helper case), auto-start is hand-rolled per platform,
  and the killer is **macOS TCC** — bare/unsigned binaries can't get Screen Recording on
  Tahoe, and grants break when the binary changes. You'd end up building an app bundle anyway.
- Fine as a personal dev-machine tool; wrong as the product.

### Others

Neutralino (no native-addon story), Wails v3 (beta, Go, thinner window-tracking ecosystem) —
not compelling.

### Expo/React Native (Android, later)

- Needs a dev build (`expo prebuild`) + **local Expo Module in Kotlin**
  (`npx create-expo-module --local`): `queryEvents`/`queryUsageStats`, AppOps grant check,
  `ACTION_USAGE_ACCESS_SETTINGS` intent — ~100–200 lines, weekend-scale. Never works in Expo Go.
- Sync via `expo-background-task` (SDK 53+); no foreground service (see §2.4).
- Reuses `packages/shared` schemas + typed API client.

---

## 4. Server Stack

> **Decision (2026-08-16):** GraphQL → Drizzle → **Postgres** (superseding the original
> SQLite-first recommendation). PGlite as the test database. Self-hosting = docker-compose
> spinning up app + pg.

### API: GraphQL

> **Decision (2026-08-16):** `drizzle-graphql` — GraphQL schema generated from the Drizzle
> schema. No Pothos, no hand-written SDL. Codegen only if/when needed for client typing.
> **Use the user's own fork: `@vantreeseba/drizzle-graphql@2.0.0`** (repo
> vantreeseba/drizzle-graphql, now redirecting to cubicecho/drizzle-graphql; published to npm
> 2026-08-13). Same `buildSchema(db)` → `{schema, entities}` API as upstream, but updated for
> **Drizzle 1.0 RC** — peer-depends on `drizzle-orm ^1.0.0-rc.2`, plus `graphql >=16.3.0`,
> `graphql-parse-resolve-info`, `graphql-scalars`. Therefore install **`drizzle-orm@rc`**
> (1.0.0-rc.4/rc.5 as of 2026-08-16), not the 0.45.x "latest" tag.

- **GraphQL Yoga** (The Guild) as the server — spec-compliant, runs on plain Node/Hono/
  standalone, batteries included (subscriptions via SSE, persisted operations). Preferred over
  Apollo Server for weight and DX in a solo TS project.
- **`drizzle-graphql`** (official Drizzle package): `buildSchema(db)` derives the full GraphQL
  schema (queries, filtered/ordered selects, insert/update/delete mutations) straight from the
  Drizzle table definitions — single source of truth, zero schema duplication.
- **Customization path** (needed, not optional): the default `buildSchema` output exposes raw
  CRUD on *every* table with no auth scoping. `drizzle-graphql` also returns its generated
  `entities` (types, inputs, queries, mutations as graphql-js objects), so the real schema
  should be assembled selectively: pick the generated query types we want, drop raw mutations
  on `events`/`users`, and add custom resolvers for the domain operations — `sendHeartbeats`
  (batch ingest + pulsetime merge), `registerDevice`, category-classified timeline queries.
- **Authorization: `@vantreeseba/graphql-casl@1.0.0`** (user's package, npm 2026-06) — a
  `graphql-middleware` plugin defining **CASL** permission rules on resolvers (peers:
  `@casl/ability >=6`, `graphql-middleware >=6`). This is the answer to the
  generated-CRUD-scoping problem: better-auth (session or device API key) resolves the actor
  in Yoga context → build a CASL ability per request (user can read/write own
  devices/events/categories) → the middleware enforces it across generated *and* custom
  resolvers uniformly. Companion `@vantreeseba/graphql-casl-codegen` (GraphQL Code Generator
  plugin) emits subject bindings from the schema — a concrete reason the "codegen if needed"
  door stays open.
- **Testing/mocking: `@vantreeseba/graphql-mocks@3.0.0`** (user's package, npm 2026-06) —
  generates realistic, graph-connected mock data from a `GraphQLSchema`/SDL using faker
  (peers: `@faker-js/faker >=9`, `graphql-scalars`). Use for dashboard development against a
  mocked schema and for seeding test fixtures; companion `@vantreeseba/graphql-mocks-codegen`
  emits a `SchemaTypeMap` for typed mock pools. Pairs with PGlite integration tests: mocks
  for fast schema-level tests, PGlite for real-Postgres-semantics resolver tests.
- **Codegen (only if needed)**: since the schema exists at runtime, client typing can come
  from GraphQL Code Generator's `client-preset` pointed at the running schema (or a
  `printSchema` dump) — add it when the dashboard grows enough to want typed documents;
  server-side resolver codegen is unnecessary since Drizzle types flow through directly.
- Client libraries: **graphql-request** or **urql** for the dashboard; the desktop agent's
  ingest path is a single `sendHeartbeats` mutation (or a plain HTTP POST alongside GraphQL
  if batch ingest ever needs to bypass GraphQL overhead — decide during implementation).

### Database: Postgres (+ PGlite for tests)

- **Postgres 17** via the official image in docker-compose; Drizzle's `node-postgres` (`pg`)
  or `postgres.js` driver.
- **PGlite** (ElectricSQL's WASM Postgres) as the test database: in-process, no container
  needed in unit/integration tests or CI; Drizzle has a first-class PGlite driver
  (`drizzle-orm/pglite`), so the same schema/queries run against real Postgres semantics.
- This removes the SQLite→Postgres migration step from the SaaS path entirely — one dialect
  from day one.

### ORM: Drizzle 1.0 RC (newest)

- Code-first TS schema, no codegen, `drizzle-kit` migrations, `drizzle-zod`. Install
  **`drizzle-orm@rc`** (1.0.0-rc.4/rc.5 line) — required by `@vantreeseba/drizzle-graphql`
  (`^1.0.0-rc.2`) and the user wants newest Drizzle; upgrade to 1.0 stable when it ships.
  Drivers used: `pg` (prod), `pglite` (tests).

### Auth: better-auth 1.6.x

- The clear 2026 answer: Auth.js/NextAuth officially joined Better Auth and is in maintenance
  mode (Sep 2025); Vercel acquired Better Auth (Jul 2026, stays MIT); **Lucia deprecated as a
  library (Mar 2025)**.
- Two-lane model: **session/cookie auth for the web dashboard + `apiKey` plugin for
  long-lived per-device agent tokens** (rate limits, per-key metadata). Hold the
  `organization` plugin for the SaaS/teams phase. First-class Hono + Drizzle integration.

### Ingestion pipeline

> ⚠️ Steps 3–4 superseded — heartbeat merge was the AW mechanism, which is not being adopted
> directly; the actual ingestion shape depends on the data model under review. Steps 1–2
> (client outbox + idempotent UUIDv7 delivery) hold regardless of the model chosen.

1. **Client outbox:** local SQLite table (client-side only — the desktop agent still uses
   SQLite/`node:sqlite` for its offline queue) `events(id, payload, created_at, synced_at)`;
   flush batches of 100–500 or every 30 s; delete/mark on 2xx. Durable across crashes/offline.
2. **Idempotency:** client-generated **UUIDv7** ids; server `INSERT ... ON CONFLICT (id) DO
   NOTHING` (Postgres) → at-least-once delivery, exactly-once effect.
3. **Heartbeat merge at ingest** (AW model): if incoming `data` equals the device's latest
   event and the gap ≤ `pulsetime`, extend that event's duration instead of inserting. Fold
   within the batch first, then merge against the stored tail.
4. Later: Wakapi-style scheduled rollups into a `summaries` table for dashboard reads.

(PowerSync/ElectricSQL/RxDB assessed and rejected — this is one-way telemetry, not
bidirectional app-state sync.)

### Monorepo

> **Decision (2026-08-16):** no pnpm (user preference).

**npm workspaces**: `apps/server`, `apps/desktop`, `packages/shared` (Zod event schemas,
inferred types, generated GraphQL typed documents). Built into npm, no extra tool. Pin a
single Zod version at the root (Zod types cross package boundaries) — with npm, hoisting
does this naturally as long as versions match. Bun workspaces are the alternative if a
faster installer is wanted, with the caveat that Electron/native-module tooling is less
battle-tested there. Turborepo only when build orchestration is earned; skip Nx.

### Deployment (self-host)

`docker-compose.yml` with two services: `app` (Node server image, runs drizzle-kit migrations
on boot) and `postgres` (official image + volume). Backups = `pg_dump` cron or the user's own
Postgres tooling (replaces the Litestream idea from the SQLite plan). The same app image
deploys to any container host for the SaaS turn, with managed Postgres (RDS/Neon/Supabase).

---

## 5. Data Model — DECIDED 2026-08-16 (designed in review, not the AW model)

> The ActivityWatch bucket/event/heartbeat model is NOT used. The decided model:
> **stateless pings, folded inline into a set of concurrently-open activities per device.**
>
> - Agents are dumb: every ~10s (and on focus change) they send a ping
>   `{capturedAt, app, title, idleSeconds}` — "this is what the device looks like right now".
> - The server keeps **multiple open activities per device, keyed by app** — context
>   switching (IDE ↔ browser every minute for an hour) yields 2 rows, not 120. Each ping
>   accrues the elapsed gap since the device's last ping (capped at 30s) to the focused
>   app's open activity: `activeSeconds` is the number dashboards sum, distinct from the
>   `startedAt..lastActiveAt` wall-clock span. Titles churn in place (latest kept).
> - **TTL-style close**: every focused ping resets an activity's clock (`lastActiveAt`);
>   an activity unfocused for 15 min is auto-closed *backdated to its lastActiveAt*.
>   Detection is lazy (on the device's next ping) — no timers, no jobs.
> - **Idle accrues to nothing**: pings with idleSeconds ≥ 120 don't accrue, and the first
>   ping past the threshold walks back the ramp-up time wrongly accrued to the focused
>   activity while idleSeconds climbed. No raw ping storage; no idle rows.
>
> Implementation: `apps/server/src/activity/fold.ts` (constants: ACCRUE_CAP_SECONDS=30,
> IDLE_THRESHOLD_SECONDS=120, CLOSE_AFTER_SECONDS=900), exercised by
> `apps/server/test/fold.test.ts` against PGlite. GraphQL: `recordPing` mutation +
> `activities` query. The sketch below predates this decision — `users`/`devices`/
> `api_keys`/`categories` still apply; `buckets`/`events` do not (replaced by
> `activities(id, device_id, app, title, started_at, last_active_at, active_seconds, closed_at)`).

```
users        (id, email, name, created_at)                       -- better-auth managed
devices      (id, user_id, name, platform, created_at)           -- first-class, NOT encoded in bucket ids
api_keys     (better-auth apiKey plugin; keyed to user + device metadata)
buckets      (id, device_id, type, client, created_at)           -- type: 'currentwindow' | 'afkstatus' | ...
events       (id UUIDv7, bucket_id, timestamp UTC, duration_s REAL, data JSON)
categories   (id, user_id, parent_id, name, color)               -- user-defined tree
category_rules (id, category_id, kind 'regex', pattern, target 'app'|'title')
summaries    (later: per user/device/day/app rollups)
```

- Category assignment is computed at **query time** from rules over `events.data`
  (`app`, `title`) — never stored on the event. Manual overrides can be a later
  `event_category_overrides` table.
- AFK filtering is a query step joining `afkstatus` intervals against `currentwindow` events.

## 6. MVP Build Order

1. **`packages/shared`** — Zod schemas for Event/Bucket/Heartbeat, API types.
2. **`apps/server`** — GraphQL Yoga + `@vantreeseba/drizzle-graphql` (schema derived from
   Drizzle tables, selectively assembled) + Postgres; better-auth (email/password + apiKey)
   with **`@vantreeseba/graphql-casl`** middleware enforcing per-user CASL abilities over all
   resolvers; custom resolvers: device register, `sendHeartbeats` batch ingest (with
   pulsetime merge), event queries (time range + AFK filter), category CRUD + rule-based
   classification. Tests: **`@vantreeseba/graphql-mocks`** for schema-level fixtures +
   PGlite for resolver/DB tests. Dockerfile + docker-compose (app + pg).
3. **`apps/desktop`** — Electron tray agent: poll x-win every 1–2 s + `powerMonitor` idle
   → heartbeats → SQLite outbox → batch POST with device API key. Settings = server URL +
   key. Windows first; macOS/Linux-X11 come nearly free from the same code.
4. **Dashboard** — simplest possible: server-rendered or small SPA served by Hono, reading
   the query API (timeline, top apps, category pie, per-day totals).
5. **Later:** Android Expo app; Wayland backends (or adopt `awatcher`-style sidecar); browser
   extension for URL-level tracking; rollup summaries; teams/orgs (better-auth
   `organization`); SaaS billing with retention-limited free tier (WakaTime model).

## 7. Risks / Open Questions

- **Wayland coverage** is structurally degraded (GNOME needs a shell extension; per-compositor
  matrix elsewhere). Accept X11-only on Linux for MVP; document it.
- **macOS window titles** require Screen Recording permission and a signed bundled app —
  plan for code signing + notarization when macOS ships (app name alone needs no permission).
- **Electron footprint** (~100 MB) — acceptable now; Tauri port is the known escape hatch.
- **Drizzle 1.0** not yet stable — we're deliberately on the RC line (`drizzle-orm@rc`)
  because `@vantreeseba/drizzle-graphql` requires it; move to 1.0 stable when cut.
- Unverified: `active-win-pos-rs` Wayland robustness; Mutter ext-foreign-toplevel status;
  tray-only Electron RSS numbers are estimates.
- **Privacy posture** matters for SaaS: window titles are sensitive. Consider client-side
  title redaction rules and per-app "don't track" lists early — it's a selling point vs
  RescueTime.

## 8. Sources

Key references (full lists gathered during research):
- ActivityWatch docs: data model (buckets-and-events), architecture, REST API, categorization,
  remote-server warnings; aw-server-rust + aw-sync READMEs; issues #35/#249/#572 (multi-host).
- Wakapi (github.com/muety/wakapi); WakaTime plugin/API docs + pricing.
- get-windows (github.com/sindresorhus/get-windows); @miniben90/x-win; @paymoapp/active-window;
  active-win-pos-rs; awatcher (github.com/2e3s/awatcher).
- Wayland protocols: wlr-foreign-toplevel-management, ext-foreign-toplevel-list-v1,
  ext-idle-notify-v1 (wayland.app); ActivityWatch issue #1218 (GNOME Wayland).
- Android UsageStatsManager docs; Play policy on usage-access/QUERY_ALL_PACKAGES.
- Apple: FamilyControls entitlement docs; DeviceActivityReport sandbox limits
  (riedel.wtf state-of-screen-time-api; 2026 developer writeups).
- Electron powerMonitor/Tray/setLoginItemSettings docs; electron-builder/updater.
- Tauri v2 docs + issue #4827 (active-window plugin request).
- Hono, Drizzle, better-auth, Litestream 0.5, pnpm catalogs docs.
