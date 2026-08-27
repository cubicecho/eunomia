// Android 11 (API 30) made other packages invisible by default: PackageManager
// answers NameNotFoundException for anything the app hasn't declared an
// interest in, even packages the usage log just named. Without this, every
// getApplicationLabel lookup fails and the dashboard fills up with
// `com.google.android.youtube` instead of "YouTube".
//
// Declaring the launcher intent — rather than the QUERY_ALL_PACKAGES
// permission — scopes visibility to apps that have a launcher icon, which is
// exactly the set a usage tracker reports on, and avoids a permission the Play
// Store treats as sensitive.
const { withAndroidManifest } = require('expo/config-plugins');

const LAUNCHER_INTENT = {
  action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
  category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
};

const isLauncherIntent = (intent) =>
  intent?.action?.some((a) => a.$?.['android:name'] === 'android.intent.action.MAIN') &&
  intent?.category?.some((c) => c.$?.['android:name'] === 'android.intent.category.LAUNCHER');

module.exports = (config) =>
  withAndroidManifest(config, (modConfig) => {
    const { manifest } = modConfig.modResults;

    // Expo's template already declares a <queries> block (browsable https), and
    // a manifest may only carry one — so add the intent to whatever is there
    // rather than appending a second block. Idempotent: prebuild without
    // --clean re-runs mods over a manifest that may already have it.
    manifest.queries ??= [{}];
    const queries = manifest.queries[0];
    queries.intent ??= [];
    if (!queries.intent.some(isLauncherIntent)) queries.intent.push(LAUNCHER_INTENT);

    return modConfig;
  });
