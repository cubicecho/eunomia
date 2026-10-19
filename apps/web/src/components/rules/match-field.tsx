import { Combobox } from '@/components/combobox';
import { Input } from '@/components/ui/input';
import { compile, MATCH_MODES, type Match, type MatchMode, toPattern } from '@/lib/pattern';
import { cn } from '@/lib/utils';

interface Props {
  value: Match;
  onChange(value: Match): void;
  label: string;
}

const PLACEHOLDER: Record<MatchMode, string> = {
  contains: 'github.com',
  startsWith: 'Visual Studio',
  endsWith: '- Vim',
  exactly: 'Slack',
  oneOf: 'Code, Alacritty',
  regex: '^(Code|Alacritty)$',
};

/** Mode + text for one condition. Only `regex` mode can be malformed. */
export function MatchField({ value, onChange, label }: Props) {
  const broken = value.mode === 'regex' && value.value !== '' && compile(value.value) === null;
  const pattern = value.mode === 'regex' || value.value.trim() === '' ? null : toPattern(value);
  const compiled = pattern === value.value.trim() ? null : pattern;

  return (
    <>
      <Combobox
        className="w-36"
        aria-label={`How to match ${label}`}
        options={MATCH_MODES}
        value={value.mode}
        onValueChange={(mode) => onChange({ ...value, mode: mode as MatchMode })}
      />
      <div className="min-w-48 max-w-md grow">
        <Input
          aria-label={label}
          aria-invalid={broken}
          placeholder={PLACEHOLDER[value.mode]}
          className={cn(value.mode === 'regex' && 'font-mono text-xs')}
          value={value.value}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
        />
        {broken ? (
          <p className="text-destructive mt-1 text-xs">Not a valid regular expression.</p>
        ) : compiled !== null ? (
          // The compiled form is what the server stores, so show it — it's how
          // someone graduates from the modes to writing their own. Skipped when
          // it's the same string they just typed, which is only noise.
          <p className="text-muted-foreground mt-1 truncate font-mono text-xs">{compiled}</p>
        ) : null}
      </div>
    </>
  );
}
