// Pure, framework-free model + projection for the Watch Summary dashboard widget — the native analogue
// of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/WatchSummaryWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.watchsummary

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.presentation.watch.WatchComplication
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlin.time.Instant

/** Em dash shown for a missing reading — the web `'—'` fallback and the shared formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

/** Percentage suffix shown after the battery value (dimensionless state-of-charge — no SI conversion). */
internal const val BATTERY_PERCENT_UNIT: String = "%"

/** Battery is shown as a whole percentage (web `RadialGauge decimals={0}` / `WidgetBigNumber`). */
internal const val BATTERY_DECIMALS: Int = 0

/** Range + cabin temperature render as whole units (web `fmtNumber(_, 0)` / whole-degree temps). */
internal const val DISPLAY_DECIMALS: Int = 0

/** Metres per kilometre — `range_km` is kilometres on the wire and must be metres before SI→display. */
internal const val METRES_PER_KM: Double = 1_000.0

private const val LEVEL_GREEN_MIN_PCT: Double = 50.0
private const val LEVEL_AMBER_MIN_PCT: Double = 20.0

/** The coarse vehicle states the web badge special-cases (`online`, `asleep`); everything else is "other". */
private const val STATE_ONLINE = "online"
private const val STATE_ASLEEP = "asleep"

/**
 * The state-of-charge color band — the native analogue of the web `getBatteryColor` thresholds
 * (`> 50` green, `> 20` amber, otherwise red) plus an [Unknown] band for the no-data case (web's
 * `#374151` fallback). The render layer maps each band onto a semantic theme color so light/dark and
 * high-contrast all resolve correctly.
 */
enum class BatteryColorBand {
    /** State of charge above 50% (web `#10b981`). */
    Green,

    /** State of charge in (20%, 50%] (web `#f59e0b`). */
    Amber,

    /** State of charge at or below 20% (web `#ef4444`). */
    Red,

    /** No decodable watch summary — the gauge color falls back to neutral (web `#374151`). */
    Unknown,

    ;

    companion object {
        /** The band for a [level] (0–100) — verbatim parity with the web `getBatteryColor` thresholds. */
        fun forLevel(level: Double): BatteryColorBand =
            when {
                level > LEVEL_GREEN_MIN_PCT -> Green
                level > LEVEL_AMBER_MIN_PCT -> Amber
                else -> Red
            }
    }
}

/**
 * The badge tone for the coarse vehicle state shown on the standard footprint — the native analogue of
 * the web `WidgetBigNumber` badge variant (`state === 'online' ? 'success' : state === 'asleep'
 * ? 'neutral' : 'warning'`). The render layer maps each tone onto the shared `Badge` variant.
 */
enum class StateTone {
    /** Vehicle online (web `success`). */
    Success,

    /** Vehicle asleep (web `neutral`). */
    Neutral,

    /** Any other state (web `warning`). */
    Warning,

    ;

    companion object {
        /** The tone for a [state] string — verbatim parity with the web badge ternary. */
        fun forState(state: String): StateTone =
            when (state.trim().lowercase()) {
                STATE_ONLINE -> Success
                STATE_ASLEEP -> Neutral
                else -> Warning
            }
    }
}

/**
 * The lock state shown on the standard footprint — the native analogue of the web `is_locked` branch
 * (a green Lock glyph + "Locked" badge, or an amber Unlock glyph + "Unlocked" badge). [Unknown] covers
 * the no-data case so the cell never crashes on a missing value.
 */
enum class LockState {
    /** Vehicle locked (web `is_locked === true`). */
    Locked,

    /** Vehicle unlocked (web `is_locked === false`). */
    Unlocked,

    /** No decodable lock value. */
    Unknown,

    ;

    companion object {
        /** The lock state for an [isLocked] flag, or [Unknown] when absent. */
        fun forFlag(isLocked: Boolean?): LockState =
            when (isLocked) {
                true -> Locked
                false -> Unlocked
                null -> Unknown
            }
    }
}

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size` plus the
 * `isCompact` branch in `WatchSummaryWidget.tsx`. [isCompact] (web `size.cols <= 1`) renders the
 * Apple-Watch-style circular gauge; the larger footprint renders the full battery + detail grid.
 */
data class WatchSummarySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at one column or narrower (web `isCompact = size.cols <= 1`). */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * Canonical registry metadata for the Watch Summary surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/vehicle.ts` (`watch-summary`). A dashboard grid
 * host binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint
 * constraints, so the native + web grids stay in lockstep.
 */
object WatchSummaryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "watch-summary"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WatchSummaryWidget"

    /** Default footprint: 1 column × 2 rows. */
    val DEFAULT_SIZE: WatchSummarySize = WatchSummarySize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: WatchSummarySize = WatchSummarySize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows. */
    val MAX_SIZE: WatchSummarySize = WatchSummarySize(cols = 2, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: WatchSummarySize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: WatchSummarySize): WatchSummarySize =
        WatchSummarySize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The two reads the web component composes, folded into one render envelope — the native analogue of
 * `useWatchSummary` + `useWatchComplication`. [summary] is the full glance payload (drives the gauge,
 * range, lock, cabin, last-seen); [charging] is the complication's pre-rendered charge flag the web
 * compact branch reads as `complication?.charging`. The summary owns the surface lifecycle; the
 * complication only contributes [charging], so a still-loading/failed complication degrades to `false`
 * without blanking the surface.
 *
 * @property summary the decoded watch summary (never null once a value exists — built from the feed's
 *   cached/fresh value).
 * @property charging whether the complication reports an active charge session (web `complication?.charging`).
 */
