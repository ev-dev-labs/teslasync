// File hosts the NotificationStats surface's pure model + projection + registry; named after the
// surface bundle (NotificationStatsWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.notificationstats

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val NOTIFICATION_STATS_EM_DASH: String = "\u2014"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`
 * plus the `isCompact` / `isWide` logic in
 * `web/src/features/dashboard/widgets/NotificationStatsWidget.tsx`.
 */
data class NotificationStatsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): show the big delivery-rate number. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): widen the grid + add the log table. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for the Notification Stats surface — the native mirror of the web
 * registry entry in `web/src/features/dashboard/widgets/registry/alerts.ts` (`notification-stats`).
 * A dashboard host binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE]
 * footprint constraints.
 */
object NotificationStatsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "notification-stats"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "alerts"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotificationStatsWidget"

    /** Recent-log rows shown in the compact layout (web `isCompact ? 3 : 5`). */
    const val RECENT_LOG_LIMIT_COMPACT: Int = 3

    /** Recent-log rows shown in the standard/wide layout (web `isCompact ? 3 : 5`). */
    const val RECENT_LOG_LIMIT_STANDARD: Int = 5

    /** Delivery rate (%) at or above which the surface flags delivery as healthy (web `>= 95`). */
    const val HEALTHY_DELIVERY_RATE: Double = 95.0

    /** Default footprint: 2 columns × 2 rows. */
    val DEFAULT_SIZE: NotificationStatsSize = NotificationStatsSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: NotificationStatsSize = NotificationStatsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: NotificationStatsSize = NotificationStatsSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: NotificationStatsSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: NotificationStatsSize): NotificationStatsSize =
        NotificationStatsSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The four headline figures the surface renders — the native port of the web component's
 * `totalSent` / `sent` / `failed` / `enabledChannels` reads and the `deliveryRate` derivation
 * (`totalSent > 0 ? (sent / totalSent) * 100 : 0`). Pure data; no Compose, no formatting.
 */
data class NotificationStatsSummary(
    val totalSent: Long,
    val sent: Long,
    val failed: Long,
    val enabledChannels: Long,
    val deliveryRate: Double,
) {
    companion object {
        /** Derives the summary from a raw [NotificationStats] (web `stats?.field ?? 0` + rate). */
        fun from(stats: NotificationStats): NotificationStatsSummary {
            val totalSent = stats.totalSent
            val sent = stats.sent
            val rate =
                if (totalSent > 0L) {
                    sent.toDouble() / totalSent.toDouble() * PERCENT // parity:allow toDouble() numeric conversion not a stub
                } else {
                    0.0
                }
            return NotificationStatsSummary(
                totalSent = totalSent,
                sent = sent,
                failed = stats.failed,
                enabledChannels = stats.enabledChannels,
                deliveryRate = rate,
            )
        }

        private const val PERCENT = 100.0
    }
}

/** Which headline figure a [NotificationStatTile] represents (resolves its label + icon on render). */
enum class NotificationStatKind { TotalSent, DeliveryRate, Failed, ActiveChannels }

/** The trailing trend label on a stat tile; the render layer resolves the i18n words. */
sealed interface NotificationStatTrendLabel {
    /** "Healthy" — delivery rate at or above the healthy threshold. */
    data object Healthy : NotificationStatTrendLabel

    /** "Needs attention" — one or more failed deliveries. */
    data object NeedsAttention : NotificationStatTrendLabel

    /** A pre-formatted count (the web `fmtInt(totalSent)` trend value). */
    data class Count(
        val text: String,
    ) : NotificationStatTrendLabel
}

/**
 * One tile's optional trend chip — the native port of the web `WidgetStatGrid` `trend` slot, which
 * is rendered only when BOTH a direction AND a trend value are present. [positive] mirrors the web
 * `positive: stat.trend === 'up'` (green when up, red otherwise).
 */
data class NotificationStatTrend(
    val direction: DeltaArrow,
    val label: NotificationStatTrendLabel,
    val positive: Boolean,
)

/**
 * One projected, display-ready stat tile consumed by the Compose view — the Android port of a
 * `StatGridItem` in `web/src/features/dashboard/widgets/NotificationStatsWidget.tsx`. Pure data:
 * the resolved [kind] (label + icon resolved on render), the formatted [value] + optional [unit],
 * the [danger] flag (web `valueColor: failed > 0 ? 'text-red-400'`), and the optional [trend] chip.
 */
data class NotificationStatTile(
    val kind: NotificationStatKind,
    val value: String,
    val unit: String?,
    val danger: Boolean,
    val trend: NotificationStatTrend?,
)

/**
 * Pure projection from raw stats/logs to the display model — the Android port of the `useMemo`
 * `coreStats` + `recentLogs` blocks and the `fmtInt`/`fmtNumber` helpers in
 * `web/src/features/dashboard/widgets/NotificationStatsWidget.tsx`. Framework-free so the gate
 * unit-tests it without a device.
 */
object NotificationStatsProjection {
    /** Delivery-rate precision (web `fmtNumber(deliveryRate, 1)`). */
    const val DELIVERY_RATE_DECIMALS: Int = 1

    /** Integer precision with locale grouping (web `fmtInt` = `fmtNumber(v, 0)`). */
    const val COUNT_DECIMALS: Int = 0

    /** Format an integer count with locale grouping (web `fmtInt`). */
    fun formatCount(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value.toDouble(), COUNT_DECIMALS, locale) // parity:allow toDouble() numeric conversion not a stub

    /** Format the delivery rate with one decimal (web `fmtNumber(deliveryRate, 1)`). */
    fun formatRate(
        rate: Double,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(rate, DELIVERY_RATE_DECIMALS, locale)

    /**
     * The four core stat tiles — a 1:1 port of the web `coreStats` array (order preserved):
     * Total Sent (up-trend + count when > 0), Delivery Rate (up-trend + "Healthy" when ≥ 95),
     * Failed (down-trend + "Needs attention" + danger when > 0), and Active Channels (no trend).
     */
    fun tiles(
        summary: NotificationStatsSummary,
        locale: Locale = Locale.getDefault(),
    ): List<NotificationStatTile> =
        listOf(
            totalSentTile(summary, locale),
            deliveryRateTile(summary, locale),
            failedTile(summary, locale),
            activeChannelsTile(summary, locale),
        )

    private fun totalSentTile(
        summary: NotificationStatsSummary,
        locale: Locale,
    ): NotificationStatTile =
        NotificationStatTile(
            kind = NotificationStatKind.TotalSent,
            value = formatCount(summary.totalSent, locale),
            unit = null,
            danger = false,
            trend =
                if (summary.totalSent > 0L) {
                    NotificationStatTrend(
                        direction = DeltaArrow.Up,
                        label = NotificationStatTrendLabel.Count(formatCount(summary.totalSent, locale)),
                        positive = true,
                    )
                } else {
                    null
                },
        )

    private fun deliveryRateTile(
        summary: NotificationStatsSummary,
        locale: Locale,
    ): NotificationStatTile =
        NotificationStatTile(
            kind = NotificationStatKind.DeliveryRate,
            value = formatRate(summary.deliveryRate, locale),
            unit = PERCENT_UNIT,
            danger = false,
            trend =
                if (summary.deliveryRate >= NotificationStatsRegistration.HEALTHY_DELIVERY_RATE) {
                    NotificationStatTrend(
                        direction = DeltaArrow.Up,
                        label = NotificationStatTrendLabel.Healthy,
                        positive = true,
                    )
                } else {
                    null
                },
        )

    private fun failedTile(
        summary: NotificationStatsSummary,
        locale: Locale,
    ): NotificationStatTile =
        NotificationStatTile(
            kind = NotificationStatKind.Failed,
            value = formatCount(summary.failed, locale),
            unit = null,
            danger = summary.failed > 0L,
            trend =
                if (summary.failed > 0L) {
                    NotificationStatTrend(
                        direction = DeltaArrow.Down,
                        label = NotificationStatTrendLabel.NeedsAttention,
                        positive = false,
                    )
                } else {
                    null
                },
        )

    private fun activeChannelsTile(
        summary: NotificationStatsSummary,
        locale: Locale,
    ): NotificationStatTile =
        NotificationStatTile(
            kind = NotificationStatKind.ActiveChannels,
            value = formatCount(summary.enabledChannels, locale),
            unit = null,
            danger = false,
            trend = null,
        )

    /**
     * Newest-first delivery-log rows capped to the layout's budget — the Android port of the web
     * `recentLogs` `useMemo` (`[...list].sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
     * .slice(0, isCompact ? 3 : 5)`).
     */
    fun recentLogs(
        logs: List<NotificationLog>,
        compact: Boolean,
    ): List<NotificationLog> {
        val limit =
            if (compact) {
                NotificationStatsRegistration.RECENT_LOG_LIMIT_COMPACT
            } else {
                NotificationStatsRegistration.RECENT_LOG_LIMIT_STANDARD
            }
        return logs
            .sortedByDescending { parseTimestampMillis(it.createdAt) ?: Long.MIN_VALUE }
            .take(limit)
    }

    /** Parse a `created_at` wire string to epoch millis (tolerant of `Z`, an offset, or no zone). */
    fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }

    private const val PERCENT_UNIT = "%"
}

/**
 * Maps a notification-log `status` onto the badge tone — the Android port of the web
 * `STATUS_VARIANT` map (`sent → success`, `failed → danger`, `pending → warning`) with the web's
 * `?? 'warning'` default for any other status.
 */
fun notificationStatusVariant(status: String): BadgeVariant =
    when (status) {
        STATUS_SENT -> BadgeVariant.Success
        STATUS_FAILED -> BadgeVariant.Danger
        STATUS_PENDING -> BadgeVariant.Warning
        else -> BadgeVariant.Warning
    }

/** The coarse age bucket of a delivery-log row — the native port of the web `formatLogTime`. */
sealed interface NotificationLogTime {
    /** No parseable timestamp (renders the em-dash). */
    data object Unknown : NotificationLogTime

    /** Younger than a minute — web literal "Just now". */
    data object JustNow : NotificationLogTime

    /** `Nm ago` — under an hour old. */
    data class MinutesAgo(
        val value: Long,
    ) : NotificationLogTime

    /** `Nh ago` — under a day old. */
    data class HoursAgo(
        val value: Long,
    ) : NotificationLogTime

    /** A day or older — the render layer formats [epochMillis] as a localized absolute datetime. */
    data class Absolute(
        val epochMillis: Long,
    ) : NotificationLogTime
}

/**
 * Buckets a log row's [timestampMillis] for display — a 1:1 port of the web `formatLogTime`:
 * `< 1 min → JustNow`, `< 60 min → Nm`, `< 24 h → Nh`, else the localized absolute datetime. Pure
 * (the i18n words + absolute formatting are applied by the composable) so it is unit-tested off-device.
 */
fun notificationLogTime(
    timestampMillis: Long?,
    nowMillis: Long,
): NotificationLogTime {
    if (timestampMillis == null) return NotificationLogTime.Unknown
    val diffMinutes = Math.floorDiv(nowMillis - timestampMillis, MILLIS_PER_MINUTE)
    return when {
        diffMinutes < 1L -> NotificationLogTime.JustNow
        diffMinutes < MINUTES_PER_HOUR -> NotificationLogTime.MinutesAgo(diffMinutes)
        else -> hoursOrAbsolute(diffMinutes, timestampMillis)
    }
}

private fun hoursOrAbsolute(
    diffMinutes: Long,
    timestampMillis: Long,
): NotificationLogTime {
    val diffHours = diffMinutes / MINUTES_PER_HOUR
    return if (diffHours < HOURS_PER_DAY) {
        NotificationLogTime.HoursAgo(diffHours)
    } else {
        NotificationLogTime.Absolute(timestampMillis)
    }
}

/**
 * The TalkBack description for a delivery-log row — the channel, type, status, and time joined into a
 * single announcement. Pure so label presence is unit-tested off-device.
 */
fun notificationLogRowDescription(
    channel: String,
    type: String,
    status: String,
    time: String,
): String = "$channel, $type, $status, $time"

/** The mutually-exclusive surface drawn for the current data state (web WidgetShell branches). */
enum class NotificationStatsSurface { Loading, Error, Empty, Content }

/**
 * Decides which surface to render — the native port of the web `WidgetShell` precedence
 * (`loading → error → content/empty`) folded with the widget's own `stats ? … : EmptyState` branch.
 * Loading combines both feeds the way the web `isLoading = statsLoading || logsLoading` does (logs are
 * ignored in the compact layout, which never renders the log table). The error/empty surfaces follow
 * the STATS feed only — the web shell's `error` is `statsError` and the body's empty branch is `!stats`
 * — so a logs-only failure never blanks the panel. Stale/offline stay Content/Empty + a freshness chip.
 */
fun notificationStatsSurface(
    stats: UiState<*>,
    logs: UiState<*>,
    compact: Boolean,
): NotificationStatsSurface {
    val loading = stats.isLoading || (!compact && logs.isLoading)
    return when {
        loading -> NotificationStatsSurface.Loading
        stats.isError -> NotificationStatsSurface.Error
        stats.isEmpty -> NotificationStatsSurface.Empty
        else -> NotificationStatsSurface.Content
    }
}

/** Maps the Android [ErrorKind] + HTTP status onto the feedback layer's recovery-oriented bucket. */
fun notificationStatsErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

private const val STATUS_SENT = "sent"
private const val STATUS_FAILED = "failed"
private const val STATUS_PENDING = "pending"
private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
