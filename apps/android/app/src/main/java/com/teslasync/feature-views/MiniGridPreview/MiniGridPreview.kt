// The native Jetpack Compose + Material 3 `MiniGridPreview` feature view — a parity port of
// web/src/features/dashboard/components/MiniGridPreview.tsx. The web component is a tiny presentational thumbnail:
// given a `SavedDashboard`, it draws that dashboard's `lg` react-grid-layout as a four-column frame of small boxes,
// each box positioned by percentage and carrying its widget-registry icon centered inside. It fetches nothing and
// renders no text — purely a "shape of this layout" glance used in switchers/preset galleries.
//
// This port keeps that composition end to end and performs NO HTTP. All of the geometry the web derives lives in the
// pure [io.teslasync.android.featureviews.minigridpreview.MiniGridPreviewProjection] (the row-count guard, the
// `cols / safeMaxY` aspect ratio, and each box's fractional rectangle), unit-tested off-device, so this file is a
// thin render layer. Resolving a widget id to an icon is the widget-registry surface's concern (a separate prompt,
// exactly as the sibling `DashboardGrid` treats it), so the host supplies an [iconForWidget] resolver; a `null`
// result paints an empty box, mirroring the web `{Icon && <Icon/>}` guard.
//
// The web component receives a ready `dashboard` prop, so a web-parity overload taking a [MiniGridDashboard] is
// provided. Because the saved-dashboard feed is host-owned (P1/S8), the canonical entry takes a [UiState] and
// renders every lifecycle state that layer can carry — loading (skeleton), hard error (retry), the host-feed empty
// ("no dashboard" — a friendly state), content (the thumbnail), and stale/offline (the cached thumbnail plus an
// Offline freshness chip that auto-refreshes). A dashboard whose `lg` layout is empty is NOT the empty STATE: the
// web draws the bordered empty frame for it, so this port does too (content, never a blank box).
//
// Colors/typography map to design tokens (never raw hex / ad-hoc text styles): the frame and cell fills are subtle
// `onSurface` alpha overlays (the theme-adaptive equivalent of the web `white/[0.02|0.06]`), borders use the
// `outlineVariant`/`onSurface` outline tokens, and the cell icons inherit the muted `onSurfaceVariant` foreground
// (the web `--text-muted`). The thumbnail is a decorative composite, so the whole frame is collapsed to a single
// localized accessibility node ([clearAndSetSemantics]) and the inner cells/icons are not separately announced.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MiniGridPreview — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.minigridpreview

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Thumbnail entrance fade — a gentle reveal that honours reduced motion (the app's motion language). */
private const val PREVIEW_FADE_MS: Int = 200

/** Loading-skeleton thumbnail height in dp — sized so the loading state reads as a card, never a blank box. */
private val LOADING_THUMBNAIL_HEIGHT: Dp = 72.dp

/** Outline width of the frame and each cell, in dp (the web 1px borders). */
private val HAIRLINE_WIDTH: Dp = 1.dp

/** Corner radius of a cell box, in dp — the web `rounded-sm` (2px). */
private val CELL_CORNER_RADIUS: Dp = 2.dp

/** Inner inset between a cell's border and its icon, in dp — the web cell `padding: '2px'`. */
private val CELL_INSET: Dp = 2.dp

/** Frame fill opacity over the theme foreground — the theme-adaptive equivalent of the web `bg-white/[0.02]`. */
private const val FRAME_FILL_ALPHA: Float = 0.02f

/** Cell fill opacity over the theme foreground — the web `bg-white/[0.06]`. */
private const val CELL_FILL_ALPHA: Float = 0.06f

/** Cell border opacity over the theme foreground — the web `border-white/[0.08]`. */
private const val CELL_BORDER_ALPHA: Float = 0.08f

/** Em dash shown when a freshness age is unknown — the shared freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for `MiniGridPreview`. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the saved-dashboard feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (its `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [MiniGridDashboard] to preview.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param iconForWidget resolves a widget id to its registry icon (the web `getWidgetDef(widgetId)?.icon`); `null`
 *   paints an empty cell box. Defaults to no icons so the frame degrades gracefully without the registry.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MiniGridPreview(
    state: UiState<MiniGridDashboard>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    iconForWidget: (String) -> ImageVector? = { null },
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordMiniGridPreviewOpened(logger) }
    MiniGridPreviewContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        iconForWidget = iconForWidget,
    )
}

/**
 * Web-parity overload mirroring the web component's ready `dashboard` prop, for hosts that already hold the saved
 * layout. Always renders the thumbnail (an empty `lg` layout draws the bordered empty frame, matching the web).
 * Records `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun MiniGridPreview(
    dashboard: MiniGridDashboard,
    modifier: Modifier = Modifier,
    iconForWidget: (String) -> ImageVector? = { null },
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(dashboard) { MiniGridPreviewProjection.contentState(dashboard) }
    MiniGridPreview(
        state = state,
        onRetry = {},
        modifier = modifier,
        iconForWidget = iconForWidget,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Loading shows a skeleton thumbnail; a
 * hard error shows a retry surface; the host-feed empty shows a friendly empty state; otherwise the thumbnail is
 * drawn (an empty layout still draws the bordered frame). Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract.
 */
@Composable
fun MiniGridPreviewContent(
    state: UiState<MiniGridDashboard>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    iconForWidget: (String) -> ImageVector? = { null },
    strings: MiniGridPreviewStrings = rememberMiniGridPreviewStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    when (miniGridPreviewSurface(state)) {
        MiniGridPreviewSurface.Loading -> MiniGridPreviewLoading(modifier = modifier.fillMaxWidth())
        MiniGridPreviewSurface.Error ->
            ErrorDisplay(
                message = strings.errorMessage,
                modifier = modifier.fillMaxWidth(),
                onRetry = onRetry,
                retryLabel = strings.retryLabel,
            )
        MiniGridPreviewSurface.Empty ->
            EmptyState(message = strings.emptyMessage, modifier = modifier.fillMaxWidth())
        MiniGridPreviewSurface.Content ->
            MiniGridPreviewScaffold(
                state = state,
                strings = strings,
                iconForWidget = iconForWidget,
                modifier = modifier,
            )
    }
}

/**
 * The content scaffold for the thumbnail: projects the layout, shows the freshness chip when cached data is
 * refreshing/stale/offline, and draws the frame. The frame is wrapped in a reduced-motion-aware [FadeIn].
 */
@Composable
private fun MiniGridPreviewScaffold(
    state: UiState<MiniGridDashboard>,
    strings: MiniGridPreviewStrings,
    iconForWidget: (String) -> ImageVector?,
    modifier: Modifier = Modifier,
) {
    val dashboard = state.data ?: MiniGridDashboard()
    val projection = remember(dashboard) { MiniGridPreviewProjection.project(dashboard) }
    val showFreshness = state.refreshing || state.stale || state.hasError

    FadeIn(durationMs = PREVIEW_FADE_MS) {
        Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (showFreshness) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    MiniGridPreviewFreshnessChip(state = state, strings = strings)
                }
            }
            MiniGridPreviewFrame(
                projection = projection,
                iconForWidget = iconForWidget,
                accessibilityLabel = strings.previewLabel,
            )
        }
    }
}

