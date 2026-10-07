# Loop 2 — Capture gaps (research, 2026-09-12)

Scope: how competitors fill the seven capture gaps in `01-eunomia-features.md` §1/§10, and
what each would take in Eunomia's stack (Electron tray agent + `@miniben90/x-win` +
`powerMonitor` 1 s sampler → stateless pings `{capturedAt, app, title, context, idleSeconds}`
→ server fold with 30 s accrual cap and 120 s idle cutoff). Effort: **S** ≈ days, **M** ≈ 1–3
weeks, **L** ≈ a month or more / ongoing maintenance.

Verification tags: facts with a link were checked against that source on 2026-09-12;
**(unverified)** marks inference or single weak source.

---

## Ranked summary

| Rank | Gap | User value | Effort | Verdict |
|---|---|---|---|---|
| 1 | **Media / call "not AFK"** (video, meetings) | High — every user loses call/video time today | **S–M** | Do first. Agent-only change for the main win. |
| 2 | **Browser extension** (URL/title, incl. Linux, incognito) | High — fixes Linux sites, adds page titles, audible flag feeds #1 | **M** | Extension → local agent (loopback), not → server. |
| 3 | **Windows signing + desktop auto-update** | High for adoption (SmartScreen, stale agents) | **S–M** | electron-updater now; SignPath after adding a LICENSE. |
| 4 | **Linux Wayland focus** | Medium-high (Ubuntu/Fedora default to GNOME Wayland) | **M** (GNOME+KDE+wlroots) / **L** full matrix | GNOME via x-win extension + KWin script + wlr/cosmic protocol. AppImage caveat. |
| 5 | **WakaTime-compatible heartbeat endpoint** | Medium (developers; 90+ plugins for free) | **M** | Wakapi-style compat route; needs its own accrual model. |
| 6 | **Calendar import** (ICS first) | Medium; low without a timeline view | **M** (ICS/CalDAV) / **L** (Google/MS OAuth) | ICS URL + CalDAV; skip Google OAuth for self-hosters. |
| 7 | **macOS packaging** | Medium (code exists, no build) | **M** + $99/yr | Needs Apple Developer Program; TCC/permission UX is the real work. |
| 8 | **iOS** | Low-realistic | iOS app: impossible; Mac-side Biome import: **M**, fragile | Only via a Mac reading synced Screen Time (Timing's trick). |

---

## 1. Linux Wayland focused-window capture + Linux browser URL

### How the ecosystem solves it

Core Wayland intentionally gives clients no "which window is focused" query. Every tool uses a
per-compositor backend:

| Desktop | Mechanism | Used by |
|---|---|---|
| X11 / XWayland | EWMH `_NET_ACTIVE_WINDOW`, XScreenSaver idle | everyone (x-win today) |
| Sway, Hyprland, river, labwc… (wlroots) | `wlr-foreign-toplevel-management-unstable-v1` — handles carry an `activated` state | awatcher, aw-watcher-window-wayland |
| COSMIC | cosmic toplevel protocol | awatcher |
| KDE Plasma (KWin) | **No foreign-toplevel protocol exposed.** Load a KWin script over D-Bus (`org.kde.kwin.Scripting`) that hooks `workspace.windowActivated` + `captionChanged` and `callDBus`es back into the watcher's own D-Bus service. KDE bug 502647 (implement wlr protocol) still open. | awatcher (`kwin_window.js`) |
| GNOME (Mutter) | **No protocol.** A GNOME Shell extension exposes focus over D-Bus: *Focused Window D-Bus* (`org.gnome.shell.extensions.FocusedWindow.Get` → JSON `{title, wm_class}`), *Window Calls*, or x-win's own `x-win@miniben90.org`. Mutter 49 merged only `xdg-toplevel-tag`, not `ext-foreign-toplevel-list`. | awatcher, x-win, ActivityWatch workaround |
| Idle | `ext-idle-notify-v1` (wlroots, KWin, COSMIC), `org.gnome.Mutter.IdleMonitor` (GNOME), KWin legacy idle | awatcher |

Note `ext-foreign-toplevel-list-v1` only *lists* toplevels (no activated/focus state), so even
where it ships it doesn't solve focus by itself.

ActivityWatch's own `aw-watcher-window-wayland` only covers wlroots; the working community path
on GNOME 49 (Ubuntu 25.10) is `aw-awatcher` + the Focused Window D-Bus extension, with a manual
systemd/autostart setup (AW issue #1218). awatcher's status: X11/Sway/Hyprland/COSMIC full;
KDE and GNOME "partial" active window, full idle.

### Feasibility for Eunomia

- **GNOME:** x-win already ships `installExtension()` / `enableExtension()` /
  `isInstalledExtension()` / `isEnabledExtension()`. Wiring these into the Setup/Status UI is
  **S**. Pitfalls: the user must **log out and back in** on Wayland before the extension loads;
  GNOME extensions declare supported `shell-version`s and break on major GNOME bumps (every
  6 months) — lib.rs lists x-win's GNOME support as "≤ 45" at one point, so GNOME 46–50
  compatibility **needs a real test** before relying on it (unverified). Fallback: detect and
  use *Focused Window D-Bus* (on extensions.gnome.org, maintained, reviewed 2025) over D-Bus.
- **KDE:** port awatcher's ~40-line KWin script. Agent registers a session-bus name, loads the
  script via `org.kde.kwin.Scripting.loadScript`, receives `NotifyActiveWindow(caption,
  resourceClass, resourceName)`. From Node, needs a D-Bus lib (`dbus-next`, pure JS). **M**.
- **wlroots/COSMIC:** needs a native Wayland client (Rust `wayland-client` via napi-rs, or a tiny
  sidecar). **M**. Or ship/detect `awatcher` as a sidecar (see trick below).
- **Idle on Wayland is a separate bug:** Electron `powerMonitor.getSystemIdleTime()` has
  long-standing reports of returning 0 on Wayland (electron#34826) or treating keyboard-only use
  as idle (electron#27912, closed not planned). Current Eunomia idle logic is therefore
  **unreliable on Wayland even for XWayland windows**. Fix with `org.gnome.Mutter.IdleMonitor.GetIdletime`
  (GNOME, D-Bus, S) and `ext-idle-notify-v1` (others, native). Lock/suspend:
  `org.freedesktop.login1` `Lock`/`PrepareForSleep` signals — Electron's `lock-screen` event is
  macOS/Windows only.
- **Packaging pitfall:** awatcher states "neither Flatpak nor AppImage support querying Wayland
  activity". For Flatpak that's the sandbox; for AppImage it's likely their bundling
  (AppImages aren't sandboxed, D-Bus to the session bus should work) — **verify before assuming
  AppImage is blocked** (unverified). A `.deb`/`.rpm` target is cheap insurance.
- **Sidecar trick (S–M, high leverage):** awatcher (MPL-2.0) and aw-watcher-web both speak the
  ActivityWatch REST API (`GET /api/0/info`, `POST /api/0/buckets/{id}`,
  `POST /api/0/buckets/{id}/heartbeat?pulsetime=`) to a configurable `--host/--port`
  (default 5600). If the Eunomia agent exposes a minimal AW-compatible listener on loopback, it
  gets the **entire Wayland matrix and browser URLs** without writing compositor code. Pitfalls:
  port clash with a real ActivityWatch install (use another port; awatcher takes `--port`,
  aw-watcher-web Firefox build hardcodes host permissions for `127.0.0.1:5600` and `:5666`),
  extra binary to ship/update, and AW's heartbeat-merge semantics must be mapped onto pings.

### Linux browser URL

x-win documents no URL retrieval on Linux. Options: (a) browser extension (§2 — the only robust
answer); (b) window-title heuristics (most browsers put page title, not URL, in the title; site
often derivable via existing context rules); (c) AT-SPI accessibility tree — Chromium needs
`--force-renderer-accessibility`, Firefox exposes the URL bar but it's slow and brittle
(unverified in practice). Recommendation: extension.

**Effort:** GNOME via x-win **S**; GNOME + KDE + Wayland idle **M**; full wlroots/COSMIC native
**L**; AW-compatible sidecar listener **S–M**.

---

## 2. Browser extension (URL / tab / title)

### Competitors

- **aw-watcher-web** (ActivityWatch, ~20k weekly users; rewritten in Vite+TS with MV3 for Chrome
  in 2025). Source inspected: Chrome = MV3 service worker + `offscreen` document to keep the
  worker alive; Firefox = MV2 persistent background page; Safari = MV3 built via
  `safari-web-extension-converter` (needs Xcode + Apple signing). Permissions `tabs`, `alarms`,
  `activeTab`, `storage`, `notifications`; Chrome `host_permissions: <all_urls>`. Sends
  `{url, title, audible, incognito, tabCount}` to aw-server on `tabs.onActivated`,
  `tabs.onUpdated`, and a 1-minute `alarms` tick, pulsetime 80 s. Firefox build shows a
  data-collection consent page (Mozilla policy) — pre-acceptable via enterprise policy
  `consentOfflineDataCollection`. Configurable base URL and API key in settings. AW's UI
  treats an **audible focused tab as not-AFK**.
- **WakaTime browser extension**: sends domains/URLs as "file" entities to the WakaTime API;
  works against Wakapi via `…/api/compat/wakatime/v1` — i.e. **direct to server**.
- **Timing / Qbserve / ManicTime** (macOS): no extension; read URL via AppleScript /
  Accessibility, automatically **discard private/incognito tabs**.
- Eunomia today: x-win URL on Windows (many browsers) and macOS (Chromium + Safari via
  AppleScript; **Firefox unsupported on macOS**), hostname only, nothing on Linux.

### Architecture options

| | Extension → **local agent** (loopback HTTP/WebSocket) | Extension → **local agent** (native messaging) | Extension → **server** directly |
|---|---|---|---|
| Joins with focused-window data | Yes — agent sets `context=hostname` only when the focused app is that browser | Yes | No — becomes a second "device" and **double counts** browser time under the fold model |
| Setup | Pairing token copied/auto-discovered | Agent writes host manifest into each browser's NativeMessagingHosts dir | API key paste |
| Flatpak/Snap browsers | Loopback works | **Broken** — confined browsers can't spawn hosts (portal still in design) | Works |
| Chrome Local Network Access (Chrome 142+ prompt for public→loopback) | Extension origin should not be "public"; aw-watcher-web works in 2026 → likely fine (unverified) | n/a | n/a |
| Works when agent offline | Buffer in `chrome.storage` | Host is spawned on demand, but is a separate process from the tray agent | Yes |

**Recommendation:** extension talks to the running tray agent on `127.0.0.1:<port>` with a
per-install token; agent treats extension data as enrichment of the current sample (replace
`browserContext()`), keeps the privacy sanitizer and hostname-only reduction on the agent side.
This also gives Linux site capture and Firefox-on-macOS. Optionally allow "direct to server"
mode later for machines without the agent (Chromebooks) — would need a server-side
"enrichment-only" device kind to avoid double counting.

### MV3 / store constraints & pitfalls

- Chrome MV3 service workers die after ~30 s idle; use `alarms` (min 30 s period in Chrome
  120+) and event listeners registered at top level; don't hold state in globals. aw-watcher-web
  needed an offscreen document hack to stay alive — avoidable if heartbeats are event-driven
  and the agent does the timing.
- `chrome.idle.onStateChanged` provides active/idle/locked — useful on Wayland where Electron
  idle is unreliable (Chromium implements its own idle on Linux; quality on Wayland unverified).
- Detect browser focus: `windows.onFocusChanged` → `WINDOW_ID_NONE` when browser loses focus.
- **Incognito:** extensions are off in incognito by default in Chrome and Firefox; if the user
  enables them, `tab.incognito` is available — drop URL/title (Timing's behaviour) and send only
  "browser, private". Use `"incognito": "spanning"` (default) so one worker sees both.
- Store review: `tabs` + `<all_urls>` triggers "read and change all your data" warning and
  in-depth review on Chrome Web Store; narrower is `tabs` only (gives url/title without host
  permissions) plus host permission for `http://127.0.0.1/*`. Firefox AMO requires the
  data-collection consent (Firefox now has `data_collection_permissions` in manifest). Safari:
  a Safari Web Extension must be wrapped in a signed macOS app; outside the App Store, users
  must enable "Allow Unsigned Extensions" each launch unless App Store distributed — so ship
  Safari only once macOS packaging (§5) exists, ideally embedded in the Eunomia.app bundle.
- Edge/Brave/Vivaldi/Opera install from Chrome Web Store; Zen/LibreWolf from AMO.

**Effort: M** (extension ~1 week for Chrome+Firefox, agent loopback endpoint + pairing UI,
store listings). Safari **+M** after macOS signing.

---

## 3. Meeting / video / media-playing detection ("not AFK")

### Competitors

- **ManicTime:** "Treat sound as active" — away is only triggered when no sound is playing;
  configurable idle threshold.
- **ActivityWatch:** audible focused browser tab (from aw-watcher-web) counts as not-AFK in the
  web UI queries; community watchers for media players; long-standing complaint that video is
  marked AFK (aw-watcher-afk #46, activitywatch #261).
- **Timing:** automatic call detection for Zoom, Teams, Slack, Google Meet; posts a notification
  when the call ends to log it; suggests calendar events as titles.
- **Time Doctor:** microphone-active detection to avoid timing out on calls.
- **Rize:** detects Google Meet calls and cross-references Zoom activity with calendar events.
- **Tockler:** plain idle threshold; nothing media-aware (checked README; no evidence otherwise).

### OS signals (ranked by reliability/effort)

| Signal | Windows | macOS | Linux |
|---|---|---|---|
| **Mic / camera in use** (calls) | Registry `HKCU\…\CapabilityAccessManager\ConsentStore\{microphone,webcam}\…` — `LastUsedTimeStop == 0` ⇒ in use now, **per app**, no admin | CoreAudio `kAudioDevicePropertyDeviceIsRunningSomewhere` (mic; Bluetooth mics reported unreliable), CoreMediaIO `kCMIODevicePropertyDeviceIsRunningSomewhere` (camera). Native addon. | PipeWire: `pw-dump` / `pactl list source-outputs` shows capture streams + app; `/dev/video*` holders |
| **Something inhibiting display sleep** (video players, browsers during playback, Zoom) | `powercfg /requests` needs admin; `CallNtPowerInformation(SystemExecutionState)` possibly aggregate flags (unverified) | IOKit `IOPMCopyAssertionsByProcess` / `pmset -g assertions` — `PreventUserIdleDisplaySleep` by process, no permission. Parse CLI = **S** | `org.gnome.SessionManager.IsInhibited(8)` / `GetInhibitors`; `org.freedesktop.ScreenSaver` / portal inhibit; logind `BlockInhibited` contains `idle` |
| **Media playing** | WinRT `GlobalSystemMediaTransportControlsSessionManager` (per-app PlaybackStatus, covers browsers/Spotify) — needs a WinRT bridge; or WASAPI session peak meters (true "sound playing") | Now Playing via private MediaRemote **blocked since macOS 15.4 without entitlement**; workaround `mediaremote-adapter` (runs via system Perl). CoreAudio output `DeviceIsRunningSomewhere` = "audio playing" cheaply | **MPRIS** over D-Bus: `org.mpris.MediaPlayer2.*` `PlaybackStatus == Playing` (Chrome, Firefox, Spotify, mpv, VLC) — pure JS via `dbus-next`, **S** |
| Browser tab audible | from extension (§2) | same | same |

### Feasibility for Eunomia

The fold only sees `idleSeconds`. Minimal version: agent computes `passiveActive` and reports
`idleSeconds = 0` (or clamps below 120) while a qualifying signal is on **and the foreground app
is plausible** (the app holding the mic/camera/inhibitor/audible tab, or any app during a call).
Better version: add optional ping fields `media: 'call' | 'video' | 'audio' | null` so the server
can (a) keep accruing, (b) let rules categorize "Meeting" time, (c) later show passive vs active
time. Schema change is small (PingInput + fold), codegen contract regenerates.

Pitfalls:
- **Background music** must not count as presence — only *video/call* signals (camera/mic,
  display-sleep inhibitor, fullscreen/audible focused tab), not "audio playing somewhere".
- Apps holding the mic open when idle (Discord/voice-activated, Teams in some states, OBS)
  → cap "call" extension (e.g. max 2–3 h unbroken) and require screen unlocked.
- Screen lock must override everything (Windows/macOS `lock-screen` events; logind on Linux).
- Calls on a phone while laptop sits there aren't detectable (calendar §7 partly covers).
- Privacy: record the *fact* of a call, never audio.

**Effort:** Windows mic/cam registry + macOS `pmset` assertions + Linux MPRIS/inhibitors as
agent-side heuristics clamping idle: **S**. New ping field + server semantics + "meeting"
detection UX: **M**. Native WASAPI/GSMTC/CoreAudio addon: **M**.

---

## 4. iOS feasibility (2026)

- **On-device iOS app: still impossible for server-synced tracking.** The
  `DeviceActivityReportExtension` sandbox blocks every output channel — App Group UserDefaults,
  shared files, HTTP, notifications, pasteboard, iCloud KVS — and Apple DTS confirmed on the dev
  forums (2026 threads) that this is intentional. Apps are opaque tokens; names resolve only
  inside the extension's SwiftUI view. `DeviceActivityMonitor` gives threshold callbacks only,
  and is reported unreliable (false positives on iOS 26.2/26.3). WWDC 2026 / iOS 27 added
  parental-control UX (Ask to Browse, Time Allowances), **no new data-export API** found.
  FamilyControls distribution entitlement still requires Apple review. Threshold-event hacks
  (e.g. schedule 1-minute-granularity events per app to infer usage) are unreliable and
  entitlement-gated — not worth it.
- **Timing's approach (the only working one):** read Screen Time data **synced to a Mac**.
  Requirements: Screen Time on + "Share Across Devices" on Mac and iPhone, same iCloud account,
  Full Disk Access for the reader. Data: per-app usage with timestamps per device, Safari
  domains; no URLs; ~2 weeks retention; counts background refresh as usage; can't deduct idle;
  Timing labels it **experimental, "may stop working in future iOS or macOS updates"**.
- **Where the data lives:** since macOS 13 / iOS 16, `knowledgeC.db` (`ZOBJECT`,
  `/app/usage`) is supplemented/replaced by **Biome** SEGB protobuf streams;
  synced iPhone data is under `~/Library/Biome/streams/restricted/App.InFocus/remote/`.
  Open-source parsers: `ActivityWatch/aw-import-screentime` (continuous import into AW buckets),
  `nichtlegacy/screentime` (→ Home Assistant/InfluxDB), and a Feb 2026 write-up confirming it
  works on Ventura/Sonoma with iPhone entries keyed by device UUID.

**Realistic Eunomia path:** a macOS agent feature "Import iPhone/iPad Screen Time" that tails the
Biome `App.InFocus/remote` stream, maps each remote device UUID to its own Eunomia device
(provisioned by the Mac agent), and feeds intervals through the existing Android-style
retroactive ping synthesizer (`packages/agent/src/synth.ts`). Depends on §5 (macOS build) and a
Full Disk Access prompt. **Effort M, fragility high** (undocumented format, Apple can change it
any release). Keep it opt-in and labelled experimental, as Timing does. iOS without a Mac:
document as impossible.

---

## 5. Desktop packaging: macOS signing/permissions, Windows signing, auto-update

### macOS

- **Required:** Apple Developer Program ($99/yr; no free OSS tier found) → Developer ID
  Application certificate, hardened runtime, notarization. electron-builder handles it; in CI use
  an App Store Connect **API key** (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`;
  with Xcode 26+ an individual key works if issuer is omitted). Build universal or per-arch
  (x-win has darwin prebuilds). Needs a macOS runner in `.github/workflows/desktop.yml`.
- **Unsigned is not viable:** Gatekeeper's control-click bypass was removed in Sequoia; users
  must go to System Settings → Privacy & Security → Open Anyway. Worse, **TCC grants are tied to
  the code signature** — ad-hoc-signed builds lose Screen Recording/Automation grants on every
  update (inference from TCC's designated-requirement model; high confidence).
- **Permissions for Eunomia's data:**
  - Window titles: x-win uses CGWindowList → titles empty without **Screen Recording**
    ("Screen & System Audio Recording" in Tahoe). Sequoia added a **recurring (monthly since 15.1)
    re-confirmation prompt** for screen-capture apps; reports say it covers legacy CGWindow APIs
    too — whether *window-name reading alone* triggers it is unclear (verify on Tahoe). Non-bundled
    binaries don't appear in the pane on 26.1 — must be a real `.app`.
  - Alternative for titles: Accessibility API (`AXUIElement` focused window `kAXTitle`) needs
    **Accessibility** permission, no monthly nag, and is what many trackers use; would require a
    small native helper or a different library (`get-windows` ships a signed Swift helper that
    handles both permission states).
  - Browser URLs via AppleScript: **Automation (Apple Events)** permission per browser; needs
    `com.apple.security.automation.apple-events` entitlement + `NSAppleEventsUsageDescription`.
  - Screen Time import (§4): Full Disk Access.
  - Onboarding UX: a permission checklist screen with `systemPreferences.getMediaAccessStatus`
    / deep links (`x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`).
- **Effort M** (CI + certs + entitlements + permission onboarding + testing on real hardware).

### Windows code signing (2026)

| Option | Cost | Eligibility | Notes |
|---|---|---|---|
| **SignPath Foundation** (OSS) | Free | OSI license, no proprietary components, actively maintained, already released; builds signed from CI with origin verification; must publish a code-signing policy | Publisher shown as **"SignPath Foundation"**; review days–weeks. Used by Electron OSS (e.g. Super Productivity). **Blocker: the eunomia repo has no LICENSE file** — pick an OSI license first. |
| **Azure Artifact Signing** (formerly Trusted Signing) | $9.99/mo (5k signatures) | **Individuals: US/Canada only**; organizations in US/CA/EU/UK/AU/NZ/JP/KR/SG/CH/NO/IL | Electron docs call it the cheapest option; electron-builder has native `azureSignOptions`. Short-lived certs, no HSM to buy. |
| OV/EV cert from a CA | ~$200–500+/yr + HSM/cloud key | Anyone | Since March 2026 max validity 460 days. **EV no longer grants instant SmartScreen reputation** — both OV and EV build reputation over downloads. |
| Unsigned (today) | 0 | — | "Unknown publisher" + SmartScreen "Windows protected your PC" for every release. |

Pitfall: SmartScreen reputation attaches to the certificate/publisher; with short-lived Azure
certs reputation carries via the identity, with SignPath it's the shared Foundation cert.

### Auto-update (Electron)

- `electron-updater` + GitHub Releases provider: NSIS (with blockmap differential downloads)
  and AppImage supported; macOS requires the **signed+notarized `zip`** target (Squirrel.Mac).
  Current config has `"publish": null` and the desktop workflow uploads artifacts itself —
  switching to `electron-builder --publish always` (or uploading `latest.yml` /
  `latest-linux.yml` / `*.blockmap` alongside) is the main change. Repo is public, so no token
  in the client.
- Pitfalls: unsigned Windows updates work but can't verify publisher (`verifyUpdateCodeSignature`);
  AppImage updates only work when the AppImage is in a user-writable path and `APPIMAGE` env is
  set; native module (`x-win`) ABI must match the bundled Electron (already pinned);
  per-user NSIS installs update without UAC (good fit). Stated "non-goal" in 01 — worth
  revisiting because agent/server protocol drift is otherwise unmanaged. Android already has OTA.
- **Effort:** auto-update **S**; SignPath onboarding **S** (after license); macOS **M**.

---

## 6. Editor/IDE & terminal capture

### WakaTime heartbeat compatibility (Wakapi/Hakatime/Hackatime approach)

- Plugins call `wakatime-cli`, which reads `~/.wakatime.cfg` `api_url` + `api_key`. CLI hits
  `POST {api_url}/users/current/heartbeats.bulk` (≤25 per request) and
  `GET {api_url}/users/current/statusbar/today` (status bar text). Wakapi also accepts
  `/heartbeat`, `/heartbeats`, `/users/{user}/heartbeats[.bulk]`, `/v1/…`, and
  `/compat/wakatime/v1/…`; returns 201 with a per-heartbeat `responses` array. WakaTime returns 202.
- Auth: `Authorization: Basic base64(api_key)`, `Bearer`, or `?api_key=`. Machine from
  `X-Machine-Name`; editor/OS parsed from `User-Agent` (e.g. `wakatime/v1.x (linux-…) go1.x
  vscode/1.9x vscode-wakatime/…`).
- Heartbeat fields: `entity` (file path / domain / app), `type` (file|app|url|domain), `category`
  (coding, debugging, building, meeting…), `time` (float epoch), `project`, `branch`, `language`,
  `dependencies`, `lines`, `lineno`, `cursorpos`, `is_write`, plus newer AI fields
  (`ai_line_changes`, `human_line_changes`, tokens).
- Browser-wakatime points at `…/api/compat/wakatime/v1` — so a compat endpoint also accepts that
  extension (but see §2's double-counting problem).

**Mapping to Eunomia:**
- Add route (outside GraphQL, like `/healthz`) `/api/compat/wakatime/v1/users/current/heartbeats[.bulk]`
  + `statusbar/today`; authenticate with an integration API key or a device key.
- Heartbeats arrive every ~2 min while typing (and are replayed from wakatime-cli's offline
  queue), so the **30 s accrual cap would under-count** them. Needs either a separate accrual
  rule for `source = wakatime` (Wakapi-style "join heartbeats < N min apart", N default 2–15)
  or treating heartbeats as **context enrichment**: attach `project`/`branch`/`language` to the
  desktop agent's already-accruing editor activity on the same machine at that time (match by
  `X-Machine-Name` → device and editor ↔ app). Enrichment avoids double counting and fits the
  "multi-open per (app, context)" fold; standalone source is simpler but duplicates time with the
  desktop agent. Recommend enrichment when a desktop device matches, standalone otherwise.
- Privacy: honour client-side `hide_file_names` etc. automatically (they arrive pre-hashed);
  server should drop `entity` paths by default and keep project/branch/language.
- Nice free wins: "import from WakaTime/Wakapi" later, and Wakapi's heartbeat relay pattern.
- **Effort M.**

### Git repo/branch without plugins

- **From titles (exists today via context rules):** VS Code `● file — folder — Visual Studio Code`,
  JetBrains `project – file`, Zed/Neovim configurable titles. Shipping **default context rules**
  for common editors is **S** and covers "project" for most users.
- **From cwd (terminals):** X11/Windows/macOS give the focused window's PID; walk to the child
  shell and read cwd (`/proc/<pid>/cwd` on Linux; `proc_pidinfo` on macOS; Windows needs PEB
  reading — hard), then `git rev-parse --show-toplevel` / read `.git/HEAD`. Breaks for tmux/ssh/
  multiplexed terminals. **M**, Linux-first.
- **Shell hook (most reliable for terminals):** tiny `precmd`/`preexec` snippet for bash/zsh/fish
  that POSTs `{cwd, repo, branch, command-name}` to the agent's loopback endpoint (same one as
  §2); how `bash-wakatime` / aw-watcher-terminal / aw-watcher-tmux work. Agent sets context for
  the focused terminal app. **S** once the loopback endpoint exists. Strip command arguments
  (secrets).

---

## 7. Calendar import as a meeting source

### Competitors

MT and TI show calendar events on the timeline and let users convert them; RZ, TL, RT, TG, CR,
CA import Google/Outlook; Rize re-categorizes Zoom blocks with the overlapping event name and
keyword-maps events to projects; Timing suggests event titles after detected calls. Super
Productivity has basic CalDAV; CalDAV is *requested* for Kimai/Traggo/Dayflow.

### Source options

| Source | Mechanism | Pros | Pitfalls |
|---|---|---|---|
| **ICS subscription URL** (Google "secret address in iCal format", Outlook/M365 "Publish calendar", iCloud public, Fastmail, Proton) | Server polls every 15–30 min; `node-ical` parses and `expandRecurringEvent()` handles RRULE/EXDATE/RECURRENCE-ID/DST | No OAuth; works on every provider; self-host friendly | URL is a bearer secret (encrypt at rest, never show again); M365 admins can disable publishing; Google Workspace admins can hide secret address; Outlook-published feeds refresh ~20 min |
| **CalDAV** | `tsdav` (fetchCalendars / fetchCalendarObjects / calendarQuery, time-range filter) | Incremental sync (ctag/sync-token); iCloud, Fastmail, Nextcloud, Radicale | App-specific passwords (iCloud, Fastmail); credential storage |
| **Google Calendar API** | OAuth `calendar.readonly` (sensitive scope) | Real-time-ish, attendees/response status, conference links | Every self-hoster needs their own GCP OAuth client; unverified "Testing" apps are capped at 100 users and **refresh tokens expire after 7 days**; verification takes weeks with a demo video — poor fit for self-hosted |
| **Microsoft Graph** | OAuth `Calendars.Read` | Same | App registration per instance; tenant admin consent often required in orgs (unverified detail) |

### How it should fold in

- Store events per user (`calendar_sources`, `calendar_events` with `uid`, recurrence-instance
  start, `busy/free`, `declined` flag where available). Ignore all-day, free, and declined events.
- Semantics options: (1) **overlay only** — shown alongside activity, "meeting hours" stat;
  (2) **fill idle gaps** — during a busy event, idle/absent desktop time becomes a synthetic
  "Meeting: <title>" activity (offline meetings, phone calls); never double counts because
  it only fills time no device accrued; (3) **re-context** — overlapping call-app activity (Zoom,
  Teams, Meet hostname) gets `context = event title` (Rize's behaviour). (2)+(3) are the valuable
  ones and fit the rules engine (rules already match app/title/context).
- Privacy: event titles are sensitive; add per-source "titles hidden → 'Busy'" option.
- **Value caveat:** the dashboard has no intraday timeline (01 §4); calendar data is much less
  useful until one exists. Pair with the timeline work.
- **Effort:** ICS + gap-fill + re-context **M**; CalDAV **+S**; Google/MS OAuth **L** (mostly
  operator friction, not code).

---

## Cross-cutting recommendation

Build a **local loopback agent endpoint** once (token-authenticated, `127.0.0.1`): it is the
shared foundation for the browser extension (§2), shell hooks (§6), an ActivityWatch-compatible
listener for awatcher/aw-watcher-web (§1), and media signals from the extension (§3). Order:
media/call idle clamp → auto-update + LICENSE/SignPath → loopback endpoint + browser extension →
Wayland (GNOME/KDE + D-Bus idle) → WakaTime compat → timeline + ICS calendar → macOS build →
experimental Screen Time import.

---

## Sources

Wayland / Linux
- [awatcher README & source](https://github.com/2e3s/awatcher/) (backends, KWin script, Flatpak/AppImage note)
- [ActivityWatch #1218 — GNOME 49 Wayland workaround](https://github.com/ActivityWatch/activitywatch/issues/1218)
- [aw-watcher-window-wayland](https://github.com/ActivityWatch/aw-watcher-window-wayland)
- [KDE Discuss: implement protocol in KWin for ActivityWatch](https://discuss.kde.org/t/feature-request-implement-wayland-protocol-in-kwin-to-support-activitywatch/30499), [KDE bug 502647](https://www.mail-archive.com/kde-bugs-dist@kde.org/msg1044374.html)
- [Focused Window D-Bus extension](https://github.com/flexagoon/focused-window-dbus), [extensions.gnome.org](https://extensions.gnome.org/extension/5592/focused-window-d-bus/)
- [x-win README](https://github.com/miniben-90/x-win), [x-win on lib.rs](https://lib.rs/crates/x-win)
- [Mutter merges toplevel tag for GNOME 49 (Phoronix)](https://www.phoronix.com/news/Mutter-Merges-Toplevel-Tag)
- [ext-foreign-toplevel-list](https://wayland.app/protocols/ext-foreign-toplevel-list-v1), [wlr-foreign-toplevel-management](https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1), [ext-idle-notify](https://wayland.app/protocols/ext-idle-notify-v1)
- [electron#34826 idle returns 0](https://github.com/electron/electron/issues/34826), [electron#27912 keyboard-only idle on Wayland](https://github.com/electron/electron/issues/27912), [Electron powerMonitor docs](https://www.electronjs.org/docs/latest/api/power-monitor)

Browser extensions
- [aw-watcher-web repo](https://github.com/ActivityWatch/aw-watcher-web/tree/master) (source inspected), [MV3 release note (Erik Bjäreholt)](https://x.com/ErikBjare/status/1894497474372329738), [incognito issue #35](https://github.com/ActivityWatch/aw-watcher-web/issues/35)
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [chrome.idle API](https://developer.chrome.com/docs/extensions/reference/api/idle)
- [Firefox MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/)
- [Native messaging in Flatpak (xdg-desktop-portal #655)](https://github.com/flatpak/xdg-desktop-portal/issues/655), [Firefox native messaging portal design](https://firefox-source-docs.mozilla.org/toolkit/components/extensions/webextensions/native-messaging-portal-design.html)
- [Distributing Safari web extensions](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension), [forum: notarized Safari extension](https://developer.apple.com/forums/thread/667859)

Media / meetings
- [ManicTime idle & away](https://www.manictime.com/features/idle-and-away-time-tracking), [ManicTime away-time blog](https://blog.manictime.com/articles/may-2025/away-time/)
- [AW forum: YouTube not AFK](https://forum.activitywatch.net/t/watching-youtube-video-or-any-streaming-media-content-in-the-active-browser-window-means-not-being-afk/367/2), [aw-watcher-afk #46](https://github.com/ActivityWatch/aw-watcher-afk/issues/46), [aw-webui PR #262 audible-as-active](https://github.com/ActivityWatch/aw-webui/pull/262)
- [Timing features](https://timingapp.com/features), [Timing Zoom tracking](https://timingapp.com/zoom-time-tracking), [Time Doctor calls](https://support.timedoctor.com/knowledge/how-to-not-time-out-on-calls)
- [Windows ConsentStore mic/webcam registry](https://davidarno.org/using-the-registry-to-monitor-webcam-and-microphone-use/)
- [Apple forums: detect mic in use](https://developer.apple.com/forums/thread/741026), [CMIO IsRunningSomewhere](https://developer.apple.com/forums/thread/697124)
- [mediaremote-adapter (macOS 15.4+ Now Playing)](https://github.com/ungive/mediaremote-adapter)
- [Tockler](https://github.com/MayGo/tockler), [Rize Google Calendar](https://rize.io/integrations/google-calendar)

iOS
- [Apple forums: DeviceActivityReportExtension sandbox blocks all output](https://developer.apple.com/forums/thread/818297), [Is Screen Time trapped on purpose?](https://developer.apple.com/forums/thread/817516), [DeviceActivityMonitor false positives 26.2/26.3](https://developer.apple.com/forums/thread/812472)
- [iOS 27 parental controls (MacRumors)](https://www.macrumors.com/2026/06/08/ios-27-parental-controls/)
- [Timing Screen Time integration help](https://timingapp.com/help/screen-time)
- [aw-import-screentime](https://github.com/ActivityWatch/aw-import-screentime), [nichtlegacy/screentime](https://github.com/nichtlegacy/screentime), [Boaz Sobrado 2026 write-up](https://boazsobrado.com/blog/2026/02/03/how-i-built-a-personal-screen-time-tracker-for-mac-and-iphone-using-claude/), [0xdevalias Screen Time notes](https://gist.github.com/0xdevalias/38cfc92278f85ae89a46f0c156208fd5)

Packaging
- [electron-builder notarization](https://www.electron.build/docs/features/code-signing/notarization/), [@electron/notarize](https://github.com/electron/notarize)
- [Sequoia monthly screen recording prompt (9to5Mac)](https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/), [Michael Tsai on persistent content capture](https://mjtsai.com/blog/2024/08/08/sequoia-screen-recording-prompts-and-the-persistent-content-capture-entitlement/), [Tahoe non-bundled binaries not in pane](https://developer.apple.com/forums/thread/807323)
- [SignPath Foundation terms](https://signpath.org/terms.html), [SignPath OSS](https://signpath.io/solutions/open-source-community), [Super Productivity code signing policy](https://super-productivity.com/code-signing/)
- [Azure Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/), [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq), [devclass GA article](https://www.devclass.com/security/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/4079554)
- [EV certs no longer grant instant reputation (ToDesktop)](https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore), [MS SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), [460-day code signing validity](https://www.appviewx.com/blogs/460-day-code-signing-certificate-2026/)
- [Electron code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing), [electron-builder auto update](https://www.electron.build/docs/features/auto-update/)

Editor / WakaTime
- [WakaTime API docs](https://wakatime.com/developers), [Wakapi](https://github.com/muety/wakapi), [Wakapi heartbeat routes](https://github.com/muety/wakapi/blob/master/routes/api/heartbeat.go), [Hackatime endpoints](https://hackatime.hackclub.com/docs/api/endpoints), [wakatime-cli tests](https://github.com/wakatime/wakatime-cli/blob/develop/main_test.go), [Wakapi setup (browser extension URL)](https://wakapi.dev/setup)

Calendar
- [node-ical](https://github.com/jens-maus/node-ical), [tsdav](https://github.com/natelindev/tsdav)
- [Google sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [7-day refresh token in Testing](https://dev.to/just_a_side_project/my-oauth-tokens-kept-expiring-every-7-days-and-the-reason-was-a-dropdown-labeled-testing-47ni)
- [Google Calendar secret iCal address](https://support.google.com/calendar/answer/37648?hl=en), [Outlook publish calendar](https://support.microsoft.com/en-us/office/share-an-outlook-calendar-as-view-only-with-others-353ed2c1-3ec5-449d-8c73-6931a0adab88), [M365 publishing disabled by admin](https://learn.microsoft.com/en-us/answers/questions/4612932/cannot-publish-calendar)
