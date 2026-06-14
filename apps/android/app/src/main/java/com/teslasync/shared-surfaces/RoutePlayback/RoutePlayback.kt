// The native Jetpack Compose + Material 3 RoutePlayback shared surface — a parity port of
// web/src/components/maps/RoutePlayback.tsx. The web surface is the self-contained route-replay widget: an
// interactive map drawing the GPS trail polyline, start/end dots, a heading-aware animated marker at the
// scrub cursor, a floating layer switcher, an inline position chip, and a bottom playback bar
// (PlaybackControls), with a friendly EmptyState when there are no GPS points. Its hooks are useTranslation
// (i18n) and useMotionPreference (reduced motion); the points themselves arrive as a prop.
//
// This port keeps that composition and contract end to end. The pure parse + projection LOGIC lives in
// [RoutePlaybackModel] (off-device tested); the drive's GPS feed is bound through the shared S8
// [RoutePlaybackSource] into a [RoutePlaybackViewModel] (no HTTP touches the view); the interactive map +
// replay clock are delegated to the shared atomic widget (io.teslasync.android.components.maps.RoutePlayback,
// the P3 component-library bundle), so this file is a thin, stateless render layer driven by the folded
// [RoutePlaybackState]. Every prompt state renders from the REAL positions-feed `Resource` lifecycle:
// loading → skeleton chrome, error (no cache) → QueryError + retry, empty (drive with no positions) → a
// friendly EmptyState (never a blank box), stale/offline → an Offline pill + retry over the still-seekable
// cached frames, content → the live interactive map. Every visible string resolves through the i18n catalog
// (P1/S10); the map carries a TalkBack landmark label, reduced motion is honored by the atomic marker layer,
// and the one mandated `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RoutePlayback) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer, strings holder, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routeplayback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.android.components.maps.RoutePlayback as RoutePlaybackMap

// ── Visual constants (detekt MagicNumber is off; named here for clarity). ───────────────────────────────
private const val DEFAULT_MAP_HEIGHT_DP: Int = 360
private val CONTROLS_SKELETON_HEIGHT = 44.dp

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------

/**
 * The content-level callbacks the stateless surface emits — hoisted so the renderer stays free of the
 * ViewModel and is fully preview-/screenshot-testable.
 */
class RoutePlaybackActions(
    val onRetry: () -> Unit = {},
)

// ------------------------------------------------------------------
// Stateful entry point
// ------------------------------------------------------------------

/**
 * Stateful entry point — the faithful port of the web `RoutePlayback`. Collects the [RoutePlaybackViewModel]
 * state, emits the one-shot `view.opened` diagnostic on first composition (P1/S11), and renders the stateless
 * content. Performs no HTTP and owns no timing — the replay clock lives in the atomic map widget.
 *
 * @param viewModel the surface state holder, bound to the shared S8 Driving feed by a host.
 * @param heightDp the visible map height (web `height`, default 360).
 * @param autoPlay whether to auto-play on mount (web `autoPlay`, default false).
 */
@Composable
fun RoutePlayback(
    viewModel: RoutePlaybackViewModel,
    modifier: Modifier = Modifier,
    heightDp: Int = DEFAULT_MAP_HEIGHT_DP,
    autoPlay: Boolean = false,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberRoutePlaybackStrings()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }

    RoutePlaybackContent(
        state = state,
        strings = strings,
        modifier = modifier,
        actions = RoutePlaybackActions(onRetry = viewModel::retry),
        heightDp = heightDp,
        autoPlay = autoPlay,
    )
}

// ------------------------------------------------------------------
// Stateless content
// ------------------------------------------------------------------

/**
 * Stateless surface — renders every branch the web source does plus the cache-then-network lifecycle: a hard
 * error → QueryError + retry; a first load → skeleton chrome; otherwise the interactive map (which itself
 * renders a friendly EmptyState for a drive with no positions), preceded by an Offline pill + retry for
 * stale/last-known frames. Hoisted out of the ViewModel so each state is preview- and screenshot-testable.
 */
@Composable
fun RoutePlaybackContent(
    state: RoutePlaybackState,
    strings: RoutePlaybackStrings,
    modifier: Modifier = Modifier,
    actions: RoutePlaybackActions = RoutePlaybackActions(),
    heightDp: Int = DEFAULT_MAP_HEIGHT_DP,
    autoPlay: Boolean = false,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FreshnessRow(state = state, strings = strings, onRetry = actions.onRetry)
        when {
            state.isError ->
                GlassPanel(modifier = Modifier.fillMaxWidth()) {
                    QueryError(
                        kind = RoutePlaybackProjection.queryErrorKindFor(state.errorKind, state.httpStatus),
                        resourceName = strings.resourceName,
                        onRetry = actions.onRetry,
                    )
                }
            state.isLoading -> LoadingChrome(strings = strings, heightDp = heightDp)
            else -> RouteBody(state = state, strings = strings, heightDp = heightDp, autoPlay = autoPlay)
        }
    }
}

