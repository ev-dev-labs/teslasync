// Pure, framework-free model + projections for the Drive Analytics section feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx). No Compose, no Android,
// no HTTP: every declaration here runs in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is presentational over a `filteredDrives: Drive[]` prop its parent page
// (DrivingDynamicsPage) builds from `useDrives` + a page-scoped date range. This native surface is
// self-contained: it receives the full drive feed through the shared P1/S8 state-holder as a
// UiState<List<DriveAnalyticsDrive>>, owns the date-range filter the web renders inside the section
// (the web `RangePicker`), and derives the three charts the web `useMemo` blocks build:
//   1. Speed Distribution    — bar: drive count per average-speed bucket (web `speedDistribution`)
//   2. Acceleration Patterns — scatter: peak power vs trip distance + an average reference line
//                              (web `accelPatterns`)
//   3. Power Profile         — area: peak (+ flat-zero regen) power for the last 20 drives
//                              (web `powerProfile`)
//
// Unit handling mirrors the web exactly. The speed-bucket comparison passes BOTH the drive speed and the
// bucket edges through `convertSpeedFromSI` (the web `toSpeedDisplay` applied to `avgSpeedMps` and to
// `r.min`/`r.max`), so the conversion cancels in the comparison and the bucketing depends only on the raw
// m/s value — the same behaviour the web encodes; the bucket label still carries the display unit. Distance
// is `Math.round(convertDistanceFromSI(distanceM))` (web) and power is the fixed W→kW divide
// (web `avgPowerW / 1000`); kW is the fixed power display unit, matching the web (no `useUnits` power pref).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DriveAnalyticsSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.driveanalyticssection

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import io.teslasync.shared.core.units.convertSpeedFromSI
import kotlin.math.floor

/** Watts per kilowatt — the fixed W→kW scale the web applies via `avgPowerW / 1000`. */
internal const val WATTS_PER_KW: Double = 1000.0

/** The web `filteredDrives.slice(-20)` window for the Power Profile chart. */
internal const val RECENT_DRIVES_WINDOW: Int = 20

/** The page default date range — the web `startDate = today - 30 days`. */
internal const val DEFAULT_RANGE_DAYS: Long = 30

/** Length of the `YYYY-MM-DD` date key the web `startTs.slice(0, 10)` extracts. */
internal const val DATE_KEY_LENGTH: Int = 10

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object DriveAnalyticsSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "drive-analytics-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DriveAnalyticsSection"
}

/**
 * One average-speed bucket edge — the native mirror of a web `SPEED_BUCKETS_RANGES` entry
 * (`{ min, max, label }`). [max] is [Double.POSITIVE_INFINITY] for the open-ended top bucket
 * (web `Infinity`); [label] is the unit-less numeric span the surface suffixes with the speed unit.
 */
data class SpeedBucketRange(
    val min: Double,
    val max: Double,
    val label: String,
)

/**
 * The fixed average-speed buckets — a verbatim port of the web `SPEED_BUCKETS_RANGES`
 * (`0–30 / 30–60 / 60–90 / 90–120 / 120+`). The en-dash labels match the web exactly.
 */
val SPEED_BUCKETS_RANGES: List<SpeedBucketRange> =
    listOf(
        SpeedBucketRange(0.0, 30.0, "0\u201330"),
        SpeedBucketRange(30.0, 60.0, "30\u201360"),
        SpeedBucketRange(60.0, 90.0, "60\u201390"),
        SpeedBucketRange(90.0, 120.0, "90\u2013120"),
        SpeedBucketRange(120.0, Double.POSITIVE_INFINITY, "120+"),
    )

/**
 * The subset of a web `Drive` this surface reads — SI on the wire, converted at the display boundary.
 *
 * @property startTs the drive start as an ISO-8601 UTC string (web `drive.startTs`); `null` when unknown.
 * @property distanceM the trip distance in SI meters (web `drive.distanceM`).
 * @property avgSpeedMps the average speed in SI m/s (web `drive.avgSpeedMps`); `null` when unknown.
 * @property avgPowerW the average power in SI watts (web `drive.avgPowerW`); `null` when unknown.
 */
data class DriveAnalyticsDrive(
    val startTs: String?,
    val distanceM: Double,
    val avgSpeedMps: Double?,
    val avgPowerW: Double?,
)

/**
 * One Speed Distribution bar — the native mirror of the web `{ range, count }`. [range] is the localized
 * bucket label already suffixed with the speed unit (e.g. `0–30 km/h`); [count] is a non-negative tally.
 */
data class SpeedBucket(
    val range: String,
    val count: Long,
)

/**
 * One Acceleration Patterns point — the native mirror of the web scatter datum
 * (`{ distance, powerMax }`). [distance] is the rounded trip distance in the display unit and [powerMax]
 * is the drive's average power in kW (web `avgPowerW / 1000`).
 */
