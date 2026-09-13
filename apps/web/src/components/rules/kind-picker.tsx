import type { CategoryKind } from '@/api';
import { Swatch } from '@/components/rules/swatch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { KINDS } from '@/lib/kinds';

/**
 * The five category kinds. Each item's text is also what the closed trigger
 * shows, so the hints that say what belongs where live in KindHints instead.
 */
export function KindPicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: CategoryKind;
  onChange(kind: CategoryKind): void;
}) {
  return (
    <Select value={value} onValueChange={(kind) => onChange(kind as CategoryKind)}>
      <SelectTrigger className="w-36" id={id} aria-label="Kind">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {KINDS.map((kind) => (
          <SelectItem key={kind.value} value={kind.value}>
            <Swatch color={kind.color} />
            {kind.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** What each kind is for, in one line apiece — "work" and "focus" are otherwise guesswork. */
export function KindHints() {
  return (
    <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
      {KINDS.map((kind) => (
        <li key={kind.value}>
          <span className="text-foreground">{kind.label}</span>: {kind.hint}
        </li>
      ))}
    </ul>
  );
}
