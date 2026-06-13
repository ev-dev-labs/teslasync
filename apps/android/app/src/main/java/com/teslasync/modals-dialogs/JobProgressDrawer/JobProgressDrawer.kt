// The native Jetpack Compose + Material 3 JobProgressDrawer overlay — a parity port of
// web/src/components/feedback/JobProgressDrawer.tsx. It reproduces that floating, minimizable widget
// end to end: a minimized chip (active spinner + count, or the idle "Exports" pill) and the open
// panel (header with the title, the active-count pill, and the minimize/dismiss affordances; a
// scrollable body with the "In progress" and "Recent" sections). Each row reproduces every datum the
// web row renders — status icon, type + format, the active "status · started <relative>" line or the
// recent "<size> · <relative>" line, the error message, the ready-job download affordance, and the
// failed-job glyph. Every lifecycle state the shared cache-then-network feed can carry is rendered —
// the loading line, a friendly per-section empty state, a hard-error retry surface, and stale/offline
// "last known" with a freshness chip + auto-refresh — so the surface is never a blank box. The view
// performs NO HTTP: it binds the [JobProgressDrawerViewModel] (P1/S8) and renders.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated
// surface directory (com/teslasync/modals-dialogs/JobProgressDrawer) cannot form a valid Kotlin
// package and the file hosts several co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.modalsdialogs.jobprogressdrawer

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.coroutines.delay

private val DRAWER_MAX_WIDTH = 360.dp
private val BODY_MAX_HEIGHT = 360.dp
private val STATUS_ICON = 14.dp
private val CHIP_SPINNER = 14.dp
private const val RELATIVE_TICK_MS = 30_000L
private const val ACTIVE_ROW_ALPHA = 0.45f
private const val META_SEPARATOR = ", "
private const val PREVIEW_NOW = 1_781_320_000_000L

/**
 * Stateful entry point for the JobProgressDrawer overlay. Binds the [viewModel] (P1/S8), records the
 * one-shot PII-safe `view.opened` diagnostic, projects the export-job feed + persisted drawer state
 * onto the render-ready [JobProgressProjection] (re-projected on a 30-second tick so relative-time
 * labels stay current), reproduces the web `useEffect` that promotes a dismissed drawer back to
 * minimized when an active job appears, and floats the surface bottom-end (web `fixed bottom-4
 * right-4`). The host constructs the view-model via [JobProgressDrawerViewModel.create]; this view
 * never performs HTTP.
 */