data class AccelPoint(
    val distance: Double,
    val powerMax: Double,
)

/**
 * One Power Profile datum — the native mirror of the web `{ label, powerMax, powerMin }`. [label] is the
 * short drive-start date (web `formatDateShort(startTs)`), [powerMax] is the drive's power in kW, and
 * [powerMin] is the web's hard-coded `0` regen baseline (the regen area is intentionally flat).
 */
data class PowerPoint(
    val label: String,
    val powerMax: Double,
    val powerMin: Double,
)

/**
 * The fully projected Acceleration Patterns scatter — render-ready display-unit [points] plus the per-axis
 * bounds the Canvas normalizes against (the web `<XAxis type="number" />` / `<YAxis type="number" />`
 * auto-domains) and [avg], the mean peak power the web draws as a `<ReferenceLine y={…}>`. Pure data (no
 * Compose types) so the geometry is unit-tested without a UI host.
 *
 * @property avg the mean of every point's [AccelPoint.powerMax]; `null` only when [points] is empty
 *   (the web renders the reference line only when `accelPatterns.length > 0`).
 */
data class AccelScatterProjection(
    val points: List<AccelPoint>,
    val xMin: Double,
    val xMax: Double,
    val yMin: Double,
    val yMax: Double,
    val avg: Double?,
) {
    /** True when there are no observations — the view shows the empty state. */
    val isEmpty: Boolean get() = points.isEmpty()
}

/**
 * The pure date-filter + chart projections the composable renders — the native mirror of the web
 * component's `filteredDrives` filter and its three `useMemo` chart derivations. Stateless and
 * side-effect-free so the off-device unit gate covers every branch; the composable only resolves localized
 * strings, palette colors, the date formatter, and the freshness chrome.
 */
object DriveAnalyticsProjection {
    /**
     * Filters [drives] to those whose start date falls within the inclusive `YYYY-MM-DD` range
     * `[startYmd, endYmd]` — a verbatim port of the web page's `filteredDrives` memo
     * (`driveDate = startTs?.slice(0, 10) ?? ''; driveDate >= startDate && driveDate <= endDate`). The
     * lexicographic string compare is exact for the fixed-width ISO date key.
     */
    fun filterByDate(
        drives: List<DriveAnalyticsDrive>,
        startYmd: String,
        endYmd: String,
    ): List<DriveAnalyticsDrive> =
        drives.filter { drive ->
            val day = drive.startTs?.take(DATE_KEY_LENGTH) ?: ""
            day >= startYmd && day <= endYmd
        }

    /**
     * Buckets [drives] by average speed — a verbatim port of the web `speedDistribution` memo. Every
     * bucket is emitted (count `0` when empty, like the web), labelled `"${range} ${speed.label}"`. The
     * drive speed and each bucket edge are both converted via [convertSpeedFromSI] (the web
     * `toSpeedDisplay`), so the half-open `lo <= spd < hi` test reproduces the web bucketing exactly.
     * Drives with no `avgSpeedMps` are skipped (web `if (spd == null) continue`).
     */
    fun speedDistribution(
        drives: List<DriveAnalyticsDrive>,
        speed: SpeedUnitPref,
    ): List<SpeedBucket> {
        val counts = LongArray(SPEED_BUCKETS_RANGES.size)
        for (drive in drives) {
            val mps = drive.avgSpeedMps ?: continue
            val spd = convertSpeedFromSI(mps, speed)
            for (i in SPEED_BUCKETS_RANGES.indices) {
                val range = SPEED_BUCKETS_RANGES[i]
                val hi = if (range.max.isInfinite()) Double.POSITIVE_INFINITY else convertSpeedFromSI(range.max, speed)
                val lo = convertSpeedFromSI(range.min, speed)
                if (spd >= lo && spd < hi) {
                    counts[i] += 1
                    break
                }
            }
        }
        return SPEED_BUCKETS_RANGES.mapIndexed { i, range ->
            SpeedBucket(range = "${range.label} ${speed.label}", count = counts[i])
        }
    }

    /** Total drives counted across [buckets] — `0` means the Speed Distribution chart shows its empty state. */
    fun speedTotal(buckets: List<SpeedBucket>): Long = buckets.sumOf { it.count }

    /**
     * Projects [drives] to scatter points — a verbatim port of the web `accelPatterns` memo: keep only
     * drives with a non-null `avgPowerW`, map `distance = Math.round(convertDistanceFromSI(distanceM))`
     * (see [jsRound]) and `powerMax = avgPowerW / 1000`. Order is preserved.
     */
    fun accelPatterns(
        drives: List<DriveAnalyticsDrive>,
        distance: DistanceUnitPref,
    ): List<AccelPoint> =
        drives.mapNotNull { drive ->
            val watts = drive.avgPowerW ?: return@mapNotNull null
            AccelPoint(
                distance = jsRound(convertDistanceFromSI(drive.distanceM, distance)),
                powerMax = watts / WATTS_PER_KW,
            )
        }

