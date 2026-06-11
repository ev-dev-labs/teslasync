@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.roundToInt

/**
 * The API call-log rollup behind `GET /api-logs/stats` — the native model for the web
 * `useApiLogStats` shape (`APICallLogStats`). Field names mirror the Go API's snake_case wire
 * tags (`last_24h`, `avg_duration_ms`, `error_rate`, `error_count`, `total_calls`); parsing is
 * null-tolerant so a partial body never throws. Response time is milliseconds and the error rate
 * is an already-computed percentage (0..100) — both dimensionless at the display boundary, so no
 * SI unit conversion applies.
 *
 * [hasData] mirrors the web `data` truthiness gate: the backend always returns a populated object
 * (an idle fleet renders as zeros, not as empty), so it is `true` for every real snapshot and only
 * `false` for the [EMPTY] fallback parsed from an absent / non-object body.
 */
data class ApiUsageStats(
    val last24h: Int,
    val avgDurationMs: Double,
    val errorRate: Double,
    val errorCount: Int,
    val totalCalls: Int,
    val hasData: Boolean = true,
) {
    companion object {
        /** The no-payload fallback (web `!data`) — all-zero and flagged as having no data. */
        val EMPTY: ApiUsageStats = ApiUsageStats(0, 0.0, 0.0, 0, 0, hasData = false)

        /** Projects a `GET /api-logs/stats` JSON body into a tolerant snapshot. */
        fun fromJson(element: JsonElement): ApiUsageStats {
            val obj = element as? JsonObject ?: return EMPTY
            return ApiUsageStats(
                last24h = obj.readInt("last_24h"),
                avgDurationMs = obj.readDouble("avg_duration_ms"),
                errorRate = obj.readDouble("error_rate"),
                errorCount = obj.readInt("error_count"),
                totalCalls = obj.readInt("total_calls"),
            )
        }

        private fun JsonObject.readDouble(name: String): Double = (this[name] as? JsonPrimitive)?.doubleOrNull ?: 0.0

        private fun JsonObject.readInt(name: String): Int = readDouble(name).roundToInt()
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` logic in the web source. Note the wide threshold is three columns
 * (web `size.cols >= 3`), unlike the four-column threshold some other surfaces use.
 */
data class ApiUsageSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact`): show the big call-volume number. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three or more columns (web `isWide`): render the stat grid 4-up. */
    val isWide: Boolean get() = cols >= WIDE_THRESHOLD

    /** Stat-grid column count: 4 when wide, otherwise 2 (web `cols={isWide ? 4 : 2}`). */
    val gridColumns: Int get() = if (isWide) WIDE_COLUMNS else STANDARD_COLUMNS

    companion object {
        private const val WIDE_THRESHOLD = 3
        private const val WIDE_COLUMNS = 4
        private const val STANDARD_COLUMNS = 2
    }
}

/** Which line glyph a stat tile renders (resolved to a vector at the Compose boundary). */
enum class ApiUsageStatIcon { TotalCalls, AvgResponse, ErrorRate, Errors }

/**
 * One projected, render-ready stat tile. Holds the localized [label], the already-formatted
 * [value], an optional [unit] suffix, the [icon] role, an [isAlert] flag (the value renders in the
 * danger color — web `valueColor: 'text-red-400'`), an optional [trendLabel] chip (web `trendValue`,
 * only the "High" error-rate badge), and a merged [contentDescription] for screen readers.
 */
data class ApiUsageStatTile(
    val label: String,
    val value: String,
    val unit: String?,
    val icon: ApiUsageStatIcon,
    val isAlert: Boolean,
    val trendLabel: String?,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the API-usage stats for one footprint — the native
 * analogue of everything the web component computes via `useMemo` before returning JSX. Pure data
 * so the projection is unit-tested without a Compose host.
 */
@Suppress("LongParameterList")
data class ApiUsageDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val isWide: Boolean,
    val gridColumns: Int,
    val stats: List<ApiUsageStatTile>,
    val compactValue: String,
    val compactLabel: String,
    val showCompactError: Boolean,
    val compactErrorText: String,
    val compactContentDescription: String,
)

/**
 * The localized strings the projection needs, resolved through the i18n facade at the Compose
 * boundary and passed in so the projection itself stays framework-free and JVM-testable. Each field
 * maps to a `widget.apiUsage.*` key from the web source.
 */
@Suppress("LongParameterList")
data class ApiUsageStrings(
    val title: String,
    val totalCalls: String,
    val avgResponse: String,
    val errorRate: String,
    val totalErrors: String,
    val high: String,
    val calls24h: String,
    val errors: String,
    val noData: String,
)

/**
 * Pure projection from a raw [ApiUsageStats] to the display model — the native port of the
 * `coreStats` `useMemo` and the compact branch in the web source. Counts and rates are dimensionless
 * (no SI conversion); every label is supplied already-localized via [ApiUsageStrings].
 */
