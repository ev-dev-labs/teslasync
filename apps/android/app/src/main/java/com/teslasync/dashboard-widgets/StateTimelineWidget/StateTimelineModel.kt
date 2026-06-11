// Pure, framework-free model + projection for the State Timeline dashboard widget — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/StateTimelineWidget.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The two feeds arrive as raw JSON arrays (`/vehicle-states/summary` `[{state,totalMin,count}]`
// + `/vehicle-states/timeline` unwrapped `transitions`), so this file owns the decode (web optional-chaining
// → null-safe reads), the stacked-bar segment derivation (sum, percent, NO sort — insertion order is kept,
// unlike the FSM donut), the 24h-stripe derivation (sum, percent, drop <0.5%), the duration formatter, and
// the two-feed cache-then-network fold onto the shared UiState surface.
//
// Wire casing: the web `request()` client runs `camelCaseKeys` so a consumer can read either form
// (web/src/api/client.ts L247); the shared S7 layer reads the raw wire, so the decoders below try the
// camelCase keys the web TS interfaces name (`totalMin`/`durationMin`/`startDate`) first and fall back to
// snake_case. Both `/vehicle-states/*` routes are `@deprecated`/404 post Phase-42 (web useAnalytics L106),
// so the error folds into the freshness chip and, when the primary summary feed hard-fails with no cache,
// the hard error surface — exactly as the sibling FSMDistribution widget resolves its removed-endpoint case.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/StateTimelineWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling FSMDistribution/CostBreakdown
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.statetimeline

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/** Em dash shown for a missing state — the web `'—'` summary fallback (`d.state ?? '—'`). */
internal const val EM_DASH: String = "\u2014"

private const val MINUTES_PER_HOUR = 60.0
private const val PERCENT = 100.0

// Percent fraction digits: the standard state-row badge uses `fmtNumber(pct, 1)`, the compact legend uses
// `fmtInt(pct)` (web StateTimelineWidget.tsx L126/L201).
private const val PCT_DECIMALS_ROW = 1
private const val PCT_DECIMALS_LEGEND = 0

// Below this rendered width a stripe slice is dropped (web `if (pct < 0.5) return null`).
private const val STRIPE_MIN_PCT = 0.5

/** Compact legend cap — web `segments.slice(0, 5)`. */
private const val COMPACT_LEGEND_LIMIT = 5

// Raw wire field keys. The web TS interfaces (`StateSummary`/`TimelineEvent`, web/src/types/analytics.ts)
// name camelCase; the Go wire is snake_case. `camelCaseKeys` exposes both to the web, so the decode tries
// the camelCase name first then the snake_case fallback to stay correct whichever the (revived) route emits.
private val FIELD_STATE = listOf("state")
private val FIELD_TOTAL_MIN = listOf("totalMin", "total_min")
private val FIELD_COUNT = listOf("count")
private val FIELD_START_DATE = listOf("startDate", "start_date")
private val FIELD_DURATION_MIN = listOf("durationMin", "duration_min")

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test (stacked bar + legend dots) and [isWide]
 * reproduces `size.cols >= 3` (adds the 24h timeline stripe); a 2-column footprint is the standard
 * stacked-bar + state-row layout.
 */
data class StateTimelineSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact legend instead of the row list. */
    val isCompact: Boolean get() = cols <= 1

    /** True at three or more columns (web `size.cols >= 3`): also render the 24h timeline stripe. */
    val isWide: Boolean get() = cols >= 3
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`state-timeline`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object StateTimelineRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "state-timeline"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "StateTimelineWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = StateTimelineSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = StateTimelineSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = StateTimelineSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: StateTimelineSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: StateTimelineSize): StateTimelineSize =
        StateTimelineSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One decoded `/vehicle-states/summary` row — the `{state, totalMin, count}` the web reads with
 * `d.state ?? '—'`, `d.totalMin ?? 0`, `d.count ?? 0`. [totalMin] is in minutes (the wire unit), so the
 * duration formatter consumes it directly (unlike the FSM ms feed).
 */
