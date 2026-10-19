import { randomInt, timingSafeEqual } from 'node:crypto';

// The one-time setup code: how the person who installed eunomia makes the
// first account without email set up. A brand-new server prints one to its
// log at boot; the sign-in page asks for it, and whoever has it — which is
// whoever can read the container's log — creates the first account (and so
// the admin) directly. It is good until that account exists, and a restart
// before then prints a new one.

/** No 0/O, 1/I/L or U: read off a terminal and typed into a phone. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const GROUPS = 3;
const GROUP_LENGTH = 4;

export function generateSetupCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}

/** Case, spaces and dashes don't matter. */
function normalize(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export class SetupCode {
  private code: string | null;

  constructor(code: string | null = generateSetupCode()) {
    this.code = code;
  }

  /** The code to print, or null once it has been used. */
  get value(): string | null {
    return this.code;
  }

  /** Spends the code if `input` is it. A wrong guess leaves it as it was. */
  take(input: string): boolean {
    if (!this.code) return false;
    const expected = Buffer.from(normalize(this.code));
    const given = Buffer.from(normalize(input));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    this.code = null;
    return true;
  }

  /** Puts a spent code back, when making the account it was spent on failed. */
  restore(code: string): void {
    this.code ??= code;
  }
}

/** What the server prints at boot, loud enough to find in `docker compose logs`. */
export function setupCodeBanner(code: string, signInUrl: string): string {
  return [
    '',
    '──────────────────────────────────────────',
    '🔑  No accounts yet. Create the first one (it becomes the admin) at',
    `    ${signInUrl}`,
    `    with this setup code: ${code}`,
    '──────────────────────────────────────────',
    '',
  ].join('\n');
}
