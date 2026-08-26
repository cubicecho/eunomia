import { describePattern } from '@/lib/pattern';

/**
 * Rules are stored as regexes but read back in the words the form used to
 * write them; the raw pattern stays one hover away.
 */
export function Pattern({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="text-muted-foreground text-sm" title={value}>
      {describePattern(value)}
    </span>
  );
}
