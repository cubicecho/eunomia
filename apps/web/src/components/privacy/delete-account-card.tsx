import { UserX } from 'lucide-react';
import { deleteAccount } from '@/api';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { StatusLine } from '@/components/status-line';
import { useAction } from '@/hooks/use-query';
import { useSession } from '@/session';

// Leaving (Mutation.deleteAccount). The confirmation asks for the account's
// email, typed, before its Delete unlocks — the server checks it too. That is
// what stops a delete aimed at the wrong tab or the wrong account.

export function DeleteAccountCard({ onExport }: { onExport(): void }) {
  const { me, expire } = useSession();
  const action = useAction();

  return (
    <CardLayout
      className="border-destructive/50"
      title="Delete account"
      description={
        <>
          Deletes <span className="text-foreground">{me.email}</span> and everything in it: every
          device, API key, category, rule, daily total and ping. Agents still running are refused on
          their next upload. None of it can be recovered —{' '}
          <button
            type="button"
            className="text-foreground underline underline-offset-4"
            onClick={onExport}
          >
            export everything first
          </button>
          .
        </>
      }
      contentSlot={<StatusLine status={action.status} />}
      footerActionsSlot={
        <ConfirmButton
          variant="destructive"
          loading={action.pending}
          iconSlot={<UserX />}
          content="Delete account"
          title={`Delete ${me.email}?`}
          confirmLabel="Delete account"
          description="Your account and all of its data are deleted now, and you are signed out. This is the last step."
          requireText={me.email}
          requireTextLabel={
            <>
              Type <strong>{me.email}</strong> to delete it
            </>
          }
          onConfirm={() =>
            action.run(() => deleteAccount(me.email), {
              onDone: () => expire('Your account and all of its data have been deleted.'),
            })
          }
        />
      }
    />
  );
}
