// Pure, framework-free model + projection + diagnostics for the WidgetComparisonCard widget primitive —
// the native analogue of web/src/features/dashboard/widgets/shared/WidgetComparisonCard.tsx. No Compose,
// no Android framework, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer over these pure functions
// (the accepted sibling-surface contract used by Delta / MetricCard).
//
// What the web source actually is (and therefore the COMPLETE branch set this primitive reproduces): the
// web `WidgetComparisonCard` is a PURELY PRESENTATIONAL list of comparison metrics — a shared building
// block embedded by many dashboard widgets. It takes a caller-supplied `metrics: ComparisonMetric[]` and a
// `compact?` flag; it fetches nothing. Each `ComparisonMetric` carries a `label`, the raw `current` /
// `previous` numbers, an already-formatted `formattedCurrent` string, an optional `unit` suffix, and an
// optional `higherIsBetter` (default true). The component's real, fully-reproduced render branches are
// exactly the two the web source has:
//   * EMPTY  — when the visible slice is empty (web `visible.length === 0`), a friendly "No comparison
//              data" line (never a blank box), reproduced as [WidgetComparisonCardProjection.Empty];
//   * ROWS   — otherwise, one [ComparisonRow] per visible metric (web `visible.map(MetricRow)`), each a
//              label + formatted value (+ optional unit) on the left and a direction-aware percent delta
//              on the right, reproduced as [WidgetComparisonCardProjection.Rows].
// The `compact` flag slices the list to the first [COMPACT_LIMIT] metrics (web `metrics.slice(0, 2)`); the
// web also adds a `text-sm` wash on the container in compact mode, but every row size below it is set
// explicitly (label `text-xs`, value `text-base`, delta `size="sm"`), so that wash changes nothing visible
// and is intentionally not modelled (Honesty Covenant: no invented behaviour). The per-row delta is the
// web `<Delta metric={{ direction }} display="percent" size="sm">`: only a `direction` is supplied (no
// unit), so [ComparisonMetric.semantic] carries [MetricUnit.Count] (percent display ignores the unit) and
// the `higherIsBetter` flag maps to the delta's good-direction via [ComparisonMetric.direction].
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive is a pure projection of caller-supplied numbers — it is handed finished metrics, so it never
// fetches, never errors, never goes stale and never goes offline. Modelling those would fabricate
// behaviour the web spec does not have (Honesty Covenant: no scope narrowing, no silent drift), exactly as
// the accepted Delta / MetricCard / VisuallyHidden presentational ports document. Its REAL states are the
// empty and rows branches above, both of which always render. The only static copy it owns — the empty
// message — resolves at the render boundary from the shared P1/S10 catalog key whose value is precisely the
// web string ("No comparison data" → `translation_delta_noComparison`); no English literal lives in native
// code and no new catalog key is invented.
//
// `InvalidPackageDeclaration` is suppressed because this primitive's mandated directory
// (com/teslasync/widget-primitives/WidgetComparisonCard — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetcomparisoncard

import io.teslasync.android.components.datadisplay.Direction
import io.teslasync.android.components.datadisplay.MetricSemantic
import io.teslasync.android.components.datadisplay.MetricUnit
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for the WidgetComparisonCard primitive. The diagnostics [SLUG] is emitted
 * with the one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates
 * (`WidgetComparisonCard`).
 */
object WidgetComparisonCardRegistration {
    /** Stable surface id (also the key a host would bind the primitive with). */
    const val ID: String = "widget-comparison-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "WidgetComparisonCard"
}

/** How many metrics the compact form keeps — the native mirror of the web `metrics.slice(0, 2)`. */
private const val COMPACT_LIMIT: Int = 2

/**
 * One comparison row's caller-supplied inputs — the native analogue of the web `ComparisonMetric`.
 *
 * @property label the metric name shown muted above the value (web `label`).
 * @property current the current-period raw value handed to the delta (web `current`).
 * @property previous the previous-period raw value handed to the delta (web `previous`).
 * @property formattedCurrent the already-formatted current value the row paints (web `formattedCurrent`);
 *   the caller converts to display units, so this primitive never touches unit conversion.
 * @property unit the optional small suffix shown after the value, e.g. `mi` / `kWh` (web `unit`).
 * @property higherIsBetter whether a rising value is good — colors the delta (web `higherIsBetter ?? true`).
 */
