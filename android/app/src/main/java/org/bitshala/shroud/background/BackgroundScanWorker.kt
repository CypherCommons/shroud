package org.bitshala.shroud.background

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Runs the "BackgroundScan" headless JS task and blocks until it completes, so
 * WorkManager's wakelock and process priority cover the whole scan. Drives
 * HeadlessJsTaskContext directly instead of going through a HeadlessJsTaskService:
 * no startService() background restrictions, and completion is observable.
 *
 * Cold process: boots the ReactContext headlessly (same path HeadlessJsTaskService
 * uses) before starting the task.
 */
class BackgroundScanWorker(appContext: Context, params: WorkerParameters) : Worker(appContext, params) {

    companion object {
        const val TAG = "BackgroundScanWorker"
        const val KEY_TIME_BUDGET_MS = "timeBudgetMs"
        const val DEFAULT_TIME_BUDGET_MS = 8L * 60 * 1000 // stay well inside the 10-min Worker window
        private const val REACT_BOOT_TIMEOUT_MS = 30L * 1000
        private const val TASK_COMPLETION_GRACE_MS = 30L * 1000
    }

    override fun doWork(): Result {
        val timeBudgetMs = inputData.getLong(KEY_TIME_BUDGET_MS, DEFAULT_TIME_BUDGET_MS)

        val reactContext = awaitReactContext() ?: run {
            Log.w(TAG, "Could not obtain ReactContext, retrying later")
            return Result.retry()
        }

        if (reactContext.lifecycleState == LifecycleState.RESUMED) {
            // App is in the foreground — the live app owns scanning.
            Log.i(TAG, "App in foreground, skipping background scan")
            return Result.success()
        }

        return if (runHeadlessTask(reactContext, timeBudgetMs)) Result.success() else Result.retry()
    }

    private fun awaitReactContext(): ReactContext? {
        val reactNativeHost = (applicationContext as ReactApplication).reactNativeHost
        val reactInstanceManager = reactNativeHost.reactInstanceManager

        reactInstanceManager.currentReactContext?.let { return it }

        val latch = CountDownLatch(1)
        var obtainedContext: ReactContext? = null

        val listener = object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
                obtainedContext = context
                reactInstanceManager.removeReactInstanceEventListener(this)
                latch.countDown()
            }
        }

        UiThreadUtil.runOnUiThread {
            // Re-check on the UI thread: the context may have appeared in between.
            val current = reactInstanceManager.currentReactContext
            if (current != null) {
                obtainedContext = current
                latch.countDown()
            } else {
                reactInstanceManager.addReactInstanceEventListener(listener)
                if (!reactInstanceManager.hasStartedCreatingInitialContext()) {
                    reactInstanceManager.createReactContextInBackground()
                }
            }
        }

        latch.await(REACT_BOOT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        if (obtainedContext == null) reactInstanceManager.removeReactInstanceEventListener(listener)
        return obtainedContext
    }

    private fun runHeadlessTask(reactContext: ReactContext, timeBudgetMs: Long): Boolean {
        val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
        val latch = CountDownLatch(1)
        var startedTaskId = -1

        val listener = object : HeadlessJsTaskEventListener {
            override fun onHeadlessJsTaskStart(taskId: Int) = Unit
            override fun onHeadlessJsTaskFinish(taskId: Int) {
                if (taskId == startedTaskId) latch.countDown()
            }
        }

        taskContext.addTaskEventListener(listener)
        try {
            UiThreadUtil.runOnUiThread {
                try {
                    val data = Arguments.createMap().apply {
                        putDouble(KEY_TIME_BUDGET_MS, timeBudgetMs.toDouble())
                        putString("reason", "android-worker")
                    }
                    startedTaskId = taskContext.startTask(
                        HeadlessJsTaskConfig(
                            "BackgroundScan",
                            data,
                            timeBudgetMs + TASK_COMPLETION_GRACE_MS,
                            false, // not allowed in foreground; pre-checked above but races are possible
                        ),
                    )
                } catch (e: IllegalStateException) {
                    // App moved to foreground between our check and startTask.
                    Log.i(TAG, "Headless task rejected: ${e.message}")
                    latch.countDown()
                }
            }

            val finished = latch.await(timeBudgetMs + TASK_COMPLETION_GRACE_MS, TimeUnit.MILLISECONDS)
            if (!finished) Log.w(TAG, "Headless task did not finish within budget")
            return finished
        } finally {
            taskContext.removeTaskEventListener(listener)
            markLastRun()
        }
    }

    private fun markLastRun() {
        applicationContext
            .getSharedPreferences("group.org.bitshala.shroud", Context.MODE_PRIVATE)
            .edit()
            .putLong("background_scan_last_run_at", System.currentTimeMillis())
            .apply()
    }
}
