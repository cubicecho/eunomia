import { UserX } from 'lucide-react';
import { useState } from 'react';
import { deleteAccount } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAction } from '@/hooks/use-query';
import { useSession } from '@/session';

// Leaving (Mutation.deleteAccount). Two gates on purpose: the email has to be
// retyped before the button does anything — the server checks it too — and
// then the same confirmation dialog as every other delete. The first is what
// stops a delete aimed at the wrong tab or the wrong account.

export function DeleteAccountCard({ onExport }: { onExport(): void }) {
  const { me, expire } = useSession();
  const action = useAction();
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toLowerCase() === me.email.trim().toLowerCase();

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
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
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="delete-account-email">Type your email to confirm</Label>
            <Input
              id="delete-account-email"
              className="w-72"
              type="email"
              autoComplete="off"
              placeholder={me.email}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <ConfirmDelete
            name={me.email}
            description="Your account and all of its data are deleted now, and you are signed out. This is the last step."
            onConfirm={() =>
              action.run(() => deleteAccount(typed), {
                onDone: () => expire('Your account and all of its data have been deleted.'),
              })
            }
          >
            <Button variant="destructive" disabled={!matches || action.pending}>
              <UserX className="size-4" />
              Delete account
            </Button>
          </ConfirmDelete>
        </form>
        <StatusLine status={action.status} />
      </CardContent>
    </Card>
  );
}
