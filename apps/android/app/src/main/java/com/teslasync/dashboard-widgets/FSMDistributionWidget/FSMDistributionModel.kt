// Pure, framework-free model + projection for the FSM State Distribution dashboard widget — the native
// analogue of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/FSMDistributionWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The two feeds arrive as raw JSON (`/fsm/stats` state→ms map + `/fsm/transitions`
// paged log), so this file owns the decode (web optional-chaining → null-safe reads), the donut
// derivation (filter >0, percent, sort desc), the duration formatter, and the two-feed cache-then-network
// fold onto the shared UiState surface.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/FSMDistributionWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling CostBreakdown/DrivetrainHealth
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fsmdistribution

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
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
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale
import kotlin.math.floor
import kotlin.math.roundToLong

/** Em dash shown for a missing state / timestamp — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

private const val MILLIS_PER_MINUTE = 60_000.0
private const val MINUTES_PER_HOUR = 60.0
private const val PERCENT = 100.0

// Raw wire field keys (snake_case, served verbatim by the Go handlers — no camelCaseKeys transform in the
// shared layer, so the native reads match the wire contract). Stats: { enabled, stats:{state→ms}, … };
// transitions: { data:[{ id, ts, from_state, to_state, … }], … } (web/src/types/fsm/ui-types.ts).
private const val FIELD_STATS = "stats"
private const val FIELD_DATA = "data"
private const val FIELD_ID = "id"
private const val FIELD_TS = "ts"
private const val FIELD_FROM_STATE = "from_state"
private const val FIELD_TO_STATE = "to_state"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * [isCompact] branch reproduces the web `size.cols <= 1` test that swaps the donut + legend + transitions
 * standard layout for the single current-state hero.
 */
