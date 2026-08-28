# Road to 1.0

Review date: 2026-08-25 · `main` @ 35a1aaf · 25 commits
Updated 2026-08-25: **A1–A5 are done** (see each entry). Suite now 100 server
+ 25 agent tests, all green; typecheck clean. `apps/web` has since been rebuilt
on React + shadcn/ui + Recharts — same three views, same GraphQL client.
Updated 2026-08-27: **B1 is done** — see the entry. The server schema is now
SDL-first (`apps/server/src/graphql/domain.graphql` + graphql-codegen), which
is what made the shared package's duplicate ping contract removable.
Updated 2026-08-28: codegen output moved out of git into one workspace package,
`packages/gql` (`@eunomia/gql/{resolvers,agent,web}`), regenerated on install
and before every build; `schema.graphql` stays committed as the contract a
reviewer diffs. Seven workspaces now, counting the root.

## Where the tree actually is

`npm run typecheck` clean across all six workspaces. `npm test` green:
78 server tests (PGlite) + 16 agent tests, ~50s. Feature-complete against the
MVP scope in `.agents/research.md`: GraphQL-only server, magic-link auth,
device provisioning, ping fold, contexts, category + context rules, rollup
summaries, retention pruning, web dashboard, desktop tray agent, Android agent.

What's missing for 1.0 is not features. It is (a) five defects that only show
up in a real deployment, (b) the deployment/operations surface a self-hosted
product needs, (c) release mechanics that don't exist yet.

---

## A. Blockers — fix before tagging

All five have landed. Each entry keeps its original diagnosis, with what
shipped noted at the top.

### A1. The dashboard silently drops today's evening on any non-UTC server
**DONE.** `parseRange` now truncates both bounds to local midnight *in SQL*
(`date_trunc('day', $n::timestamptz)`), and `liveDayBounds`/`summaryDayBounds`
derive from that one expression, so the live and rolled halves cut at the same
instant. Regression test: `test/rollup.test.ts` "a non-UTC range reads the same
live and rolled" (the old code returned `[]` for the live half). Test DBs now
pin their session zone to UTC so day assertions stop depending on the developer's
machine. The dashboard's `defaultRange()` builds local `YYYY-MM-DD` bounds
instead of `setUTCHours`.
**Verified with a PGlite repro.** Server `TZ=America/Chicago`, one activity at
20:00 local (`2026-08-26T01:00:00Z`), dashboard's own default range
(`from: 2026-08-19, to: 2026-08-26`):

```
live (un-rolled):  appSummary => []
after rollupActivities(): appSummary => [{ app: "code", seconds: 3600 }]
```

The same hour is invisible for up to 15 minutes, then pops into existence when
the rollup timer fires.

Cause: the two branches of `categorySummary`/`appSummary` interpret the range
differently. The rolled branch converts the bounds to session-TZ days
(`summaryDayBounds`, `apps/server/src/graphql/schema.ts:119`), while the live
branch compares raw instants (`lt(activities.startedAt, to)`, schema.ts:211 and
:260) against a `to` that `parseRange` (schema.ts:107) parsed as **UTC**
midnight — 19:00 local. `apps/web/src/main.ts:54` `defaultRange()` builds those
bounds from `setUTCHours(24,0,0,0)`, so the clipping happens on every default
page load.

Fix: derive both branches' bounds from one day expression evaluated in the
session zone (accept `YYYY-MM-DD` and build `::date AT TIME ZONE
current_setting('TimeZone')` bounds in SQL), so live and rolled rows agree.
Add a test at `TZ=America/Chicago` covering the last-day boundary in both
states — the current suite only asserts TZ behaviour on the *rollup* path
(`test/rollup.test.ts:91`).

### A2. Agents silently discard pings once a device key stops working
**DONE.** `classifyResponse` replaces the `data != null` check: a batch is
dropped only if at least one aliased `recordPing` returned a row, or if every
error is one retrying can't fix (`BAD_USER_INPUT`). Everything else — auth,
rate limit, server fault, anything unrecognized — keeps the batch queued, since
a growing outbox is recoverable and a dropped ping is not. Partial success still
drops, because re-sending the pings that landed would double-count folded time.
The uploader now exposes `status(): {pending, error, lastUploadAt}`, the tray
menu and tooltip say "Upload failing: … (n queued)", and the Android status
screen shows the same row. 9 tests in `packages/agent/src/upload.test.ts`, plus
the end-to-end shape in `test/http.test.ts`.
**Verified.** An unauthenticated batch in exactly the shape
`packages/agent/src/upload.ts` builds returns:

