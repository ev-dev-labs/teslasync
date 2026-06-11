// Pure, framework-free model + projection for the Driving Dynamics dashboard widget — the native
// analogue of everything the web component derives (the `useMemo` severity + histogram, the inline
// `maxG`/`smooth`/`gaugeColor` helpers) before returning JSX
// (web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The two feeds arrive as raw SI JSON (`/drives/dynamics` +
// `/drives/acceleration-distribution`, snake_case on the wire), so this file owns the decode (web
// optional-chaining → null-safe reads). G-forces are dimensionless, so there is NO SI→display unit
// conversion here — only locale-stable number formatting at the display boundary (Phase-48; ADR-013).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DrivingDynamicsWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path — exactly as the sibling CostBreakdownWidget /
// ChargeStatusLiveWidget do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingdynamics

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Web `const G_MAX = 1.2` — the radial-gauge full-scale value and the histogram x-axis span. */
const val G_MAX: Double = 1.2

/** Web `fmtNumber(_, 2)` — g-forces and histogram range labels render with two fraction digits. */
private const val G_DECIMALS: Int = 2

/** Web `isSmooth(maxG) = maxG < 0.4`. */
private const val SMOOTH_MAX_G: Double = 0.4

// Severity thresholds (web `deriveSeverity` on the average of avg-accel + avg-brake).
private const val SEVERITY_CALM_BELOW: Double = 0.15
private const val SEVERITY_NORMAL_BELOW: Double = 0.3
private const val SEVERITY_SPORTY_BELOW: Double = 0.5

// Per-gauge tone thresholds (web `gaugeColor`).
private const val GAUGE_CALM_BELOW: Double = 0.2
private const val GAUGE_NORMAL_BELOW: Double = 0.4
private const val GAUGE_SPORTY_BELOW: Double = 0.6

private const val FIELD_MAX_ACCEL_G = "max_acceleration_g"
private const val FIELD_MAX_BRAKING_G = "max_braking_g"
private const val FIELD_MAX_CORNERING_G = "max_cornering_g"
private const val FIELD_AVG_ACCEL_G = "avg_acceleration_g"
private const val FIELD_AVG_BRAKING_G = "avg_braking_g"
private const val FIELD_VALUES = "values"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * web swaps three layouts off `size.cols`: a single-column compact hero (`size.cols <= 1`), the
 * standard three-gauge layout, and — at three-plus columns (`size.cols >= 3`) — the standard layout
 * plus the acceleration-distribution histogram.
 */
data class DrivingDynamicsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact max-g hero. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three-plus columns (web `size.cols >= 3`): the standard layout adds the histogram. */
    val isWide: Boolean get() = cols >= 3
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`driving-dynamics`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object DrivingDynamicsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "driving-dynamics"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DrivingDynamicsWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val DEFAULT_SIZE: DrivingDynamicsSize = DrivingDynamicsSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: DrivingDynamicsSize = DrivingDynamicsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: DrivingDynamicsSize = DrivingDynamicsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: DrivingDynamicsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DrivingDynamicsSize): DrivingDynamicsSize =
        DrivingDynamicsSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The semantic status tone of a g-force reading / driving style — the native, theme-aware analogue of
 * the web `gaugeColor` / `SEVERITY_COLORS` hex ramp (green → cyan → amber → red). The render boundary
 * resolves each tone to a `TeslaTokens.status` color and the matching `BadgeVariant`, so the exact
 * four-way coloring survives light / dark / high-contrast themes without a raw hex literal.
 */
enum class GForceTone {
    /** Web `#10b981` (green) — calm / lowest band. */
    Calm,

    /** Web `#22d3ee` (cyan) — normal band. */
    Normal,

    /** Web `#f59e0b` (amber) — sporty band. */
    Sporty,

    /** Web `#ef4444` (red) — aggressive / highest band. */
    Aggressive,
}

