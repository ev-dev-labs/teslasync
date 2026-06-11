package io.teslasync.android.dashboardwidgets

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.admin.AdminStore
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/*
 * The native Android (Jetpack Compose + Material 3) Backup Monitor dashboard surface — a parity port
 * of web/src/features/dashboard/widgets/BackupMonitorWidget.tsx. It mirrors the web `WidgetShell`
 * (skeleton while loading, a `QueryError` retry surface on a hard failure, otherwise a HardDrive title
 * + freshness header) wrapping one of three bodies:
 *  - the compact (1-col) status line — a status-toned dot + the latest run's relative time + "Last backup";
 *  - the standard (2-col) 2×2 stat grid — "Last backup", "Backup Size", "Type" and a status cell whose
 *    badge (and red tint when failed) reflects the latest run;
 *  - the wide (4-col+) layout — that grid plus the newest-first "Recent Runs" feed.
 * When there are no runs it shows the "no backup data" empty state. All data flows through the shared
 * [BackupMonitorStateHolder] (S8-backed); the view never performs HTTP. Every string resolves through
 * the i18n catalog and every interactive element carries a TalkBack name.
 */

/** Stateful entry: binds a [BackupRunsSource] and renders the surface for [size]. */
@Composable
fun BackupMonitorWidget(
    source: BackupRunsSource,
    size: BackupMonitorSize,
    modifier: Modifier = Modifier,
    diagnostics: BackupMonitorDiagnostics = remember { BackupMonitorDiagnostics() },
    nowMillis: () -> Long = { System.currentTimeMillis() },
) {
    val scope = rememberCoroutineScope()
    val formatTimestamp = rememberWidgetTimestampFormatter()
    val holder = remember(source) { BackupMonitorStateHolder(source, scope, nowMillis, formatTimestamp) }
    val state by holder.state.collectAsStateWithLifecycle()

    // P1/S11 diagnostics: emit `view.opened slug=BackupMonitorWidget` once per surface mount.
    LaunchedEffect(diagnostics) { diagnostics.recordViewOpened() }

    BackupMonitorWidgetContent(state = state, size = size, onRetry = holder::retry, modifier = modifier)
}

/**
 * Convenience entry that binds the shared S8 [AdminStore] `backupRuns()` feed (web `useBackupRuns`).
 * A dashboard host wires this with the store from the app data graph.
 */
@Composable
fun BackupMonitorWidget(
    adminStore: AdminStore,
    size: BackupMonitorSize,
    modifier: Modifier = Modifier,
    diagnostics: BackupMonitorDiagnostics = remember { BackupMonitorDiagnostics() },
) {
    val source = remember(adminStore) { AdminStoreBackupRunsSource(adminStore) }
    BackupMonitorWidget(source = source, size = size, modifier = modifier, diagnostics = diagnostics)
}

/**
 * Stateless renderer — switches on [state] exactly as the web component does: a skeleton while
 * loading, the `QueryError` retry surface on a hard error, otherwise the freshness header over the
 * compact / standard / wide body (or the empty state when there are no runs). Driven directly by the
 * instrumented per-state tests.
 */
