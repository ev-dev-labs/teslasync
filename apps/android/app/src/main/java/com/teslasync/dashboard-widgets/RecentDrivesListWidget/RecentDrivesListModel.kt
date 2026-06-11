// Pure, framework-free model + projection for the Recent Drives List dashboard widget — the native
// analogue of everything the web component computes before returning JSX
// (web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx): the `driveLimit` footprint logic,
// the per-row `truncateAddress`, `convertDistanceFromSI` + `fmtNumber`, `formatDurationMinutes`,
// `formatDateShort`, and the SoC / battery-used rollups. No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. SI distances are converted via an injected display formatter (the live
// `UnitFormatter` at the Compose boundary), never stored converted (Phase-48 SI-canonical rule).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RecentDrivesListWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdriveslist

import io.teslasync.shared.core.api.generated.Drive
import kotlin.math.floor
import kotlin.math.roundToLong
import kotlin.time.Instant

private const val EM_DASH = "\u2014"
private const val UNKNOWN_SOC = "?"
private const val SECONDS_PER_MINUTE = 60.0
private const val MINUTES_PER_HOUR = 60.0

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the source's
 * `isWide` / `isTall` / `driveLimit` derivation: three or more columns is "wide" (web `size.cols >= 3`,
 * which reveals the start/end address column and lifts the row cap to ten), two or more rows is "tall"
 * (web `size.rows >= 2`), and the rendered row count is ten when wide, seven when tall, otherwise five.
 */
