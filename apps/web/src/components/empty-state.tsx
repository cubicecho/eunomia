import type { ReactNode } from 'react';

/** What a panel says when the query worked and there was simply nothing. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground border-border/60 rounded-lg border border-dashed px-4 py-8 text-center text-sm">
      {children}
    </p>
  );
}
