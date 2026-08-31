import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentConfig,
  parseConfigText,
  patchConfigText,
  type StoredConfig,
  serializeConfig,
} from '@eunomia/agent';

// Node-specific config plumbing. What a config.json may contain, and how it is
// validated, lives in @eunomia/agent — shared with the Android agent, which
// writes the same file into its document directory.

const configPath = (dataDir: string): string => join(dataDir, 'config.json');

/**
 * Env vars win; otherwise config.json in userData:
 * {"serverUrl": ..., "apiKey": ..., "syncIntervalSeconds"?: ...,
 *  "ignoreApps"?: [regex...], "redactApps"?: [regex...], "autostart"?: bool,
 *  "deviceId"?: ..., "deviceName"?: ...}.
 * EUNOMIA_SYNC_INTERVAL_SECONDS overrides the interval in either case.
 */
export function loadConfig(dataDir: string): StoredConfig | null {
  const env = envConfig();
  const config = env ? withLocalPrefs(env, dataDir) : readConfig(dataDir);
  if (!config) return null;
  const envSeconds = Number(process.env.EUNOMIA_SYNC_INTERVAL_SECONDS);
  if (Number.isFinite(envSeconds) && envSeconds > 0) config.syncIntervalSeconds = envSeconds;
  return config;
}

/**
 * True when EUNOMIA_SERVER_URL + EUNOMIA_API_KEY are supplying the config: a
 * config.json written by the setup screen applies to the running agent but is
 * ignored the next time it starts, so the UI says so.
 */
export function isEnvConfigured(): boolean {
  return envConfig() !== null;
}

function envConfig(): AgentConfig | null {
  const envUrl = process.env.EUNOMIA_SERVER_URL;
  const envKey = process.env.EUNOMIA_API_KEY;
  if (envUrl && envKey) return { serverUrl: envUrl, apiKey: envKey };
  return null;
}

/**
 * Env vars supply the server connection, not the whole config: launch at login
 * is this machine's choice, made in the UI, so it still applies when they do.
 */
function withLocalPrefs(config: AgentConfig, dataDir: string): StoredConfig {
  const raw = readRaw(dataDir);
  if (raw === null) return config;
  try {
    const parsed = JSON.parse(raw) as { autostart?: unknown };
    return typeof parsed.autostart === 'boolean'
      ? { ...config, autostart: parsed.autostart }
      : config;
  } catch {
    return config;
  }
}

const readRaw = (dataDir: string): string | null => {
  const path = configPath(dataDir);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

function readConfig(dataDir: string): StoredConfig | null {
  return parseConfigText(readRaw(dataDir), configPath(dataDir));
}

/**
 * Persists the launch-at-login choice, leaving the rest of config.json exactly
 * as it is — the file also holds the server connection, the device identity,
 * and privacy rules this toggle has no business rewriting. Writes a file
 * holding only this when there isn't one yet (env-configured installs).
 */
export function saveAutostart(dataDir: string, autostart: boolean): void {
  writeFileSync(configPath(dataDir), patchConfigText(readRaw(dataDir), { autostart }));
}

export function writeAgentConfig(dataDir: string, config: StoredConfig): string {
  const path = configPath(dataDir);
  writeFileSync(path, serializeConfig(config));
  return path;
}

const PLATFORMS: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

export function platformName(): string {
  return PLATFORMS[process.platform] ?? 'linux';
}
