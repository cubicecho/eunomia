import { type StoredConfig, sessionFromDeviceKey } from '@eunomia/agent';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ui } from './ui.tsx';

// The dashboard on the phone: the server-hosted web app, signed in with a
// session minted from this device's API key (sessionFromDeviceKey) — the same
// hand-off the desktop tray does in its own BrowserWindow, so viewing the
// dashboard never needs a second magic-link login. The long-lived API key never enters the page; only the short-lived
// session token does, seeded into the origin's localStorage under the key the
// dashboard reads (apps/web/src/api.ts).

const TOKEN_KEY = 'eunomia.token';

/**
 * Seeds the token and reports back when it wasn't already there.
 *
 * Runs twice on purpose. Android's WebView injects the "before content loaded"
 * script at onPageStarted, which beats the SPA bundle in practice but is not
 * guaranteed to; the same script also runs after load, where it is guaranteed.
 * If the second run is the one that seeded the token, the page booted signed
 * out and a single reload puts it right — the message below asks for it.
 */
const seedToken = (token: string): string => `
  (function () {
    try {
      var had = localStorage.getItem(${JSON.stringify(TOKEN_KEY)});
      localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)});
      if (!had && window.ReactNativeWebView) window.ReactNativeWebView.postMessage('seeded');
    } catch (e) {}
  })();
  true;
`;

interface Props {
  config: StoredConfig;
  onClose: () => void;
}

export function DashboardScreen({ config, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState('');
  const webview = useRef<WebView>(null);
  // One reload at most: if seeding still loses the race, a loop is worse than
  // the sign-in screen.
  const reloaded = useRef(false);

  useEffect(() => {
    let live = true;
    // Fresh token per open; expiry mid-view just shows the dashboard's own
    // sign-in screen, and reopening recovers.
    sessionFromDeviceKey(config.serverUrl, config.apiKey).then(
      (minted) => live && setToken(minted),
      (err: unknown) => {
        // Offline, revoked key, or a server that predates sessionFromDeviceKey.
        if (live) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      live = false;
    };
  }, [config]);

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <Button title="‹ Back" onPress={onClose} />
        <Text style={styles.barTitle} numberOfLines={1}>
          {config.serverUrl}
        </Text>
      </View>

      {error ? (
        <View style={styles.center}>
          <Text style={ui.error}>Could not open the dashboard: {error}</Text>
        </View>
      ) : token ? (
        <WebView
          ref={webview}
          source={{ uri: config.serverUrl }}
          injectedJavaScriptBeforeContentLoaded={seedToken(token)}
          injectedJavaScript={seedToken(token)}
          onMessage={() => {
            if (reloaded.current) return;
            reloaded.current = true;
            webview.current?.reload();
          }}
          onError={({ nativeEvent }) => setError(nativeEvent.description)}
          // The dashboard's tabs are client state, not history entries, so
          // there is nothing to go back to inside the page — Back leaves.
          setSupportMultipleWindows={false}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  barTitle: { flexShrink: 1, opacity: 0.7 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
});
