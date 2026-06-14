// The native Jetpack Compose + Material 3 Door & Window Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a door-iconed title + freshness header) wrapping
// either two shared `WidgetStatusGrid`s — a Doors section and a Windows section, each a two-column grid of
// front-left / front-right / rear-left / rear-right cells with a status-toned wash + dot — or, at the 1×1
// `isCompact` footprint, two summary badges, or a friendly empty state when no security snapshot is present.
// All data flows through the shared [DoorWindowStatusWidgetViewModel] (P1/S8); the view never performs HTTP.
// Every string resolves through the i18n catalog (P1/S10), and every status cell carries a merged TalkBack
// label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DoorWindowStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.doorwindowstatus

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Binds the shared vehicles + latest-security feeds via [source] into a
 * [DoorWindowStatusWidgetViewModel], resolves the localized [DoorWindowStatusStrings] from the catalog
 * (P1/S10), records the one-shot `view.opened` diagnostic, and renders the surface. A dashboard host
 * supplies [source] (an adapter over the shared S8 vehicles data layer), the placement [size] (web
 * `WidgetProps.size`), and a unique [instanceKey] per placement; an explicit [vehicleId] pins the surface
 * to one vehicle (web `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun DoorWindowStatusWidget(
    source: DoorWindowStatusSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: DoorWindowStatusSize = DoorWindowStatusRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DoorWindowStatusRegistration.ID,
) {
    val viewModel: DoorWindowStatusWidgetViewModel =
        viewModel(key = instanceKey, factory = DoorWindowStatusWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberDoorWindowStatusStrings()

    DoorWindowStatusWidgetContent(
        state = state,
        strings = strings,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the door title + freshness header
 * over either the two status grids, the two compact summary badges (`isCompact`), or the empty state. The
 * web widget does not pass `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the
 * header freshness chip (offline) + the refresh control (the retry affordance) above the empty body — never
 * a blanked panel — and a stale/offline cached snapshot keeps its cells visible with the freshness chip
 * flagged.
 */
@Composable
fun DoorWindowStatusWidgetContent(
    state: UiState<JsonElement>,
    strings: DoorWindowStatusStrings,
    modifier: Modifier = Modifier,
    size: DoorWindowStatusSize = DoorWindowStatusRegistration.DEFAULT_SIZE,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> DoorWindowLoading(modifier)
        else -> DoorWindowLoaded(state = state, strings = strings, size = size, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun DoorWindowLoaded(
    state: UiState<JsonElement>,
    strings: DoorWindowStatusStrings,
    size: DoorWindowStatusSize,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val display = remember(state.data, size, strings) { DoorWindowStatusProjection.project(state.data, size, strings) }
    Column(modifier = modifier.fillMaxSize()) {
        DoorWindowHeader(state = state, title = strings.title, showTitle = !display.compact, onRefresh = onRefresh)
        if (display.compact && display.hasData) {
            DoorWindowBadges(
                doorBadge = display.doorBadge,
                windowBadge = display.windowBadge,
                modifier =
                    Modifier
                        .fillMaxSize()
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            )
        } else {
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(if (display.tall) Spacing.md else Spacing.sm),
            ) {
                if (display.hasData) {
                    DoorWindowSection(title = strings.doors, cells = display.doorCells)
                    DoorWindowSection(title = strings.windows, cells = display.windowCells)
                } else {
                    DoorWindowEmpty(strings.noData)
                }
            }
        }
    }
}

@Composable
private fun DoorWindowHeader(
    state: UiState<*>,
    title: String,
    showTitle: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DoorWindowDoorOpenGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        if (showTitle) {
            PanelTitle(
                title,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/**
 * One labelled status section — the native analogue of a web `<div><h4>…</h4><WidgetStatusGrid/></div>`
 * pair. The [title] is exposed as an accessibility heading above its two-column grid of [cells].
 */
@Composable
private fun DoorWindowSection(
    title: String,
    cells: List<DoorWindowCell>,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(title, modifier = Modifier.semantics { heading() })
        DoorWindowGrid(cells)
    }
}

/**
 * The two-column status grid — the native analogue of the web `WidgetStatusGrid cols={2}`. The four cells
 * are laid out in fixed pairs (the web widget always renders `grid-cols-2`); a defensive spacer keeps the
 * final row aligned if an odd cell count is ever passed.
 */
@Composable
private fun DoorWindowGrid(cells: List<DoorWindowCell>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        cells.chunked(GRID_COLUMNS).forEach { rowCells ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowCells.forEach { cell ->
                    DoorWindowStatusCell(cell = cell, modifier = Modifier.weight(1f))
                }
                repeat(GRID_COLUMNS - rowCells.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun DoorWindowStatusCell(
    cell: DoorWindowCell,
    modifier: Modifier = Modifier,
) {
    val tone = cellStatusColor(cell.status)
    val description = "${cell.label}, ${cell.value}"
    Surface(
        modifier =
            modifier
                .heightIn(min = CELL_MIN_HEIGHT)
                .semantics(mergeDescendants = true) { contentDescription = description },
        shape = RoundedCornerShape(Radius.md),
        color = tone.copy(alpha = CELL_WASH_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CELL_BORDER_WIDTH, tone.copy(alpha = CELL_BORDER_ALPHA)),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.sm, vertical = Spacing.sm),
            ) {
                Caption(cell.label)
                BodyText(cell.value, maxLines = 1)
            }
            Box(
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(Spacing.xs)
                        .size(CELL_DOT_SIZE)
                        .clip(CircleShape)
                        .background(tone),
            )
        }
    }
}

/**
 * The compact (1×1) summary — the native analogue of the two web `<Badge>`s. Each chip is success-toned
 * when its group is all-closed and warning-toned when something is open, carrying the localized count.
 */
@Composable
private fun DoorWindowBadges(
    doorBadge: DoorWindowBadge,
    windowBadge: DoorWindowBadge,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        DoorWindowSummaryBadge(doorBadge)
        DoorWindowSummaryBadge(windowBadge)
    }
}

@Composable
private fun DoorWindowSummaryBadge(badge: DoorWindowBadge) {
    Badge(
        text = badge.text,
        variant = if (badge.isWarning) BadgeVariant.Warning else BadgeVariant.Success,
    )
}

@Composable
private fun DoorWindowEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DoorWindowDoorOpenGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DoorWindowLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

/** Per-status cell foreground colour — the native mirror of the web `statusStyles` map (dot + wash tint). */
@Composable
private fun cellStatusColor(status: CellStatus): Color =
    when (status) {
        CellStatus.Ok -> TeslaTokens.status.success
        CellStatus.Warning -> TeslaTokens.status.warning
        CellStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Resolves the localized [DoorWindowStatusStrings] from the i18n catalog (P1/S10) — the fifteen
 * `widget.doorWindow.*` keys the web component reads via `t('widget.doorWindow.…')`. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberDoorWindowStatusStrings(): DoorWindowStatusStrings {
    val title = stringResource(R.string.translation_widget_doorWindow_title)
    val doors = stringResource(R.string.translation_widget_doorWindow_doors)
    val windows = stringResource(R.string.translation_widget_doorWindow_windows)
    val closed = stringResource(R.string.translation_widget_doorWindow_closed)
    val open = stringResource(R.string.translation_widget_doorWindow_open)
    val partial = stringResource(R.string.translation_widget_doorWindow_partial)
    val frontLeft = stringResource(R.string.translation_widget_doorWindow_fl)
    val frontRight = stringResource(R.string.translation_widget_doorWindow_fr)
    val rearLeft = stringResource(R.string.translation_widget_doorWindow_rl)
    val rearRight = stringResource(R.string.translation_widget_doorWindow_rr)
    val doorsAllClosed = stringResource(R.string.translation_widget_doorWindow_doorsAllClosed)
    val doorsOpen = stringResource(R.string.translation_widget_doorWindow_doorsOpen)
    val windowsAllClosed = stringResource(R.string.translation_widget_doorWindow_windowsAllClosed)
    val windowsOpen = stringResource(R.string.translation_widget_doorWindow_windowsOpen)
    val noData = stringResource(R.string.translation_widget_doorWindow_noData)
    return remember(
        title,
        doors,
        windows,
        closed,
        open,
        partial,
        frontLeft,
        frontRight,
        rearLeft,
        rearRight,
        doorsAllClosed,
        doorsOpen,
        windowsAllClosed,
        windowsOpen,
        noData,
    ) {
        DoorWindowStatusStrings(
            title = title,
            doors = doors,
            windows = windows,
            closed = closed,
            open = open,
            partial = partial,
            frontLeft = frontLeft,
            frontRight = frontRight,
            rearLeft = rearLeft,
            rearRight = rearRight,
            doorsAllClosed = doorsAllClosed,
            doorsOpen = doorsOpen,
            windowsAllClosed = windowsAllClosed,
            windowsOpen = windowsOpen,
            noData = noData,
        )
    }
}

/**
 * Builds the localized relative-age formatter the header freshness chip folds [FreshnessAge] buckets
 * through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
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

// ── Local glyph — the web lucide `DoorOpen` icon (used for the header + empty state), authored as a 24×24
// stroked vector. The data-display layer ships Lock + Shield but not this, and this surface's allowed files
// cannot extend that catalog, so it is hand-authored here, mirroring the approach in
// components/datadisplay/DataDisplayGlyphs and the sibling SecurityStatusWidget's local glyphs. ───────────

private fun doorWindowStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val DoorWindowDoorOpenGlyph: ImageVector =
    doorWindowStroked("DoorWindowDoorOpen") {
        // Open door leaf (angled top edge reads as ajar).
        moveTo(6f, 4f)
        lineTo(15f, 3f)
        lineTo(15f, 21f)
        lineTo(6f, 21f)
        close()
        // Frame on the hinge side.
        moveTo(15f, 3f)
        lineTo(18f, 4.5f)
        lineTo(18f, 21f)
        // Floor line.
        moveTo(4f, 21f)
        lineTo(20f, 21f)
        // Knob.
        moveTo(8.5f, 12f)
        lineTo(9.5f, 12f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val GRID_COLUMNS = 2
private val CELL_MIN_HEIGHT = 44.dp
private val CELL_DOT_SIZE = 8.dp
private val CELL_BORDER_WIDTH = 1.dp
private const val CELL_WASH_ALPHA = 0.12f
private const val CELL_BORDER_ALPHA = 0.24f
private const val LOADING_BAR_COUNT = 4
private val LOADING_BAR_HEIGHT = 16.dp

// ── Previews — one per rendered state (content / compact / empty / loading / error / offline). ───────────

private fun previewSecurity(): JsonElement =
    buildJsonObject {
        put("door_state", "driver_front_open")
        put("fd_window", "closed")
        put("fp_window", "vent")
        put("rd_window", "closed")
        put("rp_window", "closed")
    }

@Preview(name = "Door & window · content", showBackground = true)
@Composable
private fun DoorWindowContentPreview() {
    TeslaSyncTheme {
        DoorWindowStatusWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSecurity(), fetchedAt = System.currentTimeMillis()),
            strings = rememberDoorWindowStatusStrings(),
            size = DoorWindowStatusSize(cols = 2, rows = 2),
        )
    }
}

@Preview(name = "Door & window · compact", showBackground = true)
@Composable
private fun DoorWindowCompactPreview() {
    TeslaSyncTheme {
        DoorWindowStatusWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSecurity(), fetchedAt = System.currentTimeMillis()),
            strings = rememberDoorWindowStatusStrings(),
            size = DoorWindowStatusSize(cols = 1, rows = 1),
        )
    }
}

@Preview(name = "Door & window · empty", showBackground = true)
@Composable
private fun DoorWindowEmptyPreview() {
    TeslaSyncTheme {
        DoorWindowStatusWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            strings = rememberDoorWindowStatusStrings(),
        )
    }
}

@Preview(name = "Door & window · loading", showBackground = true)
@Composable
private fun DoorWindowLoadingPreview() {
    TeslaSyncTheme {
        DoorWindowStatusWidgetContent(state = UiState.loading(), strings = rememberDoorWindowStatusStrings())
    }
}

@Preview(name = "Door & window · error", showBackground = true)
@Composable
private fun DoorWindowErrorPreview() {
    TeslaSyncTheme {
        DoorWindowStatusWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = rememberDoorWindowStatusStrings(),
        )
    }
}

@Preview(name = "Door & window · offline (cached)", showBackground = true)
@Composable
private fun DoorWindowOfflinePreview() {
    TeslaSyncTheme {
        DoorWindowStatusWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSecurity(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = rememberDoorWindowStatusStrings(),
        )
    }
}
