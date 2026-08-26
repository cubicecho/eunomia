import { useMemo, useState } from 'react';
import {
  type ActivitySample,
  type ContextRule,
  type ContextRuleInput,
  createContextRule,
  updateContextRule,
} from '@/api';
import { MatchField } from '@/components/rules/match-field';
import { Preview, PreviewRow } from '@/components/rules/preview';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAction } from '@/hooks/use-query';
import {
  compile,
  type Extract,
  type ExtractMode,
  EXTRACT_MODES,
  extractFrom,
  hasCaptureGroup,
  type Match,
  parseExtractPattern,
  parsePattern,
  toExtractPattern,
  toPattern,
} from '@/lib/pattern';
import { cn } from '@/lib/utils';

const MARKER_HINT: Record<ExtractMode, [first: string, second: string]> = {
  before: ['the separator, e.g. “ - ”', ''],
  after: ['the separator, e.g. “ — ”', ''],
  between: ['opening, e.g. “[”', 'closing, e.g. “]”'],
  regex: ['^(.+?) - Visual Studio Code$', ''],
};

interface Props {
  samples: ActivitySample[];
  /** The rule being edited; omitted when writing a new one. */
  rule?: ContextRule;
  /** Called once the save lands — the dialog closes and the view reloads. */
  onSaved(): void;
}

/**
 * The context-rule editor, create and edit alike. Stored patterns are read back
 * into the modes that wrote them, so editing “text before ‘ - novelWriter’”
 * shows exactly that and not the regex it compiled to.
 */
export function ContextRuleForm({ samples, rule, onSaved }: Props) {
  const action = useAction();
  const [app, setApp] = useState<Match>(() =>
    rule?.appPattern != null ? parsePattern(rule.appPattern) : { mode: 'contains', value: '' },
  );
  const [extract, setExtract] = useState<Extract>(() =>
    rule ? parseExtractPattern(rule.titlePattern) : { mode: 'before', first: '', second: '' },
  );
  const [priority, setPriority] = useState(String(rule?.priority ?? 0));

  const appPattern = app.value.trim() === '' ? null : toPattern(app);
  const appRegex = useMemo(() => (appPattern === null ? null : compile(appPattern)), [appPattern]);
  const needsSecond = extract.mode === 'between';
  const complete = extract.first.trim() !== '' && (!needsSecond || extract.second.trim() !== '');
  const titlePattern = complete ? toExtractPattern(extract) : null;
  // The server rejects an extractor without a capture group, so say so here
  // instead of letting the mutation round-trip fail.
  const captures = titlePattern !== null && hasCaptureGroup(titlePattern);
  const valid = titlePattern !== null && captures && (appPattern === null || appRegex !== null);

  const hits = useMemo(() => {
    if (!valid || titlePattern === null) return [];
    const found: { title: string; context: string }[] = [];
    for (const sample of samples) {
      if (sample.title === null) continue;
      if (appRegex && !appRegex.test(sample.app)) continue;
      const context = extractFrom(titlePattern, sample.title);
      if (context) found.push({ title: sample.title, context });
    }
    return found;
  }, [valid, titlePattern, appRegex, samples]);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || titlePattern === null) return;
        const input: ContextRuleInput = { appPattern, titlePattern, priority: Number(priority) || 0 };
        action.run(() => (rule ? updateContextRule(rule.id, input) : createContextRule(input)), {
          onDone: onSaved,
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground mb-2 text-sm">
          In activities whose app…{' '}
          <span className="text-muted-foreground/70">(leave blank for every app)</span>
        </legend>
        <div className="flex flex-wrap items-start gap-2">
          <MatchField label="App" value={app} onChange={setApp} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-muted-foreground mb-2 text-sm">
          …use this part of the window title as the context:
        </legend>
        <div className="flex flex-wrap items-start gap-2">
          <Select
            value={extract.mode}
            onValueChange={(mode) =>
              setExtract((current) => ({ ...current, mode: mode as ExtractMode }))
            }
          >
            <SelectTrigger className="w-36" aria-label="How to extract the context">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXTRACT_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className={cn('min-w-48 max-w-md grow', extract.mode === 'regex' && 'font-mono text-xs')}
            aria-label={extract.mode === 'regex' ? 'Regex' : 'Marker text'}
            aria-invalid={extract.mode === 'regex' && complete && !captures}
            placeholder={MARKER_HINT[extract.mode][0]}
            value={extract.first}
            onChange={(event) =>
              setExtract((current) => ({ ...current, first: event.target.value }))
            }
          />
          {needsSecond && (
            <Input
              className="w-40"
              aria-label="Closing marker"
              placeholder={MARKER_HINT[extract.mode][1]}
              value={extract.second}
              onChange={(event) =>
                setExtract((current) => ({ ...current, second: event.target.value }))
              }
            />
          )}
        </div>
        {titlePattern !== null && !captures && (
          <p className="text-destructive text-xs">
            {compile(extract.first) === null
              ? 'Not a valid regular expression.'
              : 'Add a (capture group) — what it captures becomes the context.'}
          </p>
        )}
        {titlePattern !== null && captures && extract.mode !== 'regex' && (
          <p className="text-muted-foreground truncate font-mono text-xs">{titlePattern}</p>
        )}
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="context-priority">Priority</Label>
          <Input
            id="context-priority"
            type="number"
            className="w-20"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
        </div>
      </div>

      {valid && (
        <Preview total={samples.length} count={hits.length} noun={['title', 'titles']}>
          {hits.slice(0, 5).map((hit, index) => (
            <PreviewRow key={`${index}-${hit.title}`}>
              {hit.title} <span className="text-foreground">→ {hit.context}</span>
            </PreviewRow>
          ))}
        </Preview>
      )}

      <StatusLine status={action.status} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!valid || action.pending}>
          {rule ? 'Save rule' : 'Add rule'}
        </Button>
      </div>
    </form>
  );
}