@Composable
fun BackupMonitorWidgetContent(
    state: BackupMonitorUiState,
    size: BackupMonitorSize,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize().testTag(BackupMonitorTags.ROOT)) {
        when (state.phase) {
            UiPhase.Loading -> LoadingBody()
            UiPhase.Error -> ErrorBody(state = state, onRetry = onRetry)
            UiPhase.Content, UiPhase.Empty -> {
                WidgetHeader(state = state, compact = size.isCompact, onRetry = onRetry)
                WidgetBody(display = state.display, size = size)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: BackupMonitorUiState,
    compact: Boolean,
    onRetry: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (compact) {
            Box(modifier = Modifier.weight(1f, fill = true))
        } else {
            Row(
                modifier = Modifier.weight(1f, fill = true),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(
                    imageVector = HARD_DRIVE_GLYPH,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.success,
                )
                MetricLabel(
                    text = stringResource(R.string.translation_widget_backupMonitor_title).uppercase(Locale.getDefault()),
                )
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            DataFreshness(
                updatedAtMillis = state.updatedAtMillis,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = compact,
                modifier = Modifier.testTag(BackupMonitorTags.FRESHNESS),
            )
            IconButton(
                imageVector = REFRESH_GLYPH,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRetry,
                enabled = !state.refreshing,
                size = IconSize.Sm,
                modifier = Modifier.testTag(BackupMonitorTags.REFRESH),
            )
        }
    }
}

@Composable
private fun WidgetBody(
    display: BackupMonitorDisplay,
    size: BackupMonitorSize,
) {
    when {
        !display.hasRuns -> EmptyBody()
        size.isCompact -> CompactBody(latest = display.latest)
        else -> StandardBody(display = display, wide = size.isWide)
    }
}

@Composable
private fun EmptyBody() {
    Box(
        modifier = Modifier.fillMaxSize().testTag(BackupMonitorTags.EMPTY),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(
            message = stringResource(R.string.translation_widget_backupMonitor_noData),
            icon = HARD_DRIVE_GLYPH,
        )
    }
}

@Composable
private fun CompactBody(latest: BackupLatest) {
    val lastBackupLabel = stringResource(R.string.translation_widget_backupMonitor_lastBackup)
    val statusText = statusLabel(latest.statusText)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = TOUCH_TARGET)
                .padding(horizontal = Spacing.md)
                .testTag(BackupMonitorTags.COMPACT)
                .semantics(mergeDescendants = true) {
                    contentDescription = "$lastBackupLabel: ${latest.lastBackupValue}, $statusText"
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatusToneDot(tone = latest.statusTone, size = COMPACT_DOT)
        Column(verticalArrangement = Arrangement.spacedBy(TIGHT_GAP)) {
            BodyText(text = latest.lastBackupValue, maxLines = 1)
            MetricLabel(text = lastBackupLabel)
        }
    }
}

@Composable
private fun StandardBody(
    display: BackupMonitorDisplay,
    wide: Boolean,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.md, vertical = Spacing.xs)
                .testTag(BackupMonitorTags.CONTENT),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        StatGrid(latest = display.latest)
        if (wide) RecentRuns(rows = display.recentRuns)
    }
}

@Composable
private fun StatGrid(latest: BackupLatest) {
    Column(
        modifier = Modifier.fillMaxWidth().testTag(BackupMonitorTags.STAT_GRID),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_widget_backupMonitor_lastBackup),
                value = latest.lastBackupValue,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_widget_backupMonitor_size),
                value = latest.sizeValue,
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_widget_backupMonitor_type),
                value = latest.typeValue,
                modifier = Modifier.weight(1f),
            )
            StatusCell(latest = latest, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun StatusCell(
    latest: BackupLatest,
    modifier: Modifier = Modifier,
) {
    val statusHeading = stringResource(R.string.translation_widget_backupMonitor_status)
    val statusText = statusLabel(latest.statusText)
    val cellBackground =
        if (latest.isFailed) TeslaTokens.status.danger.copy(alpha = FAILED_TINT_ALPHA) else Color.Transparent
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.md))
                .background(cellBackground)
                .padding(Spacing.md)
                .semantics(mergeDescendants = true) { contentDescription = "$statusHeading: $statusText" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MetricLabel(text = statusHeading.uppercase(Locale.getDefault()))
        Badge(text = statusText, variant = badgeVariant(latest.statusTone))
    }
}

@Composable
private fun RecentRuns(rows: List<BackupRunRow>) {
    Column(
        modifier = Modifier.fillMaxWidth().testTag(BackupMonitorTags.RECENT_RUNS),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricLabel(text = stringResource(R.string.translation_widget_backupMonitor_recentRuns).uppercase(Locale.getDefault()))
        rows.forEach { row -> RecentRunRow(row = row) }
    }
}

