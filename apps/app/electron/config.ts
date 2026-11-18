import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AgentCredential,
  type LocalApiConfig,
  parseConfigText,
  parseLocalApiConfig,
  parseSavedConfigText,
  patchConfigText,
  type SavedConfig,
  type StoredConfig,
  serializeConfig,
} from '@eunomia/agent';

// Node-specific config plumbing. What a config.json may contain, and how it is
// validated, lives in @eunomia/agent — shared with the Android agent, which
// writes the same file into its document directory.

const configPath = (dataDir: string): string => join(dataDir, 'config.json');

/**
 * config.json in userData:
 * {"serverUrl": ..., "deviceId": ..., "credential": {...}, "deviceName"?: ...,
 *  "syncIntervalSeconds"?: ..., "ignoreApps"?: [regex...], "redactApps"?: [regex...],
 *  "captureLevel"?: "app" | "context" | "title", "autostart"?: bool,
 *  "logRetentionDays"?: number,
 *  "localApi"?: {"enabled"?: bool, "port"?: number, "activityWatch"?: bool}}.
 * EUNOMIA_SYNC_INTERVAL_SECONDS overrides the interval. There is no
 * environment for the connection itself: an agent signs in as its person, in
 * the setup window or with --provision, and keeps what it signed in with here.
 */
export function loadConfig(dataDir: string): StoredConfig | null {
  const config = parseConfigText(readRaw(dataDir), configPath(dataDir));
  if (!config) return null;
  const envSeconds = Number(process.env.EUNOMIA_SYNC_INTERVAL_SECONDS);
  if (Number.isFinite(envSeconds) && envSeconds > 0) config.syncIntervalSeconds = envSeconds;
  return config;
}

/** What config.json holds even when it can't start an agent (see SavedConfig). */
export function loadSavedConfig(dataDir: string): SavedConfig | null {
  return parseSavedConfigText(readRaw(dataDir));
}

/**
 * Writes a refreshed sign-in into config.json, leaving everything else in the
 * file as it is.
 */
export function saveCredential(dataDir: string, credential: AgentCredential): void {
  writeFileSync(configPath(dataDir), patchConfigText(readRaw(dataDir), { credential }));
}

/**
 * The local API settings, read even when there is no server connection: an
 * agent that isn't set up yet still samples, and still takes reports.
 */
export function loadLocalApiConfig(dataDir: string): LocalApiConfig | undefined {
  const raw = readRaw(dataDir);
  if (raw === null) return undefined;
  try {
    return parseLocalApiConfig((JSON.parse(raw) as { localApi?: unknown }).localApi);
  } catch {
    return undefined;
  }
}

const readRaw = (dataDir: string): string | null => {
  const path = configPath(dataDir);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

/**
 * Persists the launch-at-login choice, leaving the rest of config.json exactly
 * as it is — the file also holds the server connection, the device identity,
 * and privacy rules this toggle has no business rewriting. Writes a file
 * holding only this when there isn't one yet.
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
