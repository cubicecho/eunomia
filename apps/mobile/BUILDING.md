# Building the Android agent

This app cannot run in Expo Go: it autolinks a local Kotlin module
(`modules/usage-events`, the UsageStatsManager bridge) plus `react-native-webview`,
so every run needs a native build. Test APKs come from **EAS Build**; a local
Gradle build is available as a fallback if you have the Android toolchain.

`android/` is not committed: the native project is generated from `app.json` by
`expo prebuild` (continuous native generation). The local module's own source
under `modules/usage-events/android/` **is** committed — it is the app, not
generated output.

## EAS builds

Nothing to install but the CLI, and no Android SDK anywhere.

```sh
npm i -g eas-cli
eas login
eas init                             # once — see below
npm run apk:eas -w @eunomia/mobile   # eas build -p android -e preview
```

`eas.json` has three profiles:

| profile       | output                     | for                                |
| ------------- | -------------------------- | ---------------------------------- |
| `development` | APK, dev client            | Metro-attached builds on a device  |
| `preview`     | APK, internal distribution | the test builds you hand to people |
| `production`  | AAB                        | Play Store uploads                 |

The build runs in the cloud and ends with a download link and a QR code for
installing straight onto a phone.

### Plain-HTTP servers

Android refuses cleartext HTTP on target SDK 28+, and Expo's template waives
that for **debug** builds only. So a Metro-attached app reaches
`http://server.lan:4000` happily while an APK of the same commit fails with
`CLEARTEXT communication to … not permitted by network security policy` — the
release manifest simply never had the allowance.

`plugins/with-cleartext-traffic.js` puts it back, but only when
`EUNOMIA_ALLOW_CLEARTEXT=1`. `eas.json` sets that on `development` and
`preview`, and `npm run apk` / `npm run android:release` set it locally.
`production` does not, so a production build won't talk to an `http://` server
at all — that is the point, not an oversight. Give a production build a server
behind TLS.

The switch has to be present for **prebuild**, which is when the plugin runs.

### One-time account setup

1. **`eas init`** — creates the project on Expo and writes `extra.eas.projectId`
   into `app.json`. That id is what every later build, and CI, is filed under,
   so commit it. Nothing else here touches the Expo account.

2. **A keystore.** EAS generates and stores one for you, but a
   `--non-interactive` build (which is all CI ever runs) can't answer the prompt
   that creates it. Do it once, up front:

   ```sh
   eas credentials:configure-build -p android -e preview
   ```

   Everything EAS signs from then on shares that key, which is the point:
   consecutive test builds install over each other instead of colliding as
   different apps. It lives on Expo's servers — `eas credentials` downloads a
   copy, and you want one somewhere safe.

3. **`EXPO_TOKEN` for CI** — a token from
   [expo.dev/settings/access-tokens](https://expo.dev/settings/access-tokens),
   stored as a repository secret named `EXPO_TOKEN` (Settings → Secrets and
   variables → Actions). A personal token carries your whole account; since this
   project lives under the `cubicecho` org, a **robot user** with a build role is
   the tighter choice — org settings on expo.dev creates one, and it can't log in
   anywhere, only hold a token.

### In CI

[`.github/workflows/android.yml`](../../.github/workflows/android.yml) starts an
EAS build on every push to `main` that touches the app (`apps/mobile`,
`packages/agent`, `packages/shared`, or the lockfile), and on demand from the
Actions tab — **Run workflow** takes a profile, so `production` is a click away
without editing anything.

The job triggers the build with `--no-wait` and exits: it doesn't hold a runner
in the EAS queue. The build page is linked from the run summary, and the APK
downloads from there once EAS finishes. Until `EXPO_TOKEN` exists the workflow
skips with a warning instead of failing — nothing is red just because the secret
hasn't been added yet.

Version numbers are EAS's job (`cli.appVersionSource` is `remote`, with
`autoIncrement` on `preview` and `production`), so `versionCode` climbs on its
own and no build needs a commit to bump it. The `versionCode` still in `app.json`
is ignored by EAS and used only by a local Gradle build.

To run a profile on your own machine instead — same recipe, no queue, but it
needs the toolchain below:

```sh
npm run apk:eas:local -w @eunomia/mobile
```

### Monorepo notes

EAS uploads the repo's tracked files from the root (npm workspaces), so
`@eunomia/agent` comes along as a workspace dependency and needs no publishing.
`expo/metro-config` handles workspace resolution on its own since SDK 52 — there
is no `metro.config.js` here on purpose.

## Local builds

### One-time setup

1. **JDK 17 or newer.** Gradle 8 / AGP 8 refuse anything older; if `java
   -version` says 1.8, point `JAVA_HOME` at a modern one:

   ```sh
   export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
   ```

2. **Android SDK.** Either install Android Studio, or just the command-line
   tools:

   ```sh
   export ANDROID_HOME="$HOME/Android/Sdk"
   mkdir -p "$ANDROID_HOME/cmdline-tools"
   # download commandlinetools-linux-*.zip from
   # https://developer.android.com/studio#command-line-tools-only
   unzip commandlinetools-linux-*.zip -d "$ANDROID_HOME/cmdline-tools"
   mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
   export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
   yes | sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   ```

   Gradle downloads whatever else the build asks for. Keep `JAVA_HOME`,
   `ANDROID_HOME`, and the `PATH` additions in your shell profile.

### A test APK

```sh
npm run apk -w @eunomia/mobile     # or: npm run dist:apk (repo root)
```

That prebuilds `android/` and runs `./gradlew assembleRelease`, leaving

```
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Sideload it with `adb install -r <path>`, or copy it to the phone.

This APK is signed with the **debug** keystore Expo's template configures for the
release variant. That installs and upgrades over itself fine, but it is a
different key from the one EAS uses — so a locally built APK and an EAS one
can't replace each other on a phone, and neither is a distribution key. Bump
`app.json`'s `android.versionCode` by hand for local builds meant to replace one
another; EAS handles its own.

Prefer `assembleRelease` over `assembleDebug` for anything you hand to a
tester: a debug APK expects a Metro server on the network and does nothing
useful without one.

### Iterating

```sh
npm run android -w @eunomia/mobile   # build + install a debug build, then Metro
npm start -w @eunomia/mobile         # Metro alone, against an installed debug build
```

Only re-run `prebuild` when something native changes (`app.json`, the local
module, a new native dependency). JS and TypeScript changes reload over Metro.

## Usage access

However it was built, the agent does nothing until Android's **Usage access**
special permission is granted: Settings → Apps → Special app access → Usage
access → eunomia. The status screen links straight to it. It is not a runtime
permission — the app cannot prompt for it.
