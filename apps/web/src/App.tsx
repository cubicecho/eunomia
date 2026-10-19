import { useCallback, useEffect, useState } from 'react';
import {
  fetchMe,
  GraphQLError,
  getToken,
  type Me,
  signOut,
  UNAUTHENTICATED,
  verifyMagicLink,
  verifyOneTimeToken,
} from '@/api';
import { ApiKeysView } from '@/components/api-keys-view';
import { ClockMark } from '@/components/clock-mark';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { DevicesView } from '@/components/devices-view';
import { MergesView } from '@/components/merges-view';
import { ReviewView } from '@/components/review-view';
import { RulesView } from '@/components/rules-view';
import { SettingsView } from '@/components/settings-view';
import { SignIn } from '@/components/sign-in';
import { TimelineView } from '@/components/timeline-view';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/hooks/use-query';
import { SessionProvider } from '@/session';

type Screen =
  | { kind: 'booting' }
  | { kind: 'signin'; message?: string }
  | { kind: 'signed-in'; me: Me | null; error?: string };

const EXPIRED = 'session expired — sign in again';

/**
 * What an OIDC sign-in that came back as `/?error=` is told. Our own codes
 * first (oidc/http.ts on the server); anything else is better-auth's, and all
 * of those mean the same thing to the person: it didn't work, try again.
 */
function ssoErrorMessage(code: string): string {
  if (code === 'sso_off') return 'Single sign-on is no longer set up on this server.';
  if (code === 'not_allowed') return 'That account is not allowed on this server.';
  return "Signing in with your provider didn't work — try again.";
}

const VIEWS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'review', label: 'Review' },
  { value: 'rules', label: 'Categories & rules' },
  { value: 'merges', label: 'Merge entries' },
  { value: 'devices', label: 'Devices' },
  { value: 'keys', label: 'API keys' },
  { value: 'settings', label: 'Settings' },
] as const;

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'booting' });
  // Controlled so the dashboard's getting-started checklist can send the user
  // to the tab that finishes a step.
  const [view, setView] = useState<string>('dashboard');

  // Emailed magic links land here as /?token=…, and an OIDC sign-in as
  // /?sso=… (or /?error=… when it failed); consume it, then clean the URL so a
  // reload doesn't retry the spent token.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const magicToken = params.get('token');
    const ssoToken = params.get('sso');
    const ssoError = params.get('error');
    if (magicToken || ssoToken || ssoError) history.replaceState(null, '', location.pathname);
    if (ssoError) {
      setScreen({ kind: 'signin', message: ssoErrorMessage(ssoError) });
      return;
    }
    if (ssoToken) {
      verifyOneTimeToken(ssoToken).then(
        () => setScreen({ kind: 'signed-in', me: null }),
        () =>
          setScreen({
            kind: 'signin',
            message: 'That sign-in expired before it finished — sign in again.',
          }),
      );
      return;
    }
    if (!magicToken) {
      setScreen(getToken() ? { kind: 'signed-in', me: null } : { kind: 'signin' });
      return;
    }
    verifyMagicLink(magicToken).then(
      () => setScreen({ kind: 'signed-in', me: null }),
      () =>
        setScreen({
          kind: 'signin',
          message: 'That sign-in link is invalid or expired — request a new one.',
        }),
    );
  }, []);

  const expire = useCallback((message: string) => setScreen({ kind: 'signin', message }), []);
  const setMe = useCallback((me: Me) => setScreen({ kind: 'signed-in', me }), []);

  // Who is signed in comes before any view: every range a view asks for is in
  // this user's zone. A stored token the server no longer honours reads as
  // anonymous (null), which is the same expired session as an error.
  const needsMe = screen.kind === 'signed-in' && screen.me === null && !screen.error;
  useEffect(() => {
    if (!needsMe) return;
    fetchMe().then(
      (me) => (me ? setMe(me) : expire(EXPIRED)),
      (cause: unknown) =>
        cause instanceof GraphQLError && cause.code === UNAUTHENTICATED
          ? expire(EXPIRED)
          : setScreen({ kind: 'signed-in', me: null, error: errorMessage(cause) }),
    );
  }, [needsMe, expire, setMe]);

  if (screen.kind === 'booting') return null;
  if (screen.kind === 'signin') {
    return (
      <SignIn
        message={screen.message}
        onSignedIn={() => setScreen({ kind: 'signed-in', me: null })}
      />
    );
  }
  if (screen.error) return <p className="text-destructive p-6 text-sm">{screen.error}</p>;
  if (!screen.me) return null;

  return (
    <SessionProvider value={{ expire, me: screen.me, setMe }}>
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <Tabs value={view} onValueChange={setView} className="gap-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <ClockMark className="size-6 shrink-0" />
              <h1 className="text-xl font-semibold tracking-tight">eunomia</h1>
              <span className="text-muted-foreground text-sm">activity tracker</span>
            </div>
            <div className="flex items-center gap-2">
              <TabsList>
                {VIEWS.map((view) => (
                  <TabsTrigger key={view.value} value={view.value}>
                    {view.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void signOut().then(() => setScreen({ kind: 'signin' }))}
              >
                Sign out
              </Button>
            </div>
          </header>

          <TabsContent value="dashboard">
            <DashboardView onNavigate={setView} />
          </TabsContent>
          <TabsContent value="timeline">
            <TimelineView />
          </TabsContent>
          <TabsContent value="review">
            <ReviewView />
          </TabsContent>
          <TabsContent value="rules">
            <RulesView />
          </TabsContent>
          <TabsContent value="merges">
            <MergesView />
          </TabsContent>
          <TabsContent value="devices">
            <DevicesView />
          </TabsContent>
          <TabsContent value="keys">
            <ApiKeysView />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsView />
          </TabsContent>
        </Tabs>
      </div>
    </SessionProvider>
  );
}
