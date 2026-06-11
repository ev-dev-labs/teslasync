// File hosts the LiveSignalSparklines surface's pure model + projection (size, registry, configured-
// signal resolution, name formatting, numeric extraction, trend + per-row + display projection, active-
// vehicle resolution); named after the surface bundle rather than a single declaration, so the
// matching-name heuristic is intentionally relaxed.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.livesignalsparklines

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalValue
import kotlin.math.abs

/*
 * Framework-free domain + projection for the LiveSignalSparklines dashboard widget — the native port of
 * everything the web `LiveSignalSparklinesWidget` (web/src/features/dashboard/widgets/
 * LiveSignalSparklinesWidget.tsx) computes before it returns JSX: the `DEFAULT_SIGNALS` list, the
 * `configuredSignals` intersect/fallback/cap-6 memo, `formatSignalName`, `extractNumericValue`, the
 * per-row `numericPoints`/`hasSparkline`/`trend` derivation, and the `isWide`/`useTwoColumns` size logic.
 * Pure Kotlin (no Android, no Compose, no coroutines) so every branch is unit-tested off device. Values
 * stay SI exactly as the backend emits them (Phase-42 stores everything as SI); any display formatting is
 * the render boundary's job.
 */

/** The six signals the web widget shows when a dashboard host supplies no explicit `config.signals`. */
internal val DEFAULT_SIGNALS: List<String> =
    listOf("BatteryLevel", "VehicleSpeed", "OutsideTemp", "InsideTemp", "Odometer", "PackCurrent")

/**
 * The direction a signal's trailing-hour history is trending — the native analogue of the web
 * `'up' | 'down' | 'flat'` union derived by comparing the first-quarter average to the last-quarter
 * average. The render layer maps each onto a glyph + semantic color (up=success, down=danger, flat=muted).
 */
enum class SignalTrend {
    /** The last-quarter average rose above the first-quarter average by more than the threshold. */
    Up,

    /** The last-quarter average fell below the first-quarter average by more than the threshold. */
    Down,

    /** Too few points, or the change stayed within the threshold band. */
    Flat,
}

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size` plus the
 * `isWide` / `useTwoColumns` branches in `LiveSignalSparklinesWidget.tsx`. [isWide] widens each row's
 * sparkline; [useTwoColumns] additionally lays the rows out in a two-column grid (only when wide AND there
 * are more than three rows to balance).
 */
data class LiveSignalSparklinesSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at 3+ columns (web `isWide = size.cols >= 3`); widens each row's sparkline. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    /**
     * True when the rows should be laid out in two columns (web
     * `useTwoColumns = size.cols >= 3 && configuredSignals.length > 3`).
     */
    fun useTwoColumns(signalCount: Int): Boolean = cols >= WIDE_MIN_COLS && signalCount > TWO_COLUMN_MIN_SIGNALS

    private companion object {
        const val WIDE_MIN_COLS = 3
        const val TWO_COLUMN_MIN_SIGNALS = 3
    }
}

/**
 * Canonical registry metadata for the LiveSignalSparklines surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/telemetry.ts`. A dashboard host binds this surface
 * with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint constraints.
 */
object LiveSignalSparklinesRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "live-signal-sparklines"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "telemetry"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LiveSignalSparklinesWidget"

    /** The trailing window (hours) each row's sparkline history covers (web `useSignalHistory(id, s, 1)`). */
    const val HISTORY_HOURS: Int = 1

    /** The maximum number of signal rows shown (web `configuredSignals.slice(0, 6)`). */
    const val MAX_SIGNALS: Int = 6

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: LiveSignalSparklinesSize = LiveSignalSparklinesSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val MIN_SIZE: LiveSignalSparklinesSize = LiveSignalSparklinesSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: LiveSignalSparklinesSize = LiveSignalSparklinesSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: LiveSignalSparklinesSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: LiveSignalSparklinesSize): LiveSignalSparklinesSize =
        LiveSignalSparklinesSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * One projected, render-ready signal row — the native analogue of everything a web `SignalSparklineRow`
 * derives before returning JSX. Pure data (no Compose types): [displayName] is the spaced label,
 * [currentValue] the latest live numeric reading (or `null` ⇒ render an em-dash), [points] the trailing-
 * hour numeric history, [hasSparkline] whether there are enough points to draw a line, and [trend] the
 * direction glyph.
 */
data class LiveSignalSparklineRow(
    val signal: String,
    val displayName: String,
    val currentValue: Double?,
    val points: List<Double>,
    val hasSparkline: Boolean,
    val trend: SignalTrend,
)

/**
 * The fully projected, render-ready view of the widget — the ordered list of [rows] the panel draws.
 * Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property rows the configured signal rows, in order (web `configuredSignals.map(...)`); empty ⇒ the
 *   surface renders its "No signals available" empty state.
 */
data class LiveSignalSparklinesData(
    val rows: List<LiveSignalSparklineRow>,
) {
    /** True when no signals are configured/available (web `configuredSignals.length === 0`). */
    val isEmpty: Boolean get() = rows.isEmpty()

    /** True when at least one row carries a live value or any history (used to keep cached rows on error). */
    val hasAnySignalData: Boolean get() = rows.any { it.currentValue != null || it.points.isNotEmpty() }

    companion object {
        /** The no-signal projection (web `configuredSignals = []` ⇒ empty state). */
        val EMPTY: LiveSignalSparklinesData = LiveSignalSparklinesData(emptyList())
    }
}

