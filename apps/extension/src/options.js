import { DEFAULT_PORT, parsePort, statusUrl } from './report.js';

const api = globalThis.browser ?? globalThis.chrome;
const field = (id) => document.getElementById(id);
const status = field('status');

async function load() {
  const stored = await api.storage.local.get({
    token: '',
    port: DEFAULT_PORT,
    sendTitles: true,
    lastStatus: '',
  });
  field('token').value = stored.token;
  field('port').value = String(stored.port);
  field('sendTitles').checked = stored.sendTitles;
  status.textContent = stored.lastStatus;
}

async function save() {
  // Firefox grants host permissions only when asked; Chromium has them from
  // install. Asked here because a click is the only time a request may be made.
  try {
    await api.permissions.request({ origins: ['http://127.0.0.1/*'] });
  } catch {
    // Already granted, or the browser doesn't ask. The check below says which.
  }
  const token = field('token').value.trim();
  const port = parsePort(field('port').value);
  await api.storage.local.set({ token, port, sendTitles: field('sendTitles').checked });
  field('port').value = String(port);

  try {
    const response = await fetch(statusUrl(port), {
      headers: { authorization: `Bearer ${token}` },
    });
    status.textContent = response.ok
      ? 'Connected to the agent.'
      : response.status === 401
        ? 'The agent refused that token.'
        : `The agent answered HTTP ${response.status}.`;
  } catch {
    status.textContent = `No agent on port ${port}. Is the desktop agent running?`;
  }
}

field('save').addEventListener('click', () => void save());
void load();
