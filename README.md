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
- `apps/web` — Vite + vanilla-TS dashboard (sign-in, per-category/per-day/per-app views).
- `packages/shared` — shared Zod schemas/types.

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

# checks
npm run typecheck
npm test
```

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
