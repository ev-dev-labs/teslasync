// The native Jetpack Compose + Material 3 `DashboardGrid` feature view — a parity port of
// web/src/features/dashboard/components/DashboardGrid.tsx. The web component is a presentational layout host: it
// measures its container (`useContainerWidth`), picks the active react-grid-layout breakpoint, and either stacks
// every widget in a single full-width column (the `xs` "mobile stack") or arranges them in the multi-column grid,
// wrapping each widget body in a `GlassPanel` + `SectionErrorBoundary` + lazy `Suspense(Skeleton)`. In edit mode
// each widget gains chrome (a drag handle, the widget name, a Settings gear, and a Remove "x"); in view mode each
// widget gains a fullscreen "expand" button that opens a full-bleed overlay of that one widget.
//
// This port keeps that composition end to end. It performs NO HTTP and binds no data hook of its own — its only
// web hook is `useContainerWidth`, reproduced natively with [BoxWithConstraints] + the pure
// [DashboardGridProjection.breakpointForWidth]. The host owns the saved-dashboard feed (P1/S8) and supplies it as a
// [UiState] of [DashboardLayout], so this feature view renders every lifecycle state that layer can carry —
// loading (skeleton grid), hard error (retry), empty (the "add widgets" hint), content, and stale/offline (cached
// "last known" + an Offline freshness chip that auto-refreshes) — without ever fetching. The actual widget bodies
// are separate surfaces (each its own prompt), so they arrive through a [widgetContent] slot the grid frames with
// the chrome, the error boundary, and the fullscreen overlay. A web-parity overload taking a ready [DashboardLayout]
// is also provided for hosts that already hold it.
//
// Drag/resize is a pointer-only web affordance — the web source itself notes the drag handle "has no effect on
// touch, kept for the settings/remove icons it also exposes" — so the touch-first native surface renders the grip
// as a decorative handle and keeps the functional Settings/Remove actions, laying widgets out from the read-only
// compacted layout ([DashboardGridProjection.packRows]) instead of running a live drag engine.
//
// Colors/typography map to design tokens (never raw hex / ad-hoc text styles): the chrome bar is a translucent
// `surfaceVariant` scrim, the grip/glyphs inherit `onSurfaceVariant`, the Remove glyph tints to
// `TeslaTokens.status.danger`, and every label is a [io.teslasync.android.components.ui] typography role. The two
// header glyphs the web draws with lucide (`GripHorizontal`, `Settings`) are authored here as 24×24 stroked vectors
// (Android ships no lucide set and a feature view may not expand the shared icon library); they are decorative
// (null content description), so the localized button labels carry the meaning for accessibility services.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DashboardGrid — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.dashboardgrid

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.SectionErrorBoundary
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Grid entrance fade — a gentle whole-surface reveal that honours reduced motion (the app's motion language). */
private const val GRID_FADE_MS: Int = 200

/** Minimum desktop cell height in dp — a one-row widget (`h = 1`) is at least this tall so chrome/content fit. */
private val DESKTOP_MIN_CELL_HEIGHT: Dp = 96.dp

/** Loading-skeleton panel height — sized so the loading grid reads as cards, never a blank box. */
private val LOADING_PANEL_HEIGHT: Dp = 120.dp

/** Number of skeleton panels shown while the first dashboard load is in flight. */
private const val LOADING_PANEL_COUNT: Int = 3

/** Fullscreen overlay minimum widget rows — the web `Math.max(size.rows, 4)` floor for the expanded body. */
private const val FULLSCREEN_MIN_ROWS: Int = 4

/** Translucency of the edit-mode chrome scrim over the widget top edge — the web top gradient analogue. */
private const val CHROME_SCRIM_ALPHA: Float = 0.85f

/** Em dash shown when a freshness age is unknown — the shared freshness fallback. */
private const val EM_DASH: String = "\u2014"

/**
 * Stateful entry point for `DashboardGrid`. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the saved-dashboard feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (its `refetch`); this view never performs HTTP. The actual widget bodies arrive through [widgetContent].
 *
 * @param state the cache-then-network projection of the saved [DashboardLayout].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param options the presentation flags (edit mode, compact gaps, widget borders).
 * @param onRemoveWidget invoked from a widget's edit-mode Remove control (web `onRemoveWidget`).
 * @param onOpenSettings invoked from a widget's edit-mode Settings control (web `onOpenSettings`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param widgetContent renders one widget's body for the given instance + live size (the framed slot).
 */
@Composable
fun DashboardGrid(
    state: UiState<DashboardLayout>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    options: DashboardGridOptions = DashboardGridOptions(),
    onRemoveWidget: (DashboardWidget) -> Unit = {},
    onOpenSettings: (DashboardWidget) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
) {
    LaunchedEffect(Unit) { recordDashboardGridOpened(logger) }
    DashboardGridContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        options = options,
        onRemoveWidget = onRemoveWidget,
        onOpenSettings = onOpenSettings,
        widgetContent = widgetContent,
    )
}

