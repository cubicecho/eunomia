import type { AuthGateway } from '../../src/auth.ts';

/** Inert AuthGateway for tests that never exercise auth mutations. */
export function stubAuthGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    mintUserKey: async () => ({ id: 'test-key-id', key: 'test-key' }),
    signUp: async () => ({ token: 't', userId: 'u' }),
    signIn: async () => ({ token: 't', userId: 'u' }),
    requestMagicLink: async () => ({ token: null }),
    verifyMagicLink: async () => ({ token: 't', userId: 'u' }),
    signOut: async () => true,
    verifyOneTimeToken: async () => ({ token: 't', userId: 'u' }),
    reloadSso: async () => {},
    setupCodePending: async () => false,
    claimSetupCode: async () => ({ token: 't', userId: 'u' }),
    magicLinkFor: async () => 'http://localhost/?token=t',
    ...overrides,
  };
}
