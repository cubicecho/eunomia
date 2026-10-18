import { KeyRound, Link2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { fetchSsoSetup, pairSso, unpairSso } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage, useAction, useQuery } from '@/hooks/use-query';

// Sign-in through an OIDC provider (heautou, or any that supports Dynamic
// Client Registration), set up by pasting the setup URL it gives you. The
// server decides who may pair — the admin, or anyone on a brand-new instance —
// and this only asks.

/** The paste-and-connect form, on the sign-in page of a new instance and in Settings. */
export function PairSsoForm({ onPaired }: { onPaired(): void }) {
  const [setupUrl, setSetupUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await pairSso(setupUrl.trim());
      setSetupUrl('');
      onPaired();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="grid gap-3" onSubmit={submit}>
      <div className="grid gap-1.5">
        <Label htmlFor="sso-setup-url">Setup URL</Label>
        <Input
          id="sso-setup-url"
          type="url"
          required
          placeholder="https://id.example.com/oidc#setup=…"
          value={setupUrl}
          onChange={(event) => setSetupUrl(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Your provider's admin makes one for eunomia. It works once, and only for a short while.
        </p>
      </div>
      <Button type="submit" variant="outline" disabled={pending || setupUrl.trim() === ''}>
        <Link2 className="size-4" />
        {pending ? 'Connecting…' : 'Connect'}
      </Button>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Settings → Single sign-on. Rendered for the admin only. */
export function SsoCard() {
  const setup = useQuery(fetchSsoSetup, []);
  const action = useAction();
  const data = setup.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Single sign-on</CardTitle>
        <CardDescription>
          Let people sign in through an OpenID Connect provider (heautou, Keycloak, Authentik, …) as
          well as with an emailed link. Accounts are matched by email address. You see this because
          you run this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {setup.error ? <p className="text-destructive text-sm">{setup.error}</p> : null}
        {data?.source === 'NONE' && data.canPair ? <PairSsoForm onPaired={setup.reload} /> : null}
        {data && data.source !== 'NONE' ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
              <p className="flex items-center gap-2 font-medium">
                <KeyRound className="size-4" />
                Sign in with {data.name}
              </p>
              {data.source === 'ENV' ? (
                <p className="text-muted-foreground text-sm">
                  Set by <code className="text-xs">OIDC_ISSUER</code> in the server's environment,
                  so it is changed there. Its redirect URI is{' '}
                  <code className="text-xs break-all">{data.redirectUri}</code>.
                </p>
              ) : (
                <p className="text-muted-foreground text-sm break-all">
                  Paired with {data.issuer ?? 'a provider'}.
                </p>
              )}
            </div>
            {data.source === 'PAIRED' && data.canPair ? (
              <ConfirmDelete
                name={`sign-in with ${data.name}`}
                description="Its button leaves the sign-in page and eunomia's client is deleted at the provider. Accounts stay, and can still sign in with an emailed link."
                onConfirm={() =>
                  action.run(unpairSso, {
                    onDone: setup.reload,
                    success: `Disconnected ${data.name}.`,
                  })
                }
              >
                <Button variant="outline" disabled={action.pending}>
                  Disconnect
                </Button>
              </ConfirmDelete>
            ) : null}
          </div>
        ) : null}
        <StatusLine status={action.status} />
      </CardContent>
    </Card>
  );
}
