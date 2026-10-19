import { Merge } from 'lucide-react';
import { useId, useState } from 'react';
import { createMergeRule } from '@/api';
import { DialogLayout } from '@/components/dialog-layout';
import { FormField } from '@/components/form-field';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
 * Its trigger is the merge icon on that entry's row.
 */
export function MergeDialog({ source, groups, onSaved }: Props) {
  const action = useAction();
  const formId = useId();
  const [open, setOpen] = useState(false);
  // Both fields start at the entry as it stands, so what gets submitted is
  // the edit the user made rather than whatever a blank field happens to
  // mean — clearing the context is a real merge (into the app's contextless
  // time), and it shouldn't be the one that's pre-filled.
  const [app, setApp] = useState(source.app);
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
  const label = entryLabel(source);

  return (
    <DialogLayout
      open={open}
      onOpenChange={(next) => {
        // Every merge starts from the entry as it is, and an abandoned one
        // leaves nothing behind.
        if (next) {
          setApp(source.app);
          setContext(source.context ?? '');
        }
        setOpen(next);
      }}
      triggerSlot={
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={`Merge ${label}`}
          hint={`Merge ${label}`}
          className="shrink-0"
          iconSlot={<Merge />}
        />
      }
      title={`Merge “${label}”`}
      description={
        wholeApp
          ? 'Everything recorded under this app moves to the app you name here, keeping the context each entry already has.'
          : 'This one entry moves to the app and context you name here. The rest of the app is untouched.'
      }
      hasUnsavedChanges={changes}
      contentSlot={
        <form
          id={formId}
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
              {
                onDone: () => {
                  setOpen(false);
                  onSaved();
                },
              },
            );
          }}
        >
          <FormField
            label="Becomes app"
            required
            controlSlot={
              <Input
                list={`${formId}-apps`}
                autoComplete="off"
                value={app}
                onChange={(event) => setApp(event.target.value)}
                required
              />
            }
          />
          <datalist id={`${formId}-apps`}>
            {groups.map((group) => (
              <option key={group.app} value={group.app} />
            ))}
          </datalist>

          {!wholeApp && (
            <>
              <FormField
                label="Becomes context"
                description="Leave blank for time with no context."
                controlSlot={
                  <Input
                    list={`${formId}-contexts`}
                    autoComplete="off"
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                  />
                }
              />
              {/* Suggestions from the app being typed, so picking a target app
                  first narrows this to contexts that app actually has. */}
              <datalist id={`${formId}-contexts`}>
                {(groups.find((group) => group.app === target.app)?.contexts ?? []).map((entry) => (
                  <option key={entry.context} value={entry.context} />
                ))}
              </datalist>
            </>
          )}

          <p className="text-muted-foreground text-sm">
            {changes ? (
              <>
                <span className="text-foreground font-medium">{label}</span> →{' '}
                <span className="text-foreground font-medium">{entryLabel(target)}</span>. Time
                already recorded is rewritten now, and new pings fold under the new name.
              </>
            ) : (
              'Name something different from the entry itself.'
            )}
          </p>

          <StatusLine status={action.status} />
        </form>
      }
      footerActionsSlot={(close) => (
        <>
          <Button variant="outline" onClick={close} content="Cancel" />
          <Button
            type="submit"
            form={formId}
            variant="positive"
            disabled={!changes}
            loading={action.pending}
            content="Merge"
          />
        </>
      )}
    />
  );
}
