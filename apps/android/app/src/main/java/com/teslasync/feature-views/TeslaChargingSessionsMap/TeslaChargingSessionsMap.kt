// The native Jetpack Compose + Material 3 TeslaChargingSessionsMap feature view — a parity port of
// web/src/features/charging/pages/TeslaChargingSessionsMap.tsx. The web component is purely presentational:
// its parent (the Fleet Charging Sessions page) calls `useTeslaChargingSessions` and passes the rows down,
// and the component renders one fixed-height map (`MapContainer` + `MapTileLayer`) centered on the average
// of the sessions' coordinates, carrying a clustered marker per session that has a coordinate — each with a
// popup (site name, local start time, energy added, total cost, charger type) and an accessible label —
// under the map's `aria-label` "Charging sessions map".
//
// The native surface keeps that contract and binds the data itself through the shared state-holder layer
// (P1/S8): `useTeslaChargingSessions` → [ChargingSessionsSource] via [TeslaChargingSessionsMapViewModel],
// and `useFormatting` → the currency symbol read from the shared settings store. Because it binds a feed,
// it also renders every lifecycle state that layer can carry — a loading skeleton, a hard error with retry,
// content, and stale/offline ("last known") — so no surface is ever a blank box. Every derivation flows
// through the pure [TeslaChargingSessionsMapProjection]; the composable is a thin render layer that resolves
// the i18n labels (P1/S10) and the design-token chrome (P1/S9) and draws what they return. The base map is
// the shared `TeslaMap` wrapper and the markers are the shared `MarkerClusterLayer` (the web Leaflet
// `MarkerCluster`), so the surface never imports the maps SDK directly; the opaque map is paired with a
// `MapAccessibleSummary` list alternative so a screen-reader user gets everything the map conveys. The
// one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TeslaChargingSessionsMap — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslachargingsessionsmap

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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
import io.teslasync.android.components.maps.MapMarker
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.MarkerClusterLayer
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toCameraPosition
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
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

/** The web `<div className="h-[350px]">` map height, reproduced 1:1. */
private val MAP_HEIGHT: Dp = 350.dp

/** Loading skeleton header-bar height. */
private val SKELETON_HEADER_HEIGHT: Dp = 20.dp

/**
 * Stateful entry point. Binds the cache-then-network sessions feed via [source] into a
 * [TeslaChargingSessionsMapViewModel], resolves the user's currency symbol from the shared settings store
 * (web `useFormatting`, P1/S8), records the one-shot `view.opened` diagnostic, and renders the surface. A
 * host supplies [source] (a [ChargingStoreSessionsSource] over the shared Charging store) and a unique
 * [instanceKey] per placement.
 *
 * @param source the cache-then-network sessions seam (a [ChargingStoreSessionsSource] adapter in production).
 * @param settings the shared `/settings` document feed; its `currency_symbol` formats the cost detail.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TeslaChargingSessionsMap(
    source: ChargingSessionsSource,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TeslaChargingSessionsMapDiagnostics.SLUG,
) {
    val viewModel: TeslaChargingSessionsMapViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { TeslaChargingSessionsMapViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val settingsResource by settings.collectAsStateWithLifecycle()
    val currency = remember(settingsResource) { ChargingSessionsCurrencyPrefs.fromSettings(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]

    TeslaChargingSessionsMapContent(
        state = state,
        currency = currency,
        locale = locale,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Short-circuits to a
 * loading skeleton or a hard-error retry surface, otherwise renders the freshness + refresh header over the
 * clustered map (or the "No location data available yet." empty surface when nothing can be plotted), with
 * the accessible-summary list alternative beneath the map.
 */
