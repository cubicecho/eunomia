# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# One app, three targets

This workspace is the agent. Its UI — setup, status, privacy, log — is one Expo
app rendered on all three; what runs *behind* it is the shell.

| target   | shell                                     | how the UI is delivered                      |
| -------- | ----------------------------------------- | -------------------------------------------- |
| Android  | the app itself (`src/host/android.ts`)    | React Native                                  |
| desktop  | Electron main process (`electron/`)       | `expo export --platform web` → `dist-web`, served over `app://` |
| browser  | none (`src/host/unsupported.ts`)          | the same export, opened directly              |

`src/host/` is the seam: one `AgentHost` interface, one implementation per
shell, and `createHost()` picks at runtime. **The UI branches on
`host.capabilities`, never on `Platform.OS`** — a screen that asks "is this
Android" is asking the wrong question, because the answer it wants is "does
this shell have a usage-access prompt / a background task / a login item".

## Traps

- **Metro's platform extensions do not apply here.** Every import in this repo
  carries an explicit `.ts`, and an explicit extension is a file path, not a
  request Metro will look for `.android.ts` variants of. Platform selection is
  therefore a runtime branch, and the native module binding is lazy (a Proxy in
  `modules/usage-events/index.ts`).
- **Bundling is not executing — but module scope is.** Android-only modules are
  bundled for web too, which is fine as long as nothing *runs* on import.
  `expo-file-system` throws the moment it is touched off-device, so a `new
  File(...)` at module scope takes the whole desktop window down with it; build
  those inside the function. Same for `TaskManager.defineTask` and
  `AppRegistry.registerHeadlessTask`, both guarded by `Platform.OS`.
- **`react-native-webview` has no web build at all**, so `DashboardScreen` is a
  `React.lazy` import: bundled as its own chunk, never evaluated off Android.
- CI catches all of this by running `npm run export:web` — `tsc` cannot.
- **`npm test` here runs only what a plain Node can run**: `src/host/electron.ts`
  and `unsupported.ts` (both React Native-free) and `electron/ipc.ts` under a
  mocked `electron`. `src/host/index.ts` imports `react-native`, so it is not
  covered; `vitest.config.ts` limits the glob to `src/` and `electron/` so the
  runner never walks `android/` or `dist-web/`.
- **`electron/tsconfig.json` sets `module: preserve`.** Under NodeNext it would
  decide module format per file, and since only `electron/` has
  `"type": "module"` it would call `src/` CommonJS and reject the value export
  in `src/host/bridge.ts` that both `ipc.ts` and the preload import. esbuild
  does the emit; tsc here only checks.
- **Never give electron-builder a `linux.files` / `win.files` of its own.** A
  platform `files` array is folded into its *default* matcher, and a matcher
  holding only exclusions gets `**/*` prepended — so one `!` line quietly
  packages the whole workspace, `android/` and `release/` included. The one
  thing that needed it, picking the right x-win prebuild, is a positive in the
  top-level `files` instead: `${os}` expands to `linux`/`win`. Check a change
  here by listing the asar (`npx asar list release/*-unpacked/resources/app.asar`)
  — it should be `dist`, `dist-web`, `package.json` and one x-win.

## The two Electron renderers are not alike

`electron/window.ts` shows **local** content (our own export, over `app://`),
so its preload is a real bridge. `src/host/bridge.ts` is the only place the
method list is written: `agent-preload.cjs` imports `BRIDGE_METHODS` and
forwards each one (which is why `build:preload` bundles — a preload runs before
any module loader the app has), and `registerAgentIpc` throws at startup if a
name has no handler. `electron/ipc.ts` answers every channel only for that
window's own frame.

`electron/dashboard.ts` shows **remote** content, so it stays fully sandboxed
(`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) and gets
one short-lived session token and nothing else. The long-lived device API key
must never enter that renderer.

## Where things live

- `src/` — the shared UI and the Android shell.
- `electron/` — the desktop shell. Its own `package.json` (`"type": "module"`)
  is what makes `electron ./electron` work and what sets `app.getAppPath()`, so
  every dev-vs-packaged path is one `app.isPackaged` branch.
- `modules/usage-events/` — the local Kotlin module. Committed; `android/` at
  the app root is not (continuous native generation).
- Building, EAS, and OTA updates: [BUILDING.md](BUILDING.md).
