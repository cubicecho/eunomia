# eunomia

Multiplatform activity tracker: a desktop tray agent that records which
application is in use and sends it to a self-hosted, multi-user server.

Research and architecture decisions: [.agents/research.md](.agents/research.md).

> **Status:** working MVP. GraphQL-only API (auth included — no REST routes),
> magic-link login, device provisioning with API keys, activity ingestion via
> stateless pings, categories with manual assignment and regex
> auto-categorization rules, per-user authorization scoping, and a web
> dashboard.

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

# desktop agent — provision once (sign in, register this machine, write
# config.json), then run the tray agent
npm run provision -w @eunomia/desktop
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
`requestMagicLink` then returns the token directly in the response, and both
the dashboard and `npm run provision` log straight in from just an email
address. **Anyone who can reach the server can sign in as any email** — only
use it on a trusted local network.

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
