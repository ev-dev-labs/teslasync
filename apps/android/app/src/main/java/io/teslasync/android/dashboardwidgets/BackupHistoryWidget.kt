package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * The BackupHistory dashboard widget — the native, Material-3 port of
 * web/src/features/dashboard/widgets/BackupHistoryWidget.tsx. It reproduces every conditional branch of
 * the web source: a bare skeleton while the first load is in flight, a hard-error retry surface, the
 * "no Tesla Energy site linked" and "no backup events" empty states, and the compact (single-column,
 * one stat + ≤3 rows) and standard (two stats + ≤10 rows) content layouts — each with a freshness chip
 * that conveys background-fetch / stale / offline / error honestly. The view is stateless; it collects
 * the shared-store-driven [BackupHistoryWidgetViewModel.state] and forwards refresh.
 */
@Composable
fun BackupHistoryWidget(
    viewModel: BackupHistoryWidgetViewModel,
    modifier: Modifier = Modifier,
    size: BackupHistorySize = BackupHistoryWidgetDescriptor.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onAppear() }
    BackupHistoryWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * The stateless render of the widget for a resolved [state] + [size]. Separated from the ViewModel
 * binding so every branch is exercised by Compose UI tests with hand-built [UiState] inputs.
 */
@Composable
fun BackupHistoryWidgetContent(
    state: UiState<BackupHistorySnapshot>,
    size: BackupHistorySize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.fillMaxSize()) {
        when {
            state.isLoading -> BackupHistoryLoading()
            state.isError -> BackupHistoryError(state = state, onRetry = onRefresh)
            else -> BackupHistoryLoaded(state = state, size = size, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun BackupHistoryLoaded(
    state: UiState<BackupHistorySnapshot>,
    size: BackupHistorySize,
    onRefresh: () -> Unit,
) {
    val snapshot = state.data ?: BackupHistorySnapshot.EMPTY
    val showTitle = !size.isCompact && snapshot.hasSites
    val title = stringResource(R.string.translation_widget_backupHistory_title)
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        BackupHistoryHeader(
            title = if (showTitle) title else null,
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        if (state.isEmpty) {
            BackupHistoryEmpty(hasSites = snapshot.hasSites)
        } else {
            BackupHistoryBody(snapshot = snapshot, size = size)
        }
    }
}

@Composable
private fun BackupHistoryHeader(
    title: String?,
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = DataDisplayGlyphs.Battery,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.chart.battery,
            )
            Caption(text = title, modifier = Modifier.weight(1f))
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = title == null,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun BackupHistoryEmpty(hasSites: Boolean) {
    val message =
        if (hasSites) {
            stringResource(R.string.translation_widget_backupHistory_noEvents)
        } else {
            stringResource(R.string.translation_widget_backupHistory_noSite)
        }
    EmptyState(message = message, icon = DataDisplayGlyphs.Battery)
}

@Composable
private fun BackupHistoryBody(
    snapshot: BackupHistorySnapshot,
    size: BackupHistorySize,
) {
    val durationLabel = stringResource(R.string.translation_widget_backupHistory_duration)
    val outagesLabel = stringResource(R.string.translation_widget_backupHistory_outages30d)
    val avgDurationLabel = stringResource(R.string.translation_widget_backupHistory_avgDuration)
    val display =
        remember(snapshot, size, durationLabel) {
            BackupHistoryProjection.project(snapshot, size, durationLabel, ::formatEventTime)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (display.isCompact) {
            StatCard(label = outagesLabel, value = display.outagesValue, modifier = Modifier.fillMaxWidth())
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                StatCard(label = outagesLabel, value = display.outagesValue, modifier = Modifier.weight(1f))
                StatCard(label = avgDurationLabel, value = display.avgDurationValue, modifier = Modifier.weight(1f))
            }
        }
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            display.rows.forEach { row ->
                BackupEventRowItem(row = row, durationLabel = durationLabel, showSubtitle = !display.isCompact)
            }
        }
    }
}

@Composable
private fun BackupEventRowItem(
    row: BackupEventRow,
    durationLabel: String,
    showSubtitle: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_BACKGROUND_ALPHA))
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics(mergeDescendants = true) { contentDescription = row.accessibilityLabel },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Bolt,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.energy,
        )
        Column(modifier = Modifier.weight(1f)) {
            BodyText(text = row.timeText, maxLines = 1)
            if (showSubtitle) {
                MetricLabel(text = "$durationLabel: ${row.durationText}")
            }
        }
        Badge(text = row.durationText)
    }
}

@Composable
private fun BackupHistoryLoading() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_WIDTH, height = SKELETON_TITLE_HEIGHT)
        Skeleton(height = SKELETON_STAT_HEIGHT, rounded = true)
        SkeletonLines(lines = SKELETON_ROW_COUNT)
    }
}

@Composable
private fun BackupHistoryError(
    state: UiState<BackupHistorySnapshot>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = queryErrorKindFor(state),
        resourceName = stringResource(R.string.translation_widget_backupHistory_title),
        onRetry = onRetry,
    )
}

/** Maps the [UiState] failure classification onto the feedback layer's [QueryErrorKind]. */
internal fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = true,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/** Localized, zone-aware event-time formatter; an absent / unparseable instant renders an em dash. */
private fun formatEventTime(raw: String?): String =
    raw
        ?.let { runCatching { EVENT_TIME_FORMATTER.format(Instant.parse(it)) }.getOrNull() }
        ?: EM_DASH

private val EVENT_TIME_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private const val EM_DASH: String = "\u2014"
private const val ROW_BACKGROUND_ALPHA: Float = 0.35f
private const val SKELETON_TITLE_WIDTH: Float = 0.5f
private const val SKELETON_ROW_COUNT: Int = 4
private val MIN_TOUCH_TARGET = 44.dp
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_STAT_HEIGHT = 48.dp
