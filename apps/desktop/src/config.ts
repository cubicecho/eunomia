import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig } from '@eunomia/agent';

// Node-specific config plumbing — the server calls themselves live in
// @eunomia/agent, shared with the mobile agent.

/** Desktop-only knobs on top of the shared agent config. */
export interface DesktopConfig extends AgentConfig {
  /** Launch at login (packaged builds only). Default true. */
  autostart?: boolean;
  /**
   * The device this install registered as. Lets the agent re-key itself
   * (rotateDeviceKey) instead of registering a second device — absent in
   * configs written before that existed, which fall back to re-registering.
   */
  deviceId?: string;
  /** Name the device was registered under; shown when reconnecting. */
  deviceName?: string;
}

/**
 * Env vars win; otherwise config.json in userData:
 * {"serverUrl": ..., "apiKey": ..., "syncIntervalSeconds"?: ...,
 *  "ignoreApps"?: [regex...], "redactApps"?: [regex...], "autostart"?: bool,
 *  "deviceId"?: ..., "deviceName"?: ...}.
 * EUNOMIA_SYNC_INTERVAL_SECONDS overrides the interval in either case.
 */
export function loadConfig(dataDir: string): DesktopConfig | null {
  const env = envConfig();
  const config = env ? withLocalPrefs(env, dataDir) : fileConfig(dataDir);
  if (!config) return null;
  const envSeconds = Number(process.env.EUNOMIA_SYNC_INTERVAL_SECONDS);
  if (Number.isFinite(envSeconds) && envSeconds > 0) config.syncIntervalSeconds = envSeconds;
  return config;
}

/**
 * True when EUNOMIA_SERVER_URL + EUNOMIA_API_KEY are supplying the config: a
 * config.json written by the setup window applies to the running agent but is
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
 * is this machine's choice, made in the tray, so it still applies when they do.
 */
function withLocalPrefs(config: AgentConfig, dataDir: string): DesktopConfig {
  const raw = readConfigFile(dataDir);
  return typeof raw?.autostart === 'boolean' ? { ...config, autostart: raw.autostart } : config;
}

function readConfigFile(dataDir: string): Partial<DesktopConfig> | null {
  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as Partial<DesktopConfig>;
  } catch (error) {
    console.error(`invalid ${configPath}`, error);
    return null;
  }
}

function fileConfig(dataDir: string): DesktopConfig | null {
  const parsed = readConfigFile(dataDir);
  if (parsed) {
    if (typeof parsed.serverUrl === 'string' && typeof parsed.apiKey === 'string') {
      const config: DesktopConfig = { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
      if (typeof parsed.autostart === 'boolean') config.autostart = parsed.autostart;
      if (typeof parsed.deviceId === 'string') config.deviceId = parsed.deviceId;
      if (typeof parsed.deviceName === 'string') config.deviceName = parsed.deviceName;
      if (typeof parsed.syncIntervalSeconds === 'number') {
        config.syncIntervalSeconds = parsed.syncIntervalSeconds;
      }
      if (isStringArray(parsed.ignoreApps)) config.ignoreApps = parsed.ignoreApps;
      if (isStringArray(parsed.redactApps)) config.redactApps = parsed.redactApps;
      return config;
    }
  }
  return null;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * Persists the tray's launch-at-login choice, leaving the rest of config.json
 * exactly as it is — the file also holds the server connection, the device
 * identity, and privacy rules this toggle has no business rewriting. Writes a
 * file holding only this when there isn't one yet (env-configured installs).
 */
export function saveAutostart(dataDir: string, autostart: boolean): void {
  const configPath = join(dataDir, 'config.json');
  const existing = readConfigFile(dataDir) ?? {};
  writeFileSync(configPath, `${JSON.stringify({ ...existing, autostart }, null, 2)}\n`);
}

export function writeAgentConfig(dataDir: string, config: DesktopConfig): string {
  const configPath = join(dataDir, 'config.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

const PLATFORMS: Record<string, string> = {
  win32: 'windows',
  darwin: 'macos',
  linux: 'linux',
};

export function platformName(): string {
  return PLATFORMS[process.platform] ?? 'linux';
}
