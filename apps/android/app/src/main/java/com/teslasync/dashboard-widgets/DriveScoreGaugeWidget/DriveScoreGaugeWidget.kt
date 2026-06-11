// The native Jetpack Compose + Material 3 Drive Score Gauge dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DriveScoreGaugeWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while loading, a `QueryError` retry surface on hard failure, otherwise the title + gauge
// icon + freshness header for the standard footprint, or a header-less frame for the 1×1 compact
// footprint) wrapping the web `WidgetGaugeHero`: a radial gauge of the weekly score (colored by the
// score band) with the letter grade beneath it, the three sub-score stats, and — when the footprint is
// two-or-more rows tall — a per-category breakdown of efficiency / smoothness / speed-discipline bars.
// When no score resolves it shows the friendly "No score yet" empty state. All data flows through the
// shared [DriveScoreGaugeWidgetViewModel] (P1/S8); the view never performs HTTP. Every string resolves
// through the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveScoreGaugeWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivescoregauge

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

private val GAUGE_SIZE_STANDARD = 104.dp
private val GAUGE_SIZE_COMPACT = 72.dp
private val SKELETON_HEADER_HEIGHT = 14.dp
private val SKELETON_GAUGE_HEIGHT = 96.dp
private const val SKELETON_HEADER_WIDTH_FRACTION = 0.5f

/**
 * Stateful entry point. Collects the shared [DriveScoreGaugeWidgetViewModel] state, records the
 * one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies the view-model (wired via [DriveScoreGaugeWidgetViewModel.create]).
 */
@Composable
fun DriveScoreGaugeWidget(
    viewModel: DriveScoreGaugeWidgetViewModel,
    modifier: Modifier = Modifier,
    size: DriveScoreGaugeSize = DriveScoreGaugeRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    DriveScoreGaugeWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the header over
 * the gauge hero, or the "No score yet" empty state. Stale (non-error) data auto-refreshes, mirroring
 * the web freshness contract.
 */
@Composable
fun DriveScoreGaugeWidgetContent(
    state: UiState<DriveScoreSnapshot?>,
    size: DriveScoreGaugeSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> DriveScoreGaugeLoading()
            state.isError -> DriveScoreGaugeError(state = state, onRetry = onRefresh)
            else -> DriveScoreGaugeLoaded(state = state, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun DriveScoreGaugeLoaded(
    state: UiState<DriveScoreSnapshot?>,
    size: DriveScoreGaugeSize,
    onRefresh: () -> Unit,
) {
    DriveScoreGaugeHeader(state = state, size = size, onRefresh = onRefresh)
    val labels = rememberDriveScoreGaugeLabels()
    val snapshot = state.data
    if (snapshot != null) {
        val display = remember(snapshot, labels) { DriveScoreGaugeProjection.project(snapshot, labels) }
        DriveScoreGaugeHero(display = display, size = size)
    } else {
        DriveScoreGaugeEmpty()
    }
}

@Composable
private fun DriveScoreGaugeHeader(
    state: UiState<*>,
    size: DriveScoreGaugeSize,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!size.isCompact) {
            Icon(
                imageVector = DataDisplayGlyphs.Gauge,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(
                stringResource(R.string.translation_widget_driveScoreGauge_title),
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
            fetchingLabel = stringResource(R.string.translation_freshness_updating),
            errorLabel = stringResource(R.string.translation_freshness_error),
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

@Composable
private fun DriveScoreGaugeHero(
    display: DriveScoreGaugeDisplay,
    size: DriveScoreGaugeSize,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = display.gaugeValue,
            max = DriveScoreGaugeProjection.SCORE_MAX,
            label = display.gradeLabel,
            unit = display.weeklyLabel,
            color = bandColor(display.band),
            size = if (size.isCompact) GAUGE_SIZE_COMPACT else GAUGE_SIZE_STANDARD,
        )
        if (!size.isCompact && display.breakdown.isNotEmpty()) {
            DriveScoreStatRow(items = display.breakdown)
        }
        if (!size.isCompact && size.isTall) {
            DriveScoreBars(items = display.breakdown)
        }
    }
}

@Composable
private fun DriveScoreStatRow(items: List<DriveScoreBreakdownItem>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Top,
    ) {
        items.forEach { item ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                MetricLabel(item.label)
                Heading(item.valueText, level = HeadingLevel.Sub)
            }
        }
    }
}

@Composable
private fun DriveScoreBars(items: List<DriveScoreBreakdownItem>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        items.forEach { item ->
            MetricBar(
                value = item.value,
                max = DriveScoreGaugeProjection.SCORE_MAX,
                label = item.label,
                valueText = item.valueText,
                color = bandColor(item.band),
            )
        }
    }
}

@Composable
private fun DriveScoreGaugeEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_driveScoreGauge_noData),
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DriveScoreGaugeLoading() {
    val label = stringResource(R.string.translation_widget_driveScoreGauge_title)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_HEADER_WIDTH_FRACTION, height = SKELETON_HEADER_HEIGHT)
        Skeleton(height = SKELETON_GAUGE_HEIGHT, rounded = true)
    }
}

@Composable
private fun DriveScoreGaugeError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry)
    }
}

/**
 * Builds the localized [DriveScoreGaugeLabels] from the i18n catalog (P1/S10) — the four
 * `widget.driveScoreGauge.*` keys the web component reads via `t('widget.…')`. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberDriveScoreGaugeLabels(): DriveScoreGaugeLabels {
    val weekly = stringResource(R.string.translation_widget_driveScoreGauge_weekly)
    val efficiency = stringResource(R.string.translation_widget_driveScoreGauge_efficiency)
    val smoothness = stringResource(R.string.translation_widget_driveScoreGauge_smoothness)
    val speed = stringResource(R.string.translation_widget_driveScoreGauge_speed)
    return remember(weekly, efficiency, smoothness, speed) {
        DriveScoreGaugeLabels(weekly = weekly, efficiency = efficiency, smoothness = smoothness, speed = speed)
    }
}

/** Maps a score [DriveScoreBand] onto its semantic color (web `SCORE_COLORS`). */
@Composable
private fun bandColor(band: DriveScoreBand): Color =
    when (band) {
        DriveScoreBand.Excellent -> TeslaTokens.status.success
        DriveScoreBand.Good -> TeslaTokens.status.info
        DriveScoreBand.Fair -> TeslaTokens.status.warning
        DriveScoreBand.Poor -> TeslaTokens.status.danger
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
