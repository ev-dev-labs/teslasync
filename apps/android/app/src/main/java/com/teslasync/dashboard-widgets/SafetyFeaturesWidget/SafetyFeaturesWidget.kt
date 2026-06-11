// The native Jetpack Compose + Material 3 Safety Features dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx. It mirrors the web `WidgetShell` (a full
// skeleton while the first load is in flight, a `QueryError` retry surface on hard error, otherwise a
// shield-alert title + freshness header) wrapping one of: the compact active-count hero (a single column),
// the ADAS status grid (Forward Collision Warning, Auto Emergency Braking, Lane Departure Avoidance,
// Emergency Lane Departure, Blind Spot Camera, Blind Spot Collision Warning, Speed Limit Warning, Cruise
// Follow Distance — each a status-tinted cell with a corner dot + normalized value), or the "No safety
// data" empty surface when no snapshot resolved. All data flows through the shared
// [SafetyFeaturesWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves through the
// i18n catalog (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SafetyFeaturesWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.safetyfeatures

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
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
 * Stateful entry point. Binds the shared vehicles + latest-safety feeds via [source] into a
 * [SafetyFeaturesWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 vehicles +
 * vehicle-systems data layer) and a unique [instanceKey] per placement; an explicit [vehicleId] pins the
 * surface to one vehicle (web `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun SafetyFeaturesWidget(
    source: SafetyFeaturesSource,
    modifier: Modifier = Modifier,
    size: SafetyFeaturesSize = SafetyFeaturesRegistration.DEFAULT_SIZE,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SafetyFeaturesRegistration.ID,
) {
    val viewModel: SafetyFeaturesWidgetViewModel =
        viewModel(key = instanceKey, factory = SafetyFeaturesWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SafetyFeaturesWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (a first load → full skeleton, a hard `error` → `QueryError` retry) and
 * otherwise the shield-alert title + freshness header over the compact count hero / status grid, or the
 * "No safety data" empty state when no snapshot resolved. A stale/offline cached snapshot keeps its grid
 * visible with the freshness chip flagged.
 */
@Composable
fun SafetyFeaturesWidgetContent(
    state: UiState<JsonElement>,
    size: SafetyFeaturesSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    val strings = rememberSafetyStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val display = remember(state.data, strings) { SafetyFeaturesProjection.project(state.data, strings) }
            LoadedChrome(state = state, size = size, display = display, strings = strings, onRefresh = onRefresh, modifier = modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<JsonElement>,
    size: SafetyFeaturesSize,
    display: SafetyFeaturesDisplay,
    strings: SafetyStrings,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        SafetyHeader(state = state, size = size, strings = strings, onRefresh = onRefresh)
        when {
            !display.hasData ->
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { SafetyEmpty(strings) }

            size.isCompact ->
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CompactCount(display, strings) }

            else ->
                Column(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    SafetyGrid(cells = display.cells, cols = size.gridColumns)
                }
        }
    }
}

@Composable
private fun SafetyHeader(
    state: UiState<*>,
    size: SafetyFeaturesSize,
    strings: SafetyStrings,
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
            imageVector = SafetyShieldAlertGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        // The web hides the title in compact (1-col) mode; the freshness chip + refresh stay available.
        if (size.isCompact) {
            Spacer(modifier = Modifier.weight(1f))
        } else {
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
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

@Composable
private fun SafetyGrid(
    cells: List<SafetyCell>,
    cols: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        cells.chunked(cols).forEach { rowCells ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                rowCells.forEach { cell -> SafetyCellView(cell = cell, modifier = Modifier.weight(1f)) }
                // Pad a short final row so cells keep an even column width (web grid parity).
                repeat(cols - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun SafetyCellView(
    cell: SafetyCell,
    modifier: Modifier,
) {
    val accent = cellAccent(cell.status)
    val semantic = cell.status == SafetyStatus.Ok || cell.status == SafetyStatus.Warning || cell.status == SafetyStatus.Error
    val washColor = accent.copy(alpha = if (semantic) WASH_ALPHA else NEUTRAL_WASH_ALPHA)
    val borderColor = accent.copy(alpha = if (semantic) BORDER_ALPHA else NEUTRAL_BORDER_ALPHA)
    val description = "${cell.label}, ${cell.value}"
    Box(
        modifier =
            modifier
                .heightIn(min = CELL_MIN_HEIGHT)
                .clip(RoundedCornerShape(Radius.lg))
                .background(washColor)
                .border(CELL_BORDER_WIDTH, borderColor, RoundedCornerShape(Radius.lg))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Box(
            modifier =
                Modifier
                    .align(Alignment.TopEnd)
                    .size(STATUS_DOT_SIZE)
                    .clip(CircleShape)
                    .background(accent),
        )
        Column(
            modifier =
                Modifier
                    .align(Alignment.CenterStart)
                    .fillMaxWidth()
                    .padding(end = STATUS_DOT_SIZE + Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(LABEL_VALUE_GAP),
        ) {
            Caption(cell.label)
            BodyText(cell.value, maxLines = 1)
        }
    }
}

@Composable
private fun CompactCount(
    display: SafetyFeaturesDisplay,
    strings: SafetyStrings,
) {
    val countText = SafetyFeaturesProjection.formatCount(display.activeCount)
    Column(
        modifier = Modifier.clearAndSetSemantics { contentDescription = "$countText ${strings.activeFeatures}" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = countText,
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
            color = TeslaTokens.status.success,
        )
        Caption(strings.activeFeatures)
    }
}

@Composable
private fun SafetyEmpty(
    strings: SafetyStrings,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = strings.noData,
        icon = SafetyShieldAlertGlyph,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
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

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        icon = SafetyShieldAlertGlyph,
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

@Composable
private fun cellAccent(status: SafetyStatus): Color =
    when (status) {
        SafetyStatus.Ok -> TeslaTokens.status.success
        SafetyStatus.Warning -> TeslaTokens.status.warning
        SafetyStatus.Error -> TeslaTokens.status.danger
        SafetyStatus.Inactive, SafetyStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Builds the localized [SafetyStrings] from the i18n catalog (P1/S10): the eight ADAS cell labels, the
 * Enabled/Disabled words, the title, the "Active Features" + "No safety data" microcopy, the header
 * refresh/refreshing/offline labels, and the `translation_freshness_*`-backed relative-age formatter the
 * freshness chip folds [FreshnessAge] buckets through — so the pure projection carries no English literal.
 */
@Composable
private fun rememberSafetyStrings(): SafetyStrings {
    val fcw = stringResource(R.string.translation_widget_safety_fcw)
    val aeb = stringResource(R.string.translation_widget_safety_aeb)
    val lda = stringResource(R.string.translation_widget_safety_lda)
    val elda = stringResource(R.string.translation_widget_safety_elda)
    val bsc = stringResource(R.string.translation_widget_safety_bsc)
    val bscw = stringResource(R.string.translation_widget_safety_bscw)
    val slw = stringResource(R.string.translation_widget_safety_slw)
    val cfd = stringResource(R.string.translation_widget_safety_cfd)
    val enabled = stringResource(R.string.translation_widget_safety_enabled)
    val disabled = stringResource(R.string.translation_widget_safety_disabled)
    val title = stringResource(R.string.translation_widget_safety_title)
    val activeFeatures = stringResource(R.string.translation_widget_safety_activeFeatures)
    val noData = stringResource(R.string.translation_widget_safety_noData)
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
        fcw,
        aeb,
        lda,
        elda,
        bsc,
        bscw,
        slw,
        cfd,
        enabled,
        disabled,
        title,
        activeFeatures,
        noData,
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
        SafetyStrings(
            fcw = fcw,
            aeb = aeb,
            lda = lda,
            elda = elda,
            bsc = bsc,
            bscw = bscw,
            slw = slw,
            cfd = cfd,
            enabled = enabled,
            disabled = disabled,
            title = title,
            activeFeatures = activeFeatures,
            noData = noData,
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

// ── Local glyph — the web `ShieldAlert` (lucide), authored as a 24×24 stroked vector. The data-display
// layer ships only a plain `Shield`; this surface's allowed files cannot extend that catalog, so the
// shield-with-alert icon is hand-authored here, mirroring the approach in ClimateStatusWidget's thermometer
// and components/datadisplay/DataDisplayGlyphs. ──

private fun safetyStroked(
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

private val SafetyShieldAlertGlyph: ImageVector =
    safetyStroked("SafetyShieldAlert") {
        // Shield outline (matches DataDisplayGlyphs.Shield geometry).
        moveTo(12f, 3f)
        lineTo(19f, 6f)
        lineTo(19f, 12f)
        curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
        curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
        lineTo(5f, 6f)
        close()
        // Exclamation stem + dot inside the shield (web lucide ShieldAlert: M12 8v4, M12 16h.01).
        moveTo(12f, 8f)
        lineTo(12f, 12f)
        moveTo(12f, 16f)
        lineTo(12.01f, 16f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val LOADING_BAR_COUNT = 6
private val LOADING_BAR_HEIGHT = 16.dp
private val CELL_MIN_HEIGHT = 48.dp
private val CELL_BORDER_WIDTH = 1.dp
private val STATUS_DOT_SIZE = 8.dp
private val LABEL_VALUE_GAP = 2.dp
private const val WASH_ALPHA = 0.10f
private const val BORDER_ALPHA = 0.22f
private const val NEUTRAL_WASH_ALPHA = 0.05f
private const val NEUTRAL_BORDER_ALPHA = 0.12f

// ── Previews — one per rendered state (grid / compact / empty / loading / error / offline). ───────────

private fun previewSafety(): JsonElement =
    buildJsonObject {
        put("forward_collision_warning", "ForwardCollisionSensitivityMedium")
        put("automatic_emergency_braking_off", false)
        put("lane_departure_avoidance", "LaneAssistLevelWarning")
        put("emergency_lane_departure_avoidance", true)
        put("automatic_blind_spot_camera", true)
        put("blind_spot_collision_warning", false)
        put("speed_limit_warning", "SpeedAssistLevelChime")
        put("cruise_follow_distance", "FollowDistance3")
    }

@Preview(name = "Safety · grid", showBackground = true)
@Composable
private fun SafetyGridPreview() {
    TeslaSyncTheme {
        SafetyFeaturesWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSafety(), fetchedAt = System.currentTimeMillis()),
            size = SafetyFeaturesRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Safety · compact", showBackground = true)
@Composable
private fun SafetyCompactPreview() {
    TeslaSyncTheme {
        SafetyFeaturesWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSafety(), fetchedAt = System.currentTimeMillis()),
            size = SafetyFeaturesSize(cols = 1, rows = 2),
        )
    }
}

@Preview(name = "Safety · empty", showBackground = true)
@Composable
private fun SafetyEmptyPreview() {
    TeslaSyncTheme {
        SafetyFeaturesWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            size = SafetyFeaturesRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Safety · loading", showBackground = true)
@Composable
private fun SafetyLoadingPreview() {
    TeslaSyncTheme {
        SafetyFeaturesWidgetContent(state = UiState.loading(), size = SafetyFeaturesRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "Safety · error", showBackground = true)
@Composable
private fun SafetyErrorPreview() {
    TeslaSyncTheme {
        SafetyFeaturesWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = SafetyFeaturesRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "Safety · offline (cached)", showBackground = true)
@Composable
private fun SafetyOfflinePreview() {
    TeslaSyncTheme {
        SafetyFeaturesWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSafety(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            size = SafetyFeaturesRegistration.DEFAULT_SIZE,
        )
    }
}
