import {
  applyCategoryRules,
  type AppSummaryRow,
  type Category,
  type CategoryDaySummary,
  type CategoryRule,
  type ContextRule,
  createCategory,
  createCategoryRule,
  createContextRule,
  deleteCategory,
  deleteCategoryRule,
  deleteContextRule,
  deleteDevice,
  type Device,
  fetchAppSummary,
  fetchCategories,
  fetchCategoryRules,
  fetchContextRules,
  fetchDevices,
  fetchSummary,
  GraphQLError,
  getToken,
  renameDevice,
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

/** "just now" / "5m ago" / "3h ago" / "2d ago" from an elapsed duration. */
function ago(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

interface AppTotal {
  name: string;
  seconds: number;
  // Context (site, project, book) breakdown, nested under the app's own bar.
  contexts: CategoryTotal[];
}

const MAX_CONTEXTS_PER_APP = 6;

function topApps(rows: AppSummaryRow[], count = 10): AppTotal[] {
  // Rows arrive pre-aggregated per (app, context) — group them under their app.
  const byApp = new Map<string, { seconds: number; contexts: Map<string, number> }>();
  for (const row of rows) {
    const entry = byApp.get(row.app) ?? { seconds: 0, contexts: new Map<string, number>() };
    entry.seconds += row.seconds;
    if (row.context) {
      entry.contexts.set(row.context, (entry.contexts.get(row.context) ?? 0) + row.seconds);
    }
    byApp.set(row.app, entry);
  }
  return [...byApp.entries()]
    .map(([name, entry]) => {
      const contexts = [...entry.contexts.entries()]
        .map(([context, seconds]) => ({ name: context, color: FALLBACK_COLOR, seconds }))
        .sort((a, b) => b.seconds - a.seconds)
        .slice(0, MAX_CONTEXTS_PER_APP);
      // Contextless time (plus any contexts beyond the cap) in an app that has
      // contexts shows up as a remainder row so the sub-bars sum to the app bar.
      const accounted = contexts.reduce((sum, c) => sum + c.seconds, 0);
      const leftover = entry.seconds - accounted;
      if (contexts.length > 0 && leftover >= 1) {
        contexts.push({ name: '(other)', color: FALLBACK_COLOR, seconds: leftover });
      }
      return { name, seconds: entry.seconds, contexts };
    })
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, count);
}

function barRow(total: CategoryTotal, max: number, sub = false): HTMLElement {
  const row = el('div', sub ? 'bar-row sub' : 'bar-row');
  row.append(el('span', 'bar-label', total.name));
  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  fill.style.width = `${Math.max(2, (total.seconds / max) * 100)}%`;
  fill.style.background = total.color;
  track.append(fill);
  row.append(track, el('span', 'bar-value', formatSeconds(total.seconds)));
  return row;
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
    section.append(barRow(total, max));
  }
  return section;
}

