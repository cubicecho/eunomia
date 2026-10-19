import { browserFamily, buildReport, eventsUrl, parsePort, REPORT_TTL_SECONDS } from './report.js';

// Reports the focused tab to the eunomia desktop agent on this machine — not
// to the server: the agent already counts the browser's time from the
// foreground window, and this only says which site that time was on. Sending
// to the server as well would count it twice.

const api = globalThis.browser ?? globalThis.chrome;
const family = browserFamily({ runtime: api.runtime, navigator: globalThis.navigator });

const DEFAULTS = { token: '', port: 5600, sendTitles: true };

async function settings() {
  return { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) };
}

/** Remembered for the options page: did the last report get through? */
async function remember(status) {
  await api.storage.local.set({ lastStatus: status, lastAt: Date.now() });
}

async function send(report) {
  const { token, port } = await settings();
  if (!token) {
    await remember('No token yet. Paste it on this page.');
    return;
  }
  try {
    const response = await fetch(eventsUrl(parsePort(port)), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...report,
        source: `extension-${family}`,
        ttlSeconds: REPORT_TTL_SECONDS,
      }),
    });
    await remember(
      response.ok
        ? 'Connected'
        : response.status === 401
          ? 'The agent refused the token. Copy it again from the tray.'
          : `The agent answered HTTP ${response.status}`,
    );
  } catch {
    await remember('Agent not reachable. Is the desktop agent running?');
  }
}

/** The tab in front of the user right now, and whether a browser window has focus at all. */
async function reportFocused() {
  const { sendTitles } = await settings();
  let window = null;
  try {
    window = await api.windows.getLastFocused({ populate: false });
  } catch {
    window = null;
  }
  const focused = Boolean(window?.focused);
  const [tab] = window ? await api.tabs.query({ active: true, windowId: window.id }) : [];
  await send(buildReport(tab, { focused, sendTitles, browser: family }));
}

// Every way the focused tab can change, plus a heartbeat so a long read on
// one page doesn't expire.
api.tabs.onActivated.addListener(() => void reportFocused());
api.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url !== undefined || change.title !== undefined)) void reportFocused();
});
api.windows.onFocusChanged.addListener(() => void reportFocused());
api.alarms.create('heartbeat', { periodInMinutes: 0.5 });
api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') void reportFocused();
});
api.runtime.onStartup.addListener(() => void reportFocused());
api.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void api.runtime.openOptionsPage();
});
api.storage.onChanged.addListener((changes) => {
  if (changes.token || changes.port) void reportFocused();
});
