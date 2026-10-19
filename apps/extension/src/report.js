// What the extension tells the desktop agent, built from a tab — kept apart
// from background.js so it can be tested without a browser.
//
// The agent keeps only a site's hostname (see packages/agent local-feed.ts),
// so the extension never sends more than the origin in the first place: a
// path or query can hold a token, and the safest copy is the one not made.

/** The agent's local API port: ActivityWatch's, by default. */
export const DEFAULT_PORT = 5600;

/**
 * How long a report holds. Longer than the heartbeat alarm (30s in Chromium,
 * up to a minute in Firefox) so a quiet tab doesn't flicker out between beats;
 * a tab or focus change sends a fresh report at once anyway.
 */
export const REPORT_TTL_SECONDS = 90;

/** The agent's events route on `port`. */
export const eventsUrl = (port) => `http://127.0.0.1:${port}/v1/events`;

/** The agent's status route, for the options page's connection check. */
export const statusUrl = (port) => `http://127.0.0.1:${port}/v1/status`;

/** A port the user typed, or the default. */
export function parsePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

/** The scheme and host of a web address, or null for anything that isn't a web page. */
export function originOf(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}

/**
 * Which browser this is, named the way its executable usually is — the agent
 * uses it to pick the right report when two browsers both run the extension.
 * `firefox` when the Firefox-only runtime.getBrowserInfo exists; otherwise
 * read from the user-agent brands Chromium browsers publish.
 */
export function browserFamily({ runtime, navigator: nav } = {}) {
  if (typeof runtime?.getBrowserInfo === 'function') return 'firefox';
  if (nav?.brave) return 'brave';
  const brands = (nav?.userAgentData?.brands ?? []).map((entry) => entry.brand);
  if (brands.includes('Microsoft Edge')) return 'msedge';
  if (brands.includes('Opera')) return 'opera';
  if (brands.includes('Google Chrome')) return 'chrome';
  if (brands.includes('Chromium')) return 'chromium';
  return 'chrome';
}

/**
 * The report for the focused tab.
 *
 * - No tab, or no browser window focused: `focused: false`, so the agent
 *   stops using this browser's last tab the moment another app comes forward.
 * - A private/incognito tab: `incognito: true` and nothing else. The agent
 *   then strips the window title too, which would otherwise carry the page
 *   title it read from the OS.
 * - Otherwise the origin (never the path or query), and the tab title unless
 *   the user turned titles off.
 */
export function buildReport(tab, { focused, sendTitles, browser }) {
  if (!tab || !focused) return { kind: 'browser', browser, focused: false };
  if (tab.incognito) return { kind: 'browser', browser, focused: true, incognito: true };
  return {
    kind: 'browser',
    browser,
    focused: true,
    incognito: false,
    url: originOf(tab.url),
    title: sendTitles && typeof tab.title === 'string' ? tab.title : null,
  };
}
