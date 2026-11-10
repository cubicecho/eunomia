import { Plug, Unplug } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  clearLlmSettings,
  fetchLlmModels,
  fetchLlmSettings,
  GraphQLError,
  type LlmModel,
  setLlmSettings,
  UNAUTHENTICATED,
} from '@/api';
import { CardLayout } from '@/components/card-layout';
import { Combobox } from '@/components/combobox';
import { ConfirmButton } from '@/components/confirm-button';
import { FieldRow } from '@/components/field-row';
import { FormField } from '@/components/form-field';
import { LoadError } from '@/components/load-state';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Bot } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { errorMessage, useAction, useQuery } from '@/hooks/use-query';
import type { SelectEntry } from '@/lib/select-options';
import { useSession } from '@/session';

// Settings → Language model (issue #41). eunomia runs no model of its own; it
// calls an OpenAI-compatible endpoint the admin names here. Everyone sees
// whether one is set up; only the admin changes it, and only when the
// environment (LLM_BASE_URL) doesn't already.
//
// The model is picked from what the endpoint lists, fetched when the menu
// opens rather than on mount, and asked of the address and key as typed — so
// the list, and "Test connection", answer for the form before it is saved. A
// name the endpoint doesn't list can still be typed: some servers list
// nothing, and some load a model only when it is first asked for.

const OLLAMA = 'http://localhost:11434/v1';

/** One answer from the endpoint, stamped with the form values it was asked for. */
interface Listing {
  key: string;
  models?: LlmModel[];
  error?: string;
}

const listed = (count: number) =>
  count === 0
    ? 'Connected, but the endpoint lists no models. Type the one to use.'
    : `Connected: the endpoint lists ${count} model${count === 1 ? '' : 's'}.`;

