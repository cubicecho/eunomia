import { createContext, useContext } from 'react';
import type { Me } from '@/api';
import { browserTimeZone } from '@/lib/format';

/**
 * A session can end mid-view (the token expires, or the server revokes it), and
 * every view needs the same answer: drop back to sign-in with a reason. Views
 * get it from here rather than each one knowing how the shell is rendered.
 *
 * It also carries who is signed in, since one thing about them reaches every
 * view that shows a date: the zone their days split in. The shell loads it
 * before rendering any view, so a range is never computed in the wrong zone
 * and then corrected.
 */
export interface Session {
  expire(message: string): void;
  me: Me;
  /** After a change the server confirmed (setTimeZone), so views follow it. */
  setMe(me: Me): void;
}

const SessionContext = createContext<Session>({
  expire: () => {},
  me: {
    id: '',
    email: '',
    timeZone: null,
    effectiveTimeZone: browserTimeZone(),
    retentionDays: null,
    effectiveRetentionDays: null,
  },
  setMe: () => {},
});

export const SessionProvider = SessionContext.Provider;
export const useSession = (): Session => useContext(SessionContext);
/** The zone every date the dashboard sends or shows is a day in. */
export const useTimeZone = (): string => useSession().me.effectiveTimeZone;