```
HTTP 200 {"errors":[{"message":"Not authenticated","path":["p0"]}],"data":{"p0":null}}
```

`recordPing` is a nullable field, so field-level auth failure nulls the field
and leaves `data` non-null. `uploadBatch` (upload.ts:44) returns
`body.data !== undefined && body.data !== null` → **true** → `createUploader`
drops the batch from the outbox. Delete a device from the dashboard (or let a
key expire) and the agent quietly throws away everything it records from then
on, while the tray still reads "Uploading to …".

Fix: treat auth/authz errors in the response as a failure (don't drop), keep
dropping only on per-ping validation errors, and surface the state in the tray.

### A3. Every domain error reaches clients as "Unexpected error."
**DONE.** `src/errors.ts` builds the four caller-facing `GraphQLError`s
(`BAD_USER_INPUT`, `NOT_FOUND`, `UNAUTHENTICATED`, `FORBIDDEN`, plus
`RATE_LIMITED`); every user-facing throw in `src/` now uses one, and anything
not built there stays masked on purpose. The web client branches on
`extensions.code` rather than the message. `createApp` was extracted from
`index.ts` so `test/http.test.ts` can drive the real Yoga surface — the gap
that hid this — including a test asserting an unexpected failure is *still*
masked.
**Verified.** Yoga masks non-`GraphQLError` throws by default and nothing
overrides it (`apps/server/src/index.ts:27` has no `maskedErrors`). There are
32 `throw new Error(...)` sites in `apps/server/src` — "Invalid pattern: …",
"Unknown category", "Invalid date range", "No device: pass deviceId…" — all of
which arrive as `{"message":"Unexpected error.","extensions":{"code":"INTERNAL_SERVER_ERROR"}}`
and dump a stack trace into the server log. A bad regex in the rules UI shows
the user nothing useful.

Only `permissions.ts` throws a real `GraphQLError`, which is why
`'Not authenticated'` survives — and the dashboard's session-expiry recovery
depends on that string match (`apps/web/src/main.ts` `guarded`).

The suite can't catch this: every server test calls `graphql()` directly and
never goes through Yoga.

Fix: convert user-facing throws to `GraphQLError` with an `extensions.code`
(`BAD_USER_INPUT`, `NOT_FOUND`, `UNAUTHENTICATED`), have the web client branch
on the code rather than the message, and add one end-to-end HTTP test through
`createYoga` so error shape is covered.

### A4. A reachable server is an open-registration server
**DONE.** `ALLOWED_EMAILS` (exact address or `*@domain`) and `DISABLE_SIGNUP`,
read by `src/registration.ts` and enforced in the auth gateway at request time
— better-auth's own `disableSignUp` still emails a link to a stranger and only
refuses at verify, so it can't be the only gate. A disallowed address gets
`FORBIDDEN`; with sign-ups closed, an unknown address gets the same silent `ok`
as anyone else, so the server never reveals who has an account. 5 tests in
`test/registration.test.ts`, 12 unit tests in `test/policy.test.ts`.
Email+password stays for now (the desktop provisioning flow uses it); dropping
it is a separate call.
`requestMagicLink` is `accept` in `permissions.ts:37` and creates the account on
first use; `signUp` (email+password) is public too. Anyone who can reach the
port gets an account with their own devices and dashboard. That's fine on a LAN
and wrong for anything port-forwarded — which is what "self-hosted" will mean
for most 1.0 users.

Fix: gate account creation. Minimum viable: `ALLOWED_EMAILS` (exact or domain
glob) checked before user creation, plus `DISABLE_SIGNUP=true` for
"the accounts that exist are the only accounts". Also decide whether
email+password stays at all — magic link is the documented primary and
`emailAndPassword` doubles the auth surface for no stated benefit.

### A5. Deployment defaults are unsafe and unvalidated
**DONE.** No default secret anywhere: `.env.example` ships it empty, compose
uses `${BETTER_AUTH_SECRET:?…}`, and `src/env.ts` refuses to boot on a missing
or known-example value unless `UNSAFE_LOCAL_NETWORK=true` (short secrets warn).
`src/rate-limit.ts` caps sign-in attempts at 5 per address and 100 overall per
15 minutes across `signUp`/`signIn`/`requestMagicLink`; device keys stay
unlimited as intended. README gained a "Before you expose it" section covering
the secret, the registration knobs, and terminating TLS in a reverse proxy.
- `docker-compose.yml:16` ships `BETTER_AUTH_SECRET:-dev-secret-change-me`.
  Nothing checks it at startup, so `docker compose up` on a VPS yields
  forgeable sessions and nobody is told.
- No rate limit on `requestMagicLink` / `signIn`. Free mail-bomb relay,
  account enumeration, and password brute-force. (Device keys are
  deliberately unlimited — `rateLimitEnabled: false` in `auth.ts` — that part
  is correct and should stay.)
- README's self-hosting section never mentions TLS. Bearer session tokens and
  device API keys go over plaintext HTTP by default.

Fix: refuse to boot on a missing/default secret unless `UNSAFE_LOCAL_NETWORK`
is set; add a small in-process rate limiter on the two public auth mutations;
document a reverse-proxy + TLS deployment as *the* recommended path.

---

## B. Should fix for 1.0

| # | Item | Where |
|---|---|---|
| B1 | **Done.** Deleted, along with the server dependency, the two Dockerfile `COPY`s and the CI path filter. Taken the other way for the ping contract itself: the schema is the source, and `@eunomia/agent`'s `Ping` is now `Required<PingInput>` off the generated SDK, so it can't drift again. Original: dead code — nothing imported it, yet it was a server dependency and got copied into the image, and its `activityPingSchema` was stale (no `context` field), so it actively misinformed. | deleted |
| B2 | No `/health` endpoint; compose healthchecks postgres but not the app, so nothing detects a wedged server. | `apps/server/src/index.ts` |
| B3 | No CI. Typecheck + tests run in ~1 min and are already green — wire them to push/PR before the tag, not after. | `.github/` absent |
| B4 | No linter. `biome-ignore` comments exist in the source but biome isn't installed, so they're inert. Either install biome or drop the pragmas. | `graphql/permissions.ts:20` |
| B5 | No LICENSE. Every `package.json` is `0.0.0` while `apps/mobile/app.json` already says `1.0.0`. No CHANGELOG, no tags. | repo root |
| B6 | Platform support is undocumented. Linux/Wayland gives no window titles through x-win (research.md accepted X11-only); macOS has no build target at all (`dist:win`/`dist:linux` only), let alone signing/notarization. Decide in-or-out and put a support matrix in the README. | `apps/desktop/package.json` |
| B7 | No SIGTERM handling — `docker compose down` SIGKILLs the rollup timer and any in-flight fold. | `apps/server/src/index.ts` |
| B8 | GraphQL is unhardened: introspection on, no depth/complexity limit, and `uploadBatch` legitimately sends 50-alias documents, so there's no natural size ceiling to lean on. Cap document size / alias count. | `apps/server/src/index.ts` |
| B9 | No backup/restore guidance. A self-hosted 1.0 should tell people how to `pg_dump` the volume and restore it. | `README.md` |
| B10 | `foldPing` isn't transactional and there's no unique key on open `(deviceId, app, context)`. Low likelihood today (the uploader is reentrancy-guarded, one device per agent), but a partial unique index on `closedAt IS NULL` is cheap insurance against duplicate open rows. | `activity/fold.ts:62` |
| B11 | *Mostly done with A2*: the tray now shows outbox depth and the upload error, and the tooltip changes when uploads fail. Still no last-sync time in the menu (`lastUploadAt` is tracked but unshown). | `apps/desktop/src/main.ts` |
| B12 | `applyCategoryRules` sweeps every activity with a round-trip per row. Fine now, slow after a few months of data. | `activity/rules.ts:282` |

---

## C. Release mechanics (none of this exists yet)

1. Version stamp: pick 1.0.0, set it across workspaces, keep `app.json` in sync.
2. `CHANGELOG.md` seeded from the 25 commits so far.
3. Tag + GitHub release carrying the AppImage and the Windows zip
   (`dist:linux`, `dist:win` already cross-build from Linux).
4. Publish the mobile APK the same way — no Play Store, per the research doc.
5. A "first 10 minutes" section in the README: compose up, set `TZ` and
   `BETTER_AUTH_SECRET`, sign in, install the agent, see data.
6. An upgrade note: migrations apply on boot, so `git pull && docker compose up
   --build` — say it as a promise, and keep it true.

## D. Explicit non-goals for 1.0

State these in the README so they read as decisions rather than gaps: iOS
agent, browser extension, teams/orgs, Wayland window titles, desktop
auto-update, Tauri port, SaaS/billing.

---

## Suggested order

1. ~~A2, A1 — data loss and data invisibility, in that order.~~ done
2. ~~A3 + the end-to-end Yoga test~~ done — `test/http.test.ts`.
3. ~~A4, A5~~ done — the server can be exposed now.
4. B3, B2, B7 — CI and operability, cheap and unblocks confident iteration.
5. B1, B4, B5, B6, B9 — cleanup and documentation.
6. C — tag it.

B8, B10, B11, B12 are fine to slip to 1.0.x if the tag is close.
