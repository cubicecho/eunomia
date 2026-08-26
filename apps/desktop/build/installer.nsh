# NSIS customization, inserted into the generated uninstaller (wired up by
# build.nsis.include in package.json).

# A packaged agent registers itself to launch at login (src/autostart.ts →
# setLoginItemSettings), which writes a value under the HKCU Run key. Removing
# the app deletes its files but not that value, so Windows keeps trying to
# start an agent that isn't there — a dead entry in Task Manager's Startup tab
# that fails at every login. The app can't clean up after itself here: by the
# time it is being uninstalled, it is no longer running.
!macro customUnInstall
  # Not during the uninstall half of an update — the version replacing this one
  # should still launch at login.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "eunomia-agent"
    # Installs from before the login item name was pinned (see autostart.ts)
    # registered themselves under the AppUserModelId instead.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.cubicecho.eunomia"
  ${endIf}
!macroend