@Composable
fun TeslaChargingSessionsMapContent(
    state: UiState<List<TeslaChargingSession>>,
    currency: ChargingSessionsCurrencyPrefs,
    locale: Locale,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberChargingSessionsMapStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(kind = state.toQueryErrorKind(), onRetry = onRefresh, modifier = modifier)
        else -> {
            val sessions = state.data ?: emptyList()
            val display =
                remember(sessions, currency, locale, strings) {
                    TeslaChargingSessionsMapProjection.project(sessions, strings, currency, locale)
                }
            LoadedChrome(state = state, display = display, onRefresh = onRefresh, modifier = modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<TeslaChargingSession>>,
    display: ChargingSessionsMapDisplay,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ChargingSessionsMapHeader(
            title = display.mapLabel,
            fetchedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        if (display.hasMarkers) {
            ChargingSessionsMapView(display = display, modifier = Modifier.fillMaxWidth())
            MapAccessibleSummary(
                label = display.mapLabel,
                lines = display.summaryLines,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            ChargingSessionsMapEmpty(message = display.noDataText, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * The freshness + refresh header — the native chrome that hosts the state-matrix affordances the web
 * `aria-label`-only map omits. Shows the map icon + the localized "Charging sessions map" title, the
 * freshness chip (which surfaces the stale / offline state), and the refresh control. Split out as
 * `internal` so the title + TalkBack labels are asserted in the UI test without a live base map (which
 * needs Play Services).
 */
@Composable
internal fun ChargingSessionsMapHeader(
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
            MapsGlyphs.Map,
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
 * The live base map centered on the sessions' centroid, carrying the clustered session markers — the
 * native analogue of the web `<MapContainer>` + `<MarkerCluster>`. The camera is seeded at the center and
 * re-centered whenever it or the zoom changes (the web `center` follow); the markers are clustered for the
 * current camera zoom (the web `maxClusterRadius`). The opaque map node carries the accessible name so
 * TalkBack announces the surface. The maps SDK is reached only through the shared `TeslaMap` +
 * `MarkerClusterLayer` wrappers.
 */
@Composable
private fun ChargingSessionsMapView(
    display: ChargingSessionsMapDisplay,
    modifier: Modifier = Modifier,
) {
    val cameraState = rememberMapCameraState(CameraSnapshot(display.center, display.zoom))
    LaunchedEffect(display.center, display.zoom) {
        cameraState.position = CameraSnapshot(display.center, display.zoom).toCameraPosition()
    }
    val markers =
        remember(display.markers) {
            display.markers.map { marker ->
                MapMarker(
                    id = marker.id,
                    point = marker.point,
                    title = marker.title,
                    snippet = marker.snippet.ifEmpty { null },
                )
            }
        }
    TeslaMap(
        modifier = modifier.fillMaxWidth().height(MAP_HEIGHT).clip(MaterialTheme.shapes.large),
        cameraPositionState = cameraState,
        contentDescription = display.mapContentDescription,
    ) {
        MarkerClusterLayer(
            markers = markers,
            zoom = cameraState.position.zoom.toDouble(), // parity:allow Kotlin stdlib Float-to-Double conversion
        )
    }
}

@Composable
private fun ChargingSessionsMapEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        Box(
            modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT),
            contentAlignment = Alignment.Center,
        ) {
            EmptyState(message = message, icon = MapsGlyphs.Map)
        }
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
 * Builds the localized [ChargingSessionsMapStrings] from the i18n catalog (P1/S10): the "Charging sessions
 * map" label, the "Unknown" site-name fallback, the "{{name}} charging session" marker label, and the "No
 * location data available yet." empty message — the `t('tesla_sessions.*')` keys the web component uses.
 */
@Composable
private fun rememberChargingSessionsMapStrings(): ChargingSessionsMapStrings {
    val mapLabel = stringResource(R.string.translation_tesla_sessions_mapLabel)
    val unknown = stringResource(R.string.translation_tesla_sessions_unknown)
    val markerTemplate = stringResource(R.string.translation_tesla_sessions_markerLabel)
    val noData = stringResource(R.string.translation_tesla_sessions_noMapData)
    return remember(mapLabel, unknown, markerTemplate, noData) {
        ChargingSessionsMapStrings(
            mapLabel = mapLabel,
            unknown = unknown,
            markerLabel = { name -> markerTemplate.format(name) },
            noData = noData,
        )
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
private fun PreviewEmpty() = PreviewSurface(UiState(UiPhase.Empty, data = emptyList()))

@Preview(name = "Error")
@Composable
private fun PreviewError() = PreviewSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network))

@Composable
private fun PreviewSurface(state: UiState<List<TeslaChargingSession>>) {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaChargingSessionsMapContent(
            state = state,
            currency = ChargingSessionsCurrencyPrefs.DEFAULT,
            locale = Locale.US,
            onRefresh = {},
        )
    }
}
