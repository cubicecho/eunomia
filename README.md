# eunomia

Multiplatform activity tracker: a desktop tray agent that records which
application is in use and sends it to a self-hosted, multi-user server.

Research and architecture decisions: [.agents/research.md](.agents/research.md).

> **Status:** working MVP. GraphQL-only API (auth included — no REST routes),
> magic-link login, device provisioning with API keys, activity ingestion via
> stateless pings, per-app **contexts** (browser site, open project/book),
> categories with manual assignment and regex auto-categorization rules,
> per-user authorization scoping, and a web dashboard.

## Layout

- `apps/server` — GraphQL Yoga + `@vantreeseba/drizzle-graphql` + Drizzle (1.0 RC) + Postgres,
  better-auth (sessions + device and integration API keys), `@vantreeseba/graphql-casl` permissions.
- `apps/app` — the agent, in one workspace with three targets. Its UI (setup,
  status, privacy, log) is a single Expo app; what runs *behind* that UI is the
  shell. **Android**: a local Kotlin module reads `UsageStatsManager`'s event
  log and the shared synthesizer turns it into pings retroactively — no live
  sampling service needed. **Desktop** (`electron/`): an Electron tray agent
  (`@miniben90/x-win` + `powerMonitor`) that samples the focused window, with
  the same UI rendered by react-native-web off `expo export --platform web`.
- `apps/web` — Vite + React dashboard (shadcn/ui, Recharts): sign-in,
  per-category/per-day/per-app views, rules, entry merges, devices, API keys. Talks to the
  server through the generated GraphQL SDK in `packages/gql`.
- `packages/agent` — agent core shared by every target: append-only ping log,
  batch uploader, the usage-event → ping synthesizer, the config parser, and
  the shared provisioning flow.
- `packages/gql` — nothing but graphql-codegen's output, regenerated from
  `schema.graphql` and not kept in git. See below.

### GraphQL contract

The schema has two halves. The reads are generated from the Drizzle tables by
`@vantreeseba/drizzle-graphql` (`apps/server/src/graphql/entities.ts`);
everything else — every mutation, the dashboard aggregates, `me` — is written
as SDL in `apps/server/src/graphql/domain.graphql` and applied on top of them.
`schema.graphql` at the root is the two halves printed together.

`schema.graphql` is committed, so that an API change shows up in the diff a
reviewer reads and so that nothing needs a running server to generate against.
What is generated *from* it is not committed. It lives in one workspace
package, `packages/gql`, whose three entry points are the whole contract:

| Import | What it is |
| --- | --- |
| `@eunomia/gql/resolvers` | the argument and return types every resolver in `apps/server/src/graphql` is checked against |
| `@eunomia/gql/agent` | the typed client the desktop and mobile agents call |
| `@eunomia/gql/web` | the typed client the dashboard calls |