data class RawStateSummary(
    val state: String,
    val totalMin: Double,
    val count: Long,
)

/**
 * One decoded `/vehicle-states/timeline` transition — the `{state, startDate, durationMin}` the web maps
 * with `tr.state ?? ''`, `tr.startDate ?? ''`, `tr.durationMin ?? 0` (note the **blank** state fallback,
 * distinct from the summary em-dash). Feeds the wide 24h stripe.
 */
data class RawTransition(
    val state: String,
    val startDate: String,
    val durationMin: Double,
)

/**
 * One stacked-bar slice + state-list row — the native analogue of the web `StateSegment`. Carries the raw
 * [state] (the render layer maps it to a token color), the localized [label], the [pct] (0..100), the
 * carried-through [count] (web parity; not rendered), the formatted [durationText] (`fmtDuration`), and both
 * percent strings the two layouts show: [pctText] (`fmtNumber(pct, 1)%`, the row badge) and [pctLegendText]
 * (`fmtInt(pct)%`, the compact legend). [rowContentDescription]/[legendContentDescription] fold each into a
 * single TalkBack phrase.
 */
data class StateSegment(
    val state: String,
    val label: String,
    val pct: Double,
    val count: Long,
    val durationText: String,
    val pctText: String,
    val pctLegendText: String,
    val rowContentDescription: String,
    val legendContentDescription: String,
)

/**
 * One 24h-timeline stripe slice — the render-ready width-weight [pct] for a transition, its token [state],
 * and the localized [label] used in the stripe's folded a11y phrase. Slices narrower than 0.5% are dropped
 * upstream (web `if (pct < 0.5) return null`).
 */
data class StripeSegment(
    val state: String,
    val label: String,
    val pct: Double,
)

/** The combined raw payloads of the two cache-then-network feeds (web `useStateSummary` + `useTimeline`). */
data class StateTimelineSnapshot(
    val summary: JsonElement?,
    val timeline: JsonElement?,
)

/**
 * Localized labels + the state-label resolver the surface folds into its output. The pure
 * [StateTimelineProjection] reads these so it carries no English microcopy and stays a locale-stable
 * function; the composable builds this from `stringResource`, while tests pass a deterministic instance.
 *
 * [stateLabel] resolves a raw state name to its display label — the web
 * `t('widget.stateTimeline.state.{state}', state)` dynamic key, which (the catalog carries no `state.*`
 * entries) falls back to the raw state name rendered with CSS `capitalize`. The composable supplies a
 * first-letter capitalizer.
 */
data class StateTimelineStrings(
    val title: String,
    val timelineLabel: String,
    val noData: String,
    val hourSuffix: String,
    val minuteSuffix: String,
    val stateLabel: (String) -> String,
    val emDash: String = EM_DASH,
)

/**
 * The fully projected, render-ready view of the state timeline for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the projection
 * is unit-tested without a UI host. Carries the always-shown stacked-bar [segments], the [compactSegments]
 * legend slice, and the wide-only [stripe]; the composable renders the subset its [isCompact]/[isWide]
 * footprint selects.
 */