/**
 * One radial gauge — the native analogue of a web `<RadialGauge>` + its caption. Carries the raw SI
 * g-force [value] (the gauge sweeps it against [G_MAX]), the localized [label] shown beneath it (web
 * "Accel" / "Brake" / "Lateral"), and the four-way [tone] the arc + value are colored with (web
 * `gaugeColor(value)`).
 */
data class GaugeReading(
    val value: Double,
    val label: String,
    val tone: GForceTone,
)

/**
 * One acceleration-distribution histogram bar — the native analogue of a web `histogramData` entry.
 * [rangeLabel] is the evenly-spaced g-axis label (web `fmtNumber(i * step, 2)`) and [count] is the bar
 * height (web `values[i] ?? 0`). The web maps each `values` element to a bar verbatim, so this
 * reproduces that exact transformation rather than re-bucketing.
 */
data class HistogramBar(
    val rangeLabel: String,
    val count: Double,
)

/**
 * The two raw feeds the surface renders, folded into one value by the view-model — the dynamics
 * payload (primary; drives every gauge, the severity badge and the loading / empty / error / stale
 * chrome) plus the best-effort acceleration-distribution payload (supplementary; feeds only the wide
 * histogram, may be `null`). Raw [JsonElement]s exactly as the shared layer serves them; the decode +
 * projection happen in [DrivingDynamicsProjection]. Pure data so the combine + projection are
 * unit-tested without a UI host.
 */
data class DrivingDynamicsBundle(
    val dynamics: JsonElement,
    val distribution: JsonElement?,
)

/**
 * Localized labels the surface folds into its output — the nine `widget.drivingDynamics.*` keys the
 * web reads via `t('widget.drivingDynamics.…')` (and that the P1/S10 catalog provides). The pure
 * [DrivingDynamicsProjection] reads these to assemble each visible string + TalkBack phrase; the
 * composable builds this from `stringResource`, while tests pass a deterministic instance. Keeping
 * i18n out of the projection lets it stay a pure, locale-stable function.
 *
 * The web also reads `widget.drivingDynamics.severity.{calm,normal,sporty,aggressive}` for the standard
 * severity badge, but those keys do NOT exist in the P1/S10 catalog (the catalog's `strings.xml` is
 * auto-generated and must not be hand-edited, and the prompt's i18n contract omits them), so the web
 * falls back to a hard-coded English literal there. The native surface instead conveys the full
 * four-way severity through the badge's [GForceTone] color (the web `SEVERITY_COLORS` ramp) and labels
 * it with the catalog's binary style vocabulary — [smooth] for the calm/normal band, [aggressive] for
 * the sporty/aggressive band — so no English literal is ever hard-coded.
 */
data class DrivingDynamicsStrings(
    val title: String,
    val maxG: String,
    val smooth: String,
    val aggressive: String,
    val noData: String,
    val accel: String,
    val brake: String,
    val lateral: String,
    val distribution: String,
)

/**
 * The fully projected, render-ready view of the driving-dynamics surface — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so every
 * branch is unit-tested directly. Carries both the compact-hero fields and the standard / wide layout
 * fields; the composable renders the right subset per [DrivingDynamicsSize].
 *
 * @property hasData whether a dynamics object was decoded (web `dynamics ?` truthy); when false the
 *   surface renders its empty state instead of the gauges / hero.
 * @property maxG the largest of the three max-g readings (web `Math.max(maxAccel, maxBrake, maxCorner)`).
 * @property maxGText [maxG] formatted to two fraction digits (web `fmtNumber(maxG, 2)`) — the compact hero number.
 * @property maxGLabel the localized "Max g" caption beneath the compact hero number.
 * @property distributionTitle the localized "G-Force Distribution" caption above the wide histogram.
 * @property smooth web `isSmooth(maxG)` — drives the compact badge word + variant.
 * @property severity the four-way driving style (web `deriveSeverity`) — the standard badge's tone color.
 * @property severityWord the standard badge's localized word: [DrivingDynamicsStrings.smooth] for the
 *   calm/normal band, [DrivingDynamicsStrings.aggressive] for the sporty/aggressive band (web badge variant split).
 * @property compactWord the compact badge's localized word (smooth → [DrivingDynamicsStrings.smooth], else aggressive).
 * @property accel / [brake] / [lateral] the three gauges (web avgAccel / avgBrake / maxCorner).
 * @property histogram the acceleration-distribution bars, possibly empty (web `histogramData`).
 * @property compactContentDescription the folded TalkBack phrase for the compact hero.
 * @property noDataMessage the localized empty-state message.
 */
