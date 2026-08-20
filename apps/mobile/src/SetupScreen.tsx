import {
  type AgentConfig,
  registerDevice,
  requestMagicLink,
  signOut,
  verifyMagicLink,
} from '@eunomia/agent';
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { writeConfig } from './store.ts';

// Mobile counterpart of the desktop onboarding window: server URL + email +
// device name, magic-link sign-in, then registerDevice writes config.json and
// syncing starts — same flow, same shared API calls.

interface Props {
  onDone: (config: AgentConfig) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SetupScreen({ onDone }: Props) {
  const [serverUrl, setServerUrl] = useState('http://localhost:4000');
  const [email, setEmail] = useState('');
  const [deviceName, setDeviceName] = useState('Android phone');
  const [pastedLink, setPastedLink] = useState('');
  const [stage, setStage] = useState<'details' | 'link'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finish = async (tokenOrLink: string): Promise<void> => {
    const url = serverUrl.trim().replace(/\/+$/, '');
    const session = await verifyMagicLink(url, tokenOrLink);
    const { apiKey } = await registerDevice(url, session, deviceName.trim(), 'android');
    await signOut(url, session);
    const config: AgentConfig = { serverUrl: url, apiKey };
    writeConfig(config);
    onDone(config);
  };

  const submitDetails = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const url = serverUrl.trim().replace(/\/+$/, '');
      const token = await requestMagicLink(url, email.trim().toLowerCase());
      if (token) await finish(token);
      else setStage('link');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitLink = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await finish(pastedLink.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Set up eunomia</Text>
      <Text style={styles.sub}>Connect this device to your eunomia server.</Text>

      {stage === 'details' ? (
        <>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            keyboardType="url"
          />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.label}>Device name</Text>
          <TextInput style={styles.input} value={deviceName} onChangeText={setDeviceName} />
          <View style={styles.button}>
            <Button
              title={busy ? 'Signing in…' : 'Sign in & register device'}
              onPress={() => void submitDetails()}
              disabled={busy || !serverUrl.trim() || !email.trim() || !deviceName.trim()}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sub}>
            A sign-in link was sent to {email.trim().toLowerCase()}. Paste it below.
          </Text>
          <Text style={styles.label}>Sign-in link (or token)</Text>
          <TextInput
            style={styles.input}
            value={pastedLink}
            onChangeText={setPastedLink}
            placeholder="http://…/?token=…"
            autoCapitalize="none"
          />
          <View style={styles.button}>
            <Button
              title={busy ? 'Verifying…' : 'Verify & register device'}
              onPress={() => void submitLink()}
              disabled={busy || !pastedLink.trim()}
            />
          </View>
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 28 },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 4 },
  sub: { opacity: 0.7, marginBottom: 20 },
  label: { fontWeight: '600', marginTop: 14, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  button: { marginTop: 22 },
  error: { color: '#d33', marginTop: 12 },
});
