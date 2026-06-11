// Pure, framework-free model + projection for the Drive Score Gauge dashboard widget — the native
// analogue of the data the web component computes (via `useMemo`) before returning JSX
// (web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. Drive-score values are unitless 0-100 figures, so there is no SI
// conversion at this boundary — only the web `scoreColor` band heuristic and the en-US number
// formatting are reproduced here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DriveScoreGaugeWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescoregauge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Em dash shown for an absent letter grade (web `score.grade ?? '—'`). */
private const val EM_DASH = "\u2014"

/**
 * One decoded `GET /drives/score?vehicle_id=` card — the native mirror of the web `DriveScore` type
 * (web/src/types/driving.ts) restricted to the five fields this widget renders. Field names mirror the
 * Go API's snake_case JSON tags (internal/api/drives/listing.go): `overall`, `efficiency`,
 * `smoothness`, `speed_discipline` and `grade`. Parsing is null-tolerant so a partial body never
 * throws; missing numeric fields default to `0` exactly as the web `score.x ?? 0` reads do.
 */
data class DriveScoreSnapshot(
    val overall: Double,
    val efficiency: Double,
    val smoothness: Double,
    val speedDiscipline: Double,
    val grade: String?,
) {
    companion object {
        /**
         * Project a `GET /drives/score` body into a tolerant snapshot, or `null` when the body is
         * absent / not an object (web parity: the `score ?` falsy gate renders the "No score yet"
         * empty state). A present object — including the all-zero "F" card the backend returns when
         * there are no drives — decodes to a snapshot so the gauge renders, mirroring the web `score`
         * truthiness check.
         */
        fun fromJson(element: JsonElement): DriveScoreSnapshot? {
            val obj = element as? JsonObject ?: return null
            return DriveScoreSnapshot(
                overall = obj.numberOrNull("overall") ?: 0.0,
                efficiency = obj.numberOrNull("efficiency") ?: 0.0,
                smoothness = obj.numberOrNull("smoothness") ?: 0.0,
                speedDiscipline = obj.numberOrNull("speed_discipline") ?: 0.0,
                grade = obj.stringOrNull("grade"),
            )
        }
    }
}

/**
 * The widget's grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`
 * plus the `isCompact` / `isTall` branches in the web source: a 1×1 footprint hides the title/icon
 * and the breakdown (the compact gauge), and a footprint two-or-more rows tall adds the per-category
 * [io.teslasync.android.components.datadisplay.MetricBar] breakdown beneath the gauge hero.
 */
data class DriveScoreGaugeSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a 1×1 footprint (web `isCompact = size.cols === 1 && size.rows === 1`). */
    val isCompact: Boolean get() = cols == COMPACT_DIM && rows == COMPACT_DIM

    /** True at two-or-more rows (web `isTall = size.rows >= 2`): render the breakdown bars. */
    val isTall: Boolean get() = rows >= TALL_MIN_ROWS

    companion object {
        private const val COMPACT_DIM = 1
        private const val TALL_MIN_ROWS = 2
        private const val DEFAULT_COLS = 1
        private const val DEFAULT_ROWS = 2
        private const val MAX_COLS = 2
        private const val MAX_ROWS = 40

        /** Registry default footprint (1×2). */
        val Default: DriveScoreGaugeSize = DriveScoreGaugeSize(cols = DEFAULT_COLS, rows = DEFAULT_ROWS)

        /** Registry minimum footprint (1×2). */
        val MinSize: DriveScoreGaugeSize = DriveScoreGaugeSize(cols = DEFAULT_COLS, rows = DEFAULT_ROWS)

        /** Registry maximum footprint (2×40). */
        val MaxSize: DriveScoreGaugeSize = DriveScoreGaugeSize(cols = MAX_COLS, rows = MAX_ROWS)

        /** True when [size] falls within the inclusive min/max footprint constraints. */
        fun withinBounds(size: DriveScoreGaugeSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: DriveScoreGaugeSize): DriveScoreGaugeSize =
            DriveScoreGaugeSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`drive-score-gauge`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object DriveScoreGaugeRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "drive-score-gauge"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DriveScoreGaugeWidget"

    /** Default footprint: 1 column × 2 rows. */
    val defaultSize: DriveScoreGaugeSize get() = DriveScoreGaugeSize.Default

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: DriveScoreGaugeSize get() = DriveScoreGaugeSize.MinSize

    /** Maximum footprint: 2 columns × 40 rows. */
    val maxSize: DriveScoreGaugeSize get() = DriveScoreGaugeSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: DriveScoreGaugeSize): Boolean = DriveScoreGaugeSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DriveScoreGaugeSize): DriveScoreGaugeSize = DriveScoreGaugeSize.clamp(size)
}

/**
 * The score band a value falls into — the native analogue of the web `SCORE_COLORS` buckets. Mapped
 * to a concrete semantic color at the render boundary (excellent → success, good → info, fair →
 * warning, poor → danger) so no hex literal leaks into the view.
 */