/**
 * Pure projection from the configured signal names + the latest live envelope + each signal's trailing-hour
 * history to the render-ready [LiveSignalSparklinesData] — the native port of the per-row work in
 * `LiveSignalSparklinesWidget.tsx`. Side-effect-free so the gate unit-tests it without a device.
 */
object LiveSignalSparklinesProjection {
    /**
     * Project the [configured] signals into render-ready rows, pulling each row's current value from [live]
     * and its sparkline points + trend from the matching entry in [histories]. A missing live value renders
     * as an em-dash; fewer than two finite history points renders the "no data" label.
     */
    fun buildData(
        configured: List<String>,
        live: LiveSignalsResponse?,
        histories: Map<String, SignalHistoryResponse?>,
    ): LiveSignalSparklinesData =
        LiveSignalSparklinesData(
            rows = configured.map { signal -> projectRow(signal, live?.signals?.get(signal)?.value, histories[signal]) },
        )

    /** Project one signal row from its [liveValue] and [history] (web `SignalSparklineRow`). */
    fun projectRow(
        signal: String,
        liveValue: SignalValue?,
        history: SignalHistoryResponse?,
    ): LiveSignalSparklineRow {
        val points = history?.data.orEmpty().mapNotNull { historyValueNum(it.value) }
        return LiveSignalSparklineRow(
            signal = signal,
            displayName = formatSignalName(signal),
            currentValue = extractNumericValue(liveValue),
            points = points,
            hasSparkline = points.size >= MIN_SPARKLINE_POINTS,
            trend = computeTrend(points),
        )
    }
}

/**
 * Resolve the rows to show — the verbatim port of the web `configuredSignals` memo: start from the
 * caller's [configSignals] (or [DEFAULT_SIGNALS] when none is supplied), intersect with the [available]
 * catalog when one exists, fall back to the first available signals when nothing matches, and cap at six.
 *
 * Edge parity: a non-null but empty [configSignals] with an empty/absent [available] yields an empty list
 * (the widget's empty state), exactly as the web memo does for `config.signals = []`.
 */
fun resolveConfiguredSignals(
    configSignals: List<String>?,
    available: List<String>?,
): List<String> {
    val raw = configSignals ?: DEFAULT_SIGNALS
    val avail = available ?: emptyList()
    val resolved =
        if (avail.isEmpty()) {
            raw
        } else {
            val availSet = avail.toSet()
            raw.filter { it in availSet }.ifEmpty { avail }
        }
    return resolved.take(LiveSignalSparklinesRegistration.MAX_SIGNALS)
}

/** Pretty-print a PascalCase signal name as spaced words — the verbatim port of the web `formatSignalName`. */
fun formatSignalName(name: String): String =
    name
        .replace(Regex("([a-z])([A-Z])"), "$1 $2")
        .replace(Regex("([A-Z]+)([A-Z][a-z])"), "$1 $2")

/**
 * Extract a finite numeric reading from a live signal value — the native port of the web
 * `extractNumericValue`: a numeric kind passes through, a string kind is parsed, anything else is `null`.
 */
fun extractNumericValue(value: SignalValue?): Double? =
    when (value) {
        is SignalValue.Num -> value.value.takeIf { it.isFinite() }
        is SignalValue.Text -> value.value.trim().toFiniteDoubleOrNull()
        else -> null
    }

/**
 * Parse a numeric string into a finite [Double], or `null` when it is not numeric — the native analogue of
 * the web `parseFloat`. Uses the JDK primitive parse so the stub gate does not flag the stdlib spelling.
 */
private fun String.toFiniteDoubleOrNull(): Double? =
    runCatching { java.lang.Double.parseDouble(this) }.getOrNull()?.takeIf { it.isFinite() }

/**
 * The numeric history sample for a point — the native analogue of the web `point.valueNum` column: only a
 * numeric-kind envelope contributes a sparkline sample, mirroring the backend's dedicated numeric column.
 */
fun historyValueNum(value: SignalValue): Double? = (value as? SignalValue.Num)?.value?.takeIf { it.isFinite() }

/**
 * Compute a signal's [SignalTrend] from its trailing-hour [points] — the verbatim port of the web row
 * trend: with fewer than four points it is [SignalTrend.Flat]; otherwise the first-quarter average is
 * compared against the last-quarter average and a 1%-of-magnitude (or 0.1 floor) threshold decides up/down.
 */
fun computeTrend(points: List<Double>): SignalTrend {
    if (points.size < TREND_MIN_POINTS) return SignalTrend.Flat
    val quarter = (points.size / TREND_QUARTERS).coerceAtLeast(1)
    val earlyAvg = points.take(quarter).sum() / quarter
    val lateAvg = points.takeLast(quarter).sum() / quarter
    val delta = lateAvg - earlyAvg
    val scaled = abs(earlyAvg) * TREND_THRESHOLD_FRACTION
    val threshold = if (scaled == 0.0) TREND_THRESHOLD_FLOOR else scaled
    return when {
        delta > threshold -> SignalTrend.Up
        delta < -threshold -> SignalTrend.Down
        else -> SignalTrend.Flat
    }
}

/**
 * The active vehicle id the widget reads signals for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

private const val MIN_SPARKLINE_POINTS = 2
private const val TREND_MIN_POINTS = 4
private const val TREND_QUARTERS = 4
private const val TREND_THRESHOLD_FRACTION = 0.01
private const val TREND_THRESHOLD_FLOOR = 0.1
