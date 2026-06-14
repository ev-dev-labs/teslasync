// Pure, framework-free model + projection for the Dashboard Stats meta-widget — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DashboardStatsWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a "meta" system
// widget that composes four reads — `useDashboardStats` (the vehicle-independent fleet summary; THE primary
// feed that drives `hasData`), `useVehicleStateMachine` (the current FSM `state`), `useStateTimeline` (the
// `@deprecated`/404 state-duration timeline, unwrapped to its `transitions`), and `useVehicles` (only to
// resolve the default vehicle — web `vehicleId ?? vehicles?.[0]?.id`). It renders one of three bodies by
// footprint: compact (cols<=1 → the big trip count + "active"), standard (the four-tile stat grid + the
// "Current State" status badge), and wide (cols>=3 → also the up-to-five "Recent Transitions"). The shell's
// freshness merges all three queries (max stamp, OR of fetching/stale/error); loading is `stats || fsm`
// (NOT timeline); and there is no hard-error surface — a failed query only tints the freshness chip while
// the body keeps showing content or the empty state.
//
// Wire casing: the web `request()` client runs `camelCaseKeys` so a consumer can read either form
// (web/src/api/client.ts); the shared S7 layer reads the raw wire, so the decoders below try the camelCase
// keys the web TS interfaces name (`startedAt`) first and fall back to snake_case. Both the FSM-state and
// timeline reads arrive as raw JSON (`/vehicles/{id}/state` object + `/vehicle-states/timeline` `{transitions}`
// object), so this file owns the null-safe decode (web optional-chaining → `?? '—'` / `?? []`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DashboardStatsWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling StateTimelineWidget / WatchSummaryWidget
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.dashboardstats

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.time.Instant

/** Em dash shown for a missing value — the web `'—'` fallback (`fsm.data?.state ?? '—'`, `tr.state ?? '—'`). */
internal const val EM_DASH: String = "\u2014"

private const val MILLIS_PER_SECOND = 1_000L
private const val SECONDS_PER_MINUTE = 60L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
private const val DAYS_PER_WEEK = 7L

/** Wide footprint caps the recent-transition list (web `transitions.slice(0, 5)`). */
private const val RECENT_TRANSITIONS_LIMIT = 5

/** Footprint thresholds — the web `size.cols <= 1` (compact) and `size.cols >= 3` (wide) tests. */
private const val COMPACT_MAX_COLS = 1
private const val WIDE_MIN_COLS = 3

/** Absolute-date pattern for transitions older than a week — the web `formatRelative` ⇒ `formatDate` fallback. */
private const val ABSOLUTE_DATE_PATTERN = "MMM d, yyyy"

/** The `{transitions:[…]}` envelope key the admin timeline read returns (web `timeline.data?.transitions`). */
private const val FIELD_TRANSITIONS = "transitions"

private val FIELD_STATE = listOf("state")
private val FIELD_STARTED_AT = listOf("startedAt", "started_at")

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. [isCompact]
 * reproduces the web `size.cols <= 1` branch (the single big trip count) and [isWide] reproduces
 * `size.cols >= 3` (adds the recent-transition list); a 2-column footprint is the standard stat-grid layout.
 */
data class DashboardStatsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at one column or narrower (web `isCompact = size.cols <= 1`). */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): also render recent transitions. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS
}

/**
 * Canonical registry metadata for the Dashboard Stats surface — the native mirror of the web registry entry
 * in web/src/features/dashboard/widgets/registry/system.ts (`dashboard-stats`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint, so the native + web
 * grids stay in lockstep.
 */
object DashboardStatsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "dashboard-stats"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DashboardStatsWidget"

    /** Default footprint: 2 columns × 2 rows (web `defaultSize`). */
    val DEFAULT_SIZE: DashboardStatsSize = DashboardStatsSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val MIN_SIZE: DashboardStatsSize = DashboardStatsSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val MAX_SIZE: DashboardStatsSize = DashboardStatsSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: DashboardStatsSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DashboardStatsSize): DashboardStatsSize =
        DashboardStatsSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * One decoded `/vehicle-states/timeline` transition the web reads as `{state, startedAt}` (`tr.state ?? '—'`,
 * `tr.startedAt`). [startedAtMillis] is the parsed epoch-millisecond stamp, or `null` when the field is blank
 * or unparseable so the render shows the em dash (web `tr.startedAt ? formatRelative(...) : '—'`).
 */
