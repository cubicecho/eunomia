import { KeyRound } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  claimSetupCode,
  fetchSetupCodePending,
  fetchSsoSetup,
  requestMagicLink,
  type SsoSetup,
  verifyMagicLink,
} from '@/api';
import { CenteredLayout } from '@/components/centered-layout';
import { Disclosure } from '@/components/disclosure';
import { FormField } from '@/components/form-field';
import { PairSsoForm } from '@/components/sso-card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    <CenteredLayout
      level={1}
      title="eunomia"
      description={
        sentTo
          ? `Sign-in link sent to ${sentTo} — click it to finish signing in.`
          : setupPending && !useEmail
            ? "This server has no accounts yet. Create the first one (it becomes the admin) with the setup code from the server's log."
            : 'Sign in with a single-use link sent to your email.'
      }
      contentClassName="gap-4"
      contentSlot={
        sentTo ? (
          <Button
            variant="outline"
            onClick={() => setSentTo(null)}
            content="Use a different email"
          />
        ) : (
          <>
            {sso?.signInUrl ? (
              <>
                <Button
                  linkSlot={<a href={sso.signInUrl} />}
                  iconSlot={<KeyRound />}
                  content={`Sign in with ${sso.name}`}
                />
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
                <FormField
                  label="Email"
                  required
                  controlSlot={
                    <Input
                      type="email"
                      required
                      autoFocus
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  }
                />
                <Button
                  type="submit"
                  loading={pending}
                  loadingLabel="Sending…"
                  content="Send sign-in link"
                />
                {(error ?? message) ? (
                  <Alert variant="destructive" title={error ?? message} />
                ) : null}
              </form>
            )}
            {sso?.source === 'NONE' && sso.canPair ? (
              <Disclosure
                className="border-t pt-4"
                title="Set up single sign-on"
                description="This server has no accounts yet, so anyone can connect a provider now. The first account to sign in becomes its admin, and only the admin can change this later."
                contentSlot={<PairSsoForm onPaired={loadSso} />}
              />
            ) : null}
          </>
        )
      }
    />
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
      <FormField
        label="Setup code"
        required
        description={
          <>
            Printed when the server started: <code>docker compose logs app</code>.
          </>
        }
        controlSlot={
          <Input
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="ABCD-EFGH-JKMN"
            className="font-mono uppercase"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        }
      />
      <FormField
        label="Your email"
        required
        controlSlot={
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        }
      />
      <Button type="submit" loading={pending} loadingLabel="Creating…" content="Create account" />
      {error ? <Alert variant="destructive" title={error} /> : null}
      <Button
        variant="outline"
        size="sm"
        onClick={onUseEmail}
        content="Use an email link instead"
      />
    </form>
  );
}
