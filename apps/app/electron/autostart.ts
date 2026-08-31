import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Registers (or removes) launch-at-login for the packaged app — a tracker
 * that must be started by hand mostly measures forgetting to start it.
 * Opt out with {"autostart": false} in config.json. Dev runs (`electron .`)
 * never touch login items.
 */
/**
 * Registry value name for the Windows login item. Pinned rather than left to
 * Electron's default (the AppUserModelId), because the uninstaller has to
 * delete this entry by name — nothing else removes it, and the app is long
 * gone by then. Keep it in step with build/installer.nsh.
 */
const LOGIN_ITEM_NAME = 'eunomia-agent';

export function syncAutostart(enabled: boolean): void {
  if (!app.isPackaged) return;
  if (process.platform === 'linux') {
    // setLoginItemSettings is a no-op on Linux; the XDG autostart entry is
    // the convention. Inside an AppImage, APPIMAGE holds the real on-disk
    // path (execPath would point into the transient mount).
    const entry = join(app.getPath('appData'), 'autostart', 'eunomia-agent.desktop');
    if (!enabled) {
      rmSync(entry, { force: true });
      return;
    }
    mkdirSync(join(app.getPath('appData'), 'autostart'), { recursive: true });
    const exec = process.env.APPIMAGE ?? process.execPath;
    writeFileSync(
      entry,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=eunomia agent',
        'Comment=Tracks the active window for the eunomia dashboard',
        `Exec="${exec}"`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n'),
    );
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, name: LOGIN_ITEM_NAME });
  }
}
