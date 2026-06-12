// The native Jetpack Compose + Material 3 TripPlannerMap feature view — a parity port of
// web/src/features/driving/components/TripPlannerMap.tsx. The web component is purely presentational: its parent
// (the Trip Planner page) holds the form origin/destination and the `usePlanTrip` result and passes `origin`,
// `destination`, `legs`, and `chargeStops` down. From those it draws one fixed-height (400 px) dark Leaflet map
// carrying a blue route polyline (the legs, or a straight origin→destination line), a green origin marker, a red
// destination marker, and a blue marker per charge stop (each with a popup: the endpoint name — or the localized
// "Origin" / "Destination" fallback — and, for a stop, "{from}% → {to}% ({minutes} min)"); when neither endpoint
// is set it shows a friendly "Enter origin and destination to see the route" empty state instead.
//
// The surface binds NO data hook of its own (web parity — the component's only hook is `useTranslation`): the
// Trip Planner page owns the form + plan and threads the trip in as a [TripPlannerMapSnapshot] carried on the
// shared cache-then-network [UiState] (P1/S8), so this view also renders every lifecycle state that layer can
// carry (a loading skeleton, a hard error + retry, the content map, and a stale/offline "last known" freshness
// chip) without ever fetching, exactly like the sibling RouteMapSection port. Every derivation flows through the
// pure [TripPlannerMapProjection]; the composable is a thin render layer that resolves the i18n labels (P1/S10),
// maps the markers to `TeslaTokens` colours (P1/S9), and draws what the projection returns.
//
// Colour mapping (P1/S9 tokens, no ported Tailwind / no raw hex): the green origin marker uses the shared
// `routeStartColor()` (status.success) and the red destination marker uses `routeEndColor()` (status.danger) —
// the semantic start/end pairing the sibling RouteMapSection uses — while the blue route polyline and the blue
// charge-stop markers use `TeslaTokens.chart.speed`, whose value (#3B82F6) is byte-identical to the web
// `#3b82f6`, so all three read correctly in light, dark, and high-contrast themes.
//
// Map rendering: the base map is the shared `TeslaMap` wrapper (dark style, gestures on — the web
// `scrollWheelZoom`), the origin/destination/charge markers are the shared `MapDotMarker`, and the opaque map is
// paired with a `MapAccessibleSummary` list alternative so a screen-reader user gets every endpoint + stop the
// map conveys. The route polyline is drawn with Google Maps Compose `Polyline` directly inside the `TeslaMap`
// content slot — exactly as the sibling RouteMapSection does — because the maps layer ships no polyline wrapper
// and extending `components/maps` is out of this surface's scope (atomic shared components are a separate
// prompt). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TripPlannerMap — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripplannermap

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.google.maps.android.compose.Polyline
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.MapAccessibleSummary
import io.teslasync.android.components.maps.MapDotMarker
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.routeEndColor
import io.teslasync.android.components.maps.routeStartColor
import io.teslasync.android.components.maps.toCameraPosition
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The web `<div className="h-[400px]">` map height, reproduced 1:1. */
private val MAP_HEIGHT: Dp = 400.dp

/** Loading skeleton header-bar height. */
private val SKELETON_HEADER_HEIGHT: Dp = 20.dp

/** Web `weight: 3` Leaflet polyline stroke, in device pixels (scaled for the denser native map). */
private const val ROUTE_WIDTH: Float = 6f

/** Web `opacity: 0.8` polyline alpha. */
private const val ROUTE_ALPHA: Float = 0.8f

/** Relative-time em dash shown when no freshness stamp is available. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point — the faithful port of the web `TripPlannerMap({ origin, destination, legs, chargeStops })`.
 * Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition and renders every lifecycle
 * [state] the shared trip feed can carry. The host (the Trip Planner page) owns the form + plan (P1/S8) and
 * supplies [onRetry] (re-run the plan); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [TripPlannerMapSnapshot] the page holds.
 * @param onRetry re-runs the host's plan — wired to the hard-error retry and the stale/offline refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TripPlannerMap(
    state: UiState<TripPlannerMapSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TripPlannerMapDiagnostics.recordViewOpened(logger) }
    TripPlannerMapContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity convenience overload for a host that already holds a [TripPlannerMapSnapshot] (the web `{ origin,
 * destination, legs, chargeStops }` props): projects it onto a content [UiState] and renders. Useful for embedding
 * without the cache-then-network lifecycle plumbing.
 */
