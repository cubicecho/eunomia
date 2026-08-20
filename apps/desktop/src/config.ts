import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig } from '@eunomia/agent';

// Node-specific config plumbing — the server calls themselves live in
// @eunomia/agent, shared with the mobile agent.

/** Env vars win; otherwise config.json in userData: {"serverUrl": ..., "apiKey": ...}. */
export function loadConfig(dataDir: string): AgentConfig | null {
  const envUrl = process.env.EUNOMIA_SERVER_URL;
  const envKey = process.env.EUNOMIA_API_KEY;
  if (envUrl && envKey) return { serverUrl: envUrl, apiKey: envKey };

  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<AgentConfig>;
    if (typeof parsed.serverUrl === 'string' && typeof parsed.apiKey === 'string') {
      return { serverUrl: parsed.serverUrl, apiKey: parsed.apiKey };
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
