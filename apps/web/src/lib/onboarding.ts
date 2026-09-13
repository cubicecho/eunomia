import type { AppSummaryRow, Device, RulePack } from '@/api';
import { uncategorizedEntries } from '@/lib/summary';

// The getting-started checklist, as data: which steps are done, worked out
// from what the account actually holds rather than from clicks remembered
// somewhere. Deleting the only device un-ticks "connect a device"; a rule pack
// installed from the rules tab ticks its step without the checklist having
// been involved. Only the privacy step is a stored tick (Me.privacyReviewed):
// the lists live in each agent's config.json and never reach the server, so
// there is nothing for it to look at.

export type StepId = 'device' | 'data' | 'pack' | 'review' | 'privacy';

export interface StepState {
  id: StepId;
  done: boolean;
}

export interface OnboardingInput {
  devices: Device[];
  /** appSummary over a recent window (the checklist asks for the last week). */
  recent: AppSummaryRow[];
  packs: RulePack[];
  privacyReviewed: boolean;
}

/** The steps in the order a new account meets them. */
export function onboardingSteps(input: OnboardingInput): StepState[] {
  // A device that has checked in has sent something, even if the window
  // holds none of it — an agent that ran last month, then sat unused.
  const hasData =
    input.recent.some((row) => row.seconds > 0) ||
    input.devices.some((device) => device.lastSeenAt !== null);
  return [
    { id: 'device', done: input.devices.length > 0 },
    { id: 'data', done: hasData },
    { id: 'pack', done: input.packs.some((pack) => pack.installedVersion !== null) },
    // Done when the week's queue is empty — but only once there is a week to
    // speak of: an account with no data has nothing uncategorized either, and
    // ticking the step then would be a lie about work nobody did.
    {
      id: 'review',
      done:
        input.recent.some((row) => row.seconds > 0) &&
        uncategorizedEntries(input.recent).length === 0,
    },
    { id: 'privacy', done: input.privacyReviewed },
  ];
}
