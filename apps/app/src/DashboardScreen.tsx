import type { StoredConfig } from '@eunomia/agent';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { agentTokens } from './store.ts';
import { ui } from './ui.tsx';

// The dashboard on the phone: the server-hosted web app, signed in as the
// agent is — the same hand-off the desktop tray does in its own BrowserWindow,
// so viewing the dashboard never needs a second sign-in. The page gets the
// agent's bearer, seeded into the origin's localStorage under the key the
// dashboard reads (apps/web/src/api.ts): a provider access token, which lives
// minutes and is pushed in again each time the app refreshes it (the refresh
// token never enters the page), or the session a sign-in link opened, which
// signing out in the dashboard ends for the agent too.

const TOKEN_KEY = 'eunomia.token';

/**
 * How often an open dashboard asks for the bearer, which refreshes a provider
 * token nearing its expiry: the sync asks too, but on its own interval, which
 * may be longer than the token lives.
 */
const KEEP_FRESH_MS = 30_000;

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
    const tokens = agentTokens(config);
    tokens.bearer().then(
      (bearer) => live && setToken(bearer),
      (err: unknown) => {
        // Offline at refresh time, or signed out at the provider.
        if (live) setError(err instanceof Error ? err.message : String(err));
      },
    );
    // A refreshed token goes straight into the open page; the sync refreshes
    // it while the dashboard is up.
    const unsubscribe = tokens.subscribe((bearer) => {
      if (!live) return;
      setToken(bearer);
      webview.current?.injectJavaScript(seedToken(bearer));
    });
    const keepFresh = setInterval(() => void tokens.bearer().catch(() => {}), KEEP_FRESH_MS);
    return () => {
      live = false;
      unsubscribe();
      clearInterval(keepFresh);
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
