import {
  type AgentConfig,
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  syncIntervalMs,
} from '@eunomia/agent';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import UsageEvents from '../modules/usage-events';
import { getOutbox, writeConfig } from './store.ts';
import { performSync, type SyncResult } from './sync.ts';

// Main screen once provisioned: usage-access gate, outbox status, manual
// sync, sync-interval setting. Syncs on the configured interval while the
// app is in the foreground (plus on every return to the foreground) — the
// background task covers the stretches in between.

interface Props {
  config: AgentConfig;
  onConfigChange: (config: AgentConfig) => void;
}

export function StatusScreen({ config, onConfigChange }: Props) {
  const [usageAccess, setUsageAccess] = useState(() => UsageEvents.isUsageAccessGranted());
  const [pending, setPending] = useState(() => getOutbox().size);
  const [lastSync, setLastSync] = useState<{ at: Date; result: SyncResult } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [intervalText, setIntervalText] = useState(() =>
    String(config.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS),
  );

  const sync = useCallback(async (): Promise<void> => {
    if (!UsageEvents.isUsageAccessGranted()) {
      setUsageAccess(false);
      return;
    }
    setUsageAccess(true);
    setSyncing(true);
    setError('');
    try {
      const result = await performSync();
      setLastSync({ at: new Date(), result });
      setPending(result.pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, []);

  // Re-check access and sync every time the app comes back to the foreground
  // (including the return from the usage-access settings screen).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    void sync();
    return () => subscription.remove();
  }, [sync]);

  // Periodic sync while the app stays in the foreground. Backgrounded, timers
  // are throttled/frozen — the WorkManager task takes over there.
  useEffect(() => {
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, syncIntervalMs(config));
    return () => clearInterval(id);
  }, [config, sync]);

  const saveInterval = (): void => {
    const current = config.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS;
    const parsed = Number.parseInt(intervalText, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setIntervalText(String(current));
      return;
    }
    const seconds = Math.max(MIN_SYNC_INTERVAL_SECONDS, parsed);
    setIntervalText(String(seconds));
    if (seconds === current) return;
    const next = { ...config, syncIntervalSeconds: seconds };
    writeConfig(next);
    onConfigChange(next);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>eunomia</Text>
      <Text style={styles.sub}>Uploading to {config.serverUrl}</Text>

      {!usageAccess && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Usage access needed</Text>
          <Text style={styles.cardBody}>
            eunomia reads Android's app-usage log to track which app is in the foreground. Grant
            "Usage access" to eunomia in system settings.
          </Text>
          <Button
            title="Open usage access settings"
            onPress={UsageEvents.openUsageAccessSettings}
          />
        </View>
      )}

      <View style={styles.row}>
        <Text style={styles.rowLabel}>Pending pings</Text>
        <Text>{pending}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Last sync</Text>
        <Text>
          {lastSync
            ? `${lastSync.at.toLocaleTimeString()} — ${lastSync.result.synthesized} new`
            : 'never'}
        </Text>
      </View>
      {lastSync?.result.uploadError ? (
        // Pings are safe in the outbox, but silence here would read as success.
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Upload</Text>
          <Text style={styles.uploadError}>failing — {lastSync.result.uploadError}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Text style={styles.rowLabel}>Sync every</Text>
        <View style={styles.intervalEdit}>
          <TextInput
            style={styles.intervalInput}
            value={intervalText}
            onChangeText={setIntervalText}
            onEndEditing={saveInterval}
            keyboardType="number-pad"
          />
          <Text>seconds</Text>
        </View>
      </View>

      <View style={styles.button}>
        <Button
          title={syncing ? 'Syncing…' : 'Sync now'}
          onPress={() => void sync()}
          disabled={syncing || !usageAccess}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 28 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 4 },
  sub: { opacity: 0.7, marginBottom: 20 },
  card: {
    borderWidth: 1,
    borderColor: '#e0b060',
    backgroundColor: '#fdf6e6',
    borderRadius: 8,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  cardTitle: { fontWeight: '600' },
  cardBody: { opacity: 0.8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  rowLabel: { fontWeight: '600' },
  uploadError: { color: '#b3261e', flexShrink: 1, textAlign: 'right' },
  intervalEdit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  intervalInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 60,
    textAlign: 'right',
  },
  button: { marginTop: 22 },
  error: { color: '#d33', marginTop: 12 },
});
