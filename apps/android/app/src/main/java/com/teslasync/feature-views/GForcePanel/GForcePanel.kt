// The native Jetpack Compose + Material 3 GForcePanel feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/GForcePanel.tsx. The web component binds the polled
// `useDriveDynamicsLatest(vehicleId)` snapshot and renders a `GlassPanel` titled "Acceleration G-Force"
// containing, when at least one reading is present, a responsive 1 → 3 column grid of three StatCards
// (Lateral / Longitudinal / Combined magnitude, each a `Gauge` icon + bold value + `g` unit), or a friendly
// `EmptyState` ("No G-force telemetry received yet") otherwise. This native port keeps that composition and
// additionally surfaces the cache-then-network states the P3 contract mandates (loading / empty / error /
// stale / offline) by binding the shared latest-drive-dynamics feed (P1/S8) through a [GForcePanelViewModel]:
// the title always renders, a skeleton tile grid covers the first load, a `QueryError` covers a hard failure
// with no cache, a freshness chip + auto-refresh covers stale/offline, and an absent reading still renders the
// titled panel with the empty state (never a blank box). The view performs no HTTP. Every visible string
// resolves through the i18n catalog (P1/S10); the only non-key literal is the web-hard-coded `g` unit suffix,
// and each tile carries a merged TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GForcePanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.gforcepanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale

/** The web `<FadeIn delay={0.05}>` entry stagger (50 ms). */
private const val FADE_DELAY_MS: Int = 50

/** Tailwind `sm` (640px) breakpoint — the web `cols={{ default: 1, sm: 3 }}` reflow. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** The three g-force tiles (web `default: 1, sm: 3`) and the loading-grid tile height. */
private const val GRID_COLUMNS_BASE: Int = 1
private const val GRID_COLUMNS_SM: Int = 3
private val SKELETON_TILE_HEIGHT: Dp = 88.dp

private const val HTTP_NOT_FOUND: Int = 404
private const val HTTP_UNAUTHORIZED: Int = 401
private const val HTTP_FORBIDDEN: Int = 403
private const val HTTP_SERVER_ERROR_MIN: Int = 500
private const val HTTP_SERVER_ERROR_MAX: Int = 599

/**
 * Stateful entry point — the faithful 1:1 port of the web `GForcePanel({ vehicleId })`. Binds the shared
 * latest-drive-dynamics feed via [source] into a [GForcePanelViewModel], records the one-shot `view.opened`
 * diagnostic (P1/S11), reads the user's display locale (web `fmtNumber` global locale via `useUnits`, P1/S8),
 * resolves the localized [GForcePanelStrings] (P1/S10), and renders. A host supplies the selected [vehicleId]
 * (web prop); a `null`/non-positive id reproduces the web disabled query and renders the empty state.
 */