data class RawTransition(
    val state: String,
    val startedAtMillis: Long?,
)

/**
 * The three reads the web component folds into its render envelope (the fourth, `useVehicles`, only resolves
 * the default vehicle and never reaches the body). [dashStats] is the primary fleet summary (web `stats.data`;
 * `null` ⇒ the empty surface); [fsmState] is the current FSM state (web `fsm.data?.state ?? '—'`); [transitions]
 * is the unwrapped, decoded timeline list (web `timeline.data?.transitions ?? []`).
 */
data class DashboardStatsSnapshot(
    val dashStats: DashboardStats?,
    val fsmState: String,
    val transitions: List<RawTransition>,
)

/**
 * The fsm + timeline reads the view-model resolves for the active vehicle, folded into one combine envelope —
 * `null` for either feed means the web query was disabled (`enabled: !!idStr`, i.e. no vehicle resolved), in
 * which case it contributes nothing to loading / freshness / error and the value degrades to its em-dash /
 * empty fallback. The primary [DashboardStats] feed is independent of a vehicle and is combined separately.
 */
data class FsmTimeline(
    val fsm: Resource<JsonElement>?,
    val timeline: Resource<JsonElement>?,
) {
    companion object {
        /** Both reads disabled — the web `enabled: !!idStr` gate with no resolved vehicle. */
        val DISABLED: FsmTimeline = FsmTimeline(fsm = null, timeline = null)
    }
}

/**
 * Localized microcopy the surface folds into its projection. The pure [DashboardStatsProjection] reads these
 * so it carries no English literals and stays locale-stable; the composable builds this from `stringResource`,
 * while tests pass a deterministic instance. [minutesAgo]/[hoursAgo]/[daysAgo] are `%1$s`-style format strings
 * (the shared `translation_freshness_*` catalog entries, which match the web `formatRelative` `Xm/Xh/Xd ago`).
 */
data class DashboardStatsStrings(
    val title: String,
    val vehicles: String,
    val trips: String,
    val sessions: String,
    val fsmState: String,
    val active: String,
    val currentState: String,
    val recentTransitions: String,
    val noData: String,
    val justNow: String,
    val minutesAgo: String,
    val hoursAgo: String,
    val daysAgo: String,
    val emDash: String = EM_DASH,
)

/** One stat-grid tile — the web `StatGridItem` `{label, value}` (a pre-formatted display value). */
data class DashboardStatTile(
    val label: String,
    val value: String,
)

/**
 * One rendered "Recent Transitions" row — the capitalized state [label] (web `Badge` + CSS `capitalize`), the
 * relative-age [timeText] (web `formatRelative(tr.startedAt)`), and the folded TalkBack [contentDescription].
 */
data class RecentTransitionItem(
    val label: String,
    val timeText: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the surface for one footprint — the native analogue of everything
 * `DashboardStatsWidget.tsx` derives before returning JSX. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host; the composable renders the subset its [isCompact]/[isWide] footprint selects.
 *
 * @property hasData whether the primary fleet summary resolved (web `hasData = stats.data != null`); when false
 *   the body renders the empty state.
 * @property statTiles the four standard-footprint tiles (web `statItems`): Vehicles, Trips, Charge Sessions, FSM State.
 * @property compactValue the single big number shown on the compact footprint (web `fmtInt(totalTrips)`).
 * @property fsmState the current FSM state shown raw in the stat grid + via the status badge (web `fsmState`).
 * @property recentTransitions the up-to-five wide-only transition rows (empty unless [isWide], web `recentTransitions`).
 */
data class DashboardStatsDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val hasData: Boolean,
    val statTiles: List<DashboardStatTile>,
    val compactValue: String,
    val compactLabel: String,
    val compactContentDescription: String,
    val fsmState: String,
    val currentStateLabel: String,
    val currentStateContentDescription: String,
    val recentTransitionsLabel: String,
    val recentTransitions: List<RecentTransitionItem>,
    val emptyMessage: String,
)