function renderTopApps(apps: AppTotal[]): HTMLElement {
  const section = el('section');
  section.append(el('h2', undefined, 'Top apps'));
  if (apps.length === 0) {
    section.append(el('p', 'empty', 'No activity in this range.'));
    return section;
  }
  // One shared scale so sub-bars stay comparable to their app bar.
  const max = Math.max(...apps.map((a) => a.seconds));
  for (const app of apps) {
    const group = el('div', app.contexts.length > 0 ? 'bar-group' : undefined);
    group.append(barRow({ name: app.name, color: FALLBACK_COLOR, seconds: app.seconds }, max));
    for (const context of app.contexts) {
      group.append(barRow(context, max, true));
    }
    section.append(group);
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

type View = 'dashboard' | 'rules' | 'devices';

function renderView(view: View): Promise<void> {
  if (view === 'rules') return renderRules();
  if (view === 'devices') return renderDevices();
  return renderDashboard();
}

function renderHeader(active: View): HTMLElement {
  const header = el('header');
  header.append(el('h1', undefined, 'eunomia'));
  const nav = el('nav');
  const tabs: [View, string][] = [
    ['dashboard', 'Dashboard'],
    ['rules', 'Categories & rules'],
    ['devices', 'Devices'],
  ];
  for (const [view, label] of tabs) {
    const tab = el('button', view === active ? 'tab active' : 'tab', label);
    tab.addEventListener('click', () => void renderView(view));
    nav.append(tab);
  }
  const out = el('button', 'ghost', 'Sign out');
  out.addEventListener('click', async () => {
    await signOut();
    renderSignIn();
  });
  header.append(nav, out);
  return header;
}

/** Awaits a view's data, falling back to the sign-in screen on auth expiry. */
async function guarded<T>(data: Promise<T>): Promise<T | null> {
  try {
    return await data;
  } catch (error) {
    if (error instanceof GraphQLError && error.message === 'Not authenticated') {
      renderSignIn('session expired — sign in again');
      return null;
    }
    throw error;
  }
}

async function renderDashboard(range = defaultRange()): Promise<void> {
  const data = await guarded(
    Promise.all([
      fetchSummary(range.from, range.to),
      fetchAppSummary(range.from, range.to),
    ]),
  );
  if (!data) return;
  const [summary, apps]: [CategoryDaySummary[], AppSummaryRow[]] = data;

  app.replaceChildren(renderHeader('dashboard'));

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
  controls.append(fromInput, el('span', undefined, '→'), toInput, apply);
  app.append(controls);

  app.append(renderBars('By category', categoryTotals(summary)));
  app.append(renderDays(summary));
  app.append(renderTopApps(topApps(apps)));
}

/** Trimmed input value, or null for the optional-pattern args. */
const orNull = (value: string): string | null => value.trim() || null;

/**
 * Runs a mutation and re-renders the view; server-side validation errors
 * (e.g. an invalid regex) land in the status line instead of blowing up.
 */
async function runAction(
  status: HTMLElement,
  action: () => Promise<unknown>,
  reload: () => Promise<void>,
): Promise<void> {
  try {
    await action();
    await reload();
  } catch (error) {
    if (error instanceof GraphQLError && error.message === 'Not authenticated') {
      renderSignIn('session expired — sign in again');
      return;
    }
    status.textContent = error instanceof GraphQLError ? error.message : 'request failed';
    status.className = 'status error';
  }
}

function patternCell(pattern: string | null): HTMLElement {
  return pattern === null ? el('span', 'muted', '—') : el('code', undefined, pattern);
}

async function renderRules(): Promise<void> {
  const data = await guarded(
    Promise.all([fetchCategories(), fetchCategoryRules(), fetchContextRules()]),
  );
  if (!data) return;
  const [cats, catRules, ctxRules]: [Category[], CategoryRule[], ContextRule[]] = data;
  const catById = new Map(cats.map((c) => [c.id, c]));
  const reload = () => renderRules();

  app.replaceChildren(renderHeader('rules'));
  const status = el('p', 'status');

  // --- categories ---
  const catSection = el('section');
  catSection.append(el('h2', undefined, 'Categories'));
  for (const cat of [...cats].sort((a, b) => a.name.localeCompare(b.name))) {
    const row = el('div', 'row');
    const swatch = el('span', 'swatch');
    swatch.style.background = cat.color ?? FALLBACK_COLOR;
    const del = el('button', 'ghost', '✕');
    del.title = 'Delete category (its activities are kept, uncategorized)';
    del.addEventListener('click', () => void runAction(status, () => deleteCategory(cat.id), reload));
    row.append(swatch, el('span', 'grow', cat.name), del);
    catSection.append(row);
  }
  {
    const form = el('form', 'row');
    const name = el('input');
    name.placeholder = 'new category';
    name.required = true;
    name.className = 'grow';
    const color = el('input');
    color.type = 'color';
    color.value = '#3fb950';
    form.append(name, color, el('button', undefined, 'Add'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void runAction(status, () => createCategory(name.value.trim(), color.value), reload);
    });
    catSection.append(form);
  }
  app.append(catSection);

  // --- category rules ---
  const ruleSection = el('section');
  ruleSection.append(el('h2', undefined, 'Category rules'));
  ruleSection.append(
    el(
      'p',
      'hint',
      'Regexes matched against each activity; the first matching rule (lowest priority first) sets the category. Manual assignments always win.',
    ),
  );
  const ruleGrid = el('div', 'grid rules-grid');
  for (const label of ['Category', 'App', 'Title', 'Context', 'Priority', '']) {
    ruleGrid.append(el('span', 'grid-head', label));
  }
  for (const rule of [...catRules].sort((a, b) => a.priority - b.priority)) {
    const cat = catById.get(rule.categoryId);
    const name = el('span', undefined, cat?.name ?? '?');
    name.style.color = cat?.color ?? FALLBACK_COLOR;
    const del = el('button', 'ghost', '✕');
    del.addEventListener('click', () =>
      void runAction(status, () => deleteCategoryRule(rule.id), reload),
    );
    ruleGrid.append(
      name,
      patternCell(rule.appPattern),
      patternCell(rule.titlePattern),
      patternCell(rule.contextPattern),
      el('span', 'muted', String(rule.priority)),
      del,
    );
  }
  ruleSection.append(ruleGrid);
  if (cats.length === 0) {
    ruleSection.append(el('p', 'empty', 'Create a category first, then add rules for it.'));
  } else {
    const form = el('form', 'grid rules-grid');
    const category = el('select');
    for (const cat of cats) {
      const option = el('option', undefined, cat.name);
      option.value = cat.id;
      category.append(option);
    }
    const appPattern = el('input');
    appPattern.placeholder = 'app regex';
    const titlePattern = el('input');
    titlePattern.placeholder = 'title regex';
    const contextPattern = el('input');
    contextPattern.placeholder = 'context regex';
    const priority = el('input');
    priority.type = 'number';
    priority.value = '0';
    form.append(category, appPattern, titlePattern, contextPattern, priority);
    form.append(el('button', undefined, 'Add'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void runAction(
        status,
        () =>
          createCategoryRule({
            categoryId: category.value,
            appPattern: orNull(appPattern.value),
            titlePattern: orNull(titlePattern.value),
            contextPattern: orNull(contextPattern.value),
            priority: Number(priority.value) || 0,
          }),
        reload,
      );
    });
    ruleSection.append(form);

    const applyRow = el('div', 'row');
    const apply = el('button', undefined, 'Apply rules to existing activities');
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        const changed = await applyCategoryRules();
        status.textContent = `Re-categorized ${changed} ${changed === 1 ? 'activity' : 'activities'}.`;
        status.className = 'status';
      } catch (error) {
        status.textContent = error instanceof GraphQLError ? error.message : 'request failed';
        status.className = 'status error';
      } finally {
        apply.disabled = false;
      }
    });
    applyRow.append(apply);
    ruleSection.append(applyRow);
  }
  app.append(ruleSection);

  // --- context rules ---
  const ctxSection = el('section');
  ctxSection.append(el('h2', undefined, 'Context rules'));
  ctxSection.append(
    el(
      'p',
      'hint',
      'Server-side context extraction for pings without one: the title regex’s first capture group becomes the context (e.g. the project in an editor title). Contexts reported by the agent itself are never overridden.',
    ),
  );
  const ctxGrid = el('div', 'grid ctx-grid');
  for (const label of ['App', 'Title', 'Priority', '']) {
    ctxGrid.append(el('span', 'grid-head', label));
  }
  for (const rule of [...ctxRules].sort((a, b) => a.priority - b.priority)) {
    const del = el('button', 'ghost', '✕');
    del.addEventListener('click', () =>
      void runAction(status, () => deleteContextRule(rule.id), reload),
    );
    ctxGrid.append(
      patternCell(rule.appPattern),
      patternCell(rule.titlePattern),
      el('span', 'muted', String(rule.priority)),
      del,
    );
  }
  ctxSection.append(ctxGrid);
  {
    const form = el('form', 'grid ctx-grid');
    const appPattern = el('input');
    appPattern.placeholder = 'app regex';
    const titlePattern = el('input');
    titlePattern.placeholder = 'title regex with (capture)';
    titlePattern.required = true;
    const priority = el('input');
    priority.type = 'number';
    priority.value = '0';
    form.append(appPattern, titlePattern, priority, el('button', undefined, 'Add'));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void runAction(
        status,
        () =>
          createContextRule({
            appPattern: orNull(appPattern.value),
            titlePattern: titlePattern.value,
            priority: Number(priority.value) || 0,
          }),
        reload,
      );
    });
    ctxSection.append(form);
  }
  app.append(ctxSection, status);
}

