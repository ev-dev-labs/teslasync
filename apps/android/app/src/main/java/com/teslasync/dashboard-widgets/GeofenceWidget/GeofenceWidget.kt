// The native Jetpack Compose + Material 3 Geofence Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/GeofenceWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, otherwise a freshness + refresh header — titled with a crosshair icon for the standard
// footprint, bare for the compact footprint) wrapping one of: the compact body (a centered crosshair +
// the current-zone badge or a "No zone" badge), the standard body (an optional inline map with one
// circle per fence tinted by inside/outside + a vehicle marker, over a scrolling fence list whose rows
// show the name, the unit-converted radius, and an Inside / Outside / Disabled badge), or the "No
// geofences configured" empty surface. All data flows through the shared [GeofenceWidgetViewModel]
// (P1/S8); the view never performs HTTP. Every string resolves through the i18n catalog and every
// interactive element (refresh, map, fence rows) carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/GeofenceWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.geofence

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.google.maps.android.compose.Circle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.CameraSnapshot
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.MapDotMarker
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.maps.TeslaMap
import io.teslasync.android.components.maps.rememberMapCameraState
import io.teslasync.android.components.maps.toLatLng
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 3
private const val FILL_ALPHA = 0.15f
private const val RING_ALPHA = 0.3f
private const val WASH_ALPHA = 0.1f
private const val FENCE_STROKE = 2f
private const val MAP_ZOOM = 12f
private val MAP_HEIGHT = 160.dp
private val MAP_MIN_HEIGHT = 120.dp
private val ROW_MIN_HEIGHT = 44.dp

/**
 * Stateful entry point. Binds the cache-then-network geofence feed via [source] into a
 * [GeofenceWidgetViewModel], records the one-shot `view.opened` diagnostic, resolves the live
 * display-unit preference, and renders the surface for the given [size]. A dashboard host supplies
 * [source] (an adapter over the shared S8 Vehicles + Locations data layer) and a unique [instanceKey]
 * per placement.
 *
 * @param source the cache-then-network geofence seam (a [geofenceWidgetSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
public fun GeofenceWidget(
    source: GeofenceWidgetSource,
    modifier: Modifier = Modifier,
    size: GeofenceSize = GeofenceRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = GeofenceRegistration.ID,
) {
    val viewModel: GeofenceWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { GeofenceWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val unitFormatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    GeofenceWidgetContent(
        state = state,
        size = size,
        units = unitFormatter.prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (loading → skeleton) and otherwise the freshness + refresh header over the
 * compact zone body / standard map + fence list / "No geofences configured" empty surface. The web
 * surfaces a fetch error through the header freshness chip + the refresh affordance (it does not pass
 * `WidgetShell`'s `error` prop), so a failed load keeps the best-effort list/empty body visible with the
 * offline chip rather than blanking — reproduced here verbatim.
 */
@Composable
public fun GeofenceWidgetContent(
    state: UiState<GeofenceFeed>,
    size: GeofenceSize,
    units: UnitPref,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberGeofenceStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        else -> {
            val feed = state.data ?: GeofenceFeed.EMPTY
            val display =
                remember(feed, size, units, strings) {
                    GeofenceProjection.project(feed, size, units, strings)
                }
            LoadedChrome(state, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<GeofenceFeed>,
    display: GeofenceDisplay,
    onRefresh: () -> Unit,
    strings: GeofenceStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        GeofenceHeader(state = state, display = display, onRefresh = onRefresh, strings = strings)
        Box(modifier = Modifier.fillMaxSize()) {
            when {
                display.isCompact -> CompactBody(display, strings)
                display.isEmpty -> EmptyBody(display)
                else -> StandardBody(display, strings)
            }
        }
    }
}

@Composable
private fun GeofenceHeader(
    state: UiState<GeofenceFeed>,
    display: GeofenceDisplay,
    onRefresh: () -> Unit,
    strings: GeofenceStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!display.isCompact) {
            Icon(
                MapsGlyphs.Crosshair,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.primary,
            )
            PanelTitle(display.title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

// -- Compact: centered crosshair + current-zone (or "No zone") badge --
@Composable
private fun CompactBody(
    display: GeofenceDisplay,
    strings: GeofenceStrings,
) {
    Column(
        modifier = Modifier.fillMaxSize().heightIn(min = ROW_MIN_HEIGHT).padding(horizontal = Spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            MapsGlyphs.Crosshair,
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.primary,
        )
        val zone = display.currentZoneName
        if (zone != null) {
            Badge(zone, variant = BadgeVariant.Success)
        } else {
            Badge(strings.noZone, variant = BadgeVariant.Neutral)
        }
    }
}

// -- Standard empty: no geofences configured --
@Composable
private fun EmptyBody(display: GeofenceDisplay) {
    EmptyState(
        message = display.noFencesText,
        icon = MapsGlyphs.Crosshair,
        modifier = Modifier.fillMaxWidth(),
    )
}

// -- Standard: optional inline map + scrolling fence list --
@Composable
private fun StandardBody(
    display: GeofenceDisplay,
    strings: GeofenceStrings,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        if (display.showMap) {
            Box(modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT).heightIn(min = MAP_MIN_HEIGHT)) {
                GeofenceMap(display)
            }
        }
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            display.fences.forEach { fence ->
                key(fence.id) { FenceRow(fence, strings) }
            }
        }
    }
}

