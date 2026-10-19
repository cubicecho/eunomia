import type { Ping } from './ping.ts';
import type { Sample } from './sampler.ts';

// What other capture sources on this machine say about it right now: a browser
// extension naming the focused tab, a Wayland watcher naming the focused
// window, an idle monitor. They report to the agent over its local API (see
// local-api.ts), never to the server, and what they say is folded into the
// agent's own sample before the ping exists — so the privacy sanitizer, the
// pause and the outbox treat it exactly like something the agent read itself.
//
// Every report is a statement about the present with an expiry, the way an
// ActivityWatch heartbeat carries a pulsetime: a source that goes quiet stops
// counting on its own, and nothing here ever backfills the past.

/** A report's lifetime when it doesn't give one. */
export const DEFAULT_REPORT_TTL_SECONDS = 15;
/** No report outlives this, whatever it asks for. */
export const MAX_REPORT_TTL_SECONDS = 300;

/** The foreground window, from a source that can see it when the agent can't (Wayland). */
export interface WindowReport {
  kind: 'window';
  app: string;
  title?: string | null;
}

/** Whether the person is at the machine, from a source that knows better than the platform. */
export interface AfkReport {
  kind: 'afk';
  afk: boolean;
  /** When the current state began (last input, for afk). Defaults to the report time. */
  since?: number;
}

/** The focused tab of a browser, from its extension. */
export interface BrowserReport {
  kind: 'browser';
  /** The tab's address. Only the hostname is ever used. */
  url?: string | null;
  /** The tab's title, used only when the window title is unreadable. */
  title?: string | null;
  /** A private/incognito window: nothing about the tab is kept. */
  incognito?: boolean;
  /** Browser family ("firefox", "chrome", …), to pick the right report when several run. */
  browser?: string | null;
  /** False when the browser knows none of its windows has focus. */
  focused?: boolean;
}

export type LocalReport = WindowReport | AfkReport | BrowserReport;

interface Held<T extends LocalReport> {
  report: T;
  source: string;
  at: number;
  expiresAt: number;
}

export interface FeedSource {
  source: string;
  kind: LocalReport['kind'];
  at: number;
  expiresAt: number;
}

export interface LocalFeed {
  /**
   * Holds a report until it expires. `at` is when it was true (default now);
   * a report already expired, or older than the one held, is dropped.
   */
  report(
    report: LocalReport,
    options?: { source?: string; at?: number; ttlSeconds?: number },
  ): void;
  /**
   * The agent's sample with what the feed knows laid over it: a fresh window
   * report replaces the app and title, a fresh afk report replaces the idle
   * time. A native read that throws is forgiven while a window report covers
   * for it — that is the Wayland case, where the platform cannot answer at all.
   */
  sample(read: () => Sample): Sample;
  /** A ping with the focused browser tab's site merged in, before it is sanitized. */
  enrich(ping: Ping): Ping;
  /** Fresh sources, newest first, for the tray and the status route. */
  sources(): FeedSource[];
}

/** Apps that are browsers, by executable name. Shared with the desktop shell's own URL read. */
export const BROWSER_APP =
  /^(chrome|chromium|google-chrome|msedge|microsoft-edge|firefox|librewolf|waterfox|zen|brave|opera|vivaldi|arc|safari)/i;

