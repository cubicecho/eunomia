# eunomia

Multiplatform activity tracker: a desktop tray agent that records which
application is in use and sends it to a self-hosted, multi-user server.

Research and architecture decisions: [.agents/research.md](.agents/research.md).

> **Status:** scaffold. The activity data model (how usage is stored/ingested)
> is deliberately not implemented yet — under design review.

## Layout

- `apps/server` — GraphQL Yoga + `@vantreeseba/drizzle-graphql` + Drizzle (1.0 RC) + Postgres,
  better-auth (sessions + device API keys), `@vantreeseba/graphql-casl` permissions.
- `apps/desktop` — Electron tray-only agent (`@miniben90/x-win` + `powerMonitor`).
- `packages/shared` — shared Zod schemas/types.

## Development

```bash
npm install

# server (needs Postgres, e.g. `docker compose up postgres`)
cp .env.example .env
npm run db:push -w @eunomia/server   # create tables
npm run dev:server                   # http://localhost:4000/graphql

# desktop agent
npm run dev:desktop

# checks
npm run typecheck
npm test
```

## Self-hosting

```bash
docker compose up --build   # app on :4000 + postgres 17
```

Tests use [PGlite](https://pglite.dev) (in-process Postgres) — no database
container needed for `npm test`.
