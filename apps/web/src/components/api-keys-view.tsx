import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type ApiKey, createApiKey, fetchApiKeys, renameApiKey, revokeApiKey } from '@/api';
import { CardLayout } from '@/components/card-layout';
import { Combobox } from '@/components/combobox';
import { ConfirmButton } from '@/components/confirm-button';
import { DialogLayout } from '@/components/dialog-layout';
import { EmptyState } from '@/components/empty-state';
import { FieldRow } from '@/components/field-row';
import { FormField } from '@/components/form-field';
import { QueryError } from '@/components/query-state';
import { StatusLine } from '@/components/status-line';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
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
  const query = useQuery(() => fetchApiKeys(), []);
  const { data, reload } = query;
  const action = useAction();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string>('never');
  const [categorize, setCategorize] = useState(false);
  // The key the server just minted. It exists nowhere else — the server stores
  // a hash — so it is held here until the user dismisses it.
  const [issued, setIssued] = useState<{ name: string; token: string } | null>(null);

  if (query.error && !data) {
    return <QueryError error={query.error} onRetry={query.refetch} what="your API keys" />;
  }

  const run = (mutation: () => Promise<unknown>) => action.run(mutation, { onDone: reload });
  const trimmed = name.trim();
  const days = EXPIRY_CHOICES.find((choice) => choice.value === expiry)?.days ?? null;

  const issue = () => {
    if (!trimmed) return;
    action.run(
      async () => {
        const created = await createApiKey(trimmed, days, categorize);
        setIssued({ name: created.key.name, token: created.token });
        setName('');
        setCategorize(false);
      },
      { onDone: reload },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <CardLayout
        title="API keys"
        description={
          <>
            For other apps that read this server — an MCP client, a script, anything that sends{' '}
            <code className="text-xs">x-api-key</code> to <code className="text-xs">/graphql</code>{' '}
            or <code className="text-xs">/mcp</code>. A key can do everything you can with your own
            data, so give each integration its own and revoke the one you stop trusting. Agents are
            paired from their setup screen and their keys live under Devices.
          </>
        }
        contentClassName="gap-4"
        contentSlot={
          <>
            <form
              id="api-key-form"
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                issue();
              }}
            >
              <FieldRow
                contentSlot={
                  <>
                    <FormField
                      label="Name"
                      controlSlot={
                        <Input
                          placeholder="what will use it"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                        />
                      }
                    />
                    <FormField
                      label="Expiry"
                      controlSlot={(wired) => (
                        <Combobox
                          {...wired}
                          options={EXPIRY_CHOICES.map(({ value, label }) => ({ value, label }))}
                          value={expiry}
                          onValueChange={setExpiry}
                        />
                      )}
                    />
                  </>
                }
              />
              <FormField
                orientation="horizontal"
                label="Let it categorize"
                description="Over MCP, an assistant using this key can also create categories and rules, assign time and re-apply rules. Without this it can only read. Nothing else it could change, and it can't delete anything."
                controlSlot={
                  <Checkbox
                    checked={categorize}
                    onCheckedChange={(checked) => setCategorize(checked === true)}
                  />
                }
              />
              <div>
                <Button
                  type="submit"
                  variant="info"
                  disabled={!trimmed}
                  loading={action.pending}
                  iconSlot={<KeyRound />}
                  content="Create key"
                />
              </div>
            </form>
            <div className="flex flex-col gap-2">
              {(data ?? []).map((key) => (
                <KeyRow key={key.id} apiKey={key} run={run} />
              ))}
              {data?.length === 0 ? (
                <EmptyState
                  compact
                  title="No API keys yet — create one to let another app read your data."
                />
              ) : null}
            </div>
          </>
        }
        loading={query.isPending}
      />
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
        content="Rename"
      />
      <code className="text-muted-foreground text-xs">{apiKey.start ?? '·····'}…</code>
      {apiKey.scopes.includes('CATEGORIZE') ? <Badge variant="secondary">categorize</Badge> : null}
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
      <ConfirmButton
        variant="destructive-outline"
        size="sm"
        content="Revoke"
        title={`Revoke “${apiKey.name}”?`}
        confirmLabel="Revoke"
        description="Whatever holds this key is refused on its next request. Nothing it recorded is deleted — but if something is still using it, it stops working immediately and will need a new key."
        onConfirm={() => run(() => revokeApiKey(apiKey.id))}
      />
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
  return (
    <DialogLayout
      open={issued !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Copy “${issued?.name ?? ''}” now`}
      description="This is the only time the key is shown — the server stores a hash of it, not the key. If you lose it, revoke this one and create another."
      contentSlot={
        <>
          <CodeBlock
            wrap
            content={issued?.token ?? ''}
            actionSlot={<CopyButton value={issued?.token ?? ''} label="Copy key" />}
          />
          <p className="text-muted-foreground text-sm">
            Send it as the <code className="text-xs">x-api-key</code> header.
          </p>
        </>
      }
      footerActionsSlot={<Button onClick={onClose} content="Done" />}
    />
  );
}
