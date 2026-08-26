import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  /** What's being deleted — the dialog titles itself “Delete “{name}”?”. */
  name: string;
  /** What deleting actually costs, in the user's terms. */
  description: ReactNode;
  onConfirm(): void;
  /** The trigger. Defaults to the trash icon button used in list rows. */
  children?: ReactNode;
}

/**
 * Every delete in the dashboard is irreversible and none of them are undoable,
 * so they all go through the same dialog rather than each view inventing its
 * own `confirm()` wording.
 */
export function ConfirmDelete({ name, description, onConfirm, children }: Props) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {children ?? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${name}`}
            title={`Delete ${name}`}
            className="text-muted-foreground hover:text-destructive size-8"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: 'destructive' }))}
            onClick={onConfirm}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
