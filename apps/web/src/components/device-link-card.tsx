import { Check, Copy, Link } from 'lucide-react';
import { useState } from 'react';
import { fetchDeviceSignInLink } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/hooks/use-query';

/**
 * A sign-in link for a new agent, made here rather than emailed: on a server
 * without SMTP the agent's own "email me a link" would only print it to the
 * server's log. Single use, 15 minutes.
 */
export function DeviceLinkCard() {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const make = async () => {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      setLink(await fetchDeviceSignInLink());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard (plain http): the field is selectable instead.
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in a device</CardTitle>
        <CardDescription>
          A sign-in link to paste into a new agent's setup screen, instead of having one emailed. It
          works once, within 15 minutes, and signs that agent in as you.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {link ? (
          <div className="flex gap-2">
            <Input
              readOnly
              value={link}
              aria-label="Sign-in link"
              className="font-mono text-xs"
              onFocus={(event) => event.target.select()}
            />
            <Button variant="outline" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : null}
        <div>
          <Button variant={link ? 'ghost' : 'default'} onClick={make} disabled={pending}>
            <Link className="size-4" />
            {link ? 'Make another' : pending ? 'Making…' : 'Make a sign-in link'}
          </Button>
        </div>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
