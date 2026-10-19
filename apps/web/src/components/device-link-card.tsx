import { Link } from 'lucide-react';
import { useState } from 'react';
import { fetchDeviceSignInLink } from '@/api';
import { CardLayout } from '@/components/card-layout';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { errorMessage } from '@/hooks/use-query';

/**
 * A sign-in link for a new agent, made here rather than emailed: on a server
 * without SMTP the agent's own "email me a link" would only print it to the
 * server's log. Single use, 15 minutes.
 */
export function DeviceLinkCard() {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const make = async () => {
    setPending(true);
    setError(null);
    try {
      setLink(await fetchDeviceSignInLink());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <CardLayout
      title="Sign in a device"
      description="A sign-in link to paste into a new agent's setup screen, instead of having one emailed. It works once, within 15 minutes, and signs that agent in as you."
      contentClassName="gap-3"
      contentSlot={
        <>
          {link ? (
            <CodeBlock
              wrap
              content={link}
              actionSlot={<CopyButton value={link} label="Copy link" />}
            />
          ) : null}
          <div>
            <Button
              variant={link ? 'outline' : 'default'}
              onClick={make}
              loading={pending}
              loadingLabel="Making…"
              iconSlot={<Link />}
              content={link ? 'Make another' : 'Make a sign-in link'}
            />
          </div>
          {error ? <Alert variant="destructive" title={error} /> : null}
        </>
      }
    />
  );
}
