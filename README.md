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
  better-auth (sessions + device API keys), `@vantreeseba/graphql-casl` permissions.
- `apps/desktop` — Electron tray-only agent (`@miniben90/x-win` + `powerMonitor`).
- `apps/mobile` — Expo (Android-only for now) agent: a local Kotlin module reads
  Android's `UsageStatsManager` event log and the shared synthesizer turns it
  into pings retroactively — no live sampling service needed.
- `apps/web` — Vite + vanilla-TS dashboard (sign-in, per-category/per-day/per-app views).
- `packages/agent` — agent core shared by desktop and mobile: the generated
  GraphQL SDK (committed codegen output), crash-safe outbox, batch uploader,
  and usage-event → ping synthesizer.
- `packages/shared` — shared Zod schemas/types.

### GraphQL contract

`packages/agent/schema.graphql` and `packages/agent/src/gql/sdk.ts` are
generated and committed — they are the typed contract every agent builds
against. After changing the server schema, run:

```bash
npm run codegen   # prints server SDL, regenerates the agent SDK
```

A schema change that breaks an agent then fails `npm run typecheck` in that
package instead of failing at runtime.

## Development

```bash
npm install

# server (needs Postgres, e.g. `docker compose up postgres` — published on
# localhost:5433 to stay clear of any local postgres)
cp .env.example .env
npm run db:migrate -w @eunomia/server   # apply committed migrations
npm run dev:server                      # http://localhost:4000/graphql

# desktop agent — on first run it opens a setup window (server URL + email,
# magic-link sign-in, registers this machine), then lives in the tray.
# `npm run provision -w @eunomia/desktop` is the terminal equivalent.
npm run dev:desktop

# web dashboard (proxies /graphql to the server; set EUNOMIA_SERVER_URL to
# point at a remote server instead)
npm run dev:web                         # http://localhost:5173

# mobile agent (Android) — needs a dev build (native module), not Expo Go:
#   cd apps/mobile && npx expo run:android
# then grant "Usage access" from the in-app prompt. Set up mirrors desktop:
# server URL + email magic link. Syncs on foreground + ~15 min in background.
npm run dev:mobile

# checks
npm run typecheck
npm test
```

### Sync interval

Agents sync (drain their ping outbox to the server) **once per minute by
default**. Per device:

- **Desktop** — set during setup (window or `npm run provision`), stored as
  `syncIntervalSeconds` in the userData `config.json`; the
  `EUNOMIA_SYNC_INTERVAL_SECONDS` env var overrides both.
- **Android** — "Sync every" field on the status screen. Applies to
  foreground syncs; background syncs can't run more often than Android's
  15-minute WorkManager floor (a *longer* configured interval slows the
  background task down too).

The floor everywhere is 10 seconds; nothing is lost at any interval — pings
queue in the outbox until the next sync.

### Privacy controls

Sanitization is client-side and runs before a ping is queued, so filtered
data never touches disk or the server. Two optional lists in the agent
`config.json` (desktop userData dir; Android document dir), each holding
case-insensitive regexes matched against the app identifier (executable name
on desktop, package name on Android):

```json
{
  "ignoreApps": ["^keepassxc", "signal"],
  "redactApps": ["^firefox"]
}
```

- **`ignoreApps`** — matching pings are dropped entirely; the time appears
  nowhere.
- **`redactApps`** — the time still accrues to the app, but its window title
  and context (browser site) are stripped before anything leaves the device.

Invalid regexes are skipped with a console warning rather than blocking
tracking. Independently of these lists, browser tracking only ever reports
the site's hostname — full URLs never leave the machine.

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

## Self-hosting

```bash
docker compose up --build   # app on :4000 + postgres 17
```

The app container applies committed drizzle migrations on startup
(`drizzle-kit migrate`), so upgrades are `git pull && docker compose up
--build`. After changing `src/db/schema.ts`, generate a new migration with
`npm run db:generate -w @eunomia/server` and commit the `drizzle/` output.

Tests use [PGlite](https://pglite.dev) (in-process Postgres) — no database
container needed for `npm test`.