/**
 * The bordered preview frame: a [BoxWithConstraints] (the `useContainerWidth`-free measurement the web gets from CSS
 * percentages) laid out at the projection's aspect ratio, with each placed cell positioned by its fractional
 * rectangle. Collapsed to a single localized accessibility node so the decorative thumbnail is announced once.
 */
@Composable
private fun MiniGridPreviewFrame(
    projection: MiniGridPreviewProjectionResult,
    iconForWidget: (String) -> ImageVector?,
    accessibilityLabel: String,
    modifier: Modifier = Modifier,
) {
    val frameShape = RoundedCornerShape(Radius.sm)
    val mutedTint = MaterialTheme.colorScheme.onSurfaceVariant
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .aspectRatio(projection.aspectRatio)
                .clip(frameShape)
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = FRAME_FILL_ALPHA))
                .border(HAIRLINE_WIDTH, MaterialTheme.colorScheme.outlineVariant, frameShape)
                .clearAndSetSemantics { contentDescription = accessibilityLabel },
    ) {
        val frameWidth = maxWidth
        val frameHeight = maxHeight
        projection.cells.forEach { cell ->
            MiniGridCellBox(
                cell = cell,
                frameWidth = frameWidth,
                frameHeight = frameHeight,
                icon = cell.widgetId?.let(iconForWidget),
                mutedTint = mutedTint,
            )
        }
    }
}

/**
 * One placed widget box — positioned and sized by multiplying the cell's fractional rectangle by the measured
 * [frameWidth]/[frameHeight] (the web absolute `left/top/width/height` percentages), with the widget [icon] centered
 * inside (omitted when the registry resolved nothing, the web `find`/`def` miss).
 */
@Composable
private fun MiniGridCellBox(
    cell: MiniGridCell,
    frameWidth: Dp,
    frameHeight: Dp,
    icon: ImageVector?,
    mutedTint: Color,
) {
    val cellShape = RoundedCornerShape(CELL_CORNER_RADIUS)
    val foreground = MaterialTheme.colorScheme.onSurface
    Box(
        modifier =
            Modifier
                .offset(x = frameWidth * cell.leftFraction, y = frameHeight * cell.topFraction)
                .size(width = frameWidth * cell.widthFraction, height = frameHeight * cell.heightFraction)
                .clip(cellShape)
                .background(foreground.copy(alpha = CELL_FILL_ALPHA))
                .border(HAIRLINE_WIDTH, foreground.copy(alpha = CELL_BORDER_ALPHA), cellShape)
                .padding(CELL_INSET),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, size = IconSize.Xs, tint = mutedTint)
        }
    }
}