data class DrivingDynamicsDisplay(
    val hasData: Boolean,
    val maxG: Double,
    val maxGText: String,
    val maxGLabel: String,
    val distributionTitle: String,
    val smooth: Boolean,
    val severity: GForceTone,
    val severityWord: String,
    val compactWord: String,
    val accel: GaugeReading,
    val brake: GaugeReading,
    val lateral: GaugeReading,
    val histogram: List<HistogramBar>,
    val compactContentDescription: String,
    val noDataMessage: String,
) {
    companion object {
        private fun emptyGauge() = GaugeReading(value = 0.0, label = "", tone = GForceTone.Calm)

        /** The no-dynamics projection (web `dynamics == null`): the surface shows its empty state. */
        fun empty(strings: DrivingDynamicsStrings): DrivingDynamicsDisplay =
            DrivingDynamicsDisplay(
                hasData = false,
                maxG = 0.0,
                maxGText = EM_DASH,
                maxGLabel = strings.maxG,
                distributionTitle = strings.distribution,
                smooth = true,
                severity = GForceTone.Calm,
                severityWord = strings.smooth,
                compactWord = strings.smooth,
                accel = emptyGauge().copy(label = strings.accel),
                brake = emptyGauge().copy(label = strings.brake),
                lateral = emptyGauge().copy(label = strings.lateral),
                histogram = emptyList(),
                compactContentDescription = strings.noData,
                noDataMessage = strings.noData,
            )
    }
}

/**
 * Pure projection from the decoded [DrivingDynamicsBundle] to the render-ready
 * [DrivingDynamicsDisplay] — the native port of the inline derivations + JSX formatting in the web
 * source: `maxG = Math.max(...)`, `smooth = isSmooth(maxG)`, the `deriveSeverity` memo, the per-gauge
 * `gaugeColor`, and the `histogramData` memo. The dynamics object is read with web-parity
 * optional-chaining (`?? 0`); the distribution `values` array drives the histogram exactly as the web
 * does. [locale] drives number grouping (tests pin [Locale.US]); no SI conversion is needed because
 * g-forces are dimensionless.
 */
object DrivingDynamicsProjection {
    /**
     * Project [bundle] into the render model using the localized [strings]. A `null` bundle, or a
     * bundle whose dynamics payload is not a JSON object (web `dynamics` falsy), yields the empty
     * projection so the surface shows its "No dynamics data" state.
     */
    fun project(
        bundle: DrivingDynamicsBundle?,
        strings: DrivingDynamicsStrings,
        locale: Locale = Locale.US,
    ): DrivingDynamicsDisplay {
        val dynamics = bundle?.dynamics as? JsonObject ?: return DrivingDynamicsDisplay.empty(strings)

        val maxAccel = dynamics.gForce(FIELD_MAX_ACCEL_G)
        val maxBraking = dynamics.gForce(FIELD_MAX_BRAKING_G)
        val maxCornering = dynamics.gForce(FIELD_MAX_CORNERING_G)
        val avgAccel = dynamics.gForce(FIELD_AVG_ACCEL_G)
        val avgBraking = dynamics.gForce(FIELD_AVG_BRAKING_G)

        val maxG = maxOf(maxAccel, maxBraking, maxCornering)
        val smooth = isSmooth(maxG)
        val severity = deriveSeverity(avgAccel, avgBraking)

        val accel = GaugeReading(avgAccel, strings.accel, gaugeTone(avgAccel))
        val brake = GaugeReading(avgBraking, strings.brake, gaugeTone(avgBraking))
        val lateral = GaugeReading(maxCornering, strings.lateral, gaugeTone(maxCornering))

        val compactWord = if (smooth) strings.smooth else strings.aggressive
        val severityWord = if (isPositive(severity)) strings.smooth else strings.aggressive
        val maxGText = ChartFormat.number(maxG, G_DECIMALS, locale)

        return DrivingDynamicsDisplay(
            hasData = true,
            maxG = maxG,
            maxGText = maxGText,
            maxGLabel = strings.maxG,
            distributionTitle = strings.distribution,
            smooth = smooth,
            severity = severity,
            severityWord = severityWord,
            compactWord = compactWord,
            accel = accel,
            brake = brake,
            lateral = lateral,
            histogram = histogram(bundle.distribution, locale),
            compactContentDescription = "${strings.maxG} $maxGText, $compactWord",
            noDataMessage = strings.noData,
        )
    }