    /**
     * Derives the scatter [AccelScatterProjection] from [points]: the per-axis bounds and the mean peak
     * power the web draws as the `<ReferenceLine>`. Empty input yields a zero-bounds, no-average projection
     * (the web omits the reference line when there are no points).
     */
    fun accelScatter(points: List<AccelPoint>): AccelScatterProjection {
        if (points.isEmpty()) {
            return AccelScatterProjection(points, 0.0, 0.0, 0.0, 0.0, null)
        }
        return AccelScatterProjection(
            points = points,
            xMin = points.minOf { it.distance },
            xMax = points.maxOf { it.distance },
            yMin = points.minOf { it.powerMax },
            yMax = points.maxOf { it.powerMax },
            avg = points.sumOf { it.powerMax } / points.size,
        )
    }

    /**
     * Projects the last [RECENT_DRIVES_WINDOW] [drives] to Power Profile points — a verbatim port of the
     * web `powerProfile` memo (`filteredDrives.slice(-20).map(...)`): `powerMax = (avgPowerW ?? 0) / 1000`
     * and `powerMin = 0` (the web's flat regen baseline). [formatLabel] resolves the web
     * `formatDateShort(startTs)` x-axis label; injecting it keeps this projection locale-deterministic.
     */
    fun powerProfile(
        drives: List<DriveAnalyticsDrive>,
        formatLabel: (String?) -> String,
    ): List<PowerPoint> =
        drives.takeLast(RECENT_DRIVES_WINDOW).map { drive ->
            PowerPoint(
                label = formatLabel(drive.startTs),
                powerMax = (drive.avgPowerW ?: 0.0) / WATTS_PER_KW,
                powerMin = 0.0,
            )
        }

    /**
     * Maps [value] into the unit interval against [min]..[max] for the scatter Canvas; a degenerate range
     * centers at `0.5`. Out-of-range values clamp, so a point or the average line never escapes the plot.
     */
    fun normalize(
        value: Double,
        min: Double,
        max: Double,
    ): Double {
        if (max <= min) return 0.5
        return ((value - min) / (max - min)).coerceIn(0.0, 1.0)
    }

    /**
     * Rounds [value] half away from `+∞` — the JavaScript `Math.round` contract (`floor(v + 0.5)`) the web
     * `accelPatterns` uses for the scatter distance. Kotlin's `kotlin.math.round` rounds half to even, so
     * it is deliberately NOT used here.
     */
    fun jsRound(value: Double): Double = floor(value + 0.5)

    /** The web default range start: [todayEpochDay] minus 30 days. */
    fun defaultStartEpochDay(todayEpochDay: Long): Long = todayEpochDay - DEFAULT_RANGE_DAYS

    /** The web default range end: today. */
    fun defaultEndEpochDay(todayEpochDay: Long): Long = todayEpochDay
}

/**
 * Resource names (by-name; absent ⇒ the matching [DriveAnalyticsSectionDefaults] fallback) for the three
 * web chart `*.aria` descriptions. These keys collide with their visible title leaves in the i18next tree,
 * so the shared P1/S10 catalog does not define them; [resolveOptional] reproduces i18next's
 * "return the default when the key is absent" behaviour, carrying the web English fallback verbatim while
 * still routing through the i18n facade (the same resolution the sibling PowerProfileChart uses).
 */
const val KEY_SPEED_DISTRIBUTION_ARIA: String = "translation_dynamics_speedDistribution_aria"

/** See [KEY_SPEED_DISTRIBUTION_ARIA]. */
const val KEY_ACCEL_PATTERNS_ARIA: String = "translation_dynamics_accelPatterns_aria"

/** See [KEY_SPEED_DISTRIBUTION_ARIA]. */
const val KEY_POWER_PROFILE_ARIA: String = "translation_dynamics_powerProfile_aria"

/** The web English `t(key, default)` fallbacks for the three catalog-absent chart aria descriptions. */
object DriveAnalyticsSectionDefaults {
    /** Web `t('dynamics.speedDistribution.aria', …)`. */
    const val SPEED_DISTRIBUTION_ARIA: String = "Speed-bucket drive count distribution bar chart"

    /** Web `t('dynamics.accelPatterns.aria', …)`. */
    const val ACCEL_PATTERNS_ARIA: String = "Per-drive scatter chart of peak power versus trip distance"

    /** Web `t('dynamics.powerProfile.aria', …)`. */
    const val POWER_PROFILE_ARIA: String = "Recent-drives peak and regen power dual-area chart"
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production and a map in tests, so the resolve-or-fallback
 * decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [DriveAnalyticsSectionRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a speed, distance, or power figure — so a diagnostics line can
 * never leak the drive history. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordDriveAnalyticsSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to DriveAnalyticsSectionRegistration.SLUG))
}
