import { Pencil, Plus } from 'lucide-react';
import type * as React from 'react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface Props {
  title: string;
  description: ReactNode;
  trigger: ReactNode;
  /** The form. Called with the closer, which it runs once the save lands. */
  children(close: () => void): ReactNode;
}

/**
 * The shell both rule editors share. Writing a rule is a multi-field job with a
 * live preview, so it gets a dialog instead of a form wedged under the table —
 * and since the content only mounts while open, "edit this rule" always starts
 * from the rule as it is now, and an abandoned draft leaves nothing behind.
 */
export function RuleDialog({ title, description, trigger, children }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}

// Both triggers spread what they're given: `DialogTrigger asChild` hands its
// child the click handler and aria state, and a component that dropped them
// would render a button that does nothing.

/** The card-header trigger that opens an empty rule editor. */
export function AddRuleButton({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button size="sm" {...props}>
      <Plus className="size-4" />
      {label}
    </Button>
  );
}

/** The row trigger that reopens the same editor on an existing rule. */
export function EditRuleButton({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Edit ${label}`}
      title={`Edit ${label}`}
      className="text-muted-foreground hover:text-foreground size-8"
      {...props}
    >
      <Pencil className="size-4" />
    </Button>
  );
}
