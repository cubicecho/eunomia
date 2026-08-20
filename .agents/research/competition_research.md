# Competition Research

Projects and products that do the same thing as Eunomia, or occupy adjacent space.
Compiled Aug 2026 (web research; stars/versions verified against GitHub/product pages at that date).

**Eunomia's niche for reference:** self-hosted + multi-user + fully automatic window
tracking + open architecture (desktop tray agent → stateless pings → GraphQL/Postgres
server, magic-link auth, device provisioning, regex auto-categorization, web dashboard).

---

## 1. Open-source automatic activity trackers (closest competitors)

### ActivityWatch
- https://github.com/ActivityWatch/activitywatch · https://activitywatch.net — MPL-2.0
- Windows, macOS, Linux, Android. ~18.6k★, but last stable release v0.13.2 (Oct 2023); commits continue slowly.
- Local-first client-server on one machine (watchers → local aw-server REST + web UI). **Single-user by design** — no auth/user model, bucket IDs collide across machines (issues #572, #249). `aw-sync` has been "WIP decentralized folder-sync" for years; no hosted cloud exists.
- Fully automatic window/title + AFK watchers; browser/editor watchers via ecosystem. Regex categorization rules in the web UI — same model as Eunomia.
- **vs Eunomia:** the category leader, and its multi-user/central-server gap is exactly Eunomia's pitch. AW watcher/protocol compatibility could be a growth lever.

### Tockler
- https://github.com/MayGo/tockler — GPL-2.0. Windows, macOS, Linux. ~1.1k★, maintained (Apr 2026).
- Electron desktop app, **local-only** (local DB, in-app timeline). Automatic active-window + idle tracking; minimal categorization (no rule engine).
- **vs Eunomia:** closest UX cousin to the Electron agent, but everything stays on one machine — no server, no multi-user.

### awatcher
- https://github.com/2e3s/awatcher — MPL-2.0. Linux only (X11 + Wayland: Sway, Hyprland, KDE, GNOME, COSMIC). 302★, active (Jul 2026).
- Rust replacement for ActivityWatch's window+idle watchers; bundled build embeds aw-server-rust. Single-user/local.
- **vs Eunomia:** not a server competitor, but useful *client* inspiration for Wayland coverage.

### arbtt
- https://github.com/nomeata/arbtt — GPL-2.0, Haskell. Linux/X11, macOS, Windows. 355★, dormant (last push Apr 2024).
- Local-only daemon sampling all windows per minute; rule DSL applied at query time; CLI stats, no UI/server.

### screenpipe
- https://github.com/mediar-ai/screenpipe — source-available "Screenpipe Commercial License" (free personal, paid commercial; app $25–150/mo). ~21.1k★, very active. YC S26.
- Local-first 24/7 screen OCR + audio transcription + input logging ("AI memory") — far heavier than window metadata. Single-user, no multi-user server.
- **vs Eunomia:** different category (total-recall + AI); validates demand but doesn't touch self-hosted multi-user metadata tracking.

### Dayflow
- https://github.com/JerryZLiu/Dayflow — MIT, macOS-only native Swift. ~6.9k★, created Sep 2025, hot.
- Screenshots every 10s → local LLM (Ollama/LM Studio) summarizes into a narrative timeline. Single-user, local-only, no rules.

### aw-sync-suite
- https://github.com/phrp720/aw-sync-suite — MIT. 39★, active but tiny.
- Go agent pulls each machine's local aw-server → central **Prometheus** → **Grafana** — the only found "multi-machine ActivityWatch" bridge.
- **vs Eunomia:** proof AW users want central multi-machine dashboards; a bolt-on requiring AW+Prometheus+Grafana vs Eunomia's integrated server/auth/dashboard.

### Dead/abandoned
- **selfspy** — https://github.com/selfspy/selfspy — GPL-3.0, ~2.5k★, dead since Mar 2019 (Python 2.7). Local window titles + keystroke logging.
- **ulogme** — https://github.com/karpathy/ulogme — MIT, ~1.2k★, dead since Sep 2020. Local shell scripts + d3 UI.

---

## 2. Self-hosted server-based time trackers (multi-user, mostly manual timers)

### solidtime ⚠ most likely future encroacher
- https://github.com/solidtime-io/solidtime · https://www.solidtime.io — AGPL-3.0 + paid cloud. Laravel+Vue, **PostgreSQL**, Docker; desktop app for macOS/Win/Linux. ~8.9k★, fastest-growing, v0.19.1 (Aug 2026).
- Multi-user orgs + RBAC. Mostly manual timers, but the desktop app added idle detection + **local-only background window-activity tracking (May 2026)** — activity data stays on-device and is never sent to the server.
- **vs Eunomia:** strongest modern OSS competitor, inching toward automatic tracking — but deliberately keeps window activity local/private/per-user. Eunomia's server-side multi-user automatic record remains distinct.

### Wakapi
- https://github.com/muety/wakapi — MIT. Go binary/Docker, SQLite/MySQL/Postgres. ~4.4k★, active (2.17.6, Aug 2026).
- Self-hosted **multi-user** WakaTime backend: automatic heartbeats, but **coding-only** (editor plugins). Auto-categorization by project/language/editor + label rules.
- **vs Eunomia:** same "passive heartbeats → self-hosted multi-user server + dashboard" shape — strongest evidence the shape is wanted. Eunomia generalizes it from editors to the whole desktop.

### Traggo
- https://github.com/traggo/server — GPL-3.0. Single Go binary, **GraphQL (gqlgen)** + SQLite. ~1.6k★, slow-moving (v0.8.3, Mar 2026).
- Self-hosted, multi-user, tag-based **manual** time spans; customizable dashboards.
- **vs Eunomia:** closest architecturally (lightweight self-hosted GraphQL multi-user server) but purely manual.

### Kimai
- https://github.com/kimai/kimai · https://www.kimai.org — AGPL-3.0 + paid cloud/plugins. PHP/Symfony, MySQL. ~4.9k★, very active (v2.65.0, Aug 2026).
- The mature business-timesheet incumbent: multi-user, teams, roles, invoicing. **Manual only** — no automatic capture, no desktop agent.

### Cattr
- https://github.com/cattr-app/server-application · https://cattr.app — **SSPL-1.0** (not OSI). Laravel+Vue server + **Electron desktop clients**. Semi-dormant (~98★ mirror, v4.0.0-RC54, Jan 2026).
- Self-hosted + multi-user, but tracking is timer-initiated **surveillance-style** (screenshots + keyboard/mouse activity levels), not passive window logging.
- **vs Eunomia:** same self-hosted multi-user client-server shape, different ethos and license.

### Ever Gauzy
- https://github.com/ever-co/ever-gauzy — AGPL-3.0 CE + paid. NestJS+Angular, Postgres/MySQL, multi-tenant. ~4.3k★, very active but sprawling.
- A whole ERP/CRM/HRM platform; the desktop agent is Hubstaff-style (screenshots, activity %) and requires a running timer.

### TimeTagger
- https://github.com/almarklein/timetagger — GPL-3.0 + hosted €3/mo. Python, SQLite. ~1.8k★, maintained (v26.1.3, Feb 2026).
- Manual interactive-timeline tracking, #tags. Single-user by default; multi-user only via credential list/reverse proxy.

### Others
- **Titra** — https://github.com/titraio/titra — AGPL-3.0, Meteor/MongoDB. ~500★, active. Manual duration-first hours logging for small teams.
- **Ziit** — https://github.com/0pandadev/ziit — AGPL-3.0, Nuxt/TS self-hosted WakaTime alternative. 249★ (v1.1.3, Jul 2026). Coding-only.
- **DRYTRIX TimeTracker** — https://github.com/DRYTRIX/TimeTracker — GPL-3.0, Flask+Postgres. 614★ (v5.11.5, Aug 2026). "Kimai-lite", manual timers + invoicing.

---

## 3. Commercial / proprietary automatic trackers

### ManicTime + ManicTime Server ⭐ the direct proprietary incumbent
- https://www.manictime.com — per-seat **one-time** ~$87/user Pro (incl. 1yr upgrades); Pro packs include **ManicTime Server free**; or cloud ~$9–15/user/mo.
- Windows (flagship), macOS, Linux, Android, iOS. Actively developed.
- Local-first client + optional **self-hosted server for teams** — fully on-prem, air-gap capable, scales to thousands of users. Fully automatic app/window/document timeline + away detection; user-defined auto-tagging rules.
- **vs Eunomia:** the only shipping product with self-hosted + multi-user + fully automatic tracking. Proprietary, per-seat paid, Windows-centric. Eunomia = the open-source version of this.

### RescueTime
- https://www.rescuetime.com — Lite free; Premium $12/mo; Teams $6/user/mo. Win/mac/Linux/mobile/browser.
- Cloud SaaS only. Fully automatic app/site tracking, idle detection, large built-in category/productivity-score DB.
- **vs Eunomia:** closest UX analog, but cloud-only and closed source.

### Others (automatic or hybrid)
- **Timing** — https://timingapp.com — macOS only, ~$108–192/yr. Fully automatic; user rules + AI tier; team via cloud sync only.
- **Qbserve** — https://qotoqot.com/qbserve/ — macOS, $40 one-time, 100% local, single-user. Built-in DB of 8,100+ apps/sites. Maintenance-mode.
- **WakaTime** — https://wakatime.com — cloud SaaS, $9–49/user/mo. Automatic but dev-tools-only; Wakapi is the OSS clone.
- **Rize** — https://rize.io — macOS/Win, AI-credit metering ($12.99–49.99/mo). Automatic + AI categorization + focus coaching. Cloud, no self-host.
- **Toggl Track** — https://toggl.com/track — free ≤5 users; ~$10–20/user/mo. Manual-first; desktop Autotracker records a **private personal** background timeline (10-min resolution) to convert into entries. Explicitly anti-surveillance.
- **Memtime** — https://www.memtime.com — Win/mac/Linux, €10–30/user/mo. Fully automatic local-first timeline; raw data stays on-device, only entries sync to PM/ERP tools. No shared raw-data server.
- **Timely** — https://memory.ai/timely — cloud SaaS, $9–28/user/mo. Automatic per-user private "Memory" + AI-drafted timesheets. Nearest philosophical cousin for "automatic + team", but pure SaaS.
- **Clockify** — https://clockify.me — free ≤5 users; ~$4–14/user/mo. Manual-first; Auto Tracker is auxiliary. Cloud only.
- **Timemator** — https://timemator.com — macOS, $39 one-time, local-only, single-user. Rule-triggered auto timers + background timeline.
- **Cronus** — https://cronushq.com — macOS, $6/mo (Show HN Jul 2025). Automatic, local OCR + LLM classification. Single-user.
- **Chronoid** — https://www.chronoid.app — macOS, one-time purchase, local-only, freelancer-focused automatic capture. New (2025–26).

Trend note (2024–26): LLM-based categorization (Rize, Cronus, Timing Expert, Timely) and explicit anti-surveillance positioning — raw timelines kept private to the user (Toggl, Timely, Memtime).

---

## 4. Employee-monitoring products (different ethos — brief)

| Product | URL | Price/user/mo | Self-host? | Notes |
|---|---|---|---|---|
| ActivTrak | activtrak.com | free ≤3; ~$10–19 | No | Auto tracking + productivity scoring; "privacy-first" rhetoric but manager-facing, cloud-only |
| Hubstaff | hubstaff.com | ~$5–12 | No | Timer + auto app/URL, activity %, screenshots, GPS |
| Time Doctor | timedoctor.com | ~$6.67–20 | No | Screenshots/recordings, distraction alerts; BPO focus |
| Insightful | insightful.io | ~$8–16 | On-prem, ~250-seat minimum | Screenshots, stealth agent option |
| Teramind | teramind.co | ~$14–32 | **Yes, full on-prem** | Screen video, keylogging, DLP, stealth — maximal surveillance |
| DeskTime | desktime.com | free Lite; ~$7–20 | No | Mechanically closest to Eunomia's engine (fully automatic from boot), but manager-first |
| Monitask | monitask.com | ~$5–9 | No | Budget surveillance, stealth mode |

Key difference in ethos: these products collect data *about* employees *for* the employer;
Eunomia's dashboard serves the tracked user, on the org's own server. Self-hosting in this
segment is rare and gated (Teramind full on-prem; Insightful enterprise-only; Cattr the sole
OSS-ish option and it's surveillance-shaped).

---

## Closest-overlap ranking

1. **ManicTime + ManicTime Server** — only shipping self-hosted + multi-user + fully automatic product. Proprietary, Windows-centric.
2. **ActivityWatch** — same tracking model and regex categorization, huge mindshare, but single-user/local-first with perpetually-WIP sync. Eunomia = "ActivityWatch with a real multi-user server."
3. **Cattr** — same architecture (self-hosted server + Electron agents), but timer-initiated screenshots, SSPL, semi-dormant.
4. **Wakapi** — same passive-heartbeats-to-self-hosted-multi-user-server shape, but coding-only.
5. **solidtime** — self-hosted, multi-user, Postgres, very active, now doing (local-only) window tracking. Most likely future encroacher.
6. **Tockler** — matching Electron automatic-tracking UX, local-only single-user.
7. **DeskTime / RescueTime Teams / Timely** — matching automatic + multi-user model, cloud SaaS, closed.
8. **Traggo / Kimai / TimeTagger** — matching self-hosted multi-user server, fully manual.

**Bottom line:** as of Aug 2026, no project combines all four of Eunomia's pillars —
self-hosted, multi-user, fully automatic passive window tracking, open source. The space
splits into single-user local automatic trackers, multi-user self-hosted servers that are
manual or coding-only, one proprietary self-hosted incumbent (ManicTime), and cloud
surveillance tools. The niche is open.
