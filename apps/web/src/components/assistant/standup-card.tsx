import { NotebookPen } from 'lucide-react';
import { useState } from 'react';
import { draftStandup } from '@/api';
import { IncludeTitles } from '@/components/assistant/include-titles';
import { CardLayout } from '@/components/card-layout';
import { FormField } from '@/components/form-field';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code';
import { CopyButton } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { useAction } from '@/hooks/use-query';
import { dayIn } from '@/lib/format';
import { useTimeZone } from '@/session';

/**
 * A day's standup, drafted by the configured language model from that day's
 * totals (issue #41). A draft to copy and edit, not a record: nothing is saved.
 */
export function StandupCard() {
  const timeZone = useTimeZone();
  const action = useAction();
  const [day, setDay] = useState(() => dayIn(new Date(), timeZone));
  const [titles, setTitles] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <CardLayout
      title="Draft a standup"
      description="Your language model writes a few bullet points from one day's tracked time, for you to copy and edit."
      contentClassName="gap-3"
      contentSlot={
        <>
          <FormField
            label="Day"
            controlSlot={
              <Input
                type="date"
                className="w-44"
                value={day}
                onChange={(event) => event.target.value && setDay(event.target.value)}
              />
            }
          />
          <IncludeTitles checked={titles} onChange={setTitles} />
          {draft !== null ? (
            <CodeBlock
              wrap
              content={draft}
              actionSlot={<CopyButton value={draft} label="Copy the draft" />}
            />
          ) : null}
          <StatusLine status={action.status} />
        </>
      }
      footerActionsSlot={
        <Button
          variant="info"
          loading={action.pending}
          loadingLabel="Drafting…"
          onClick={() => action.run(async () => setDraft(await draftStandup(day, titles)))}
          iconSlot={<NotebookPen />}
          content={draft === null ? 'Draft' : 'Draft again'}
        />
      }
    />
  );
}
