// Pure, framework-free model + projection for the WatchFacePage wearable surface — the native analogue of
// everything the web page derives before returning JSX
// (web/src/features/watch/pages/WatchFacePage.tsx, the chrome-less `/watch` Apple-Watch / Wear-OS glance).
// No Compose, no Android framework, no HTTP lives here, so every branch (battery color band, the SI→display
// range / cabin-temp / time-to-full conversions, the state-badge tone, the lock/climate/sentry flags and the
// parsed last-updated stamp) is unit-tested off-device in the :android:testDebugUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/watch — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as the
// sibling A7 surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.watch.watchface

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** Percentage suffix shown inside the battery gauge (dimensionless state-of-charge — no SI conversion). */
internal const val BATTERY_PERCENT_UNIT: String = "%"

/** Battery level + range + cabin temperature render as whole units (web `Math.round`). */
internal const val DISPLAY_DECIMALS: Int = 0

/** The full sweep value the battery gauge fills against (web `level` over a 0–100 ring). */
internal const val BATTERY_MAX_PERCENT: Double = 100.0

/** Metres per kilometre — `range_km` is kilometres on the wire and must be metres before SI→display. */
internal const val METRES_PER_KM: Double = 1_000.0

/** Seconds per minute — `time_to_full` is minutes on the wire and must be seconds before SI→display. */
internal const val SECONDS_PER_MINUTE: Double = 60.0

private const val LEVEL_GREEN_MIN_PCT: Double = 40.0
private const val LEVEL_AMBER_MIN_PCT: Double = 20.0

private const val STATE_DRIVING = "driving"
private const val STATE_CHARGING = "charging"

/**
 * The state-of-charge color band — the native analogue of the web `getBatteryColor` thresholds on THIS page
 * (`> 40` green, `> 20` amber, otherwise red; note these differ from the dashboard widget's `> 50`/`> 20`
 * bands) plus an [Unknown] band for the no-data case. The render layer maps each band onto a semantic theme
 * color so light/dark and high-contrast all resolve correctly (ADR-005).
 */
enum class BatteryColorBand {
    /** State of charge above 40% (web `#22c55e`). */
    Green,

    /** State of charge in (20%, 40%] (web `#f59e0b`). */
    Amber,

    /** State of charge at or below 20% (web `#ef4444`). */
    Red,

    /** No decodable watch summary — the gauge color falls back to neutral. */
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
 * The badge tone for the coarse vehicle state shown under the gauge — the native analogue of the web
 * `watchStateVariant` ternary (`driving` → info, `charging` → success, otherwise neutral). The render layer
 * maps each tone onto the shared `Badge` variant.
 */
enum class WatchStateTone {
    /** Vehicle driving (web `info`). */
    Info,

    /** Vehicle charging (web `success`). */
    Success,

    /** Any other state — online / asleep / offline (web `neutral`). */
    Neutral,

    ;