export function LlmCard() {
  const settings = useQuery(fetchLlmSettings, []);
  const action = useAction();
  const formId = useId();
  const data = settings.data;
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const { expire } = useSession();
  const [listing, setListing] = useState<Listing | null>(null);
  const [listingPending, setListingPending] = useState(false);
  const [tested, setTested] = useState<{ key: string; text: string; failed: boolean } | null>(null);
  useEffect(() => {
    setBaseUrl(data?.baseUrl ?? '');
    setModel(data?.model ?? '');
    setApiKey('');
  }, [data?.baseUrl, data?.model]);

  // Answers for other values than the ones in the form are stale, not wrong:
  // they are kept until the next ask, and simply not shown.
  const typed = `${baseUrl.trim()}\n${apiKey.trim()}`;
  const current = listing?.key === typed ? listing : null;
  const testedNow = tested?.key === typed ? tested : null;

  const listModels = (report: boolean) => {
    const key = typed;
    setListingPending(true);
    fetchLlmModels(baseUrl.trim(), apiKey.trim() || undefined)
      .then((models) => {
        setListing({ key, models });
        if (report) setTested({ key, text: listed(models.length), failed: false });
      })
      .catch((cause: unknown) => {
        if (cause instanceof GraphQLError && cause.code === UNAUTHENTICATED) {
          expire('session expired — sign in again');
          return;
        }
        const text = errorMessage(cause);
        setListing({ key, error: text });
        if (report) setTested({ key, text, failed: true });
      })
      .finally(() => setListingPending(false));
  };

  const modelOptions: SelectEntry[] = [
    ...(current?.models ?? []).map((entry) => ({
      value: entry.id,
      label: entry.id,
      className: 'font-mono',
      ...(entry.contextLength
        ? { meta: `${Math.round(entry.contextLength / 1024)}k context` }
        : {}),
    })),
    ...(!baseUrl.trim() ? [{ note: 'Enter the base URL to see what it serves.' }] : []),
    ...(listingPending && !current ? [{ note: 'Loading…' }] : []),
    ...(current?.error ? [{ note: current.error, className: 'text-destructive' }] : []),
    ...(current?.models?.length === 0 ? [{ note: 'The endpoint lists no models.' }] : []),
  ];

  const save = () => {
    setTested(null);
    action.run(
      // A blank key field keeps the stored key: the dashboard never has it to send back.
      () => setLlmSettings(baseUrl.trim(), model.trim(), apiKey.trim() ? apiKey.trim() : undefined),
      { onDone: settings.reload, success: 'Language model saved.' },
    );
  };

  const status =
    data?.source === 'ENV'
      ? `Set by LLM_BASE_URL in the server's environment: ${data.model} at ${data.baseUrl}.`
      : data?.source === 'STORED'
        ? `Using ${data.model} at ${data.baseUrl}${data.hasApiKey ? ', with an API key' : ''}.`
        : 'Not set up: rule suggestions and standup drafts are off.';

  return (
    <CardLayout
      iconSlot={<Bot />}
      title="Language model"
      description="Optional. Point eunomia at any OpenAI-compatible endpoint — a local Ollama, LM Studio or vLLM, or a hosted API — and it can suggest rules for uncategorized time and draft a daily standup. eunomia never runs a model itself, and never applies a suggestion without you."
      loading={settings.isPending}
      contentClassName="gap-4"
      contentSlot={
        <>
          {settings.error && !data ? (
            <LoadError
              compact
              error={settings.error}
              onRetry={settings.refetch}
              what="the language model settings"
            />
          ) : null}
          <p className="text-sm">{status}</p>
          {data?.canEdit ? (
            <form
              id={formId}
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <FieldRow
                contentSlot={
                  <>
                    <FormField
                      label="Base URL"
                      required
                      description={
                        <>
                          Ollama on this machine is <code className="text-xs">{OLLAMA}</code>.
                        </>
                      }
                      controlSlot={
                        <Input
                          type="url"
                          required
                          placeholder={OLLAMA}
                          value={baseUrl}
                          onChange={(event) => setBaseUrl(event.target.value)}
                        />
                      }
                    />
                    <FormField
                      label="Model"
                      required
                      description="As the endpoint names it, like llama3.1:8b or qwen2.5:7b."
                      controlSlot={(wired) => (
                        <Combobox
                          {...wired}
                          freeText
                          searchable
                          placeholder="llama3.1:8b"
                          searchPlaceholder="Find or type a model…"
                          searchLabel="Model"
                          popoverLabel="Models"
                          emptyMessage="The endpoint lists no model by that name."
                          options={modelOptions}
                          value={model}
                          onValueChange={setModel}
                          onOpenChange={(open) => {
                            if (open && baseUrl.trim() && !current && !listingPending) {
                              listModels(false);
                            }
                          }}
                        />
                      )}
                    />
                  </>
                }
              />
              <FormField
                label="API key"
                description={
                  data.hasApiKey
                    ? 'A key is stored. Leave this blank to keep it. It is never shown again.'
                    : 'Only for a hosted API; a local server needs none.'
                }
                controlSlot={
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={data.hasApiKey ? '•••••••• (unchanged)' : ''}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                }
              />
            </form>
          ) : null}
          <StatusLine status={testedNow ?? action.status} />
        </>
      }
      footerSlot={
        data?.canEdit && data.source === 'STORED' ? (
          <ConfirmButton
            variant="destructive-outline"
            iconSlot={<Unplug />}
            content="Forget"
            title="Forget the language model?"
            confirmLabel="Forget"
            description="Rule suggestions and standup drafts turn off, and the stored API key is deleted. Rules already saved from suggestions stay."
            onConfirm={() =>
              action.run(clearLlmSettings, {
                onDone: settings.reload,
                success: 'Language model forgotten.',
              })
            }
          />
        ) : null
      }
      footerActionsSlot={
        data?.canEdit ? (
          <>
            <Button
              variant="outline"
              iconSlot={<Plug />}
              disabled={!baseUrl.trim()}
              loading={listingPending}
              onClick={() => listModels(true)}
              content="Test connection"
            />
            {data.hasApiKey ? (
              <Button
                variant="outline"
                disabled={action.pending}
                onClick={() =>
                  action.run(() => setLlmSettings(baseUrl.trim(), model.trim(), null), {
                    onDone: settings.reload,
                    success: 'API key removed.',
                  })
                }
                content="Remove key"
              />
            ) : null}
            <Button
              type="submit"
              form={formId}
              variant="positive"
              disabled={!baseUrl.trim() || !model.trim()}
              loading={action.pending}
              content="Save"
            />
          </>
        ) : null
      }
    />
  );
}
