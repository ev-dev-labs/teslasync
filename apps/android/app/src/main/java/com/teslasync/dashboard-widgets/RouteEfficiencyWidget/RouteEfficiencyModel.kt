// Pure, framework-free model + projection for the Route Efficiency dashboard widget — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/RouteEfficiencyWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The `/analytics/route-efficiency` feed arrives as raw SI JSON
// (snake_case on the wire — the native shared layer serves the document verbatim, no camelCaseKeys), so
// this file owns the decode, the per-route efficiency ranking the web `WidgetRankedList` performs, and
// the display-boundary Wh/km→Wh/mi conversion (Phase-48 SI-canonical rule; web `useUnits`). Values stay
// SI until this projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/RouteEfficiencyWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier),
// so the package intentionally diverges from the path — exactly as the sibling OdometerCounter/DriveScore
// widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.routeefficiency

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.errorKindOf
import io.teslasync.android.data.httpStatusOf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.util.Locale

/** Em dash shown for a missing start/end location — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * `RouteEfficiencyWidget` reads `size.cols` to pick the compact (`<= 1`, number-only list, no title) vs
 * expanded vs wide (`>= 3`, per-row best/worst suffix) layout, so this type carries the same axes the
 * registry constrains.
 */
data class RouteEfficiencySize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/driving.ts (`route-efficiency`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object RouteEfficiencyRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "route-efficiency"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "driving"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RouteEfficiencyWidget"

    /** Rows shown in the compact list (web `WidgetRankedList` `compact ? 3`). */
    const val COMPACT_LIMIT: Int = 3

    /** Rows shown in the expanded list (web `WidgetRankedList` default `: 5`). */
    const val EXPANDED_LIMIT: Int = 5

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize: RouteEfficiencySize = RouteEfficiencySize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows (web `minSize`). */
    val minSize: RouteEfficiencySize = RouteEfficiencySize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize: RouteEfficiencySize = RouteEfficiencySize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: RouteEfficiencySize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: RouteEfficiencySize): RouteEfficiencySize =
        RouteEfficiencySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )

    /** True when [size] selects the compact (number-only, no title, bars hidden) layout — web `size.cols <= 1`. */
    fun isCompact(size: RouteEfficiencySize): Boolean = size.cols <= 1

    /** True when [size] appends the per-row best/worst breakdown — web `size.cols >= 3`. */
    fun isWide(size: RouteEfficiencySize): Boolean = size.cols >= 3

    /** Visible-row cap for [size] (web `maxItems ?? (compact ? 3 : 5)`). */
    fun rowLimit(size: RouteEfficiencySize): Int = if (isCompact(size)) COMPACT_LIMIT else EXPANDED_LIMIT
}

/**
 * Localized labels the surface folds into its output (web `t('widget.routeEfficiency.*')` calls). The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 */
data class RouteEfficiencyStrings(
    val title: String,
    val excellent: String,
    val good: String,
    val fair: String,
    val poor: String,
    val best: String,
    val worst: String,
    val noData: String,
)

/** The badge accent the web `efficiencyBadge` chooses; mapped to the Compose `BadgeVariant` in the view. */
enum class RouteBadgeVariant { Success, Warning, Error }

/**
 * One decoded route from the `/analytics/route-efficiency` `routes[]` array, kept at the raw SI values
 * the web component reads off each `RouteSummary` before formatting. [avgEfficiencyWhKm] is nullable to
 * reproduce the web's two different fallbacks for the same field (`?? 0` for the displayed value but
 * `?? Infinity` when computing the "best" route), so a route with no average never claims the best slot.
 */
data class RouteSummaryRaw(
    val startLocation: String?,
    val endLocation: String?,
    val tripCount: Int,
    val avgEfficiencyWhKm: Double?,
    val bestEfficiencyWhKm: Double,
    val worstEfficiencyWhKm: Double,
)

/**
 * The decoded payload the widget renders: the list of recurring [routes]. An empty list is the web
 * `routes.length > 0 ? <WidgetRankedList> : <EmptyState>` gate (the friendly "No route data" state).
 */
data class RouteEfficiencySnapshot(
    val routes: List<RouteSummaryRaw>,
)

