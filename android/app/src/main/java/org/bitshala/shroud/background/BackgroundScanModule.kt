package org.bitshala.shroud.background

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import org.bitshala.shroud.MainActivity
import org.bitshala.shroud.R
import java.util.concurrent.TimeUnit

class BackgroundScanModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "BackgroundScanManager"
        const val WORK_NAME = "shroud-bg-scan"
        const val CHANNEL_ID = "shroud_scan"
        private const val PERIOD_MINUTES = 15L
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 4352
        private const val PREFS_NAME = "group.org.bitshala.shroud"
        private const val PREF_ENABLED = "background_scan_enabled"
        private const val PREF_LAST_RUN_AT = "background_scan_last_run_at"
    }

    override fun getName() = NAME

    private val prefs
        get() = reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @ReactMethod
    fun start(promise: Promise) {
        try {
            val request = PeriodicWorkRequestBuilder<BackgroundScanWorker>(PERIOD_MINUTES, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInputData(workDataOf(BackgroundScanWorker.KEY_TIME_BUDGET_MS to BackgroundScanWorker.DEFAULT_TIME_BUDGET_MS))
                .build()

            WorkManager.getInstance(reactApplicationContext)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)

            prefs.edit().putBoolean(PREF_ENABLED, true).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("bg_scan_start_failed", e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        try {
            WorkManager.getInstance(reactApplicationContext).cancelUniqueWork(WORK_NAME)
            prefs.edit().putBoolean(PREF_ENABLED, false).apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("bg_scan_stop_failed", e)
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            val lastRunAt = prefs.getLong(PREF_LAST_RUN_AT, 0L)
            val result = com.facebook.react.bridge.Arguments.createMap().apply {
                putBoolean("enabled", prefs.getBoolean(PREF_ENABLED, false))
                if (lastRunAt > 0) putDouble("lastRunAt", lastRunAt.toDouble()) else putNull("lastRunAt")
                putBoolean("available", true)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("bg_scan_status_failed", e)
        }
    }

    /**
     * No-op on Android: the headless task's resolved promise notifies completion
     * (AppRegistry → HeadlessJsTaskContext.finishTask). Kept for iOS API symmetry.
     */
    @ReactMethod
    fun finish(taskId: String?, success: Boolean) = Unit

    @ReactMethod
    fun postNotification(title: String, body: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            if (
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                promise.resolve(null) // silently skip; permission is requested from the foreground flow
                return
            }

            ensureChannel(context)

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(
                    android.app.PendingIntent.getActivity(
                        context,
                        0,
                        android.content.Intent(context, MainActivity::class.java),
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                .build()

            NotificationManagerCompat.from(context).notify(System.currentTimeMillis().toInt(), notification)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("bg_scan_notify_failed", e)
        }
    }

    @ReactMethod
    fun requestNotificationPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            promise.resolve(true)
            return
        }

        val context = reactApplicationContext
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            promise.resolve(true)
            return
        }

        val activity = currentActivity as? PermissionAwareActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }

        val listener = PermissionListener { requestCode, _, grantResults ->
            if (requestCode == NOTIFICATION_PERMISSION_REQUEST_CODE) {
                promise.resolve(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
                true
            } else {
                false
            }
        }

        activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST_CODE, listener)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Incoming payments", NotificationManager.IMPORTANCE_DEFAULT),
                )
            }
        }
    }
}