/** The hostname of a URL, lowercased, or null for anything that has none. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const clampTtl = (seconds: number | undefined): number => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_REPORT_TTL_SECONDS;
  }
  return Math.min(seconds, MAX_REPORT_TTL_SECONDS);
};

export function createLocalFeed(options: { now?: () => number } = {}): LocalFeed {
  const now = options.now ?? Date.now;
  // One held report per source and kind: a second extension or watcher is a
  // second voice, not a correction of the first.
  const held = new Map<string, Held<LocalReport>>();

  const fresh = <K extends LocalReport['kind']>(
    kind: K,
  ): Held<Extract<LocalReport, { kind: K }>>[] => {
    const at = now();
    const out: Held<Extract<LocalReport, { kind: K }>>[] = [];
    for (const [key, entry] of held) {
      if (entry.expiresAt <= at) {
        held.delete(key);
        continue;
      }
      if (entry.report.kind === kind) out.push(entry as Held<Extract<LocalReport, { kind: K }>>);
    }
    return out.sort((a, b) => b.at - a.at);
  };

  return {
    report(report, { source = 'local', at = now(), ttlSeconds } = {}) {
      const expiresAt = at + clampTtl(ttlSeconds) * 1000;
      if (expiresAt <= now()) return;
      const key = `${source}\n${report.kind}`;
      const previous = held.get(key);
      // ActivityWatch's web watcher re-sends the tab it is leaving a moment
      // before the one it is entering; time order, not arrival order, decides.
      if (previous && previous.at > at && previous.expiresAt > now()) return;
      held.set(key, { report, source, at, expiresAt });
    },

    sample(read) {
      const window = fresh('window')[0];
      let sample: Sample;
      try {
        sample = read();
      } catch (error) {
        if (!window) throw error;
        sample = { app: null, title: null, idleSeconds: 0 };
      }
      if (window) {
        sample = { ...sample, app: window.report.app, title: window.report.title ?? null };
      }
      const afk = fresh('afk')[0];
      if (afk) {
        const since = afk.report.since ?? afk.at;
        sample = {
          ...sample,
          idleSeconds: afk.report.afk ? Math.max(0, Math.round((now() - since) / 1000)) : 0,
        };
      }
      return sample;
    },

    enrich(ping) {
      if (!ping.app || !BROWSER_APP.test(ping.app)) return ping;
      const reports = fresh('browser').filter((entry) => entry.report.focused !== false);
      // With two browsers reporting, the one named like the focused app wins;
      // otherwise the most recent report does.
      const app = ping.app.toLowerCase();
      const named = reports.find((entry) => {
        const family = entry.report.browser?.toLowerCase();
        return family ? app.includes(family) : false;
      });
      const chosen = named ?? reports[0];
      if (!chosen) return ping;
      const tab = chosen.report;
      if (tab.incognito) return { ...ping, title: null, context: null };
      return {
        ...ping,
        context: hostOf(tab.url) ?? ping.context,
        title: ping.title ?? tab.title ?? null,
      };
    },

    sources() {
      const at = now();
      const out: FeedSource[] = [];
      for (const [key, entry] of held) {
        if (entry.expiresAt <= at) {
          held.delete(key);
          continue;
        }
        out.push({
          source: entry.source,
          kind: entry.report.kind,
          at: entry.at,
          expiresAt: entry.expiresAt,
        });
      }
      return out.sort((a, b) => b.at - a.at);
    },
  };
}

/**
 * Reads a report out of untrusted JSON, or explains why not. The local API
 * accepts anything a script can send, so nothing is assumed.
 */
export function parseReport(raw: unknown): LocalReport | string {
  if (!raw || typeof raw !== 'object') return 'a report must be an object';
  const value = raw as Record<string, unknown>;
  const optionalString = (key: string): string | null | undefined | false => {
    const field = value[key];
    if (field === undefined || field === null) return field as null | undefined;
    return typeof field === 'string' ? field : false;
  };
  switch (value.kind) {
    case 'window': {
      const title = optionalString('title');
      if (typeof value.app !== 'string' || value.app.trim() === '') return 'window.app is required';
      if (title === false) return 'window.title must be a string';
      return { kind: 'window', app: value.app.trim(), title: title ?? null };
    }
    case 'afk': {
      if (typeof value.afk !== 'boolean') return 'afk.afk must be true or false';
      const since = value.since === undefined ? undefined : Date.parse(String(value.since));
      if (since !== undefined && Number.isNaN(since)) return 'afk.since must be an ISO timestamp';
      return { kind: 'afk', afk: value.afk, ...(since === undefined ? {} : { since }) };
    }
    case 'browser': {
      const url = optionalString('url');
      const title = optionalString('title');
      const browser = optionalString('browser');
      if (url === false || title === false || browser === false) {
        return 'browser.url, title and browser must be strings';
      }
      if (value.incognito !== undefined && typeof value.incognito !== 'boolean') {
        return 'browser.incognito must be true or false';
      }
      if (value.focused !== undefined && typeof value.focused !== 'boolean') {
        return 'browser.focused must be true or false';
      }
      return {
        kind: 'browser',
        url: url ?? null,
        title: title ?? null,
        browser: browser ?? null,
        incognito: value.incognito === true,
        focused: value.focused !== false,
      };
    }
    default:
      return 'kind must be "window", "afk" or "browser"';
  }
}
