import { type FormEvent, useState } from 'react';
import { requestMagicLink, verifyMagicLink } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/hooks/use-query';

interface Props {
  message?: string;
  onSignedIn(): void;
}

/** Passwordless: the server emails a single-use link (see README). */
export function SignIn({ message, onSignedIn }: Props) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
              : 'Sign in with a single-use link sent to your email.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sentTo ? (
            <Button variant="outline" className="w-full" onClick={() => setSentTo(null)}>
              Use a different email
            </Button>
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
        </CardContent>
      </Card>
    </main>
  );
}
