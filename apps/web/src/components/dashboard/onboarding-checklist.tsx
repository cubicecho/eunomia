import { CircleCheck, CircleDashed, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { fetchAppSummary, fetchDevices, fetchRulePacks, setOnboarding } from '@/api';
import { StatusLine } from '@/components/status-line';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAction, useQuery } from '@/hooks/use-query';
import { rangeOfLastDays } from '@/lib/format';
import { onboardingSteps, type StepId } from '@/lib/onboarding';
import { useSession } from '@/session';

/** The tabs a step can send the user to — App.tsx's VIEWS values. */
export type View = 'review' | 'rules' | 'devices';

interface Props {
  onNavigate(view: View): void;
}

interface StepCopy {
  title: string;
  body: ReactNode;
  /** A tab that finishes the step, when one does. */
  go?: { view: View; label: string };
}

const COPY: Record<StepId, StepCopy> = {
  device: {
    title: 'Connect a device',
    body: 'Run the desktop or Android agent and sign it in to this server. It shows up under Devices.',
    go: { view: 'devices', label: 'Devices' },
  },
  data: {
    title: 'See your first data',
    body: 'Use the device for a few minutes. The agent sends what it records every few minutes, and the charts below fill in.',
  },
  pack: {
    title: 'Install a rule pack',
    body: 'Starter packs sort common apps and sites (development, communication, social…) into categories, so most of your time is labelled from the start.',
    go: { view: 'rules', label: 'Rule packs' },
  },
  review: {
    title: 'Review what’s uncategorized',
    body: 'Label the apps no rule matched. Done when nothing from the last week is left uncategorized.',
    go: { view: 'review', label: 'Review' },
  },
  privacy: {
    title: 'Set your privacy lists',
    body: (
      <>
        Choose apps to ignore entirely, and apps whose window titles and sites are stripped before
        anything leaves the device. The lists live on each device, not on this server: open{' '}
        <span className="text-foreground">Privacy…</span> on the agent’s status screen (or edit{' '}
        <code className="text-xs">ignoreApps</code> and <code className="text-xs">redactApps</code>{' '}
        in its <code className="text-xs">config.json</code>). The server can’t see them, so tick
        this yourself.
      </>
    ),
  },
};

/**
 * Five steps from a new account to a useful dashboard. Every tick but one
 * comes from the account's own data (lib/onboarding.ts), so the list is right
 * however a step got done. Putting it away is stored on the user, so it stays
 * away on every browser; Settings brings it back.
 */
export function OnboardingChecklist({ onNavigate }: Props) {
  const { me, setMe } = useSession();
  const action = useAction();
  const hidden = me.onboardingDismissed;
  const { data, error } = useQuery(() => {
    if (hidden) return Promise.resolve(null);
    const week = rangeOfLastDays(7, me.effectiveTimeZone);
    return Promise.all([fetchDevices(), fetchRulePacks(), fetchAppSummary(week.from, week.to)]);
  }, [hidden, me.effectiveTimeZone]);

  // A broken checklist is not worth an error on the dashboard: it is a guide,
  // and every step it would show is reachable from the tabs anyway.
  if (hidden || error || !data) return null;

  const [devices, packs, recent] = data;
  const steps = onboardingSteps({ devices, packs, recent, privacyReviewed: me.privacyReviewed });
  const remaining = steps.filter((step) => !step.done).length;
  const save = (flags: Parameters<typeof setOnboarding>[0]) =>
    action.run(async () => setMe(await setOnboarding(flags)));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            {remaining === 0
              ? 'All done — the dashboard has what it needs. You can put this away.'
              : `${steps.length - remaining} of ${steps.length} done.`}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={action.pending}
          onClick={() => save({ dismissed: true })}
        >
          <X className="size-4" />
          Dismiss
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol className="flex flex-col gap-3">
          {steps.map((step) => {
            const copy = COPY[step.id];
            const go = copy.go;
            return (
              <li key={step.id} className="flex gap-3">
                {step.done ? (
                  <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                ) : (
                  <CircleDashed
                    aria-hidden
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  />
                )}
                <div className="flex grow flex-col gap-1">
                  <span
                    className={step.done ? 'text-muted-foreground text-sm line-through' : 'text-sm'}
                  >
                    {copy.title}
                    <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                  </span>
                  {!step.done && <p className="text-muted-foreground text-sm">{copy.body}</p>}
                </div>
                {step.id === 'privacy' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={action.pending}
                    onClick={() => save({ privacyReviewed: !step.done })}
                  >
                    {step.done ? 'Undo' : 'Mark done'}
                  </Button>
                ) : (
                  !step.done &&
                  go && (
                    <Button variant="outline" size="sm" onClick={() => onNavigate(go.view)}>
                      {go.label}
                    </Button>
                  )
                )}
              </li>
            );
          })}
        </ol>
        <StatusLine status={action.status} />
      </CardContent>
    </Card>
  );
}
