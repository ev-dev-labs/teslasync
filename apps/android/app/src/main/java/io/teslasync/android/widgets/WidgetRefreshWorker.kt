package io.teslasync.android.widgets

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import io.teslasync.android.TeslaSyncApplication
import kotlin.coroutines.cancellation.CancellationException

/**
 * The WorkManager job that refreshes the widgets (P3/A8, ADR-009): it drives the shared
 * cache-then-network repositories (updating the offline cache) and recomposes every widget instance
 * with the new sync status. This is the ONLY widget refresh path — there is no held SSE stream.
 *
 * Network failures are not exceptions here (the feeds fold them into a cached "offline" status); an
 * unexpected error re-renders the widgets from cache (so freshness/offline still shows) and asks
 * WorkManager to retry with backoff. The widget container is process-scoped, so this reuses the same
 * authenticated client + offline cache as the app.
 */
class WidgetRefreshWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val container = (applicationContext as? TeslaSyncApplication)?.container?.widgets
        if (container == null || !WidgetUpdater.hasAnyWidgets(applicationContext)) {
            if (container != null) WidgetRefreshScheduler.cancelPeriodic(applicationContext)
            return Result.success()
        }
        return runCatching {
            val statuses = container.refresher.refresh()
            WidgetUpdater.applyAndUpdate(applicationContext, statuses, container.clock.nowMillis())
            Result.success()
        }.getOrElse { error ->
            if (error is CancellationException) throw error
            container.logger.warn("widget.refresh.worker_error")
            WidgetUpdater.updateAll(applicationContext)
            Result.retry()
        }
    }
}
