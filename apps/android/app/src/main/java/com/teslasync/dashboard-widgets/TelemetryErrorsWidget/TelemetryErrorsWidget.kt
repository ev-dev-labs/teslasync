// The native Jetpack Compose + Material 3 Telemetry Errors dashboard surface — a parity port of
// web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise the title +
// alert icon + freshness header for the standard footprint, or a freshness-overlaid frame for the
// compact footprint) wrapping either the compact count-and-status hero (1×N), the standard
// header-stats + scrollable aggregated-error feed (2×4+), or — when neither feed has rows — the
// friendly "No telemetry error data" empty state. All data flows through the shared
// [TelemetryErrorsWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves
// through the i18n catalog and the hero / rows / refresh control carry TalkBack labels.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TelemetryErrorsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.telemetryerrors

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN

private val HERO_MIN_HEIGHT = 44.dp
private val ROW_MIN_HEIGHT = 44.dp
private val HEADER_SKELETON_HEIGHT = 14.dp
private val LOADING_ROW_HEIGHT = 32.dp
private const val HEADER_SKELETON_WIDTH_FRACTION = 0.5f
private const val LOADING_ROWS = 3
private const val ROW_BACKGROUND_ALPHA = 0.5f
private const val PREVIEW_NOW = 1_781_000_000_000L

/**
 * Stateful entry point. Collects the shared [TelemetryErrorsWidgetViewModel] state, records the
 * one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies the view-model (wired via [TelemetryErrorsWidgetViewModel.create]).
 */
@Composable
fun TelemetryErrorsWidget(
    viewModel: TelemetryErrorsWidgetViewModel,
    modifier: Modifier = Modifier,
    size: TelemetryErrorsSize = TelemetryErrorsRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    TelemetryErrorsWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard error body or the "No telemetry error data" empty state. [nowMillis] is the clock the
 * relative-time + recent math reads (injectable for deterministic UI tests).
 */
@Composable
fun TelemetryErrorsWidgetContent(
    state: UiState<TelemetryErrorsData>,
    size: TelemetryErrorsSize,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    val labels = rememberTelemetryErrorsLabels()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(state, onRetry, modifier)
        else -> {
            val data = state.data ?: TelemetryErrorsData.EMPTY
            val display =
                remember(data, size, labels) {
                    TelemetryErrorsProjection.project(data, size, labels, nowMillis)
                }
            if (display.isCompact) {
                CompactChrome(state = state, display = display, modifier = modifier)
            } else {
                StandardChrome(state = state, display = display, onRefresh = onRefresh, modifier = modifier)
            }
        }
    }
}

@Composable
private fun CompactChrome(
    state: UiState<TelemetryErrorsData>,
    display: TelemetryErrorsDisplay,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.sm)) {
        if (display.hasData) {
            CompactHero(display = display, modifier = Modifier.align(Alignment.Center))
        } else {
            NoDataEmpty(modifier = Modifier.align(Alignment.Center))
        }
        FreshnessChip(state = state, modifier = Modifier.align(Alignment.TopEnd))
    }
}

@Composable
private fun CompactHero(
    display: TelemetryErrorsDisplay,
    modifier: Modifier = Modifier,
) {
    val errorVinsLabel = stringResource(R.string.translation_widget_telemetryErrors_errorVINs)
    val statusText = statusLabel(display.status)
    val description = "${display.activeVinCountText} $errorVinsLabel, $statusText"
    Column(
        modifier =
            modifier
                .heightIn(min = HERO_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricValue(display.activeVinCountText)
        Caption(errorVinsLabel)
        Badge(text = statusText, variant = statusVariant(display.status))
    }
}

@Composable
private fun StandardChrome(
    state: UiState<TelemetryErrorsData>,
    display: TelemetryErrorsDisplay,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRefresh = onRefresh)
        if (display.hasData) {
            StandardBody(display = display, modifier = Modifier.weight(1f))
        } else {
            Box(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                NoDataEmpty()
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<TelemetryErrorsData>,
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
            imageVector = AlertCircleIcon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.danger,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_telemetryErrors_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        FreshnessChip(state = state)
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun StandardBody(
    display: TelemetryErrorsDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatusRow(display = display)
        if (display.rows.isEmpty()) {
            NoErrorsText()
        } else {
            ErrorFeed(rows = display.rows, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun StatusRow(display: TelemetryErrorsDisplay) {
    val activeVinsText =
        stringResource(R.string.translation_widget_telemetryErrors_activeVINs, display.activeVinCountText)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(activeVinsText, modifier = Modifier.weight(1f))
        Badge(text = statusLabel(display.status), variant = statusVariant(display.status))
    }
}

@Composable
private fun ErrorFeed(
    rows: List<TelemetryErrorRow>,
    modifier: Modifier = Modifier,
) {
    val recentLabel = stringResource(R.string.translation_widget_telemetryErrors_recent)
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        items(rows, key = { it.key }) { row -> ErrorRowItem(row = row, recentLabel = recentLabel) }
    }
}

@Composable
private fun ErrorRowItem(
    row: TelemetryErrorRow,
    recentLabel: String,
) {
    val description = telemetryErrorRowDescription(row, recentLabel)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_BACKGROUND_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                CodeText(row.vin, modifier = Modifier.weight(1f, fill = false))
                if (row.isRecent) {
                    Badge(text = recentLabel, variant = BadgeVariant.Danger, dot = true)
                }
            }
            Caption(row.errorCode)
        }
        Column(horizontalAlignment = Alignment.End) {
            BodyText(row.countText, maxLines = 1)
            Caption(row.lastSeenText)
        }
    }
}

@Composable
private fun NoDataEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_widget_telemetryErrors_noData),
        icon = AlertCircleIcon,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun NoErrorsText(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        Caption(stringResource(R.string.translation_widget_telemetryErrors_noErrors))
    }
}

