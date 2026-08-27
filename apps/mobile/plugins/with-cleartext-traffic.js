// Android denies cleartext HTTP on targetSdk 28+, which is the right default for
// a phone that leaves the LAN. But a self-hosted eunomia server speaks plain
// HTTP by design (see "Before you expose it" in the README), so test builds opt
// back in and production does not — with the attribute absent, the platform
// refuses http:// outright, which is the "force TLS" half of this.
//
// The switch is EUNOMIA_ALLOW_CLEARTEXT, set per build profile in eas.json and
// by the local release scripts in package.json. Debug builds need nothing:
// Expo's own template already grants them cleartext.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (modConfig) => {
    if (process.env.EUNOMIA_ALLOW_CLEARTEXT !== '1') return modConfig;

    // Throwing beats a silent no-op: a template change that moved <application>
    // would otherwise ship an APK that simply can't reach the server.
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });
