import { execFile } from 'node:child_process';

// Linux under Wayland: what the agent can and can't read there, and the
// D-Bus idle monitors that answer when the platform's idle reading doesn't.
//
// Core Wayland has no "which window is focused" query, by design. Per
// desktop:
// - GNOME: x-win ships a GNOME Shell extension that answers it. It needs
//   installing once, and a log out and back in.
// - KDE, Sway, Hyprland and the other wlroots compositors: nothing the agent
//   can call. awatcher (https://github.com/2e3s/awatcher) covers all of them
//   and reports through the agent's ActivityWatch-compatible local API.
// Idle: whether Electron's reading is right under Wayland depends on how it
// runs (XWayland only sees input sent to XWayland windows; native Wayland
// needs the compositor to offer an idle protocol). GNOME's Mutter and KDE both
// publish the compositor's own idle time on the session bus, so that is
// preferred whenever it answers, and Electron's reading is the fallback.

export type Desktop = 'gnome' | 'kde' | 'wlroots' | 'other';

export interface LinuxSession {
  wayland: boolean;
  desktop: Desktop;
}

const WLROOTS = /sway|hyprland|river|wayfire|labwc|niri|cosmic/i;

/** What kind of session the agent was started in, from the environment it inherited. */
export function linuxSession(env: Record<string, string | undefined>): LinuxSession {
  const wayland = env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
  const desktop = `${env.XDG_CURRENT_DESKTOP ?? ''}:${env.DESKTOP_SESSION ?? ''}`;
  if (/gnome|ubuntu|unity|pop/i.test(desktop)) return { wayland, desktop: 'gnome' };
  if (/kde|plasma/i.test(desktop)) return { wayland, desktop: 'kde' };
  if (WLROOTS.test(desktop)) return { wayland, desktop: 'wlroots' };
  return { wayland, desktop: 'other' };
}

/** What x-win's GNOME extension says about itself. */
export type GnomeExtension = 'enabled' | 'installed' | 'missing' | 'unknown';

/**
 * The tray's one line about window capture on this session, or null when
 * there is nothing to say (X11, Windows, macOS, or a source already covering).
 */
export function waylandAdvice(
  session: LinuxSession,
  options: { extension: GnomeExtension; windowReported: boolean; restartNeeded: boolean },
): string | null {
  if (!session.wayland || options.windowReported) return null;
  if (session.desktop === 'gnome') {
    if (options.restartNeeded) return 'Wayland: log out and back in to start the GNOME extension';
    if (options.extension === 'enabled') return null;
    return options.extension === 'installed'
      ? 'Wayland: the GNOME window extension is installed but off'
      : 'Wayland: window titles need the GNOME window extension';
  }
  return 'Wayland: window capture needs awatcher (see the README)';
}

/** A D-Bus method that answers "milliseconds since the last input". */
interface IdleMethod {
  dest: string;
  path: string;
  method: string;
}

const MUTTER: IdleMethod = {
  dest: 'org.gnome.Mutter.IdleMonitor',
  path: '/org/gnome/Mutter/IdleMonitor/Core',
  method: 'org.gnome.Mutter.IdleMonitor.GetIdletime',
};
// KDE implements the freedesktop name; it answers in milliseconds, whatever
// the old spec said about seconds.
const SCREENSAVER: IdleMethod = {
  dest: 'org.freedesktop.ScreenSaver',
  path: '/org/freedesktop/ScreenSaver',
  method: 'org.freedesktop.ScreenSaver.GetSessionIdleTime',
};

/** Which idle monitor to ask, in order, for a desktop. */
export const idleMethodsFor = (desktop: Desktop): IdleMethod[] =>
  desktop === 'gnome' ? [MUTTER] : desktop === 'kde' ? [SCREENSAVER] : [MUTTER, SCREENSAVER];

/** Reads gdbus's answer, `(uint64 1234,)`, as a number, or null when it is something else. */
export function parseGdbusUint(output: string): number | null {
  const match = /^\(\s*uint(?:32|64)\s+(\d+)\s*,?\s*\)\s*$/.exec(output.trim());
  return match ? Number(match[1]) : null;
}

const call = (method: IdleMethod): Promise<number | null> =>
  new Promise((resolve) => {
    execFile(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        method.dest,
        '--object-path',
        method.path,
        '--method',
        method.method,
      ],
      { timeout: 1_500 },
      (error, stdout) => resolve(error ? null : parseGdbusUint(String(stdout))),
    );
  });

/** How often the compositor is asked. Between answers the idle time is extrapolated. */
export const IDLE_POLL_MS = 2_000;

/**
 * Polls the compositor's idle monitor. `idleSeconds()` is null until one has
 * answered and after it stops, so the caller falls back to Electron's own
 * reading. Off the hot path: the sampler ticks every second and must never
 * wait on a subprocess.
 */
export function startCompositorIdle(
  desktop: Desktop,
  options: { now?: () => number; ask?: (method: IdleMethod) => Promise<number | null> } = {},
): { idleSeconds(): number | null; stop(): void } {
  const now = options.now ?? Date.now;
  const ask = options.ask ?? call;
  const methods = idleMethodsFor(desktop);
  let working: IdleMethod | null = null;
  let last: { ms: number; at: number } | null = null;
  let busy = false;
  let failures = 0;

  const poll = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      for (const method of working ? [working] : methods) {
        const ms = await ask(method);
        if (ms !== null) {
          if (!working) console.log(`idle time from ${method.dest}`);
          working = method;
          last = { ms, at: now() };
          failures = 0;
          return;
        }
      }
      // Three misses in a row and the answer is stale: hand back to Electron.
      if (++failures >= 3) {
        last = null;
        working = null;
      }
    } finally {
      busy = false;
    }
  };

  void poll();
  const timer = setInterval(() => void poll(), IDLE_POLL_MS);
  return {
    idleSeconds: () => (last ? Math.round((last.ms + (now() - last.at)) / 1000) : null),
    stop: () => clearInterval(timer),
  };
}
