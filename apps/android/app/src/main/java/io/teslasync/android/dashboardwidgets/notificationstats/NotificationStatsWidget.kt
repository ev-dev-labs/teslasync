// File hosts the NotificationStats Compose surface (stateful + stateless + per-state previews);
// named after the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.notificationstats

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Notification Stats dashboard surface — a parity
 * port of `web/src/features/dashboard/widgets/NotificationStatsWidget.tsx`. It mirrors the web
 * `WidgetShell` (skeleton while loading, a retry surface on error, otherwise a bell + title +
 * freshness header) wrapping either the compact big delivery-rate number, the Total Sent / Delivery
 * Rate / Failed / Active Channels stat grid, and — at wide footprints — the recent delivery-log
 * table, or a friendly empty state. All data flows through the [NotificationStatsWidgetViewModel]
 * (P1/S8); the view performs no HTTP. Every string resolves from `strings.xml` (P1/S10) and every
 * interactive control + log row carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared notifications stats + logs feeds.
 * @param size the grid footprint; controls the compact vs standard vs wide layout (web isCompact/isWide).
 */
@Composable
fun NotificationStatsWidget(
    viewModel: NotificationStatsWidgetViewModel,
    modifier: Modifier = Modifier,
    size: NotificationStatsSize = NotificationStatsRegistration.DEFAULT_SIZE,
) {
    val statsState by viewModel.stats.collectAsStateWithLifecycle()
    val logsState by viewModel.logs.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    NotificationStatsWidgetContent(
        statsState = statsState,
        logsState = logsState,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Notification Stats panel — renders every state the web widget does (loading / content /
 * empty / error, plus stale + offline via the header freshness chip over cached figures, and the
 * compact 1-column big-number layout). Hoisted out of the ViewModel so it is preview- and
 * screenshot-testable for each state.
 */
@Composable
fun NotificationStatsWidgetContent(
    statsState: UiState<NotificationStats>,
    logsState: UiState<List<NotificationLog>>,
    size: NotificationStatsSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    val compact = size.isCompact
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when (notificationStatsSurface(statsState, logsState, compact)) {
            NotificationStatsSurface.Loading -> NotificationStatsLoading(compact = compact)
            NotificationStatsSurface.Error -> NotificationStatsError(state = statsState, onRetry = onRetry)
            NotificationStatsSurface.Empty -> {
                if (compact) NotificationStatsFreshnessRow(statsState) else NotificationStatsHeader(statsState, onRefresh)
                NotificationStatsEmpty()
            }
            NotificationStatsSurface.Content ->
                if (compact) {
                    NotificationStatsCompact(state = statsState)
                } else {
                    NotificationStatsHeader(state = statsState, onRefresh = onRefresh)
                    NotificationStatsBody(statsState = statsState, logsState = logsState, size = size)
                }
        }
    }
}

@Composable
private fun NotificationStatsHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    val title = stringResource(R.string.translation_widget_notificationStats_title)
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = FeedbackGlyphs.Bell,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        Caption(
            text = title.uppercase(Locale.getDefault()),
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
private fun NotificationStatsFreshnessRow(state: UiState<*>) {
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

@Composable
private fun NotificationStatsLoading(compact: Boolean) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (compact) {
            Skeleton(widthFraction = COMPACT_LOADING_FRACTION, height = COMPACT_NUMBER_HEIGHT)
        } else {
            Skeleton(widthFraction = TITLE_LOADING_FRACTION, height = TITLE_LOADING_HEIGHT)
            StatGridSkeleton(count = 2)
            StatGridSkeleton(count = 2)
        }
    }
}

@Composable
private fun NotificationStatsError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = notificationStatsErrorKind(state.errorKind, state.httpStatus),
        resourceName = stringResource(R.string.translation_widget_notificationStats_title),
        onRetry = onRetry,
    )
}

@Composable
private fun NotificationStatsEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_notificationStats_noData),
        icon = FeedbackGlyphs.Bell,
    )
}

