import { describe, expect, it } from 'vitest';
import type { AppSummaryRow, Device, RulePack } from '@/api';
import { type OnboardingInput, onboardingSteps } from '@/lib/onboarding';

const device = (lastSeenAt: string | null = null) =>
  ({ id: 'd1', name: 'laptop', platform: 'linux', createdAt: '2026-09-01', lastSeenAt }) as Device;

const app = (seconds: number, categoryId: string | null = null) =>
  ({
    app: 'code',
    context: null,
    categoryId,
    categoryName: categoryId,
    categoryColor: null,
    seconds,
  }) as AppSummaryRow;

const pack = (installedVersion: number | null) => ({ id: 'dev', installedVersion }) as RulePack;

const done = (input: Partial<OnboardingInput>) =>
  onboardingSteps({ devices: [], recent: [], packs: [], privacyReviewed: false, ...input })
    .filter((step) => step.done)
    .map((step) => step.id);

describe('onboardingSteps', () => {
  it('starts with nothing done, in the order the steps are met', () => {
    expect(
      onboardingSteps({ devices: [], recent: [], packs: [], privacyReviewed: false }).map(
        (step) => [step.id, step.done],
      ),
    ).toEqual([
      ['device', false],
      ['data', false],
      ['pack', false],
      ['review', false],
      ['privacy', false],
    ]);
  });

  it('reads devices and data from what the account holds', () => {
    expect(done({ devices: [device()] })).toEqual(['device']);
    // Checked in before the window: data all the same.
    expect(done({ devices: [device('2026-08-01T10:00:00Z')] })).toEqual(['device', 'data']);
    expect(done({ devices: [device()], recent: [app(0)] })).toEqual(['device']);
  });

  it('ticks a pack only when one is installed', () => {
    expect(done({ packs: [pack(null), pack(null)] })).toEqual([]);
    expect(done({ packs: [pack(null), pack(1)] })).toEqual(['pack']);
  });

  it('counts review done when the week has data and none of it is uncategorized', () => {
    expect(done({ recent: [app(60, 'work'), app(30)] })).toEqual(['data']);
    expect(done({ recent: [app(60, 'work'), app(0)] })).toEqual(['data', 'review']);
  });

  it('takes privacy from the stored tick', () => {
    expect(done({ privacyReviewed: true })).toEqual(['privacy']);
  });
});