/** First-load skeleton — a single shimmering thumbnail-shaped block so the surface is never blank while loading. */
@Composable
private fun MiniGridPreviewLoading(modifier: Modifier = Modifier) {
    Skeleton(modifier = modifier.fillMaxWidth(), height = LOADING_THUMBNAIL_HEIGHT, rounded = false)
}

/**
 * The freshness chip shown above the thumbnail when cached data is refreshing / stale / offline — the honest "last
 * known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline" label; a
 * stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun MiniGridPreviewFreshnessChip(
    state: UiState<*>,
    strings: MiniGridPreviewStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.loadingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = rememberMiniGridPreviewFreshnessFormatter(),
    )
}

/**
 * Builds the localized [MiniGridPreviewStrings] from the i18n catalog (P1/S10): the decorative thumbnail's
 * accessible name (`app.preview`), the host-feed empty message (`common.noData`), and the lifecycle chrome
 * (error/retry/loading/offline). Remembered against the resolved strings so a locale change re-reads them.
 */
@Composable
fun rememberMiniGridPreviewStrings(): MiniGridPreviewStrings {
    val previewLabel = stringResource(R.string.translation_app_preview)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retryLabel = stringResource(R.string.translation_common_retry)
    val loadingLabel = stringResource(R.string.translation_common_loading)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    return remember(previewLabel, emptyMessage, errorMessage, retryLabel, loadingLabel, offlineLabel) {
        MiniGridPreviewStrings(
            previewLabel = previewLabel,
            emptyMessage = emptyMessage,
            errorMessage = errorMessage,
            retryLabel = retryLabel,
            loadingLabel = loadingLabel,
            offlineLabel = offlineLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only concern
 * the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMiniGridPreviewFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * The already-localized microcopy the composable reads (P1/S10): the thumbnail's accessible name and the lifecycle
 * chrome. Kept out of the pure projection so it stays UI-free.
 */
data class MiniGridPreviewStrings(
    val previewLabel: String,
    val emptyMessage: String,
    val errorMessage: String,
    val retryLabel: String,
    val loadingLabel: String,
    val offlineLabel: String,
)

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    MiniGridPreviewStrings(
        previewLabel = "Preview",
        emptyMessage = "No data available",
        errorMessage = "Something went wrong on our end. Please try again.",
        retryLabel = "Retry",
        loadingLabel = "Loading...",
        offlineLabel = "Offline",
    )

private val PREVIEW_DASHBOARD =
    MiniGridDashboard(
        widgets =
            listOf(
                MiniGridWidget(id = "w-1", widgetId = "vehicle-hero"),
                MiniGridWidget(id = "w-2", widgetId = "battery-gauge"),
                MiniGridWidget(id = "w-3", widgetId = "range-bar"),
                MiniGridWidget(id = "w-4", widgetId = "fleet-stats"),
            ),
        lgLayout =
            listOf(
                MiniGridLayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                MiniGridLayoutItem("w-2", x = 2, y = 0, w = 1, h = 2),
                MiniGridLayoutItem("w-3", x = 3, y = 0, w = 1, h = 1),
                MiniGridLayoutItem("w-4", x = 0, y = 2, w = 2, h = 1),
            ),
    )

private val PREVIEW_ICONS: Map<String, ImageVector> =
    mapOf(
        "vehicle-hero" to TeslaGlyphs.Eye,
        "battery-gauge" to TeslaGlyphs.Check,
        "range-bar" to TeslaGlyphs.Info,
        "fleet-stats" to TeslaGlyphs.Pin,
    )

private fun previewIcon(widgetId: String): ImageVector? = PREVIEW_ICONS[widgetId]

@Preview(name = "Loading", showBackground = true, widthDp = 240)
@Composable
private fun MiniGridPreviewLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MiniGridPreviewContent(state = UiState(UiPhase.Loading), onRetry = {}, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Empty (no dashboard)", showBackground = true, widthDp = 240)
@Composable
private fun MiniGridPreviewEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MiniGridPreviewContent(state = UiState(UiPhase.Empty), onRetry = {}, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 240)
@Composable
private fun MiniGridPreviewErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MiniGridPreviewContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (thumbnail)", showBackground = true, widthDp = 240)
@Composable
private fun MiniGridPreviewContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MiniGridPreviewContent(
            state = UiState(UiPhase.Content, data = PREVIEW_DASHBOARD),
            onRetry = {},
            iconForWidget = ::previewIcon,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content (empty layout frame)", showBackground = true, widthDp = 240)
@Composable
private fun MiniGridPreviewEmptyLayoutPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MiniGridPreviewContent(
            state = UiState(UiPhase.Content, data = MiniGridDashboard()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 240)
@Composable
private fun MiniGridPreviewOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MiniGridPreviewContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DASHBOARD,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            iconForWidget = ::previewIcon,
            strings = PREVIEW_STRINGS,
        )
    }
}
