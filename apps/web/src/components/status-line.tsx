import { cn } from '@/lib/utils';

/** The one place a view reports what a mutation did, or why it didn't. */
export function StatusLine({ status }: { status: { text: string; failed: boolean } | null }) {
  if (!status) return null;
  return (
    <p
      role="status"
      className={cn('text-sm', status.failed ? 'text-destructive' : 'text-muted-foreground')}
    >
      {status.text}
    </p>
  );
}
