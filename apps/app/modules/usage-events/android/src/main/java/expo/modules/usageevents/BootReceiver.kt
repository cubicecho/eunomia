package expo.modules.usageevents

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings the keep-alive service back after a reboot or an app update — the
 * half of "keep running" that WorkManager gives you for free and a foreground
 * service does not.
 *
 * Android 15 forbids a BOOT_COMPLETED receiver from starting several
 * foreground-service types (dataSync among them); specialUse, which this
 * service declares, is not one of them.
 *
 * Nothing here can consult the agent's config.json — no JS has run yet — so
 * the choice is read from the same prefs the toggle writes.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> {
        if (SyncForegroundService.isEnabled(context)) SyncForegroundService.start(context)
      }
    }
  }
}