/**
 * Pure projection + three-feed state-fold for the Dashboard Stats surface — the native port of the inline
 * `useMemo` derivations and the merged freshness in `DashboardStatsWidget.tsx`. [project] turns a decoded
 * [DashboardStatsSnapshot] into the render-ready [DashboardStatsDisplay]; [foldState] composes the primary
 * stats feed with the (optional) fsm + timeline feeds onto the shared [UiState] surface.
 */
object DashboardStatsProjection {
    /**
     * Project [snapshot] for [size] using the localized [strings], [nowMillis] (for relative ages), and
     * [locale] (number + date grouping). The four stat tiles + the compact number + the status badge come
     * from the primary feed; the recent-transition list comes from the timeline feed and is only built when
     * the footprint [DashboardStatsSize.isWide].
     */
    fun project(
        snapshot: DashboardStatsSnapshot,
        size: DashboardStatsSize,
        strings: DashboardStatsStrings,
        nowMillis: Long = System.currentTimeMillis(),
        locale: Locale = Locale.getDefault(),
    ): DashboardStatsDisplay {
        val stats = snapshot.dashStats
        val tripsText = fmtInt((stats?.totalTrips ?: 0).toLong(), locale)
        val tiles =
            listOf(
                DashboardStatTile(strings.vehicles, fmtInt((stats?.totalVehicles ?: 0).toLong(), locale)),
                DashboardStatTile(strings.trips, tripsText),
                DashboardStatTile(strings.sessions, fmtInt((stats?.totalChargingSessions ?: 0).toLong(), locale)),
                DashboardStatTile(strings.fsmState, snapshot.fsmState),
            )
        val recent =
            if (size.isWide) {
                snapshot.transitions.take(RECENT_TRANSITIONS_LIMIT).map { tr ->
                    val label = capitalize(tr.state, strings.emDash)
                    val time = formatRelative(tr.startedAtMillis, nowMillis, strings, locale)
                    RecentTransitionItem(label = label, timeText = time, contentDescription = "$label, $time")
                }
            } else {
                emptyList()
            }
        return DashboardStatsDisplay(
            isCompact = size.isCompact,
            isWide = size.isWide,
            hasData = stats != null,
            statTiles = tiles,
            compactValue = tripsText,
            compactLabel = strings.active,
            compactContentDescription = "$tripsText ${strings.active}",
            fsmState = snapshot.fsmState,
            currentStateLabel = strings.currentState,
            currentStateContentDescription = "${strings.currentState}, ${snapshot.fsmState}",
            recentTransitionsLabel = strings.recentTransitions,
            recentTransitions = recent,
            emptyMessage = strings.noData,
        )
    }

    /**
     * Composes the three feeds onto the shared [UiState]. The fleet-summary [statsRes] is primary (it drives
     * the `hasData` gate, web `stats.data != null`); the [fsm] + [timeline] reads are optional (`null` when the
     * web query is disabled with no resolved vehicle). Loading follows the web precedence
     * `isLoading = stats.isLoading || fsm.isLoading` (the timeline is intentionally excluded). There is no
     * hard-error surface — a failed query only sets the freshness error flags; the body still shows content
     * (or the empty state) exactly as the web shell does. Freshness is merged (max stamp, OR of stale /
     * fetching / error), mirroring the web `Math.max(dataUpdatedAt…)` + the `||`-folded `isFetching`/`isStale`/
     * `isError`.
     */
    fun foldState(
        statsRes: Resource<DashboardStats>,
        fsm: Resource<JsonElement>?,
        timeline: Resource<JsonElement>?,
    ): UiState<DashboardStatsSnapshot> {
        val dashStats = statsRes.cached
        val snapshot =
            DashboardStatsSnapshot(
                dashStats = dashStats,
                fsmState = parseFsmState(fsm?.cached),
                transitions = parseTransitions(timeline?.cached),
            )

        if (isFirstLoad(statsRes) || (fsm != null && isFirstLoad(fsm))) return UiState.loading()

        val anyError = firstError(statsRes, fsm, timeline)
        return UiState(
            phase = if (dashStats != null) UiPhase.Content else UiPhase.Empty,
            data = snapshot,
            fetchedAt = mergedFetchedAt(statsRes, fsm, timeline),
            stale = statsRes.stale || (fsm?.stale ?: false) || (timeline?.stale ?: false),
            refreshing = isFetching(statsRes) || isFetching(fsm) || isFetching(timeline),
            errorKind = anyError?.let { errorKindOf(it.error) },
            httpStatus = anyError?.let { httpStatusOf(it.error) },
        )
    }