@Composable
private fun RecentRunRow(row: BackupRunRow) {
    val statusText = statusLabel(row.statusText)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = ROW_TINT_ALPHA))
                .heightIn(min = TOUCH_TARGET)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics(mergeDescendants = true) {
                    contentDescription = "${row.timeText}, ${row.subText}, $statusText"
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatusToneDot(tone = row.statusTone, size = ROW_DOT)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(TIGHT_GAP)) {
            BodyText(text = row.timeText, maxLines = 1)
            MetricLabel(text = row.subText)
        }
        Badge(text = statusText, variant = badgeVariant(row.statusTone))
    }
}

@Composable
private fun LoadingBody() {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .testTag(BackupMonitorTags.LOADING)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_BARS) { Skeleton(height = SKELETON_BAR_HEIGHT) }
    }
}

@Composable
private fun ErrorBody(
    state: BackupMonitorUiState,
    onRetry: () -> Unit,
) {
    val kind =
        classifyQueryError(
            status = state.errorStatus,
            online = state.online,
            transientWaiting = state.transientWaiting,
        )
    Box(
        modifier = Modifier.fillMaxSize().testTag(BackupMonitorTags.ERROR),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = kind,
            resourceName = stringResource(R.string.translation_widget_backupMonitor_title),
            onRetry = onRetry,
        )
    }
}

/** A small status-toned dot (web `statusDotColor`). */
@Composable
private fun StatusToneDot(
    tone: BackupStatusTone,
    size: Dp,
) {
    Box(
        modifier =
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(toneColor(tone))
                .clearAndSetSemantics {},
    )
}

@Composable
private fun statusLabel(text: BackupStatusText): String =
    when (text) {
        BackupStatusText.Success -> stringResource(R.string.translation_widget_backupMonitor_statusSuccess)
        BackupStatusText.Running -> stringResource(R.string.translation_widget_backupMonitor_statusRunning)
        BackupStatusText.Queued -> stringResource(R.string.translation_widget_backupMonitor_statusQueued)
        BackupStatusText.Failed -> stringResource(R.string.translation_widget_backupMonitor_statusFailed)
    }

@Composable
private fun toneColor(tone: BackupStatusTone): Color =
    when (tone) {
        BackupStatusTone.Success -> TeslaTokens.status.success
        BackupStatusTone.Warning -> TeslaTokens.status.warning
        BackupStatusTone.Danger -> TeslaTokens.status.danger
    }

private fun badgeVariant(tone: BackupStatusTone): BadgeVariant =
    when (tone) {
        BackupStatusTone.Success -> BadgeVariant.Success
        BackupStatusTone.Warning -> BadgeVariant.Warning
        BackupStatusTone.Danger -> BadgeVariant.Danger
    }

@Composable
private fun rememberWidgetTimestampFormatter(): (Long) -> String {
    val formatter =
        remember {
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(Locale.getDefault())
                .withZone(ZoneId.systemDefault())
        }
    return remember(formatter) { { millis: Long -> formatter.format(Instant.ofEpochMilli(millis)) } }
}

// ── Local line glyphs (web `HardDrive` + a refresh affordance) ───────────────────────────────────

private val HARD_DRIVE_GLYPH: ImageVector =
    widgetGlyph("HardDrive") {
        moveTo(3f, 7f)
        lineTo(21f, 7f)
        lineTo(21f, 17f)
        lineTo(3f, 17f)
        close()
        moveTo(3f, 13f)
        lineTo(21f, 13f)
        moveTo(6.5f, 15f)
        lineTo(6.6f, 15f)
    }

private val REFRESH_GLYPH: ImageVector =
    widgetGlyph("Refresh") {
        moveTo(20f, 11f)
        arcTo(8f, 8f, 0f, true, false, 18f, 16.5f)
        moveTo(20f, 5f)
        lineTo(20f, 11f)
        lineTo(14f, 11f)
    }

private fun widgetGlyph(
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

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private val TOUCH_TARGET = 44.dp
private val COMPACT_DOT = 10.dp
private val ROW_DOT = 8.dp
private val TIGHT_GAP = 2.dp
private val SKELETON_BAR_HEIGHT = 16.dp
private const val SKELETON_BARS = 4
private const val FAILED_TINT_ALPHA = 0.10f
private const val ROW_TINT_ALPHA = 0.04f
