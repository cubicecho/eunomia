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

[`.github/workflows/android.yml`](../../.github/workflows/android.yml) ships the
app on every push to `main` that touches it (`apps/mobile`, `packages/agent`,
or the lockfile), and on demand from the Actions tab —
**Run workflow** takes a profile, so `production` is a click away without
editing anything.

Whether shipping means an update or a build is the fingerprint's call; see
"How CI chooses" above. A build is triggered with `--no-wait` and the job exits:
it doesn't hold a runner in the EAS queue, the build page is linked from the run
summary, and the APK downloads from there once EAS finishes. An update is
published outright, in seconds — so on the build path a green run means EAS
accepted the job, while on the update path it means the update is already live.
Until `EXPO_TOKEN` exists the workflow skips with a warning instead of failing —
nothing is red just because the secret hasn't been added yet.

Version numbers are EAS's job (`cli.appVersionSource` is `remote`, with
`autoIncrement` on `preview` and `production`), so `versionCode` climbs on its
own and no build needs a commit to bump it. The `versionCode` still in `app.json`
is ignored by EAS and used only by a local Gradle build.

### Where it shows up

Every ship lands on the repo's
[Releases](https://github.com/cubicecho/eunomia/releases) page, one release per
**binary** — a channel plus a native fingerprint. A build creates it, and every
update later published against that same fingerprint appends a line to it, which
is what a phone actually runs: one APK plus the newest update its runtime
accepts. So the list stays one row per native runtime rather than one per merge.

| you want to know               | look at                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| what production runs           | the newest release *without* a pre-release badge            |
| what the testers hold          | the newest release *with* one — `preview` is always flagged, so "Latest" stays on production |
| what shipped since that binary | the update list inside that release, newest first           |
| the APK, or a build's progress | the *open in EAS* link in the release's Binary section      |

The tag — `android-preview-9f3c1a2b4d5e` — is the channel and the first twelve
characters of the fingerprint. Ugly on purpose: it is the one name both lanes can
compute, since an update knows the fingerprint it was published against but not
the version number of the binary it will land on.

Nothing is attached to the release. EAS keeps the artifact, and the build step
returns before it exists — so the release links to the build page instead, which
is also where the QR code for installing onto a phone lives. A release whose
binary was built by hand rather than by CI says so in its Binary section.

The body is generated from a JSON block embedded in it (an HTML comment, so it
does not render), read back and re-rendered on every ship. Editing a release by
hand is therefore fine for prose that will be overwritten and pointless for
anything else; change
[`.github/scripts/android-release.mjs`](../../.github/scripts/android-release.mjs)
instead, and the next ship re-renders the whole history in the new shape.

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

## Over-the-air updates

Most commits here change TypeScript and nothing else, and a twenty-minute build
to ship a changed string is twenty minutes plus an APK everyone has to reinstall
by hand. EAS Update publishes the JavaScript bundle and its assets to a channel;
the installed app fetches it and runs it on its next launch. No build, no
reinstall.

What an update can carry, and what it can't:

| changed                                | ships as  |
| -------------------------------------- | --------- |
| anything under `src/`, `App.tsx`       | an update |
| `@eunomia/agent`                       | an update |
| assets the bundler resolves            | an update |
| `modules/usage-events` (the Kotlin)    | a build   |
| `plugins/*.js`, the native half of `app.json` | a build |
| the cleartext allowance, permissions   | a build   |
| the app icon, the package name         | a build   |
| the SDK, or any native dependency      | a build   |

Nobody has to remember that table. `runtimeVersion` is
`{ "policy": "fingerprint" }` — a hash over everything that determines the
binary: the SDK, the native dependency set, the config plugin *files*,
`modules/usage-events`. An update carries the fingerprint it was published
against and a build only accepts updates that match, so an update needing native
code the phone doesn't have is not something it can install.

The alternative, `appVersion`, would have tied compatibility to
`"version": "0.1.0"` — a string nobody in this repo maintains, since EAS owns
the version numbers. The failure it permits is the worst one this app has: a
native call landing on the wrong ABI, from a background task, on a phone that is
not in the room.

### Channels

A build carries the channel of the profile that made it, and an update is
published to a channel — so the profile table above is also the routing table:

| profile / channel | who is on it                            |
| ----------------- | --------------------------------------- |
| `development`     | dev builds (updates are off in them)    |
| `preview`         | the testers holding an APK              |
| `production`      | Play Store installs                     |

A locally built APK (`npm run apk`) is on no channel at all — EAS is what stamps
one into the manifest — so it never receives an update. Same separation as the
keystore: local builds are their own world.

Nothing needs creating up front. `eas build` creates the channel the first time
a profile with that name builds, and `eas update --channel preview` creates the
branch it points at. `eas channel:edit` is for later, when you want a channel
pointing at a branch of a different name — rolling `production` back onto an
older one, say.

### How CI chooses

[`.github/workflows/android.yml`](../../.github/workflows/android.yml)
fingerprints the commit, then asks EAS whether a finished build **on that
channel** already carries the same fingerprint. If one does, the APK people have
installed can run this commit's JavaScript, so the workflow publishes an update.
If none does, the native runtime changed and it starts a build. The run summary
says which happened, and links to it — as does the release it records the ship
into, per "Where it shows up" above.

It asks per channel rather than by hash alone because the fingerprint does not
see `EUNOMIA_ALLOW_CLEARTEXT`: that switch is applied by a prebuild mod, after
the config is evaluated, so a `preview` APK and a `production` AAB fingerprint
identically while shipping different manifests. Matching on the hash alone would
find the AAB and skip the APK the testers are actually on.

Forcing a build is a click: **Run workflow** → *Build a binary even if one
already matches the fingerprint*.

To publish by hand:

```sh
eas update --platform android --channel preview --environment preview --message "why"
```

`--environment` is required from SDK 55 on. It selects which EAS environment's
variables are visible while the app config is evaluated — and since nothing
under `src/` reads `process.env` (the server URL and the API key are typed into
the app and live on the phone), it is a formality here that only has to match
the profile.

To take an update back: `eas update:rollback`, or publish the previous commit
again.

### What a phone does with it

`updates.checkAutomatically` is `ON_LOAD` and `fallbackToCacheTimeout` is `0`:
every launch checks, downloads in the background, and runs the bundle it already
has in the meantime. Startup is never held up waiting on the network, which
matters most on the launches nobody sees.

Because the background sync starts the JavaScript runtime about once an hour
whether or not anyone opens the app, that is also how an update reaches a phone
nobody touches: one background launch downloads it, the next one runs it.

The status screen's **Running** row shows which bundle is live — the version in
the subtitle won't move, since an update doesn't change `versionCode` — and
offers a restart when one is waiting. Restarting only ever skips the wait, and
it is only ever offered in the foreground: a reload during a headless background
run would leave the WorkManager task's promise unsettled, and Android reads that
as a failed task and backs it off.

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
another; EAS handles its own. It is also on no update channel, so it stays
exactly the commit you built until you build again.

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
That is the same line that decides update-versus-build in CI, for the same
reason.

## Usage access

However it was built, the agent does nothing until Android's **Usage access**
special permission is granted: Settings → Apps → Special app access → Usage
access → eunomia. The status screen links straight to it. It is not a runtime
permission — the app cannot prompt for it.
