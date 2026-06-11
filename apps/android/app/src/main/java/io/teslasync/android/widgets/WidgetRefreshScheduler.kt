package io.teslasync.android.widgets

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules the widget background refresh responsibly (P3/A8, ADR-009): a unique ~30-minute periodic
 * job (well within WorkManager's 15-minute floor and the OS throttling envelope) plus a coalesced
 * one-shot for "added a widget" and the offline/error retry tap. Both require a network connection, so
 * the OS never wakes the app to refresh while offline — the widget simply keeps showing last-known
 * cached data.
 */
object WidgetRefreshScheduler {
    private const val PERIODIC_WORK = "teslasync.widget.refresh.periodic"
    private const val ONE_TIME_WORK = "teslasync.widget.refresh.oneshot"
    private const val PERIOD_MINUTES = 30L

    /** Ensures the periodic refresh is enqueued (idempotent — keeps any existing schedule). */
    fun schedulePeriodic(context: Context) {
        val request =
            PeriodicWorkRequestBuilder<WidgetRefreshWorker>(PERIOD_MINUTES, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Enqueues a single on-demand refresh now (coalesced so rapid taps do not stack up). */
    fun enqueueOneTime(context: Context) {
        val request =
            OneTimeWorkRequestBuilder<WidgetRefreshWorker>()
                .setConstraints(networkConstraints())
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONE_TIME_WORK, ExistingWorkPolicy.KEEP, request)
    }

    /** Cancels the periodic refresh (e.g. when the last widget is removed). */
    fun cancelPeriodic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
    }

    private fun networkConstraints(): Constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
}