@Composable
fun TripPlannerMap(
    snapshot: TripPlannerMapSnapshot,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    TripPlannerMap(
        state = TripPlannerMapProjection.projectUiState(snapshot, isLoading = false),
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Short-circuits to the
 * loading skeleton or the hard-error retry surface; otherwise renders the route map (the freshness header over the
 * polyline + markers, plus the accessible-summary list) or the friendly "Enter origin and destination to see the
 * route" empty state when neither endpoint is set.
 */
@Composable
fun TripPlannerMapContent(
    state: UiState<TripPlannerMapSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberTripPlannerMapStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(kind = state.toQueryErrorKind(), onRetry = onRetry, modifier = modifier)
        else -> {
            val snapshot = state.data
            val display =
                remember(snapshot, strings) {
                    snapshot?.let { TripPlannerMapProjection.project(it, strings) }
                }
            TripPlannerMapPanel(
                state = state,
                display = display,
                strings = strings,
                onRetry = onRetry,
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun TripPlannerMapPanel(
    state: UiState<TripPlannerMapSnapshot>,
    display: TripPlannerMapDisplay?,
    strings: TripPlannerMapStrings,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.None) {
        if (display != null && display.hasData) {
            Column(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
                TripPlannerMapHeader(
                    title = display.routeLabel,
                    fetchedAtMillis = state.fetchedAt,
                    isFetching = state.refreshing,
                    isStale = state.stale,
                    isError = state.hasError,
                    onRefresh = onRetry,
                )
            }
            TripPlannerMapBody(display = display)
            MapAccessibleSummary(
                label = display.routeLabel,
                lines = display.summaryLines,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            )
        } else {
            TripPlannerMapEmpty(message = strings.empty)
        }
    }
}

/**
 * The freshness + refresh header — the native chrome that hosts the state-matrix affordances the web headerless
 * map omits (the web Trip Planner page owns the plan + its error/refresh). Shows the navigation icon + the
 * localized "{origin} → {destination}" route title, the freshness chip (which surfaces the stale / offline
 * state), and the refresh control. `internal` so the title + TalkBack labels are asserted in the UI test without
 * a live base map (which needs Play Services).
 */
@Composable
internal fun TripPlannerMapHeader(
    title: String,
    fetchedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val formatAge = rememberFreshnessFormatter()
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            MapsGlyphs.Navigation,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = fetchedAtMillis?.takeIf { it > 0 },
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

/**
 * The live base map centered on the trip — the native analogue of the web `<MapContainer>`. Carries the blue
 * route polyline (when ≥2 points), the green origin + red destination dots, and a blue dot per charge stop. The
 * camera is seeded at the projected centre/zoom and re-applied whenever they change (the web fixed `center`/`zoom`
 * props). The opaque map node carries the accessible route name. The maps SDK is reached only for the polyline
 * (no shared wrapper exists; see the file header).
 */
@Composable
private fun TripPlannerMapBody(
    display: TripPlannerMapDisplay,
    modifier: Modifier = Modifier,
) {
    val camera = rememberMapCameraState(CameraSnapshot(display.center, display.zoom))
    LaunchedEffect(display.center, display.zoom) {
        camera.position = CameraSnapshot(display.center, display.zoom).toCameraPosition()
    }
    val routeColor = TeslaTokens.chart.speed
    val originColor = routeStartColor()
    val destinationColor = routeEndColor()
    Box(modifier = modifier.fillMaxWidth().height(MAP_HEIGHT)) {
        TeslaMap(
            modifier = Modifier.fillMaxSize().clip(MaterialTheme.shapes.large),
            cameraPositionState = camera,
            contentDescription = display.routeLabel,
        ) {
            if (display.hasRoute) {
                Polyline(
                    points = display.routePoints.map { it.toLatLng() },
                    color = routeColor.copy(alpha = ROUTE_ALPHA),
                    width = ROUTE_WIDTH,
                )
            }
            display.originMarker?.let {
                MapDotMarker(point = it.point, color = originColor, title = it.title)
            }
            display.destinationMarker?.let {
                MapDotMarker(point = it.point, color = destinationColor, title = it.title)
            }
            display.chargeMarkers.forEach { marker ->
                MapDotMarker(point = marker.point, color = routeColor, title = marker.title)
            }
        }
    }
}

@Composable
private fun TripPlannerMapEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().height(MAP_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = message, icon = MapsGlyphs.Map)
    }
}

@Composable
private fun LoadingChrome(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(height = SKELETON_HEADER_HEIGHT, rounded = true)
        Skeleton(height = MAP_HEIGHT, rounded = true)
    }
}

@Composable
private fun ErrorChrome(
    kind: QueryErrorKind,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        QueryError(kind = kind, onRetry = onRetry, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * Builds the localized [TripPlannerMapStrings] from the i18n catalog (P1/S10) — the `t('tripPlanner.map.*')` keys
 * the web component uses (the "Origin" / "Destination" marker fallbacks and the empty-state message).
 */
@Composable
private fun rememberTripPlannerMapStrings(): TripPlannerMapStrings {
    val origin = stringResource(R.string.translation_tripPlanner_map_origin)
    val destination = stringResource(R.string.translation_tripPlanner_map_destination)
    val empty = stringResource(R.string.translation_tripPlanner_map_empty)
    return remember(origin, destination, empty) {
        TripPlannerMapStrings(origin = origin, destination = destination, empty = empty)
    }
}

/**
 * The `translation_freshness_*`-backed relative-time formatter shared with the freshness chip's TalkBack
 * description, so the header microcopy stays localized (ADR-014).
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

@Preview(name = "Loading")
@Composable
private fun PreviewLoading() = PreviewSurface(UiState(UiPhase.Loading))

@Preview(name = "Empty")
@Composable
private fun PreviewEmpty() = PreviewSurface(UiState(UiPhase.Empty))

@Preview(name = "Error")
@Composable
private fun PreviewError() = PreviewSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network))

@Composable
private fun PreviewSurface(state: UiState<TripPlannerMapSnapshot>) {
    TeslaSyncTheme(dynamicColor = false) {
        TripPlannerMapContent(state = state, onRetry = {})
    }
}