    companion object {
        /** The tone for a [state] string — verbatim parity with the web `watchStateVariant`. */
        fun forState(state: String): WatchStateTone =
            when (state.trim().lowercase()) {
                STATE_DRIVING -> Info
                STATE_CHARGING -> Success
                else -> Neutral
            }
    }
}

/**
 * The fully projected, render-ready view of the watch summary — the native analogue of everything
 * `WatchFacePage.tsx` derives before returning JSX. Pure data (no Compose types) so every branch is
 * unit-tested directly. The SI→display conversions for range (`range_km` → metres → user unit), cabin
 * temperature (°C → user unit) and time-to-full (minutes → seconds → user unit) are applied through the
 * shared [UnitFormatter] (web `useUnits()` + `convertDistanceFromSI`/`convertTempFromSI`), keeping the source
 * values unconverted (Phase-48; ADR-013).
 *
 * @property hasData whether a usable watch summary was decoded (web `data != null`); when false the surface
 *   renders the "No vehicle found" state instead of the gauge.
 * @property vehicleName the vehicle display name (web `data.vehicle_name`).
 * @property batteryLevel the state of charge 0–100 (web `data.battery_level` → gauge value + center label).
 * @property colorBand the threshold band driving the gauge color ([BatteryColorBand.Unknown] when no data).
 * @property rangeText the range converted to the user's unit and suffixed (web `displayRange` + unit).
 * @property stateLabel the coarse state string when present and non-blank (web `data.state`), else `null`.
 * @property stateTone the badge tone for [stateLabel] (web `watchStateVariant`).
 * @property isCharging whether a charge session is active (web `data.is_charging`).
 * @property chargingTimeText the estimated time to a full charge, converted to the user's duration unit (web
 *   `Math.round(data.time_to_full)` minutes).
 * @property isLocked whether the vehicle is locked (web `data.is_locked`); drives the lock/unlock action.
 * @property isClimateOn whether climate control is running (web `data.is_climate_on`).
 * @property cabinTempText the cabin temperature converted to the user's unit (web `displayInsideTemp`).
 * @property sentryMode whether Sentry Mode is armed (web `data.sentry_mode`).
 * @property lastUpdatedMillis the parsed `last_updated` epoch-millisecond stamp (web `formatRelativeTime`),
 *   or `null` when absent/unparseable so the render shows nothing.
 */
data class WatchFaceDisplay(
    val hasData: Boolean,
    val vehicleName: String,
    val batteryLevel: Double,
    val colorBand: BatteryColorBand,
    val rangeText: String,
    val stateLabel: String?,
    val stateTone: WatchStateTone,
    val isCharging: Boolean,
    val chargingTimeText: String,
    val isLocked: Boolean,
    val isClimateOn: Boolean,
    val cabinTempText: String,
    val sentryMode: Boolean,
    val lastUpdatedMillis: Long?,
) {
    companion object {
        /** The no-summary projection (web `!data`): the surface shows its "No vehicle found" state. */
        val EMPTY: WatchFaceDisplay =
            WatchFaceDisplay(
                hasData = false,
                vehicleName = "",
                batteryLevel = 0.0,
                colorBand = BatteryColorBand.Unknown,
                rangeText = "",
                stateLabel = null,
                stateTone = WatchStateTone.Neutral,
                isCharging = false,
                chargingTimeText = "",
                isLocked = false,
                isClimateOn = false,
                cabinTempText = "",
                sentryMode = false,
                lastUpdatedMillis = null,
            )
    }
}

/**
 * Pure projection from a decoded [WatchSummary] (or `null`) to the render-ready [WatchFaceDisplay] — the
 * native port of the `getBatteryColor` / `displayRange` / `displayInsideTemp` / state-badge work in
 * `WatchFacePage.tsx`. Side-effect-free so the gate unit-tests it without a device.
 */
object WatchFaceProjection {
    /** Project [summary] for display using [formatter] for the SI→display range/temperature/duration boundary. */
    fun project(
        summary: WatchSummary?,
        formatter: UnitFormatter,
    ): WatchFaceDisplay {
        if (summary == null || isEmpty(summary)) return WatchFaceDisplay.EMPTY

        val state = summary.state.trim()
        return WatchFaceDisplay(
            hasData = true,
            vehicleName = summary.vehicleName,
            batteryLevel = summary.batteryLevel,
            colorBand = BatteryColorBand.forLevel(summary.batteryLevel),
            // SI boundary: `range_km` is kilometres; metres before SI→display (web `range_km * 1000`).
            rangeText = formatter.distance(summary.rangeKm * METRES_PER_KM, DISPLAY_DECIMALS),
            stateLabel = state.takeIf { it.isNotBlank() },
            stateTone = WatchStateTone.forState(state),
            isCharging = summary.isCharging,
            // SI boundary: `time_to_full` is minutes; seconds before SI→display (web shows raw minutes).
            chargingTimeText = formatter.duration(summary.timeToFull * SECONDS_PER_MINUTE, DISPLAY_DECIMALS),
            isLocked = summary.isLocked,
            isClimateOn = summary.isClimateOn,
            // SI boundary: `inside_temp_c` is already °C (SI for temperature).
            cabinTempText = formatter.temperature(summary.insideTempC, DISPLAY_DECIMALS),
            sentryMode = summary.sentryMode,
            lastUpdatedMillis = parseLastUpdatedMillis(summary.lastUpdated),
        )
    }

    /**
     * True when [summary] carries no usable watch data — the native analogue of the web `!data` branch (which
     * renders "No vehicle found"). The backend always returns a full object, so a summary with neither a state
     * nor a last-updated stamp is the genuine "no data" projection.
     */
    fun isEmpty(summary: WatchSummary): Boolean = summary.state.isBlank() && summary.lastUpdated.isBlank()

    /**
     * Parses the `last_updated` RFC-3339 stamp (web `formatRelativeTime(data.last_updated)`) to epoch
     * milliseconds, or `null` when the field is blank or not a valid instant — the render layer then shows a
     * localized relative age or nothing.
     */
    @OptIn(ExperimentalTime::class)
    fun parseLastUpdatedMillis(lastUpdated: String): Long? {
        if (lastUpdated.isBlank()) return null
        return runCatching { Instant.parse(lastUpdated).toEpochMilliseconds() }.getOrNull()
    }
}

/**
 * Canonical metadata for this surface. The web page is a top-level standalone route, so this object carries
 * the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the
 * diagnostics [SLUG] emitted with the one-shot `view.opened` event (P1/S11).
 */
object WatchFaceRegistration {
    /** The navigation destination id (Destinations.kt `standalone("watchFace", "/watch", …)`). */
    const val ROUTE_ID: String = "watchFace"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/watch"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WatchFacePage"
}

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no vehicle state. */
internal fun recordWatchFacePageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to WatchFaceRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"
