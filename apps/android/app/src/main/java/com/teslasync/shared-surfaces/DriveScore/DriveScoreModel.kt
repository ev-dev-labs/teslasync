// Pure, framework-free model + projection for the DriveScore shared surface — the native analogue of
// everything the web component computes from its `drive` prop before returning JSX
// (web/src/components/data-display/DriveScore.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin
// render layer over these pure functions.
//
// The web component is purely presentational. It receives a single drive-like object, derives a 0–100
// drive score plus four weighted sub-scores (Efficiency 0–40, Speed Discipline 0–20, Range Preservation
// 0–20, Trip Length 0–20), picks a traffic-light gauge color from the total, and renders an animated
// circular gauge next to a labelled breakdown. This file owns that contract's pure half: the prop slice
// the surface reads ([DriveScoreInput]), the 1:1 port of the web `computeDriveScore` scoring math
// ([DriveScoreComputation]), the web `getScoreColor` tier ([scoreTier]), the render-ready bar list
// ([driveScoreBars]), the prop-driven lifecycle-state builder ([driveScoreState]), the hard-error
// classifier ([driveScoreErrorKind]), and the PII-safe `view.opened` diagnostic.
//
// SI boundary (unit-conversion instructions, ADR / Phase-48): the inputs are SI canonical exactly as the
// API serves them — metres, seconds, and metres-per-second — matching the web `distance_m` / `duration_s`
// / `max_speed_mps` fields. The score is a unitless 0–100 rating, so — like the web component, which only
// renders the integer scores — this projection performs no display-unit conversion and the surface needs
// no live formatter.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DriveScore — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.drivescore

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.min

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DriveScoreRegistration {
    /** Stable surface id. */
    const val ID: String = "drive-score"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DriveScore"
}

/**
 * The drive slice the score is computed from — the native pairing of the web `DriveLike` prop, collapsed
 * to its SI canonical fields (the web reads either the snake_case `distance_m` or the camelCase
 * `distanceM`; the host state-holder normalizes both to these). Every field is nullable so a partial drive
 * scores exactly as the web's `?? default` fallbacks do; the host (P1/S8) supplies it and the surface
 * performs no fetch.
 *
 * @property distanceM trip distance in SI metres (web `distance_m`).
 * @property durationS trip duration in SI seconds (web `duration_s`).
 * @property maxSpeedMps peak speed in SI metres-per-second (web `max_speed_mps`); falls back to the
 *   average speed when absent, mirroring the web.
 * @property startBatteryPct battery state-of-charge at the start, 0–100 (web `start_battery_pct`).
 * @property endBatteryPct battery state-of-charge at the end, 0–100 (web `end_battery_pct`).
 */
data class DriveScoreInput(
    val distanceM: Double? = null,
    val durationS: Double? = null,
    val maxSpeedMps: Double? = null,
    val startBatteryPct: Double? = null,
    val endBatteryPct: Double? = null,
)

/**
 * The computed scores — the native mirror of the web `computeDriveScore` return shape. All values are
 * integers in the same ranges the web rounds to: [total] 0–100, [efficiency] 0–40, and [speed] / [range] /
 * [trip] each 0–20.
 */
data class DriveScoreBreakdown(
    val total: Int,
    val efficiency: Int,
    val speed: Int,
    val range: Int,
    val trip: Int,
)

/** The traffic-light tier of a total score — the native mirror of the web `getScoreColor` thresholds. */
enum class ScoreTier { Bad, Warn, Good }

/** The four breakdown rows, in render order — each maps to its own palette token at the Compose boundary. */
enum class DriveScoreMetric { Efficiency, SpeedDiscipline, RangePreservation, TripLength }

/**
 * One render-ready breakdown bar — the native analogue of a single entry in the web component's inline
 * `[{ label, value, max, color }]` array. The [metric] selects the bar's palette token in the composable.
 *
 * @property metric the bar's identity (drives the color mapping; never user-facing).
 * @property label the already-localized row label (web `t(...)`).
 * @property value the sub-score (web `item.value`).
 * @property max the sub-score ceiling (web `item.max`).
 */
data class DriveScoreBarModel(
    val metric: DriveScoreMetric,
    val label: String,
    val value: Int,
    val max: Int,
)

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the `driveScore.*`
 * keys the web component resolves via `t(...)`. The lifecycle-chrome strings (empty / loading / offline /
 * freshness) are resolved inline at the Compose boundary, not here, so this holder stays a thin content
 * carrier.
 *
 * @property title the panel heading (web `driveScore.title`, "Drive Score").
 * @property scoreLabel the gauge caption under the number (web `driveScore.score`, "Score").
 * @property efficiency the efficiency row label (web `driveScore.efficiency`).
 * @property speedDiscipline the speed-discipline row label (web `driveScore.speedDiscipline`).
 * @property rangePreservation the range-preservation row label (web `driveScore.rangePreservation`).
 * @property tripLength the trip-length row label (web `driveScore.tripLength`).
 */
