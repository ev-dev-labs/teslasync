// File hosts the SystemHealth Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.systemhealth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.SystemHealthDot
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) System Health dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/SystemHealthWidget.tsx`. It mirrors the web `WidgetShell` (a full
 * skeleton while system-health loads, otherwise a Server glyph + title + freshness header) wrapping
 * either the compact centered overall badge + healthy/total service count, or the service-status grid
 * (a green/amber/red dot + label per service) plus the DB Size / Active Conns / Memory / Goroutines
 * stat grid, or a friendly empty state when the `/system/health` feed has not resolved. All data flows
 * through the [SystemHealthWidgetViewModel] (P1/S8); the view performs no HTTP. Every UI string resolves
 * from `strings.xml` (P1/S10) and every interactive control + service row carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared Admin feeds.
 * @param size the grid footprint; controls the compact vs standard layout (web `isCompact`).
 */
@Composable
fun SystemHealthWidget(
    viewModel: SystemHealthWidgetViewModel,
    modifier: Modifier = Modifier,
    size: SystemHealthSize = SystemHealthRegistration.DEFAULT_SIZE,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    SystemHealthWidgetContent(
        state = state,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless System Health panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over cached figures, and the compact
 * 1-column overall-badge layout). Hoisted out of the ViewModel so it is preview- and screenshot-testable
 * for each state. Stale (non-error) data auto-refreshes exactly once, mirroring the web refetch cadence.
 */
@Composable
fun SystemHealthWidgetContent(
    state: UiState<SystemHealthData>,
    size: SystemHealthSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val compact = size.isCompact
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> SystemHealthLoading(compact = compact)
            state.isError -> SystemHealthError(state = state, onRetry = onRetry)
            else -> {
                val data = state.data ?: SystemHealthData.EMPTY
                if (compact) {
                    SystemHealthFreshnessRow(state)
                    if (data.hasData) SystemHealthCompact(data = data) else SystemHealthEmpty()
                } else {
                    SystemHealthHeader(state = state, onRefresh = onRefresh)
                    if (data.hasData) SystemHealthStandard(data = data) else SystemHealthEmpty()
                }
            }
        }
    }
}

@Composable
private fun SystemHealthHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = SystemHealthGlyphs.Server,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        Caption(
            text = stringResource(R.string.translation_widget_systemHealth_title).uppercase(Locale.getDefault()),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
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

/** Top-right freshness chip for the title-less compact layout (web `WidgetShell` overlay). */
@Composable
private fun SystemHealthFreshnessRow(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
}

/** Compact 1-column layout — the overall health badge, the healthy/total service count, and its label. */
@Composable
private fun SystemHealthCompact(data: SystemHealthData) {
    val servicesLabel = stringResource(R.string.translation_widget_systemHealth_services)
    val count = "${data.healthyCount}/${data.serviceCount}"
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = COMPACT_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Badge(text = overallLabel(data.overall), variant = systemOverallBadgeVariant(data.overall))
        MetricValue(count, modifier = Modifier.semantics { contentDescription = "$count $servicesLabel" })
        Caption(servicesLabel)
    }
}

/** Standard layout — the service-status grid plus the DB Size / Active Conns / Memory / Goroutines grid. */
@Composable
private fun SystemHealthStandard(data: SystemHealthData) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        SystemHealthServiceGrid(services = data.services)
        SystemHealthStatGrid(data = data)
    }
}

@Composable
private fun SystemHealthServiceGrid(services: List<SystemService>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        services.chunked(SERVICE_COLUMNS).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                row.forEach { service ->
                    SystemHealthServiceRow(service = service, modifier = Modifier.weight(1f))
                }
                repeat(SERVICE_COLUMNS - row.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SystemHealthServiceRow(
    service: SystemService,
    modifier: Modifier = Modifier,
) {
    val statusWord = serviceLevelLabel(service.level)
    Row(
        modifier =
            modifier
                .heightIn(min = ROW_MIN_HEIGHT)
                .semantics(mergeDescendants = true) { contentDescription = "${service.label}, $statusWord" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SystemHealthDot(health = systemServiceDot(service.level))
        Caption(service.label)
    }
}

@Composable
private fun SystemHealthStatGrid(data: SystemHealthData) {
    val locale = Locale.getDefault()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_widget_systemHealth_dbSize),
                value = data.dbSize,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_widget_systemHealth_activeConns),
                value = SystemHealthProjection.formatActiveConns(data.activeConns, data.maxConns, locale),
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = stringResource(R.string.translation_widget_systemHealth_memory),
                value = SystemHealthProjection.formatMemory(data.memoryMb, locale),
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_widget_systemHealth_goroutines),
                value = SystemHealthProjection.formatGoroutines(data.goroutines, locale),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SystemHealthEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_systemHealth_noData),
        icon = SystemHealthGlyphs.Server,
    )
}

@Composable
private fun SystemHealthLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = COMPACT_LOADING_FRACTION, height = COMPACT_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = TITLE_LOADING_FRACTION, height = TITLE_LOADING_HEIGHT)
            StatGridSkeleton(count = SERVICE_COLUMNS)
            StatGridSkeleton(count = SERVICE_COLUMNS)
        }
    }
}

@Composable
private fun SystemHealthError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = systemHealthErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_systemHealth_title),
        onRetry = onRetry,
    )
}

/** Resolves the localized overall-health label (web `overallLabel`). */
@Composable
private fun overallLabel(overall: SystemOverall): String =
    stringResource(
        when (overall) {
            SystemOverall.Healthy -> R.string.translation_widget_systemHealth_healthy
            SystemOverall.Degraded -> R.string.translation_widget_systemHealth_degraded
            SystemOverall.Down -> R.string.translation_widget_systemHealth_down
        },
    )

/** Resolves a service row's status word for TalkBack (reuses the overall healthy/degraded/down copy). */
@Composable
private fun serviceLevelLabel(level: SystemServiceLevel): String =
    stringResource(
        when (level) {
            SystemServiceLevel.Ok -> R.string.translation_widget_systemHealth_healthy
            SystemServiceLevel.Degraded -> R.string.translation_widget_systemHealth_degraded
            SystemServiceLevel.Down -> R.string.translation_widget_systemHealth_down
        },
    )

// ── Local glyph — the web `Server` (lucide). Authored as a 24×24 stroked vector because the shared
// data-display layer carries no Server glyph (mirrors SignalHealthWidget's local Activity glyph). ──

private fun systemHealthStroked(
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

private object SystemHealthGlyphs {
    /** Two stacked server racks with LED dots (lucide `server`) — header + empty-state icon. */
    val Server: ImageVector =
        systemHealthStroked("SystemHealthServer") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 10f)
            lineTo(3f, 10f)
            close()
            moveTo(3f, 14f)
            lineTo(21f, 14f)
            lineTo(21f, 20f)
            lineTo(3f, 20f)
            close()
            moveTo(6.5f, 7f)
            lineTo(6.51f, 7f)
            moveTo(6.5f, 17f)
            lineTo(6.51f, 17f)
        }
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val SERVICE_COLUMNS = 2
private val COMPACT_MIN_HEIGHT = 88.dp
private val COMPACT_NUMBER_HEIGHT = 32.dp
private val TITLE_LOADING_HEIGHT = 14.dp
private val ROW_MIN_HEIGHT = 44.dp
private const val COMPACT_LOADING_FRACTION = 0.6f
private const val TITLE_LOADING_FRACTION = 0.5f

// ── Previews — one per rendered state (content / compact / empty / loading / error) ──

private const val PREVIEW_NOW = 1_700_000_000_000L

private fun previewData(): SystemHealthData =
    SystemHealthData(
        overall = SystemOverall.Degraded,
        services =
            listOf(
                SystemService("database", "Database", SystemServiceLevel.Ok),
                SystemService("mqtt", "Mqtt", SystemServiceLevel.Ok),
                SystemService("tesla_api", "Tesla Api", SystemServiceLevel.Degraded),
                SystemService("fleet_telemetry", "Fleet Telemetry", SystemServiceLevel.Down),
            ),
        healthyCount = 2,
        dbSize = "1.2 GB",
        activeConns = 4,
        maxConns = 25,
        memoryMb = 312,
        goroutines = 148,
        resolved = true,
    )

@Preview(name = "SystemHealth · content", showBackground = true)
@Composable
private fun SystemHealthContentPreview() {
    TeslaSyncTheme {
        SystemHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = SystemHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SystemHealth · compact", showBackground = true)
@Composable
private fun SystemHealthCompactPreview() {
    TeslaSyncTheme {
        SystemHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = SystemHealthSize(cols = 1, rows = 2),
        )
    }
}

@Preview(name = "SystemHealth · empty", showBackground = true)
@Composable
private fun SystemHealthEmptyPreview() {
    TeslaSyncTheme {
        SystemHealthWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = SystemHealthData.EMPTY, fetchedAt = 1L),
            size = SystemHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SystemHealth · loading", showBackground = true)
@Composable
private fun SystemHealthLoadingPreview() {
    TeslaSyncTheme {
        SystemHealthWidgetContent(
            state = UiState(phase = UiPhase.Loading),
            size = SystemHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "SystemHealth · error", showBackground = true)
@Composable
private fun SystemHealthErrorPreview() {
    TeslaSyncTheme {
        SystemHealthWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            size = SystemHealthRegistration.DEFAULT_SIZE,
        )
    }
}