@Composable
fun JobProgressDrawer(
    viewModel: JobProgressDrawerViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.jobs.collectAsStateWithLifecycle()
    val presentation by viewModel.presentation.collectAsStateWithLifecycle()
    val now = rememberTickingNow()

    val projection =
        remember(state, presentation, now, viewModel.maxRecent) {
            projectJobProgress(
                feed = JobFeedState(state.data ?: emptyList(), state.isLoading, state.isError),
                presentation = presentation,
                maxRecent = viewModel.maxRecent,
                nowMillis = now,
            )
        }

    LaunchedEffect(projection.activeCount) { viewModel.notifyActiveJobs(projection.activeCount) }

    val context = LocalContext.current
    Box(modifier = modifier.fillMaxSize()) {
        JobProgressDrawerContent(
            projection = projection,
            state = state,
            onOpen = viewModel::open,
            onMinimize = viewModel::minimize,
            onDismiss = viewModel::dismiss,
            onDownload = { url -> openDownload(context, url) },
            onRetry = viewModel::retry,
            modifier = Modifier.align(Alignment.BottomEnd).padding(Spacing.md),
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web visibility
 * guards (renders nothing when [JobProgressProjection.visible] is false), the minimized-vs-open
 * branch, and every lifecycle state the open body can carry.
 */
@Composable
fun JobProgressDrawerContent(
    projection: JobProgressProjection,
    state: UiState<List<ExportJobSummary>>,
    onOpen: () -> Unit,
    onMinimize: () -> Unit,
    onDismiss: () -> Unit,
    onDownload: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!projection.visible) return
    when (projection.mode) {
        DrawerMode.Minimized -> MinimizedChip(projection = projection, onOpen = onOpen, modifier = modifier)
        DrawerMode.Open ->
            OpenDrawer(
                projection = projection,
                state = state,
                onMinimize = onMinimize,
                onDismiss = onDismiss,
                onDownload = onDownload,
                onRetry = onRetry,
                modifier = modifier,
            )
    }
}

// ── Minimized chip ───────────────────────────────────────────────────────────────────────────────

@Composable
private fun MinimizedChip(
    projection: JobProgressProjection,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val expandLabel =
        stringResource(R.string.translation_export_jobDrawer_expand, projection.activeCount)
    Surface(
        modifier =
            modifier
                .clickable(onClick = onOpen)
                .semantics(mergeDescendants = true) {
                    contentDescription = expandLabel
                    role = Role.Button
                },
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (projection.minimizedShowsActive) {
                CircularProgressIndicator(
                    modifier = Modifier.size(CHIP_SPINNER),
                    strokeWidth = 2.dp,
                    color = TeslaTokens.status.info,
                )
            } else {
                Icon(JobProgressGlyphs.Package, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
            }
            Text(chipLabel(projection), style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun chipLabel(projection: JobProgressProjection): String =
    if (projection.minimizedShowsActive) {
        pluralStringResource(
            R.plurals.translation_export_jobDrawer_activeCount,
            projection.activeCount,
            projection.activeCount,
        )
    } else {
        stringResource(R.string.translation_export_jobDrawer_recentLabel)
    }

// ── Open panel ───────────────────────────────────────────────────────────────────────────────────

@Composable
private fun OpenDrawer(
    projection: JobProgressProjection,
    state: UiState<List<ExportJobSummary>>,
    onMinimize: () -> Unit,
    onDismiss: () -> Unit,
    onDownload: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val regionLabel = stringResource(R.string.translation_export_jobDrawer_label)
    FadeIn(modifier = modifier) {
        GlassPanel(
            modifier = Modifier.widthIn(max = DRAWER_MAX_WIDTH).semantics { paneTitle = regionLabel },
            padding = PanelPadding.None,
        ) {
            DrawerHeader(projection = projection, state = state, onMinimize = onMinimize, onDismiss = onDismiss)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            DrawerBody(projection = projection, state = state, onDownload = onDownload, onRetry = onRetry)
        }
    }
}

@Composable
private fun DrawerHeader(
    projection: JobProgressProjection,
    state: UiState<List<ExportJobSummary>>,
    onMinimize: () -> Unit,
    onDismiss: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = Spacing.md, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(JobProgressGlyphs.Package, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.info)
            Text(
                stringResource(R.string.translation_export_jobDrawer_title),
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (projection.activeCount > 0) {
                Badge(
                    stringResource(R.string.translation_export_jobDrawer_activePill, projection.activeCount),
                    variant = BadgeVariant.Info,
                )
            }
        }
        if (state.stale || state.refreshing || state.hasError) {
            OfflineChip(state)
        }
        IconButton(
            TeslaGlyphs.Minus,
            contentDescription = stringResource(R.string.translation_export_jobDrawer_minimize),
            onClick = onMinimize,
            size = IconSize.Sm,
        )
        IconButton(
            TeslaGlyphs.Close,
            contentDescription = stringResource(R.string.translation_export_jobDrawer_close),
            onClick = onDismiss,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun OfflineChip(state: UiState<List<ExportJobSummary>>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
    )
}

@Composable
private fun DrawerBody(
    projection: JobProgressProjection,
    state: UiState<List<ExportJobSummary>>,
    onDownload: (String) -> Unit,
    onRetry: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(max = BODY_MAX_HEIGHT)
                .verticalScroll(rememberScrollState())
                .padding(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        when {
            projection.isLoadingBody -> LoadingLine()
            state.isError -> ErrorState(state = state, onRetry = onRetry)
            else -> {
                DrawerSection(
                    label = stringResource(R.string.translation_export_jobDrawer_activeHeading),
                    emptyLabel = stringResource(R.string.translation_export_jobDrawer_activeEmpty),
                    rows = projection.activeRows,
                    onDownload = onDownload,
                )
                DrawerSection(
                    label = stringResource(R.string.translation_export_jobDrawer_recentHeading),
                    emptyLabel = stringResource(R.string.translation_export_jobDrawer_recentEmpty),
                    rows = projection.recentRows,
                    onDownload = onDownload,
                )
            }
        }
    }
}

@Composable
private fun LoadingLine() {
    Text(
        stringResource(R.string.translation_export_jobDrawer_loading),
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.md),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun ErrorState(
    state: UiState<List<ExportJobSummary>>,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = errorDetail(state),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun errorDetail(state: UiState<List<ExportJobSummary>>): String =
    when (state.errorKind) {
        ErrorKind.Network, ErrorKind.Timeout, ErrorKind.CircuitOpen ->
            stringResource(R.string.translation_error_network_message)
        else -> stringResource(R.string.translation_error_serverError_message)
    }

// ── Sections + rows ────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DrawerSection(
    label: String,
    emptyLabel: String,
    rows: List<JobRow>,
    onDownload: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = Spacing.xs),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (rows.isEmpty()) {
            Text(
                emptyLabel,
                modifier = Modifier.padding(horizontal = Spacing.xs, vertical = Spacing.xs),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            rows.forEach { row -> JobRowItem(row = row, onDownload = onDownload) }
        }
    }
}

@Composable
private fun JobRowItem(
    row: JobRow,
    onDownload: (String) -> Unit,
) {
    val typeLabel = jobTypeLabel(row.type)
    val metaLine = jobMetaLine(row)
    val description =
        listOf(typeLabel, row.format, metaLine, row.errorMessage.orEmpty())
            .filter { it.isNotBlank() && it != EXPORT_EM_DASH }
            .joinToString(META_SEPARATOR)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = rowBackground(row.bucket),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StatusIndicator(row)
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics(mergeDescendants = true) { contentDescription = description },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        typeLabel,
                        modifier = Modifier.weight(1f, fill = false),
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        row.format,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    metaLine,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (row.errorMessage != null) {
                    Text(
                        row.errorMessage,
                        style = MaterialTheme.typography.labelMedium,
                        color = TeslaTokens.status.danger,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            JobRowTrailing(row = row, onDownload = onDownload)
        }
    }
}

@Composable
private fun JobRowTrailing(
    row: JobRow,
    onDownload: (String) -> Unit,
) {
    val downloadUrl = row.downloadUrl
    when {
        downloadUrl != null ->
            Button(
                label = stringResource(R.string.translation_export_jobDrawer_download),
                onClick = { onDownload(downloadUrl) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = FeedbackGlyphs.Download,
            )
        row.showFailedAffordance ->
            Icon(
                TeslaGlyphs.Fullscreen,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
    }
}

@Composable
private fun StatusIndicator(row: JobRow) {
    val tint = statusToneColor(row.tone)
    if (row.status == JobStatus.Processing) {
        CircularProgressIndicator(modifier = Modifier.size(STATUS_ICON), strokeWidth = 2.dp, color = tint)
    } else {
        Icon(statusGlyph(row.status), contentDescription = null, size = IconSize.Sm, tint = tint)
    }
}

@Composable
private fun jobMetaLine(row: JobRow): String =
    if (row.bucket == JobBucket.Active) {
        stringResource(
            R.string.translation_export_jobDrawer_statusLine,
            jobStatusLabel(row),
            freshnessLabel(row.createdAtAge),
        )
    } else {
        stringResource(
            R.string.translation_export_jobDrawer_completedLine,
            row.sizeLabel,
            freshnessLabel(row.finishedAtAge),
        )
    }

@Composable
private fun jobStatusLabel(row: JobRow): String =
    when (row.status) {
        JobStatus.Queued -> stringResource(R.string.translation_export_status_queued)
        JobStatus.Processing -> stringResource(R.string.translation_export_status_processing)
        JobStatus.Ready -> stringResource(R.string.translation_export_status_ready)
        JobStatus.Failed -> stringResource(R.string.translation_export_status_failed)
        JobStatus.Expired -> stringResource(R.string.translation_export_status_expired)
        null -> row.statusWire
    }

@Composable
private fun jobTypeLabel(type: String): String =
    when (type) {
        "account" -> stringResource(R.string.translation_export_types_account)
        "drives" -> stringResource(R.string.translation_export_types_drives)
        "charging" -> stringResource(R.string.translation_export_types_charging)
        "analytics" -> stringResource(R.string.translation_export_types_analytics)
        "backup" -> stringResource(R.string.translation_export_types_backup)
        "import_drives" -> stringResource(R.string.translation_export_types_importDrives)
        "import_charging" -> stringResource(R.string.translation_export_types_importCharging)
        else -> type
    }

@Composable
private fun freshnessLabel(age: FreshnessAge): String =
    when (age) {
        FreshnessAge.Unknown -> EXPORT_EM_DASH
        FreshnessAge.JustNow -> stringResource(R.string.translation_freshness_justNow)
        is FreshnessAge.Seconds -> stringResource(R.string.translation_freshness_seconds, age.value)
        is FreshnessAge.Minutes -> stringResource(R.string.translation_freshness_minutes, age.value)
        is FreshnessAge.Hours -> stringResource(R.string.translation_freshness_hours, age.value)
        is FreshnessAge.Days -> stringResource(R.string.translation_freshness_days, age.value)
        is FreshnessAge.Weeks -> stringResource(R.string.translation_freshness_weeks, age.value)
    }

@Composable
private fun rowBackground(bucket: JobBucket): Color =
    if (bucket == JobBucket.Active) {
        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ACTIVE_ROW_ALPHA)
    } else {
        Color.Transparent
    }

@Composable
private fun statusToneColor(tone: JobStatusTone): Color =
    when (tone) {
        JobStatusTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
        JobStatusTone.Info -> TeslaTokens.status.info
        JobStatusTone.Success -> TeslaTokens.status.success
        JobStatusTone.Danger -> TeslaTokens.status.danger
        JobStatusTone.Warning -> TeslaTokens.status.warning
    }

private fun statusGlyph(status: JobStatus?): ImageVector =
    when (status) {
        JobStatus.Ready -> DataDisplayGlyphs.CheckCircle
        JobStatus.Failed -> JobProgressGlyphs.XCircle
        JobStatus.Expired -> DataDisplayGlyphs.AlertTriangle
        JobStatus.Queued, JobStatus.Processing, null -> DataDisplayGlyphs.Clock
    }

// ── Wall clock + download ────────────────────────────────────────────────────────────────────────

@Composable
private fun rememberTickingNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(RELATIVE_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

// The web row is an `<a href>` to a same-origin path; the native row resolves that relative path
// against the deployment API base and hands it to the system browser / Custom Tab. A missing handler
// is swallowed so a tap can never crash the host.
private fun openDownload(
    context: Context,
    path: String,
) {
    val base = BuildConfig.API_BASE_URL.trimEnd('/')
    val intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(base + path))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

// ── Local glyphs (no shared-set equivalent for Package / XCircle) ────────────────────────────────

private object JobProgressGlyphs {
    val Package: ImageVector =
        stroked("Package") {
            moveTo(12f, 3f)
            lineTo(20f, 7.5f)
            lineTo(20f, 16.5f)
            lineTo(12f, 21f)
            lineTo(4f, 16.5f)
            lineTo(4f, 7.5f)
            close()
            moveTo(4f, 7.5f)
            lineTo(12f, 12f)
            lineTo(20f, 7.5f)
            moveTo(12f, 12f)
            lineTo(12f, 21f)
        }
    val XCircle: ImageVector =
        stroked("XCircle") {
            circle(12f, 12f, 9f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }
}

private fun stroked(
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

private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Previews ─────────────────────────────────────────────────────────────────────────────────────

private fun sampleJobs(): List<ExportJobSummary> =
    listOf(
        ExportJobSummary(
            id = "job-1",
            type = "drives",
            format = "csv",
            status = "processing",
            createdAt = "2026-06-12T18:00:00Z",
        ),
        ExportJobSummary(
            id = "job-2",
            type = "charging",
            format = "json",
            status = "ready",
            fileSize = 2_400_000L,
            createdAt = "2026-06-12T17:30:00Z",
            completedAt = "2026-06-12T17:31:00Z",
        ),
        ExportJobSummary(
            id = "job-3",
            type = "analytics",
            format = "csv",
            status = "failed",
            errorMessage = "Source dataset unavailable",
            createdAt = "2026-06-12T16:00:00Z",
        ),
    )

@Preview(name = "JobProgressDrawer · open")
@Composable
private fun JobProgressDrawerOpenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val state = UiState(UiPhase.Content, sampleJobs())
        JobProgressDrawerContent(
            projection =
                projectJobProgress(
                    feed = JobFeedState(sampleJobs(), isLoading = false, isError = false),
                    presentation = DrawerPresentation.Open,
                    maxRecent = DEFAULT_MAX_RECENT,
                    nowMillis = PREVIEW_NOW,
                ),
            state = state,
            onOpen = {},
            onMinimize = {},
            onDismiss = {},
            onDownload = {},
            onRetry = {},
        )
    }
}

@Preview(name = "JobProgressDrawer · minimized")
@Composable
private fun JobProgressDrawerMinimizedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val state = UiState(UiPhase.Content, sampleJobs())
        JobProgressDrawerContent(
            projection =
                projectJobProgress(
                    feed = JobFeedState(sampleJobs(), isLoading = false, isError = false),
                    presentation = DrawerPresentation.Minimized,
                    maxRecent = DEFAULT_MAX_RECENT,
                    nowMillis = PREVIEW_NOW,
                ),
            state = state,
            onOpen = {},
            onMinimize = {},
            onDismiss = {},
            onDownload = {},
            onRetry = {},
        )
    }
}
