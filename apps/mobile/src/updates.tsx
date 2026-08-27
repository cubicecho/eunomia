import * as Updates from 'expo-updates';
import { Button, StyleSheet, Text, View } from 'react-native';
import { Row, ui } from './ui.tsx';

// Which JavaScript this agent is actually running.
//
// That is not a rhetorical question here. `cli.appVersionSource` is `remote`,
// so an over-the-air update never moves `nativeApplicationVersion` — the
// version in the status screen's subtitle is the APK's, and it says nothing
// about the bundle on top of it. This row is the only way to tell from the
// phone, which is why it exists at all.
//
// It renders nothing under Metro or in a dev build: expo-updates is compiled in
// but disabled there, the dev launcher picks the bundle, and every field below
// would be a lie.

interface Props {
  /** True while a sync is in flight — see the restart button below. */
  busy: boolean;
}

export function UpdateRow({ busy }: Props) {
  const { currentlyRunning, isUpdatePending, isDownloading, downloadError } = Updates.useUpdates();

  if (!Updates.isEnabled) return null;

  const running = currentlyRunning.isEmbeddedLaunch
    ? 'shipped with the app'
    : `${currentlyRunning.updateId?.slice(0, 8) ?? '—'} · ${
        currentlyRunning.createdAt?.toLocaleDateString() ?? ''
      }`;

  return (
    <>
      <Row label="Running">{running}</Row>
      {downloadError ? (
        // Same treatment as a failing upload: the agent kept working, but
        // silence here would read as "up to date".
        <Row label="Update">
          <Text style={ui.warn}>couldn't download — {downloadError.message}</Text>
        </Row>
      ) : null}
      {isDownloading ? <Row label="Update">downloading…</Row> : null}
      {isUpdatePending ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Update downloaded</Text>
          <Text style={styles.cardBody}>
            It applies on its own the next time the agent starts, which the background sync does
            about once an hour. Restarting now only skips the wait.
          </Text>
          <Button
            title="Restart now"
            // Never from a timer, an effect, or background.ts: a reload during
            // a headless WorkManager launch tears down the runtime under the
            // task's callback, whose promise then never settles — Android reads
            // that as a failed task and backs it off. A button on a foreground
            // screen cannot land there. Held while a sync runs so the reload
            // stays clear of the outbox flush.
            disabled={busy}
            onPress={() => {
              Updates.reloadAsync().catch((error: unknown) =>
                console.error('reload failed', error),
              );
            }}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#9ab',
    backgroundColor: '#eef4fb',
    borderRadius: 8,
    padding: 14,
    marginTop: 14,
    gap: 10,
  },
  cardTitle: { fontWeight: '600' },
  cardBody: { opacity: 0.8 },
});
