import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_POLL_MS,
  idleMethodsFor,
  linuxSession,
  parseGdbusUint,
  startCompositorIdle,
  waylandAdvice,
} from './linux-session.ts';

describe('linuxSession', () => {
  it('tells Wayland from X11, and names the desktop', () => {
    expect(
      linuxSession({ XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }),
    ).toEqual({
      wayland: true,
      desktop: 'gnome',
    });
    expect(linuxSession({ XDG_SESSION_TYPE: 'x11', XDG_CURRENT_DESKTOP: 'KDE' })).toEqual({
      wayland: false,
      desktop: 'kde',
    });
    expect(linuxSession({ WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'Hyprland' })).toEqual(
      {
        wayland: true,
        desktop: 'wlroots',
      },
    );
    expect(linuxSession({ DESKTOP_SESSION: 'sway', WAYLAND_DISPLAY: 'wayland-1' }).desktop).toBe(
      'wlroots',
    );
    expect(linuxSession({})).toEqual({ wayland: false, desktop: 'other' });
  });
});

describe('waylandAdvice', () => {
  const quiet = { extension: 'missing' as const, windowReported: false, restartNeeded: false };

  it('says nothing on X11, or once a source reports the window', () => {
    expect(waylandAdvice({ wayland: false, desktop: 'gnome' }, quiet)).toBeNull();
    expect(
      waylandAdvice({ wayland: true, desktop: 'kde' }, { ...quiet, windowReported: true }),
    ).toBeNull();
  });

  it('walks GNOME through the extension', () => {
    const gnome = { wayland: true, desktop: 'gnome' as const };
    expect(waylandAdvice(gnome, quiet)).toMatch(/need the GNOME window extension/);
    expect(waylandAdvice(gnome, { ...quiet, extension: 'installed' })).toMatch(/installed but off/);
    expect(waylandAdvice(gnome, { ...quiet, restartNeeded: true })).toMatch(/log out/);
    expect(waylandAdvice(gnome, { ...quiet, extension: 'enabled' })).toBeNull();
  });

  it('points everything else at awatcher', () => {
    expect(waylandAdvice({ wayland: true, desktop: 'wlroots' }, quiet)).toMatch(/awatcher/);
    expect(waylandAdvice({ wayland: true, desktop: 'kde' }, quiet)).toMatch(/awatcher/);
  });
});

describe('compositor idle', () => {
  afterEach(() => vi.useRealTimers());

  it('reads gdbus answers', () => {
    expect(parseGdbusUint('(uint64 12345,)\n')).toBe(12345);
    expect(parseGdbusUint('(uint32 7,)')).toBe(7);
    expect(parseGdbusUint("('nope',)")).toBeNull();
    expect(parseGdbusUint('')).toBeNull();
  });

  it('asks Mutter on GNOME, the freedesktop name on KDE, and both elsewhere', () => {
    expect(idleMethodsFor('gnome').map((m) => m.dest)).toEqual(['org.gnome.Mutter.IdleMonitor']);
    expect(idleMethodsFor('kde').map((m) => m.dest)).toEqual(['org.freedesktop.ScreenSaver']);
    expect(idleMethodsFor('other')).toHaveLength(2);
  });

  it('extrapolates between answers, and hands back after three misses', async () => {
    vi.useFakeTimers();
    let clock = 1_000_000;
    let answer: number | null = 4_000;
    const ask = vi.fn(async () => answer);
    const idle = startCompositorIdle('gnome', { now: () => clock, ask });

    await vi.advanceTimersByTimeAsync(0);
    expect(idle.idleSeconds()).toBe(4);
    clock += 1_000;
    expect(idle.idleSeconds()).toBe(5);

    answer = null;
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(idle.idleSeconds()).toBeNull();
    idle.stop();
  });

  it('falls through to the next monitor when the first has no answer', async () => {
    vi.useFakeTimers();
    const ask = vi.fn(async (method: { dest: string }) =>
      method.dest === 'org.freedesktop.ScreenSaver' ? 1_000 : null,
    );
    const idle = startCompositorIdle('other', { now: () => 0, ask });
    await vi.advanceTimersByTimeAsync(0);
    expect(idle.idleSeconds()).toBe(1);
    idle.stop();
  });
});
