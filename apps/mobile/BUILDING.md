# Building the Android agent

This app cannot run in Expo Go: it autolinks a local Kotlin module
(`modules/usage-events`, the UsageStatsManager bridge) plus `react-native-webview`,
so every run needs a native build. Two ways to get one — locally with the
Android toolchain, or on EAS with nothing installed but `eas-cli`.

`android/` is not committed: the native project is generated from `app.json` by
`expo prebuild` (continuous native generation). The local module's own source
under `modules/usage-events/android/` **is** committed — it is the app, not
generated output.

## Local builds

### One-time setup

1. **JDK 17 or newer.** Gradle 8 / AGP 8 refuse anything older; this machine
   defaults to Java 8, so point `JAVA_HOME` at a modern one:

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

The release build is signed with the keystore Expo's template generates, which
is enough to install and to upgrade an earlier build of the same APK — it is
**not** a distribution key. Generate a real keystore before publishing
anywhere, and keep it out of the repo.

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

## EAS builds

Nothing to install beyond the CLI, and no Android SDK on this machine.

```sh
npm i -g eas-cli
eas login
eas init            # once: creates the project and writes extra.eas.projectId
npm run apk:eas -w @eunomia/mobile
```

`eas.json` has three profiles:

| profile       | output                    | for                                            |
| ------------- | ------------------------- | ---------------------------------------------- |
| `development` | APK, dev client           | Metro-attached builds on a device              |
| `preview`     | APK, internal distribution | the test builds you hand to people             |
| `production`  | AAB                       | Play Store uploads                             |

`eas init` is the only step that touches the Expo account — it adds
`extra.eas.projectId` to `app.json`, which is what the build is filed under.
The build itself runs in the cloud and ends with a download link (and a QR
code for installing straight onto a phone).

To run the same profile on your own machine instead — same recipe, no queue,
but it needs the local toolchain above:

```sh
npm run apk:eas:local -w @eunomia/mobile
```

### Monorepo notes

EAS uploads from the repo root (npm workspaces), so `@eunomia/agent` comes
along as a workspace dependency and needs no publishing. `expo/metro-config`
handles workspace resolution on its own since SDK 52 — there is no
`metro.config.js` here on purpose.

`app.json`'s `android.versionCode` is bumped by hand (`cli.appVersionSource` is
`local`), so a new test build that should replace an older one on the same
phone needs that number incremented.

## Usage access

However it was built, the agent does nothing until Android's **Usage access**
special permission is granted: Settings → Apps → Special app access → Usage
access → eunomia. The status screen links straight to it. It is not a runtime
permission — the app cannot prompt for it.