async function renderDevices(): Promise<void> {
  const devices = await guarded(fetchDevices());
  if (!devices) return;
  const reload = () => renderDevices();

  app.replaceChildren(renderHeader('devices'));
  const status = el('p', 'status');

  const section = el('section');
  section.append(el('h2', undefined, 'Devices'));
  if (devices.length === 0) {
    section.append(el('p', 'empty', 'No devices yet — run an agent and register it.'));
  }
  for (const device of devices as Device[]) {
    const row = el('div', 'row');
    const name = el('input');
    name.value = device.name;
    name.className = 'grow';
    const rename = el('button', undefined, 'Rename');
    rename.addEventListener('click', () => {
      if (name.value.trim() && name.value.trim() !== device.name) {
        void runAction(status, () => renameDevice(device.id, name.value.trim()), reload);
      }
    });
    const meta = el(
      'span',
      'muted',
      `${device.platform} · added ${new Date(device.createdAt).toISOString().slice(0, 10)}`,
    );
    // The dead-agent tell: mobile background sync can lag 15+ minutes, so
    // only longer silences get the warning treatment.
    const seenMs = device.lastSeenAt ? Date.now() - new Date(device.lastSeenAt).getTime() : null;
    const stale = seenMs === null || seenMs > 30 * 60 * 1000;
    const seen = el(
      'span',
      stale ? 'stale' : 'muted',
      seenMs === null ? '⚠ never seen' : `${stale ? '⚠ ' : ''}seen ${ago(seenMs)}`,
    );
    const del = el('button', 'ghost danger', 'Delete');
    del.addEventListener('click', () => {
      const sure = confirm(
        `Delete "${device.name}"? Its recorded activity is deleted and its API key stops working.`,
      );
      if (sure) void runAction(status, () => deleteDevice(device.id), reload);
    });
    row.append(name, rename, meta, seen, del);
    section.append(row);
  }
  app.append(section, status);
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
