import { Check, Copy, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type ApiKey, createApiKey, fetchApiKeys, renameApiKey, revokeApiKey } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAction, useQuery } from '@/hooks/use-query';
import { ago } from '@/lib/format';

// Keys for everything that isn't an agent: an MCP client, a script, another
// app on the network. Agents get their key from the pairing flow instead, and
// those keys are not listed here — this tab is about integrations, and the
// Devices tab is about machines.

/** The lifetimes offered. Anything is allowed; these are the ones worth a click. */
const EXPIRY_CHOICES = [
  { value: 'never', label: 'Never expires', days: null },
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: '365', label: '1 year', days: 365 },
] as const;

export function ApiKeysView() {
  const { data, error, reload } = useQuery(() => fetchApiKeys(), []);
  const action = useAction();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string>('never');
  // The key the server just minted. It exists nowhere else — the server stores
  // a hash — so it is held here until the user dismisses it.
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!data) return null;

  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });
  const trimmed = name.trim();
  const days = EXPIRY_CHOICES.find((choice) => choice.value === expiry)?.days ?? null;

  const issue = () => {
    if (!trimmed) return;
    action.run(
      async () => {
        const created = await createApiKey(trimmed, days);
        setIssued({ name: created.key.name, token: created.token });
        setName('');
      },
      { onDone: reload },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            For other apps that read this server — an MCP client, a script, anything that sends{' '}
            <code className="text-xs">x-api-key</code> to <code className="text-xs">/graphql</code>{' '}
            or <code className="text-xs">/mcp</code>. A key can do everything you can with your own
            data, so give each integration its own and revoke the one you stop trusting. Agents are
            paired from their setup screen and their keys live under Devices.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              issue();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                className="w-56"
                placeholder="what will use it"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-expiry">Expiry</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="api-key-expiry" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!trimmed || action.pending}>
              <KeyRound className="size-4" />
              Create key
            </Button>
          </form>

          {data.length === 0 ? (
            <EmptyState>No API keys yet — create one to let another app read your data.</EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {data.map((key) => (
                <KeyRow key={key.id} apiKey={key} run={run} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <StatusLine status={action.status} />
      <IssuedKey issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

interface RowProps {
  apiKey: ApiKey;
  run(mutation: () => Promise<unknown>): void;
}

function KeyRow({ apiKey, run }: RowProps) {
  const [name, setName] = useState(apiKey.name);
  useEffect(() => setName(apiKey.name), [apiKey.name]);

  const trimmed = name.trim();
  const renamed = trimmed.length > 0 && trimmed !== apiKey.name;
  const created = new Date(apiKey.createdAt).toISOString().slice(0, 10);
  const usedMs = apiKey.lastUsedAt ? Date.now() - new Date(apiKey.lastUsedAt).getTime() : null;
  // An expiry the server has already passed: the row is still listed (the key
  // is only deleted when someone revokes it) but it no longer authenticates.
  const expired = apiKey.expiresAt !== null && new Date(apiKey.expiresAt).getTime() < Date.now();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-dashed py-2 last:border-0">
      <Input
        className="w-56"
        aria-label={`Name of ${apiKey.name}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={!renamed}
        onClick={() => run(() => renameApiKey(apiKey.id, trimmed))}
      >
        Rename
      </Button>
      <code className="text-muted-foreground text-xs">{apiKey.start ?? '·····'}…</code>
      <span className="text-muted-foreground grow text-sm">
        created {created}
        {apiKey.expiresAt !== null &&
          ` · ${expired ? 'expired' : 'expires'} ${new Date(apiKey.expiresAt)
            .toISOString()
            .slice(0, 10)}`}
      </span>
      <span className={expired ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
        {usedMs === null ? 'never used' : `used ${ago(usedMs)}`}
      </span>
      <ConfirmDelete
        name={apiKey.name}
        description="Whatever holds this key is refused on its next request. Nothing it recorded is deleted — but if something is still using it, it stops working immediately and will need a new key."
        onConfirm={() => run(() => revokeApiKey(apiKey.id))}
      >
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          Revoke
        </Button>
      </ConfirmDelete>
    </div>
  );
}

/**
 * The one moment the key exists outside the client that will hold it: the
 * server keeps a hash, so a user who closes this without copying has to issue
 * another. Hence a modal rather than a line in the list.
 */
function IssuedKey({
  issued,
  onClose,
}: {
  issued: { name: string; token: string } | null;
  onClose(): void;
}) {
  // The token that was copied rather than a flag, so the next key issued shows
  // "Copy" again without an effect to reset it.
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const copied = issued !== null && copiedToken === issued.token;

  const copy = () => {
    if (!issued) return;
    navigator.clipboard.writeText(issued.token).then(
      () => setCopiedToken(issued.token),
      // Clipboard access can be refused (an insecure origin, a denied
      // permission). The key is on screen and selectable either way.
      () => setCopiedToken(null),
    );
  };

  return (
    <Dialog open={issued !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy “{issued?.name}” now</DialogTitle>
          <DialogDescription>
            This is the only time the key is shown — the server stores a hash of it, not the key. If
            you lose it, revoke this one and create another.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="bg-muted grow overflow-x-auto rounded px-3 py-2 font-mono text-xs">
            {issued?.token}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Send it as the <code className="text-xs">x-api-key</code> header.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
