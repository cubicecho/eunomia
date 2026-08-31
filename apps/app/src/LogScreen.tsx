import { useCallback, useEffect, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { AgentHost } from './host/index.ts';
import { Screen, ui } from './ui.tsx';

// "Show log file…", inline: what the agent has been saying, including from the
// syncs nobody was watching — a background launch on the phone, a packaged
// desktop agent with no console attached at all. Newest last, like the file.

const TAIL_LINES = 300;

function tail(text: string): string {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-TAIL_LINES).join('\n');
}

export function LogScreen({ host, onBack }: { host: AgentHost; onBack: () => void }) {
  const [text, setText] = useState('');

  // Async because the desktop's log lives in the main process — one IPC round
  // trip, so the screen renders empty for a frame and fills in.
  const refresh = useCallback(() => {
    host.readLog().then(
      (contents) => setText(tail(contents)),
      (error: unknown) => console.error('reading the log failed', error),
    );
  }, [host]);

  useEffect(refresh, [refresh]);

  const clear = (): void => {
    host
      .clearLog()
      .then(refresh, (error: unknown) => console.error('clearing the log failed', error));
  };

  return (
    <Screen title="Log" subtitle={host.logPath} onBack={onBack}>
      <View style={styles.actions}>
        <Button title="Refresh" onPress={refresh} />
        <Button title="Clear" onPress={clear} />
        {host.capabilities.revealLog ? (
          // The desktop has somewhere to reveal it: .log rarely has a handler
          // registered, so the shell opens the containing folder instead.
          <Button
            title="Show in folder"
            onPress={() => {
              host
                .revealLog?.()
                .catch((error: unknown) => console.error('revealing the log failed', error));
            }}
          />
        ) : null}
      </View>
      {text ? (
        <Text style={styles.log} selectable>
          {text}
        </Text>
      ) : (
        <Text style={ui.hint}>Nothing logged yet.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  log: { fontFamily: 'monospace', fontSize: 11, lineHeight: 16 },
});
