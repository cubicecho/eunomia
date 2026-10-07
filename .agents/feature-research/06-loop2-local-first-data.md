# 06 — Loop 2: Local-first and data ownership

Research date 2026-09-12. Grounded in `01-eunomia-features.md` (commit `e044088`), competitor files 02–04,
the code (`packages/agent/src/outbox.ts`, `apps/server/src/activity/fold.ts`, `apps/server/src/db/client.ts`,
`docker-compose.yml`) and web sources listed at the end. Claims marked *(pk)* come from prior knowledge
and were not re-verified this session.

**Bottom line:** Eunomia today is a *self-hosted client-server* tracker with an offline-tolerant
uploader. It is not local-first. The agent is a sensor with a transmit queue: it can capture without the
server, but it cannot show you anything, keeps nothing after upload, and loses data if the server stays
away past the 50k-ping cap. The cheapest route to real local-first is **not** a sync engine. It is:
(1) keep an immutable local ping journal on the agent, (2) run the existing server against embedded
PGlite inside the desktop agent as a "standalone mode", and (3) treat sync as one-way log shipping of
immutable pings, with a small config sync coming back down. Pings are append-only facts, so no CRDT is needed.

---

## 1. What "local-first" means in 2026, and how Eunomia scores

### Definitions
- **Ink & Switch (2019), seven ideals:** (1) fast/no spinners, (2) multi-device, (3) offline read *and*
  write, (4) collaboration, (5) longevity (data outlives the vendor), (6) privacy (E2E encryption),
  (7) user control/ownership.
- **Kleppmann's 2024 short test** (Local-First Conf keynote, repeated on SE Radio 716, Apr 2026):
  *"In local-first software, the availability of another computer should never prevent you from working."*
  If the app stops working when the developer's (or your) server is gone, it is not local-first.
- **2026 discourse:** "local-first" has become a loose label. Sync-engine vendors (Electric, Zero,
  PowerSync) use it for "fast client cache over Postgres". Steven Deobald's Jan 2026 essay argues it
  should be treated as a spectrum. An app is *more* local-first if it is FOSS, native rather than web,
  prefers **immutable data models** over conflict resolution, is **server-optional**, and at minimum
  works **read-only offline**. Servers are fine as headless peers or relays, and multiplayer is optional.
  localfirst.fm and its "landscape" directory use this broader community framing.

### Scorecard for Eunomia (current architecture)

| Ideal | Score | Why |
| --- | --- | --- |
| 1. Fast | Partial | The dashboard is a web client doing GraphQL round-trips to the server. It's fine on a LAN (docker.lan) and slow over a WAN or VPN. The agent UI only shows queue status, with no local view of the data. |
| 2. Multi-device | **Strong** | This is the server's whole reason to exist. Summaries sum across devices, and devices can be merged or re-keyed. |
| 3. Offline | Capture only | Capture is offline-safe (JSONL outbox). **Reading** your data offline is impossible. **Writing** config (categories, rules, merges, privacy lists other than local ignore/redact) is impossible. Past about 6 days offline the outbox drops the oldest pings. |
| 4. Collaboration | N/A / weak | This is a personal tracker. Users are isolated, with no sharing. Not a priority for this ideal. |
| 5. Longevity | Partial | FOSS and self-hosted Postgres are good. But there's **no export format**, the data is only meaningful through a running server, raw pings are never stored anywhere (the fold is lossy: only the latest title is kept per activity), raw activities are pruned after 90 days, and a backup is `pg_dump` of the whole instance. |
| 6. Privacy | Weak–partial | Client-side ignore/redact and hostname-only URLs are good. There's no E2E and no built-in TLS. On a multi-user instance the **admin can read every user's window titles**. Magic-link login goes through SMTP. |
| 7. User control | Partial | You own the server, but the agent is useless without *a* server: no dashboard, no rules, no categories. Provisioning needs a reachable server and an email round-trip, or `UNSAFE_LOCAL_NETWORK`. |

### Where it is "self-hosted client-server" rather than local-first
1. **All interpretation is server-only.** `fold.ts` says so explicitly: *"The server owns all
   interpretation — the agent never tracks state."* Context rules, category rules, merge rules, rollups,
   summaries and MCP all live in Postgres and SQL.
2. **The outbox is a queue, not a store.** Pings are deleted on ack (`outbox.ts`) and dropped oldest-first
   at 50,000. After upload, the only copy is the server's *derived* activity rows.