enum class DriveScoreBand { Excellent, Good, Fair, Poor }

/**
 * The localized labels the projection folds into its output, resolved from the P1/S10 i18n catalog at
 * the Compose boundary (`stringResource`) and passed in so [DriveScoreGaugeProjection.project] stays
 * pure and JVM-testable. Keys mirror the web `t('widget.driveScoreGauge.*')` calls verbatim. The
 * title + "No score yet" strings are render-only chrome (the projection never needs them) and are
 * resolved directly in the composable.
 */
data class DriveScoreGaugeLabels(
    val weekly: String,
    val efficiency: String,
    val smoothness: String,
    val speed: String,
)

/**
 * One projected, render-ready sub-score — the native analogue of a web `subScores` entry. Pure data
 * (no Compose types): the [key] the web uses for its React list key, the localized [label], the
 * [value] (0-100) the bar fills to (web bar `value={s.value ?? 0}`), the already-formatted display
 * [valueText] (web `${s.value ?? 0}`), and the per-score [band] the view maps to a bar/text color
 * (web `scoreColor(s.value ?? 0)`).
 */
data class DriveScoreBreakdownItem(
    val key: String,
    val label: String,
    val value: Double,
    val valueText: String,
    val band: DriveScoreBand,
)

/**
 * The fully projected, render-ready view of one score card — the native analogue of everything the
 * web component computes before returning JSX (the `gauge` / `stats` / `subScores` `useMemo`s). Pure
 * data so the projection is unit-tested without a UI host.
 */
data class DriveScoreGaugeDisplay(
    val gaugeValue: Double,
    val gradeLabel: String,
    val band: DriveScoreBand,
    val weeklyLabel: String,
    val breakdown: List<DriveScoreBreakdownItem>,
)

/**
 * Pure projection from a decoded [DriveScoreSnapshot] to the [DriveScoreGaugeDisplay] — the native
 * port of the `gauge` / `stats` / `subScores` `useMemo`s in the web source. The overall band drives
 * the gauge color and each sub-score carries its own band (web `scoreColor`); sub-score values are
 * rounded to whole numbers for display, matching the web `${value}` interpolation of the already
 * server-rounded figures.
 */
object DriveScoreGaugeProjection {
    /** The fixed gauge / bar scale (web `max={100}`). */
    const val SCORE_MAX: Double = 100.0

    /** Overall ≥ this is the excellent band (web `score >= 80`). */
    const val EXCELLENT_MIN: Double = 80.0

    /** Overall ≥ this (and below [EXCELLENT_MIN]) is the good band (web `score >= 60`). */
    const val GOOD_MIN: Double = 60.0

    /** Overall ≥ this (and below [GOOD_MIN]) is the fair band (web `score >= 40`); below it is poor. */
    const val FAIR_MIN: Double = 40.0

    /**
     * Project [snapshot] using the localized [labels]: the gauge value/grade/band plus the three
     * sub-score breakdown items (efficiency, smoothness, speed discipline), in the exact web order.
     */
    fun project(
        snapshot: DriveScoreSnapshot,
        labels: DriveScoreGaugeLabels,
    ): DriveScoreGaugeDisplay =
        DriveScoreGaugeDisplay(
            gaugeValue = snapshot.overall,
            gradeLabel = snapshot.grade?.takeIf { it.isNotBlank() } ?: EM_DASH,
            band = bandFor(snapshot.overall),
            weeklyLabel = labels.weekly,
            breakdown = breakdown(snapshot, labels),
        )

    /** The score band for [value] (web `scoreColor` thresholds: 80 / 60 / 40). */
    fun bandFor(value: Double): DriveScoreBand =
        when {
            value >= EXCELLENT_MIN -> DriveScoreBand.Excellent
            value >= GOOD_MIN -> DriveScoreBand.Good
            value >= FAIR_MIN -> DriveScoreBand.Fair
            else -> DriveScoreBand.Poor
        }

    private fun breakdown(
        snapshot: DriveScoreSnapshot,
        labels: DriveScoreGaugeLabels,
    ): List<DriveScoreBreakdownItem> =
        listOf(
            item(key = "efficiency", label = labels.efficiency, value = snapshot.efficiency),
            item(key = "smoothness", label = labels.smoothness, value = snapshot.smoothness),
            item(key = "speed", label = labels.speed, value = snapshot.speedDiscipline),
        )

    private fun item(
        key: String,
        label: String,
        value: Double,
    ): DriveScoreBreakdownItem =
        DriveScoreBreakdownItem(
            key = key,
            label = label,
            value = value,
            valueText = displayValue(value),
            band = bandFor(value),
        )

    /**
     * Stringify a score the way the web `${value}` interpolation does: a whole number drops its
     * fraction (`82`), any other value keeps its decimals. The backend rounds these figures to whole
     * numbers, so this normally yields the integer label — matching the web output exactly.
     */
    private fun displayValue(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
}

/** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Reads a string property, or `null` when absent / not a JSON string (incl. JSON null). */
private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
