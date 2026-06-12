// Pure, framework-free model + projection for the ChargingBreakdownSlide feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// ChargingBreakdownSlide is a presentational "year in review" slide — the web component takes its `data`
// (a `YearReview`) as a prop from the review carousel that owns the TanStack query, so this surface binds no
// data hook of its own (its only data source is `useTranslation`). As in the sibling AchievementBadge /
// SentryModeChart ports, the cache-then-network lifecycle (loading / error / stale / offline) is supplied by
// the owning carousel through the shared P1/S8 state-holder layer as a [UiState]; the composable renders
// every state that layer can carry without ever fetching. This pure file owns the parts the web render
// derives from `data`: the filtered donut segments (web `chartData = items.filter(d => d.value > 0)`), the
// rounded average start-SOC (web `Math.round(data.avg_charge_start_soc)`), and the per-segment sweep
// fractions the donut (web `<Pie dataKey="value">`) draws.
//
// The web `COLORS` are assigned by FILTERED position, not by charging source
// (`chartData.map((_, i) => COLORS[i % COLORS.length])`), so the composable colors each segment by its index
// in [ChargingBreakdownDisplay.segments] — this file preserves that exact order (Supercharger, then DC Fast,
// then AC / Other) so the positional palette stays faithful.
//
// [ChargingBreakdownData] mirrors the subset of the web `YearReview` interface this slide reads, with
// snake_case wire names via @SerialName and every field defaulted, so it decodes straight off the cached
// year-review JSON (a decoder must ignore unknown keys — the rest of `YearReview` is not this slide's
// concern).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ChargingBreakdownSlide — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling SentryModeChart / AchievementBadge
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingbreakdownslide

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/** Em dash shown for an absent relative-age stamp in the freshness chip — the composable's Unknown branch. */
internal const val EM_DASH: String = "\u2014"

/**
 * The subset of the web `YearReview` payload this slide renders — the native mirror of the five fields the
 * web component reads from its `data` prop
 * (web/src/features/analytics/components/review/ChargingBreakdownSlide.tsx). snake_case wire names are kept
 * via @SerialName and every field defaults so a partial or still-loading payload decodes without error (the
 * year-review endpoint carries many more columns; the decoder must ignore the unknown ones).
 *
 * @property totalChargeSessions the headline count (web `data.total_charge_sessions`).
 * @property superchargerPct the Supercharger share, already a 0–100 percentage (web `data.supercharger_pct`).
 * @property dcFastPct the DC-fast share, 0–100 (web `data.dc_fast_pct`).
 * @property acOtherPct the AC / other share, 0–100 (web `data.ac_other_pct`).
 * @property avgChargeStartSoc the average plug-in battery percentage (web `data.avg_charge_start_soc`).
 */
@Serializable
data class ChargingBreakdownData(
    @SerialName("total_charge_sessions") val totalChargeSessions: Long = 0L,
    @SerialName("supercharger_pct") val superchargerPct: Double = 0.0,
    @SerialName("dc_fast_pct") val dcFastPct: Double = 0.0,
    @SerialName("ac_other_pct") val acOtherPct: Double = 0.0,
    @SerialName("avg_charge_start_soc") val avgChargeStartSoc: Double = 0.0,
)

/**
 * A charging-source category — the native analogue of the web `chartData` rows. The declared order
 * (Supercharger, DC Fast, AC / Other) is the exact order the web `items` array is built in before filtering,
 * which the composable relies on so the FILTERED-index positional palette matches the web `COLORS` mapping.
 */
enum class ChargingSource {
    Supercharger,
    DcFast,
    AcOther,
}

/**
 * One donut slice — a charging [source], its raw percentage [value] (web `d.value`, the basis of the pie's
 * proportional sweep), and the [percent] integer the legend renders (web `Math.round(item.value)`). Pure
 * data so the projection is unit-tested without a UI host; the localized label and the positional color are
 * resolved at the Compose boundary.
 */
