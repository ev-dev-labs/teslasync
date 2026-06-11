// The native Jetpack Compose + Material 3 Export Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ExportStatusWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while first loading, otherwise a title + download icon + freshness header) wrapping either
// the compact active-jobs hero (web `WidgetBigNumber`: a big count + Running/Idle badge), the
// newest-first job list (filename + format + size + status badge + relative time, with a processing
// progress bar and a wide-only download affordance), or a friendly empty state. A hard cold-start
// failure with nothing cached shows an error + retry surface. All data flows through the shared
// [ExportStatusWidgetViewModel]; the view never performs HTTP. Every string resolves through the
// i18n catalog and every interactive element carries a TalkBack label.
//
// i18n note: the web per-row status labels use the keys `widget.exportQueued`/`exportRunning`/
// `exportDone`/`exportFailed`, which render Queued/Running/Done/Failed via i18next fallbacks but are
// absent from the shared P1/S10 catalog. To honour both "every key resolves in the catalog" and
// exact display-text parity, each is mapped to the existing catalog key whose value matches verbatim
// (export-domain where one exists): queued → export.status.queued, processing → widget.exportRunningBadge,
// ready → "Done", failed → export.status.failed. No English literal is introduced.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ExportStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.exportstatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 4
private val MIN_TOUCH_TARGET = 44.dp

// Web `<MetricBar value={50} max={100} />`: the export API exposes no granular per-job progress, so a
// processing row shows a fixed half-filled indeterminate bar, matching the web's constant 50% fill.
private const val PROCESSING_BAR_VALUE = 50.0
private const val PROCESSING_BAR_MAX = 100.0

private const val DOWNLOAD_PATH_PREFIX = "/api/v1/export/download/"

/**
 * Stateful entry point. Binds the shared export + admin feeds via [source] into an
 * [ExportStatusWidgetViewModel], records the one-shot `view.opened` diagnostic, wires the download
 * affordance to the platform browser, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (a [StoreExportStatusSource] over the shared S8 Exports + Admin stores) and a
 * unique [instanceKey] per placement.
 *
 * @param source the cache-then-network export + admin seam.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ExportStatusWidget(
    source: ExportStatusSource,
    modifier: Modifier = Modifier,
    size: ExportStatusSize = ExportStatusRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ExportStatusRegistration.ID,
) {
    val viewModel: ExportStatusWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ExportStatusWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val uriHandler = LocalUriHandler.current

    ExportStatusWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        onDownload = { jobId -> uriHandler.openUri("${BuildConfig.API_BASE_URL}$DOWNLOAD_PATH_PREFIX$jobId") },
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (first load → skeleton), the cold-start hard-error → retry surface, and
 * otherwise the title + freshness header over the compact hero / standard job list / empty body.
 * [nowMillis] is injectable for deterministic relative-time rendering in tests.
 */
@Composable
fun ExportStatusWidgetContent(
    state: UiState<List<ExportStatusJob>>,
    size: ExportStatusSize,
    onRefresh: () -> Unit,
    onDownload: (String) -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberExportNowMillis(),
) {
    val strings = rememberExportStatusStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val jobs = state.data ?: emptyList()
            val display =
                remember(jobs, size, strings, nowMillis) {
                    ExportStatusProjection.project(jobs, size, strings, nowMillis)
                }
            LoadedChrome(state, size, display, onRefresh, onDownload, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<List<ExportStatusJob>>,
    size: ExportStatusSize,
    display: ExportStatusDisplay,
    onRefresh: () -> Unit,
    onDownload: (String) -> Unit,
    strings: ExportStatusStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, onRefresh = onRefresh, strings = strings)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when {
                !display.hasJobs -> ExportStatusEmpty(strings)
                size.isCompact -> CompactHero(display)
                else -> JobList(display, onDownload, strings)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<List<ExportStatusJob>>,
    onRefresh: () -> Unit,
    strings: ExportStatusStrings,
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
            FeedbackGlyphs.Download,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
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

/** Compact active-jobs hero — the native port of the web `CompactView` / `WidgetBigNumber`. */
@Composable
private fun CompactHero(display: ExportStatusDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        AnimatedNumber(value = display.activeCount * 1.0)
        MetricLabel(display.activeJobsLabel)
        Badge(text = display.compactBadgeLabel, variant = badgeVariant(display.compactBadgeTone))
    }
}

@Composable
private fun JobList(
    display: ExportStatusDisplay,
    onDownload: (String) -> Unit,
    strings: ExportStatusStrings,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        display.rows.forEach { row ->
            JobRow(row = row, onDownload = onDownload, strings = strings)
            if (row.showProgress) {
                MetricBar(
                    value = PROCESSING_BAR_VALUE,
                    max = PROCESSING_BAR_MAX,
                    label = "",
                    valueText = "",
                    color = TeslaTokens.status.info,
                    modifier = Modifier.padding(bottom = Spacing.xs),
                )
            }
        }
    }
}

