import { useMemo, useState } from 'react';
import { type ActivitySample, createContextRule } from '@/api';
import { MatchField } from '@/components/rules/match-field';
import { Preview, PreviewRow } from '@/components/rules/preview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  compile,
  type Extract,
  type ExtractMode,
  EXTRACT_MODES,
  extractFrom,
  hasCaptureGroup,
  type Match,
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
  run(mutation: () => Promise<unknown>): void;
}

export function ContextRuleForm({ samples, run }: Props) {
  const [app, setApp] = useState<Match>({ mode: 'contains', value: '' });
  const [extract, setExtract] = useState<Extract>({ mode: 'before', first: '', second: '' });
  const [priority, setPriority] = useState('0');

  const appPattern = app.value.trim() === '' ? null : toPattern(app);
  const appRegex = useMemo(() => (appPattern === null ? null : compile(appPattern)), [appPattern]);
  const needsSecond = extract.mode === 'between';
  const complete =
    extract.first.trim() !== '' && (!needsSecond || extract.second.trim() !== '');
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
        run(() =>
          createContextRule({ appPattern, titlePattern, priority: Number(priority) || 0 }),
        );
        setApp({ mode: 'contains', value: '' });
        setExtract({ mode: 'before', first: '', second: '' });
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
        <Button type="submit" disabled={!valid}>
          Add rule
        </Button>
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
    </form>
  );
}