/**
 * A fully projected, render-ready ranked row — the native analogue of the web `RankedItem` the component
 * builds for `WidgetRankedList`. Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property id stable row key (the route's original index).
 * @property label the "start → end" route label, with the wide best/worst suffix when applicable.
 * @property formattedValue the "{eff} {unit} · {trips}×" trailing figure (web `formattedValue`).
 * @property badgeText the localized efficiency-band chip text (web `badge.text`).
 * @property badgeVariant the chip accent (web `badge.variant`).
 * @property value the inverted rank weight (lower Wh ⇒ higher value ⇒ ranks first; web `value`).
 * @property barFraction the background-bar width as a 0..1 fraction of the visible max (web `barPct/100`).
 * @property isBest whether this route has the fleet-best (lowest) average efficiency (web `isBest`).
 */
data class RankedRouteItem(
    val id: Int,
    val label: String,
    val formattedValue: String,
    val badgeText: String,
    val badgeVariant: RouteBadgeVariant,
    val value: Double,
    val barFraction: Double,
    val isBest: Boolean,
)

/**
 * The render-ready ranked list — the visible, sorted, limited [items] plus whether the background bars
 * are drawn ([showBars] is false in the compact layout, exactly as the web `hideBars = compact`).
 */
data class RankedRouteList(
    val items: List<RankedRouteItem>,
    val showBars: Boolean,
)

/**
 * Pure projection + state-fold for the Route Efficiency surface — the native port of the inline data
 * derivation in `RouteEfficiencyWidget.tsx`. [parseRoutes] decodes the raw feed; [foldState] composes the
 * single `useRouteEfficiency` cache-then-network feed onto the shared [UiState]; [project] turns a decoded
 * [RouteEfficiencySnapshot] into the ranked [RankedRouteList] for a given footprint + unit preference.
 */
object RouteEfficiencyProjection {
    /** Web `1.609344` — Wh/km × this = Wh/mi (a mile is 1.609344 km). */
    const val KM_PER_MILE: Double = 1.609344

    /** Web inversion scale: `value = 10000 / eff` so a lower Wh/unit sorts first. */
    const val VALUE_SCALE: Double = 10_000.0

    /** Web `rawWhPerMi <= 250` — the "Excellent" upper bound (applied to the raw Wh/km average). */
    const val EXCELLENT_MAX: Double = 250.0

    /** Web `rawWhPerMi <= 325` — the "Good" upper bound. */
    const val GOOD_MAX: Double = 325.0

    /** Web `rawWhPerMi <= 400` — the "Fair" upper bound (above it is "Poor"). */
    const val FAIR_MAX: Double = 400.0

    /** Web `fmtNumber(value, 0)` / `fmtInt` — efficiency + trip counts render as whole numbers. */
    private const val WHOLE_NUMBER_DECIMALS: Int = 0

    private const val FIELD_ROUTES: String = "routes"
    private const val FIELD_START: String = "start_location"
    private const val FIELD_END: String = "end_location"
    private const val FIELD_TRIPS: String = "trip_count"
    private const val FIELD_AVG: String = "avg_efficiency"
    private const val FIELD_BEST: String = "best_efficiency"
    private const val FIELD_WORST: String = "worst_efficiency"

    /**
     * Decodes the raw `/analytics/route-efficiency` [json] (SI, snake_case on the wire) into the route
     * list. A non-object input, a missing/`null` `routes` field, or a non-array value collapses to an
     * empty list (web `data?.routes ?? []`); each element is read null-safely so a malformed row never
     * throws. `avg_efficiency` stays nullable (web reads it both as `?? 0` and `?? Infinity`); the other
     * numerics default to 0 and the locations stay nullable for the em-dash fallback.
     */
    fun parseRoutes(json: JsonElement?): List<RouteSummaryRaw> {
        val arr = (json?.takeIf { it !is JsonNull } as? JsonObject)?.get(FIELD_ROUTES) as? JsonArray ?: return emptyList()
        return arr.mapNotNull { element ->
            (element as? JsonObject)?.let { row ->
                RouteSummaryRaw(
                    startLocation = row.stringOrNull(FIELD_START),
                    endLocation = row.stringOrNull(FIELD_END),
                    tripCount = row.intOrZero(FIELD_TRIPS),
                    avgEfficiencyWhKm = row.doubleOrNull(FIELD_AVG),
                    bestEfficiencyWhKm = row.doubleOrZero(FIELD_BEST),
                    worstEfficiencyWhKm = row.doubleOrZero(FIELD_WORST),
                )
            }
        }
    }

