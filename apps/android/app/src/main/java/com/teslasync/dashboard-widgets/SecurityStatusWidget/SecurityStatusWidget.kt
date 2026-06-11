// The native Jetpack Compose + Material 3 Security Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SecurityStatusWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a shield-iconed title + freshness header)
// wrapping the shared `WidgetStatusGrid` — a two-column grid of lock / sentry / doors / windows status
// cells, each with a status-toned wash + dot and an icon — or a friendly empty state when no security
// snapshot is present. All data flows through the shared [SecurityStatusWidgetViewModel] (P1/S8); the view
// never performs HTTP. Every string resolves through the i18n catalog (P1/S10), and every status cell
// carries a merged TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SecurityStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.securitystatus

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
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
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
 * [SecurityStatusWidgetViewModel], resolves the localized [SecurityStatusStrings] from the catalog (P1/S10),
 * records the one-shot `view.opened` diagnostic, and renders the surface. A dashboard host supplies [source]
 * (an adapter over the shared S8 vehicles data layer) and a unique [instanceKey] per placement; an explicit
 * [vehicleId] pins the surface to one vehicle (web `WidgetProps.vehicleId`), otherwise the first enrolled
 * vehicle is used.
 */
@Composable
fun SecurityStatusWidget(
    source: SecurityStatusSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SecurityStatusRegistration.ID,
) {
    val viewModel: SecurityStatusWidgetViewModel =
        viewModel(key = instanceKey, factory = SecurityStatusWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberSecurityStatusStrings()

    SecurityStatusWidgetContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the shield title + freshness
 * header over the status grid, or the empty state. The web security widget does not pass `WidgetShell`'s
 * `error` prop, so a hard failure is surfaced honestly through the header freshness chip (offline) + the
 * refresh control (the retry affordance) above the empty body — never a blanked panel — and a stale/offline
 * cached snapshot keeps its cells visible with the freshness chip flagged.
 */
@Composable
fun SecurityStatusWidgetContent(
    state: UiState<JsonElement>,
    strings: SecurityStatusStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> SecurityLoading(modifier)
        else -> SecurityLoaded(state = state, strings = strings, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun SecurityLoaded(
    state: UiState<JsonElement>,
    strings: SecurityStatusStrings,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val display = remember(state.data, strings) { SecurityStatusProjection.project(state.data, strings) }
    Column(modifier = modifier.fillMaxSize()) {
        SecurityHeader(state = state, title = strings.security, onRefresh = onRefresh)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (display.hasData) {
                SecurityStatusGrid(display.cells)
            } else {
                SecurityEmpty()
            }
        }
    }
}

@Composable
private fun SecurityHeader(
    state: UiState<*>,
    title: String,
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
            imageVector = DataDisplayGlyphs.Shield,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        PanelTitle(
            title,
            modifier = Modifier.weight(1f).semantics { heading() },
        )
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
 * The two-column status grid — the native analogue of the web `WidgetStatusGrid cols={2}`. The four cells
 * are laid out in fixed pairs (the web widget always renders `grid-cols-2`); a defensive spacer keeps the
 * final row aligned if an odd cell count is ever passed.
 */
@Composable
private fun SecurityStatusGrid(cells: List<SecurityCell>) {
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
                    SecurityStatusCell(cell = cell, modifier = Modifier.weight(1f))
                }
                repeat(GRID_COLUMNS - rowCells.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SecurityStatusCell(
    cell: SecurityCell,
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
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.sm, vertical = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Icon(
                    imageVector = cellIcon(cell),
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Column(modifier = Modifier.weight(1f)) {
                    Caption(cell.label)
                    BodyText(cell.value, maxLines = 1)
                }
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

@Composable
private fun SecurityEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noSecurity),
        icon = DataDisplayGlyphs.Shield,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun SecurityLoading(modifier: Modifier) {
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
        CellStatus.Error -> TeslaTokens.status.danger
        CellStatus.Inactive -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The cell glyph — the native mirror of the web per-cell icon choice: the lock toggles Lock/Unlock with the
 * lock state, sentry toggles ShieldCheck/Shield with sentry mode, and doors/windows are fixed glyphs.
 */
private fun cellIcon(cell: SecurityCell): ImageVector =
    when (cell.kind) {
        SecurityCellKind.Lock -> if (cell.status == CellStatus.Ok) DataDisplayGlyphs.Lock else SecurityUnlockGlyph
        SecurityCellKind.Sentry -> if (cell.status == CellStatus.Ok) SecurityShieldCheckGlyph else DataDisplayGlyphs.Shield
        SecurityCellKind.Doors -> SecurityDoorOpenGlyph
        SecurityCellKind.Windows -> SecurityAppWindowGlyph
    }

/**
 * Resolves the localized [SecurityStatusStrings] from the i18n catalog (P1/S10) — the twelve `widget.*` keys
 * the web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberSecurityStatusStrings(): SecurityStatusStrings {
    val security = stringResource(R.string.translation_widget_security)
    val lock = stringResource(R.string.translation_widget_lock)
    val locked = stringResource(R.string.translation_widget_locked)
    val unlocked = stringResource(R.string.translation_widget_unlocked)
    val sentry = stringResource(R.string.translation_widget_sentry)
    val active = stringResource(R.string.translation_widget_active)
    val off = stringResource(R.string.translation_widget_off)
    val doors = stringResource(R.string.translation_widget_doors)
    val windows = stringResource(R.string.translation_widget_windows)
    val allClosed = stringResource(R.string.translation_widget_allClosed)
    val open = stringResource(R.string.translation_widget_open)
    return remember(security, lock, locked, unlocked, sentry, active, off, doors, windows, allClosed, open) {
        SecurityStatusStrings(
            security = security,
            lock = lock,
            locked = locked,
            unlocked = unlocked,
            sentry = sentry,
            active = active,
            off = off,
            doors = doors,
            windows = windows,
            allClosed = allClosed,
            open = open,
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

// ── Local glyphs — the web lucide icons (Unlock / ShieldCheck / DoorOpen / AppWindow), authored as 24×24
// stroked vectors. The data-display layer ships Lock + Shield (reused above) but not these four, and this
// surface's allowed files cannot extend that catalog, so they are hand-authored here, mirroring the approach
// in components/datadisplay/DataDisplayGlyphs and the sibling ClimateStatusWidget's thermometer. ──────────

private fun securityStroked(
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

private val SecurityUnlockGlyph: ImageVector =
    securityStroked("SecurityUnlock") {
        // Body of the padlock.
        moveTo(5f, 11f)
        lineTo(19f, 11f)
        lineTo(19f, 20f)
        lineTo(5f, 20f)
        close()
        // Shackle, left post + top arc, open on the right (the unlocked state).
        moveTo(8f, 11f)
        lineTo(8f, 8f)
        curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
        curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
    }

private val SecurityShieldCheckGlyph: ImageVector =
    securityStroked("SecurityShieldCheck") {
        // Shield outline (matching DataDisplayGlyphs.Shield).
        moveTo(12f, 3f)
        lineTo(19f, 6f)
        lineTo(19f, 12f)
        curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
        curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
        lineTo(5f, 6f)
        close()
        // Check mark inside.
        moveTo(9f, 12f)
        lineTo(11f, 14f)
        lineTo(15f, 9.5f)
    }

private val SecurityDoorOpenGlyph: ImageVector =
    securityStroked("SecurityDoorOpen") {
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

private val SecurityAppWindowGlyph: ImageVector =
    securityStroked("SecurityAppWindow") {
        // Window frame.
        moveTo(3f, 5f)
        lineTo(21f, 5f)
        lineTo(21f, 19f)
        lineTo(3f, 19f)
        close()
        // Title bar separator.
        moveTo(3f, 9f)
        lineTo(21f, 9f)
        // Two control dots (short round-capped strokes render as dots).
        moveTo(6f, 7f)
        lineTo(6.1f, 7f)
        moveTo(8.5f, 7f)
        lineTo(8.6f, 7f)
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
private const val EM_DASH = "\u2014"

// ── Previews — one per rendered state (content / empty / loading / error / offline). ──────────────────

private fun previewSecurity(): JsonElement =
    buildJsonObject {
        put("locked", true)
        put("sentry_mode", false)
        put("door_state", "df_open")
        put("fd_window", "closed")
        put("fp_window", "closed")
        put("rd_window", "closed")
        put("rp_window", "closed")
    }

@Preview(name = "Security · content", showBackground = true)
@Composable
private fun SecurityContentPreview() {
    TeslaSyncTheme {
        SecurityStatusWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSecurity(), fetchedAt = System.currentTimeMillis()),
            strings = rememberSecurityStatusStrings(),
        )
    }
}

@Preview(name = "Security · empty", showBackground = true)
@Composable
private fun SecurityEmptyPreview() {
    TeslaSyncTheme {
        SecurityStatusWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            strings = rememberSecurityStatusStrings(),
        )
    }
}

@Preview(name = "Security · loading", showBackground = true)
@Composable
private fun SecurityLoadingPreview() {
    TeslaSyncTheme {
        SecurityStatusWidgetContent(state = UiState.loading(), strings = rememberSecurityStatusStrings())
    }
}

@Preview(name = "Security · error", showBackground = true)
@Composable
private fun SecurityErrorPreview() {
    TeslaSyncTheme {
        SecurityStatusWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = rememberSecurityStatusStrings(),
        )
    }
}

@Preview(name = "Security · offline (cached)", showBackground = true)
@Composable
private fun SecurityOfflinePreview() {
    TeslaSyncTheme {
        SecurityStatusWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSecurity(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = rememberSecurityStatusStrings(),
        )
    }
}