data class DriveScoreStrings(
    val title: String,
    val scoreLabel: String,
    val efficiency: String,
    val speedDiscipline: String,
    val rangePreservation: String,
    val tripLength: String,
)

// ── Scoring constants (verbatim from the web computeDriveScore) ───────────────────────────────────────

private const val METERS_PER_KM = 1000.0

/** Each battery percent ≈ 750 Wh (the web's "~75 kWh usable, each % = 750 Wh" estimate). */
private const val WH_PER_BATTERY_PCT = 750.0

/** Wh/km assumed when the trip has no distance to divide by (web fallback). */
private const val DEFAULT_WH_PER_KM = 250.0

/** The efficiency sweet spot in Wh/km (web `optimalWhKm`). */
private const val OPTIMAL_WH_PER_KM = 150.0

/** Speed-discipline ratio used when there is no max speed to compare against (web fallback). */
private const val DEFAULT_SPEED_RATIO = 0.5

/** Battery-per-km used when the trip has no distance (web fallback). */
private const val DEFAULT_BATTERY_PER_KM = 1.0

/** Best-case battery draw in %/km — the lower anchor of the range score (web `0.1`). */
private const val BEST_BATTERY_PER_KM = 0.1

/** The %/km span between best and worst case for the range score (web `0.9`). */
private const val BATTERY_PER_KM_SPAN = 0.9

/** Distance in km at which the trip-length score plateaus at full marks (web `50`). */
private const val TRIP_PLATEAU_KM = 50.0

/** Battery state-of-charge assumed when the start percentage is absent (web `?? 100`). */
private const val DEFAULT_START_BATTERY = 100.0

/** Maximum points for the efficiency component (web `40`). */
private const val EFFICIENCY_MAX = 40.0

/** Maximum points for each of the speed / range / trip components (web `20`). */
private const val SUBSCORE_MAX = 20.0

/** Maximum total score (web `clamp(..., 0, 100)`). */
private const val TOTAL_MAX = 100.0

/** Efficiency bar ceiling shown beside the value (web `max: 40`). */
internal const val EFFICIENCY_BAR_MAX = 40

/** Speed / range / trip bar ceiling shown beside the value (web `max: 20`). */
internal const val SUBSCORE_BAR_MAX = 20

/** Below this total the gauge is "bad" / red (web `score < 40`). */
internal const val SCORE_WARN_THRESHOLD = 40

/** At or above this total the gauge is "good" / green (web `score < 70 ? warn : good`). */
internal const val SCORE_GOOD_THRESHOLD = 70

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR = 500

/**
 * The pure scoring engine the composable renders — a 1:1 port of the web `computeDriveScore`. Stateless
 * and side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves
 * localized strings, the palette colors, and the freshness chrome.
 */
object DriveScoreComputation {
    /**
     * Scores [input] into a [DriveScoreBreakdown]. Reproduces the web math exactly, including the `?? `
     * fallbacks, the `clamp` bounds, and — critically — the fact that the web computes [DriveScoreBreakdown.total]
     * from the *unrounded* component doubles while rounding each sub-score independently. A non-finite
     * intermediate collapses to `0` so a corrupt sample never surfaces as `NaN`, matching the web
     * `Math.round(NaN) === 0`.
     */
    fun compute(input: DriveScoreInput): DriveScoreBreakdown {
        val distanceM = input.distanceM ?: 0.0
        val distanceKm = distanceM / METERS_PER_KM
        val durationS = input.durationS ?: 0.0
        val avgSpeedMps = if (durationS > 0.0) distanceM / durationS else 0.0
        val maxSpeedMps = input.maxSpeedMps ?: avgSpeedMps
        val startBattery = input.startBatteryPct ?: DEFAULT_START_BATTERY
        val endBattery = input.endBatteryPct ?: startBattery

        // Efficiency (40 pts): closer to the optimal 150 Wh/km is better.
        val batteryUsed = (startBattery - endBattery).coerceAtLeast(0.0)
        val whPerKm = if (distanceKm > 0.0) (batteryUsed * WH_PER_BATTERY_PCT) / distanceKm else DEFAULT_WH_PER_KM
        val effDeviation = abs(whPerKm - OPTIMAL_WH_PER_KM) / OPTIMAL_WH_PER_KM
        val efficiency = (EFFICIENCY_MAX * (1 - effDeviation)).coerceIn(0.0, EFFICIENCY_MAX)

        // Speed discipline (20 pts): a smooth avg/max ratio scores higher.
        val speedRatio = if (maxSpeedMps > 0.0) avgSpeedMps / maxSpeedMps else DEFAULT_SPEED_RATIO
        val speed = (SUBSCORE_MAX * speedRatio).coerceIn(0.0, SUBSCORE_MAX)

        // Range preservation (20 pts): less battery used per km scores higher.
        val batteryPerKm = if (distanceKm > 0.0) batteryUsed / distanceKm else DEFAULT_BATTERY_PER_KM
        val rangeScore =
            (SUBSCORE_MAX * (1 - (batteryPerKm - BEST_BATTERY_PER_KM) / BATTERY_PER_KM_SPAN))
                .coerceIn(0.0, SUBSCORE_MAX)

        // Trip length (20 pts): longer trips score higher, plateauing at 50 km.
        val tripScore = (SUBSCORE_MAX * min(distanceKm / TRIP_PLATEAU_KM, 1.0)).coerceIn(0.0, SUBSCORE_MAX)

        val total = roundHalfUp((efficiency + speed + rangeScore + tripScore).coerceIn(0.0, TOTAL_MAX))
        return DriveScoreBreakdown(
            total = total,
            efficiency = roundHalfUp(efficiency),
            speed = roundHalfUp(speed),
            range = roundHalfUp(rangeScore),
            trip = roundHalfUp(tripScore),
        )
    }