/**
 * Web-parity overload mirroring the web component's ready `dashboard` prop, for hosts that already hold the saved
 * layout. An empty widget list renders the empty state; any widgets render the grid. Records `view.opened` like the
 * stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun DashboardGrid(
    layout: DashboardLayout,
    modifier: Modifier = Modifier,
    options: DashboardGridOptions = DashboardGridOptions(),
    onRemoveWidget: (DashboardWidget) -> Unit = {},
    onOpenSettings: (DashboardWidget) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
) {
    val state =
        remember(layout) {
            UiState(phase = if (layout.widgets.isEmpty()) UiPhase.Empty else UiPhase.Content, data = layout)
        }
    DashboardGrid(
        state = state,
        onRetry = {},
        modifier = modifier,
        options = options,
        onRemoveWidget = onRemoveWidget,
        onOpenSettings = onOpenSettings,
        logger = logger,
        widgetContent = widgetContent,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Loading shows a skeleton grid; a hard
 * error shows a retry surface; otherwise the saved layout is laid out responsively (the empty hint when it has no
 * widgets). Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun DashboardGridContent(
    state: UiState<DashboardLayout>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    options: DashboardGridOptions = DashboardGridOptions(),
    onRemoveWidget: (DashboardWidget) -> Unit = {},
    onOpenSettings: (DashboardWidget) -> Unit = {},
    strings: DashboardGridStrings = rememberDashboardGridStrings(),
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    when {
        state.isLoading -> DashboardGridLoading(modifier = modifier.fillMaxWidth())
        state.isError ->
            ErrorDisplay(
                message = strings.errorMessage,
                modifier = modifier.fillMaxWidth(),
                onRetry = onRetry,
                retryLabel = strings.retryLabel,
            )
        else ->
            DashboardGridScaffold(
                state = state,
                options = options,
                strings = strings,
                onRemoveWidget = onRemoveWidget,
                onOpenSettings = onOpenSettings,
                widgetContent = widgetContent,
                modifier = modifier,
            )
    }
}

/**
 * The content scaffold for the non-loading / non-error states: measures the container ([BoxWithConstraints], the
 * `useContainerWidth` analogue), projects the layout, shows the freshness chip when cached data is
 * refreshing/stale/offline, and lays out either the empty hint, the mobile stack, or the multi-column grid. Owns the
 * fullscreen-overlay selection so a view-mode "expand" opens a full-bleed view of one widget.
 */
