import type { AgentConfig } from './api.ts';

// The on-disk agent config, parsed and serialized. Pure data — no IO, no node,
// no electron, no react-native. Every shell reads the same `config.json` shape
// out of its own data directory (userData on desktop, the document directory
// on Android) and hands the text here, so the two agents cannot drift in what
// they accept.

/** Everything a shell may persist, beyond the server connection itself. */
export interface StoredConfig extends AgentConfig {
  /**
   * The device this install registered as. Lets the agent re-key itself
   * (rotateDeviceKey) instead of registering a second device — absent in
   * configs written before that existed, which fall back to re-registering.
   */
  deviceId?: string;
  /** Name the device was registered under; shown when reconnecting. */
  deviceName?: string;
  /** Desktop: launch at login (packaged builds only). Default true. */
  autostart?: boolean;
  /** Android: keep syncing when the app is backgrounded (WorkManager). */
  backgroundSync?: boolean;
  /** Android: hold a foreground service so the OS can't force-stop the agent. */
  keepAlive?: boolean;
  /**
   * Android: record only apps with a launcher entry, dropping the launcher
   * itself, system UI, permission dialogs and the rest of what the usage log
   * calls a foreground activity. Defaults to on.
   */
  launchableAppsOnly?: boolean;
  /** Privacy: pings from a matching app are dropped entirely. */
  ignoreApps?: string[];
  /** Privacy: matching apps keep their time but lose title and context. */
  redactApps?: string[];
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const BOOLEAN_KEYS = [
  'autostart',
  'backgroundSync',
  'keepAlive',
  'launchableAppsOnly',
] as const satisfies readonly (keyof StoredConfig)[];

const STRING_KEYS = ['deviceId', 'deviceName'] as const satisfies readonly (keyof StoredConfig)[];

/**
 * Parses `config.json`. Returns null unless the server connection is complete:
 * a config without both halves cannot start an agent, and treating it as
 * absent is what sends the shell to its setup screen.
 *
 * Unknown keys are dropped rather than carried, so a field a newer build wrote
 * cannot survive a downgrade in a shape this build would then re-serialize.
 */
export function parseConfig(raw: unknown): StoredConfig | null {
  const parsed = raw as Partial<StoredConfig> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.serverUrl !== 'string' || typeof parsed.apiKey !== 'string') return null;

  const config: StoredConfig = { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
  for (const key of STRING_KEYS) {
    const value = parsed[key];
    if (typeof value === 'string') config[key] = value;
  }
  for (const key of BOOLEAN_KEYS) {
    const value = parsed[key];
    if (typeof value === 'boolean') config[key] = value;
  }
  if (typeof parsed.syncIntervalSeconds === 'number') {
    config.syncIntervalSeconds = parsed.syncIntervalSeconds;
  }
  if (isStringArray(parsed.ignoreApps)) config.ignoreApps = parsed.ignoreApps;
  if (isStringArray(parsed.redactApps)) config.redactApps = parsed.redactApps;
  return config;
}

/** Parses config text, tolerating an unreadable file the way a missing one is. */
export function parseConfigText(text: string | null, label = 'config.json'): StoredConfig | null {
  if (text === null) return null;
  try {
    return parseConfig(JSON.parse(text));
  } catch (error) {
    console.error(`invalid ${label}`, error);
    return null;
  }
}

/** The bytes a shell writes back. Trailing newline: the file is hand-editable. */
export function serializeConfig(config: StoredConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Applies a patch to config text without validating what is already there.
 *
 * A toggle like launch-at-login has no business rewriting the server
 * connection, the device identity, or the privacy rules that share the file —
 * and on an env-configured install there may be no valid connection in it to
 * preserve. So this merges over the raw object rather than a parsed one, and
 * treats an unreadable or absent file as an empty one.
 */
export function patchConfigText(text: string | null, patch: Partial<StoredConfig>): string {
  let existing: Record<string, unknown> = {};
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') existing = parsed as Record<string, unknown>;
    } catch (error) {
      console.error('invalid config.json — replacing it', error);
    }
  }
  return `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`;
}
