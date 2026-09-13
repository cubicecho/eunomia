import { type CaptureLevel, DEFAULT_CAPTURE_LEVEL, type StoredConfig } from '@eunomia/agent';
import { useState } from 'react';
import { Button, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { AgentHost } from './host/index.ts';
import { Row, Screen, ui } from './ui.tsx';

// Privacy rules — the captureLevel and ignoreApps/redactApps both agents read
// out of config.json, edited here rather than in a text editor nobody has on a
// phone.
// Patterns are case-insensitive regexes matched against the app identifier: the
// Android package name (com.example.app), or the desktop executable (firefox),
// never the label the launcher or the dashboard shows.
//
// Sanitization runs before a ping is written (see @eunomia/agent's
// createSanitizer, applied in sync.ts and in the desktop sampler), so anything
// matched here never reaches the ping log on disk, let alone the server.

const toLines = (patterns: string[] | undefined): string => (patterns ?? []).join('\n');

const toPatterns = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const LEVELS: { level: CaptureLevel; label: string; detail: string }[] = [
  {
    level: 'title',
    label: 'App, context and window title',
    detail: 'Everything this device can read.',
  },
  {
    level: 'context',
    label: 'App and context',
    detail:
      'Window titles stay on this device. Only a context the agent reads itself is kept — the ' +
      'browser site, on Windows and macOS — so contexts your rules pull out of titles are lost.',
  },
  {
    level: 'app',
    label: 'App only',
    detail: 'Time per app, and nothing about what was open in it.',
  },
];

interface Props {
  host: AgentHost;
  config: StoredConfig;
  onConfigChange: (config: StoredConfig) => void;
  onBack: () => void;
}

export function PrivacyScreen({ host, config, onConfigChange, onBack }: Props) {
  const [ignore, setIgnore] = useState(() => toLines(config.ignoreApps));
  const [redact, setRedact] = useState(() => toLines(config.redactApps));
  const [level, setLevel] = useState(config.captureLevel ?? DEFAULT_CAPTURE_LEVEL);
  // Absent means on — see sync.ts.
  const [appsOnly, setAppsOnly] = useState(config.launchableAppsOnly !== false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Only Android's usage log calls the launcher, the shade and a permission
  // dialog "an app in the foreground"; a desktop window manager does not.
  const launchableApplies = host.capabilities.usageAccess;
  const identifier = host.platform === 'android' ? 'Android package name' : 'executable name';

  const save = async (): Promise<void> => {
    const next: StoredConfig = {
      ...config,
      ignoreApps: toPatterns(ignore),
      redactApps: toPatterns(redact),
      captureLevel: level,
    };
    if (launchableApplies) next.launchableAppsOnly = appsOnly;
    setError('');
    try {
      await host.saveConfig(next);
      onConfigChange(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen
      title="Privacy"
      subtitle="Applied on this device, before anything is stored or uploaded."
      onBack={onBack}
    >
      <Text style={ui.label}>Detail captured</Text>
      {LEVELS.map((option) => {
        const selected = option.level === level;
        return (
          <Pressable
            key={option.level}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => {
              setLevel(option.level);
              setSaved(false);
            }}
            style={({ pressed }) => [styles.option, pressed && ui.menuItemPressed]}
          >
            <Text style={[styles.optionLabel, selected && styles.selected]}>
              {selected ? '● ' : '○ '}
              {option.label}
            </Text>
            <Text style={ui.menuDetail}>{option.detail}</Text>
          </Pressable>
        );
      })}
      <Text style={ui.hint}>
        Applies to every app from the next ping on. Pings already in the ping log keep the detail
        they were recorded with, and rules that match on titles stop matching once none are sent.
      </Text>

      {launchableApplies ? (
        <>
          <Row label="Only apps you can open">
            <Switch
              value={appsOnly}
              onValueChange={(value) => {
                setAppsOnly(value);
                setSaved(false);
              }}
            />
          </Row>
          <Text style={ui.hint}>
            Android counts anything that reaches the screen as time in an app — the launcher between
            two apps, the notification shade, a permission dialog. With this on, only apps with an
            icon in your launcher are recorded.
          </Text>
        </>
      ) : null}

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
        placeholder={host.platform === 'android' ? 'com.example.banking' : 'keepassxc'}
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
        placeholder={host.platform === 'android' ? 'com.example.messenger' : 'signal-desktop'}
      />

      <Text style={ui.hint}>
        One pattern per line. Patterns are case-insensitive regular expressions matched against the{' '}
        {identifier}. An invalid pattern is skipped rather than applied.
      </Text>

      <View style={ui.button}>
        <Button title={saved ? 'Saved' : 'Save'} onPress={() => void save()} disabled={saved} />
      </View>
      {error ? <Text style={ui.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  optionLabel: { fontSize: 16 },
  selected: { color: '#4f6ef7', fontWeight: '600' },
});
