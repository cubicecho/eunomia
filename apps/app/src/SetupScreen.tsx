import {
  type AgentCredential,
  type DeviceCode,
  normalizeServerUrl,
  provisionDevice,
  requestMagicLink,
  type StoredConfig,
  verifyMagicLink,
} from '@eunomia/agent';
import { useEffect, useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import type { AgentHost } from './host/index.ts';
import { Screen, ui } from './ui.tsx';

// Onboarding, on every shell: server URL + device name, then a sign-in as the
// person this device records for. When the server's provider lets agents sign
// in through it, "Sign in with …" runs its device flow: the provider's page
// opens in the system browser, the person approves eunomia there, and the
// agent gets a token it keeps fresh. Otherwise (or by choice) a sign-in link by
// email, traded for a session. Then provisionDevice puts this machine on the
// server and the host writes config.json. One flow, shared with the
// `--provision` CLI — down to keeping an existing device rather than
// registering a twin.
//
// The same screen reconnects an install that already has a config (status →
// "Change server / sign in again…"), and one whose sign-in lapsed. Which of
// keep-or-register that means is provisionDevice's call, from the saved config
// passed as `existing`; this screen only collects the answers and saves what
// comes back.

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

/** How long typing in the server URL settles before asking it about device sign-in. */
const PROVIDER_LOOKUP_DELAY_MS = 600;

type Stage = 'details' | 'link' | 'device';

export function SetupScreen({ host, current = null, onDone, onCancel }: Props) {
  const reconfigure = current !== null;
  const [serverUrl, setServerUrl] = useState(current?.serverUrl ?? 'http://localhost:4000');
  const [email, setEmail] = useState('');
  const [deviceName, setDeviceName] = useState(current?.deviceName ?? host.defaultDeviceName);
  const [pastedLink, setPastedLink] = useState('');
  const [stage, setStage] = useState<Stage>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCode | null>(null);

  // Whether the server as typed lets agents sign in through its provider. Any
  // failure (a half-typed URL, an older server) just means no button.
  const canDeviceSignIn = host.capabilities.deviceSignIn && host.deviceSignInProvider !== undefined;
  useEffect(() => {
    setProvider(null);
    const url = serverUrl.trim();
    if (!canDeviceSignIn || !/^https?:\/\/./.test(url)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      host.deviceSignInProvider?.(normalizeServerUrl(url)).then(
        (name) => {
          if (!cancelled) setProvider(name);
        },
        () => {},
      );
    }, PROVIDER_LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [serverUrl, canDeviceSignIn, host]);

  // Leaving mid-sign-in stops the shell polling for a token nobody will use.
  useEffect(() => () => void host.cancelDeviceSignIn?.(), [host]);

  const finish = async (credential: AgentCredential): Promise<void> => {
    // Whatever is on disk decides keep-or-register; privacy rules and the
    // sync interval on it are the user's and carry across a reconnect. Read
    // as saved, so a config whose sign-in can no longer start an agent still
    // hands over its device and settings.
    const existing = current ?? (await host.loadSavedConfig());
    const name = deviceName.trim();
    const provisioned = await provisionDevice({
      serverUrl,
      credential,
      name,
      platform: host.platform,
      existing,
    });
    const config: StoredConfig = {
      ...existing,
      serverUrl: provisioned.serverUrl,
      // Recorded so setting this device up again keeps it rather than
      // stranding its history on a device nothing uploads to any more.
      deviceId: provisioned.deviceId,
      credential,
      deviceName: name,
    };
    await host.saveConfig(config);
    onDone(config);
  };

  /** A sign-in link's token, traded for a session the agent keeps. */
  const finishWithLink = async (tokenOrLink: string): Promise<void> => {
    const url = normalizeServerUrl(serverUrl);
    await finish({ kind: 'session', token: await verifyMagicLink(url, tokenOrLink) });
  };

  const submitDetails = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const token = await requestMagicLink(
        normalizeServerUrl(serverUrl),
        email.trim().toLowerCase(),
      );
      if (token) await finishWithLink(token);
      else setStage('link');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const signInWithProvider = async (): Promise<void> => {
    if (!host.startDeviceSignIn || !host.finishDeviceSignIn) return;
    setBusy(true);
    setError('');
    try {
      setDeviceCode(await host.startDeviceSignIn(normalizeServerUrl(serverUrl)));
      setStage('device');
      await finish(await host.finishDeviceSignIn());
    } catch (err) {
      setStage('details');
      setError(errorMessage(err));
    } finally {
      setDeviceCode(null);
      setBusy(false);
    }
  };

  const cancelDeviceSignIn = (): void => {
    void host.cancelDeviceSignIn?.();
  };

  const submitLink = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await finishWithLink(pastedLink.trim());
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
          ? 'Sign in again, or move this device to another server.'
          : 'Connect this device to your eunomia server.'
      }
      onBack={onCancel}
    >
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
          <Text style={ui.label}>Device name</Text>
          <TextInput style={ui.input} value={deviceName} onChangeText={setDeviceName} />
          {provider ? (
            <>
              <View style={ui.button}>
                <Button
                  title={`Sign in with ${provider}`}
                  onPress={() => void signInWithProvider()}
                  disabled={busy || !deviceName.trim()}
                />
              </View>
              <Text style={ui.sub}>Or get a sign-in link by email:</Text>
            </>
          ) : null}
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
      ) : stage === 'device' && deviceCode ? (
        <>
          <Text style={ui.sub}>
            Approve eunomia in the {deviceCode.providerName} page that opened in your browser, and
            check it shows this code:
          </Text>
          <Text style={ui.code} selectable>
            {deviceCode.userCode}
          </Text>
          <Text style={ui.sub}>If no page opened, go to:</Text>
          <Text style={ui.sub} selectable>
            {deviceCode.verificationUriComplete ?? deviceCode.verificationUri}
          </Text>
          <Text style={ui.sub}>Waiting for you to approve it…</Text>
          <View style={ui.button}>
            <Button title="Cancel" onPress={cancelDeviceSignIn} />
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