    /**
     * `floor(value + 0.5)` — the web `Math.round` for non-negative scores (half rounds up, unlike Kotlin's
     * banker's `round`). A non-finite value collapses to `0`, matching the web `Math.round(NaN) === 0`.
     */
    internal fun roundHalfUp(value: Double): Int {
        val safe = if (value.isFinite()) value else 0.0
        return floor(safe + 0.5).toInt()
    }
}

/**
 * The gauge tier for a [total] score — the native mirror of the web `getScoreColor`: below 40 is bad,
 * below 70 is warn, otherwise good. The composable maps the tier to the per-theme status token.
 */
fun scoreTier(total: Int): ScoreTier =
    when {
        total < SCORE_WARN_THRESHOLD -> ScoreTier.Bad
        total < SCORE_GOOD_THRESHOLD -> ScoreTier.Warn
        else -> ScoreTier.Good
    }

/**
 * Builds the four render-ready breakdown bars in the web's order (Efficiency, Speed Discipline, Range
 * Preservation, Trip Length) from a [breakdown] and the localized [strings]. Pure so the row labels,
 * values, and ceilings — the surface's accessible content — are asserted off-device.
 */
fun driveScoreBars(
    breakdown: DriveScoreBreakdown,
    strings: DriveScoreStrings,
): List<DriveScoreBarModel> =
    listOf(
        DriveScoreBarModel(DriveScoreMetric.Efficiency, strings.efficiency, breakdown.efficiency, EFFICIENCY_BAR_MAX),
        DriveScoreBarModel(DriveScoreMetric.SpeedDiscipline, strings.speedDiscipline, breakdown.speed, SUBSCORE_BAR_MAX),
        DriveScoreBarModel(
            DriveScoreMetric.RangePreservation,
            strings.rangePreservation,
            breakdown.range,
            SUBSCORE_BAR_MAX,
        ),
        DriveScoreBarModel(DriveScoreMetric.TripLength, strings.tripLength, breakdown.trip, SUBSCORE_BAR_MAX),
    )

/**
 * Builds the prop-driven [UiState] the web-parity overload renders — the native mirror of the web
 * component receiving its `drive` prop directly. A `null` drive maps to [UiPhase.Empty] (no drive
 * selected); any drive maps to [UiPhase.Content] and is scored. There is no fetch behind this, so it
 * carries no freshness / error fields — those live on the host feed when the stateful entry is used.
 */
fun driveScoreState(drive: DriveScoreInput?): UiState<DriveScoreInput> =
    if (drive == null) UiState(UiPhase.Empty) else UiState(UiPhase.Content, data = drive)

/**
 * Classifies a hard-error [errorKind] (+ optional [httpStatus]) into the recovery bucket the surface's
 * error state renders. A 404 maps to not-found, 401/403 to unauthorized, 5xx to server-error, a tripped
 * circuit to the transient "waiting" state, and everything else (network / timeout / decode / unknown) to
 * a retryable network error. Pure so the mapping is unit-tested.
 */
fun driveScoreErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    when {
        errorKind == ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        httpStatus == HTTP_NOT_FOUND -> QueryErrorKind.NotFound
        httpStatus == HTTP_UNAUTHORIZED || httpStatus == HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
        httpStatus != null && httpStatus >= HTTP_SERVER_ERROR -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DriveScoreRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a distance, battery level, or score — so a diagnostics line can
 * never leak a drive. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable
 * calls it from its first-composition effect.
 */
fun recordDriveScoreOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DriveScoreRegistration.SLUG))
}
