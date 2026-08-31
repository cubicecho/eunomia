import {
  normalizeServerUrl,
  provisionDevice,
  requestMagicLink,
  type StoredConfig,
} from '@eunomia/agent';
import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import type { AgentHost } from './host/index.ts';
import { Screen, ui } from './ui.tsx';

// Onboarding, on every shell: server URL + email + device name, magic-link
// sign-in, then provisionDevice hands back a device key the host writes to its
// config.json and syncing starts. One flow, shared with the `--provision` CLI
// — down to re-keying an existing device rather than registering a twin.
//
// The same screen reconnects an install that already has a config (status →
// "Change server / API key…"). Which of register-or-re-key that means is
// provisionDevice's call, from the config passed as `existing`; this screen
// only collects the answers and saves what comes back.

interface Props {
  host: AgentHost;
  /** The live config when reconnecting; null while onboarding. */
  current?: StoredConfig | null;
  onDone: (config: StoredConfig) => void;
  /** Leaves without changing anything — absent while onboarding. */
  onCancel?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SetupScreen({ host, current = null, onDone, onCancel }: Props) {
  const reconfigure = current !== null;
  const [serverUrl, setServerUrl] = useState(current?.serverUrl ?? 'http://localhost:4000');
  const [email, setEmail] = useState('');
  const [deviceName, setDeviceName] = useState(current?.deviceName ?? host.defaultDeviceName);
  const [pastedLink, setPastedLink] = useState('');
  const [stage, setStage] = useState<'details' | 'link'>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finish = async (tokenOrLink: string): Promise<void> => {
    // Whatever is on disk decides register-or-re-key; privacy rules and the
    // sync interval on it are the user's and carry across a reconnect.
    const existing = current ?? (await host.loadConfig());
    const name = deviceName.trim();
    const provisioned = await provisionDevice({
      serverUrl,
      tokenOrLink,
      name,
      platform: host.platform,
      existing,
    });
    const config: StoredConfig = {
      ...existing,
      serverUrl: provisioned.serverUrl,
      apiKey: provisioned.apiKey,
      // Recorded so setting this device up again re-keys it rather than
      // stranding its history on a device nothing uploads to any more.
      deviceId: provisioned.deviceId,
      deviceName: name,
    };
    await host.saveConfig(config);
    onDone(config);
  };

  const submitDetails = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const token = await requestMagicLink(
        normalizeServerUrl(serverUrl),
        email.trim().toLowerCase(),
      );
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
    <Screen
      title={reconfigure ? 'Change server' : 'Set up eunomia'}
      subtitle={
        reconfigure
          ? 'Sign in to move this device to another server, or to issue it a new API key.'
          : 'Connect this device to your eunomia server.'
      }
      onBack={onCancel}
    >
      {host.envConfigured ? (
        // EUNOMIA_SERVER_URL/EUNOMIA_API_KEY are supplying the connection, so
        // what is saved here runs the agent now and is ignored the next time it
        // starts. Better said than silently discovered.
        <Text style={ui.notice}>
          This agent's server and API key come from its environment. What you set here applies until
          the agent restarts, then the environment wins again.
        </Text>
      ) : null}
      {stage === 'details' ? (
        <>
          <Text style={ui.label}>Server URL</Text>
          <TextInput
            style={ui.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={ui.label}>Email</Text>
          <TextInput
            style={ui.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Text style={ui.label}>Device name</Text>
          <TextInput style={ui.input} value={deviceName} onChangeText={setDeviceName} />
          <View style={ui.button}>
            <Button
              title={
                busy
                  ? 'Signing in…'
                  : reconfigure
                    ? 'Sign in & update'
                    : 'Sign in & register device'
              }
              onPress={() => void submitDetails()}
              disabled={busy || !serverUrl.trim() || !email.trim() || !deviceName.trim()}
            />
          </View>
        </>
      ) : (
        <>
          <Text style={ui.sub}>
            A sign-in link was sent to {email.trim().toLowerCase()}. Paste it below.
          </Text>
          <Text style={ui.label}>Sign-in link (or token)</Text>
          <TextInput
            style={ui.input}
            value={pastedLink}
            onChangeText={setPastedLink}
            placeholder="http://…/?token=…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={ui.button}>
            <Button
              title={busy ? 'Verifying…' : reconfigure ? 'Verify & update' : 'Verify & register'}
              onPress={() => void submitLink()}
              disabled={busy || !pastedLink.trim()}
            />
          </View>
        </>
      )}

      {error ? <Text style={ui.error}>{error}</Text> : null}
    </Screen>
  );
}