@Composable
private fun FreshnessChip(
    state: UiState<TelemetryErrorsData>,
    modifier: Modifier = Modifier,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_freshness_updating),
        errorLabel = stringResource(R.string.translation_freshness_error),
        modifier = modifier,
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_widget_telemetryErrors_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(height = HEADER_SKELETON_HEIGHT, rounded = true, widthFraction = HEADER_SKELETON_WIDTH_FRACTION)
        repeat(LOADING_ROWS) { Skeleton(height = LOADING_ROW_HEIGHT, rounded = true) }
    }
}

@Composable
private fun ErrorChrome(
    state: UiState<TelemetryErrorsData>,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.md), contentAlignment = Alignment.Center) {
        QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
    }
}

@Composable
private fun rememberTelemetryErrorsLabels(): TelemetryErrorsLabels =
    TelemetryErrorsLabels(
        unknown = stringResource(R.string.translation_widget_telemetryErrors_unknown),
        justNow = stringResource(R.string.translation_freshness_justNow),
        ago = stringResource(R.string.translation_widget_ago),
    )

/** The localized status chip text (web `statusLabel`). */
@Composable
private fun statusLabel(status: TelemetryErrorsStatus): String =
    stringResource(
        when (status) {
            TelemetryErrorsStatus.Errors -> R.string.translation_widget_telemetryErrors_errors
            TelemetryErrorsStatus.Healthy -> R.string.translation_widget_telemetryErrors_healthy
        },
    )

/** The status chip color (web `statusBadge = activeVINCount > 0 ? 'danger' : 'success'`). */
private fun statusVariant(status: TelemetryErrorsStatus): BadgeVariant =
    when (status) {
        TelemetryErrorsStatus.Errors -> BadgeVariant.Danger
        TelemetryErrorsStatus.Healthy -> BadgeVariant.Success
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

// ── Locally-authored stroked icon (the web `lucide-react` AlertCircle) ──────────────────────────
// Authored here because the app's shared icon set has no equivalent and the shared glyph objects are
// out of this surface's allowed files (the same approach as the sibling ChargingTelemetryWidget's
// glyphs). A 24×24 stroked vector recolored at render time by [Icon]/[EmptyState]'s tint.

private fun lucideIcon(
    name: String,
    block: PathBuilder.() -> Unit,
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
                pathBuilder = block,
            )
        }.build()

/** lucide `alert-circle` — the ring, the exclamation stroke and the dot. */
private val AlertCircleIcon: ImageVector =
    lucideIcon("AlertCircle") {
        moveTo(21f, 12f)
        arcToRelative(9f, 9f, 0f, true, true, -18f, 0f)
        arcToRelative(9f, 9f, 0f, true, true, 18f, 0f)
        close()
        moveTo(12f, 8f)
        lineTo(12f, 12f)
        moveTo(12f, 16f)
        lineToRelative(0.01f, 0f)
    }

// ── Previews — one per rendered state (loading / content / compact / empty / error) ─────────────

private fun sampleVin(
    vin: String,
    active: Boolean,
): FleetTelemetryErrorVIN = FleetTelemetryErrorVIN(id = vin.hashCode().toLong(), vin = vin, active = active)

private fun sampleError(
    vin: String,
    code: String?,
    fetchedAt: String,
): FleetTelemetryError = FleetTelemetryError(vin = vin, errorCode = code, reportedAt = fetchedAt, fetchedAt = fetchedAt)

private fun sampleData(): TelemetryErrorsData =
    TelemetryErrorsData(
        errorVins =
            listOf(
                sampleVin("5YJ3E1EA1KF000001", active = true),
                sampleVin("5YJ3E1EA1KF000002", active = true),
            ),
        errors =
            listOf(
                sampleError("5YJ3E1EA1KF000001", "STREAM_DISCONNECTED", "2026-06-11T17:00:00Z"),
                sampleError("5YJ3E1EA1KF000001", "STREAM_DISCONNECTED", "2026-06-11T16:30:00Z"),
                sampleError("5YJ3E1EA1KF000002", null, "2026-06-10T08:00:00Z"),
            ),
    )

@Preview(name = "TelemetryErrors · standard", showBackground = true)
@Composable
private fun TelemetryErrorsStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleData(), fetchedAt = PREVIEW_NOW),
            size = TelemetryErrorsRegistration.defaultSize,
            onRefresh = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "TelemetryErrors · compact", showBackground = true)
@Composable
private fun TelemetryErrorsCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleData(), fetchedAt = PREVIEW_NOW),
            size = TelemetryErrorsSize(cols = 1, rows = 2),
            onRefresh = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "TelemetryErrors · empty", showBackground = true)
@Composable
private fun TelemetryErrorsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = TelemetryErrorsData.EMPTY, fetchedAt = PREVIEW_NOW),
            size = TelemetryErrorsRegistration.defaultSize,
            onRefresh = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "TelemetryErrors · loading", showBackground = true)
@Composable
private fun TelemetryErrorsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsWidgetContent(
            state = UiState.loading(),
            size = TelemetryErrorsRegistration.defaultSize,
            onRefresh = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "TelemetryErrors · error", showBackground = true)
@Composable
private fun TelemetryErrorsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = TelemetryErrorsRegistration.defaultSize,
            onRefresh = {},
            onRetry = {},
            nowMillis = PREVIEW_NOW,
        )
    }
}