data class ComparisonMetric(
    val label: String,
    val current: Double,
    val previous: Double,
    val formattedCurrent: String,
    val unit: String? = null,
    val higherIsBetter: Boolean = true,
) {
    /** The delta's good-direction — web `higherIsBetter ? 'higher_better' : 'lower_better'`. */
    val direction: Direction
        get() = if (higherIsBetter) Direction.HigherBetter else Direction.LowerBetter

    /**
     * The metric semantic handed to the embedded delta — the native mirror of the web inline
     * `metric={{ direction }}`. Only the [direction] is meaningful (it colors the delta); the unit is
     * [MetricUnit.Count] because the web supplies none and the percent display never reads it. The [id]
     * carries the label purely for traceability and is unused by the delta math.
     */
    val semantic: MetricSemantic
        get() = MetricSemantic(id = label, direction = direction, unit = MetricUnit.Count)
}

/**
 * The caller-supplied inputs the primitive renders — the native analogue of the web
 * `WidgetComparisonCardProps`. [metrics] is the full list; [compact] keeps only the first [COMPACT_LIMIT].
 */
data class WidgetComparisonCardInput(
    val metrics: List<ComparisonMetric>,
    val compact: Boolean = false,
)

/**
 * One projected row the composable paints — the pure data a [ComparisonMetric] reduces to. Framework-free
 * so every field is asserted in the off-device unit gate; the composable only applies typography and the
 * embedded delta.
 *
 * @property label the muted label line (web `label`).
 * @property formattedCurrent the formatted value text (web `formattedCurrent`).
 * @property unit the optional value suffix (web `unit`); `null` renders no suffix.
 * @property current the current value forwarded to the delta (web `current`).
 * @property previous the previous value forwarded to the delta (web `previous`).
 * @property semantic the delta's metric semantic (web inline `{ direction }`).
 */
data class ComparisonRow(
    val label: String,
    val formattedCurrent: String,
    val unit: String?,
    val current: Double,
    val previous: Double,
    val semantic: MetricSemantic,
) {
    companion object {
        /** Reduces a caller [metric] to the pure row the composable paints. */
        fun from(metric: ComparisonMetric): ComparisonRow =
            ComparisonRow(
                label = metric.label,
                formattedCurrent = metric.formattedCurrent,
                unit = metric.unit,
                current = metric.current,
                previous = metric.previous,
                semantic = metric.semantic,
            )
    }
}

/**
 * The projected render state the primitive paints — the native analogue of the web component's two render
 * branches. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
sealed interface WidgetComparisonCardProjection {
    /** Web `visible.length === 0` → the friendly "No comparison data" line (never a blank box). */
    data object Empty : WidgetComparisonCardProjection

    /** Web non-empty branch → one [ComparisonRow] per visible metric (web `visible.map(MetricRow)`). */
    data class Rows(
        val rows: List<ComparisonRow>,
    ) : WidgetComparisonCardProjection

    companion object {
        /**
         * Projects [input] into the branch the composable paints — the native mirror of the web
         * `visible = compact ? metrics.slice(0, 2) : metrics; visible.length === 0 ? empty : rows`. The
         * compact slice keeps the first [COMPACT_LIMIT] metrics; an empty visible slice is the empty
         * branch; otherwise each visible metric becomes a [ComparisonRow].
         */
        fun project(input: WidgetComparisonCardInput): WidgetComparisonCardProjection {
            val visible = if (input.compact) input.metrics.take(COMPACT_LIMIT) else input.metrics
            return if (visible.isEmpty()) Empty else Rows(visible.map(ComparisonRow::from))
        }
    }
}

/**
 * PII-safe diagnostics for the primitive (P1/S11). Emits only the stable, dot-namespaced `view.opened`
 * event tagged with the surface [WidgetComparisonCardRegistration.SLUG] — never a metric label, value, or
 * comparison, so a diagnostics line can never leak what the card displays. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it once per surface open.
 */
object WidgetComparisonCardDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to WidgetComparisonCardRegistration.SLUG))
    }
}