    /**
     * Folds the single `useRouteEfficiency` feed ([res]) onto one lifecycle-aware [UiState]. Mirrors the
     * web shell precedence loading → error → content: a first load with nothing cached renders the
     * skeleton; a hard failure with nothing cached renders the error surface; otherwise the content/empty
     * surface is chosen by whether any route decoded (web `routes.length > 0`).
     *
     * Divergence (non-silent — ADR-013 honest freshness): where the web `WidgetShell` blanks to its error
     * surface on any error, this keeps a cached snapshot visible as the stale "offline / last known"
     * branch (error + cache) and only shows the hard error surface when there is nothing cached to keep —
     * so the surface honours both the spec's mandated `offline` state and its `error` state.
     */
    fun foldState(res: Resource<JsonElement>): UiState<RouteEfficiencySnapshot> {
        val cached = res.cached
        return when {
            res is Resource.Loading && cached == null -> UiState.loading()
            res is Resource.Error && cached == null -> errorState(res)
            else -> contentState(RouteEfficiencySnapshot(parseRoutes(cached)), res)
        }
    }

    /** The "no vehicle resolved" surface (web's disabled query ⇒ no routes ⇒ friendly empty state). */
    fun emptyState(): UiState<RouteEfficiencySnapshot> = UiState(phase = UiPhase.Empty, data = RouteEfficiencySnapshot(emptyList()))

    /**
     * Projects [snapshot] into the ranked render model for [size], using the user's [prefs] (distance
     * unit selects the Wh/km↔Wh/mi conversion + the `Wh/{unit}` label) and localized [strings]. Reproduces
     * the web `useMemo` row build + the `WidgetRankedList` sort/slice: rows are sorted by descending
     * inverted [RankedRouteItem.value] (most efficient first) and limited to the footprint's row cap, then
     * each visible row's background-bar fraction is taken against the visible maximum. [locale] drives the
     * grouping/separators (tests pin [Locale.US] to match the web en-US `fmtNumber`).
     */
    fun project(
        snapshot: RouteEfficiencySnapshot,
        prefs: UnitPref,
        strings: RouteEfficiencyStrings,
        size: RouteEfficiencySize,
        locale: Locale = Locale.US,
    ): RankedRouteList {
        val routes = snapshot.routes
        val isWide = RouteEfficiencyRegistration.isWide(size)
        val bestRaw = routes.minOfOrNull { it.avgEfficiencyWhKm ?: Double.POSITIVE_INFINITY } ?: Double.POSITIVE_INFINITY

        val context = RowContext(prefs = prefs, strings = strings, isWide = isWide, bestRaw = bestRaw, locale = locale)
        val all = routes.mapIndexed { index, route -> buildItem(index, route, context) }
        val visible = all.sortedByDescending { it.value }.take(RouteEfficiencyRegistration.rowLimit(size))
        val maxValue = visible.maxOfOrNull { it.value } ?: 0.0
        val withBars = visible.map { it.copy(barFraction = if (maxValue > 0.0) it.value / maxValue else 0.0) }
        return RankedRouteList(items = withBars, showBars = !RouteEfficiencyRegistration.isCompact(size))
    }

    /**
     * Converts the SI efficiency to the user's distance unit (web `toEfficiencyDisplay`): Wh/km stays
     * as-is for kilometres (and feet), or is multiplied by 1.609344 for miles (Wh per km × km per mile =
     * Wh/mi). Only the miles preference scales, exactly as the web ternary does.
     */
    fun toEfficiencyDisplay(
        efficiencyWhKm: Double,
        unit: DistanceUnitPref,
    ): Double = if (unit == DistanceUnitPref.MI) efficiencyWhKm * KM_PER_MILE else efficiencyWhKm

    /** The efficiency unit symbol for [unit]: `Wh/mi` for miles, else `Wh/km` (web `efficiencyUnit`). */
    fun efficiencyUnit(unit: DistanceUnitPref): String = if (unit == DistanceUnitPref.MI) "Wh/mi" else "Wh/km"

    /**
     * Picks the efficiency-band chip for the raw Wh/km average, reproducing the web `efficiencyBadge`
     * thresholds verbatim (the bands are evaluated on the SI value, not the converted display value, since
     * the web calls `efficiencyBadge(rawEff, t)`).
     */
    fun badgeFor(
        rawWhKm: Double,
        strings: RouteEfficiencyStrings,
    ): Pair<String, RouteBadgeVariant> =
        when {
            rawWhKm <= EXCELLENT_MAX -> strings.excellent to RouteBadgeVariant.Success
            rawWhKm <= GOOD_MAX -> strings.good to RouteBadgeVariant.Success
            rawWhKm <= FAIR_MAX -> strings.fair to RouteBadgeVariant.Warning
            else -> strings.poor to RouteBadgeVariant.Error
        }