object ApiUsageProjection {
    /** Error-rate percentage above which the value turns red and the "High" chip shows (web `> 5`). */
    const val ERROR_RATE_ALERT_THRESHOLD: Double = 5.0

    private const val MS_UNIT = "ms"
    private const val PERCENT_UNIT = "%"
    private const val INT_DECIMALS = 0
    private const val RATE_DECIMALS = 1

    /** Project [data] for [size], formatting numbers with [locale] and labelling via [strings]. */
    fun project(
        data: ApiUsageStats,
        size: ApiUsageSize,
        strings: ApiUsageStrings,
        locale: Locale = Locale.getDefault(),
    ): ApiUsageDisplay {
        val totalCallsValue = count(data.last24h, locale)
        val errorRateValue = ChartFormat.number(data.errorRate, RATE_DECIMALS, locale)
        val showCompactError = data.errorRate > ERROR_RATE_ALERT_THRESHOLD
        val compactErrorText = if (showCompactError) "$errorRateValue$PERCENT_UNIT ${strings.errors}" else ""
        return ApiUsageDisplay(
            hasData = data.hasData,
            isCompact = size.isCompact,
            isWide = size.isWide,
            gridColumns = size.gridColumns,
            stats = coreStats(data, strings, locale),
            compactValue = totalCallsValue,
            compactLabel = strings.calls24h,
            showCompactError = showCompactError,
            compactErrorText = compactErrorText,
            compactContentDescription = compactDescription(totalCallsValue, strings, showCompactError, compactErrorText),
        )
    }

    private fun coreStats(
        data: ApiUsageStats,
        strings: ApiUsageStrings,
        locale: Locale,
    ): List<ApiUsageStatTile> {
        val totalCallsValue = count(data.last24h, locale)
        val avgResponseValue = ChartFormat.number(data.avgDurationMs, RATE_DECIMALS, locale)
        val errorRateValue = ChartFormat.number(data.errorRate, RATE_DECIMALS, locale)
        val errorsValue = count(data.errorCount, locale)
        val errorRateAlert = data.errorRate > ERROR_RATE_ALERT_THRESHOLD
        val errorsAlert = data.errorCount > 0
        return listOf(
            ApiUsageStatTile(
                label = strings.totalCalls,
                value = totalCallsValue,
                unit = null,
                icon = ApiUsageStatIcon.TotalCalls,
                isAlert = false,
                trendLabel = null,
                contentDescription = describe(strings.totalCalls, totalCallsValue, null),
            ),
            ApiUsageStatTile(
                label = strings.avgResponse,
                value = avgResponseValue,
                unit = MS_UNIT,
                icon = ApiUsageStatIcon.AvgResponse,
                isAlert = false,
                trendLabel = null,
                contentDescription = describe(strings.avgResponse, avgResponseValue, MS_UNIT),
            ),
            ApiUsageStatTile(
                label = strings.errorRate,
                value = errorRateValue,
                unit = PERCENT_UNIT,
                icon = ApiUsageStatIcon.ErrorRate,
                isAlert = errorRateAlert,
                trendLabel = if (errorRateAlert) strings.high else null,
                contentDescription = describe(strings.errorRate, errorRateValue, PERCENT_UNIT),
            ),
            ApiUsageStatTile(
                label = strings.totalErrors,
                value = errorsValue,
                unit = null,
                icon = ApiUsageStatIcon.Errors,
                isAlert = errorsAlert,
                trendLabel = null,
                contentDescription = describe(strings.totalErrors, errorsValue, null),
            ),
        )
    }

    private fun compactDescription(
        totalCallsValue: String,
        strings: ApiUsageStrings,
        showCompactError: Boolean,
        compactErrorText: String,
    ): String =
        buildString {
            append(totalCallsValue)
            append(' ')
            append(strings.calls24h)
            if (showCompactError) {
                append(", ")
                append(compactErrorText)
            }
        }

    private fun count(
        value: Int,
        locale: Locale,
    ): String = ChartFormat.number(value * 1.0, INT_DECIMALS, locale)

    private fun describe(
        label: String,
        value: String,
        unit: String?,
    ): String = if (unit.isNullOrEmpty()) "$label: $value" else "$label: $value $unit"
}

/**
 * Canonical registry metadata for the API Usage surface — the native mirror of the web registry
 * entry (`web/src/features/dashboard/widgets/registry/system.ts`). A dashboard grid host binds this
 * surface with the same [ID] and honours the same size constraints.
 */
object ApiUsageRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "api-usage"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "APIUsageWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "API call volume, response times, error rates, top endpoints"

    /** Default footprint: 2 columns × 2 rows. */
    val defaultSize: ApiUsageSize = ApiUsageSize(2, 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: ApiUsageSize = ApiUsageSize(1, 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: ApiUsageSize = ApiUsageSize(4, 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: ApiUsageSize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: ApiUsageSize): ApiUsageSize =
        ApiUsageSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}