@Composable
private fun FreshnessRow(
    state: RoutePlaybackState,
    strings: RoutePlaybackStrings,
    onRetry: () -> Unit,
) {
    if (!state.refreshing && !state.isOffline) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (state.refreshing && !state.isOffline) {
            StatusPill(text = strings.loadingLabel, tone = StatusTone.Info, pulse = true)
        }
        if (state.isOffline) {
            StatusPill(text = strings.offlineLabel, tone = StatusTone.Warning)
            Button(label = strings.retryLabel, onClick = onRetry, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
    }
}

/**
 * Content/empty body. The interactive map + replay clock are delegated to the shared atomic widget, which
 * also renders a friendly EmptyState (with the localized message) for a drive whose positions resolved to
 * no playable trail — so the empty branch is never a blank box.
 */
@Composable
private fun RouteBody(
    state: RoutePlaybackState,
    strings: RoutePlaybackStrings,
    heightDp: Int,
    autoPlay: Boolean,
) {
    RoutePlaybackMap(
        samples = state.samples,
        heightDp = heightDp,
        autoPlay = autoPlay,
        emptyMessage = strings.emptyMessage,
        mapContentDescription = strings.mapLabel,
        summaryLabel = strings.summaryLabel,
        startLabel = strings.startLabel,
        endLabel = strings.endLabel,
    )
}

@Composable
private fun LoadingChrome(
    strings: RoutePlaybackStrings,
    heightDp: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(heightDp.dp)
                        .semantics { contentDescription = strings.loadingLabel },
            ) {
                Skeleton(modifier = Modifier.fillMaxSize(), rounded = false)
            }
        }
        Skeleton(modifier = Modifier.fillMaxWidth(), height = CONTROLS_SKELETON_HEIGHT, rounded = true)
    }
}

// ------------------------------------------------------------------
// Strings
// ------------------------------------------------------------------

/**
 * Builds the localized [RoutePlaybackStrings] from the P1/S10 catalog (web `maps.routePlayback.*` plus the
 * shared chrome + accessible-summary keys); tests pass a deterministic instance so no English literal lives
 * in this file.
 */
@Composable
private fun rememberRoutePlaybackStrings(): RoutePlaybackStrings =
    RoutePlaybackStrings(
        emptyMessage = stringResource(R.string.translation_maps_routePlayback_empty),
        mapLabel = stringResource(R.string.translation_maps_routePlayback_mapLabel),
        resourceName = stringResource(R.string.translation_maps_routePlayback_mapLabel),
        summaryLabel = stringResource(R.string.translation_driveDetail_route),
        startLabel = stringResource(R.string.translation_driveDetail_start),
        endLabel = stringResource(R.string.translation_driveDetail_end),
        offlineLabel = stringResource(R.string.translation_common_offline),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        retryLabel = stringResource(R.string.translation_common_retry),
    )

// ------------------------------------------------------------------
// Previews — one per rendered state branch (loading / empty / error / offline), plus a dark variant.
// The content (live-map) branch is exercised on-device; previews stay on the map-free chrome states.
// ------------------------------------------------------------------

private fun emptyTrack(): RoutePlaybackTrack = RoutePlaybackTrack.EMPTY

@Preview(name = "RoutePlayback · loading", showBackground = true)
@Composable
private fun RoutePlaybackLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RoutePlaybackContent(state = RoutePlaybackState.loading(), strings = rememberRoutePlaybackStrings())
    }
}

@Preview(name = "RoutePlayback · empty", showBackground = true)
@Composable
private fun RoutePlaybackEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RoutePlaybackContent(
            state = RoutePlaybackState(phase = UiPhase.Empty, track = emptyTrack()),
            strings = rememberRoutePlaybackStrings(),
        )
    }
}

@Preview(name = "RoutePlayback · offline (stale)", showBackground = true)
@Composable
private fun RoutePlaybackOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RoutePlaybackContent(
            state =
                RoutePlaybackState(
                    phase = UiPhase.Empty,
                    track = emptyTrack(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = rememberRoutePlaybackStrings(),
        )
    }
}

@Preview(name = "RoutePlayback · error", showBackground = true)
@Composable
private fun RoutePlaybackErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RoutePlaybackContent(
            state =
                RoutePlaybackState(
                    phase = UiPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = 503,
                ),
            strings = rememberRoutePlaybackStrings(),
        )
    }
}

@Preview(name = "RoutePlayback · error (dark)", showBackground = true)
@Composable
private fun RoutePlaybackErrorDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        RoutePlaybackContent(
            state = RoutePlaybackState(phase = UiPhase.Error, errorKind = ErrorKind.Timeout),
            strings = rememberRoutePlaybackStrings(),
        )
    }
}
