import { PAUSE_CHOICES } from '@eunomia/agent';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Button, StyleSheet, Text, View } from 'react-native';
import type { AgentHost, PauseState } from './host/index.ts';

// "Off the record" on the status screen — the same three choices as the
// desktop tray's Pause recording menu. Its own file so the status screen only
// gains one line: the pause is enforced by the shell (the desktop sampler, the
// Android sync), and this card only asks for it and shows it.
//
// Paused is shown as a card, not a row: it is the one state that means "none
// of what you do now is being recorded", and a person who forgot they chose it
// should not be able to miss it.

/** How often the state is re-read: the tray can pause or resume behind us. */
const REFRESH_MS = 15_000;

export function PauseCard({ host }: { host: AgentHost }) {
  const [state, setState] = useState<PauseState | null>(null);
  const [error, setError] = useState('');

  const apply = useCallback((request: Promise<PauseState> | undefined): void => {
    request?.then(
      (next) => {
        setState(next);
        setError('');
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    );
  }, []);

  useEffect(() => {
    const refresh = (): void => apply(host.pauseState?.());
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      clearInterval(id);
      subscription.remove();
    };
  }, [apply, host]);

  // A timed pause ends on its own; flip the card at that moment, not at the
  // next poll.
  const until = state?.until ?? null;
  useEffect(() => {
    if (until === null) return;
    const id = setTimeout(() => apply(host.pauseState?.()), Math.max(0, until - Date.now()) + 500);
    return () => clearTimeout(id);
  }, [apply, host, until]);

  if (!state) return null;

  return (
    <View style={[styles.card, state.paused ? styles.paused : styles.recording]}>
      <Text style={styles.title}>
        {state.paused
          ? state.until === null
            ? 'Paused — off the record until you resume'
            : `Paused — off the record until ${new Date(state.until).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}`
          : 'Recording'}
      </Text>
      <Text style={styles.body}>
        {state.paused
          ? 'Nothing is being recorded. The dashboard will show a gap here.'
          : 'Pause to keep a stretch of time off the record. Nothing is recorded while paused.'}
      </Text>
      {state.paused ? (
        <Button title="Resume recording" onPress={() => apply(host.resume?.())} />
      ) : (
        <View style={styles.choices}>
          {PAUSE_CHOICES.map((choice) => (
            <Button
              key={choice.label}
              title={`Pause ${choice.label.toLowerCase()}`}
              onPress={() => apply(host.pause?.(choice.ms))}
            />
          ))}
        </View>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: 14, marginBottom: 20, gap: 10 },
  recording: { borderColor: '#d0d0d0' },
  paused: { borderColor: '#8a6fd1', backgroundColor: '#f1ecfb' },
  title: { fontWeight: '600' },
  body: { opacity: 0.8 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: '#b3261e' },
});
