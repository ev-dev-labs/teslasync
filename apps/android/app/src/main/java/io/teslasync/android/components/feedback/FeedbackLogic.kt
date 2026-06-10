package io.teslasync.android.components.feedback

import java.util.Locale

/*
 * Framework-free logic backing the feedback layer (banner/callout tone, query-error
 * classification, countdown + retry windows, version comparison, toast queue management,
 * onboarding/tour step navigation, goto key-sequence routing, job-drawer visibility, draft
 * ordering, skeleton + threshold math). Extracted so the behavior is covered by fast JVM unit
 * tests in the `:android:testDebugUnitTest` gate, independent of the Compose UI layer. Mirrors
 * the data-display layer's `*Logic.kt` split.
 */

/** Severity tier shared by banners, callouts, and toasts (mirrors web `CalloutVariant`). */
enum class Tone { Info, Success, Warning, Danger }

// ── Countdown + retry windows ────────────────────────────────────────────────

/** Seconds remaining until [expiresAtMs], rounded up and floored at zero (rate-limit cooldown). */
fun remainingSeconds(
    expiresAtMs: Long,
    nowMs: Long,
): Int {
    val deltaMs = expiresAtMs - nowMs
    if (deltaMs <= 0L) return 0
    return ((deltaMs + MILLIS_PER_SECOND - 1) / MILLIS_PER_SECOND).toInt()
}

/** A retry affordance is enabled once the cooldown window has elapsed. */
fun retryEnabled(remaining: Int): Boolean = remaining <= 0

/** Formats a non-negative second count as `m:ss` (session-expiry / cooldown countdown). */
fun formatCountdown(seconds: Int): String {
    val safe = seconds.coerceAtLeast(0)
    val minutes = safe / SECONDS_PER_MINUTE
    val secs = safe % SECONDS_PER_MINUTE
    return "$minutes:${secs.toString().padStart(2, '0')}"
}

// ── Query-error classification ───────────────────────────────────────────────

/** Recovery-oriented buckets a failed query maps onto (mirrors web `QueryError`). */
enum class QueryErrorKind { Waiting, NotFound, Unauthorized, ServerError, Offline, Network }

/**
 * Classifies a query failure by HTTP [status] + connectivity so the UI can show actionable copy:
 * transient back-pressure → [QueryErrorKind.Waiting]; 404 → [QueryErrorKind.NotFound]; 401/403 →
 * [QueryErrorKind.Unauthorized]; 5xx → [QueryErrorKind.ServerError]; offline or `status == 0` →
 * [QueryErrorKind.Offline]; everything else → [QueryErrorKind.Network].
 */
fun classifyQueryError(
    status: Int?,
    online: Boolean,
    transientWaiting: Boolean,
): QueryErrorKind =
    when {
        transientWaiting -> QueryErrorKind.Waiting
        status == HTTP_NOT_FOUND -> QueryErrorKind.NotFound
        status == HTTP_UNAUTHORIZED || status == HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
        status != null && status >= HTTP_SERVER_ERROR -> QueryErrorKind.ServerError
        !online || status == 0 -> QueryErrorKind.Offline
        else -> QueryErrorKind.Network
    }

/** Whether the [QueryErrorKind] should auto-retry when connectivity returns (offline only). */
fun autoRetriesOnReconnect(kind: QueryErrorKind): Boolean = kind == QueryErrorKind.Offline

// ── Skeleton + threshold math ────────────────────────────────────────────────

/** Width fraction for a multi-line skeleton row; the final line is shortened to 60%. */
fun skeletonLineFraction(
    index: Int,
    lines: Int,
): Float = if (lines > 1 && index == lines - 1) LAST_LINE_FRACTION else 1f

/** A gated section is unlocked once [currentCount] reaches [threshold]. */
fun thresholdReached(
    currentCount: Int,
    threshold: Int,
): Boolean = currentCount >= threshold

/** Items still needed before a thresholded section unlocks (floored at zero). */
fun remainingToThreshold(
    currentCount: Int,
    threshold: Int,
): Int = (threshold - currentCount).coerceAtLeast(0)

// ── Version comparison (new-version / reload prompts) ─────────────────────────

/** Compares two dotted version strings numerically. Negative/0/positive like [Int.compareTo]. */
fun compareVersions(
    a: String,
    b: String,
): Int {
    val pa = versionParts(a)
    val pb = versionParts(b)
    val count = maxOf(pa.size, pb.size)
    var result = 0
    var i = 0
    while (i < count && result == 0) {
        result = pa.getOrElse(i) { 0 }.compareTo(pb.getOrElse(i) { 0 })
        i++
    }
    return result
}

/** Whether [latest] is strictly newer than [current] — drives the new-version banner. */
fun isNewerVersion(
    current: String,
    latest: String,
): Boolean = compareVersions(latest, current) > 0

private fun versionParts(value: String): List<Int> =
    value
        .trim()
        .removePrefix("v")
        .split('.', '-', '+')
        .mapNotNull { segment -> segment.takeWhile(Char::isDigit).toIntOrNull() }

// ── Toast queue ──────────────────────────────────────────────────────────────

/** One transient toast/snackbar entry. */
data class ToastItem(
    val id: Long,
    val message: String,
    val tone: Tone = Tone.Info,
    val actionLabel: String? = null,
)

