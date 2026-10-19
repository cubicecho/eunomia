import { Bot, Unplug } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { clearLlmSettings, fetchLlmSettings, setLlmSettings } from '@/api';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { FieldRow } from '@/components/field-row';
import { FormField } from '@/components/form-field';
import { QueryError } from '@/components/query-state';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAction, useQuery } from '@/hooks/use-query';

// Settings → Language model (issue #41). eunomia runs no model of its own; it
// calls an OpenAI-compatible endpoint the admin names here. Everyone sees
// whether one is set up; only the admin changes it, and only when the
// environment (LLM_BASE_URL) doesn't already.

const OLLAMA = 'http://localhost:11434/v1';

export function LlmCard() {
  const settings = useQuery(fetchLlmSettings, []);
  const action = useAction();
  const formId = useId();
  const data = settings.data;
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  useEffect(() => {
    setBaseUrl(data?.baseUrl ?? '');
    setModel(data?.model ?? '');
    setApiKey('');
  }, [data?.baseUrl, data?.model]);

  const save = () =>
    action.run(
      // A blank key field keeps the stored key: the dashboard never has it to send back.
      () => setLlmSettings(baseUrl.trim(), model.trim(), apiKey.trim() ? apiKey.trim() : undefined),
      { onDone: settings.reload, success: 'Language model saved.' },
    );

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
            <QueryError
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
                      controlSlot={
                        <Input
                          required
                          placeholder="llama3.1:8b"
                          value={model}
                          onChange={(event) => setModel(event.target.value)}
                        />
                      }
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
          <StatusLine status={action.status} />
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