    /** Per-render context shared across the row builders — the once-resolved unit + prefs + i18n + best-of bound. */
    private data class RowContext(
        val prefs: UnitPref,
        val strings: RouteEfficiencyStrings,
        val isWide: Boolean,
        val bestRaw: Double,
        val locale: Locale,
    )

    private fun buildItem(
        index: Int,
        route: RouteSummaryRaw,
        context: RowContext,
    ): RankedRouteItem {
        val rawEff = route.avgEfficiencyWhKm ?: 0.0
        val eff = toEfficiencyDisplay(rawEff, context.prefs.distance)
        val isBest = rawEff == context.bestRaw && rawEff > 0.0
        val (badgeText, badgeVariant) = badgeFor(rawEff, context.strings)
        return RankedRouteItem(
            id = index,
            label = label(route, context),
            formattedValue = formattedValue(eff, efficiencyUnit(context.prefs.distance), route.tripCount, context.locale),
            badgeText = badgeText,
            badgeVariant = badgeVariant,
            value = if (eff > 0.0) VALUE_SCALE / eff else 0.0,
            barFraction = 0.0,
            isBest = isBest,
        )
    }

    private fun label(
        route: RouteSummaryRaw,
        context: RowContext,
    ): String {
        val base = "${route.startLocation ?: EM_DASH} \u2192 ${route.endLocation ?: EM_DASH}"
        if (!context.isWide) return base
        val unit = efficiencyUnit(context.prefs.distance)
        val bestEff = displayEff(route.bestEfficiencyWhKm, context)
        val worstEff = displayEff(route.worstEfficiencyWhKm, context)
        return "$base  \u00B7  ${context.strings.best} $bestEff / ${context.strings.worst} $worstEff $unit"
    }

    /** Converts then formats an SI Wh/km efficiency for display in [context]'s unit (web `fmtNumber(toEfficiencyDisplay(v), 0)`). */
    private fun displayEff(
        efficiencyWhKm: Double,
        context: RowContext,
    ): String = ChartFormat.number(toEfficiencyDisplay(efficiencyWhKm, context.prefs.distance), WHOLE_NUMBER_DECIMALS, context.locale)

    private fun formattedValue(
        eff: Double,
        unit: String,
        tripCount: Int,
        locale: Locale,
    ): String {
        val effText = ChartFormat.number(eff, WHOLE_NUMBER_DECIMALS, locale)
        val tripText = ChartFormat.number(tripCount * 1.0, WHOLE_NUMBER_DECIMALS, locale)
        return "$effText $unit \u00B7 $tripText\u00D7"
    }

    private fun contentState(
        snapshot: RouteEfficiencySnapshot,
        res: Resource<JsonElement>,
    ): UiState<RouteEfficiencySnapshot> {
        val error = res as? Resource.Error<*>
        return UiState(
            phase = if (snapshot.routes.isEmpty()) UiPhase.Empty else UiPhase.Content,
            data = snapshot,
            fetchedAt = fetchedAtOf(res).takeIf { it > 0L },
            stale = res.stale || error != null,
            refreshing = res is Resource.Loading,
            errorKind = error?.let { errorKindOf(it.error) },
            httpStatus = error?.let { httpStatusOf(it.error) },
        )
    }

    private fun errorState(res: Resource.Error<*>): UiState<RouteEfficiencySnapshot> =
        UiState(
            phase = UiPhase.Error,
            fetchedAt = res.fetchedAt,
            stale = res.stale,
            errorKind = errorKindOf(res.error),
            httpStatus = httpStatusOf(res.error),
        )

    private fun fetchedAtOf(res: Resource<*>): Long =
        when (res) {
            is Resource.Loading -> res.fetchedAt ?: 0L
            is Resource.Success -> res.fetchedAt
            is Resource.Error -> res.fetchedAt ?: 0L
        }

    private fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.intOrZero(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

    private fun JsonObject.doubleOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

    private fun JsonObject.doubleOrZero(key: String): Double = doubleOrNull(key) ?: 0.0
}
