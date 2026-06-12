// Pure, framework-free model + projection for the AutomationActivityFeed feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/automations/pages/AutomationActivityFeed.tsx + its useAutomationEvents event type and the
// AutomationHistory / AutomationHistoryStats API types). No Compose, no Android, no HTTP: every declaration
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is purely presentational — its parent page builds the execution `history`, the
// `historyStats` summary, the live SSE `liveEvents`, and the SSE `connectionState`, then passes them down. The
// only logic the component itself owns is the parts reproduced here: the per-row status → icon+color mapping
// (web `statusConfig`, falling back to `running`), the per-event type → icon+color mapping (web `typeMap`,
// falling back to `automation.triggered`), the live-event badge label (web `event.type.replace('automation.',
// '')`), the live-event display name (web `'name' in data ? name : '#'+id`), the relative "time ago" bucketing
// (web `timeAgo`), the duration string (web `formatDurationMs`), the success-rate percent (web `fmtPercent`),
// the "stats only when total > 0" guard (web `historyStats && total_executions > 0`), and the loading/empty
// branches. Slice/glyph colors are theme tokens resolved at the Compose boundary (never a raw hex here), so
// the projection carries vendor-neutral [AutomationGlyph] / [AutomationAccent] kinds instead of colors.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AutomationActivityFeed — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.automationactivityfeed

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale

