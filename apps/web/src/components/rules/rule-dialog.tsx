import { Pencil, Plus } from 'lucide-react';
import { type ReactNode, useCallback, useId, useMemo, useRef, useState } from 'react';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import type { SlotNode } from '@/lib/utils';

/** What a rule form tells the dialog around it, so the dialog can draw the footer. */
export interface RuleFormState {
  /** The draft is complete and valid. */
  canSave: boolean;
  /** The save is in flight. */
  pending: boolean;
  /** The draft differs from what the form opened with, so closing should ask. */
  dirty: boolean;
  /** The submit's label: "Add rule" or "Save rule". */
  saveLabel: string;
}

/** Handed to the form: the id its `<form>` takes, a way to report its state, and the closer. */
export interface RuleFormHost {
  formId: string;
  report(state: RuleFormState): void;
  /** Closes without asking — for after the save has landed. */
  close(): void;
}

interface Props {
  title: string;
  description: ReactNode;
  trigger: SlotNode;
  /** The form. Called with its host, whose `close` it runs once the save lands. */
  children(host: RuleFormHost): SlotNode;
}

const IDLE: RuleFormState = { canSave: false, pending: false, dirty: false, saveLabel: 'Save' };

/**
 * The shell both rule editors share. Writing a rule is a multi-field job with a
 * live preview, so it gets a dialog instead of a form wedged under the table —
 * and since the content only mounts while open, "edit this rule" always starts
 * from the rule as it is now. Closing an edited draft asks first.
 *
 * The footer is the dialog's, so Cancel goes through the same guarded close as
 * Escape and the overlay; Save submits the form by id.
 */
export function RuleDialog({ title, description, trigger, children }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RuleFormState>(IDLE);
  const dirty = useRef(false);
  const formId = useId();

  const report = useCallback((next: RuleFormState) => {
    dirty.current = next.dirty;
    setState((current) =>
      current.canSave === next.canSave &&
      current.pending === next.pending &&
      current.dirty === next.dirty &&
      current.saveLabel === next.saveLabel
        ? current
        : next,
    );
  }, []);
  const host = useMemo<RuleFormHost>(
    () => ({ formId, report, close: () => setOpen(false) }),
    [formId, report],
  );

  return (
    <DialogLayout
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          dirty.current = false;
          setState(IDLE);
        }
      }}
      triggerSlot={trigger}
      size="lg"
      title={title}
      description={description}
      hasUnsavedChanges={() => dirty.current}
      discardDescription="The rule you were writing is not saved."
      contentSlot={open ? children(host) : null}
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <Button
            type="submit"
            form={formId}
            variant="positive"
            disabled={!state.canSave}
            loading={state.pending}
            content={state.saveLabel}
          />
        </>
      )}
    />
  );
}

// Elements, not components: `DialogTrigger asChild` merges its click handler
// and aria state into the element it is handed, so that element has to be the
// `Button` itself — a wrapper component would have to forward every prop.

/** The card-header trigger that opens an empty rule editor. */
export const addRuleTrigger = (label: string, disabled = false) => (
  <Button size="sm" variant="info" disabled={disabled} iconSlot={<Plus />} content={label} />
);

/** The row trigger that reopens the same editor on an existing rule. */
export const editRuleTrigger = (label: string) => (
  <Button
    variant="outline"
    size="icon-sm"
    aria-label={`Edit ${label}`}
    hint={`Edit ${label}`}
    iconSlot={<Pencil />}
  />
);
