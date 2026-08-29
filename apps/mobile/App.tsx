import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { applyBackgroundSync, applyKeepAlive } from './src/background.ts';
import { DashboardScreen } from './src/DashboardScreen.tsx';
import { LogScreen } from './src/LogScreen.tsx';
import { startFileLog } from './src/log.ts';
import { PrivacyScreen } from './src/PrivacyScreen.tsx';
import { SetupScreen } from './src/SetupScreen.tsx';
import { StatusScreen } from './src/StatusScreen.tsx';
import { loadConfig, type MobileConfig } from './src/store.ts';

// Android agent: unlike the desktop tray (live sampling), it reads the OS
// usage log retroactively — foreground syncs while open, a WorkManager
// background task while closed. Unprovisioned it shows setup first.
//
// Navigation is one state field rather than a router: every screen is reached
// from the status screen and returns to it, the way every tray menu item on
// the desktop opens one window and closes back to the tray.

type Screen = 'status' | 'dashboard' | 'change-server' | 'privacy' | 'log';

export default function App() {
  const [config, setConfig] = useState<MobileConfig | null>(() => loadConfig());
  const [screen, setScreen] = useState<Screen>('status');

  useEffect(() => startFileLog(), []);

  // Re-applying on config change also picks up a new sync interval and both
  // background toggles.
  useEffect(() => {
    if (config) {
      applyBackgroundSync(config).catch((error: unknown) =>
        console.error('background sync registration failed', error),
      );
      applyKeepAlive(config);
    }
  }, [config]);

  // Hardware back leaves a sub-screen instead of the app; on the status screen
  // it does what it always does and closes the agent's UI (which keeps
  // tracking — the background task is not tied to this process).
  useEffect(() => {
    if (screen === 'status') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setScreen('status');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  const toStatus = (): void => setScreen('status');

  const onConfigChange = (next: MobileConfig): void => {
    setConfig(next);
    setScreen('status');
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        {!config ? (
          <SetupScreen onDone={setConfig} />
        ) : screen === 'dashboard' ? (
          <DashboardScreen config={config} onClose={toStatus} />
        ) : screen === 'change-server' ? (
          <SetupScreen current={config} onDone={onConfigChange} onCancel={toStatus} />
        ) : screen === 'privacy' ? (
          <PrivacyScreen config={config} onConfigChange={setConfig} onBack={toStatus} />
        ) : screen === 'log' ? (
          <LogScreen onBack={toStatus} />
        ) : (
          <StatusScreen
            config={config}
            onConfigChange={setConfig}
            onOpenDashboard={() => setScreen('dashboard')}
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
});