data class StateTimelineDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val segments: List<StateSegment>,
    val compactSegments: List<StateSegment>,
    val stripe: List<StripeSegment>,
    val showStripe: Boolean,
    val stackedBarContentDescription: String,
    val timelineLabel: String,
    val stripeContentDescription: String,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/vehicle-states/summary` [json] into the rows the web reads as `summaryQuery.data ?? []`
 * (already `safeArray`-guarded by the S7 layer). A non-array input yields an empty list; every array element
 * is mapped with the web's per-field fallbacks (`?? '—'` / `?? 0`), so a partial row degrades rather than
 * being dropped — matching the web `.map` (which keeps malformed rows as em-dash/zero entries).
 */
fun parseStateSummary(json: JsonElement?): List<RawStateSummary> {
    val array = json as? JsonArray ?: return emptyList()
    return array.map { element ->
        val obj = element as? JsonObject
        RawStateSummary(
            state = obj?.stringField(FIELD_STATE) ?: EM_DASH,
            totalMin = obj?.doubleField(FIELD_TOTAL_MIN) ?: 0.0,
            count = obj?.longField(FIELD_COUNT) ?: 0L,
        )
    }
}

/**
 * Decodes the raw `/vehicle-states/timeline` [json] into the transition list the web reads as
 * `timelineQuery.data ?? []` (already unwrapped from `{transitions}` + `safeArray`-guarded by the S7 layer).
 * A non-array input yields an empty list; field fallbacks mirror the web (`state ?? ''`, `startDate ?? ''`,
 * `durationMin ?? 0`) — note the **blank** state fallback, not an em-dash.
 */
fun parseTimeline(json: JsonElement?): List<RawTransition> {
    val array = json as? JsonArray ?: return emptyList()
    return array.map { element ->
        val obj = element as? JsonObject
        RawTransition(
            state = obj?.stringField(FIELD_STATE) ?: "",
            startDate = obj?.stringField(FIELD_START_DATE) ?: "",
            durationMin = obj?.doubleField(FIELD_DURATION_MIN) ?: 0.0,
        )
    }
}

/**
 * Pure projection + two-feed state-fold for the state-timeline surface — the native port of the inline
 * `useMemo` derivations and the merged freshness in `StateTimelineWidget.tsx`. [project] turns a decoded
 * [StateTimelineSnapshot] into the render-ready [StateTimelineDisplay]; [foldState] composes the two
 * cache-then-network feeds (web `useStateSummary` + `useTimeline`) onto the shared [UiState] surface.
 */
object StateTimelineProjection {
    /**
     * Project [snapshot] for [size] using the localized [strings] and [locale]. The stacked-bar segments +
     * the standard state rows + the compact legend all come from the summary feed; the 24h stripe comes from
     * the timeline feed and is only shown when the footprint [StateTimelineSize.isWide] and the stripe has a
     * positive total. [locale] drives the percent grouping.
     */
    fun project(
        snapshot: StateTimelineSnapshot,
        size: StateTimelineSize,
        strings: StateTimelineStrings,
        locale: Locale = Locale.US,
    ): StateTimelineDisplay {
        val segments = buildSegments(parseStateSummary(snapshot.summary), strings, locale)
        val transitions = parseTimeline(snapshot.timeline)
        val stripe = buildStripe(transitions, strings)
        val hasData = segments.isNotEmpty()
        // Web: `isWide && transitions.length > 0 && <TimelineStripe>` where the stripe renders nothing when
        // its total is zero. Gating on the derived stripe (already total/<0.5% filtered) keeps the panel
        // from ever showing a blank stripe box.
        val showStripe = size.isWide && stripe.isNotEmpty()

        return StateTimelineDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasData = hasData,
            segments = segments,
            compactSegments = segments.take(COMPACT_LEGEND_LIMIT),
            stripe = stripe,
            showStripe = showStripe,
            stackedBarContentDescription = stackedBarDescription(segments, strings),
            timelineLabel = strings.timelineLabel,
            stripeContentDescription = stripeDescription(stripe, strings, locale),
            emptyMessage = strings.noData,
        )
    }

    /**
     * Builds the stacked-bar segments from the summary [rows] — the web `buildSegments`: sum the minutes,
     * return empty when the total is zero (drives the empty-state gate, web `hasData = segments.length > 0`),
     * else map each row to `{state, pct, totalMin, count}`. Insertion order is preserved (the web does **not**
     * sort, unlike the FSM donut).
     */
    fun buildSegments(
        rows: List<RawStateSummary>,
        strings: StateTimelineStrings,
        locale: Locale = Locale.US,
    ): List<StateSegment> {
        val total = rows.sumOf { it.totalMin }
        if (total == 0.0) return emptyList()
        return rows.map { row ->
            val pct = row.totalMin / total * PERCENT
            val label = strings.stateLabel(row.state)
            val duration = formatDuration(row.totalMin, strings)
            val pctText = "${ChartFormat.number(pct, PCT_DECIMALS_ROW, locale)}%"
            val pctLegendText = "${ChartFormat.number(pct, PCT_DECIMALS_LEGEND, locale)}%"
            StateSegment(
                state = row.state,
                label = label,
                pct = pct,
                count = row.count,
                durationText = duration,
                pctText = pctText,
                pctLegendText = pctLegendText,
                rowContentDescription = "$label, $duration, $pctText",
                legendContentDescription = "$label $pctLegendText",
            )
        }
    }

    /**
     * Builds the 24h-timeline stripe slices from the [transitions] — the web `TimelineStripe`: sum the
     * durations, return empty when the total is zero (the web returns `null`), else weight each slice by its
     * share and drop slices narrower than 0.5% (web `if (pct < 0.5) return null`). Order is preserved.
     */
    fun buildStripe(
        transitions: List<RawTransition>,
        strings: StateTimelineStrings,
    ): List<StripeSegment> {
        val total = transitions.sumOf { it.durationMin }
        if (total == 0.0) return emptyList()
        return transitions.mapNotNull { tr ->
            val pct = tr.durationMin / total * PERCENT
            if (pct < STRIPE_MIN_PCT) {
                null
            } else {
                StripeSegment(state = tr.state, label = strings.stateLabel(tr.state), pct = pct)
            }
        }
    }

    /**
     * Formats a minute duration as the web `fmtDuration` does: minutes only below one hour (`"{m}m"`),
     * otherwise hours + minutes (`"{h}h {m}m"`). Mirrors the web `Math.floor` hours / `Math.round` minutes
     * exactly. The input is already minutes (the summary wire unit), so no ms conversion is applied.
     */
    fun formatDuration(
        totalMin: Double,
        strings: StateTimelineStrings,
    ): String {
        val hrs = floor(totalMin / MINUTES_PER_HOUR).toLong()
        val mins = (totalMin % MINUTES_PER_HOUR).roundToLong()
        return if (hrs == 0L) {
            "$mins${strings.minuteSuffix}"
        } else {
            "$hrs${strings.hourSuffix} $mins${strings.minuteSuffix}"
        }
    }

    /**
     * Composes the two feeds into the shared [UiState]. The summary feed is primary (it drives the stacked
     * bar + the `hasData` gate), so a summary hard-failure with no cached summary surfaces the error screen,
     * while a still-loading sibling keeps the skeleton — mirroring the web shell precedence
     * (`isLoading = summary || timeline`, then the body). A timeline-only failure folds into the
     * stale/offline chip without blanking the bar. Freshness is merged (max stamp, OR of stale/fetching/
     * error), exactly as the web merges `dataUpdatedAt`/`isFetching`/`isStale`/`isError` across both queries.
     */
    fun foldState(
        summaryRes: Resource<JsonElement>,
        timelineRes: Resource<JsonElement>,
    ): UiState<StateTimelineSnapshot> {
        val summary = present(summaryRes.cached)
        val timeline = present(timelineRes.cached)
        val snapshot = StateTimelineSnapshot(summary, timeline)

        val firstLoading =
            (summaryRes is Resource.Loading && summaryRes.cached == null) ||
                (timelineRes is Resource.Loading && timelineRes.cached == null)

        return when {
            firstLoading -> UiState.loading()
            summaryRes is Resource.Error && summary == null -> errorState(summaryRes)
            else -> contentState(snapshot, summaryRes, timelineRes)
        }
    }

    /** The "no vehicle / no summary" surface (web's disabled `enabled: !!entityId` queries ⇒ empty state). */
    fun emptyState(): UiState<StateTimelineSnapshot> =
        UiState(phase = UiPhase.Empty, data = StateTimelineSnapshot(summary = null, timeline = null))

    private fun stackedBarDescription(
        segments: List<StateSegment>,
        strings: StateTimelineStrings,
    ): String {
        if (segments.isEmpty()) return strings.noData
        val parts = segments.joinToString(", ") { "${it.label} ${it.pctText}" }
        return "${strings.title}: $parts"
    }

    private fun stripeDescription(
        stripe: List<StripeSegment>,
        strings: StateTimelineStrings,
        locale: Locale,
    ): String {
        if (stripe.isEmpty()) return strings.timelineLabel
        val parts =
            stripe.joinToString(", ") {
                val label = it.label.ifBlank { strings.emDash }
                "$label ${ChartFormat.number(it.pct, PCT_DECIMALS_LEGEND, locale)}%"
            }
        return "${strings.timelineLabel}: $parts"
    }

    private fun contentState(
        snapshot: StateTimelineSnapshot,
        summaryRes: Resource<JsonElement>,
        timelineRes: Resource<JsonElement>,
    ): UiState<StateTimelineSnapshot> {
        val hasData = buildHasData(snapshot.summary)
        val anyError = (summaryRes as? Resource.Error<*>) ?: (timelineRes as? Resource.Error<*>)
        return UiState(
            phase = if (hasData) UiPhase.Content else UiPhase.Empty,
            data = snapshot,
            fetchedAt = maxFetchedAt(summaryRes, timelineRes),
            stale = summaryRes.stale || timelineRes.stale || anyError != null,
            refreshing = summaryRes is Resource.Loading || timelineRes is Resource.Loading,
            errorKind = anyError?.let { errorKindOf(it.error) },
            httpStatus = anyError?.let { httpStatusOf(it.error) },
        )
    }

    /** Whether the summary payload yields a positive total (web `segments.length > 0`, i.e. `totalMin > 0`). */
    private fun buildHasData(summary: JsonElement?): Boolean = parseStateSummary(summary).sumOf { it.totalMin } > 0.0

    private fun errorState(res: Resource.Error<*>): UiState<StateTimelineSnapshot> =
        UiState(
            phase = UiPhase.Error,
            fetchedAt = res.fetchedAt,
            stale = res.stale,
            errorKind = errorKindOf(res.error),
            httpStatus = httpStatusOf(res.error),
        )

    private fun maxFetchedAt(
        a: Resource<*>,
        b: Resource<*>,
    ): Long? = maxOf(fetchedAtOf(a), fetchedAtOf(b)).takeIf { it > 0L }

    private fun fetchedAtOf(res: Resource<*>): Long =
        when (res) {
            is Resource.Loading -> res.fetchedAt ?: 0L
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt ?: 0L
        }

    /** A JSON value that is genuinely present (web truthy): non-null and not the JSON `null` literal. */
    private fun present(element: JsonElement?): JsonElement? = element?.takeIf { it !is JsonNull }
}

/** Read the first present JSON number field among [keys] as a Double, or `null` when none is a number. */
private fun JsonObject.doubleField(keys: List<String>): Double? = keys.firstNotNullOfOrNull { (this[it] as? JsonPrimitive)?.doubleOrNull }

/** Read the first present JSON number field among [keys] as a Long, or `null` when none is a number. */
private fun JsonObject.longField(keys: List<String>): Long? = keys.firstNotNullOfOrNull { (this[it] as? JsonPrimitive)?.longOrNull }

/** Read the first present JSON string field among [keys], or `null` when none is a quoted string. */
private fun JsonObject.stringField(keys: List<String>): String? =
    keys.firstNotNullOfOrNull { key -> (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null } }
