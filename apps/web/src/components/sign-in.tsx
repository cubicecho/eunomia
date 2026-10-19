import { ChevronDown, KeyRound } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  claimSetupCode,
  fetchSetupCodePending,
  fetchSsoSetup,
  requestMagicLink,
  type SsoSetup,
  verifyMagicLink,
} from '@/api';
import { PairSsoForm } from '@/components/sso-card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/hooks/use-query';

interface Props {
  message?: string;
  onSignedIn(): void;
}

/**
 * Passwordless: the server emails a single-use link (see README), and when an
 * OIDC provider is set up, a button signs in through it instead. A brand-new
 * instance (no accounts yet) also offers to pair one here, since there is no
 * admin yet to do it from Settings, and asks for the setup code the server
 * printed to its log, which makes that first account without any email.
 */
export function SignIn({ message, onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sso, setSso] = useState<SsoSetup | null>(null);
  const [setupPending, setSetupPending] = useState(false);
  const [useEmail, setUseEmail] = useState(false);

  useEffect(() => {
    fetchSetupCodePending().then(setSetupPending, () => setSetupPending(false));
  }, []);

  // A failure here only means no button: the email form still works.
  const loadSso = useCallback(() => {
    fetchSsoSetup().then(setSso, () => setSso(null));
  }, []);
  useEffect(loadSso, [loadSso]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const token = await requestMagicLink(email);
      if (token) {
        // UNSAFE_LOCAL_NETWORK: the server handed the token straight back.
        await verifyMagicLink(token);
        onSignedIn();
        return;
      }
      setSentTo(email);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">eunomia</CardTitle>
          <CardDescription>
            {sentTo
              ? `Sign-in link sent to ${sentTo} — click it to finish signing in.`
              : setupPending && !useEmail
                ? "This server has no accounts yet. Create the first one (it becomes the admin) with the setup code from the server's log."
                : 'Sign in with a single-use link sent to your email.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
          ) : (
            <div className="grid gap-4">
              {sso?.signInUrl ? (
                <>
                  <a href={sso.signInUrl} className={buttonVariants({ className: 'w-full' })}>
                    <KeyRound className="size-4" />
                    Sign in with {sso.name}
                  </a>
                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    <span className="bg-border h-px flex-1" />
                    or
                    <span className="bg-border h-px flex-1" />
                  </div>
                </>
              ) : null}
              {setupPending && !useEmail ? (
                <SetupCodeForm onSignedIn={onSignedIn} onUseEmail={() => setUseEmail(true)} />
              ) : (
                <form className="grid gap-4" onSubmit={submit}>
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={pending}>
                    {pending ? 'Sending…' : 'Send sign-in link'}
                  </Button>
                  {(error ?? message) ? (
                    <p className="text-destructive text-sm" role="alert">
                      {error ?? message}
                    </p>
                  ) : null}
                </form>
              )}
              {sso?.source === 'NONE' && sso.canPair ? (
                <Collapsible className="border-t pt-4">
                  <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex w-full items-center justify-between text-sm">
                    Set up single sign-on
                    <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <p className="text-muted-foreground mb-3 text-xs">
                      This server has no accounts yet, so anyone can connect a provider now. The
                      first account to sign in becomes its admin, and only the admin can change this
                      later.
                    </p>
                    <PairSsoForm onPaired={loadSso} />
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

/** The first account, from the code a brand-new server printed to its log. */
function SetupCodeForm({ onSignedIn, onUseEmail }: { onSignedIn(): void; onUseEmail(): void }) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await claimSetupCode(code, email);
      onSignedIn();
    } catch (cause) {
      setError(errorMessage(cause));
      setPending(false);
    }
  };

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="setup-code">Setup code</Label>
        <Input
          id="setup-code"
          required
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="ABCD-EFGH-JKMN"
          className="font-mono uppercase"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">
          Printed when the server started: <code>docker compose logs app</code>.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="setup-email">Your email</Label>
        <Input
          id="setup-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create account'}
      </Button>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="button" variant="link" size="sm" onClick={onUseEmail}>
        Use an email link instead
      </Button>
    </form>
  );
}