/** Compact 1-column layout — the big delivery-rate number, its label, and a failed chip (web `isCompact`). */
@Composable
private fun NotificationStatsCompact(state: UiState<NotificationStats>) {
    val summary = state.data?.let(NotificationStatsSummary::from) ?: return
    val locale = Locale.getDefault()
    val rate = "${NotificationStatsProjection.formatRate(summary.deliveryRate, locale)}%"
    val rateLabel = stringResource(R.string.translation_widget_notificationStats_deliveryRate)
    NotificationStatsFreshnessRow(state)
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = COMPACT_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MetricValue(rate, modifier = Modifier.semantics { contentDescription = "$rate, $rateLabel" })
        MetricLabel(rateLabel)
        if (summary.failed > 0L) {
            val failedText =
                "${NotificationStatsProjection.formatCount(summary.failed, locale)} " +
                    stringResource(R.string.translation_widget_notificationStats_failedLabel)
            Badge(
                text = failedText,
                modifier = Modifier.padding(top = Spacing.xs),
                variant = BadgeVariant.Danger,
            )
        }
    }
}

/** Standard/wide layout — the stat grid plus, at wide footprints, the recent delivery-log table. */
@Composable
private fun NotificationStatsBody(
    statsState: UiState<NotificationStats>,
    logsState: UiState<List<NotificationLog>>,
    size: NotificationStatsSize,
) {
    val summary = statsState.data?.let(NotificationStatsSummary::from) ?: return
    val locale = Locale.getDefault()
    val tiles = remember(summary, locale) { NotificationStatsProjection.tiles(summary, locale) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        NotificationStatGrid(tiles = tiles, columns = if (size.isWide) WIDE_GRID_COLS else STANDARD_GRID_COLS)
        if (size.isWide) {
            val logs = logsState.data.orEmpty()
            val recent = remember(logs) { NotificationStatsProjection.recentLogs(logs, compact = false) }
            if (recent.isNotEmpty()) NotificationStatsLogTable(recent)
        }
    }
}

