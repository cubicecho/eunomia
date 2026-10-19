import { Plus, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { acceptSuggestion, type RuleSuggestion, suggestRules } from '@/api';
import { IncludeTitles } from '@/components/assistant/include-titles';
import { CardLayout } from '@/components/card-layout';
import { EmptyState } from '@/components/empty-state';
import { StatusLine } from '@/components/status-line';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAction } from '@/hooks/use-query';
import { type DateRange, formatSeconds } from '@/lib/format';
import { DEFAULT_KIND } from '@/lib/kinds';

interface Props {
  range: DateRange;
  /** Whether a model is set up; without one the card says how to get one. */
  configured: boolean;
  /** Called once a rule is saved, so the queue beside it reloads. */
  onSaved(): void;
}

const key = (s: RuleSuggestion) => `${s.appPattern}\n${s.contextPattern ?? ''}`;

/**
 * Asks the configured language model which category the biggest uncategorized
 * entries belong to (issue #41). Nothing changes until a suggestion's "Add
 * rule" is pressed, which saves it as an ordinary rule — editable and
 * deletable under Categories & rules like any other.
 */
export function SuggestionsCard({ range, configured, onSaved }: Props) {
  const asking = useAction();
  const saving = useAction();
  const [titles, setTitles] = useState(false);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[] | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());

  const ask = () =>
    asking.run(async () => {
      setSuggestions(await suggestRules(range, titles));
      setSaved(new Set());
    });

  const accept = (suggestion: RuleSuggestion) =>
    saving.run(() => acceptSuggestion(suggestion, DEFAULT_KIND), {
      onDone: () => {
        setSaved((current) => new Set(current).add(key(suggestion)));
        onSaved();
      },
      success: `Rule added: ${suggestion.context ?? suggestion.app} → ${suggestion.categoryName}.`,
    });

  const dismiss = (suggestion: RuleSuggestion) =>
    setSuggestions((current) => current?.filter((s) => key(s) !== key(suggestion)) ?? null);

  if (!configured) {
    return (
      <CardLayout
        title="Suggested rules"
        contentSlot={
          <EmptyState
            compact
            title="No language model is set up. The admin can point eunomia at one (a local Ollama works) under Settings."
          />
        }
      />
    );
  }

  return (
    <CardLayout
      title="Suggested rules"
      description="Your language model looks at the biggest uncategorized entries in this range and proposes a rule for each. Nothing changes until you add one."
      actionSlot={
        <Button
          size="sm"
          variant="info"
          loading={asking.pending}
          loadingLabel="Asking…"
          onClick={ask}
          iconSlot={<Sparkles />}
          content={suggestions ? 'Ask again' : 'Suggest rules'}
        />
      }
      contentClassName="gap-3"
      contentSlot={
        <>
          <IncludeTitles checked={titles} onChange={setTitles} />
          {suggestions?.length === 0 ? (
            <EmptyState
              compact
              title="No suggestions — the model wasn't sure about any of these."
            />
          ) : null}
          {suggestions && suggestions.length > 0 ? (
            <ul className="flex flex-col">
              {suggestions.map((suggestion) => (
                <SuggestionRow
                  key={key(suggestion)}
                  suggestion={suggestion}
                  saved={saved.has(key(suggestion))}
                  busy={saving.pending}
                  onAccept={() => accept(suggestion)}
                  onDismiss={() => dismiss(suggestion)}
                />
              ))}
            </ul>
          ) : null}
          <StatusLine status={asking.status ?? saving.status} />
        </>
      }
    />
  );
}

function SuggestionRow({
  suggestion,
  saved,
  busy,
  onAccept,
  onDismiss,
}: {
  suggestion: RuleSuggestion;
  saved: boolean;
  busy: boolean;
  onAccept(): void;
  onDismiss(): void;
}) {
  const name = suggestion.context ? `${suggestion.app} / ${suggestion.context}` : suggestion.app;
  return (
    <li className="flex flex-wrap items-center gap-2 border-b border-dashed py-2 last:border-0">
      <div className="flex min-w-0 grow basis-72 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground">→</span>
          <span>{suggestion.categoryName}</span>
          {suggestion.isNewCategory ? <Badge variant="outline">new category</Badge> : null}
        </span>
        <span className="text-muted-foreground text-xs">
          {suggestion.reason ? `${suggestion.reason} ` : ''}
          Would file {formatSeconds(suggestion.preview.changeableSeconds)} in this range
          {suggestion.context ? ', this context only' : ', the whole app'}.
        </span>
      </div>
      {saved ? (
        <span className="text-muted-foreground text-sm">Added</span>
      ) : (
        <>
          <Button
            size="sm"
            variant="positive"
            disabled={busy}
            onClick={onAccept}
            iconSlot={<Plus />}
            content="Add rule"
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={`Dismiss the suggestion for ${name}`}
            hint="Dismiss"
            onClick={onDismiss}
            iconSlot={<X />}
          />
        </>
      )}
    </li>
  );
}