    /** Decode the FSM `state` from the `/vehicles/{id}/state` object (web `fsm.data?.state ?? '—'`). */
    fun parseFsmState(json: JsonElement?): String {
        val obj = json as? JsonObject ?: return EM_DASH
        return obj.stringField(FIELD_STATE) ?: EM_DASH
    }

    /**
     * Decode the `/vehicle-states/timeline` `{transitions:[…]}` object into the transition list the web reads
     * as `timeline.data?.transitions ?? []`. A non-object input (or absent/non-array `transitions`) yields an
     * empty list; per-row fallbacks mirror the web (`state ?? '—'`, `startedAt` parsed or `null`).
     */
    fun parseTransitions(json: JsonElement?): List<RawTransition> {
        val array = (json as? JsonObject)?.get(FIELD_TRANSITIONS) as? JsonArray ?: return emptyList()
        return array.map { element ->
            val row = element as? JsonObject
            RawTransition(
                state = row?.stringField(FIELD_STATE) ?: EM_DASH,
                startedAtMillis = parseInstantMillis(row?.stringField(FIELD_STARTED_AT)),
            )
        }
    }

    /**
     * Render a transition's age relative to [nowMillis] exactly as the web `formatRelative` does: a `null`
     * stamp is the em dash; under a minute is `justNow`; under an hour / day / week is `Xm/Xh/Xd ago`; beyond a
     * week it falls back to the absolute date (web `formatDate`, `MMM d, yyyy`).
     */
    fun formatRelative(
        startedAtMillis: Long?,
        nowMillis: Long,
        strings: DashboardStatsStrings,
        locale: Locale = Locale.getDefault(),
    ): String {
        val started = startedAtMillis ?: return strings.emDash
        val seconds = (nowMillis - started) / MILLIS_PER_SECOND
        val minutes = seconds / SECONDS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        val days = hours / HOURS_PER_DAY
        return when {
            seconds < SECONDS_PER_MINUTE -> strings.justNow
            minutes < MINUTES_PER_HOUR -> strings.minutesAgo.format(minutes)
            hours < HOURS_PER_DAY -> strings.hoursAgo.format(hours)
            days < DAYS_PER_WEEK -> strings.daysAgo.format(days)
            else -> SimpleDateFormat(ABSOLUTE_DATE_PATTERN, locale).format(Date(started))
        }
    }

    /** Locale-grouped integer — the web `fmtInt` (`fmtNumber(v, 0)`, e.g. `12,345`). */
    fun fmtInt(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = NumberFormat.getIntegerInstance(locale).format(value)

    /** Parse an RFC-3339 stamp to epoch millis, or `null` when blank/unparseable (web `new Date(iso)` guard). */
    fun parseInstantMillis(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        return runCatching { Instant.parse(value).toEpochMilliseconds() }.getOrNull()
    }

    private fun capitalize(
        value: String,
        emDash: String,
    ): String {
        if (value.isBlank()) return emDash
        return value.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
    }

    private fun isFirstLoad(res: Resource<*>): Boolean = res is Resource.Loading && res.cached == null

    private fun isFetching(res: Resource<*>?): Boolean = res is Resource.Loading

    private fun firstError(vararg res: Resource<*>?): Resource.Error<*>? = res.firstNotNullOfOrNull { it as? Resource.Error<*> }

    private fun mergedFetchedAt(vararg res: Resource<*>?): Long? = res.maxOf { fetchedAtOf(it) }.takeIf { it > 0L }

    private fun fetchedAtOf(res: Resource<*>?): Long =
        when (res) {
            null -> 0L
            is Resource.Loading -> res.fetchedAt ?: 0L
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt ?: 0L
        }

    private fun JsonObject.stringField(keys: List<String>): String? =
        keys.firstNotNullOfOrNull { key -> (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null } }
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant
 * surface [SLUG] — never a stat value, FSM state, or transition — so observability can never leak vehicle
 * state. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object DashboardStatsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = DashboardStatsRegistration.SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
