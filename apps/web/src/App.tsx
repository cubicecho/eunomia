import { useCallback, useEffect, useState } from 'react';
import { getToken, signOut, verifyMagicLink } from '@/api';
import { ApiKeysView } from '@/components/api-keys-view';
import { ClockMark } from '@/components/clock-mark';
import { DashboardView } from '@/components/dashboard/dashboard-view';
import { DevicesView } from '@/components/devices-view';
import { MergesView } from '@/components/merges-view';
import { RulesView } from '@/components/rules-view';
import { SignIn } from '@/components/sign-in';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SessionProvider } from '@/session';

type Screen = { kind: 'booting' } | { kind: 'signin'; message?: string } | { kind: 'signed-in' };

const VIEWS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'rules', label: 'Categories & rules' },
  { value: 'merges', label: 'Merge entries' },
  { value: 'devices', label: 'Devices' },
  { value: 'keys', label: 'API keys' },
] as const;

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'booting' });

  // Emailed magic links land here as /?token=…; consume it, then clean the URL
  // so a reload doesn't retry the spent token.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const magicToken = params.get('token');
    if (!magicToken) {
      setScreen(getToken() ? { kind: 'signed-in' } : { kind: 'signin' });
      return;
    }
    history.replaceState(null, '', location.pathname);
    verifyMagicLink(magicToken).then(
      () => setScreen({ kind: 'signed-in' }),
      () =>
        setScreen({
          kind: 'signin',
          message: 'That sign-in link is invalid or expired — request a new one.',
        }),
    );
  }, []);

  const expire = useCallback((message: string) => setScreen({ kind: 'signin', message }), []);

  if (screen.kind === 'booting') return null;
  if (screen.kind === 'signin') {
    return <SignIn message={screen.message} onSignedIn={() => setScreen({ kind: 'signed-in' })} />;
  }

  return (
    <SessionProvider value={{ expire }}>
      <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
        <Tabs defaultValue="dashboard" className="gap-6">
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
            <DashboardView />
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
        </Tabs>
      </div>
    </SessionProvider>
  );
}
