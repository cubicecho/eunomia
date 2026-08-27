import {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  syncIntervalMs,
} from '@eunomia/agent';
import * as Application from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Button, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import UsageEvents from '../modules/usage-events';
import { type BackgroundState, backgroundState } from './background.ts';
import { getOutbox, type MobileConfig, outboxPath, writeConfig } from './store.ts';
import { performSync, type SyncResult } from './sync.ts';
import { MenuItem, Row, Screen, ui } from './ui.tsx';

// Main screen once provisioned — the phone's version of the desktop tray
// menu: what the agent is doing, whether uploads are getting through, and the
// same set of actions (dashboard, change server, privacy, log). Syncs on the
// configured interval while the app is in the foreground (plus on every return
// to the foreground); the background task covers the stretches in between.

interface Props {
  config: MobileConfig;
  onConfigChange: (config: MobileConfig) => void;
  onOpenDashboard: () => void;
  onChangeServer: () => void;
  onOpenPrivacy: () => void;
  onOpenLog: () => void;
}

export function StatusScreen({
  config,
  onConfigChange,
  onOpenDashboard,
  onChangeServer,
  onOpenPrivacy,
  onOpenLog,
}: Props) {
  const [usageAccess, setUsageAccess] = useState(() => UsageEvents.isUsageAccessGranted());
  const [pending, setPending] = useState(() => getOutbox().size);
  const [lastSync, setLastSync] = useState<{ at: Date; result: SyncResult } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [background, setBackground] = useState<BackgroundState | null>(null);
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
  // (including the return from the usage-access settings screen). The
  // background-task state is read back here too rather than assumed: the OS
  // can refuse background work outright, and a toggle that says "on" over a
  // task Android is not running would be a lie.
  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      void sync();
      backgroundState().then(
        (state) => {
          if (live) setBackground(state);
        },
        (err: unknown) => console.error('background status failed', err),
      );
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    refresh();
    return () => {
      live = false;
      subscription.remove();
    };
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
    update({ syncIntervalSeconds: seconds });
  };

  const update = (patch: Partial<MobileConfig>): void => {
    const next = { ...config, ...patch };
    writeConfig(next);
    onConfigChange(next);
  };

  // The phone's "Start at login": WorkManager keeps the registration across
  // reboots, so this is the difference between an agent that tracks all day
  // and one that tracks while you're looking at it. App.tsx applies the change.
  const backgroundEnabled = config.backgroundSync !== false;

  return (
    <Screen title="eunomia" subtitle={`agent ${Application.nativeApplicationVersion ?? '—'}`}>
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

      <Row label="Device">{config.deviceName ?? 'this phone'}</Row>
      <Row label="Uploading to">{config.serverUrl}</Row>
      {config.serverUrl.startsWith('http://') ? (
        // A desktop agent stays on the LAN; a phone follows you onto café wifi,
        // where this device's API key and every ping are readable in transit.
        <Row label="Encryption">
          <Text style={ui.warn}>off — this network can read what's sent</Text>
        </Row>
      ) : null}
      {lastSync?.result.uploadError ? (
        // Pings are safe in the outbox, but silence here would read as success.
        <Row label="Upload">
          <Text style={ui.warn}>failing — {lastSync.result.uploadError}</Text>
        </Row>
      ) : null}
      <Row label="Pending pings">{String(pending)}</Row>
      <Row label="Last sync">
        {lastSync
          ? `${lastSync.at.toLocaleTimeString()} — ${lastSync.result.synthesized} new`
          : 'never'}
      </Row>
      <Row label="Sync every">
        <View style={styles.intervalEdit}>
          <TextInput
            style={[ui.input, styles.intervalInput]}
            value={intervalText}
            onChangeText={setIntervalText}
            onEndEditing={saveInterval}
            keyboardType="number-pad"
          />
          <Text>seconds</Text>
        </View>
      </Row>
      <Row label="Sync in the background">
        <Switch
          value={backgroundEnabled}
          onValueChange={(value) => update({ backgroundSync: value })}
        />
      </Row>
      {backgroundEnabled && background ? (
        <Text style={background.available ? ui.hint : ui.warn}>
          {!background.available
            ? 'Android is not running background work for eunomia — check battery optimization for this app.'
            : background.registered
              ? 'Enrolled with Android — runs at least every 15 minutes, reboots included.'
              : 'Not enrolled yet; it registers the next time the app opens.'}
        </Text>
      ) : null}

      <View style={ui.button}>
        <Button
          title={syncing ? 'Syncing…' : 'Sync now'}
          onPress={() => void sync()}
          disabled={syncing || !usageAccess}
        />
      </View>

      {error ? <Text style={ui.error}>{error}</Text> : null}

      <Text style={ui.section}>Actions</Text>
      <MenuItem label="Open dashboard" detail={config.serverUrl} onPress={onOpenDashboard} />
      <MenuItem
        label="Change server / API key…"
        detail="Move this device to another server, or re-key it"
        onPress={onChangeServer}
      />
      <MenuItem label="Privacy…" detail={privacyDetail(config)} onPress={onOpenPrivacy} />
      <MenuItem label="View log…" detail="What the agent has been saying" onPress={onOpenLog} />

      <Text style={[ui.hint, styles.path]} selectable>
        Outbox: {outboxPath()}
      </Text>
    </Screen>
  );
}

function privacyDetail(config: MobileConfig): string {
  const ignored = config.ignoreApps?.length ?? 0;
  const redacted = config.redactApps?.length ?? 0;
  if (ignored === 0 && redacted === 0) return 'No apps ignored or redacted';
  return `${ignored} ignored, ${redacted} redacted`;
}

const styles = StyleSheet.create({
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
  intervalEdit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  intervalInput: { paddingVertical: 2, minWidth: 60, textAlign: 'right' },
  path: { marginTop: 20 },
});
