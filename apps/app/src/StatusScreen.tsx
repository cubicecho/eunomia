import {
  DEFAULT_SYNC_INTERVAL_SECONDS,
  MIN_SYNC_INTERVAL_SECONDS,
  type StoredConfig,
  syncIntervalMs,
} from '@eunomia/agent';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Button, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { AgentHost, BackgroundState, KeepAliveState, SyncSummary } from './host/index.ts';
import { MenuItem, Row, Screen, ui } from './ui.tsx';
import { UpdateRow } from './updates.tsx';

// Main screen once provisioned — what the agent is doing, whether uploads are
// getting through, and the actions the desktop tray menu has always had
// (dashboard, change server, privacy, log).
//
// Everything platform-shaped is a capability on the host, not a check on
// Platform.OS: the phone adds usage access, a background task and a keep-alive
// service; the desktop adds launch-at-login and a log it can reveal in a file
// manager. The rows below appear where they mean something and nowhere else.

interface Props {
  host: AgentHost;
  config: StoredConfig;
  onConfigChange: (config: StoredConfig) => void;
  onOpenDashboard: () => void;
  onChangeServer: () => void;
  onOpenPrivacy: () => void;
  onOpenLog: () => void;
}

export function StatusScreen({
  host,
  config,
  onConfigChange,
  onOpenDashboard,
  onChangeServer,
  onOpenPrivacy,
  onOpenLog,
}: Props) {
  const { capabilities } = host;
  // Null until the first answer arrives — a shell with nothing to grant says
  // true, so treating "unknown" as "denied" would flash a warning at it.
  const [usageAccess, setUsageAccess] = useState<boolean | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<{ at: Date; result: SyncSummary } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const [keepAlive, setKeepAlive] = useState<KeepAliveState | null>(null);
  const [intervalText, setIntervalText] = useState(() =>
    String(config.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS),
  );

  const sync = useCallback(async (): Promise<void> => {
    const granted = await host.usageAccessGranted();
    setUsageAccess(granted);
    if (!granted) return;
    setSyncing(true);
    setError('');
    try {
      const result = await host.syncNow();
      setLastSync({ at: new Date(), result });
      setPending(result.pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }, [host]);

  // Re-check access and refresh every time the UI comes back to the foreground
  // (including the return from Android's usage-access settings screen). The
  // background-task state is read back rather than assumed: the OS can refuse
  // background work outright, and a toggle that says "on" over a task Android
  // is not running would be a lie.
  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      if (capabilities.foregroundSync) {
        void sync();
      } else {
        // Nothing to drive here — the shell's agent is already syncing. Just
        // read back what it has queued.
        host.usageAccessGranted().then(
          (granted) => live && setUsageAccess(granted),
          (err: unknown) => console.error('usage access check failed', err),
        );
        host.pendingCount().then(
          (count) => live && setPending(count),
          (err: unknown) => console.error('reading the outbox failed', err),
        );
      }
      host.keepAliveState?.().then(
        (state) => live && setKeepAlive(state),
        (err: unknown) => console.error('keep-alive status failed', err),
      );
      host.backgroundState?.().then(
        (state) => live && setBackground(state),
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
  }, [capabilities.foregroundSync, host, sync]);

  // Periodic sync while this UI is open, on the shell that needs one.
  // Backgrounded on a phone, timers are throttled or frozen — the WorkManager
  // task takes over there.
  useEffect(() => {
    if (!capabilities.foregroundSync) return;
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, syncIntervalMs(config));
    return () => clearInterval(id);
  }, [capabilities.foregroundSync, config, sync]);

  const update = useCallback(
    (patch: Partial<StoredConfig>): void => {
      const next = { ...config, ...patch };
      host.saveConfig(next).then(
        () => onConfigChange(next),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      );
    },
    [config, host, onConfigChange],
  );

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

  // The phone's "Start at login": WorkManager keeps the registration across
  // reboots, so this is the difference between an agent that tracks all day
  // and one that tracks while you're looking at it. The host applies it.
  const backgroundEnabled = config.backgroundSync !== false;

  // The heavier promise: a foreground service, so a force stop by an OEM
  // battery manager can't quietly end the day's tracking. Off by default —
  // it buys a permanent notification.
  const keepAliveEnabled = config.keepAlive === true;
  const intervalSeconds = config.syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS;

  // Default on: a tracker that has to be started by hand mostly measures
  // forgetting to start it.
  const autostartEnabled = config.autostart !== false;

  const toggleKeepAlive = (value: boolean): void => {
    // Asking here rather than at startup: this is the one feature that has a
    // notification to show, and the dialog explains itself in context.
    if (value) {
      host
        .requestNotificationPermission?.()
        .catch((err: unknown) => console.error('notification permission request failed', err));
    }
    update({ keepAlive: value });
    // The host starts or stops the service from App.tsx's effect; re-read once
    // it has, or the hint below would still describe the state we just changed.
    setTimeout(() => {
      host
        .keepAliveState?.()
        .then(setKeepAlive, (err: unknown) => console.error('keep-alive status failed', err));
    }, 400);
  };

  return (
    <Screen title="eunomia" subtitle={`agent ${host.version ?? '—'}`}>
      {capabilities.usageAccess && usageAccess === false && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Usage access needed</Text>
          <Text style={styles.cardBody}>
            eunomia reads Android's app-usage log to track which app is in the foreground. Grant
            "Usage access" to eunomia in system settings.
          </Text>
          <Button
            title="Open usage access settings"
            onPress={() => {
              host
                .openUsageAccessSettings?.()
                .catch((err: unknown) =>
                  console.error('opening usage access settings failed', err),
                );
            }}
          />
        </View>
      )}

      <Row label="Device">{config.deviceName ?? 'this device'}</Row>
      <Row label="Uploading to">{config.serverUrl}</Row>
      {config.serverUrl.startsWith('http://') ? (
        // On a LAN this is a choice; on café wifi it means this device's API
        // key and every ping are readable in transit.
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
      <Row label="Pending pings">{pending === null ? '—' : String(pending)}</Row>
      <Row label="Last sync">
        {lastSync
          ? // A shell that samples continuously has nothing to synthesize on a
            // manual sync — the count would be a lie, so it isn't shown.
            `${lastSync.at.toLocaleTimeString()}${
              lastSync.result.synthesized === null ? '' : ` — ${lastSync.result.synthesized} new`
            }`
          : 'never'}
      </Row>
      {capabilities.updates ? <UpdateRow busy={syncing} /> : null}
      <Row label="Sync every">
        <View style={styles.intervalEdit}>
          <TextInput
            style={[ui.input, styles.intervalInput]}
            value={intervalText}
            onChangeText={setIntervalText}
            onEndEditing={saveInterval}
            onBlur={saveInterval}
            keyboardType="number-pad"
          />
          <Text>seconds</Text>
        </View>
      </Row>

      {capabilities.autostart ? (
        <Row label="Start at login">
          <Switch
            value={autostartEnabled}
            onValueChange={(value) => update({ autostart: value })}
          />
        </Row>
      ) : null}

      {capabilities.backgroundSync ? (
        <>
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
        </>
      ) : null}

      {capabilities.keepAlive ? (
        <>
          <Row label="Keep running when closed">
            <Switch value={keepAliveEnabled} onValueChange={toggleKeepAlive} />
          </Row>
          {keepAliveEnabled && keepAlive ? (
            <Text style={keepAlive.running ? ui.hint : ui.warn}>
              {!keepAlive.running
                ? 'Not running yet; it starts the next time the app opens.'
                : keepAlive.notifications
                  ? `Running as a service — syncs every ${intervalSeconds}s whether or not eunomia is open, and comes back after a reboot.`
                  : 'Running as a service, but its notification is hidden because notifications are off for eunomia.'}
            </Text>
          ) : null}
          {keepAlive && !keepAlive.batteryExempt ? (
            <>
              <Text style={ui.hint}>
                Android may stop eunomia to save battery — on some phones that ends background
                tracking until you open the app again.
              </Text>
              <View style={ui.button}>
                <Button
                  title="Allow unrestricted battery use"
                  onPress={() => {
                    host
                      .requestBatteryExemption?.()
                      .catch((err: unknown) =>
                        console.error('battery exemption request failed', err),
                      );
                  }}
                />
              </View>
            </>
          ) : null}
        </>
      ) : null}

      <View style={ui.button}>
        <Button
          title={syncing ? 'Syncing…' : 'Sync now'}
          onPress={() => void sync()}
          disabled={syncing || usageAccess === false}
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
      <MenuItem label="Privacy…" detail={privacyDetail(config, host)} onPress={onOpenPrivacy} />
      <MenuItem label="View log…" detail="What the agent has been saying" onPress={onOpenLog} />

      <Text style={[ui.hint, styles.path]} selectable>
        Outbox: {host.outboxPath}
      </Text>
    </Screen>
  );
}

function privacyDetail(config: StoredConfig, host: AgentHost): string {
  const ignored = config.ignoreApps?.length ?? 0;
  const redacted = config.redactApps?.length ?? 0;
  const parts: string[] = [];
  if (ignored > 0 || redacted > 0) parts.push(`${ignored} ignored, ${redacted} redacted`);
  // Only mentioned when off: on is the default, and this is the line that
  // explains an entry nobody recognizes turning up in the dashboard.
  if (host.capabilities.usageAccess && config.launchableAppsOnly === false) {
    parts.push('system screens recorded');
  }
  if (parts.length === 0) return 'No apps ignored or redacted';
  return parts.join(' · ');
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