data class ChargingSegment(
    val source: ChargingSource,
    val value: Double,
    val percent: Int,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property totalChargeSessions the headline count (web `data.total_charge_sessions`).
 * @property avgStartSocPercent the rounded average plug-in SOC (web `Math.round(data.avg_charge_start_soc)`),
 *   fed to the "Average plug-in at {soc}% battery" subtext.
 * @property segments the donut slices that survived the web `value > 0` filter, in fixed source order; the
 *   composable colors them by list index to mirror the web positional `COLORS` mapping.
 */
data class ChargingBreakdownDisplay(
    val totalChargeSessions: Long,
    val avgStartSocPercent: Int,
    val segments: List<ChargingSegment>,
) {
    /**
     * True when there is no charging story to tell — no sessions and no positive breakdown share. The
     * composable renders the friendly empty state in this case so the slide is never a blank surface
     * (the owning carousel also drives its own [io.teslasync.android.data.UiPhase.Empty] for a hard "no
     * year-review data" result).
     */
    val isEmpty: Boolean get() = totalChargeSessions <= 0L && segments.isEmpty()
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — the four
 * `yearReview.*` labels the web component resolves via `t(...)`: the three donut/legend source names and the
 * "charge sessions" headline noun. The "Average plug-in at {soc}% battery" subtext template and the
 * lifecycle-chrome strings (empty / error / retry / offline / freshness) are resolved inline at the Compose
 * boundary, not here, so this holder stays a thin content carrier.
 */
data class ChargingBreakdownStrings(
    val supercharger: String,
    val dcFast: String,
    val acOther: String,
    val chargeSessions: String,
) {
    /** The localized label for a [source] — the web `t('yearReview.supercharger' | 'dcFast' | 'acOther')`. */
    fun label(source: ChargingSource): String =
        when (source) {
            ChargingSource.Supercharger -> supercharger
            ChargingSource.DcFast -> dcFast
            ChargingSource.AcOther -> acOther
        }
}

/**
 * Pure projection from a [ChargingBreakdownData] to its render-ready [ChargingBreakdownDisplay] — a 1:1 port
 * of the derivations the web component performs (`chartData` filter, the rounded SOC, and the per-segment
 * percentages) before returning JSX. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate.
 */
object ChargingBreakdownProjection {
    /** Select the render-ready view for [data], filtering out zero/empty shares exactly as the web does. */
    fun project(data: ChargingBreakdownData): ChargingBreakdownDisplay {
        val segments =
            buildList {
                addSegment(ChargingSource.Supercharger, data.superchargerPct)
                addSegment(ChargingSource.DcFast, data.dcFastPct)
                addSegment(ChargingSource.AcOther, data.acOtherPct)
            }
        return ChargingBreakdownDisplay(
            totalChargeSessions = data.totalChargeSessions,
            avgStartSocPercent = roundPercent(data.avgChargeStartSoc),
            segments = segments,
        )
    }

    // Web `items.filter((d) => d.value > 0)`: a share is only charted when strictly positive.
    private fun MutableList<ChargingSegment>.addSegment(
        source: ChargingSource,
        value: Double,
    ) {
        if (value.isFinite() && value > 0.0) {
            add(ChargingSegment(source = source, value = value, percent = roundPercent(value)))
        }
    }

    /**
     * The integer percentage the web renders, `Math.round(value)`. Kotlin's [roundToInt] rounds halves
     * towards positive infinity, matching JavaScript's `Math.round`; a non-finite input folds to 0 so a
     * malformed payload never crashes the slide.
     */
    fun roundPercent(value: Double): Int = if (value.isFinite()) value.roundToInt() else 0

    /**
     * The proportional sweep fraction (0–1) of each segment — the native analogue of how the web `<Pie>`
     * sizes each cell by its `value` relative to the slice total. Returns all-zero fractions when the total
     * is non-positive (an all-zero breakdown is filtered out upstream, so this is only a divide-by-zero
     * guard). The fractions sum to 1 for any positive total, so the donut closes the full ring.
     */
    fun sweepFractions(segments: List<ChargingSegment>): List<Double> {
        val total = segments.sumOf { it.value }
        if (total <= 0.0) return List(segments.size) { 0.0 }
        return segments.map { it.value / total }
    }

    /**
     * Render the headline count the way the web `{data.total_charge_sessions}` does — React renders a numeric
     * child as its bare, locale-independent string (e.g. `147`, never grouped), so this is a faithful
     * `toString` rather than a grouped format.
     */
    fun formatSessionCount(count: Long): String = count.toString()

    /**
     * The legend / accessibility text for one slice — the web `{item.name} ({Math.round(item.value)}%)`. The
     * localized source [name] is injected (resolved at the Compose boundary) so this stays pure and testable.
     */
    fun legendLabel(
        name: String,
        percent: Int,
    ): String = "$name ($percent%)"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * session count, the charging mix, or the plug-in SOC — so a diagnostics line can never leak a user's
 * charging habits.
 */
object ChargingBreakdownSlideDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "charging-breakdown-slide"

    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ChargingBreakdownSlide"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
