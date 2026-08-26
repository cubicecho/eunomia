import type { ReactNode } from 'react';

interface Props {
  /** Corpus size — 0 means there is nothing to test against yet. */
  total: number;
  /** How many of them the draft rule hits. */
  count: number;
  /** What matched, singular and plural — "activity" / "activities". */
  noun: [one: string, many: string];
  children: ReactNode;
}

/**
 * What the draft rule would do to the activities already recorded. The point is
 * that "this matches nothing" shows up while typing rather than after saving a
 * rule and wondering why nothing got categorized.
 */
export function Preview({ total, count, noun, children }: Props) {
  if (total === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No recent activity to preview against yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className={count === 0 ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
        {count === 0
          ? `No matches in the last ${total} activities.`
          : `Matches ${count} ${count === 1 ? noun[0] : noun[1]} of the last ${total} activities.`}
      </p>
      {count > 0 && <ul className="flex flex-col gap-1">{children}</ul>}
    </div>
  );
}

/** One example row. Titles are long and arbitrary, so they truncate. */
export function PreviewRow({ children }: { children: ReactNode }) {
  return (
    <li className="text-muted-foreground truncate font-mono text-xs">{children}</li>
  );
}
