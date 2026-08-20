import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig } from '@eunomia/agent';

// Node-specific config plumbing — the server calls themselves live in
// @eunomia/agent, shared with the mobile agent.

/**
 * Env vars win; otherwise config.json in userData:
 * {"serverUrl": ..., "apiKey": ..., "syncIntervalSeconds"?: ...}.
 * EUNOMIA_SYNC_INTERVAL_SECONDS overrides the interval in either case.
 */
export function loadConfig(dataDir: string): AgentConfig | null {
  const config = envConfig() ?? fileConfig(dataDir);
  if (!config) return null;
  const envSeconds = Number(process.env.EUNOMIA_SYNC_INTERVAL_SECONDS);
  if (Number.isFinite(envSeconds) && envSeconds > 0) config.syncIntervalSeconds = envSeconds;
  return config;
}

function envConfig(): AgentConfig | null {
  const envUrl = process.env.EUNOMIA_SERVER_URL;
  const envKey = process.env.EUNOMIA_API_KEY;
  if (envUrl && envKey) return { serverUrl: envUrl, apiKey: envKey };
  return null;
}

function fileConfig(dataDir: string): AgentConfig | null {
  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AgentConfig>;
    if (typeof parsed.serverUrl === 'string' && typeof parsed.apiKey === 'string') {
      const config: AgentConfig = { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
      if (typeof parsed.syncIntervalSeconds === 'number') {
        config.syncIntervalSeconds = parsed.syncIntervalSeconds;
      }
      return config;
    }
  } catch (error) {
    console.error(`invalid ${configPath}`, error);
  }
  return null;
}

export function writeAgentConfig(dataDir: string, config: AgentConfig): string {
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