/** Em dash shown for a missing/unparseable value — the web `FALLBACK` ('—') used by `formatDurationMs`. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AutomationActivityFeedRegistration {
    /** Stable surface id. */
    const val ID: String = "automation-activity-feed"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AutomationActivityFeed"
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('automations.*')` keys, flattened to the generated Android catalog names. Referencing them in one
// place keeps the composable and the off-device test in lockstep with the catalog and documents the web →
// native key contract.

/** Panel heading — web `t('automations.recentActivity', 'Recent Activity')`. */
const val KEY_RECENT_ACTIVITY: String = "translation_automations_recentActivity"

/** Connected chip — web `t('automations.live', 'Live')`. */
const val KEY_LIVE: String = "translation_automations_live"

/** Reconnecting chip — web `t('automations.reconnecting', 'Reconnecting')`. */
const val KEY_RECONNECTING: String = "translation_automations_reconnecting"

/** Total-runs stat word — web `t('automations.totalRuns', 'total')`. */
const val KEY_TOTAL_RUNS: String = "translation_automations_totalRuns"

/** Success-rate stat word — web `t('automations.successRate', 'success')`. */
const val KEY_SUCCESS_RATE: String = "translation_automations_successRate"

/** Average-duration stat word — web `t('automations.avgDuration', 'avg')`. */
const val KEY_AVG_DURATION: String = "translation_automations_avgDuration"

/** Empty-state copy — web `t('automations.noHistory', 'No execution history yet')`. */
const val KEY_NO_HISTORY: String = "translation_automations_noHistory"

// ── Semantic glyph + accent classification (web `statusConfig` / `typeMap`) ──

/**
 * Pure glyph key for an activity marker — the native analogue of the lucide icons the web `statusConfig` /
 * `typeMap` switch on (`CheckCircle` / `XCircle` / `SkipForward` / `Activity` / `Clock` / `Zap`). The composable
 * resolves each key to a concrete `ImageVector`; keeping the selection here makes it unit-testable off-device.
 */
enum class AutomationGlyph {
    CheckCircle,
    XCircle,
    SkipForward,
    Activity,
    Clock,
    Bolt,
}

/**
 * Semantic accent role for a marker — the native analogue of the web text color
 * (`green-400` / `amber-400` / `red-400` / `text-muted` / `neon-cyan` / `purple-400` / `blue-400`). The
 * composable maps each role to a design token (never raw hex), so light/dark/high-contrast all stay correct.
 */
enum class AutomationAccent {
    Success,
    Warning,
    Danger,
    Muted,
    Test,
    StateChange,
    Running,
}

/**
 * One execution status — web `AutomationHistoryStatus`
 * (`running | success | partial | failed | skipped | cancelled | test | undo`). [fromRaw] folds an unknown
 * status to [Running], mirroring the web `statusConfig[status] ?? statusConfig.running` fallback.
 */
enum class AutomationRunStatus {
    Success,
    Partial,
    Failed,
    Skipped,
    Cancelled,
    Test,
    Undo,
    Running,
    ;

    companion object {
        fun fromRaw(raw: String): AutomationRunStatus =
            when (raw.trim().lowercase(Locale.ROOT)) {
                "success" -> Success
                "partial" -> Partial
                "failed" -> Failed
                "skipped" -> Skipped
                "cancelled" -> Cancelled
                "test" -> Test
                "undo" -> Undo
                "running" -> Running
                else -> Running
            }
    }
}

/**
 * One live SSE event type — web `AutomationSSEEventType`
 * (`automation.triggered | .succeeded | .failed | .skipped | .state_changed`). [wireSuffix] is the badge label
 * (web `event.type.replace('automation.', '')`); [fromRaw] tolerates the full `automation.x` wire form or the
 * bare suffix and folds an unknown value to [Triggered], mirroring the web `typeMap[type] ?? typeMap['…
 * triggered']` fallback.
 */
enum class AutomationEventType(
    val wireSuffix: String,
) {
    Triggered("triggered"),
    Succeeded("succeeded"),
    Failed("failed"),
    Skipped("skipped"),
    StateChanged("state_changed"),
    ;

    companion object {
        fun fromRaw(raw: String): AutomationEventType {
            val suffix = raw.trim().lowercase(Locale.ROOT).removePrefix("automation.")
            return when (suffix) {
                "triggered" -> Triggered
                "succeeded" -> Succeeded
                "failed" -> Failed
                "skipped" -> Skipped
                "state_changed" -> StateChanged
                else -> Triggered
            }
        }
    }
}

// ── Semantic data (the web props, vendor-neutral) ──

/**
 * One execution-history item — the native analogue of the web `AutomationHistory` fields the row renders:
 * [id], [automationName] (web `automation_name`), [status], [error] (web `error`), [triggeredAt] (web
 * `triggered_at`), [durationMs] (web `duration_ms`, nullable), and the [actionsSucceeded]/[actionsTotal]
 * counts (web `actions_succeeded` / `actions_total`). Pure data (no Compose types).
 */
data class AutomationHistoryEntry(
    val id: Long,
    val automationName: String,
    val status: AutomationRunStatus,
    val error: String?,
    val triggeredAt: String,
    val durationMs: Long?,
    val actionsSucceeded: Int,
    val actionsTotal: Int,
)

/**
 * The execution-history summary — the native analogue of the web `AutomationHistoryStats` fields the header
 * reads: [totalExecutions] (web `total_executions`), [successRate] (web `success_rate`, a 0–100 percent), and
 * [avgDurationMs] (web `avg_duration_ms`).
 */
data class AutomationHistoryStatsModel(
    val totalExecutions: Long,
    val successRate: Double,
    val avgDurationMs: Long?,
)

/**
 * One live SSE event — the native analogue of the web `AutomationActivityEvent`. [name] is the event's
 * automation name (web `event.data.name`, always present in practice but modelled nullable for the defensive
 * `'#'+id` fallback), [automationId] the web `automation_id`, and [error] / [reason] the optional
 * failure/skip detail spans (web `event.data.error` / `event.data.reason`).
 */
data class AutomationLiveEvent(
    val id: String,
    val type: AutomationEventType,
    val name: String?,
    val automationId: Long?,
    val error: String?,
    val reason: String?,
)

/**
 * The loaded execution-history feed payload — the cache-then-network value the host's shared state-holder
 * (P1/S8) carries. Bundles the [history] rows with their [stats] summary (both come from the same web
 * `AutomationHistoryListResponse`: `items` + `summary`).
 */
data class AutomationActivityData(
    val history: List<AutomationHistoryEntry>,
    val stats: AutomationHistoryStatsModel?,
)

// ── Fully projected, render-ready rows ──

/**
 * One render-ready history row — the native analogue of a single web `HistoryRow`. Pure data (the composable
 * maps [glyph]/[accent] to an `ImageVector`/`Color`): [name] is the automation name, [error] the optional
 * danger subtitle, [timeAgo]/[duration] the formatted meta, and [actionsLabel] the `succeeded/total` chip
 * (null when `actions_total == 0`, web `item.actions_total > 0`).
 */
data class AutomationHistoryRow(
    val id: Long,
    val name: String,
    val error: String?,
    val timeAgo: String,
    val duration: String,
    val actionsLabel: String?,
    val glyph: AutomationGlyph,
    val accent: AutomationAccent,
)

/**
 * One render-ready live-event row — the native analogue of a single web `LiveEventRow`. [name] is the resolved
 * display name (web `'name' in data ? name : '#'+id`), [error]/[reason] the optional detail spans, and
 * [badgeLabel] the neutral badge text (web `event.type.replace('automation.', '')`).
 */
data class AutomationLiveRow(
    val id: String,
    val name: String,
    val error: String?,
    val reason: String?,
    val badgeLabel: String,
    val glyph: AutomationGlyph,
    val accent: AutomationAccent,
)

/**
 * The render-ready header stats — the native analogue of the web stats spans. [total] is the raw run count
 * (web `{historyStats.total_executions}`), [successRate] the formatted percent (web `fmtPercent(rate, 0)`),
 * and [avgDuration] the formatted average (web `formatDurationMs(avg_duration_ms)`). The composable appends the
 * localized "total"/"success"/"avg" words.
 */
data class AutomationStatsRow(
    val total: String,
    val successRate: String,
    val avgDuration: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's render-time
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AutomationActivityFeedProjection {
    /** Max live events shown — the web `liveEvents.slice(0, 5)`. */
    const val LIVE_LIMIT: Int = 5

    /** Marker glyph for a history [status] — the web `statusConfig[status].icon` (running fallback in [fromRaw]). */
    fun statusGlyph(status: AutomationRunStatus): AutomationGlyph =
        when (status) {
            AutomationRunStatus.Success -> AutomationGlyph.CheckCircle
            AutomationRunStatus.Partial -> AutomationGlyph.CheckCircle
            AutomationRunStatus.Failed -> AutomationGlyph.XCircle
            AutomationRunStatus.Skipped -> AutomationGlyph.SkipForward
            AutomationRunStatus.Cancelled -> AutomationGlyph.XCircle
            AutomationRunStatus.Test -> AutomationGlyph.Bolt
            AutomationRunStatus.Undo -> AutomationGlyph.Clock
            AutomationRunStatus.Running -> AutomationGlyph.Activity
        }

    /** Marker accent for a history [status] — the web `statusConfig[status].color`. */
    fun statusAccent(status: AutomationRunStatus): AutomationAccent =
        when (status) {
            AutomationRunStatus.Success -> AutomationAccent.Success
            AutomationRunStatus.Partial -> AutomationAccent.Warning
            AutomationRunStatus.Failed -> AutomationAccent.Danger
            AutomationRunStatus.Skipped -> AutomationAccent.Muted
            AutomationRunStatus.Cancelled -> AutomationAccent.Muted
            AutomationRunStatus.Test -> AutomationAccent.Test
            AutomationRunStatus.Undo -> AutomationAccent.StateChange
            AutomationRunStatus.Running -> AutomationAccent.Running
        }

    /** Marker glyph for a live-event [type] — the web `typeMap[type].icon` (triggered fallback in [fromRaw]). */
    fun eventGlyph(type: AutomationEventType): AutomationGlyph =
        when (type) {
            AutomationEventType.Triggered -> AutomationGlyph.Bolt
            AutomationEventType.Succeeded -> AutomationGlyph.CheckCircle
            AutomationEventType.Failed -> AutomationGlyph.XCircle
            AutomationEventType.Skipped -> AutomationGlyph.SkipForward
            AutomationEventType.StateChanged -> AutomationGlyph.Activity
        }

    /** Marker accent for a live-event [type] — the web `typeMap[type].color`. */
    fun eventAccent(type: AutomationEventType): AutomationAccent =
        when (type) {
            AutomationEventType.Triggered -> AutomationAccent.Test
            AutomationEventType.Succeeded -> AutomationAccent.Success
            AutomationEventType.Failed -> AutomationAccent.Danger
            AutomationEventType.Skipped -> AutomationAccent.Muted
            AutomationEventType.StateChanged -> AutomationAccent.StateChange
        }

    /** Resolved display name for a live event — web `'name' in data ? data.name : '#'+automation_id`. */
    fun liveDisplayName(event: AutomationLiveEvent): String = event.name?.takeIf { it.isNotBlank() } ?: "#${event.automationId ?: ""}"

    /**
     * Projects [entries] into render-ready rows, preserving order. [formatTimeAgo] formats each `triggered_at`
     * and [formatDuration] each `duration_ms`; injecting them keeps this function deterministic for tests (the
     * composable supplies the real localized formatters). The `succeeded/total` label is dropped when
     * `actions_total <= 0` (web `item.actions_total > 0`).
     */
    fun projectHistory(
        entries: List<AutomationHistoryEntry>,
        formatTimeAgo: (timestamp: String) -> String,
        formatDuration: (millis: Long?) -> String,
    ): List<AutomationHistoryRow> =
        entries.map { entry ->
            AutomationHistoryRow(
                id = entry.id,
                name = entry.automationName,
                error = entry.error?.takeIf { it.isNotBlank() },
                timeAgo = formatTimeAgo(entry.triggeredAt),
                duration = formatDuration(entry.durationMs),
                actionsLabel = if (entry.actionsTotal > 0) "${entry.actionsSucceeded}/${entry.actionsTotal}" else null,
                glyph = statusGlyph(entry.status),
                accent = statusAccent(entry.status),
            )
        }

    /**
     * Projects the most recent [limit] live [events] into render-ready rows, preserving order — the web
     * `liveEvents.slice(0, 5)` then `map`.
     */
    fun projectLive(
        events: List<AutomationLiveEvent>,
        limit: Int = LIVE_LIMIT,
    ): List<AutomationLiveRow> =
        events.take(limit.coerceAtLeast(0)).map { event ->
            AutomationLiveRow(
                id = event.id,
                name = liveDisplayName(event),
                error = event.error?.takeIf { it.isNotBlank() },
                reason = event.reason?.takeIf { it.isNotBlank() },
                badgeLabel = event.type.wireSuffix,
                glyph = eventGlyph(event.type),
                accent = eventAccent(event.type),
            )
        }

    /**
     * Projects the header [stats] into a render-ready row, or `null` when there is nothing to show — the web
     * `historyStats && historyStats.total_executions > 0` guard. [formatDuration] formats the average and
     * [formatPercent] the success rate; injecting them keeps this deterministic for tests.
     */
    fun projectStats(
        stats: AutomationHistoryStatsModel?,
        formatDuration: (millis: Long?) -> String,
        formatPercent: (value: Double) -> String,
    ): AutomationStatsRow? {
        if (stats == null || stats.totalExecutions <= 0L) return null
        return AutomationStatsRow(
            total = stats.totalExecutions.toString(),
            successRate = formatPercent(stats.successRate),
            avgDuration = formatDuration(stats.avgDurationMs),
        )
    }
}

// ── Formatters (web `formatDurationMs` / `fmtPercent`) ──

/**
 * Millisecond duration → "250ms" / "1.5s" — the web `formatDurationMs`: a `null` (web non-finite) yields the
 * [EM_DASH] fallback, sub-second values render as integer milliseconds, and everything else as seconds with one
 * decimal. The seconds decimal uses [Locale.ROOT] to match the web `toFixed(1)` (always a '.' separator).
 */
fun formatDurationMs(millis: Long?): String =
    when {
        millis == null -> EM_DASH
        millis < MILLIS_PER_SECOND -> "${millis}ms"
        else -> "${String.format(Locale.ROOT, "%.1f", millis / MILLIS_PER_SECOND_D)}s"
    }

/**
 * 0–100 value → grouped, zero-decimal percent ("85%") — the web `fmtPercent(value, 0)` (`fmtNumber(value, 0)`
 * + '%'). A non-finite value folds to 0 (web `safeNumber`); rounding is half-up to match the JS
 * `toLocaleString` behaviour.
 */
fun formatPercentInt(
    value: Double,
    locale: Locale = Locale.getDefault(),
): String {
    val safe = if (value.isFinite()) value else 0.0
    val formatter =
        NumberFormat.getNumberInstance(locale).apply {
            maximumFractionDigits = 0
            minimumFractionDigits = 0
            roundingMode = RoundingMode.HALF_UP
        }
    return "${formatter.format(safe)}%"
}

/**
 * Tolerant ISO-8601 → relative-age bucketing — the native analogue of the web `timeAgo`. Pure (java.time only)
 * so it is unit-tested deterministically with a fixed clock; the composable resolves the [FreshnessAge] bucket
 * to a localized string via the shared `translation_freshness_*` keys.
 */
object AutomationTimeFormatting {
    /**
     * Whole seconds between [timestamp] and [nowMillis] (may be negative for a future stamp); `null` when the
     * timestamp is blank or unparseable so the composable can render the em-dash fallback.
     */
    fun ageSeconds(
        timestamp: String,
        nowMillis: Long,
    ): Long? {
        val instant = parseInstant(timestamp) ?: return null
        return (nowMillis - instant.toEpochMilli()) / MILLIS_PER_SECOND
    }

    /**
     * Buckets an [ageSeconds] exactly like the web `timeAgo`: `< 1m` → just-now, `< 60m` → minutes, `< 24h` →
     * hours, else days (negative ages are clamped to "just now", matching the web minute-floor comparison). A
     * `null` age yields [FreshnessAge.Unknown] (em-dash at the boundary).
     */
    fun relativeAge(ageSeconds: Long?): FreshnessAge {
        if (ageSeconds == null) return FreshnessAge.Unknown
        val minutes = ageSeconds.coerceAtLeast(0) / SECONDS_PER_MINUTE
        return when {
            minutes < 1 -> FreshnessAge.JustNow
            minutes < MINUTES_PER_HOUR -> FreshnessAge.Minutes(minutes)
            minutes / MINUTES_PER_HOUR < HOURS_PER_DAY -> FreshnessAge.Hours(minutes / MINUTES_PER_HOUR)
            else -> FreshnessAge.Days(minutes / MINUTES_PER_HOUR / HOURS_PER_DAY)
        }
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

// ── Lifecycle classifier (per-state coverage) ──

/**
 * The mutually-exclusive history-area surface the composable switches on — the native lifecycle chrome the
 * host's cache-then-network feed implies around the web component's loading/content/empty branches. [Ready]
 * then internally renders the history rows or the empty state from the projected rows; [Loading]/[Error] render
 * the first-load skeleton and the retry surface.
 */
enum class AutomationHistorySurface {
    Loading,
    Error,
    Ready,
}

/**
 * Classifies the lifecycle flags of a `UiState` into the history surface to render. A first load with nothing
 * cached shows [Loading]; a hard error with no cached fallback shows [Error]; everything else (content, empty,
 * and stale/offline "last known") is [Ready] and lets the projected rows decide list-vs-empty. Loading takes
 * precedence over error so a refresh-with-skeleton never flashes the error surface.
 */
fun automationHistorySurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): AutomationHistorySurface =
    when {
        isLoading -> AutomationHistorySurface.Loading
        isError -> AutomationHistorySurface.Error
        else -> AutomationHistorySurface.Ready
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AutomationActivityFeedRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordAutomationActivityFeedOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AutomationActivityFeedRegistration.SLUG))
}

private const val MILLIS_PER_SECOND: Long = 1000L
private const val MILLIS_PER_SECOND_D: Double = 1000.0
private const val SECONDS_PER_MINUTE: Long = 60L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L
