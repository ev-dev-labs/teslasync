// Pure, framework-free model + projection for the Drive Score dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DriveScoreWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer. The fleet-analytics feed arrives as raw SI JSON (`/analytics/fleet?days=7`), so
// this file owns the decode (web optional-chaining → null-safe reads), the efficiency→score derivation
// (web `Math.round((250 / efficiency) * 100)` capped at 100), and the display-boundary Wh/km→Wh/mi
// conversion (Phase-48 SI-canonical rule; web `useUnits`). Values stay SI until this projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DriveScoreWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescore

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.floor
import kotlin.math.min

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols === 1 && size.rows === 1` test that shrinks the
 * radial gauge (70 vs 100) and drops the efficiency stat row.
 */
data class DriveScoreSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a 1×1 footprint (web `size.cols === 1 && size.rows === 1`): render the bare gauge. */
    val isCompact: Boolean get() = cols == 1 && rows == 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`drive-score`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object DriveScoreRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "drive-score"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "DriveScoreWidget"

    /** Trailing window the gauge scores over: 7 days (web `useFleetAnalytics(7)`). */
    const val WINDOW_DAYS = 7

    /** Default footprint: 1 column × 2 rows (web `defaultSize`). */
    val defaultSize = DriveScoreSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = DriveScoreSize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows (web `maxSize`). */
    val maxSize = DriveScoreSize(cols = 2, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: DriveScoreSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DriveScoreSize): DriveScoreSize =
        DriveScoreSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * The decoded fleet-analytics payload — the native analogue of the single field the web component
 * reads from `/analytics/fleet` (`analytics?.avg_efficiency_wh_km ?? 0`). [efficiencyWhKm] is SI
 * (watt-hours per kilometre); conversion to the user's display unit happens in [DriveScoreProjection].
 * [present] mirrors the web `analytics ?` truthiness gate (a populated payload renders the gauge — even
 * at zero efficiency — while a missing/empty payload renders the friendly empty state).
 */
data class DriveScoreData(
    val efficiencyWhKm: Double,
    val present: Boolean,
) {
    /** Web `analytics ? <gauge> : <empty>` — drives the empty-state gate. */
    val hasData: Boolean get() = present

    companion object {
        /** The "no analytics" snapshot, surfaced for a null/empty payload (web `data: undefined`). */
        val EMPTY = DriveScoreData(efficiencyWhKm = 0.0, present = false)
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` read from
 * the `/settings` document: just the [distanceUnit], which selects the Wh/km↔Wh/mi efficiency
 * conversion + the `Wh/{unit}` label. The score itself is computed from the SI value, so no other
 * preference is required (the web `fmtNumber(value, 0)` uses a fixed zero-decimal format).
 */
data class DriveScoreDisplayPrefs(
    val distanceUnit: DistanceUnitPref,
) {
    companion object {
        /** Metric default used before settings load (matches the web metric default). */
        val METRIC_DEFAULT = DriveScoreDisplayPrefs(DistanceUnitPref.KM)

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): DriveScoreDisplayPrefs =
            DriveScoreDisplayPrefs(distanceUnit = UnitPreferences.fromSettings(settings).distance)
    }
}

/**
 * The score quality band — the native analogue of the web gauge-colour ternary
 * (`score > 75 ? green : score > 50 ? amber : red`). The pure projection classifies the score here so
 * the threshold logic is JVM-tested; the composable maps each band to the gauge arc colour.
 */
enum class ScoreBand {
    /** score > 75 — web `#10b981` (emerald). */
    Good,

    /** 50 < score ≤ 75 — web `#f59e0b` (amber). */
    Fair,

    /** score ≤ 50 — web `#ef4444` (red). */
    Poor,
}

/**
 * Localized labels the surface folds into its output — the three web `t('widget.…')` keys the
 * component reads. The pure [DriveScoreProjection] reads these to assemble each visible string; the
 * composable builds this from `stringResource`, while tests pass a deterministic instance.
 */
