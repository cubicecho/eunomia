/**
 * Who may hold an account on this server.
 *
 * eunomia is single-tenant in spirit but multi-user by design, and its login is
 * passwordless — so a server reachable from the internet with no policy lets
 * anyone who finds the port create an account and start storing activity in it.
 * Both knobs default to off, which keeps a LAN install as easy as it was.
 */
export interface RegistrationPolicy {
  /**
   * Addresses allowed to hold an account: exact matches, or `*@example.com`
   * for a whole domain. Empty means any address is acceptable.
   */
  allowedEmails: string[];
  /** Only addresses that already have an account may sign in. */
  disableSignUp: boolean;
}

export const OPEN_REGISTRATION: RegistrationPolicy = { allowedEmails: [], disableSignUp: false };

/** Reads the policy from ALLOWED_EMAILS (comma-separated) and DISABLE_SIGNUP. */
export function registrationPolicyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RegistrationPolicy {
  return {
    allowedEmails: (env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
    disableSignUp: env.DISABLE_SIGNUP === 'true',
  };
}

/** Case-insensitive exact match, or `*@example.com` for every address at a domain. */
export function emailAllowed(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  const domain = at === -1 ? null : normalized.slice(at);
  return allowed.some(
    (entry) => entry === normalized || (domain !== null && entry === `*${domain}`),
  );
}
