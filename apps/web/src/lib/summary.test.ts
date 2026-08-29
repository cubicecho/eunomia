import { describe, expect, it } from 'vitest';
import type { AppSummaryRow } from '@/api';
import { UNCATEGORIZED_COLOR } from '@/lib/palette';
import { appCategories, MAX_CONTEXTS_PER_APP, topApps, UNCATEGORIZED } from '@/lib/summary';

const row = (
  app: string,
  context: string | null,
  seconds: number,
  category: { id: string; name: string; color: string | null } | null = null,
): AppSummaryRow => ({
  app,
  context,
  seconds,
  categoryId: category?.id ?? null,
  categoryName: category?.name ?? null,
  categoryColor: category?.color ?? null,
});

const WORK = { id: 'work', name: 'Work', color: '#3fb950' };
const FUN = { id: 'fun', name: 'Fun', color: '#d55181' };

describe('topApps', () => {
  it('splits an app bar into the categories its time fell in, largest first', () => {
    const [app] = topApps([
      row('firefox', 'github.com', 300, WORK),
      row('firefox', 'youtube.com', 900, FUN),
    ]);

    expect(app?.seconds).toBe(1200);
    expect(app?.segments).toEqual([
      { id: 'fun', name: 'Fun', color: '#d55181', seconds: 900 },
      { id: 'work', name: 'Work', color: '#3fb950', seconds: 300 },
    ]);
  });

  it('gives each context its own category split', () => {
    const [app] = topApps([
      row('firefox', 'github.com', 300, WORK),
      row('firefox', 'github.com', 100, FUN),
      row('firefox', 'youtube.com', 900, FUN),
    ]);

    expect(app?.contexts.map((context) => [context.name, context.segments.length])).toEqual([
      ['youtube.com', 1],
      ['github.com', 2],
    ]);
  });

  it('colors uncategorized time neutrally, and names it', () => {
    const [app] = topApps([row('code', null, 600)]);

    expect(app?.segments).toEqual([
      { id: null, name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, seconds: 600 },
    ]);
  });

  it("carries the remainder's own categories rather than one neutral block", () => {
    // Contextless Work time plus a context past the cap: the "(other)" row has
    // to say which categories that leftover came from.
    const rows = [
      row('firefox', null, 500, WORK),
      ...Array.from({ length: MAX_CONTEXTS_PER_APP }, (_, i) =>
        row('firefox', `site-${i}.example`, 100 * (MAX_CONTEXTS_PER_APP - i), FUN),
      ),
      row('firefox', 'last.example', 10, FUN),
    ];

    const [app] = topApps(rows);
    const other = app?.contexts.at(-1);

    expect(other?.name).toBe('(other)');
    expect(other?.seconds).toBe(510);
    expect(other?.segments).toEqual([
      { id: 'work', name: 'Work', color: '#3fb950', seconds: 500 },
      { id: 'fun', name: 'Fun', color: '#d55181', seconds: 10 },
    ]);
  });

  it('leaves an app with no leftover without an "(other)" row', () => {
    const [app] = topApps([row('firefox', 'github.com', 300, WORK)]);

    expect(app?.contexts.map((context) => context.name)).toEqual(['github.com']);
  });

  it('falls back to a hashed slot when a category has no color of its own', () => {
    const [app] = topApps([row('code', null, 60, { id: 'work', name: 'Work', color: null })]);

    expect(app?.segments[0]?.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(app?.segments[0]?.color).not.toBe(UNCATEGORIZED_COLOR);
  });
});

describe('appCategories', () => {
  it('totals every category present across the apps, largest first', () => {
    const apps = topApps([
      row('firefox', 'youtube.com', 900, FUN),
      row('firefox', 'github.com', 300, WORK),
      row('code', null, 1000, WORK),
      row('slack', null, 50),
    ]);

    expect(appCategories(apps)).toEqual([
      { id: 'work', name: 'Work', color: '#3fb950', seconds: 1300 },
      { id: 'fun', name: 'Fun', color: '#d55181', seconds: 900 },
      { id: null, name: UNCATEGORIZED, color: UNCATEGORIZED_COLOR, seconds: 50 },
    ]);
  });
});
