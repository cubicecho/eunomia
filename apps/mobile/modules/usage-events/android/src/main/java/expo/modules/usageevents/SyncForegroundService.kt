package expo.modules.usageevents

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * Keeps the agent alive when the app is closed.
 *
 * WorkManager (expo-background-task, see src/background.ts) already survives a
 * swipe-away and a reboot, and because the usage log is read retroactively no
 * data is lost between its runs — it is the right default. What it does not
 * survive is a *force stop*, which is what several OEM battery managers do to
 * an app they decide is idle: after that the app receives no work, no boot
 * broadcast and no alarms until someone opens it by hand. A foreground service
 * is the only thing Android offers that those layers leave alone, at the price
 * of a permanent notification — so it is a toggle, not the default.
 *
 * It also syncs on the interval the user actually configured. WorkManager's
 * floor is 15 minutes; a service holding its own timer has none.
 *
 * The sync itself stays in JS — the synthesizer, the privacy sanitizer and the
 * uploader all live in @eunomia/agent and are not worth a second Kotlin
 * implementation. Each tick starts a headless JS task (src/background.ts
 * registers it), which React Native runs on the existing JS context, or on one
 * it creates if the process came back without an activity.
 *
 * Deliberately not HeadlessJsTaskService, whose startTask takes a partial wake
 * lock it only releases in onDestroy. For a service designed never to be
 * destroyed that is a wake lock held forever, which is exactly the battery
 * complaint this feature would otherwise deserve. The lock is taken per tick
 * here and released when the task reports back.
 */
class SyncForegroundService : Service(), HeadlessJsTaskEventListener {
  private val handler = Handler(Looper.getMainLooper())
  private var intervalMs = MIN_INTERVAL_SECONDS * 1000
  private var wakeLock: PowerManager.WakeLock? = null

  /** The context we registered a task listener on, so onDestroy can undo it. */
  private var listeningTo: ReactContext? = null

  /** Set while the React instance is being created, so ticks don't stack up. */
  private var startingHost = false

  private val tick =
    object : Runnable {
      override fun run() {
        runSync()
        // Posted after the run rather than at a fixed rate: a sync that takes
        // a while should push the next one out, not queue one up behind it.
        // postDelayed sleeps on uptime, so a dozing phone ticks when it wakes
        // — which is fine, the usage log is read retroactively either way.
        handler.postDelayed(this, intervalMs)
      }
    }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A sticky restart delivers a null intent, so nothing is read from it:
    // the interval and the on/off choice live in prefs, which is also what the
    // boot receiver reads.
    if (!isEnabled(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    intervalMs = intervalSeconds(this) * 1000
    startInForeground()
    isRunning = true
    // Restarting the service is also how a new interval is applied, so drop
    // the pending tick and sync now.
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    listeningTo?.let { HeadlessJsTaskContext.getInstance(it).removeTaskEventListener(this) }
    listeningTo = null
    releaseWakeLock()
    isRunning = false
    super.onDestroy()
  }

  private fun startInForeground() {
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // specialUse rather than dataSync: since Android 15 a dataSync service is
      // capped at six hours a day and may not be started from BOOT_COMPLETED,
      // which is most of what this is for. specialUse has neither limit. It is
      // a declared-justification type (see the manifest property) — fine for an
      // app that is sideloaded, and worth knowing before anyone lists it.
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      // IMPORTANCE_LOW: silent and collapsed. Android will not let this
      // notification be dismissed while the service runs, which is the point —
      // an agent that records what you use should be visibly running.
      val channel =
        NotificationChannel(CHANNEL_ID, "Background tracking", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Shown while eunomia keeps recording with the app closed."
      channel.setShowBadge(false)
      manager.createNotificationChannel(channel)
    }
    val builder =
      NotificationCompat.Builder(this, CHANNEL_ID)
        // A platform drawable, so this needs no asset of its own — notification
        // icons are a white-on-transparent silhouette and the launcher icon is
        // not one.
        .setSmallIcon(android.R.drawable.stat_notify_sync)
        .setContentTitle("eunomia is recording")
        .setContentText("Syncing app usage every ${intervalMs / 1000}s.")
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setShowWhen(false)
    // Tapping it opens the status screen, the way tapping the desktop tray does.
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      builder.setContentIntent(
        PendingIntent.getActivity(
          this,
          0,
          launch,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        ),
      )
    }
    return builder.build()
  }