@Composable
private fun DashboardGridScaffold(
    state: UiState<DashboardLayout>,
    options: DashboardGridOptions,
    strings: DashboardGridStrings,
    onRemoveWidget: (DashboardWidget) -> Unit,
    onOpenSettings: (DashboardWidget) -> Unit,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
    modifier: Modifier = Modifier,
) {
    val layout = state.data ?: DashboardLayout()
    var fullscreenId by remember { mutableStateOf<String?>(null) }

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val widthDp = maxWidth.value.toInt()
        val result = remember(layout, widthDp) { DashboardGridProjection.project(layout, widthDp) }
        val showFreshness = state.refreshing || state.stale || state.hasError
        val gap = if (options.compactMode) Spacing.sm else Spacing.md

        FadeIn(durationMs = GRID_FADE_MS) {
            Column(verticalArrangement = Arrangement.spacedBy(gap)) {
                if (showFreshness) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        DashboardGridFreshnessChip(state = state, strings = strings)
                    }
                }
                when {
                    result.isEmpty ->
                        EmptyState(message = strings.emptyMessage, modifier = Modifier.fillMaxWidth())
                    result.isMobileStack ->
                        MobileStack(
                            result = result,
                            options = options,
                            strings = strings,
                            onRemoveWidget = onRemoveWidget,
                            onOpenSettings = onOpenSettings,
                            onExpand = { fullscreenId = it },
                            widgetContent = widgetContent,
                            gap = gap,
                        )
                    else ->
                        DesktopGrid(
                            result = result,
                            options = options,
                            strings = strings,
                            onRemoveWidget = onRemoveWidget,
                            onOpenSettings = onOpenSettings,
                            onExpand = { fullscreenId = it },
                            widgetContent = widgetContent,
                            gap = gap,
                        )
                }
            }
        }

        val fullscreen = fullscreenId?.let { id -> result.placedWidgets.firstOrNull { it.widget.id == id } }
        if (fullscreen != null) {
            FullscreenOverlay(
                placed = fullscreen,
                strings = strings,
                onClose = { fullscreenId = null },
                widgetContent = widgetContent,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** The single-column mobile stack (web `xs` breakpoint): each widget full-width with an intrinsic-height floor. */
@Composable
private fun MobileStack(
    result: DashboardGridProjectionResult,
    options: DashboardGridOptions,
    strings: DashboardGridStrings,
    onRemoveWidget: (DashboardWidget) -> Unit,
    onOpenSettings: (DashboardWidget) -> Unit,
    onExpand: (String) -> Unit,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
    gap: Dp,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = DashboardGridRegistration.SLUG },
        verticalArrangement = Arrangement.spacedBy(gap),
    ) {
        result.placedWidgets.forEach { placed ->
            WidgetCell(
                placed = placed,
                options = options,
                strings = strings,
                mobile = true,
                onRemove = { onRemoveWidget(placed.widget) },
                onSettings = { onOpenSettings(placed.widget) },
                onExpand = { onExpand(placed.widget.id) },
                widgetContent = widgetContent,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The multi-column grid (web `lg`/`md`/`sm`): packed rows whose cells share the band weighted by their span. */
@Composable
private fun DesktopGrid(
    result: DashboardGridProjectionResult,
    options: DashboardGridOptions,
    strings: DashboardGridStrings,
    onRemoveWidget: (DashboardWidget) -> Unit,
    onOpenSettings: (DashboardWidget) -> Unit,
    onExpand: (String) -> Unit,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
    gap: Dp,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = DashboardGridRegistration.SLUG },
        verticalArrangement = Arrangement.spacedBy(gap),
    ) {
        result.rows.forEach { row ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                row.items.forEach { placed ->
                    WidgetCell(
                        placed = placed,
                        options = options,
                        strings = strings,
                        mobile = false,
                        onRemove = { onRemoveWidget(placed.widget) },
                        onSettings = { onOpenSettings(placed.widget) },
                        onExpand = { onExpand(placed.widget.id) },
                        widgetContent = widgetContent,
                        modifier = Modifier.weight(placed.columnSpan.toFloat()),
                    )
                }
            }
        }
    }
}

/**
 * One widget cell — a [GlassPanel] framing the host's [widgetContent] inside a [SectionErrorBoundary] (the web
 * per-widget boundary), with edit-mode chrome (grip + name + Settings + Remove) or a view-mode fullscreen expand
 * button overlaid at the top. Desktop cells take a fixed `rows × ROW_HEIGHT` height; mobile cells grow from a
 * minimum floor so chart/map bodies still get a definite parent height.
 */
@Composable
private fun WidgetCell(
    placed: PlacedWidget,
    options: DashboardGridOptions,
    strings: DashboardGridStrings,
    mobile: Boolean,
    onRemove: () -> Unit,
    onSettings: () -> Unit,
    onExpand: () -> Unit,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
    modifier: Modifier = Modifier,
) {
    val shape = MaterialTheme.shapes.large
    val heightModifier =
        if (mobile) {
            Modifier.heightIn(min = DASHBOARD_GRID_MOBILE_MIN_WIDGET_HEIGHT_DP.dp)
        } else {
            Modifier.height(
                (placed.size.rows * DASHBOARD_GRID_ROW_HEIGHT_DP).dp.coerceAtLeast(DESKTOP_MIN_CELL_HEIGHT),
            )
        }
    val borderModifier =
        if (options.showWidgetBorders) Modifier.border(1.dp, MaterialTheme.colorScheme.outline, shape) else Modifier

    Box(modifier = modifier) {
        GlassPanel(
            modifier = Modifier.fillMaxWidth().then(heightModifier).then(borderModifier),
            padding = if (options.compactMode) PanelPadding.Sm else PanelPadding.Md,
        ) {
            val boundary = rememberErrorBoundaryState()
            SectionErrorBoundary(state = boundary) {
                widgetContent(placed.widget, placed.size)
            }
        }
        if (options.editMode) {
            WidgetChrome(
                name = placed.widget.name,
                strings = strings,
                onSettings = onSettings,
                onRemove = onRemove,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        } else {
            IconButton(
                imageVector = TeslaGlyphs.Fullscreen,
                contentDescription = "${strings.enterFullscreen}: ${placed.widget.name}",
                onClick = onExpand,
                size = IconSize.Sm,
                modifier = Modifier.align(Alignment.TopEnd),
            )
        }
    }
}

/**
 * The edit-mode chrome overlaid on a widget's top edge — a translucent bar carrying the drag grip + the widget
 * [name] on the left and the Settings + Remove controls on the right (web `WidgetChrome`). The grip is decorative
 * (drag is pointer-only and inert on touch); the two controls expose localized, name-qualified accessible labels.
 */
@Composable
private fun WidgetChrome(
    name: String,
    strings: DashboardGridStrings,
    onSettings: () -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(topStart = Spacing.md, topEnd = Spacing.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CHROME_SCRIM_ALPHA))
                .padding(start = Spacing.sm, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(
                imageVector = DashboardGridGlyphs.Grip,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(name, modifier = Modifier.weight(1f, fill = false))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(
                imageVector = DashboardGridGlyphs.Settings,
                contentDescription = "${strings.settings}: $name",
                onClick = onSettings,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = "${strings.remove}: $name",
                onClick = onRemove,
                size = IconSize.Sm,
                tint = TeslaTokens.status.danger,
            )
        }
    }
}

/**
 * The view-mode fullscreen overlay (web `FullscreenOverlay`) — a full-bleed surface with the widget [name] and an
 * "exit fullscreen" control over the one widget body, sized up to the web `Math.max(rows, 4)` floor. Covers the
 * grid area so the expanded widget reads as a focused, dismissible view.
 */
@Composable
private fun FullscreenOverlay(
    placed: PlacedWidget,
    strings: DashboardGridStrings,
    onClose: () -> Unit,
    widgetContent: @Composable (DashboardWidget, WidgetSize) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(modifier = Modifier.fillMaxSize().padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                SectionTitle(placed.widget.name, modifier = Modifier.weight(1f))
                IconButton(
                    imageVector = TeslaGlyphs.FullscreenExit,
                    contentDescription = strings.exitFullscreen,
                    onClick = onClose,
                    size = IconSize.Md,
                )
            }
            GlassPanel(modifier = Modifier.fillMaxWidth().weight(1f)) {
                val boundary = rememberErrorBoundaryState()
                SectionErrorBoundary(state = boundary) {
                    widgetContent(
                        placed.widget,
                        placed.size.copy(rows = maxOf(placed.size.rows, FULLSCREEN_MIN_ROWS)),
                    )
                }
            }
        }
    }
}