data class FSMDistributionSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): render the compact current-state hero. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/analytics.ts (`fsm-distribution`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object FSMDistributionRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "fsm-distribution"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "analytics"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "FSMDistributionWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = FSMDistributionSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = FSMDistributionSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = FSMDistributionSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: FSMDistributionSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: FSMDistributionSize): FSMDistributionSize =
        FSMDistributionSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One decoded raw transition — the two state names + the timestamp the web `TransitionRow` reads from
 * each `/fsm/transitions` `data` entry (`tr.from_state ?? '—'`, `tr.to_state ?? '—'`, `tr.ts ?? ''`),
 * keyed by `tr.id`. The relative-time label is derived later (it needs the wall clock), so only the raw
 * ISO [ts] is kept here.
 */
data class RawFSMTransition(
    val id: Long,
    val fromState: String,
    val toState: String,
    val ts: String,
)

/**
 * One donut ring segment + legend row — the native analogue of the web `DonutSegment`. Carries the raw
 * [state] (the render layer maps it to a token color), the localized [label], the SI [valueMs] (time in
 * state, the arc sweep weight), the [pct] (0..100), and the already-formatted [pctText] the legend shows.
 */
data class FSMSegment(
    val state: String,
    val label: String,
    val valueMs: Double,
    val pct: Double,
    val pctText: String,
)

/**
 * One projected, render-ready transition feed row — the resolved [fromLabel]/[toLabel] (capitalized), the
 * [relativeTime] label, and a TalkBack [contentDescription] folding the transition + age into one phrase.
 */
data class FSMTransitionRow(
    val id: Long,
    val fromState: String,
    val toState: String,
    val fromLabel: String,
    val toLabel: String,
    val relativeTime: String,
    val contentDescription: String,
)

/** The combined raw payloads of the two cache-then-network feeds (web `useFSMStats` + `useFSMTransitions`). */
data class FSMDistributionSnapshot(
    val stats: JsonElement?,
    val transitions: JsonElement?,
)

/**
 * Localized labels + the relative-time + state-label resolvers the surface folds into its output. The
 * pure [FSMDistributionProjection] reads these so it carries no English microcopy and stays a
 * locale-stable function; the composable builds this from `stringResource`, while tests pass a
 * deterministic instance.
 *
 * [stateLabel] resolves a raw FSM state name to its display label — the web `t('widget.fsmDistribution.
 * state.{state}', state)` dynamic key, which (the catalog carries no `state.*` entries) falls back to the
 * raw state name rendered with CSS `capitalize`. The composable supplies a first-letter capitalizer.
 * [formatRelative] maps a coarse [FreshnessAge] bucket to the localized `translation_freshness_*` string,
 * shared with the freshness chip.
 */
data class FSMDistributionStrings(
    val title: String,
    val recentTransitions: String,
    val noData: String,
    val hourSuffix: String,
    val minuteSuffix: String,
    val stateLabel: (String) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * The fully projected, render-ready view of the FSM distribution for one footprint — the native analogue
 * of everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. Carries both the compact-hero fields and the standard-layout
 * fields; the composable renders one set per [FSMDistributionSize.isCompact].
 */
data class FSMDistributionDisplay(
    val isCompact: Boolean,
    val hasData: Boolean,
    val segments: List<FSMSegment>,
    val transitions: List<FSMTransitionRow>,
    val currentState: String,
    val currentStateLabel: String,
    val currentDuration: String,
    val donutContentDescription: String,
    val compactContentDescription: String,
    val recentTransitionsLabel: String,
    val emptyMessage: String,
)

/**
 * Decodes the raw `/fsm/stats` [json] into the state→milliseconds map the web reads as
 * `statsQuery.data?.stats ?? {}`. A non-object input, a missing `stats` object, or non-numeric values all
 * collapse to an empty / skipped entry, reproducing the web optional-chaining. Insertion order is
 * preserved (the donut sort is applied later).
 */
fun parseFSMStats(json: JsonElement?): Map<String, Double> {
    val statsObj = (json as? JsonObject)?.get(FIELD_STATS) as? JsonObject ?: return emptyMap()
    val out = LinkedHashMap<String, Double>(statsObj.size)
    for ((state, element) in statsObj) {
        val value = (element as? JsonPrimitive)?.doubleOrNull ?: continue
        out[state] = value
    }
    return out
}

/**
 * Decodes the raw `/fsm/transitions` [json] into the transition list the web reads as
 * `transitionsQuery.data?.data ?? []`. A non-object input or a missing `data` array yields an empty list;
 * a malformed element is skipped rather than throwing. Field fallbacks mirror the web
 * (`from_state ?? '—'`, `to_state ?? '—'`, `ts ?? ''`).
 */
fun parseFSMTransitions(json: JsonElement?): List<RawFSMTransition> {
    val array = (json as? JsonObject)?.get(FIELD_DATA) as? JsonArray ?: return emptyList()
    return array.mapIndexedNotNull { index, element ->
        val obj = element as? JsonObject ?: return@mapIndexedNotNull null
        RawFSMTransition(
            id = obj.longField(FIELD_ID) ?: index.toLong(),
            fromState = obj.stringField(FIELD_FROM_STATE) ?: EM_DASH,
            toState = obj.stringField(FIELD_TO_STATE) ?: EM_DASH,
            ts = obj.stringField(FIELD_TS) ?: "",
        )
    }
}

/**
 * Pure projection + two-feed state-fold for the FSM distribution surface — the native port of the inline
 * `useMemo` derivations and the merged freshness in `FSMDistributionWidget.tsx`. [project] turns a decoded
 * [FSMDistributionSnapshot] into the render-ready [FSMDistributionDisplay]; [foldState] composes the two
 * cache-then-network feeds (web `useFSMStats` + `useFSMTransitions`) onto the shared [UiState] surface.
 */
object FSMDistributionProjection {
    /** Web compact transitions slice (`slice(0, isCompact ? 3 : 5)`). */
    const val COMPACT_TRANSITIONS = 3

    /** Web standard transitions slice. */
    const val STANDARD_TRANSITIONS = 5

    /** Percent shown in the legend with no fraction digits (web `fmtInt(seg.pct)`). */
    private const val PCT_DECIMALS = 0

    /**
     * Project [snapshot] for [size] at [nowMillis] using the localized [strings] and [locale]. The donut
     * segments + the current-state hero come from the stats map; the transitions feed (sliced 3/5 by
     * footprint) comes from the transitions list. [nowMillis] drives the relative-time tiers (injected so
     * tests are deterministic); [locale] drives the percent grouping.
     */
    fun project(
        snapshot: FSMDistributionSnapshot,
        size: FSMDistributionSize,
        strings: FSMDistributionStrings,
        nowMillis: Long,
        locale: Locale = Locale.US,
    ): FSMDistributionDisplay {
        val segments = buildSegments(parseFSMStats(snapshot.stats), strings, locale)
        val rawTransitions = parseFSMTransitions(snapshot.transitions)
        val sliceCount = if (size.isCompact) COMPACT_TRANSITIONS else STANDARD_TRANSITIONS
        val transitions =
            rawTransitions.take(sliceCount).map { projectTransition(it, strings, nowMillis) }

        val hasData = segments.isNotEmpty()
        val current = segments.firstOrNull()
        val currentState = current?.state ?: EM_DASH
        val currentStateLabel = current?.label ?: EM_DASH
        val currentDuration = formatDuration(current?.valueMs ?: 0.0, strings)

        return FSMDistributionDisplay(
            isCompact = size.isCompact,
            hasData = hasData,
            segments = segments,
            transitions = transitions,
            currentState = currentState,
            currentStateLabel = currentStateLabel,
            currentDuration = currentDuration,
            donutContentDescription = donutDescription(segments, strings),
            compactContentDescription = if (hasData) "$currentStateLabel, $currentDuration" else strings.noData,
            recentTransitionsLabel = strings.recentTransitions,
            emptyMessage = strings.noData,
        )
    }

    /**
     * Builds the donut segments from a state→ms [stats] map — the web `buildDonutData`: keep only positive
     * entries, compute the total, map to `{state, value, pct}`, and sort descending by value. Returns an
     * empty list when the total is zero (drives the empty-state gate, web `hasData = segments.length > 0`).
     */
    fun buildSegments(
        stats: Map<String, Double>,
        strings: FSMDistributionStrings,
        locale: Locale = Locale.US,
    ): List<FSMSegment> {
        val positive = stats.filterValues { it > 0.0 }
        val total = positive.values.sum()
        if (total <= 0.0) return emptyList()
        val segments =
            positive.map { (state, value) ->
                val pct = value / total * PERCENT
                FSMSegment(
                    state = state,
                    label = strings.stateLabel(state),
                    valueMs = value,
                    pct = pct,
                    pctText = "${ChartFormat.number(pct, PCT_DECIMALS, locale)}%",
                )
            }
        return segments.sortedByDescending { it.valueMs }
    }

    /**
     * Formats a millisecond duration as the web `fmtDuration` does: minutes only below one hour
     * (`"{m}m"`), otherwise hours + minutes (`"{h}h {m}m"`). Mirrors the web `Math.floor` hours /
     * `Math.round` minutes exactly.
     */
    fun formatDuration(
        ms: Double,
        strings: FSMDistributionStrings,
    ): String {
        val totalMin = ms / MILLIS_PER_MINUTE
        val hrs = floor(totalMin / MINUTES_PER_HOUR).toLong()
        val mins = (totalMin % MINUTES_PER_HOUR).roundToLong()
        return if (hrs == 0L) {
            "$mins${strings.minuteSuffix}"
        } else {
            "$hrs${strings.hourSuffix} $mins${strings.minuteSuffix}"
        }
    }

    /**
     * Composes the two feeds into the shared [UiState]. The stats feed is primary (it drives the donut +
     * the `hasData` gate), so a stats hard-failure with no cached stats surfaces the error screen, while a
     * still-loading sibling keeps the skeleton — mirroring the web shell precedence
     * (`isLoading = stats || transitions`, then the body). A transitions-only failure folds into the
     * stale/offline chip without blanking the donut. Freshness is merged (max stamp, OR of stale/fetching).
     */
    fun foldState(
        statsRes: Resource<JsonElement>,
        transitionsRes: Resource<JsonElement>,
    ): UiState<FSMDistributionSnapshot> {
        val stats = present(statsRes.cached)
        val transitions = present(transitionsRes.cached)
        val snapshot = FSMDistributionSnapshot(stats, transitions)

        val firstLoading =
            (statsRes is Resource.Loading && statsRes.cached == null) ||
                (transitionsRes is Resource.Loading && transitionsRes.cached == null)

        return when {
            firstLoading -> UiState.loading()
            statsRes is Resource.Error && stats == null -> errorState(statsRes)
            else -> contentState(snapshot, statsRes, transitionsRes)
        }
    }

    /** The "no vehicle / no stats" surface (web's disabled `enabled: !!entityId` queries ⇒ empty state). */
    fun emptyState(): UiState<FSMDistributionSnapshot> =
        UiState(phase = UiPhase.Empty, data = FSMDistributionSnapshot(stats = null, transitions = null))

    private fun projectTransition(
        raw: RawFSMTransition,
        strings: FSMDistributionStrings,
        nowMillis: Long,
    ): FSMTransitionRow {
        val fromLabel = strings.stateLabel(raw.fromState)
        val toLabel = strings.stateLabel(raw.toState)
        val relative = strings.formatRelative(relativeAge(computeAgeSeconds(parseEpochMillis(raw.ts), nowMillis)))
        return FSMTransitionRow(
            id = raw.id,
            fromState = raw.fromState,
            toState = raw.toState,
            fromLabel = fromLabel,
            toLabel = toLabel,
            relativeTime = relative,
            contentDescription = "$fromLabel $EM_DASH $toLabel, $relative",
        )
    }

    private fun donutDescription(
        segments: List<FSMSegment>,
        strings: FSMDistributionStrings,
    ): String {
        if (segments.isEmpty()) return strings.noData
        val parts = segments.joinToString(", ") { "${it.label} ${it.pctText}" }
        return "${strings.title}: $parts"
    }

    private fun contentState(
        snapshot: FSMDistributionSnapshot,
        statsRes: Resource<JsonElement>,
        transitionsRes: Resource<JsonElement>,
    ): UiState<FSMDistributionSnapshot> {
        val hasData = buildHasData(snapshot.stats)
        val anyError = (statsRes as? Resource.Error<*>) ?: (transitionsRes as? Resource.Error<*>)
        return UiState(
            phase = if (hasData) UiPhase.Content else UiPhase.Empty,
            data = snapshot,
            fetchedAt = maxFetchedAt(statsRes, transitionsRes),
            stale = statsRes.stale || transitionsRes.stale || anyError != null,
            refreshing = statsRes is Resource.Loading || transitionsRes is Resource.Loading,
            errorKind = anyError?.let { errorKindOf(it.error) },
            httpStatus = anyError?.let { httpStatusOf(it.error) },
        )
    }

    /** Whether the stats payload yields at least one positive-time segment (web `segments.length > 0`). */
    private fun buildHasData(stats: JsonElement?): Boolean = parseFSMStats(stats).values.any { it > 0.0 }

    private fun errorState(res: Resource.Error<*>): UiState<FSMDistributionSnapshot> =
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

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses on
 * demand). Returns `null` for a blank/absent or unparseable value so a partial row resolves to an em-dash
 * relative time rather than throwing.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

/** Read a JSON number field as a Long, or `null` when absent / JSON `null` / not a number. */
private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string. */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