data class WatchView(
    val summary: WatchSummary,
    val charging: Boolean,
)

/**
 * The fully projected, render-ready view of the watch summary for one footprint — the native analogue of
 * everything `WatchSummaryWidget.tsx` derives before returning JSX (the battery color band, the converted
 * range + cabin temperature, the lock state, the state badge tone, the charging flag and the parsed
 * last-seen stamp). Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property hasData whether a usable watch summary was decoded (web `summary != null`); when false the
 *   surface renders its empty state instead of the gauge/grid.
 * @property batteryLevel the state of charge 0–100 (web `summary?.battery_level ?? null` ⇒ gauge value).
 * @property colorBand the threshold band driving the gauge color ([BatteryColorBand.Unknown] when no data).
 * @property stateLabel the coarse state string when present and non-blank (web `state && …`), else `null`.
 * @property stateTone the badge tone for [stateLabel] on the standard footprint (web badge variant).
 * @property rangeText the range converted to the user's unit and suffixed (web `displayRange` + unit),
 *   or the em dash when no data.
 * @property lockState the lock chip state (web `is_locked` branch).
 * @property cabinTempText the cabin temperature converted to the user's unit and suffixed (web
 *   `displayTemp` + unit), or the em dash when no data.
 * @property isCharging whether the complication reports charging (web compact `complication?.charging`).
 * @property lastSeenMillis the parsed `last_updated` epoch-millisecond stamp (web `TimeStamp value`), or
 *   `null` when absent/unparseable so the render shows the em dash.
 */
data class WatchSummaryDisplay(
    val hasData: Boolean,
    val batteryLevel: Double,
    val colorBand: BatteryColorBand,
    val stateLabel: String?,
    val stateTone: StateTone,
    val rangeText: String,
    val lockState: LockState,
    val cabinTempText: String,
    val isCharging: Boolean,
    val lastSeenMillis: Long?,
) {
    companion object {
        /** The no-summary projection (web `summary == null`): the surface shows its empty state. */
        val EMPTY: WatchSummaryDisplay =
            WatchSummaryDisplay(
                hasData = false,
                batteryLevel = 0.0,
                colorBand = BatteryColorBand.Unknown,
                stateLabel = null,
                stateTone = StateTone.Warning,
                rangeText = EM_DASH,
                lockState = LockState.Unknown,
                cabinTempText = EM_DASH,
                isCharging = false,
                lastSeenMillis = null,
            )
    }
}

/**
 * Pure projection from a decoded [WatchView] (or `null`) to the render-ready [WatchSummaryDisplay] — the
 * native port of the `getBatteryColor` / `displayRange` / `displayTemp` / `is_locked` / state-badge work
 * in `WatchSummaryWidget.tsx`. The SI→display conversions for range (`range_km` → metres → user unit) and
 * cabin temperature (°C → user unit) are applied here through the shared [UnitFormatter] (web `useUnits()`
 * + `convertDistanceFromSI`/`convertTempFromSI`), keeping the source values unconverted (Phase-48;
 * ADR-013). Side-effect-free so the gate unit-tests it without a device.
 */
object WatchSummaryProjection {
    /** Project [view] for display using [formatter] for the SI→display range/temperature boundary. */
    fun project(
        view: WatchView?,
        formatter: UnitFormatter,
    ): WatchSummaryDisplay {
        val summary = view?.summary
        if (summary == null || isEmpty(summary)) return WatchSummaryDisplay.EMPTY

        val state = summary.state.trim()
        return WatchSummaryDisplay(
            hasData = true,
            batteryLevel = summary.batteryLevel,
            colorBand = BatteryColorBand.forLevel(summary.batteryLevel),
            stateLabel = state.takeIf { it.isNotBlank() },
            stateTone = StateTone.forState(state),
            rangeText = formatter.distance(summary.rangeKm * METRES_PER_KM, DISPLAY_DECIMALS),
            lockState = LockState.forFlag(summary.isLocked),
            cabinTempText = formatter.temperature(summary.insideTempC, DISPLAY_DECIMALS),
            isCharging = view.charging,
            lastSeenMillis = parseLastSeenMillis(summary.lastUpdated),
        )
    }

    /**
     * True when [summary] carries no usable watch data — the native analogue of the web `summary == null`
     * empty gate. The backend always returns a full object (falling back to `state = "unknown"` + a
     * timestamp when live state is missing), so a summary with neither a state nor a last-updated stamp is
     * the genuine "no data" projection (e.g. a default/empty payload) and renders the empty surface.
     */
    fun isEmpty(summary: WatchSummary): Boolean = summary.state.isBlank() && summary.lastUpdated.isBlank()

    /**
     * Parses the `last_updated` RFC-3339 stamp (web `TimeStamp value={lastUpdated}`) to epoch
     * milliseconds, or `null` when the field is blank or not a valid instant — the render layer then
     * shows a localized relative age or the em dash.
     */
    fun parseLastSeenMillis(lastUpdated: String): Long? {
        if (lastUpdated.isBlank()) return null
        return runCatching { Instant.parse(lastUpdated).toEpochMilliseconds() }.getOrNull()
    }
}

/**
 * Folds the complication read onto its pre-rendered charge flag (web `complication?.charging`). A `null`
 * complication (still loading / failed with no cache) degrades to `false`, exactly as the web optional
 * chain does, so the compact charging indicator simply stays hidden until the complication resolves.
 */
fun chargingFrom(complication: WatchComplication?): Boolean = complication?.charging ?: false
