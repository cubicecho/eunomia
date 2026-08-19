import type { AuthGateway } from '../../src/auth.ts';

/** Inert AuthGateway for tests that never exercise auth mutations. */
export function stubAuthGateway(overrides: Partial<AuthGateway> = {}): AuthGateway {
  return {
    mintDeviceKey: async () => 'test-key',
    signUp: async () => ({ token: 't', userId: 'u' }),
    signIn: async () => ({ token: 't', userId: 'u' }),
    requestMagicLink: async () => ({ token: null }),
    verifyMagicLink: async () => ({ token: 't', userId: 'u' }),
    signOut: async () => true,
    ...overrides,
  };
}
