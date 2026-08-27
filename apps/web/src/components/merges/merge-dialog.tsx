import { type ReactNode, useState } from 'react';
import { createMergeRule } from '@/api';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAction } from '@/hooks/use-query';
import type { EntryGroup } from '@/lib/summary';

/** The entry being merged away. A null context means the app as a whole. */
export interface Source {
  app: string;
  context: string | null;
}

interface Props {
  source: Source;
  /** Everything recorded, for the target suggestions. */
  groups: EntryGroup[];
  trigger: ReactNode;
  /** Called once the merge lands — the view reloads. */
  onSaved(): void;
}

/** “chrome / x.com”, or just the app when the entry has no context. */
export const entryLabel = (entry: Source): string =>
  entry.context === null ? entry.app : `${entry.app} / ${entry.context}`;

/**
 * Picks what an entry should have been called. The target is typed rather than
 * chosen from a list, with the recorded names as suggestions: the name you want
 * usually already exists, but merging into one that doesn't yet — renaming a
 * package id to something readable before the agent learns to — is the same
 * operation and shouldn't need a detour.
 *
 * Only the merged-away side is fixed. Which way round a merge goes is the
 * user's call, and the dialog is opened from the entry that will disappear.
 */
export function MergeDialog({ source, groups, trigger, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* Mounted only while open, so every merge starts from a blank target
          and an abandoned one leaves nothing behind. */}
      <DialogContent className="sm:max-w-lg">
        <MergeForm
          source={source}
          groups={groups}
          onSaved={() => {
            setOpen(false);
            onSaved();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function MergeForm({
  source,
  groups,
  onSaved,
}: {
  source: Source;
  groups: EntryGroup[];
  onSaved(): void;
}) {
  const action = useAction();
  const [app, setApp] = useState(source.app);
  // Both fields start at the entry as it stands, so what gets submitted is
  // the edit the user made rather than whatever a blank field happens to
  // mean — clearing the context is a real merge (into the app's contextless
  // time), and it shouldn't be the one that's pre-filled.
  const [context, setContext] = useState(source.context ?? '');

  // An app-wide merge renames the app and carries each entry's context across,
  // so there is no destination context to name — the server rejects one.
  const wholeApp = source.context === null;
  const target: Source = {
    app: app.trim(),
    context: wholeApp ? null : context.trim() || null,
  };
  const changes =
    target.app !== '' && !(target.app === source.app && target.context === source.context);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!changes) return;
        action.run(
          () =>
            createMergeRule({
              fromApp: source.app,
              fromContext: source.context,
              toApp: target.app,
              toContext: target.context,
            }),
          { onDone: onSaved },
        );
      }}
    >
      <DialogHeader>
        <DialogTitle>Merge “{entryLabel(source)}”</DialogTitle>
        <DialogDescription>
          {wholeApp
            ? 'Everything recorded under this app moves to the app you name here, keeping the context each entry already has.'
            : 'This one entry moves to the app and context you name here. The rest of the app is untouched.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="merge-target-app">Becomes app</Label>
          <Input
            id="merge-target-app"
            list="merge-target-apps"
            autoComplete="off"
            value={app}
            onChange={(event) => setApp(event.target.value)}
            required
          />
          <datalist id="merge-target-apps">
            {groups.map((group) => (
              <option key={group.app} value={group.app} />
            ))}
          </datalist>
        </div>

        {!wholeApp && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="merge-target-context">Becomes context</Label>
            <Input
              id="merge-target-context"
              list="merge-target-contexts"
              autoComplete="off"
              placeholder="leave blank for time with no context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
            />
            {/* Suggestions from the app being typed, so picking a target app
                first narrows this to contexts that app actually has. */}
            <datalist id="merge-target-contexts">
              {(groups.find((group) => group.app === target.app)?.contexts ?? []).map((entry) => (
                <option key={entry.context} value={entry.context} />
              ))}
            </datalist>
          </div>
        )}
      </div>

      <p className="text-muted-foreground text-sm">
        {changes ? (
          <>
            <span className="text-foreground font-medium">{entryLabel(source)}</span> →{' '}
            <span className="text-foreground font-medium">{entryLabel(target)}</span>. Time already
            recorded is rewritten now, and new pings fold under the new name.
          </>
        ) : (
          'Name something different from the entry itself.'
        )}
      </p>

      <StatusLine status={action.status} />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!changes || action.pending}>
          Merge
        </Button>
      </div>
    </form>
  );
}