  /**
   * Hands one sync to JS, starting the React instance first if the process
   * came back without one (a sticky restart, or a boot).
   */
  private fun runSync() {
    val host = (application as? ReactApplication)?.reactHost
    if (host == null) {
      Log.w(TAG, "no ReactHost on the application; skipping this sync")
      return
    }
    val context = host.currentReactContext
    if (context != null) {
      startTask(context)
      return
    }
    if (startingHost) return
    startingHost = true
    host.addReactInstanceEventListener(
      object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          host.removeReactInstanceEventListener(this)
          startingHost = false
          startTask(context)
        }
      },
    )
    host.start()
  }

  private fun startTask(context: ReactContext) {
    val tasks = HeadlessJsTaskContext.getInstance(context)
    // Something is already syncing — our previous tick, or the WorkManager
    // task. performSync is reentrancy-guarded in JS too; this just avoids
    // waking the device to find that out.
    if (tasks.hasActiveTasks()) return
    if (listeningTo !== context) {
      listeningTo?.let { HeadlessJsTaskContext.getInstance(it).removeTaskEventListener(this) }
      tasks.addTaskEventListener(this)
      listeningTo = context
    }
    acquireWakeLock()
    try {
      tasks.startTask(
        HeadlessJsTaskConfig(
          TASK_KEY,
          Arguments.createMap(),
          TASK_TIMEOUT_MS,
          // The app counts as foregrounded whenever its UI is open, and this
          // service is meant to keep syncing then too.
          true,
        ),
      )
    } catch (error: Exception) {
      Log.e(TAG, "could not start the sync task", error)
      releaseWakeLock()
    }
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    releaseWakeLock()
  }

  /**
   * A foreground service keeps the process alive but does not keep the CPU
   * awake: without this the device can doze off mid-upload. Timed out at the
   * task's own timeout so a wedged sync cannot hold it open.
   */
  private fun acquireWakeLock() {
    val power = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    val lock =
      wakeLock
        ?: power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "eunomia:sync").also {
          it.setReferenceCounted(false)
          wakeLock = it
        }
    if (!lock.isHeld) lock.acquire(TASK_TIMEOUT_MS)
  }

  private fun releaseWakeLock() {
    wakeLock?.let { if (it.isHeld) it.release() }
  }

  companion object {
    /** Matches the key src/background.ts registers with AppRegistry. */
    const val TASK_KEY = "EunomiaKeepAliveSync"

    private const val TAG = "EunomiaKeepAlive"
    private const val PREFS = "eunomia-keep-alive"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_INTERVAL = "intervalSeconds"
    private const val NOTIFICATION_ID = 4711
    private const val CHANNEL_ID = "eunomia-keep-alive"
    private const val MIN_INTERVAL_SECONDS = 10L
    private const val TASK_TIMEOUT_MS = 120_000L

    /**
     * Whether the service is up *in this process*. False after a force stop or
     * a kill, which is the state the UI needs to be able to show.
     */
    @Volatile
    var isRunning: Boolean = false
      private set

    private fun prefs(context: Context) =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * The user's choice, kept natively rather than read out of the agent's
     * config.json: the boot receiver has to answer this before any JS runs.
     */
    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

    fun intervalSeconds(context: Context): Long =
      prefs(context).getLong(KEY_INTERVAL, 60L).coerceAtLeast(MIN_INTERVAL_SECONDS)

    fun setEnabled(context: Context, enabled: Boolean, intervalSeconds: Long) {
      prefs(context)
        .edit()
        .putBoolean(KEY_ENABLED, enabled)
        .putLong(KEY_INTERVAL, intervalSeconds.coerceAtLeast(MIN_INTERVAL_SECONDS))
        .apply()
      val intent = Intent(context, SyncForegroundService::class.java)
      if (enabled) start(context) else context.stopService(intent)
    }

    /** Start it, or restart a running one so it picks up a changed interval. */
    fun start(context: Context) {
      val intent = Intent(context, SyncForegroundService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (error: Exception) {
        // Android 12+ refuses a foreground start from the background. Every
        // caller here is either the app's own UI or a boot broadcast, both
        // exempt — but a refusal must not take the app down with it.
        Log.e(TAG, "could not start the keep-alive service", error)
      }
    }
  }
}