    /** Web `isSmooth(maxG) = maxG < 0.4`. */
    fun isSmooth(maxG: Double): Boolean = maxG.isFinite() && maxG < SMOOTH_MAX_G

    /**
     * Web `deriveSeverity(avgAccel, avgBrake)`: the average of the two average g's bucketed into the
     * four-way driving style (< 0.15 calm, < 0.3 normal, < 0.5 sporty, else aggressive).
     */
    fun deriveSeverity(
        avgAccel: Double,
        avgBraking: Double,
    ): GForceTone {
        val avg = (safe(avgAccel) + safe(avgBraking)) / 2.0
        return when {
            avg < SEVERITY_CALM_BELOW -> GForceTone.Calm
            avg < SEVERITY_NORMAL_BELOW -> GForceTone.Normal
            avg < SEVERITY_SPORTY_BELOW -> GForceTone.Sporty
            else -> GForceTone.Aggressive
        }
    }

    /** Web `gaugeColor(g)`: < 0.2 green, < 0.4 cyan, < 0.6 amber, else red. */
    fun gaugeTone(g: Double): GForceTone {
        val v = safe(g)
        return when {
            v < GAUGE_CALM_BELOW -> GForceTone.Calm
            v < GAUGE_NORMAL_BELOW -> GForceTone.Normal
            v < GAUGE_SPORTY_BELOW -> GForceTone.Sporty
            else -> GForceTone.Aggressive
        }
    }

    /**
     * Whether a [severity] sits in the "positive" (success) half — the web standard badge variant
     * split `severity === 'calm' || severity === 'normal' ? 'success' : 'warning'`.
     */
    fun isPositive(severity: GForceTone): Boolean = severity == GForceTone.Calm || severity == GForceTone.Normal

    /**
     * The acceleration-distribution bars — the native port of the web `histogramData` memo: with `n`
     * values, `step = G_MAX / n` and each bar is `{ range: fmtNumber(i * step, 2), count: values[i] ?? 0 }`.
     * An absent / empty `values` array yields no bars (web `values.length === 0 ? [] : …`).
     */
    fun histogram(
        distribution: JsonElement?,
        locale: Locale = Locale.US,
    ): List<HistogramBar> {
        val values = (distribution as? JsonObject)?.get(FIELD_VALUES) as? JsonArray
        if (values == null || values.isEmpty()) return emptyList()
        val step = G_MAX / values.size
        return values.mapIndexed { index, element ->
            val count = (element as? JsonPrimitive)?.doubleOrNull ?: 0.0
            HistogramBar(rangeLabel = ChartFormat.number(index * step, G_DECIMALS, locale), count = count)
        }
    }

    /** Read a numeric field as the web `dynamics.x ?? 0` does — absent / null / non-number reads as 0. */
    private fun JsonObject.gForce(key: String): Double = safe((this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0)

    private fun safe(value: Double): Double = if (value.isFinite()) value else 0.0
}