`packages/gql/src/` is in `.gitignore`. It is written by an install (the
package's `prepare` script) and rewritten before anything that consumes it —
`npm run typecheck`, `npm test`, the dashboard's `build`, the desktop
`build:main`, the Docker image. So the usual answer to "do I need to run
codegen?" is no. After changing the schema itself:

```bash
npm run codegen   # reprints schema.graphql, then regenerates from it
```

`npm run codegen:types` skips the reprint when only the operations changed.

A schema change that breaks a consumer then fails `npm run typecheck` in that
package instead of failing at runtime — the server included, since a resolver
whose arguments no longer match its field no longer compiles. A field declared
with no resolver, or a resolver for a field that no longer exists, throws when
the schema is assembled. Each consumer's operations live in one
`src/operations.graphql`; codegen validates them against the SDL, so a query
for a field the server dropped fails the build rather than the request.

### MCP (for AI agents)

The server also answers the [Model Context Protocol](https://modelcontextprotocol.io/)
on **`/mcp`**, beside `/graphql` on the same port. Every read in the schema
becomes a tool — `activities`, `focusSegments`, `categories`, `devices`, the three summaries —
described from the SDL, so an agent can discover the API and ask what you spent
last week on. It is [`@cubicecho/graphql-mcp`](https://www.npmjs.com/package/@cubicecho/graphql-mcp)
pointed at the same schema object `/graphql` serves, which is what makes the two
surfaces provably the same API rather than two that are meant to agree.

**Reads only.** Mutations would become tools just as happily, but this schema's
mutations are the login flow, device registration and ingestion — an agent that
could call them would be minting credentials, not reading data. Drop
`includeMutations: false` in `apps/server/src/mcp.ts` if you want them. One
read is left out too: `accountExport`, a file download that would only flood an
agent's context (and is session-only anyway).

**It authenticates exactly like `/graphql`**, through the same function: an
API key in `x-api-key`, or a session in `Authorization: Bearer`. An anonymous
tool call is refused by the same permission layer that refuses an anonymous
query, and the rows a tool returns are fenced to the caller the same way.
Create a key for the client under the dashboard's **API keys** tab (see
[API keys](#api-keys-for-other-apps)) and point it at the server:

```jsonc
// e.g. ~/.claude.json — an MCP client's server list
{
  "eunomia": {
    "type": "http",
    "url": "http://localhost:4000/mcp",
    "headers": { "x-api-key": "<a key from the API keys tab>" }
  }
}
```

Anything that can reach `/graphql` can reach `/mcp`, and the same warnings
apply — see [Before you expose it](#before-you-expose-it).

## Development

```bash
npm install

# server (needs Postgres, e.g. `docker compose up postgres` — published on
# localhost:5433 to stay clear of any local postgres)
cp .env.example .env
npm run db:migrate -w @eunomia/server   # apply committed migrations
npm run dev:server                      # http://localhost:4000/graphql

# desktop agent — on first run it opens a setup window (server URL + email,
# magic-link sign-in, registers this machine), then lives in the tray. That
# window is the Expo app rendered by react-native-web, so `dev:desktop` runs
# `expo export --platform web` first; re-run it after editing the UI, or point
# EUNOMIA_DEV_SERVER at `npm run web -w @eunomia/app` to skip the export.
# `npm run provision -w @eunomia/app` is the terminal equivalent.
# Tray → "Open Dashboard" (or a double-click on the tray icon, on
# Windows/macOS) shows the server-hosted dashboard, signed in via the device
# key (needs a server that serves the web build, i.e. WEB_DIST — the docker
# image does; a bare `npm run dev:server` has no dashboard at /).
# Tray → "Change server / API key…" reopens that setup window later: point the
# agent at a different server, or sign in again to issue this device a fresh
# API key (same server ⇒ the device keeps its identity and history).
npm run dev:desktop

# web dashboard (proxies /graphql to the server; set EUNOMIA_SERVER_URL to
# point at a remote server instead)
npm run dev:web                         # http://localhost:5173

# mobile agent (Android) — needs a dev build (native module), not Expo Go:
#   cd apps/app && npx expo run:android
# then grant "Usage access" from the in-app prompt. Set up mirrors desktop:
# server URL + email magic link. Syncs on foreground + ~15 min in background.
npm run dev:mobile

# checks
npm run lint        # biome: format, lint, import order (`lint:fix` writes)
npm run typecheck
npm test
```

`biome.json` at the root covers every workspace. Generated output — the agent's
GraphQL SDK, drizzle migrations, the tray icon — is excluded, so regenerating
it never fails the gate.

### Sync interval

Agents sync (drain their ping outbox to the server) **once per minute by
default**. Per device:

- **Desktop** — set during setup (window or `npm run provision`), stored as
  `syncIntervalSeconds` in the userData `config.json`; the
  `EUNOMIA_SYNC_INTERVAL_SECONDS` env var overrides both.
- **Android** — "Sync every" field on the status screen. Applies to
  foreground syncs; background syncs can't run more often than Android's
  15-minute WorkManager floor (a *longer* configured interval slows the
  background task down too). **Keep running when closed** removes the floor —
  a foreground service holds its own timer, so the configured interval is the
  one you get whether the app is open or not.

The floor everywhere is 10 seconds; nothing is lost at any interval — pings
wait in the agent's ping log until the next sync.

### Ping log

Every ping an agent captures is appended to a daily JSONL file in its data
directory (`pings/YYYY-MM-DD.jsonl`, UTC days, about 1 MB a day of continuous
use), and uploading only moves a cursor (`pings/cursor.json`) — nothing is
deleted when the server takes it. The log is a local record of what the agent
captured, and an outage costs nothing unless it outlasts the retention window.

Day files older than **30 days** are deleted, uploaded or not. Change it with
`logRetentionDays` in the agent `config.json` (minimum 1). A build that still
has an `outbox.jsonl` from before the log existed moves its queued pings into
the log on first start.

### Privacy controls

Sanitization is client-side and runs before a ping is queued, so filtered
data never touches disk or the server. All of it lives in the agent
`config.json` (desktop userData dir; Android document dir). The lists hold
case-insensitive regexes matched against the app identifier (executable name
on desktop, package name on Android):

```json
{
  "captureLevel": "context",
  "ignoreApps": ["^keepassxc", "signal"],
  "redactApps": ["^firefox"]
}
```

- **`captureLevel`** — how much of every ping this device keeps:
  - `"title"` (the default) — app, context and window title.
  - `"context"` — app and context; the window title is stripped.
  - `"app"` — app only; title and context are stripped.

  "Context" here means what the agent reads itself, which today is the
  browser site's hostname on Windows and macOS. Contexts your server's context
  rules extract from window titles need the title, so they are lost at
  `"context"`: the title never leaves the device for the server to match.
  Category rules that match on titles stop matching for the same reason. The
  level applies to pings recorded after the change; what is already in the
  ping log keeps its detail.
- **`ignoreApps`** — matching pings are dropped entirely; the time appears
  nowhere.
- **`redactApps`** — the time still accrues to the app, but its window title
  and context (browser site) are stripped before anything leaves the device,
  whatever the capture level.

Invalid regexes are skipped with a console warning rather than blocking
tracking, and an unrecognized `captureLevel` means the default. Independently
of these settings, browser tracking only ever reports the site's hostname —
full URLs never leave the machine. On Android there is no shell to edit
`config.json` from, so the app edits all three itself: **Privacy…** on the
status screen (also on desktop). Desktop applies a change on save; Android on
its next sync.

Android adds a third control on the same screen, **Only apps you can open**
(`launchableAppsOnly`, on unless set to `false`). The OS usage log records
every activity that reaches the screen, and much of that is not an app anyone
spent time in — the launcher between two apps, the notification shade, a
permission dialog, a Play Services hand-off. The filter keeps only packages
with a launcher entry, the same question the app drawer asks, so system
screens are never queued. It applies after pings are synthesized, so the app
you left is not credited with the launcher's time; as with `ignoreApps`, the
gap a dropped span leaves accrues to whatever comes back, capped at 30
seconds.

### Packaging the desktop agent

```bash
npm run dist:linux -w @eunomia/app   # release/eunomia-agent-*.AppImage
npm run dist:win -w @eunomia/app     # release/eunomia-agent Setup *.exe
```

Both export the agent UI (`expo export --platform web`), bundle the main
process with esbuild, and cross-build from Linux (`dist:win` downloads the
win32 `x-win` prebuild, which it skips when Windows is already the host). The Windows build is a one-click per-user NSIS installer — no
admin prompt, and uninstalling keeps the ping log/config in AppData. It is
unsigned, so SmartScreen will warn on first run ("More info" → "Run
anyway"). Packaged agents **launch at login** once provisioned — an XDG
autostart entry on Linux, a login item on Windows/macOS. It is on by default,
with a checkbox on the setup window and a **Start at login** toggle in the tray
menu (`{"autostart": false}` in `config.json` is the same switch, seen from
disk). Running from source (`npm run dev:desktop`) remembers the choice but
never touches login items. Uninstalling on Windows
removes the login item too; on Linux there is no uninstaller, so deleting the
AppImage leaves `~/.config/autostart/eunomia-agent.desktop` behind for you to
remove as well.

`.github/workflows/desktop.yml` builds both installers and attaches them to the
GitHub release. It chains off the `Release` workflow that publishes the server
image rather than triggering on the release itself: semantic-release publishes
with `GITHUB_TOKEN`, and events raised by that token do not start workflow
runs. The version in `apps/app/package.json` is not what ships — nothing bumps
it, so the job stamps the release tag in before packaging, and the installer
names and the tray both report it. Windows is built on a Windows runner rather
than cross-packaged under wine. A pull request that touches the shell, its
`package.json`, or `packages/agent` packages an AppImage and reads the asar
back, which is the only check that sees a packaging mistake — `tsc` and esbuild
cannot.

### Packaging the Android agent

Test APKs are built by EAS, not locally — the Android SDK, the JDK, and the
signing keystore all live on Expo's side:

```bash
npm run apk:eas -w @eunomia/app         # eas build -p android -e preview
npm run dist:apk                        # local gradle fallback (needs JDK + SDK)
```

`.github/workflows/android.yml` ships the app on every push to `main` that
touches it, and on demand from the Actions tab with a profile picker. It needs
an `EXPO_TOKEN` repository secret; without one it skips rather than fails.
Commits that change only JavaScript go out as an over-the-air update rather than
a new APK — the phone picks one up on its next launch, background sync included
— and only a change to the native runtime triggers a build. The result is an installable APK, not a Play-Store bundle — sideload it
with `adb install` or by opening the file on the phone. Android's "Start at
login" is the **Sync in the background** toggle: WorkManager keeps the
registration across reboots. **Keep running when closed** is the stronger
version of the same promise — a foreground service with a permanent
notification, for phones whose battery manager force-stops idle apps; see
[Staying alive](apps/app/BUILDING.md#staying-alive). Account setup, the
keystore step, and the local fallback are in
[apps/app/BUILDING.md](apps/app/BUILDING.md).

Only one agent runs per machine — launching it again (Start menu, shortcut)
opens the dashboard from the instance already running rather than starting a
second sampler. It tees its console output to `agent.log` in the same folder
as `config.json` (tray → **Show log file…**, capped at ~512 KB), which is the
only way to see what a packaged Windows build is doing.

### Login (magic link)

Login is passwordless: `requestMagicLink(email)` emails a single-use link
(printed to the server console when no `SMTP_HOST` is configured) that lands
on the dashboard as `/?token=…`, which `verifyMagicLink` exchanges for a
bearer session. Accounts are created on first login.

Set `UNSAFE_LOCAL_NETWORK=true` on the server to skip the inbox round-trip:
`requestMagicLink` then returns the token directly in the response, and the
dashboard and the desktop setup window log straight in from just an email
address. **Anyone who can reach the server can sign in as any email** — only
use it on a trusted local network.

### API keys (for other apps)

The dashboard's **API keys** tab issues keys for anything that isn't an agent:
an MCP client, a script, another app on your network. Name one, optionally give
it a lifetime (30/90/365 days, or none), and the key is shown **once** — the
server stores only a hash of it, so a key that isn't copied has to be reissued.
Send it as `x-api-key` to `/graphql` or `/mcp`.

A key acts as you, over your own data, and inherits the same per-user scoping a
session gets — so give each integration its own key and revoke the one you stop
trusting. Revoking deletes the row, which is the whole credential: the holder is
refused on its next request. Renaming doesn't rotate anything.

The one thing a key cannot do is manage keys. `apiKeys`, `createApiKey`,
`renameApiKey` and `revokeApiKey` require a signed-in session and refuse any
API-key request with `UNAUTHENTICATED`, so a leaked key can neither enumerate
its siblings nor mint a successor that would outlive its revocation.

Device keys live in the same table but are handed out by the pairing flow and
managed under **Devices** — they carry a `deviceId` and are deliberately not
listed or revocable here. Both kinds are described in
`apps/server/src/api-keys.ts`.

### Contexts (sites, projects, books, workspaces)

An activity is keyed by `(app, context)`, where **context** is an optional
sub-app division: gmail and youtube in the same browser, two novels in
novelWriter, or two Ableton projects each get their own activity row.

Context comes from two sources:

- **Browsers** — on Windows/macOS the agent reads the focused tab's URL and
  sends only the **hostname** (`mail.google.com`); full URLs never leave the
  machine.
- **Everything else** — per-user `contextRules` evaluated server-side at fold
  time. Each rule is a case-insensitive regex over the window title whose
  **first capture group** becomes the context (optionally narrowed by an
  `appPattern`); lower `priority` runs first, first non-empty capture wins.
  Supporting a new app is a rule insert, not an agent update:

  ```graphql
  mutation {
    novel: createContextRule(appPattern: "^novelwriter",
      titlePattern: "^(.+?) - novelWriter") { id }
    ableton: createContextRule(appPattern: "^ableton",
      titlePattern: "^(.+?)\\*? - Ableton Live") { id }
    vscode: createContextRule(appPattern: "^code",
      titlePattern: "— (.+?) — Visual Studio Code") { id }
  }
  ```

Category rules can match on context too (`contextPattern:
"youtube\\.com"` → Distraction); a context pattern never matches an activity
that has no context. Context is part of the row's identity, so rules apply
**forward-only** — time already folded into a contextless row stays there.

### Merging entries (one thing, two names)

The dashboard's unit of time is an **entry** — the `(app, context)` pair that
activities fold into and summaries roll up under. The same real thing acquires
two of them whenever the name it arrives under changes: a phone reporting
`com.instagram.android` until its agent learns to ask Android for `Instagram`,
a browser context left behind by a rewritten `contextRule`, an app renamed
between agent versions.

Nothing else puts those back together — category rules label time rather than
rename it, and context rules only shape rows folded from now on. So a
**merge rule** says "this entry IS that one", by exact value rather than by
pattern (the entry is picked off what has actually been recorded, so there is
nothing for a regex to generalize over):

```graphql
mutation {
  createMergeRule(fromApp: "com.instagram.android", toApp: "Instagram") { id }
  # One entry inside an app, rather than the whole app:
  createMergeRule(fromApp: "chrome", fromContext: "x.com",
    toApp: "chrome", toContext: "twitter.com") { id }
}
```

It is applied twice: at fold time, so pings still arriving under the old name
land under the new one, and over stored history — **activities and summaries
both**, so days whose raw activities have already aged out under
`ACTIVITY_RETENTION_DAYS` move too. Creating a merge sweeps immediately;
`applyMergeRules` re-runs the sweep for activity that arrived afterwards.

Omitting `fromContext` merges the whole app and carries each entry's context
across, so `toContext` must be omitted as well. Chains resolve in one pass
(merge A into B today, B into C next month), and a rule whose target leads back
to its source is refused rather than resolved arbitrarily. Deleting a merge is
a forward switch, not an undo: new pings fold under the old name again, but the
two names were folded into one row and nothing records which seconds came from
which.

The **Merge entries** tab drives all of this — every recorded entry with its
total, and a merge on each.

### Exporting your data

The dashboard's **Settings** tab downloads your account as files, in three
formats:

- **Everything** — `eunomia-export-<date>.jsonl.gz`: gzipped JSON Lines, a
  `{"format":"eunomia-export","version":1,…}` header, then one record per line
  tagged with `type`: `profile` (with the zone your days split in), `device`,
  `category`, `categoryRule`, `contextRule`, `mergeRule`, `summary`,
  `activity`, `focusSegment`, `ping`, in that order, and a closing
  `{"type":"end","counts":{…}}` (missing means the file was cut short). It
  never contains API keys, sessions or any other credential — the export
  doesn't read those tables at all. Always the whole account.
- **ActivityWatch buckets** — the raw ping log in a date range, as
  aw-server's export JSON: an `aw-watcher-window_<device>` and an
  `aw-watcher-afk_<device>` bucket per device, for ActivityWatch's
  **Import** page. Events use the same 30-second gap and 2-minute idle rules
  the server folds time with. ActivityWatch refuses to import a bucket whose
  id it already has, so a device named like the ActivityWatch host's own
  hostname won't import alongside that host's buckets.
- **Daily totals (CSV)** — `day,device,category,app,context,seconds` for a
  date range, days in your zone, uncategorized time with an empty category.

The same files come from GraphQL, one chunk per call — call
`accountExport(format:, from:, to:)`, append `data`, and call again with
`cursor: next` until `next` is null:

```graphql
query { accountExport(format: SUMMARIES_CSV, from: "2026-08-01", to: "2026-09-01") { data rows next } }
```

It is session-only: an API key can't export, so a leaked one can't walk off
with every window title you've ever had (and so it isn't an
[MCP](#mcp-for-ai-agents) tool either). The chunks are not a snapshot — rows
written while an export runs may or may not be in it. For a server-level
backup see [Backing up](#backing-up-and-starting-over).

### Importing history

The **Import** card under **Settings** reads a file in the browser and sends
it on in chunks. Everything lands in the signed-in account. It accepts three
kinds of file:

- **Eunomia export (everything)** restores a bundle from the section above:
  - Your time zone is restored only if you haven't chosen one.
  - Categories are matched to yours by name. A rule identical to one you have
    is skipped, and so is a merge for an entry you already merge.
  - Every device comes back as a **new** device with no key. Pair an agent
    with one, or merge it into the device you use now.
  - The ping log goes through the same ingestion as an agent upload, so
    activities and focus segments are rebuilt by your rules, not copied.
  - Daily totals are restored only for days before a device's log begins,
    such as pruned days, so no day is counted twice.
  - Restoring the same bundle twice duplicates its devices.
- **ActivityWatch** reads aw-server's export JSON:
  - Pick one machine. Its window, AFK and aw-watcher-web buckets become pings
    on a device you pick or a new one.
  - An aw-watcher-web page's hostname becomes the context.
  - Time the AFK watcher marked afk isn't counted.
  - The result folds like live data, to within the 30-second gap and 2-minute
    idle rules. ActivityWatch buckets exported from here import back to the
    same totals.
  - When the import lands before a device's existing history, that device is
    replayed.
  - Pings from before a device's pruned history are left out, with a warning.
    Import into a new device to keep them.
- **RescueTime** reads its activity report, as CSV or API JSON:
  - RescueTime only has totals per app per period, not moments, so the report
    becomes **daily totals** on the chosen device. Those days have no timeline,
    focus or sessions.
  - Your own category rules apply, not RescueTime's categories.
  - The same file imported twice counts twice.
  - A later time zone change or `applyCategoryRules` doesn't reach those
    totals.

Over GraphQL it is `importChunk(source:, records:, cursor:, target:, done:)`,
called once per chunk:

- Each record is one line of the file, or one event, for ActivityWatch.
- Pass the returned `next` back as `cursor`, and `done: true` on the last
  chunk.
- `restart: true` means a bundle wants its file sent again from the top.

See `apps/web/src/lib/import.ts` for the client loop. Each call is at most
5,000 records and 8 MiB, and is its own transaction. Like export, import
accepts only a signed-in session, never an API key.

## Self-hosting

```bash
docker compose up --build   # app on :4000 + postgres 17
```

The app container serves the built web dashboard at `/`, GraphQL at
`/graphql` and [MCP tools](#mcp-for-ai-agents) at `/mcp` — one origin, so magic
links default to the server's own URL (override with `APP_URL` only if the
dashboard is hosted elsewhere).

### Before you expose it

`BETTER_AUTH_SECRET` signs every session token and hashes every magic link.
There is no default: the server refuses to start without a real one, and
compose refuses to start without it in `.env`.

```bash
openssl rand -base64 32   # put the result in .env
```

Login is passwordless, so an internet-reachable server with no policy lets
anyone who finds the port create an account. Pick one:

- `ALLOWED_EMAILS=me@example.com,*@work.test` — only these addresses may sign
  up, sign in, or receive a link. Anything else is refused outright.
- `DISABLE_SIGNUP=true` — existing accounts keep working, new ones can't be
  created. Requests for unknown addresses return the same "ok" as any other,
  so the server never reveals who has an account. Set this once yours exists.

Sign-in attempts are rate limited in-process (5 per address and 100 overall
per 15 minutes), which is enough to stop a mail-sending oracle but is not a
substitute for a proxy-level limit.

**Terminate TLS in front of it.** The container speaks plain HTTP, and every
agent sends its API key and every browser its bearer token on each request.
Put Caddy, nginx, or a Cloudflare tunnel in front, point `BETTER_AUTH_URL` at
the `https://` address (magic links are built from it), and publish only the
proxy — the `4000:4000` mapping in `docker-compose.yml` is for direct LAN use
and should be narrowed to `127.0.0.1:4000:4000` behind a local proxy.

The Android agent makes this concrete. Android blocks plain HTTP by default, so
only its test builds — the `development` and `preview` EAS profiles, and a
locally built APK — are allowed to reach an `http://` server; a `production`
build won't connect to one at all. A phone is also the strongest argument for
the proxy: it follows you onto networks your desktop never touches, and on each
of them an `http://` server hands out that device's API key in the clear.

`UNSAFE_LOCAL_NETWORK=true` returns magic-link tokens directly in the GraphQL
response and skips the secret check. It exists so a LAN install works without
an inbox; anyone who can reach the port can then log in as anyone.

Each user's days split at the midnight of their own time zone, chosen in the
dashboard's **Settings** tab (or with the `setTimeZone` mutation). `TZ` (IANA
name, e.g. `America/Chicago`) is the default for users who haven't chosen one;
unset, that is UTC. Changing a user's zone moves every rolled-up activity still
on file onto the new zone's days. Summaries older than the retained activities
(`ACTIVITY_RETENTION_DAYS`, below) can't be moved — nothing records which
instants they came from — so they keep the day they were bucketed into.
Changing `TZ` itself moves nothing, so set it before real data accrues if
users will rely on the default.

Every 15 minutes the server folds closed activities into precomputed
per-day/app/category **summaries**, then deletes raw activity rows older
than `ACTIVITY_RETENTION_DAYS` (default 90, `0` to keep them forever).
Summaries are never pruned, so the charts keep full history — what ages out
is per-activity detail: window titles, and the ability to re-categorize an
individual old activity. Rows that haven't been rolled up yet are never
deleted at any age.

Every accepted ping is also kept raw, in the `pings` table, pruned on the
same `ACTIVITY_RETENTION_DAYS`. Activities and summaries are derived from it:
when an agent uploads pings older than ones already counted (a late flush of
its queue), the server rebuilds that device's history from the log within a
minute, and `replayDevice` rebuilds it on demand under the current rules.
Budget roughly 250 bytes per ping with its index — at one ping every 10
seconds, about 700 KB a day for a device used eight hours a day, so around
65 MB per device at the default 90-day retention.

The server also records **focus segments**: the stretches of time credited to
one activity without a break, in the order they happened — the timeline that
overlapping activities can't give. They are written by the same fold (and
rebuilt by the same replay) as activities, so a segment's span agrees with the
activity's `activeSeconds`: it breaks where a gap stops being credited, and is
cut back to the moment input stopped when the user goes idle. Read them with
`focusSegments`, narrowed by `deviceId` and `startedAt`; they come back oldest
first and carry their `activity` (app, context, category). They are deleted
with their activity, so the same retention applies.

`GET /healthz` answers `{"ok":true,"version":"…"}` after a `select 1` against
Postgres, and `503` (with the error) when that fails — so it reports the
outage that matters instead of just "the process is up". Compose uses it as
the `app` service's healthcheck; point any external monitor at it too.

### Backing up and starting over

All state lives in the `pgdata` volume — the database is the only thing worth
backing up (agents keep their own ping log and config locally). A dump is every
account at once, restorable only into this server; to take one user's data
elsewhere, [export it](#exporting-your-data) instead.

```bash
# back up: a single compressed SQL dump
docker compose exec -T postgres pg_dump -U eunomia eunomia | gzip > eunomia-$(date +%F).sql.gz

# restore into an empty database (stop the app first so nothing writes
# mid-restore; migrations on next start are then no-ops)
docker compose stop app
gunzip -c eunomia-2026-08-26.sql.gz | docker compose exec -T postgres psql -U eunomia eunomia
docker compose start app
```

Starting clean — this **deletes every recorded activity, account, and device
key**, and every agent will need re-provisioning:

```bash
docker compose down -v      # -v drops the pgdata volume
docker compose up --build   # fresh database, migrations reapplied
```

The app container applies committed drizzle migrations on startup
(`drizzle-kit migrate`), so upgrades are `git pull && docker compose up
--build`. After changing `src/db/schema.ts`, generate a new migration with
`npm run db:generate -w @eunomia/server` and commit the `drizzle/` output.

Tests use [PGlite](https://pglite.dev) (in-process Postgres) — no database
container needed for `npm test`.
