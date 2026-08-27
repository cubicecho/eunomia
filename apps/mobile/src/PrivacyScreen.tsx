import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { type MobileConfig, writeConfig } from './store.ts';
import { Screen, ui } from './ui.tsx';

// Privacy rules — the same ignoreApps/redactApps the desktop agent reads out
// of config.json, which on a phone nobody can open a text editor on. Patterns
// are case-insensitive regexes matched against the app identifier; on Android
// that is the package name (com.example.app), not the label shown here in the
// launcher.
//
// Sanitization runs before a ping is written (see @eunomia/agent's
// createSanitizer, applied in sync.ts), so anything matched here never reaches
// the outbox on disk, let alone the server.

const toLines = (patterns: string[] | undefined): string => (patterns ?? []).join('\n');

const toPatterns = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

interface Props {
  config: MobileConfig;
  onConfigChange: (config: MobileConfig) => void;
  onBack: () => void;
}

export function PrivacyScreen({ config, onConfigChange, onBack }: Props) {
  const [ignore, setIgnore] = useState(() => toLines(config.ignoreApps));
  const [redact, setRedact] = useState(() => toLines(config.redactApps));
  const [saved, setSaved] = useState(false);

  const save = (): void => {
    const next: MobileConfig = {
      ...config,
      ignoreApps: toPatterns(ignore),
      redactApps: toPatterns(redact),
    };
    writeConfig(next);
    onConfigChange(next);
    setSaved(true);
  };

  return (
    <Screen
      title="Privacy"
      subtitle="One pattern per line. Applied on this device, before anything is stored or uploaded."
      onBack={onBack}
    >
      <Text style={ui.label}>Ignored apps</Text>
      <Text style={ui.hint}>Dropped entirely — their time shows up nowhere.</Text>
      <TextInput
        style={[ui.input, ui.multiline]}
        value={ignore}
        onChangeText={(text) => {
          setIgnore(text);
          setSaved(false);
        }}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="com.example.banking"
      />

      <Text style={ui.label}>Redacted apps</Text>
      <Text style={ui.hint}>
        Time still accrues to the app, but the window title and context are stripped.
      </Text>
      <TextInput
        style={[ui.input, ui.multiline]}
        value={redact}
        onChangeText={(text) => {
          setRedact(text);
          setSaved(false);
        }}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="com.example.messenger"
      />

      <Text style={ui.hint}>
        Patterns are case-insensitive regular expressions matched against the Android package name.
        An invalid pattern is skipped rather than applied.
      </Text>

      <View style={ui.button}>
        <Button title={saved ? 'Saved' : 'Save'} onPress={save} disabled={saved} />
      </View>
    </Screen>
  );
}
