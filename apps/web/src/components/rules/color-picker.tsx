import { CHART_COLORS } from '@/lib/palette';

interface Props {
  /** Null is no color of its own: the charts give the category a stable slot. */
  value: string | null;
  onChange(color: string): void;
}

/**
 * The palette the charts actually draw from, rather than a color wheel that can
 * land on two categories nobody can tell apart.
 *
 * A color set some other way (the API takes any string) is offered alongside
 * the palette rather than dropped, so recoloring nothing else about a category
 * — renaming it, say — never quietly changes its color too.
 */
export function ColorPicker({ value, onChange }: Props) {
  const options: string[] = [...CHART_COLORS];
  if (value !== null && !options.includes(value)) options.push(value);

  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Category color">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={option}
          title={option}
          onClick={() => onChange(option)}
          style={{ background: option }}
          className={
            value === option
              ? 'ring-ring size-5 rounded-[4px] ring-2 ring-offset-2 ring-offset-(--card)'
              : 'size-5 rounded-[4px]'
          }
        />
      ))}
    </div>
  );
}