@Composable
private fun JobRow(
    row: ExportJobRow,
    onDownload: (String) -> Unit,
    strings: ExportStatusStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = MIN_TOUCH_TARGET),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        // Information cluster folded into a single TalkBack phrase; the download button stays a
        // separate, independently-actionable node beside it.
        Row(
            modifier = Modifier.weight(1f).clearAndSetSemantics { contentDescription = row.contentDescription },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            BodyText(row.fileName, modifier = Modifier.weight(1f), maxLines = 1)
            Badge(text = row.formatLabel, variant = BadgeVariant.Neutral)
            Caption(row.sizeLabel)
            Badge(text = row.statusLabel, variant = badgeVariant(row.statusTone))
            Caption(row.time)
        }
        if (row.downloadable) {
            IconButton(
                imageVector = FeedbackGlyphs.Download,
                contentDescription = strings.downloadLabel,
                onClick = { onDownload(row.id) },
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun ExportStatusEmpty(strings: ExportStatusStrings) {
    EmptyState(
        message = strings.emptyMessage,
        icon = FeedbackGlyphs.Download,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
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
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

private fun badgeVariant(tone: ExportBadgeTone): BadgeVariant =
    when (tone) {
        ExportBadgeTone.Neutral -> BadgeVariant.Neutral
        ExportBadgeTone.Info -> BadgeVariant.Info
        ExportBadgeTone.Success -> BadgeVariant.Success
        ExportBadgeTone.Danger -> BadgeVariant.Danger
    }

/** Ticks the wall clock every 30s so relative-time labels (e.g. "5m ago") stay current. */
@Composable
private fun rememberExportNowMillis(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(NOW_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * Builds the localized [ExportStatusStrings] from the i18n catalog (P1/S10): the title, the compact
 * hero's "Active Exports" label + Running/Idle badge, the empty message, the per-row status badge
 * labels (mapped to catalog keys whose values match the web text verbatim — see the file header), the
 * download label, the header refresh/refreshing/offline microcopy, and the `translation_freshness_*`
 * relative-time formatter shared with the freshness chip and the per-row `<TimeStamp>` analogue.
 */
@Composable
private fun rememberExportStatusStrings(): ExportStatusStrings {
    val title = stringResource(R.string.translation_widget_exportStatus)
    val activeJobs = stringResource(R.string.translation_widget_exportActiveJobs)
    val runningBadge = stringResource(R.string.translation_widget_exportRunningBadge)
    val idleBadge = stringResource(R.string.translation_widget_exportIdleBadge)
    val empty = stringResource(R.string.translation_widget_noExportJobs)
    val queued = stringResource(R.string.translation_export_status_queued)
    val running = stringResource(R.string.translation_widget_exportRunningBadge)
    val done = stringResource(R.string.translation_Done)
    val failed = stringResource(R.string.translation_export_status_failed)
    val download = stringResource(R.string.translation_widget_exportDownload)
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
        title,
        activeJobs,
        runningBadge,
        idleBadge,
        empty,
        queued,
        running,
        done,
        failed,
        download,
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
        ExportStatusStrings(
            title = title,
            activeJobsLabel = activeJobs,
            runningBadge = runningBadge,
            idleBadge = idleBadge,
            emptyMessage = empty,
            queuedLabel = queued,
            runningLabel = running,
            doneLabel = done,
            failedLabel = failed,
            downloadLabel = download,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EXPORT_EM_DASH
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

private const val EXPORT_EM_DASH = "\u2014"