data class RecentDrivesSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at three or more columns (web `isWide`): show the address column. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    /** True at two or more rows (web `isTall`). */
    val isTall: Boolean get() = rows >= TALL_MIN_ROWS

    /** Rows rendered for this footprint (web `isWide ? 10 : isTall ? 7 : 5`). */
    val driveLimit: Int
        get() =
            when {
                isWide -> WIDE_LIMIT
                isTall -> TALL_LIMIT
                else -> BASE_LIMIT
            }

    companion object {
        private const val WIDE_MIN_COLS = 3
        private const val TALL_MIN_ROWS = 2
        private const val WIDE_LIMIT = 10
        private const val TALL_LIMIT = 7
        private const val BASE_LIMIT = 5
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`recent-drives-list`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object RecentDrivesListRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "recent-drives-list"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "RecentDrivesListWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION = "Last 5-10 drives: distance, duration, efficiency, start/end locations"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = RecentDrivesSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 4 rows. */
    val minSize = RecentDrivesSize(cols = 1, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = RecentDrivesSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: RecentDrivesSize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RecentDrivesSize): RecentDrivesSize =
        RecentDrivesSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One projected, render-ready drive row — the native analogue of the JSX the web `items.map(...)`
 * emits per drive. Pure data (no Compose types): the already-formatted [distanceText] (web
 * `fmtNumber(convertDistanceFromSI(distance_m), 1) + unit`), [durationText] (web
 * `formatDurationMinutes`), the truncated [startAddress] / [endAddress] (web `truncateAddress(_, 30)`,
 * shown only when wide), the [socText] (web `start% → end%`), the optional [batteryUsedText] (web
 * `fmtInt(start - end)%`, present only when both endpoints are known AND the drive moved), the
 * [dateText] (web `formatDateShort(start_ts)`), and a folded TalkBack [contentDescription].
 */
data class RecentDriveRow(
    val id: Long,
    val distanceText: String,
    val durationText: String,
    val startAddress: String,
    val endAddress: String,
    val socText: String,
    val batteryUsedText: String?,
    val dateText: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the recent-drives list for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the `driveLimit` slice and
 * the per-row mapping). Pure data so the projection is unit-tested without a UI host. [hasItems]
 * drives the web `items.length > 0 ? … : <EmptyState/>` gate.
 */
data class RecentDrivesDisplay(
    val rows: List<RecentDriveRow>,
    val isWide: Boolean,
    val hasItems: Boolean,
)

/**
 * Pure projection from the SI [Drive] rows to the [RecentDrivesDisplay] — the native port of the web
 * component's render body. [formatDistance] converts an SI-meters distance to the user's display unit
 * + token at the Compose boundary (web `fmtNumber(convertDistanceFromSI(distance_m), 1) + unit`), and
 * [formatDate] renders the start timestamp month-short + day-numeric (web `formatDateShort`). Both are
 * injected so the projection stays locale-stable and JVM-testable.
 */
object RecentDrivesListProjection {
    /** Sub-minute duration label, matching the web call `formatDurationMinutes(_, { subMinuteLabel: '<1m' })`. */
    const val SUB_MINUTE_LABEL = "<1m"

    /** Address truncation length (web `truncateAddress(_, 30)`). */
    const val ADDRESS_MAX_LEN = 30

    /** SoC delimiter, matching the web `{start}% → {end}%`. */
    private const val SOC_ARROW = " \u2192 "

    private const val PERCENT = "%"
    private const val ELLIPSIS = "\u2026"
    private const val SEPARATOR = ", "

    /**
     * Project [drives] for [size]: take the leading [RecentDrivesSize.driveLimit] rows (the native
     * analogue of the web `limit=driveLimit` query — the shared `/drives` feed is fetched unbounded and
     * sliced here, preserving the server's newest-first order) and map each to a render-ready
     * [RecentDriveRow].
     */
    fun project(
        drives: List<Drive>,
        size: RecentDrivesSize,
        formatDistance: (Double) -> String,
        formatDate: (Instant) -> String,
    ): RecentDrivesDisplay {
        val rows = drives.take(size.driveLimit).map { it.toRow(size.isWide, formatDistance, formatDate) }
        return RecentDrivesDisplay(rows = rows, isWide = size.isWide, hasItems = rows.isNotEmpty())
    }

    /**
     * Truncate an address to [maxLen] with a trailing ellipsis — a verbatim port of the web
     * `truncateAddress`: a null/blank value renders the em dash (web `!addr`), an over-long value is
     * sliced and suffixed with `…`, otherwise it is returned unchanged.
     */
    fun truncateAddress(
        addr: String?,
        maxLen: Int,
    ): String =
        when {
            addr.isNullOrEmpty() -> EM_DASH
            addr.length > maxLen -> addr.take(maxLen) + ELLIPSIS
            else -> addr
        }

    /**
     * Render a duration given in [minutes] as the web `formatDurationMinutes` does: a non-finite or
     * negative value is the em dash, an under-one-minute value is [subMinuteLabel], otherwise
     * `Xh Ym` (hours floored, minutes rounded half-up) or `Ym` when under an hour.
     */
    fun formatDurationMinutes(
        minutes: Double,
        subMinuteLabel: String,
    ): String =
        when {
            !minutes.isFinite() || minutes < 0.0 -> EM_DASH
            minutes < 1.0 -> subMinuteLabel
            else -> {
                val hours = floor(minutes / MINUTES_PER_HOUR).toLong()
                val mins = (minutes % MINUTES_PER_HOUR).roundToLong()
                if (hours > 0L) "${hours}h ${mins}m" else "${mins}m"
            }
        }

    private fun Drive.toRow(
        isWide: Boolean,
        formatDistance: (Double) -> String,
        formatDate: (Instant) -> String,
    ): RecentDriveRow {
        val distanceText = formatDistance(distanceM)
        val durationText = formatDurationMinutes(durationS / SECONDS_PER_MINUTE, SUB_MINUTE_LABEL)
        val socText = "${startBatteryPct.socOrUnknown()}$SOC_ARROW${endBatteryPct.socOrUnknown()}"
        val batteryText = batteryUsedText()
        val dateText = formatDate(startTs)
        val start = truncateAddress(startAddress, ADDRESS_MAX_LEN)
        val end = truncateAddress(endAddress, ADDRESS_MAX_LEN)
        return RecentDriveRow(
            id = id,
            distanceText = distanceText,
            durationText = durationText,
            startAddress = start,
            endAddress = end,
            socText = socText,
            batteryUsedText = batteryText,
            dateText = dateText,
            contentDescription =
                buildContentDescription(isWide, distanceText, durationText, start, end, socText, batteryText, dateText),
        )
    }

    /**
     * The battery-used chip (web `fmtInt(start_soc_pct - end_soc_pct)%`), present only when BOTH SoC
     * endpoints are known and the drive actually moved (web `batteryUsed != null && dist > 0`; a
     * positive SI distance is equivalent to a positive converted distance).
     */
    private fun Drive.batteryUsedText(): String? {
        val start = startBatteryPct
        val end = endBatteryPct
        if (start == null || end == null || distanceM <= 0.0) return null
        return "${start - end}$PERCENT"
    }

    private fun Long?.socOrUnknown(): String = this?.let { "$it$PERCENT" } ?: "$UNKNOWN_SOC$PERCENT"

    @Suppress("LongParameterList")
    private fun buildContentDescription(
        isWide: Boolean,
        distanceText: String,
        durationText: String,
        startAddress: String,
        endAddress: String,
        socText: String,
        batteryUsedText: String?,
        dateText: String,
    ): String {
        val parts = mutableListOf(distanceText, durationText)
        if (isWide) {
            parts += startAddress
            parts += endAddress
        }
        parts += socText
        batteryUsedText?.let { parts += it }
        parts += dateText
        return parts.joinToString(SEPARATOR)
    }
}
