package io.teslasync.shared.core.presentation.systemqueues

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * The wire shapes of the worker job-queue feeds — the cross-platform port of the web
 * `useSystemQueues` hook domain's response types (web/src/api/types.ts: `QueueStat`,
 * `QueueStatusResponse`, `QueueJobView`, `QueueJobsResponse`), which mirror the Go handler under
 * `internal/api` answering `GET /api/v1/system/queues` and `GET /api/v1/system/queues/{worker}/jobs`.
 * Keys arrive snake_case; they are matched verbatim via @SerialName so the cached payload
 * round-trips unchanged.
 *
 * None of these fields is display-unit-bearing in the SI sense — counts are dimensionless, ages are
 * whole seconds, and job durations are whole milliseconds (the web renders each with a plain number
 * or relative-time formatter) — so there is no SI conversion at this layer; any display formatting
 * is the render boundary's job (S5). Optional fields default so a partial server row decodes rather
 * than failing the whole feed.
 */

/**
 * One worker row returned in [QueueStatusResponse.workers] (web `QueueStat`). Counts aggregate each
 * worker's domain table over the last 24 hours; the heartbeat fields come from the worker's Redis
 * `worker_status` key.
 *
 * @property worker stable worker identifier — routes the per-worker drawer (web `worker`).
 * @property displayName human-readable label (English fallback; the render layer may translate).
 * @property pending items waiting to be picked up by the worker.
 * @property inProgress items currently being processed.
 * @property succeeded24h items completed successfully in the last 24 hours.
 * @property failed24h items that failed terminally in the last 24 hours.
 * @property oldestPendingAgeSeconds age in whole seconds of the oldest pending item (0 = none).
 * @property heartbeatSeverity colour band for the heartbeat freshness (`ok`|`warn`|`critical`|`down`).
 * @property heartbeatDetail operator-facing footnote (e.g. "Last beat 7m ago").
 * @property lastHeartbeatAt ISO-8601 instant of the worker's most recent heartbeat, or `null`.
 * @property startedAt ISO-8601 instant the current worker process started, or `null`.
 * @property host hostname the worker is running on; empty when the backend omits it.
 * @property version build version reported by the worker; empty when the backend omits it.
 */
@Serializable
public data class QueueStat(
    val worker: String = "",
    @SerialName("display_name") val displayName: String = "",
    val pending: Long = 0L,
    @SerialName("in_progress") val inProgress: Long = 0L,
    @SerialName("succeeded_24h") val succeeded24h: Long = 0L,
    @SerialName("failed_24h") val failed24h: Long = 0L,
    @SerialName("oldest_pending_age_seconds") val oldestPendingAgeSeconds: Long = 0L,
    @SerialName("heartbeat_severity") val heartbeatSeverity: String = "",
    @SerialName("heartbeat_detail") val heartbeatDetail: String = "",
    @SerialName("last_heartbeat_at") val lastHeartbeatAt: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    val host: String = "",
    val version: String = "",
)

/**
 * The `GET /system/queues` envelope (web `QueueStatusResponse`).
 *
 * @property generatedAt ISO-8601 instant the snapshot was composed (web `generated_at`).
 * @property workers the per-worker status rows; empty when no worker has reported.
 */
@Serializable
public data class QueueStatusResponse(
    @SerialName("generated_at") val generatedAt: String = "",
    val workers: List<QueueStat> = emptyList(),
)

/**
 * One recent-job row rendered inside the per-worker drawer (web `QueueJobView`).
 *
 * @property id stable job identifier.
 * @property worker the worker that ran the job.
 * @property status terminal/in-flight status string (backend enum).
 * @property title human-readable job label.
 * @property startedAt ISO-8601 instant the job started (web `started_at`).
 * @property finishedAt ISO-8601 instant the job finished, or `null` while still running.
 * @property durationMs job wall-clock duration in whole milliseconds, or `null` when not finished.
 * @property error terminal error message; empty when the job succeeded or is still running.
 */
@Serializable
public data class QueueJobView(
    val id: String = "",
    val worker: String = "",
    val status: String = "",
    val title: String = "",
    @SerialName("started_at") val startedAt: String = "",
    @SerialName("finished_at") val finishedAt: String? = null,
    @SerialName("duration_ms") val durationMs: Long? = null,
    val error: String = "",
)

/**
 * The `GET /system/queues/{worker}/jobs` envelope (web `QueueJobsResponse`).
 *
 * @property worker the worker the [jobs] belong to (echoed by the backend).
 * @property jobs the recent job rows, newest first; empty when the worker has run nothing.
 */
@Serializable
public data class QueueJobsResponse(
    val worker: String = "",
    val jobs: List<QueueJobView> = emptyList(),
)
