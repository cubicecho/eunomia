import type { StoredConfig } from '@eunomia/agent';
import { StatusBar } from 'expo-status-bar';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type AgentHost, createHost } from './src/host/index.ts';
import { LogScreen } from './src/LogScreen.tsx';
import { PrivacyScreen } from './src/PrivacyScreen.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { StatusScreen } from './src/StatusScreen.tsx';
import { ui } from './src/ui.tsx';

// The agent UI, shared by every shell that has an agent behind it: the Android
// app (which IS the agent — it reads the OS usage log in this process), and the
// Electron window, where the agent lives in the main process and this is a
// renderer talking to it over IPC. Which one is running is src/host: the
// screens ask the host, never the platform.
//
// Navigation is one state field rather than a router: every screen is reached
// from the status screen and returns to it, the way every tray menu item on
// the desktop opens one window and closes back to the tray.

// Pulled in only when it is rendered. It is a react-native-webview, which
// exists on the phone and nowhere else — under Electron the dashboard opens as
// its own BrowserWindow (capabilities.externalDashboard), so this module must
// not run there just because it was bundled.
const DashboardScreen = lazy(async () => ({
  default: (await import('./src/DashboardScreen.tsx')).DashboardScreen,
}));

type Screen = 'status' | 'dashboard' | 'change-server' | 'privacy' | 'log';

export default function App() {
  const [host, setHost] = useState<AgentHost | null>(null);
  const [config, setConfig] = useState<StoredConfig | null>(null);
  const [screen, setScreen] = useState<Screen>('status');

  // Resolved once, asynchronously: the Electron host has to ask the main
  // process what it is before it can answer anything, and the config comes
  // from wherever that shell keeps it. Until both land there is nothing to
  // render but a spinner — an empty config would flash the setup screen at a
  // provisioned agent.
  useEffect(() => {
    let live = true;
    createHost()
      .then(async (resolved) => {
        const stored = await resolved.loadConfig();
        if (!live) return;
        setConfig(stored);
        setHost(resolved);
      })
      .catch((error: unknown) => console.error('no agent host', error));
    return () => {
      live = false;
    };
  }, []);

  // Re-applying on every config change also picks up a new sync interval and
  // both background toggles. A no-op on shells whose agent applied the change
  // itself when it took the save.
  useEffect(() => {
    if (!host || !config) return;
    host
      .applyConfig?.(config)
      .catch((error: unknown) => console.error('applying the config failed', error));
  }, [host, config]);

  // Hardware back leaves a sub-screen instead of the app; on the status screen
  // it does what it always does and closes the agent's UI (which keeps
  // tracking — the background task is not tied to this process). Android only:
  // nothing else this UI runs on has a back button to intercept.
  useEffect(() => {
    if (Platform.OS !== 'android' || screen === 'status') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('status');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  const toStatus = useCallback((): void => setScreen('status'), []);

  const onConfigChange = (next: StoredConfig): void => {
    setConfig(next);
    setScreen('status');
  };

  // The desktop tray has always opened the dashboard in its own window — a
  // sandboxed one, since it shows remote content — so there it stays a request
  // to the shell rather than a screen in here.
  const openDashboard = useCallback((): void => {
    if (!host) return;
    if (host.capabilities.externalDashboard) {
      host
        .openDashboard?.()
        .catch((error: unknown) => console.error('opening the dashboard failed', error));
      return;
    }
    setScreen('dashboard');
  }, [host]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        {!host ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !host.available ? (
          // A plain browser: no focused-window API, no usage log, nowhere to
          // keep an API key. The dashboard a visitor actually wants is apps/web,
          // which the server serves at /.
          <View style={styles.center}>
            <Text style={ui.title}>No agent here</Text>
            <Text style={ui.sub}>
              This is the eunomia agent's own UI. It needs an agent behind it — open the desktop
              app, or the eunomia app on your phone. Your dashboard is on your server.
            </Text>
          </View>
        ) : !config ? (
          <SetupScreen host={host} onDone={setConfig} />
        ) : screen === 'dashboard' ? (
          <Suspense
            fallback={
              <View style={styles.center}>
                <ActivityIndicator />
              </View>
            }
          >
            <DashboardScreen config={config} onClose={toStatus} />
          </Suspense>
        ) : screen === 'change-server' ? (
          <SetupScreen host={host} current={config} onDone={onConfigChange} onCancel={toStatus} />
        ) : screen === 'privacy' ? (
          <PrivacyScreen host={host} config={config} onConfigChange={setConfig} onBack={toStatus} />
        ) : screen === 'log' ? (
          <LogScreen host={host} onBack={toStatus} />
        ) : (
          <StatusScreen
            host={host}
            config={config}
            onConfigChange={setConfig}
            onOpenDashboard={openDashboard}
            onChangeServer={() => setScreen('change-server')}
            onOpenPrivacy={() => setScreen('privacy')}
            onOpenLog={() => setScreen('log')}
          />
        )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
});
