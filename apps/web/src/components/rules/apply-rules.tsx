import { useState } from 'react';
import { applyCategoryRules } from '@/api';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/hooks/use-query';

/**
 * Rules only categorize activities as they arrive, so this is the retroactive
 * sweep — it belongs to the whole rule set, not to any one rule, which is why
 * it sits under the table rather than in the editor.
 */
export function ApplyRules() {
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        loading={applying}
        loadingLabel="Applying…"
        content="Apply rules to existing activities"
        onClick={() => {
          setApplying(true);
          applyCategoryRules()
            .then((changed) =>
              setApplied(`Re-categorized ${changed} ${changed === 1 ? 'activity' : 'activities'}.`),
            )
            .catch((cause: unknown) => setApplied(errorMessage(cause)))
            .finally(() => setApplying(false));
        }}
      />
      {applied && <span className="text-muted-foreground text-sm">{applied}</span>}
    </div>
  );
}
