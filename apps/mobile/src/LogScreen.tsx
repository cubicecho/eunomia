import { useCallback, useState } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { clearLog, logPath, readLog } from './log.ts';
import { Screen, ui } from './ui.tsx';

// The phone's "Show log file…": what the agent has been saying, including
// from background syncs nobody was watching. Newest last, like the file.

const TAIL_LINES = 300;

function tail(text: string): string {
  const lines = text.trimEnd().split('\n');
  return lines.slice(-TAIL_LINES).join('\n');
}

export function LogScreen({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState(() => tail(readLog()));

  const refresh = useCallback(() => setText(tail(readLog())), []);

  return (
    <Screen title="Log" subtitle={logPath()} onBack={onBack}>
      <View style={styles.actions}>
        <Button title="Refresh" onPress={refresh} />
        <Button
          title="Clear"
          onPress={() => {
            clearLog();
            refresh();
          }}
        />
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
