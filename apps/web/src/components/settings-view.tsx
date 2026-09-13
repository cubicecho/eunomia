import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { setOnboarding, setTimeZone } from '@/api';
import { ExportCard } from '@/components/export-card';
import { ImportCard } from '@/components/import-card';
import { DeleteAccountCard } from '@/components/privacy/delete-account-card';
import { DeleteRangeCard } from '@/components/privacy/delete-range-card';
import { PurgeAppCard } from '@/components/privacy/purge-app-card';
import { RetentionCard } from '@/components/privacy/retention-card';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAction } from '@/hooks/use-query';
import { browserTimeZone } from '@/lib/format';
import { useSession } from '@/session';

// What the server keeps about the user rather than their data — the time zone
// their days split in — the ways to take the data itself away and bring it
// back, and the ways to get rid of it: how long it's kept, a range, an app, or
// the whole account. Every one of those deletes goes through a confirmation
// dialog, and the server takes them from a signed-in session only.

/**
 * Every zone this browser can format dates in — the suggestions for the input.
 * The server accepts the same IANA names and says so if one isn't.
 */
const ZONES: readonly string[] = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
})();

export function SettingsView() {
  const { me, setMe } = useSession();
  const action = useAction();
  const browser = browserTimeZone();
  // Prefilled with this browser's zone until the user has chosen one: the
  // likeliest answer, one click from saved.
  const [draft, setDraft] = useState(me.timeZone ?? browser);
  const exportRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(me.timeZone ?? browser), [me.timeZone, browser]);

  const trimmed = draft.trim();
  const save = (timeZone: string | null) =>
    action.run(
      // The server's answer, not the draft: it stores a canonical spelling
      // ('us/central' is America/Chicago), and the input resets to that.
      async () => setMe(await setTimeZone(timeZone)),
      { success: timeZone === null ? "Following the server's time zone." : 'Time zone saved.' },
    );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Time zone</CardTitle>
          <CardDescription>
            Your days start at midnight in{' '}
            <span className="text-foreground">{me.effectiveTimeZone}</span>
            {me.timeZone === null && ", the server's default"}. Every chart and range on the
            dashboard counts days there, wherever you are looking from.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed) save(trimmed);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="time-zone">Zone</Label>
              <Input
                id="time-zone"
                className="w-64"
                list="time-zones"
                placeholder="e.g. America/Chicago"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <datalist id="time-zones">
                {ZONES.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </div>
            <Button type="submit" disabled={!trimmed || trimmed === me.timeZone || action.pending}>
              <Globe className="size-4" />
              Save
            </Button>
            {me.timeZone !== browser && (
              <Button
                type="button"
                variant="outline"
                disabled={action.pending}
                onClick={() => save(browser)}
              >
                Use this browser's ({browser})
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={me.timeZone === null || action.pending}
              onClick={() => save(null)}
            >
              Follow the server's
            </Button>
          </form>
          <p className="text-muted-foreground text-sm">
            Changing it moves the days of all activity still kept in full (see{' '}
            <code className="text-xs">ACTIVITY_RETENTION_DAYS</code>) onto the new zone's midnight.
            Days older than that are only kept as totals, which can't be split again, so they stay
            on the day they were first counted in.
          </p>
        </CardContent>
      </Card>
      {me.onboardingDismissed && (
        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>
              The dashboard's getting-started checklist is put away. Its steps are still worked out
              from your data, so bringing it back shows where things stand now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={action.pending}
              onClick={() =>
                action.run(async () => setMe(await setOnboarding({ dismissed: false })), {
                  success: 'The checklist is back on the dashboard.',
                })
              }
            >
              Show it again
            </Button>
          </CardContent>
        </Card>
      )}
      <StatusLine status={action.status} />
      <div ref={exportRef} className="scroll-mt-6">
        <ExportCard />
      </div>
      <ImportCard />
      <section className="flex flex-col gap-4" aria-labelledby="data-privacy">
        <div className="flex flex-col gap-1 pt-4">
          <h2 id="data-privacy" className="text-lg font-semibold tracking-tight">
            Data &amp; privacy
          </h2>
          <p className="text-muted-foreground text-sm">
            Deleting here is permanent: there is no undo and no backup to restore from.{' '}
            <button
              type="button"
              className="text-foreground underline underline-offset-4"
              onClick={() => exportRef.current?.scrollIntoView({ behavior: 'smooth' })}
            >
              Export
            </button>{' '}
            anything you might want first. To keep something from being recorded at all, pause the
            agent (its tray menu or status screen) or add the app to its ignored apps.
          </p>
        </div>
        <RetentionCard />
        <DeleteRangeCard />
        <PurgeAppCard />
        <DeleteAccountCard
          onExport={() => exportRef.current?.scrollIntoView({ behavior: 'smooth' })}
        />
      </section>
    </div>
  );
}