@Composable
private fun FenceRow(
    fence: FenceStatus,
    strings: GeofenceStrings,
) {
    val shape = RoundedCornerShape(Radius.md)
    val success = TeslaTokens.status.success
    val baseModifier =
        Modifier
            .fillMaxWidth()
            .heightIn(min = ROW_MIN_HEIGHT)
            .clip(shape)
    val rowModifier =
        if (fence.highlighted) {
            baseModifier
                .background(success.copy(alpha = WASH_ALPHA))
                .border(BorderStroke(1.dp, success.copy(alpha = RING_ALPHA)), shape)
        } else {
            baseModifier.background(MaterialTheme.colorScheme.surfaceVariant)
        }
    Row(
        modifier =
            rowModifier
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics { contentDescription = fence.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            BodyText(fence.name, maxLines = 1)
            Caption("${strings.radiusLabel}: ${fence.radiusText}")
        }
        Badge(
            fence.statusLabel,
            variant = badgeVariantFor(fence.status),
            dot = fence.status == FenceStatusKind.Inside,
        )
    }
}

@Composable
private fun GeofenceMap(display: GeofenceDisplay) {
    val center = GeoPoint(display.centerLatitude, display.centerLongitude)
    val camera = rememberMapCameraState(CameraSnapshot(center, MAP_ZOOM))
    val insideColor = TeslaTokens.status.success
    val outsideColor = MaterialTheme.colorScheme.outline
    val markerColor = MaterialTheme.colorScheme.primary
    TeslaMap(
        modifier = Modifier.fillMaxSize(),
        cameraPositionState = camera,
        contentDescription = display.title,
    ) {
        display.fences.forEach { fence ->
            key(fence.id) {
                val tint = if (fence.inside) insideColor else outsideColor
                Circle(
                    center = GeoPoint(fence.latitude, fence.longitude).toLatLng(),
                    radius = fence.radiusMeters,
                    fillColor = tint.copy(alpha = FILL_ALPHA),
                    strokeColor = tint,
                    strokeWidth = FENCE_STROKE,
                )
            }
        }
        MapDotMarker(center, markerColor)
    }
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

/**
 * Map a [FenceStatusKind] to its [Badge] tone — the native analogue of the web badge variants
 * (Inside → success, Disabled / Outside → neutral).
 */
private fun badgeVariantFor(kind: FenceStatusKind): BadgeVariant =
    when (kind) {
        FenceStatusKind.Inside -> BadgeVariant.Success
        FenceStatusKind.Disabled, FenceStatusKind.Outside -> BadgeVariant.Neutral
    }

/**
 * Builds the localized [GeofenceStrings] from the i18n catalog (P1/S10): the title + the
 * no-zone / no-fences / radius / disabled / inside / outside labels, the header
 * refresh/refreshing/offline microcopy, and the `translation_freshness_*`-backed relative-time
 * formatter shared with the freshness chip. Keys mirror the web `t('widget.geofence.*')` calls.
 */
@Composable
private fun rememberGeofenceStrings(): GeofenceStrings {
    val title = stringResource(R.string.translation_widget_geofence_title)
    val noZone = stringResource(R.string.translation_widget_geofence_noZone)
    val noFences = stringResource(R.string.translation_widget_geofence_noFences)
    val radiusLabel = stringResource(R.string.translation_widget_geofence_radius)
    val disabled = stringResource(R.string.translation_widget_geofence_disabled)
    val inside = stringResource(R.string.translation_widget_geofence_inside)
    val outside = stringResource(R.string.translation_widget_geofence_outside)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        noZone,
        noFences,
        radiusLabel,
        disabled,
        inside,
        outside,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        GeofenceStrings(
            title = title,
            noZone = noZone,
            noFences = noFences,
            radiusLabel = radiusLabel,
            disabled = disabled,
            inside = inside,
            outside = outside,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}
