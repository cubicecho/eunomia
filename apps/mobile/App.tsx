import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { registerBackgroundSync } from './src/background.ts';
import { SetupScreen } from './src/SetupScreen.tsx';
import { StatusScreen } from './src/StatusScreen.tsx';
import { loadConfig, type MobileConfig } from './src/store.ts';

// Android agent: unlike the desktop tray (live sampling), it reads the OS
// usage log retroactively — foreground syncs while open, a WorkManager
// background task while closed. Unprovisioned it shows setup first.

export default function App() {
  const [config, setConfig] = useState<MobileConfig | null>(() => loadConfig());

  // Re-registering on config change also picks up a new sync interval.
  useEffect(() => {
    if (config) {
      registerBackgroundSync(config).catch((error) =>
        console.error('background sync registration failed', error),
      );
    }
  }, [config]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        {config ? (
          <StatusScreen config={config} onConfigChange={setConfig} />
        ) : (
          <SetupScreen onDone={setConfig} />
        )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
});
