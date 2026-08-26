import { afterEach, describe, expect, it, vi } from 'vitest';
import { secretProblem, secretWarning } from '../src/env.ts';
import { createRateLimiter } from '../src/rate-limit.ts';
import { emailAllowed, registrationPolicyFromEnv } from '../src/registration.ts';

// The three knobs that decide whether an internet-reachable install is safe:
// who may register, how often a stranger may ask for a login, and whether the
// session secret is a real one.

describe('emailAllowed', () => {
  it('allows anything when no list is configured', () => {
    expect(emailAllowed('anyone@example.com', [])).toBe(true);
  });

  it('matches an exact address, ignoring case and padding', () => {
    expect(emailAllowed('  Me@Example.com ', ['me@example.com'])).toBe(true);
    expect(emailAllowed('you@example.com', ['me@example.com'])).toBe(false);
  });

  it('matches a whole domain via *@domain', () => {
    expect(emailAllowed('anyone@example.com', ['*@example.com'])).toBe(true);
    expect(emailAllowed('anyone@evil.com', ['*@example.com'])).toBe(false);
  });

  // A domain entry must not be satisfied by an address that merely ends in it.
  it('does not treat a lookalike domain as the allowed one', () => {
    expect(emailAllowed('me@notexample.com', ['*@example.com'])).toBe(false);
    expect(emailAllowed('me@example.com.evil.com', ['*@example.com'])).toBe(false);
  });
});

describe('registrationPolicyFromEnv', () => {
  it('defaults to open registration', () => {
    expect(registrationPolicyFromEnv({})).toEqual({ allowedEmails: [], disableSignUp: false });
  });

  it('splits and normalizes ALLOWED_EMAILS, and reads DISABLE_SIGNUP', () => {
    expect(
      registrationPolicyFromEnv({
        ALLOWED_EMAILS: ' Me@Example.com , ,*@work.test ',
        DISABLE_SIGNUP: 'true',
      }),
    ).toEqual({ allowedEmails: ['me@example.com', '*@work.test'], disableSignUp: true });
  });

  it('only "true" closes sign-ups', () => {
    expect(registrationPolicyFromEnv({ DISABLE_SIGNUP: '1' }).disableSignUp).toBe(false);
  });
});

describe('secret checks', () => {
  it('refuses an unset or example secret', () => {
    expect(secretProblem(undefined)).toMatch(/not set/);
    expect(secretProblem('   ')).toMatch(/not set/);
    expect(secretProblem('dev-secret-change-me')).toMatch(/example value/);
    expect(secretProblem('CHANGEME')).toMatch(/example value/);
  });

  it('accepts a real secret', () => {
    expect(secretProblem('K2m/9xQ0zvT1a7bR4pN8sLdE6wYhUgJcX3fVoiZmQnA=')).toBeNull();
  });

  it('warns about a short secret without blocking it', () => {
    expect(secretWarning('short')).toMatch(/5 characters/);
    expect(secretProblem('short')).toBeNull();
    expect(secretWarning('K2m/9xQ0zvT1a7bR4pN8sLdE6wYhUgJcX3fVoiZmQnA=')).toBeNull();
  });
});

describe('createRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows up to the limit, then refuses until the window rolls over', () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(3, 60_000);

    expect([1, 2, 3].map(() => limiter.allow('a'))).toEqual([true, true, true]);
    expect(limiter.allow('a')).toBe(false);

    // A different key has its own budget.
    expect(limiter.allow('b')).toBe(true);

    vi.advanceTimersByTime(60_001);
    expect(limiter.allow('a')).toBe(true);
  });

  it('forgets keys once their window has passed', () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter(1, 1_000);
    limiter.allow('a');
    vi.advanceTimersByTime(1_001);
    // The sweep runs on this write; 'a' is gone rather than accumulating.
    limiter.allow('b');
    expect(limiter.allow('a')).toBe(true);
  });
});
