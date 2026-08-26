import { createContext, useContext } from 'react';

/**
 * A session can end mid-view (the token expires, or the server revokes it), and
 * every view needs the same answer: drop back to sign-in with a reason. Views
 * get it from here rather than each one knowing how the shell is rendered.
 */
export interface Session {
  expire(message: string): void;
}

const SessionContext = createContext<Session>({ expire: () => {} });

export const SessionProvider = SessionContext.Provider;
export const useSession = (): Session => useContext(SessionContext);