3. **No source of truth survives on either side.** The server stores no raw pings, so history can't be
   re-derived (for example after a rule change for context rules, which are forward-only) and can't be
   re-shipped to another server.
4. **Identity and auth are server-issued.** Device keys come from `registerDevice`, and login needs magic
   links. An unprovisioned agent records but can't do anything with the recording.
5. **The dashboard is served by the server.** Opening it on the desktop means a remote webview with a
   session minted by the server.
6. **Late or backfilled data is second-class.** `foldPing` accrues nothing for a ping at or before the
   device's last recorded ping (the outbox comment relies on this for at-least-once idempotency). That's
   fine for a live stream, but it blocks merging a long-offline second history or importing old data into
   an active device.

---

## 2. Local-first options for the agent

### 2a. What competitors do for "no server / server down"
- **ActivityWatch:** the local server *is* the product (aw-server-rust + SQLite on `localhost:5600`), and
  the web UI is served locally. Sync (aw-sync) is folder export/import via Syncthing or Dropbox, still "in
  testing". 0.14 stopped re-syncing buckets from other hosts and added `--profile`.
- **ManicTime:** the desktop app has its own full local DB and UI and works fully offline. It optionally
  syncs to Server or Cloud, and the user chooses *how much detail is sent* (all activity / tags only /
  tags plus basic usage).
- **Timing:** local by default. Timing Sync is opt-in, doubles as an off-site backup, and is required for
  the web app. Automatic local ZIP backups sit in a `backups` folder.
- **solidtime desktop (Apr 2026):** window activity is stored **locally only, never sent to the server**.
  The server only receives time entries the user creates from it. This is a "privacy split".
- **Super Productivity:** data lives in IndexedDB. Sync targets are a local file, WebDAV, Dropbox or
  self-hostable E2E SuperSync.

The pattern is the same everywhere: **the desktop app is complete on its own, and the server is an
optional aggregator.** No competitor that has a server makes the desktop app depend on it for viewing.

### 2b. Options for Eunomia, cheapest first

