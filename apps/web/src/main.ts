import {
  type ActivityRow,
  type CategoryDaySummary,
  fetchActivities,
  fetchSummary,
  GraphQLError,
  getToken,
  requestMagicLink,
  signOut,
  verifyMagicLink,
} from './api.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('missing #app root element');
const app = root;

const FALLBACK_COLOR = '#8b949e';
const UNCATEGORIZED = 'Uncategorized';

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Default range: the last 7 days, inclusive of today. */
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  to.setUTCHours(24, 0, 0, 0);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function renderSignIn(error?: string): void {
  app.replaceChildren();
  const form = el('form', 'signin');
  form.append(el('h1', undefined, 'eunomia'));
  const email = el('input');
  email.type = 'email';
  email.placeholder = 'email';
  email.required = true;
  const submit = el('button', undefined, 'Send sign-in link');
  form.append(email, submit);
  if (error) form.append(el('p', 'error', error));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const token = await requestMagicLink(email.value);
      if (token) {
        // UNSAFE_LOCAL_NETWORK: the server handed the token straight back.
        await verifyMagicLink(token);
        await renderDashboard();
        return;
      }
      renderLinkSent(email.value);
    } catch (err) {
      renderSignIn(err instanceof GraphQLError ? err.message : 'sign-in failed');
    }
  });
  app.append(form);
}

function renderLinkSent(email: string): void {
  app.replaceChildren();
  const box = el('div', 'signin');
  box.append(el('h1', undefined, 'eunomia'));
  box.append(el('p', undefined, `Sign-in link sent to ${email} — click it to finish signing in.`));
  const back = el('button', 'ghost', 'Use a different email');
  back.addEventListener('click', () => renderSignIn());
  box.append(back);
  app.append(box);
}

interface CategoryTotal {
  name: string;
  color: string;
  seconds: number;
}

function categoryTotals(summary: CategoryDaySummary[]): CategoryTotal[] {
  const byCategory = new Map<string, CategoryTotal>();
  for (const row of summary) {
    const key = row.categoryId ?? UNCATEGORIZED;
    const entry = byCategory.get(key) ?? {
      name: row.name ?? UNCATEGORIZED,
      color: row.color ?? FALLBACK_COLOR,
      seconds: 0,
    };
    entry.seconds += row.seconds;
    byCategory.set(key, entry);
  }
  return [...byCategory.values()].sort((a, b) => b.seconds - a.seconds);
}

function topApps(rows: ActivityRow[], count = 10): CategoryTotal[] {
  // Context (site, project, book) subdivides an app into separate bars.
  const byApp = new Map<string, number>();
  for (const row of rows) {
    const key = row.context ? `${row.app} · ${row.context}` : row.app;
    byApp.set(key, (byApp.get(key) ?? 0) + row.activeSeconds);
  }
  return [...byApp.entries()]
    .map(([name, seconds]) => ({ name, color: FALLBACK_COLOR, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, count);
}

function renderBars(title: string, totals: CategoryTotal[]): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, title));
  if (totals.length === 0) {
    section.append(el('p', 'empty', 'No activity in this range.'));
    return section;
  }
  const max = Math.max(...totals.map((t) => t.seconds));
  for (const total of totals) {
    const row = el('div', 'bar-row');
    row.append(el('span', 'bar-label', total.name));
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${Math.max(2, (total.seconds / max) * 100)}%`;
    fill.style.background = total.color;
    track.append(fill);
    row.append(track, el('span', 'bar-value', formatSeconds(total.seconds)));
    section.append(row);
  }
  return section;
}

function renderDays(summary: CategoryDaySummary[]): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, 'By day'));
  const days = new Map<string, CategoryDaySummary[]>();
  for (const row of summary) {
    const list = days.get(row.day) ?? [];
    list.push(row);
    days.set(row.day, list);
  }
  if (days.size === 0) {
    section.append(el('p', 'empty', 'No activity in this range.'));
    return section;
  }
  for (const [day, rows] of [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const dayTotal = rows.reduce((sum, r) => sum + r.seconds, 0);
    const header = el('div', 'day-header');
    header.append(el('span', undefined, day), el('span', undefined, formatSeconds(dayTotal)));
    section.append(header);
    const stack = el('div', 'day-stack');
    for (const row of rows.slice().sort((a, b) => b.seconds - a.seconds)) {
      const chunk = el('div', 'day-chunk');
      chunk.style.flexGrow = String(row.seconds);
      chunk.style.background = row.color ?? FALLBACK_COLOR;
      chunk.title = `${row.name ?? UNCATEGORIZED}: ${formatSeconds(row.seconds)}`;
      stack.append(chunk);
    }
    section.append(stack);
  }
  return section;
}

async function renderDashboard(range = defaultRange()): Promise<void> {
  let summary: CategoryDaySummary[];
  let activities: ActivityRow[];
  try {
    [summary, activities] = await Promise.all([
      fetchSummary(range.from, range.to),
      fetchActivities(new Date(range.from).toISOString(), new Date(range.to).toISOString()),
    ]);
  } catch (error) {
    if (error instanceof GraphQLError && error.message === 'Not authenticated') {
      renderSignIn('session expired — sign in again');
      return;
    }
    throw error;
  }

  app.replaceChildren();
  const header = el('header');
  header.append(el('h1', undefined, 'eunomia'));

  const controls = el('div', 'controls');
  const fromInput = el('input');
  fromInput.type = 'date';
  fromInput.value = range.from;
  const toInput = el('input');
  toInput.type = 'date';
  toInput.value = range.to;
  const apply = el('button', undefined, 'Apply');
  apply.addEventListener('click', () => {
    if (fromInput.value && toInput.value) {
      void renderDashboard({ from: fromInput.value, to: toInput.value });
    }
  });
  const out = el('button', 'ghost', 'Sign out');
  out.addEventListener('click', async () => {
    await signOut();
    renderSignIn();
  });
  controls.append(fromInput, el('span', undefined, '→'), toInput, apply, out);
  header.append(controls);
  app.append(header);

  app.append(renderBars('By category', categoryTotals(summary)));
  app.append(renderDays(summary));
  app.append(renderBars('Top apps', topApps(activities)));
}

// Emailed magic links land here as /?token=…; consume it, then clean the URL
// so a reload doesn't retry the spent token.
async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const magicToken = params.get('token');
  if (magicToken) {
    history.replaceState(null, '', location.pathname);
    try {
      await verifyMagicLink(magicToken);
    } catch {
      renderSignIn('That sign-in link is invalid or expired — request a new one.');
      return;
    }
    await renderDashboard();
    return;
  }
  if (getToken()) {
    await renderDashboard();
  } else {
    renderSignIn();
  }
}

void boot();
