package expo.modules.usageevents

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import androidx.core.app.ActivityCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridges Android's UsageStatsManager event log to the agent.
 *
 * The phone has no equivalent of the desktop agent's "what is focused right
 * now" sampling — an app in the background cannot poll the foreground app.
 * What it has instead is a retroactive log the OS keeps for us, so the agent
 * reads the window since its last checkpoint and synthesizes the pings a live
 * agent would have emitted (see src/sync.ts and @eunomia/agent's synthesizer).
 *
 * Everything here is synchronous: queryEvents over a sync window is a fast
 * local call, and the JS side is easier to read without a promise per hop.
 */
class UsageEventsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("UsageEvents")

    Function("isUsageAccessGranted") { hasUsageAccess() }

    Function("openUsageAccessSettings") { openUsageAccessSettings() }

    Function("queryEvents") { beginMs: Long, endMs: Long -> queryEvents(beginMs, endMs) }

    Function("getAppLabel") { packageName: String -> appLabel(packageName) }

    Function("isLaunchable") { packageName: String -> isLaunchable(packageName) }

    // Keep-alive: the foreground service that survives what WorkManager
    // doesn't. See SyncForegroundService and src/background.ts.

    Function("isKeepAliveRunning") { SyncForegroundService.isRunning }

    Function("setKeepAlive") { enabled: Boolean, intervalSeconds: Int ->
      SyncForegroundService.setEnabled(context, enabled, intervalSeconds.toLong())
    }

    Function("hasNotificationPermission") { hasNotificationPermission() }

    Function("requestNotificationPermission") { requestNotificationPermission() }

    Function("isIgnoringBatteryOptimizations") { isIgnoringBatteryOptimizations() }

    Function("requestIgnoreBatteryOptimizations") { requestIgnoreBatteryOptimizations() }
  }

  /**
   * PACKAGE_USAGE_STATS is a special access, not a runtime permission: it is
   * an app-op the user flips in system settings, and checkSelfPermission alone
   * reports nothing useful. MODE_DEFAULT means "ask the permission" — the only
   * case where the permission check is the answer.
   */
  private fun hasUsageAccess(): Boolean {
    val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
    val mode =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          Process.myUid(),
          context.packageName,
        )
      } else {
        @Suppress("DEPRECATION")
        appOps.checkOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          Process.myUid(),
          context.packageName,
        )
      }
    if (mode == AppOpsManager.MODE_DEFAULT) {
      return context.checkCallingOrSelfPermission(
        android.Manifest.permission.PACKAGE_USAGE_STATS,
      ) == PackageManager.PERMISSION_GRANTED
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun openUsageAccessSettings() {
    val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
    val activity = appContext.activityProvider?.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      // No activity when a background sync notices access was revoked.
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  /**
   * The events the synthesizer understands, in the OS's own order. Everything
   * else in the log (configuration changes, notification interruptions, ...)
   * is dropped here rather than crossing the bridge.
   *
   * Plain maps rather than a Record: this is a one-way payload whose shape is
   * declared once on the JS side (modules/usage-events/index.ts).
   */
  private fun queryEvents(beginMs: Long, endMs: Long): List<Map<String, Any?>> {
    val manager =
      context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
        ?: return emptyList()
    val cursor = manager.queryEvents(beginMs, endMs)
    val out = mutableListOf<Map<String, Any?>>()
    val event = UsageEvents.Event()
    while (cursor.hasNextEvent()) {
      cursor.getNextEvent(event)
      val kind =
        when (event.eventType) {
          // ACTIVITY_RESUMED is API 29's name for MOVE_TO_FOREGROUND and the
          // same constant value, so this matches on every supported release.
          UsageEvents.Event.ACTIVITY_RESUMED -> FOREGROUND
          UsageEvents.Event.SCREEN_INTERACTIVE -> SCREEN_ON
          UsageEvents.Event.SCREEN_NON_INTERACTIVE -> SCREEN_OFF
          else -> continue
        }
      out.add(
        mapOf(
          // Double, not Long: this crosses to JS as a number either way, and
          // ms epochs are exact well past any date this will ever see.
          "at" to event.timeStamp.toDouble(),
          "kind" to kind,
          "app" to if (kind == FOREGROUND) event.packageName else null,
        ),
      )
    }
    return out
  }

  /** Human-readable name for a package, or null when it is not visible to us. */
  private fun appLabel(packageName: String): String? =
    try {
      val packages = context.packageManager
      packages.getApplicationLabel(packages.getApplicationInfo(packageName, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
      null
    }

  /**
   * Whether the package is an app the user can open — one with an entry in the
   * launcher — as opposed to the rest of what puts an activity on screen.
   *
   * The usage log records an ACTIVITY_RESUMED for everything that comes to the
   * foreground, and plenty of that is not time spent in an app: the launcher
   * itself between two apps, the notification shade, a permission dialog, a
   * Play Services trampoline that resumes and hands straight off. None of them
   * have a launcher icon, and the user has no name for them.
   *
   * The same question the launcher itself asks, rather than ApplicationInfo's
   * FLAG_SYSTEM: half the apps on a phone ship in the system image (Chrome,
   * Phone, Messages) and are exactly the ones worth recording.
   *
   * Costs nothing extra in visibility terms — plugins/with-package-visibility.js
   * already scopes this app to packages with a launcher intent, so anything
   * this returns false for was invisible to getAppLabel anyway.
   */
  private fun isLaunchable(packageName: String): Boolean =
    context.packageManager.getLaunchIntentForPackage(packageName) != null

  /**
   * Whether the keep-alive service's notification can actually be shown.
   * Nothing depends on it — the service runs either way — but a tracker whose
   * "I am running" notice is invisible is worth saying out loud.
   */
  private fun hasNotificationPermission(): Boolean =
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      true
    } else {
      context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    }

  /**
   * Fire-and-forget: the result arrives as the usual system dialog, which
   * pauses the activity, and the status screen re-reads state when it comes
   * back to the foreground.
   */
  private fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (hasNotificationPermission()) return
    val activity = appContext.activityProvider?.currentActivity ?: return
    ActivityCompat.requestPermissions(
      activity,
      arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
      NOTIFICATION_PERMISSION_REQUEST,
    )
  }

  /**
   * Battery optimization is the lighter half of "keep running": exempt, an app
   * gets its WorkManager runs and its alarms on time, with no service and no
   * permanent notification. It is not a substitute for the service — an OEM
   * that force-stops idle apps ignores this — but it is one tap and costs the
   * user nothing.
   */
  private fun isIgnoringBatteryOptimizations(): Boolean {
    val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return power.isIgnoringBatteryOptimizations(context.packageName)
  }

  private fun requestIgnoreBatteryOptimizations() {
    if (isIgnoringBatteryOptimizations()) return
    val intent =
      Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${context.packageName}"))
    val activity = appContext.activityProvider?.currentActivity
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  private companion object {
    const val NOTIFICATION_PERMISSION_REQUEST = 4711

    const val FOREGROUND = "foreground"
    const val SCREEN_ON = "screenOn"
    const val SCREEN_OFF = "screenOff"
  }
}