data class DriveScoreStrings(
    val score: String,
    val efficiency: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the drive score for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. The composable renders the gauge from [gaugeValue] /
 * [gaugeMax] / [scoreBand] / [scoreLabel] (the integer [score] backs the TalkBack phrase) and (when not
 * compact) the efficiency stat from [efficiencyValue] / [efficiencyUnit] / [efficiencyLabel];
 * [emptyMessage] backs the no-data branch.
 */
data class DriveScoreDisplay(
    val hasData: Boolean,
    val score: Int,
    val gaugeValue: Double,
    val gaugeMax: Double,
    val scoreBand: ScoreBand,
    val scoreLabel: String,
    val efficiencyValue: String,
    val efficiencyUnit: String,
    val efficiencyLabel: String,
    val gaugeContentDescription: String,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/analytics/fleet` [json] (SI, snake_case on the wire) into a [DriveScoreData]. A
 * non-object input or an empty object collapses to [DriveScoreData.EMPTY] (web `!analytics` → empty
 * state); a populated object yields `present = true` with the SI efficiency read null-safely
 * (`avg_efficiency_wh_km` missing/JSON-null ⇒ 0.0, reproducing web `?? 0`).
 */
fun parseDriveScore(json: JsonElement?): DriveScoreData {
    val obj = (json as? JsonObject)?.takeIf { it.isNotEmpty() } ?: return DriveScoreData.EMPTY
    return DriveScoreData(
        efficiencyWhKm = (obj["avg_efficiency_wh_km"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
        present = true,
    )
}

/**
 * Pure projection from a decoded [DriveScoreData] to the render-ready [DriveScoreDisplay] — the native
 * port of the inline derivations + JSX formatting in the web source. The score is derived from the SI
 * efficiency (lower Wh/km = higher score); the efficiency stat is converted to the user's distance unit
 * and formatted with zero decimals (web `fmtNumber(value, 0)`). [locale] drives the grouping/separators
 * (tests pin [Locale.US]).
 */
object DriveScoreProjection {
    /** Web `1.609344` — Wh/km × this = Wh/mi (a mile is 1.609344 km), used for the efficiency stat. */
    const val KM_PER_MILE = 1.609344

    /** Web `250 / efficiency` — the efficiency (Wh/km) that maps to a perfect 100 before the cap. */
    const val EFFICIENCY_SCORE_BASE = 250.0

    /** Web `Math.min(100, …)` — the score ceiling. */
    const val MAX_SCORE = 100

    /** Web `score > 75` upper band threshold (green). */
    const val GOOD_THRESHOLD = 75

    /** Web `score > 50` middle band threshold (amber). */
    const val FAIR_THRESHOLD = 50

    /** Web efficiency-stat precision: `fmtNumber(value, 0)`. */
    private const val EFFICIENCY_DECIMALS = 0

    /** Project [data] for the given [prefs] and localized [strings]. */
    fun project(
        data: DriveScoreData,
        prefs: DriveScoreDisplayPrefs,
        strings: DriveScoreStrings,
        locale: Locale = Locale.US,
    ): DriveScoreDisplay {
        val score = scoreFor(data.efficiencyWhKm)
        val unit = efficiencyUnit(prefs.distanceUnit)
        val efficiencyValue = ChartFormat.number(toEfficiencyDisplay(data.efficiencyWhKm, prefs.distanceUnit), EFFICIENCY_DECIMALS, locale)
        return DriveScoreDisplay(
            hasData = data.hasData,
            score = score,
            gaugeValue = score * 1.0,
            gaugeMax = MAX_SCORE * 1.0,
            scoreBand = bandFor(score),
            scoreLabel = strings.score,
            efficiencyValue = efficiencyValue,
            efficiencyUnit = unit,
            efficiencyLabel = strings.efficiency,
            gaugeContentDescription = "${strings.score}: $score",
            emptyMessage = strings.noData,
        )
    }

    /**
     * Derives the 0–100 score from the SI efficiency, reproducing the web expression
     * `efficiency > 0 ? Math.min(100, Math.round((250 / efficiency) * 100)) : 0`. JavaScript
     * `Math.round` rounds half away from zero; for the always-non-negative argument here that is
     * `floor(x + 0.5)`, which Kotlin's banker's-rounding `round()` would NOT match — so it is spelled
     * out explicitly.
     */
    fun scoreFor(efficiencyWhKm: Double): Int {
        if (efficiencyWhKm <= 0.0) return 0
        val raw = (EFFICIENCY_SCORE_BASE / efficiencyWhKm) * 100.0
        val rounded = floor(raw + 0.5).toInt()
        return min(MAX_SCORE, rounded)
    }

    /** Classifies [score] into a colour band (web `score > 75 ? green : score > 50 ? amber : red`). */
    fun bandFor(score: Int): ScoreBand =
        when {
            score > GOOD_THRESHOLD -> ScoreBand.Good
            score > FAIR_THRESHOLD -> ScoreBand.Fair
            else -> ScoreBand.Poor
        }

    /**
     * Converts the SI efficiency to the user's distance unit (web `toEfficiencyDisplay`): Wh/km stays
     * as-is for kilometres, or is multiplied by 1.609344 for miles (Wh per km × km per mile = Wh/mi).
     */
    fun toEfficiencyDisplay(
        efficiencyWhKm: Double,
        unit: DistanceUnitPref,
    ): Double = if (unit == DistanceUnitPref.MI) efficiencyWhKm * KM_PER_MILE else efficiencyWhKm

    /** The efficiency unit symbol for [unit]: `Wh/mi` for miles, else `Wh/km` (web `efficiencyUnit`). */
    fun efficiencyUnit(unit: DistanceUnitPref): String = if (unit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"
}
