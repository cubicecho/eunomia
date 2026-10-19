import { FormField } from '@/components/form-field';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * The per-request opt-in for window titles (issue #41). Off by default: app
 * and site names with their totals are usually enough, and titles are where
 * the private detail is — document names, email subjects, chat partners.
 */
export function IncludeTitles({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <FormField
      orientation="horizontal"
      label="Include window titles"
      description="Sends up to three titles per entry to the model as well. Off, it only sees app and site names and how long each was used."
      controlSlot={
        <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      }
    />
  );
}