/** First-load skeleton grid — a stack of card-shaped shimmers so the surface is never blank while loading. */
@Composable
private fun DashboardGridLoading(modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        repeat(LOADING_PANEL_COUNT) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = LOADING_PANEL_HEIGHT, rounded = true)
        }
    }
}

/**
 * The freshness chip shown above the grid when cached data is refreshing / stale / offline — the honest "last known
 * + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline" label; a
 * stale-but-reachable value reads its relative age. Mirrors the sibling surfaces' contract.
 */
@Composable
private fun DashboardGridFreshnessChip(
    state: UiState<*>,
    strings: DashboardGridStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.loadingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = rememberDashboardGridFreshnessFormatter(),
    )
}

/**
 * Builds the localized [DashboardGridStrings] from the i18n catalog (P1/S10): the widget chrome controls
 * (`dashboard.settings` / `common.remove`), the fullscreen labels (`common.fullscreen.*`), the empty-dashboard hint
 * (`dashboard.customizeHint`), and the lifecycle chrome (error/retry/loading/offline). Remembered against the
 * resolved strings so a locale change re-reads them.
 */
@Composable
fun rememberDashboardGridStrings(): DashboardGridStrings {
    val settings = stringResource(R.string.translation_dashboard_settings)
    val remove = stringResource(R.string.translation_common_remove)
    val enterFullscreen = stringResource(R.string.translation_common_fullscreen_enter)
    val exitFullscreen = stringResource(R.string.translation_common_fullscreen_exit)
    val emptyMessage = stringResource(R.string.translation_dashboard_customizeHint)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retryLabel = stringResource(R.string.translation_common_retry)
    val loadingLabel = stringResource(R.string.translation_common_loading)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    return remember(
        settings,
        remove,
        enterFullscreen,
        exitFullscreen,
        emptyMessage,
        errorMessage,
        retryLabel,
        loadingLabel,
        offlineLabel,
    ) {
        DashboardGridStrings(
            settings = settings,
            remove = remove,
            enterFullscreen = enterFullscreen,
            exitFullscreen = exitFullscreen,
            emptyMessage = emptyMessage,
            errorMessage = errorMessage,
            retryLabel = retryLabel,
            loadingLabel = loadingLabel,
            offlineLabel = offlineLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberDashboardGridFreshnessFormatter(): (FreshnessAge) -> String {
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
 * The already-localized microcopy the composable reads (P1/S10): the widget chrome controls, the fullscreen labels,
 * the empty-dashboard hint, and the lifecycle chrome. Kept out of the pure projection so it stays UI-free.
 */
data class DashboardGridStrings(
    val settings: String,
    val remove: String,
    val enterFullscreen: String,
    val exitFullscreen: String,
    val emptyMessage: String,
    val errorMessage: String,
    val retryLabel: String,
    val loadingLabel: String,
    val offlineLabel: String,
)

/**
 * The two decorative chrome glyphs (web lucide `GripHorizontal` / `Settings`), authored as 24×24 stroked vectors the
 * way the shared [TeslaGlyphs] set is — Android ships no lucide equivalent and a feature view may not expand the
 * shared icon library. They render decoratively (null content description); the localized button labels carry the
 * meaning for accessibility services.
 */
private object DashboardGridGlyphs {
    /** A horizontal drag grip: two rows of three round dots (the web `GripHorizontal`). */
    val Grip: ImageVector =
        dashboardGridStroked("GripHorizontal") {
            gridDot(6f, 9f)
            gridDot(12f, 9f)
            gridDot(18f, 9f)
            gridDot(6f, 15f)
            gridDot(12f, 15f)
            gridDot(18f, 15f)
        }

    /** A settings control: two horizontal slider tracks each carrying a knob (the web `Settings` affordance). */
    val Settings: ImageVector =
        dashboardGridStroked("Settings") {
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            gridDot(15f, 9f)
            moveTo(4f, 15f)
            lineTo(20f, 15f)
            gridDot(9f, 15f)
        }
}

/** A round-capped near-zero segment that renders as a dot at ([x], [y]) (a grip point / slider knob). */
private fun PathBuilder.gridDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun dashboardGridStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    DashboardGridStrings(
        settings = "Settings",
        remove = "Remove",
        enterFullscreen = "Enter fullscreen",
        exitFullscreen = "Exit fullscreen",
        emptyMessage = "You can customize this dashboard. Tap the + to add widgets.",
        errorMessage = "Something went wrong on our end. Please try again.",
        retryLabel = "Retry",
        loadingLabel = "Loading...",
        offlineLabel = "Offline",
    )

private val PREVIEW_LAYOUT =
    DashboardLayout(
        widgets =
            listOf(
                DashboardWidget(id = "w-1", widgetId = "vehicle-hero", name = "Vehicle", defaultSize = WidgetSize(2, 2)),
                DashboardWidget(id = "w-2", widgetId = "battery-gauge", name = "Battery", defaultSize = WidgetSize(1, 2)),
                DashboardWidget(id = "w-3", widgetId = "range-bar", name = "Range", defaultSize = WidgetSize(1, 1)),
                DashboardWidget(id = "w-4", widgetId = "fleet-stats", name = "Fleet Stats", defaultSize = WidgetSize(2, 1)),
            ),
        layouts =
            mapOf(
                DashboardBreakpoint.Lg to
                    listOf(
                        WidgetLayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                        WidgetLayoutItem("w-2", x = 2, y = 0, w = 1, h = 2),
                        WidgetLayoutItem("w-3", x = 3, y = 0, w = 1, h = 1),
                        WidgetLayoutItem("w-4", x = 0, y = 2, w = 2, h = 1),
                    ),
                DashboardBreakpoint.Xs to
                    listOf(
                        WidgetLayoutItem("w-1", x = 0, y = 0, w = 1, h = 2),
                        WidgetLayoutItem("w-2", x = 0, y = 2, w = 1, h = 2),
                        WidgetLayoutItem("w-3", x = 0, y = 4, w = 1, h = 1),
                        WidgetLayoutItem("w-4", x = 0, y = 5, w = 1, h = 1),
                    ),
            ),
    )

@Composable
private fun previewWidgetBody(
    widget: DashboardWidget,
    size: WidgetSize,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionTitle(widget.name)
        Caption("${size.cols}×${size.rows}")
        BodyText(widget.widgetId, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 1200)
@Composable
private fun DashboardGridLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state = UiState(UiPhase.Loading),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 1200)
@Composable
private fun DashboardGridEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state = UiState(UiPhase.Empty, data = DashboardLayout()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 1200)
@Composable
private fun DashboardGridErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}

@Preview(name = "Content (desktop grid)", showBackground = true, widthDp = 1200)
@Composable
private fun DashboardGridContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state = UiState(UiPhase.Content, data = PREVIEW_LAYOUT),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}

@Preview(name = "Edit mode (desktop grid)", showBackground = true, widthDp = 1200)
@Composable
private fun DashboardGridEditPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state = UiState(UiPhase.Content, data = PREVIEW_LAYOUT),
            onRetry = {},
            options = DashboardGridOptions(editMode = true, showWidgetBorders = true),
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}

@Preview(name = "Content (mobile stack)", showBackground = true, widthDp = 360)
@Composable
private fun DashboardGridMobilePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state = UiState(UiPhase.Content, data = PREVIEW_LAYOUT),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 1200)
@Composable
private fun DashboardGridOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DashboardGridContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_LAYOUT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            strings = PREVIEW_STRINGS,
            widgetContent = { w, s -> previewWidgetBody(w, s) },
        )
    }
}