@Composable
private fun NotificationStatGrid(
    tiles: List<NotificationStatTile>,
    columns: Int,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        tiles.chunked(columns).forEach { rowTiles ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rowTiles.forEach { tile -> NotificationStatTileCard(tile = tile, modifier = Modifier.weight(1f)) }
                repeat(columns - rowTiles.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * One stat tile rendered with the shared [StatCard] — the Android counterpart of the web `StatCard`.
 * The web `valueColor: text-red-400` danger styling on the Failed value is conveyed by the red
 * "Needs attention" trend chip (the Android design system signals danger via toned chips, not colored
 * numerals — guideline #11); the [NotificationStatTile.danger] flag captures the same intent.
 */
@Composable
private fun NotificationStatTileCard(
    tile: NotificationStatTile,
    modifier: Modifier = Modifier,
) {
    val trend = tile.trend
    val statTrend =
        if (trend != null) {
            StatTrend(direction = trend.direction, text = trendText(trend.label), positive = trend.positive)
        } else {
            null
        }
    StatCard(
        label = statLabel(tile.kind),
        value = tile.value,
        modifier = modifier,
        unit = tile.unit,
        icon = statIcon(tile.kind),
        trend = statTrend,
    )
}

@Composable
private fun NotificationStatsLogTable(logs: List<NotificationLog>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Caption(stringResource(R.string.translation_widget_notificationStats_channel), modifier = Modifier.weight(CHANNEL_WEIGHT))
            Caption(stringResource(R.string.translation_widget_notificationStats_type), modifier = Modifier.weight(TYPE_WEIGHT))
            Caption(stringResource(R.string.translation_widget_notificationStats_status), modifier = Modifier.weight(STATUS_WEIGHT))
            Box(modifier = Modifier.weight(TIME_WEIGHT), contentAlignment = Alignment.CenterEnd) {
                Caption(stringResource(R.string.translation_widget_notificationStats_time))
            }
        }
        logs.forEach { log -> NotificationStatsLogRow(log) }
    }
}

@Composable
private fun NotificationStatsLogRow(log: NotificationLog) {
    val channel = log.title.ifBlank { NOTIFICATION_STATS_EM_DASH }
    val type = log.message.ifBlank { NOTIFICATION_STATS_EM_DASH }
    val statusText = log.status.ifBlank { NOTIFICATION_STATS_EM_DASH }
    val time = notificationLogTimeLabel(log.createdAt)
    val description = notificationLogRowDescription(channel, type, statusText, time)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(channel, modifier = Modifier.weight(CHANNEL_WEIGHT), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        BodyText(type, modifier = Modifier.weight(TYPE_WEIGHT), color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Box(modifier = Modifier.weight(STATUS_WEIGHT)) {
            Badge(text = statusText, variant = notificationStatusVariant(log.status), dot = true)
        }
        Box(modifier = Modifier.weight(TIME_WEIGHT), contentAlignment = Alignment.CenterEnd) {
            Caption(time)
        }
    }
}

@Composable
private fun statLabel(kind: NotificationStatKind): String =
    stringResource(
        when (kind) {
            NotificationStatKind.TotalSent -> R.string.translation_widget_notificationStats_totalSent
            NotificationStatKind.DeliveryRate -> R.string.translation_widget_notificationStats_deliveryRate
            NotificationStatKind.Failed -> R.string.translation_widget_notificationStats_failed
            NotificationStatKind.ActiveChannels -> R.string.translation_widget_notificationStats_activeChannels
        },
    )

@Composable
private fun trendText(label: NotificationStatTrendLabel): String =
    when (label) {
        is NotificationStatTrendLabel.Count -> label.text
        NotificationStatTrendLabel.Healthy -> stringResource(R.string.translation_widget_notificationStats_healthy)
        NotificationStatTrendLabel.NeedsAttention -> stringResource(R.string.translation_widget_notificationStats_needsAttention)
    }

private fun statIcon(kind: NotificationStatKind): ImageVector =
    when (kind) {
        NotificationStatKind.TotalSent -> NotificationStatsGlyphs.Send
        NotificationStatKind.DeliveryRate -> DataDisplayGlyphs.CheckCircle
        NotificationStatKind.Failed -> DataDisplayGlyphs.AlertTriangle
        NotificationStatKind.ActiveChannels -> NotificationStatsGlyphs.Radio
    }

/** Resolves a log row's time bucket to a localized label (web `formatLogTime`, i18n words injected). */
@Composable
private fun notificationLogTimeLabel(createdAt: String): String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val ago = stringResource(R.string.translation_widget_ago)
    val time = notificationLogTime(NotificationStatsProjection.parseTimestampMillis(createdAt), System.currentTimeMillis())
    return when (time) {
        NotificationLogTime.Unknown -> NOTIFICATION_STATS_EM_DASH
        NotificationLogTime.JustNow -> justNow
        is NotificationLogTime.MinutesAgo -> "${time.value}m $ago"
        is NotificationLogTime.HoursAgo -> "${time.value}h $ago"
        is NotificationLogTime.Absolute -> formatAbsolute(time.epochMillis)
    }
}

private fun formatAbsolute(epochMillis: Long): String = NOTIFICATION_LOG_ABSOLUTE_FORMATTER.format(Instant.ofEpochMilli(epochMillis))

// ── Local glyphs — the web `Send` + `Radio` (lucide). Authored as 24×24 stroked vectors because the
// shared data-display layer carries no Send/Radio glyph (mirrors ChargeCostTrackerWidget's local dollar). ──

private fun notificationStatsStroked(
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

private object NotificationStatsGlyphs {
    /** Paper-plane "send" glyph (lucide `send`) — the Total Sent tile icon. */
    val Send: ImageVector =
        notificationStatsStroked("NotificationStatsSend") {
            moveTo(22f, 2f)
            lineTo(11f, 13f)
            moveTo(22f, 2f)
            lineTo(15f, 22f)
            lineTo(11f, 13f)
            lineTo(2f, 9f)
            close()
        }

    /** Broadcast "radio" glyph (lucide `radio`) — the Active Channels tile icon. */
    val Radio: ImageVector =
        notificationStatsStroked("NotificationStatsRadio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveToRelative(-2.3f, -2.3f, -2.3f, -6.1f, 0f, -8.5f)
            moveTo(14f, 12f)
            arcToRelative(2f, 2f, 0f, true, true, -4f, 0f)
            arcToRelative(2f, 2f, 0f, true, true, 4f, 0f)
            close()
            moveTo(16.2f, 7.8f)
            curveToRelative(2.3f, 2.3f, 2.3f, 6.1f, 0f, 8.5f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.1f, 19.1f, 19f)
        }
}

private val NOTIFICATION_LOG_ABSOLUTE_FORMATTER: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withZone(ZoneId.systemDefault())

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val STANDARD_GRID_COLS = 2
private const val WIDE_GRID_COLS = 4
private const val CHANNEL_WEIGHT = 1.3f
private const val TYPE_WEIGHT = 1.3f
private const val STATUS_WEIGHT = 1.1f
private const val TIME_WEIGHT = 1f
private const val COMPACT_LOADING_FRACTION = 0.6f
private const val TITLE_LOADING_FRACTION = 0.5f
private val COMPACT_NUMBER_HEIGHT = 28.dp
private val TITLE_LOADING_HEIGHT = 12.dp
private val COMPACT_MIN_HEIGHT = 56.dp

// ── Previews — one per rendered state (content / wide+table / compact / empty / loading / error). ──

private fun previewStats(): NotificationStats =
    NotificationStats(totalSent = 1284, sent = 1252, failed = 6, pending = 2, totalChannels = 4, enabledChannels = 3)

private fun previewLogs(): List<NotificationLog> =
    listOf(
        NotificationLog(id = 1, title = "Email", message = "Battery low", status = "sent", createdAt = "2024-01-01T11:59:30Z"),
        NotificationLog(id = 2, title = "Push", message = "Charge complete", status = "pending", createdAt = "2024-01-01T11:30:00Z"),
        NotificationLog(id = 3, title = "Webhook", message = "Sentry triggered", status = "failed", createdAt = "2024-01-01T09:00:00Z"),
    )

@Preview(name = "NotificationStats · content", showBackground = true)
@Composable
private fun NotificationStatsContentPreview() {
    TeslaSyncTheme {
        NotificationStatsWidgetContent(
            statsState = UiState(phase = UiPhase.Content, data = previewStats(), fetchedAt = 1L),
            logsState = UiState(phase = UiPhase.Content, data = previewLogs(), fetchedAt = 1L),
            size = NotificationStatsRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "NotificationStats · wide", showBackground = true)
@Composable
private fun NotificationStatsWidePreview() {
    TeslaSyncTheme {
        NotificationStatsWidgetContent(
            statsState = UiState(phase = UiPhase.Content, data = previewStats(), fetchedAt = 1L),
            logsState = UiState(phase = UiPhase.Content, data = previewLogs(), fetchedAt = 1L),
            size = NotificationStatsSize(cols = 4, rows = 4),
        )
    }
}

@Preview(name = "NotificationStats · compact", showBackground = true)
@Composable
private fun NotificationStatsCompactPreview() {
    TeslaSyncTheme {
        NotificationStatsWidgetContent(
            statsState = UiState(phase = UiPhase.Content, data = previewStats(), fetchedAt = 1L),
            logsState = UiState(phase = UiPhase.Content, data = previewLogs(), fetchedAt = 1L),
            size = NotificationStatsSize(cols = 1, rows = 2),
        )
    }
}

@Preview(name = "NotificationStats · empty", showBackground = true)
@Composable
private fun NotificationStatsEmptyPreview() {
    TeslaSyncTheme {
        NotificationStatsWidgetContent(
            statsState = UiState(phase = UiPhase.Empty, data = null, fetchedAt = 1L),
            logsState = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = 1L),
            size = NotificationStatsRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "NotificationStats · loading", showBackground = true)
@Composable
private fun NotificationStatsLoadingPreview() {
    TeslaSyncTheme {
        NotificationStatsWidgetContent(
            statsState = UiState.loading(),
            logsState = UiState.loading(),
            size = NotificationStatsRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "NotificationStats · error", showBackground = true)
@Composable
private fun NotificationStatsErrorPreview() {
    TeslaSyncTheme {
        NotificationStatsWidgetContent(
            statsState = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            logsState = UiState.loading(),
            size = NotificationStatsRegistration.DEFAULT_SIZE,
        )
    }
}