**Option A — Local ping journal (prerequisite for everything else).**
Keep acknowledged pings in rotating per-day files, append-only (JSONL, or zstd-compressed JSONL once the
day closes), instead of deleting them on ack. Keep the outbox as a *cursor into the journal* ("uploaded up
to offset N"), not a separate copy. Cost: a desktop at ~8,640 pings/day × ~150 B ≈ 1.3 MB/day raw,
roughly 0.1–0.2 MB/day compressed. That's trivial. This alone fixes the drop-oldest data loss, enables
re-shipping history to a new or rebuilt server, and becomes the export and backup source.

**Option B — Standalone desktop mode = the server in-process on PGlite.** *Recommended.*
The server already runs on PGlite in tests (`@electric-sql/pglite ^0.5.5`, `Db` typed driver-agnostic
over `PgAsyncDatabase`, and schema features like `NULLS NOT DISTINCT` and `SELECT … FOR UPDATE` already
work under PGlite). The Electron main process could boot `apps/server` against a PGlite `dataDir` in the
app data folder, bind `127.0.0.1` only, auto-create a single local user, skip magic links (use a
per-launch local token handed to the dashboard window), and serve the same web dashboard. The result:
- Identical rules, rollups, dashboard and MCP offline, with **zero duplicated business logic**.
- "Connect to a server later" means replaying the local journal upstream.
- Caveats:
  - PGlite is single-connection. v0.4 (Mar 2026) added connection multiplexing, and the maintainers still
    describe `pglite-socket` as alpha with no durability warranty. Mitigate with the journal (Option A) as
    the true source, so a corrupt PGlite dir can be rebuilt from pings.
  - Startup time and memory of WASM Postgres in Electron (tens of MB) *(pk)*.
  - `TZ` currently goes through the node-postgres `options`. Under PGlite it would need
    `SET TimeZone` at boot.
  - **Android can't do this yet.** PGlite's native port ("libpglite" for React Native) is only on the
    roadmap.

**Option C — Android local view.**
Until native PGlite exists, choose one of:
- (i) a cached read-only dashboard: persist the last GraphQL summary responses and show "as of <time>".
  Cheap, and meets Deobald's "read-only offline" bar.
- (ii) a small TS "local fold" over the synthesized pings in expo-sqlite for today/this week only.
  Duplicates logic, so keep it approximate.
- (iii) TanStack DB 0.6 SQLite persistence (Expo supported) as a client cache.

Android's source data (UsageStatsManager) is itself a local, re-readable journal for about 7–10 days
*(pk)*, so the phone is already partly local-first for recent history.

**Option D — Generic sync engine.** Not recommended now (see the table below).

### 2c. Sync-engine landscape (status as of Sep 2026) and fit for append-mostly activity data

| Project | Status 2026 | Model | Fit for Eunomia |
| --- | --- | --- | --- |
| **ElectricSQL** | Active (repo updated Sep 2026). The company has pivoted its messaging to "agents on sync": **Durable Streams** protocol, StreamDB, Electric Agents. Postgres Sync ("shapes") plus **TanStack DB 0.6** (SQLite persistence on browser/Node/RN/Expo). Old bidirectional "ElectricSQL classic" is deprecated. | Read-path only: Postgres → client shapes over HTTP. Writes go through your own API. | It could stream `summaries`/`activities` shapes to an offline dashboard cache. It does nothing for upload (the outbox already covers that). It adds an Electric service that needs logical replication. Moderate value later, for a live-updating dashboard only. |
| **PowerSync** | Active. Service v1.23.3 (Jul 2026), SOC2/HIPAA Jan 2026. Self-host Docker image. Bucket storage in MongoDB or **Postgres**, with SQLite/MySQL storage being experimented with. License is source-available (FSL) for the service *(pk)*. | Bidirectional Postgres ↔ client SQLite. Client writes go to an upload queue → your backend. | The closest to "offline Android dashboard over real data". The cost is a second server container, a replication slot, sync rules per user, and duplicating the dashboard against local SQLite instead of GraphQL. Heavy for the benefit. |
| **Zero (Rocicorp)** | **1.0 released June 2026** (symbolic bump from 0.26). | Query-driven sync: client library plus zero-cache (a read replica of Postgres). A fast-UI cache, not a durable offline store for long offline writes *(pk)*. | Web-dashboard speed only. Wrong tool for agents or offline. |
| **Triplit** | **Acquired by Supabase (Oct 2025).** The founder moved to integrations work and the code is being open-sourced as reference. Effectively winding down as a product. | Full-stack syncing DB. | Avoid. |
| **Automerge / Yjs** | Automerge 3.0 (Jul 2025) cut memory 10×+. Yjs is still faster on large docs. Both active. | Document CRDTs for concurrent edits to rich state. | Wrong shape. Millions of immutable time-series rows gain nothing from CRDT merge. Might suit *config* (rules/categories edited on two offline devices), but LWW per row is sufficient there. |
| **cr-sqlite (vlcn)** | Repo still up (3.8k★). Last significant releases were 2023–24, and the author moved to Rocicorp/Zero *(pk)*. Effectively dormant. | CRDT tables in SQLite (~2.5× slower inserts). | Avoid. |
| **Jazz (garden.co)** | **Jazz 2.0 alpha with an entirely new API** ("local-first relational database" across frontend, backend and their storage cloud). Classic Jazz (CoValues) is legacy. | Relational local-first with built-in permissions and encryption *(pk for classic)*. | Too unstable (alpha, API churn) and cloud-centric. Avoid for now. |
| **LiveStore** | v0.4.0, **beta**, no 1.0 date. Cloudflare Durable Object and S2 sync backends. Effect-schema based. | **Event sourcing**: an eventlog synced git-style (pull then push), materialized into reactive SQLite. | *Conceptually* the best match: pings are events, activities and summaries are materializations. But it would replace the Postgres/GraphQL server model, pulls in Effect, is beta, and its sync backends aren't a self-hosted Node/Postgres story. Borrow the idea, not the library. |

### 2d. Recommendation: treat pings as an event log, sync by log shipping
- **Source of truth:** immutable pings, identified by `(deviceId, capturedAt)` plus an optional
  content hash. Store them on the agent (journal) *and* on the server (a new compressed `pings` table or
  per-day blobs, with its own retention).
- **Upload** is today's outbox, reframed as "ship journal from cursor". It is idempotent because of the
  ping id, not because of the "at or before last ping" rule.
- **Derived state** (activities, summaries) is recomputed on each side. It must be **deterministic from
  (pings, rules-version)**. Today the fold depends on arrival order, the TTL close, and rules at fold time
  (context rules are forward-only). Storing raw pings server-side lets you add a `rebuild(device, from, to)`
  that re-folds history. That also unblocks import, backfill, rule re-application for contexts, and
  range deletion (§5).
- **Config down-sync** (categories, rules, merge rules, ignore/redact lists) is small, rarely edited, and
  can use per-row `updatedAt` last-write-wins. It lets the standalone or offline agent apply the *same*
  rules and lets the server push privacy lists to agents.
- **Standalone → server upgrade:** create a device on the server, replay the journal. The late-ping
  problem disappears because server-side fold for a new device starts empty, or because of the rebuild path.

---

## 3. End-to-end encryption

### What competitors actually do
- **ActivityWatch 0.14:** opt-in **SQLCipher encryption at rest** in aw-server-rust (PR #584, merged
  **2026-05-23**), behind a Cargo feature. The passphrase comes from `--db-password` or `AW_DB_PASSWORD`
  (preferred; the env var is cleared after parsing, and the key is held in `Zeroizing<String>`). Empty
  passphrases panic, and a non-SQLCipher build panics if the env var is set, so it never silently falls
  back to plaintext. No documented migration of an existing plaintext DB. This is **local at-rest only,
  not E2E**. The motivation (issue #435) was sync-folder exposure, but aw-sync folders themselves aren't
  described as encrypted.
- **ManicTime Server/Cloud:** HTTPS in transit plus volume encryption at rest (Cloud on Azure). The
  server *can* read the data. The privacy answer is **selective disclosure** instead: the client chooses
  to send all activity, only tags, or tags plus basic usage. On-prem Linux has no native TLS (reverse
  proxy). Experimental GDPR retention since 2025.3.
- **Timing Sync:** "all sync data is encrypted", meaning transport and at rest on Timing's servers. The
  web app renders your data, so this is **not zero-knowledge E2E**.
- **Super Productivity SuperSync:** true E2E. Operation payloads are AES-encrypted client-side with a
  password-derived key, and the server is self-hostable (also in Unraid CA). **Cautionary advisory
  GHSA-9v8x-68pf-p5x7:** during E2EE setup, operations were uploaded and stored *in plaintext* before the
  password was set (deleted once setup completed). Lesson: encrypt-before-first-upload has to be a
  hard invariant.
- **Screenpipe:** "optional encrypted sync" on top of local-only storage.

### What E2E would cost Eunomia
Everything the server does interprets plaintext: the fold (keyed by app+context), context regex on
titles, category rules over app/title/context, merge rules (exact values), rollups, `categorySummary`,
`appSummary`, the rule live preview, the entries inventory and the MCP endpoint. Server-side ciphertext
breaks all of them.

| Tier | What's protected | What breaks | Effort |
| --- | --- | --- | --- |
| **T0: transport + at rest** | Disk theft, backup leaks | Nothing | Low. Document or offer built-in TLS (or `tailscale serve`), encrypted Postgres volume, encrypted backup exports. For standalone PGlite, OS-level (FileVault/BitLocker) is realistic. |
| **T1: field-level E2E for titles and context** (app + seconds stay plaintext) | The admin of a shared instance can't read titles, sites or projects | Server-side context and title rules must move to the agent, which already has ignore/redact and gets rules via config down-sync (§2d). Server rollups still work by app and category (the category is computed on the agent). Grouping by context needs **deterministic encryption** (e.g. AES-SIV or HMAC tokens), which leaks equality and frequency. The dashboard decrypts in the browser (WebCrypto, passphrase or device-enrolled key). MCP loses titles. | Medium–high |
| **T2: full E2E** (server = encrypted blob relay of ping batches) | Everything, including app names and timing, apart from sizes and times | All server features. Aggregation moves to agent/browser (requires Option B first). MCP server-side is gone. A lost passphrase means lost data. Multi-device key enrollment is needed (QR or passphrase). | High. Effectively a rewrite into LiveStore-style architecture. |

**Recommendation:** do T0 now. Treat the multi-user admin threat mostly with *selective disclosure*,
ManicTime-style: extend `redactApps` to a per-device "send level" of full / app + category only /
category totals only, and let users mark categories private. Revisit T1 only if shared (non-family)
instances become a target. The per-user threat model on a self-hosted box is "a friend who runs the
server", and redaction plus a published "what the admin can see" statement covers most of it at a
fraction of the cost.

---

## 4. Export, import and interoperability

### Formats competitors use
- **ActivityWatch:** `GET /api/0/export` (all buckets) and `GET /api/0/buckets/{id}/export`, plus
  `POST /api/0/import` with the same shape *(pk for import)*. There's also a web "Export all buckets as
  JSON" button and CSV from some views. The shape *(pk)* is
  `{"buckets": {"<id>": {id, created, name, type, client, hostname, data, events: [{id, timestamp, duration, data}]}}}`.
  Relevant bucket types:
  - `currentwindow`: `data.app`, `data.title`
  - `afkstatus`: `data.status` = `afk` / `not-afk`
  - `web.tab.current`: `data.url`, `data.title`, `data.audible`, `data.incognito`
  - editor buckets
  AW docs warn users to aggregate and redact locally before sharing exports with AI or third parties.
- **RescueTime:** premium CSV export from any report, and the **Analytic Data API** (`/anapi/data`, CSV
  or JSON, `restrict_begin`/`restrict_end`, `perspective=interval`, `resolution_time=minute` = 5-min
  buckets, columns Date / Time Spent (seconds) / Number of People / Activity / Category / Productivity
  *(pk for columns)*). Community full-history exporters exist: `ErikBjare/rescuetime-exporter` (by the AW
  author) and `karlicoss/rescuexport`.
- **WakaTime:** settings → "Export my code stats" → Heartbeats JSON, plus a data-dumps API
  (`type=heartbeats`). `wakadump` converts the files. Wakapi and Hakatime import via the API, and Ziit
  documents a WakaTime/Wakapi import.
- **Toggl / Clockify / Harvest:** detailed-report CSVs of *time entries* (project, task, description,
  start/end date+time, duration `HH:MM:SS`, tags, billable). Toggl CSV export is paid-only. Clockify
  imports Toggl. Solidtime imports Toggl (two-step: data importer then time entries), Clockify, Harvest
  and generic CSV.
- **Kimai:** CSV/XLSX/PDF/DOCX/HTML export, and CSV import with Toggl/Clockify presets via plugin.
- **Timing:** PDF/XLSX/CSV/HTML export. **Qbserve:** JSON/CSV with *scheduled automatic exports*.
  **Arbtt:** `arbtt-dump` text/JSON. **Dayflow:** Markdown.
- **Apple Screen Time / Android Digital Wellbeing:** no export (Timing uses an import workaround).
- **Prometheus:** Wakapi exposes a Prometheus metrics endpoint. AW has only third-party `aw-sync-suite`
  pushing to Prometheus/Grafana.

### Is there a common open interchange format?
**No.** There is no standard schema for time entries or activity events. The de facto options are:
- **AW bucket JSON:** open, documented, the only format for *automatic window activity* that multiple
  tools read (AW desktop and Android, aw-sync, aw-client, third-party analysis scripts).
- **Toggl-style CSV:** the de facto format for *manual time entries*.
- **iCalendar VEVENT:** for showing timeline blocks in calendars (Dayflow request #183).

Recommendation: **make Eunomia's raw export AW-bucket-compatible** (one `currentwindow` bucket per
device, plus a synthesized `afkstatus` bucket, with context as an extra `data.context` field). Also offer
a native lossless NDJSON and summary CSV. That positions Eunomia as "the multi-device server
ActivityWatch never had" with a round-trip exit.

### Proposed export/import surface
1. **Full account export (GDPR-style):** a ZIP containing
   - `manifest.json` (schema version, server version, TZ)
   - `user.json`
   - `devices.json` (no key hashes)
   - `categories.json`, `category_rules.json`, `context_rules.json`, `merge_rules.json`
   - `api_keys.json` (metadata only)
   - `activities.ndjson`, `summaries.ndjson`
   - `pings/<device>/<day>.ndjson.zst` (once pings are stored)

   Self-service from the dashboard, and also a CLI and GraphQL mutation that returns a download URL. The
   same bundle **imports** into another Eunomia server, which gives server-to-server migration: the
   longevity ideal, and a per-user backup.
2. **Summary CSV** (day, device, app, context, category, seconds) for spreadsheets. Optionally
   **scheduled exports** to a folder or WebDAV (Qbserve precedent).
3. **Importers, ranked by value:**
   1. **ActivityWatch bucket JSON: highest.** It's the same audience (automatic, privacy-minded, FOSS)
      and AW's #1 complaint is lack of multi-device sync. Mapping is natural: intersect window events with
      `not-afk` spans, then synthesize pings at the keep-alive cadence. `packages/agent/src/synth.ts`
      already does retroactive ping synthesis for Android, so feed the existing fold on a fresh
      "imported: <hostname>" device. Web bucket URLs reduce to hostname → context. This needs the
      late-ping handling from §2d. Import into a new device is fine today.
   2. **RescueTime API/CSV: high.** Refugees from the removed free plan and price complaints. 5-minute
      buckets map straight to `summaries` (or activities with synthetic spans). RescueTime categories map
      to Eunomia categories, and "Productivity" could seed a future productive/distracting weight.
   3. **Eunomia's own bundle:** required for migration and restore.
   4. **ManicTime / Timing CSV: medium**, niche.
   5. **WakaTime heartbeats: low–medium.** Maps to app = editor, context = project. Only if IDE tracking
      becomes a theme.
   6. **Toggl / Clockify / Harvest CSV: low** until Eunomia has manual time entries. These are entries,
      not activity.
4. **Prometheus `/metrics`** (API-key scoped): gauges for seconds today by category, app and device, plus
   device `lastSeenAt` age and outbox and upload health. Cheap, and homelab users wire Grafana and alerts
   to it. A Home Assistant REST sensor then comes for free.
5. **Backups/restore:** keep `pg_dump`, but ship a documented compose `backup` sidecar with a cron dump
   and retention, plus a restore runbook tested in CI against PGlite or Postgres. Standalone mode: the
   journal *is* the backup, and PGlite `dumpDataDir` gives snapshots *(pk)*.

---

## 5. Deletion, retention and editing

### How competitors do it
- **ManicTime:** drag a time selection on the timeline → right-click Delete (or the trash icon), choosing
  which timeline(s) to delete from. **Search → delete all matching activities in a range.** Also
  "Off the record" (pause 1–15 min, until tomorrow, or indefinitely), a tracking schedule (only record
  during set hours), app exclusions, and server GDPR retention (experimental).
- **ActivityWatch:** an API to delete events (by id; bulk deletion discussed in aw-server #55 and
  aw-server-rust #60). **Bulk bucket deletion in 0.14.** Editing in EventList is limited to the Bucket
  view. Otherwise users edit SQLite directly. Android had a "data retained after uninstall" issue (#1012).
- **Timing:** delete the data folders to start fresh, and account deletion via support. **Timely:**
  Memory timeline data deletable per the privacy promise. **Screenpipe / Dayflow:** storage caps and
  auto-cleanup. **Wakapi:** self-service "clear data" and delete account *(pk)*.

### Gaps in Eunomia and a proposed design
1. **Delete a range:** `deleteActivity(filter: {deviceId?, app?, context?, from, to})`.
   - Deletes matching activities.
   - For rolled days, it must **adjust `summaries`**. Summaries have day granularity only, so sub-day
     range deletion on already-rolled days can't be exact.
   - Fix options: keep raw activities (or pings) for the retention window and rebuild the affected days,
     or add an hour column to summaries.
   - UI: a timeline view (also missing, §4 of 01) with drag-select → delete, ManicTime-style.
2. **Purge an app or context everywhere:** delete from activities *and* summaries across all time, and
   offer "also add to ignore list" (pushed to agents via config down-sync). This is the most common
   privacy regret: "I don't want *that* site in my history."
3. **Off the record** on the agent: a tray/notification toggle (15 min / 1 h / until tomorrow) that drops
   pings before the outbox, plus a **tracking schedule**. Both are local-only and fully private.
4. **Outbox and journal purge** on the agent: delete unsent and local data for a range, or all of it
   (needed once the journal exists).
5. **Per-user retention:** a user setting for raw activity/ping retention days and optional *summary*
   retention (summaries are kept forever today). Effective value = min(server max, user setting). Show it
   in the dashboard.
6. **Account deletion:** a self-service mutation with re-auth and typed confirmation. It cascades devices,
   activities, summaries, rules, categories, API keys, sessions and pings, revokes device keys (agents
   then show "device removed"), and offers "export first" (§4). Admin variant: a CLI
   `eunomia user delete <email>`.
7. **Audit hint:** show "last edited/deleted" on affected days so charts that shrink aren't confusing.

---

## 6. Single-user and easy install paths

### Landscape
- **Zero-server desktop-only:** ActivityWatch (localhost server), ManicTime desktop, Timing (Mac),
  Qbserve, Tockler, Memtime, Arbtt, Screenpipe, Dayflow, solidtime desktop activity capture (local only).
  This is the default expectation for "privacy tracker": install, and it works with no account.
- **Homelab app stores:**
  - **Umbrel:** Kimai and Solidtime.
  - **YunoHost:** Kimai2 (needs 500 MB RAM to install).
  - **Unraid Community Apps:** SuperSync.
  - CasaOS and TrueNAS apps are Docker-compose-based catalogs where community templates are cheap *(pk)*.
  - No automatic *window-activity* server is in these stores as far as found, which is an open niche.
- **Single-binary / SQLite servers:** Wakapi (Go; SQLite/MySQL/Postgres), Traggo (Go + SQLite + GraphQL),
  ManicTime Server (SQLite for "personal server", Postgres/MSSQL for teams). The pattern is SQLite for one
  person, Postgres for many.
- **Tailscale-friendly:**
  - `tailscale serve` gives HTTPS with MagicDNS certs and injects **identity headers**
    (`Tailscale-User-Login`, `Tailscale-User-Name`, and `Tailscale-App-Capabilities` via grants). Open
    WebUI, Dashy and Grafana already use this for SSO.
  - Tailscale's own guidance: trust the headers only if the backend listens on localhost.
  - `tsnet` embeds a node in *Go* apps, so it isn't directly usable from Node. A tailscale sidecar
    container is the Node equivalent.
  - Tailscale Services (Feb 2026) give stable hostnames.

### Eunomia today
Two containers (app + Postgres 17), a mandatory `BETTER_AUTH_SECRET`, SMTP (or the unsafe LAN flag) for
magic links, and TLS delegated to a reverse proxy. Android production builds refuse cleartext, so real
use needs TLS. That's a lot of steps for one person who "just wants ActivityWatch across laptop and phone".

### Recommendations, in order
1. **Desktop standalone mode** (Option B): an install-and-go Electron agent with embedded PGlite server
   and a local dashboard, and no account. "Connect to server…" later replays the journal. This matches
   every desktop competitor's baseline and passes Kleppmann's test for the single-device case.
2. **All-in-one single-user container:**
   - `docker run -p 4000:4000 -v eunomia:/data ghcr.io/…/eunomia`.
   - Auto-generate and persist `BETTER_AUTH_SECRET` in `/data` if unset.
   - **First-run owner setup code printed to the logs** (no SMTP needed), and password or passkey login
     exposed in the dashboard (better-auth password auth already exists in the API).
   - DB backend choices, ordered by robustness:
     - (a) bundled Postgres in the same image (supervised)
     - (b) PGlite `dataDir` for very small instances, with the durability caveat
     - Keep the two-container compose for multi-user.
3. **Tailscale recipe:** a compose example with a tailscale sidecar plus `tailscale serve` (valid HTTPS
   certs, which fixes Android's cleartext refusal). Add an optional `TRUSTED_HEADER_AUTH=tailscale` mode
   that maps `Tailscale-User-Login` to the user when bound to loopback behind serve (Wakapi-style trusted
   header auth precedent). This removes both the SMTP and TLS hurdles for most homelab users.
4. **App-store templates:** once the single container exists, publish Umbrel, CasaOS and Unraid CA
   templates, then YunoHost and TrueNAS. Precedent: Kimai and Solidtime on Umbrel. Low effort, and a
   discovery channel in a niche no automatic tracker occupies.
5. Keep the docs framing explicit: **"Standalone (local-first) → add a server for multiple devices →
   invite family or users."**

---

## Prioritized recommendations (summary)

| # | Recommendation | Ideals served | Effort |
| --- | --- | --- | --- |
| 1 | Local append-only **ping journal** on agents. Outbox becomes a cursor, no drop-oldest data loss. | Offline, longevity, control | S |
| 2 | Store **raw pings server-side** (compressed, own retention) plus a deterministic `rebuild(device, range)` fold | Longevity; enables import, range delete, rule re-application | M |
| 3 | **Full account export/import bundle** plus summary CSV, and **ActivityWatch bucket import/export** | Longevity, control | M |
| 4 | **Deletion suite:** range delete, purge app/context everywhere, off-the-record, per-user retention, account deletion | Privacy, control | M |
| 5 | **Desktop standalone mode** (server on PGlite in Electron, local dashboard) plus "connect later" journal replay | Fast, offline, control (passes Kleppmann test) | M–L |
| 6 | **Single-container single-user image** (auto secret, setup code, password login) plus **Tailscale serve recipe and trusted-header auth**, then app-store templates | Control, adoption | S–M |
| 7 | **Selective disclosure** per device (full / app+category / totals) plus T0 encryption guidance. Defer field-level E2E. | Privacy | S (T0) / L (T1) |
| 8 | RescueTime importer, Prometheus `/metrics`, backup sidecar | Interop | S each |
| 9 | Android offline read cache (persisted last summaries). Revisit native PGlite or TanStack DB later. | Offline | S |
| — | **Don't adopt** a generic sync engine (Electric, PowerSync, Zero, Triplit, Jazz, cr-sqlite, Automerge) for activity data. Immutable pings + log shipping + LWW config is simpler and fits better. Watch LiveStore (event-sourced) and PGlite native ports. | — | — |

---

## Sources
- Ink & Switch, Local-first software: https://www.inkandswitch.com/essay/local-first/
- Kleppmann, Local-First Conf 2024 keynote: https://martin.kleppmann.com/2024/05/30/local-first-conference.html ; SE Radio 716 (2026): https://se-radio.net/2026/04/se-radio-716-martin-kleppmann-local-first-software/
- Deobald, "LocalFirst: You Keep Using That Word" (Jan 2026): https://www.deobald.ca/essays/2026-01-01-localfirst-you-keep-using-that-word/
- localfirst.fm and landscape: https://www.localfirst.fm/ , https://www.localfirst.fm/landscape/livestore
- Electric blog (Durable Streams, TanStack DB 0.6, PGlite v0.4): https://electric.ax/blog , https://electric.ax/blog/2026/03/25/tanstack-db-0.6-app-ready-with-persistence-and-includes , https://electric.ax/blog/2026/03/25/announcing-pglite-v04
- PGlite socket (alpha status, multiplexing): https://pglite.dev/docs/pglite-socket
- PowerSync changelog and service releases: https://powersync.com/blog/powersync-changelog-june-july-2026 , https://releases.powersync.com/announcements/powersync-service , https://releases.powersync.com/announcements/introducing-postgres-for-sync-bucket-storage
- Zero 1.0: https://zero.rocicorp.dev/docs/release-notes/1.0 , https://www.infoq.com/news/2026/06/zero-version-1/
- Triplit joins Supabase: https://supabase.com/blog/triplit-joins-supabase
- Automerge 3.0: https://automerge.org/blog/automerge-3/
- cr-sqlite: https://github.com/vlcn-io/cr-sqlite
- Jazz: https://github.com/garden-co/jazz
- LiveStore: https://docs.livestore.dev/changelog/ , https://docs.livestore.dev/evaluation/event-sourcing/
- ActivityWatch releases, SQLCipher PR, encryption issue, export docs, delete API issues: https://github.com/ActivityWatch/activitywatch/releases , https://github.com/ActivityWatch/aw-server-rust/pull/584 , https://github.com/ActivityWatch/aw-server-rust/issues/435 , https://docs.activitywatch.net/en/latest/features/exporting-data.html , https://github.com/ActivityWatch/aw-server-rust/issues/60 , https://github.com/ActivityWatch/aw-server/issues/55 , https://github.com/ActivityWatch/activitywatch/issues/1012
- ManicTime privacy controls and deleting data: https://www.manictime.com/features/privacy-control , https://docs.manictime.com/win-client/faq/deleting-data , https://docs.manictime.com/server/on-premise-installation/faq/what-is-manictime-server
- Timing FAQ and sync: https://timingapp.com/help/faq , https://timingapp.com/blog/introducing-timing-sync/
- Super Productivity SuperSync and advisory: https://github.com/super-productivity/super-productivity , https://github.com/super-productivity/super-productivity/security/advisories/GHSA-9v8x-68pf-p5x7 , https://ca.unraid.net/apps/supersync-1awhsqf0pha5mr
- solidtime desktop activity tracking: https://www.solidtime.io/blog/activity-tracking-and-idle-detection
- RescueTime API and exporters: https://www.rescuetime.com/rtx/developers , https://github.com/ErikBjare/rescuetime-exporter , https://github.com/karlicoss/rescuexport
- WakaTime dumps and Wakapi import: https://wakatime.com/developers , https://github.com/wakatime/wakadump , https://github.com/muety/wakapi/issues/323 , https://docs.ziit.app/data-import
- Toggl/Clockify/Solidtime import: https://support.toggl.com/en-us/article/toggl-track-csv-import-guide-yx49tl/ , https://clockify.me/help/getting-started/import-timesheets , https://docs.solidtime.io/user-guide/import
- App stores: https://apps.umbrel.com/app/kimai , https://apps.umbrel.com/app/solidtime , https://apps.yunohost.org/app/kimai2
- Tailscale serve identity headers and tsnet: https://tailscale.com/docs/features/tailscale-serve , https://tailscale.com/docs/features/tsnet , https://docs.openwebui.com/tutorials/auth-sso/tailscale/