/** Appends [item], dropping the oldest entries so the queue never exceeds [max] (when > 0). */
fun enqueueToast(
    queue: List<ToastItem>,
    item: ToastItem,
    max: Int,
): List<ToastItem> {
    val appended = queue + item
    return if (max > 0 && appended.size > max) appended.takeLast(max) else appended
}

/** Removes the toast with [id] from the queue. */
fun dismissToast(
    queue: List<ToastItem>,
    id: Long,
): List<ToastItem> = queue.filterNot { it.id == id }

// ── Onboarding / tour step navigation ────────────────────────────────────────

/** Clamps a step index into `[0, total)` (empty flows clamp to 0). */
fun clampStepIndex(
    index: Int,
    total: Int,
): Int = if (total <= 0) 0 else index.coerceIn(0, total - 1)

/** Next step index, clamped to the last step. */
fun nextStepIndex(
    index: Int,
    total: Int,
): Int = clampStepIndex(index + 1, total)

/** Previous step index, clamped to the first step. */
fun prevStepIndex(index: Int): Int = (index - 1).coerceAtLeast(0)

/** Whether [index] is the first step. */
fun isFirstStep(index: Int): Boolean = index <= 0

/** Whether [index] is the final step of a [total]-step flow. */
fun isLastStep(
    index: Int,
    total: Int,
): Boolean = total > 0 && index >= total - 1

/** Fractional progress `(index + 1) / total` in `[0, 1]` for a step indicator. */
fun stepProgress(
    index: Int,
    total: Int,
): Float = if (total <= 0) 0f else ((index + 1).toFloat() / total).coerceIn(0f, 1f)

// ── Goto key-sequence routing (keyboard quick-nav indicator) ──────────────────

/** Appends [key] to a goto buffer, keeping only the most recent [maxLen] characters. */
fun appendGotoKey(
    buffer: String,
    key: Char,
    maxLen: Int,
): String {
    val next = buffer + key
    return if (maxLen > 0 && next.length > maxLen) next.takeLast(maxLen) else next
}

/** Resolves the destination route for a completed goto [buffer], or null when no match. */
fun matchGotoRoute(
    buffer: String,
    routes: Map<String, String>,
): String? = routes[buffer]

// ── Job-progress drawer ──────────────────────────────────────────────────────

/** Lifecycle of an async export/job (mirrors web export job status). */
enum class JobStatus { Queued, Processing, Ready, Failed, Expired }

/** Compact summary of one async job rendered by the progress drawer. */
data class JobSummary(
    val id: String,
    val label: String,
    val status: JobStatus,
    val format: String? = null,
    val sizeBytes: Long? = null,
    val errorMessage: String? = null,
)

/** A job is "active" while queued or processing. */
fun isJobActive(status: JobStatus): Boolean = status == JobStatus.Queued || status == JobStatus.Processing

/** Active jobs, preserving input order. */
fun activeJobs(jobs: List<JobSummary>): List<JobSummary> = jobs.filter { isJobActive(it.status) }

/** Finished jobs, capped to the [max] most recent (input order). */
fun recentJobs(
    jobs: List<JobSummary>,
    max: Int,
): List<JobSummary> = jobs.filterNot { isJobActive(it.status) }.take(max.coerceAtLeast(0))

/** Persisted visibility of the drawer. */
enum class DrawerVisibility { Open, Minimized, Dismissed }

/** A new active job re-surfaces a dismissed drawer as a minimized chip. */
fun resolveDrawerVisibility(
    current: DrawerVisibility,
    activeCount: Int,
): DrawerVisibility = if (current == DrawerVisibility.Dismissed && activeCount > 0) DrawerVisibility.Minimized else current

/** The drawer renders nothing when dismissed-and-idle, or when there is genuinely nothing to show. */
fun drawerHidden(
    visibility: DrawerVisibility,
    activeCount: Int,
    totalJobs: Int,
    loading: Boolean,
): Boolean =
    when {
        visibility == DrawerVisibility.Dismissed && activeCount == 0 -> true
        totalJobs == 0 && !loading -> true
        else -> false
    }

// ── Unsaved drafts (session-expiry modal) ─────────────────────────────────────

/** A persisted, unsaved form draft surfaced before a forced sign-out. */
data class DraftSummary(
    val label: String,
    val savedAtMs: Long? = null,
)

/** Drafts ordered most-recent-first; unknown timestamps sort last. */
fun sortedDrafts(drafts: List<DraftSummary>): List<DraftSummary> = drafts.sortedByDescending { it.savedAtMs ?: 0L }

// ── Byte sizes (job drawer / export rows) ────────────────────────────────────

/** Humanizes a byte count as B/KB/MB/GB/TB (1024-based). Null/negative → null. */
fun formatBytes(bytes: Long?): String? {
    if (bytes == null || bytes < 0L) return null
    var value = bytes / 1.0
    var unit = 0
    while (value >= BYTES_PER_STEP && unit < BYTE_UNITS.lastIndex) {
        value /= BYTES_PER_STEP
        unit++
    }
    return if (unit == 0) "$bytes ${BYTE_UNITS[0]}" else String.format(Locale.US, "%.1f %s", value, BYTE_UNITS[unit])
}

private val BYTE_UNITS = listOf("B", "KB", "MB", "GB", "TB")
private const val BYTES_PER_STEP = 1024.0

private const val MILLIS_PER_SECOND = 1_000L
private const val SECONDS_PER_MINUTE = 60
private const val LAST_LINE_FRACTION = 0.6f
private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR = 500