@Composable
fun GForcePanel(
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    source: GForcePanelSource = LocalDataContainer.current.vehiclesStore.asGForcePanelSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = G_FORCE_PANEL_SLUG,
) {
    val viewModel: GForcePanelViewModel =
        viewModel(key = instanceKey, factory = GForcePanelViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val locale = resolveDisplayLocale(formatter.prefs.locale)
    val strings = rememberGForcePanelStrings()

    GForcePanelContent(
        state = state,
        strings = strings,
        locale = locale,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10) — the `dynamics.*` keys the web
 * component reads via `t(...)`. The `g` unit + the error retry-copy label default in [GForcePanelStrings].
 */
@Composable
fun rememberGForcePanelStrings(): GForcePanelStrings {
    val title = stringResource(R.string.translation_dynamics_gForce)
    return GForcePanelStrings(
        title = title,
        lateral = stringResource(R.string.translation_dynamics_lateral),
        longitudinal = stringResource(R.string.translation_dynamics_longitudinal),
        combined = stringResource(R.string.translation_dynamics_combined),
        noData = stringResource(R.string.translation_dynamics_gForceNoData),
        snapshotLabel = title,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The `GlassPanel` +
 * "Acceleration G-Force" title always render; then the skeleton tile grid while the first load is in flight, a
 * `QueryError` with retry on a hard failure with no cache, the three-tile grid when at least one reading is
 * present (web `hasAny`), or the friendly empty state otherwise. A stale/offline cached snapshot keeps its tiles
 * visible with a freshness chip flagged and auto-refreshes (web's 5s realtime poll). No surface is ever blank.
 */
@Composable
fun GForcePanelContent(
    state: UiState<JsonElement>,
    strings: GForcePanelStrings,
    locale: Locale,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            GForceHeader(title = strings.title, state = state)
            Spacer(modifier = Modifier.height(Spacing.md))
            when {
                state.isLoading -> GForceLoadingGrid(strings = strings)
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.snapshotLabel,
                        onRetry = onRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> GForcePanelLoaded(snapshot = state.data, strings = strings, locale = locale)
            }
        }
    }
}

/** The web header `<h2>` — the localized section title, with a freshness chip once a fetch has run. */
@Composable
private fun GForceHeader(
    title: String,
    state: UiState<JsonElement>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(title, modifier = Modifier.semantics { heading() })
        Spacer(modifier = Modifier.weight(1f))
        if ((state.fetchedAt ?: 0L) > 0L || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberRelativeAgeFormatter(),
            )
        }
    }
}

/** The loaded branch: the three-tile grid (web `hasAny`) or the friendly empty state (web `!hasAny`). */
@Composable
private fun GForcePanelLoaded(
    snapshot: JsonElement?,
    strings: GForcePanelStrings,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val display = remember(snapshot, strings, locale) { GForcePanelProjection.project(snapshot, strings, locale) }
    if (display.hasAny) {
        GForceGrid(display = display, modifier = modifier)
    } else {
        EmptyState(message = strings.noData, modifier = modifier)
    }
}

/**
 * The responsive tile grid — the web `Grid cols={{ default: 1, sm: 3 }} gap={4}`. Picks 3 columns at or above
 * the `sm` breakpoint else 1, and lays the tiles out as weighted rows so every tile shares a uniform width.
 */
@Composable
private fun GForceGrid(
    display: GForcePanelDisplay,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) GRID_COLUMNS_SM else GRID_COLUMNS_BASE
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            display.tiles.chunked(columns).forEach { rowTiles ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowTiles.forEach { tile ->
                        StatCard(
                            label = tile.label,
                            value = tile.value,
                            unit = display.unit,
                            icon = DataDisplayGlyphs.Gauge,
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .semantics(mergeDescendants = true) {
                                        contentDescription = tile.accessibilityLabel(display.unit)
                                    },
                        )
                    }
                    repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The first-load skeleton grid — three loading StatCards in the same responsive layout as the content grid. */
@Composable
private fun GForceLoadingGrid(
    strings: GForcePanelStrings,
    modifier: Modifier = Modifier,
) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val labels = listOf(strings.lateral, strings.longitudinal, strings.combined)
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
    ) {
        val columns = if (maxWidth >= GRID_SM_MIN_WIDTH) GRID_COLUMNS_SM else GRID_COLUMNS_BASE
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            labels.chunked(columns).forEach { rowLabels ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowLabels.forEach { label ->
                        StatCard(
                            label = label,
                            value = "",
                            loading = true,
                            modifier = Modifier.weight(1f).height(SKELETON_TILE_HEIGHT),
                        )
                    }
                    repeat(columns - rowLabels.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    GForcePanelStrings(
        title = "Acceleration G-Force",
        lateral = "Lateral",
        longitudinal = "Longitudinal",
        combined = "Combined",
        noData = "No G-force telemetry received yet",
    )

private fun previewSnapshot(): JsonElement =
    buildJsonObject {
        put("lateral_acceleration", 0.30)
        put("longitudinal_acceleration", 0.40)
    }

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun GForcePanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GForcePanelContent(UiState.loading(), PREVIEW_STRINGS, Locale.US)
    }
}

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun GForcePanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GForcePanelContent(
            UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            PREVIEW_STRINGS,
            Locale.US,
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun GForcePanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GForcePanelContent(
            UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L),
            PREVIEW_STRINGS,
            Locale.US,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun GForcePanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GForcePanelContent(
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            PREVIEW_STRINGS,
            Locale.US,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun GForcePanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GForcePanelContent(
            UiState(
                phase = UiPhase.Content,
                data = previewSnapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
            PREVIEW_STRINGS,
            Locale.US,
        )
    }
}
