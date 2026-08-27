package expo.modules.usageevents

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.provider.Settings
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

  private companion object {
    const val FOREGROUND = "foreground"
    const val SCREEN_ON = "screenOn"
    const val SCREEN_OFF = "screenOff"
  }
}
