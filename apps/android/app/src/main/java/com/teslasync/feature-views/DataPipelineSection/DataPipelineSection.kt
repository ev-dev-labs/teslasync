// The native Jetpack Compose + Material 3 DataPipelineSection feature view — a parity port of
// web/src/features/system/components/status/DataPipelineSection.tsx. The web component is an AccordionSection
// (archive icon, "Data Pipeline" title, a savings + active badge pair) over a body that composes two
// `useQuery` feeds: a compression-statistics block (four MetricCards + a savings RadialGauge, shown when the
// compression query resolved) and an always-present export-job-queue block (four StatCards + a sortable,
// paginated DataTable, or a friendly empty state). `isLoading` swaps the body for two skeletons.
//
// This surface keeps that contract end to end. The primary entry binds the shared P1/S8 stores through
// [DataPipelineSectionViewModel], projects the merged cache-then-network feeds onto the shared [UiState], and
// renders EVERY lifecycle state — loading (skeletons), hard error with retry (web `QueryError` equivalent),
// empty (no compression + no jobs → the export "no jobs in queue" empty state), content, and stale/offline
// ("last known" + a freshness chip) — inside the shared native [AccordionSection]. It performs NO HTTP. A
// `UiState`-prop content overload gives hosts / tests / previews a fetch-free entry. Every display string
// resolves through the P1/S10 i18n facade (by-name with the web `t(key, default)` English fallback for the
// surface-specific keys the generated catalog does not yet carry); the int/percent/byte/date formatters live
// in the pure [DataPipelineProjection].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DataPipelineSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions", "LongMethod")

package io.teslasync.android.featureviews.datapipelinesection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.accordionsection.AccordionSection
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Client-side page size for the export-job table (web `DataTable pagination`). */
private const val EXPORT_PAGE_SIZE = 10

/** RadialGauge diameter, matching the web `RadialGauge size={140}`. */
private val GAUGE_SIZE = 140.dp

/** Skeleton block heights matching the web `Skeleton className="h-32"` / `"h-48"`. */
private val SKELETON_COMPRESSION_HEIGHT = 128.dp
private val SKELETON_EXPORT_HEIGHT = 192.dp

/**
 * The already-localized strings the surface renders. The web component resolves every label through
 * `useTranslation`; these arrive through the P1/S10 i18n facade at the Compose boundary so the rest of the
 * surface carries no English literal. [savedSuffix] / [activeSuffix] are the trailing badge words; the
 * `%`-bearing values are formatted by the pure projection.
 */
data class DataPipelineStrings(
    val title: String,
    val description: String,
    val compressionStatistics: String,
    val exportJobQueue: String,
    val compressionRatio: String,
    val estimatedSavings: String,
    val totalPositions: String,
    val compressed: String,
    val savings: String,
    val pending: String,
    val processing: String,
    val completed: String,
    val failed: String,
    val statusHeader: String,
    val typeHeader: String,
    val formatHeader: String,
    val fileHeader: String,
    val recordsHeader: String,
    val createdHeader: String,
    val noExportJobs: String,
    val noExportJobsInQueue: String,
    val savedSuffix: String,
    val activeSuffix: String,
)

/**
 * Primary entry — the faithful native binding of the web component's two-`useQuery` composition. Records the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11) through the [DataPipelineSectionViewModel], collects
 * its merged [UiState] lifecycle-aware, and delegates to [DataPipelineSectionContent]. It performs no HTTP —
 * the stores and their repositories do (ADR-002).
 */
@Composable
fun DataPipelineSection(
    viewModel: DataPipelineSectionViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    DataPipelineSectionContent(state = state, onRefresh = viewModel::refresh, modifier = modifier)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Wraps the shared
 * [AccordionSection] (archive icon + the savings/active badge pair) over a body that switches: two skeletons
 * while a first load is in flight, a retry surface on a hard error, otherwise the compression block (when
 * present) above the export-job-queue block. Stale (non-error) data auto-refreshes via [onRefresh]; stale/
 * refreshing/offline data also shows a freshness chip so cached "last known" data is never presented as live.
 */
@Composable
fun DataPipelineSectionContent(
    state: UiState<DataPipelineData>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: DataPipelineStrings = rememberDataPipelineStrings(),
    defaultOpen: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val dateTimeFormatter =
        remember(locale, zoneId) {
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(zoneId)
        }
    AccordionSection(
        title = strings.title,
        description = strings.description,
        modifier = modifier,
        icon = { Icon(DataPipelineSectionGlyphs.Archive, contentDescription = null, size = IconSize.Lg) },
        badges = { DataPipelineBadges(state.data, strings, locale) },
        defaultOpen = defaultOpen,
        logger = logger,
    ) {
        DataPipelineBody(
            state = state,
            onRefresh = onRefresh,
            strings = strings,
            locale = locale,
            dateTimeFormatter = dateTimeFormatter,
        )
    }
}

/**
 * The header chip pair — web `{compression && <Badge info>{savings%} saved</Badge>}` and
 * `{active > 0 && <Badge warning>{active} active</Badge>}`. Rendered inside the accordion header's badge
 * row, so each [Badge] becomes a row child. Hidden entirely while there is no data (loading / hard error).
 */
@Composable
private fun DataPipelineBadges(
    data: DataPipelineData?,
    strings: DataPipelineStrings,
    locale: Locale,
) {
    val compression = data?.compression
    if (compression != null) {
        Badge(
            text = "${DataPipelineProjection.fmtPercent(compression.savingsPercent, locale)} ${strings.savedSuffix}",
            variant = BadgeVariant.Info,
        )
    }
    val active = data?.exportJobs?.let { DataPipelineProjection.counts(it).active } ?: 0
    if (active > 0) {
        Badge(text = "$active ${strings.activeSuffix}", variant = BadgeVariant.Warning)
    }
}

/** True when the freshness chip should show: stale, a refresh in flight, or offline (error over cached data). */
private val UiState<DataPipelineData>.showsFreshnessChip: Boolean
    get() = stale || refreshing || (hasError && hasData)

@Composable
private fun ColumnScope.DataPipelineBody(
    state: UiState<DataPipelineData>,
    onRefresh: () -> Unit,
    strings: DataPipelineStrings,
    locale: Locale,
    dateTimeFormatter: DateTimeFormatter,
) {
    when {
        state.isLoading -> DataPipelineLoading()
        state.isError -> DataPipelineError(onRefresh = onRefresh)
        else -> {
            if (state.showsFreshnessChip) {
                DataPipelineFreshnessRow(state)
            }
            val data = state.data
            if (data?.compression != null) {
                CompressionBlock(stats = data.compression, strings = strings, locale = locale)
            }
            ExportBlock(
                jobs = data?.exportJobs ?: emptyList(),
                strings = strings,
                locale = locale,
                dateTimeFormatter = dateTimeFormatter,
            )
        }
    }
}

/** First-load skeletons — web `<Skeleton className="h-32" />` over `<Skeleton className="h-48" />`. */
@Composable
private fun DataPipelineLoading() {
    Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_COMPRESSION_HEIGHT, rounded = true)
    Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_EXPORT_HEIGHT, rounded = true)
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun DataPipelineError(onRefresh: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        icon = DataPipelineSectionGlyphs.AlertTriangle,
        onRetry = onRefresh,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The "last known / offline / refreshing" freshness chip, right-aligned above the content. */
@Composable
private fun DataPipelineFreshnessRow(state: UiState<DataPipelineData>) {
    val formatAge = rememberDataPipelineFreshnessFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/**
 * The compression-statistics block — web `<h4>Compression Statistics</h4>` over a 2/4 MetricCard grid and a
 * centered savings [RadialGauge]. The four metrics are the savings ratio, estimated bytes saved, total
 * positions, and compressed positions (web order + accents).
 */
@Composable
private fun CompressionBlock(
    stats: CompressionStats,
    strings: DataPipelineStrings,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Subhead(strings.compressionStatistics)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCard(
                label = strings.compressionRatio,
                value = DataPipelineProjection.fmtPercent(stats.savingsPercent, locale),
                icon = DataPipelineSectionGlyphs.TrendingUp,
                accent = TeslaTokens.status.success,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = strings.estimatedSavings,
                value = DataPipelineProjection.formatBytes(stats.estimatedSavedBytes, locale),
                icon = DataPipelineSectionGlyphs.HardDrive,
                accent = TeslaTokens.status.info,
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCard(
                label = strings.totalPositions,
                value = DataPipelineProjection.fmtInt(stats.totalPositions, locale),
                icon = DataPipelineSectionGlyphs.BarChart,
                accent = paletteColor(PURPLE_PALETTE_INDEX),
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = strings.compressed,
                value = DataPipelineProjection.fmtInt(stats.compressedPositions, locale),
                icon = DataPipelineSectionGlyphs.Archive,
                accent = TeslaTokens.status.info,
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            RadialGauge(
                value = stats.savingsPercent,
                max = MAX_PERCENT,
                label = strings.savings,
                unit = "%",
                color = TeslaTokens.status.success,
                size = GAUGE_SIZE,
            )
        }
    }
}

/**
 * The export-job-queue block — web `<h4>Export Job Queue</h4>` over either the four count StatCards + the
 * jobs DataTable (when jobs exist) or the "No export jobs in queue" empty state.
 */
@Composable
private fun ExportBlock(
    jobs: List<ExportJobSummary>,
    strings: DataPipelineStrings,
    locale: Locale,
    dateTimeFormatter: DateTimeFormatter,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Subhead(strings.exportJobQueue)
        if (jobs.isNotEmpty()) {
            ExportStatCards(counts = DataPipelineProjection.counts(jobs), strings = strings)
            ExportJobsTable(jobs = jobs, strings = strings, locale = locale, dateTimeFormatter = dateTimeFormatter)
        } else {
            EmptyState(
                message = strings.noExportJobsInQueue,
                icon = DataPipelineSectionGlyphs.Archive,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The four export-status count tiles — web Pending / Processing / Completed / Failed StatCards. */
@Composable
private fun ExportStatCards(
    counts: ExportJobCounts,
    strings: DataPipelineStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = strings.pending,
                value = counts.pending.toString(),
                icon = DataPipelineSectionGlyphs.Clock,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = strings.processing,
                value = counts.processing.toString(),
                icon = DataPipelineSectionGlyphs.Activity,
                modifier = Modifier.weight(1f),
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = strings.completed,
                value = counts.completed.toString(),
                icon = DataPipelineSectionGlyphs.CheckCircle,
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = strings.failed,
                value = counts.failed.toString(),
                icon = DataPipelineSectionGlyphs.XCircle,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/**
 * The export-jobs DataTable — the native [DataTable] with the six web columns, a numeric `record_count` sort
 * (web `sortable`), and a client-side pagination footer (web `pagination`). Sort + page are hoisted here; the
 * footer appears only once the row count exceeds a page.
 */
@Composable
private fun ExportJobsTable(
    jobs: List<ExportJobSummary>,
    strings: DataPipelineStrings,
    locale: Locale,
    dateTimeFormatter: DateTimeFormatter,
) {
    var sortState by remember { mutableStateOf(SortState()) }
    val sorted = remember(jobs, sortState) { DataPipelineProjection.sortJobs(jobs, sortState) }
    val total = sorted.size
    val pageCount = maxOf(1, (total + EXPORT_PAGE_SIZE - 1) / EXPORT_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * EXPORT_PAGE_SIZE
    val visible = if (total == 0) emptyList() else sorted.subList(from, minOf(from + EXPORT_PAGE_SIZE, total))
    val rows = remember(visible, locale, dateTimeFormatter) { DataPipelineProjection.rows(visible, locale, dateTimeFormatter) }
    val columns = remember(strings) { exportColumns(strings) }

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    DataTable(
        columns = columns,
        rows = rows,
        keyOf = { it.id },
        modifier = Modifier.fillMaxWidth(),
        sortState = sortState,
        onSortChange = { key -> sortState = sortState.toggledBy(key) },
        emptyText = strings.noExportJobs,
        footer =
            if (total > EXPORT_PAGE_SIZE) {
                {
                    Pagination(
                        page = current,
                        pageSize = EXPORT_PAGE_SIZE,
                        total = total,
                        onPageChange = { page = it },
                        firstLabel = firstLabel,
                        previousLabel = previousLabel,
                        nextLabel = nextLabel,
                        lastLabel = lastLabel,
                        showingText = { start, end, count ->
                            context.getString(R.string.translation_pagination_showing, start, end, count)
                        },
                    )
                }
            } else {
                null
            },
    )
}

/** The six export-table columns — web `exportColumns` (Status / Type / Format / File / Records / Created). */
private fun exportColumns(strings: DataPipelineStrings): List<TableColumn<ExportJobRowView>> =
    listOf(
        TableColumn(key = "status", header = strings.statusHeader, weight = WEIGHT_STATUS) { StatusCell(it) },
        TableColumn(key = "type", header = strings.typeHeader, weight = WEIGHT_TYPE) { Caption(it.type) },
        TableColumn(key = "format", header = strings.formatHeader, weight = WEIGHT_FORMAT) {
            Badge(text = it.format, variant = BadgeVariant.Neutral)
        },
        TableColumn(key = "file_name", header = strings.fileHeader, weight = WEIGHT_FILE) { CodeText(it.fileName) },
        TableColumn(
            key = EXPORT_COLUMN_RECORDS,
            header = strings.recordsHeader,
            weight = WEIGHT_RECORDS,
            sortable = true,
            alignEnd = true,
        ) { Caption(it.recordsLabel) },
        TableColumn(key = "created_at", header = strings.createdHeader, weight = WEIGHT_CREATED) { Caption(it.createdLabel) },
    )

/** The Status cell — web `getStatusIcon(status)` + the raw status text in `statusTextClass(status)`. */
@Composable
private fun StatusCell(row: ExportJobRowView) {
    val color = statusToneColor(row.statusTone)
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clearAndSetSemantics { contentDescription = row.statusRaw },
    ) {
        Icon(statusGlyphVector(row.statusGlyph), contentDescription = null, size = IconSize.Sm, tint = color)
        BodyText(row.statusRaw, color = color, maxLines = 1)
    }
}

@Composable
private fun statusToneColor(tone: ExportStatusTone): Color =
    when (tone) {
        ExportStatusTone.Success -> TeslaTokens.status.success
        ExportStatusTone.Warning -> TeslaTokens.status.warning
        ExportStatusTone.Danger -> TeslaTokens.status.danger
        ExportStatusTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun statusGlyphVector(glyph: ExportStatusGlyph): ImageVector =
    when (glyph) {
        ExportStatusGlyph.Check -> DataPipelineSectionGlyphs.CheckCircle
        ExportStatusGlyph.Cross -> DataPipelineSectionGlyphs.XCircle
        ExportStatusGlyph.Alert -> DataPipelineSectionGlyphs.AlertTriangle
    }

/**
 * Resolves the localized strings from the P1/S10 catalog. Surface keys the generated catalog already carries
 * (Status / Type / Format / File / Records / Created / Compressed / Savings / Pending / Processing /
 * Completed / Failed / saved / active) resolve verbatim; the surface-specific keys the catalog does not yet
 * carry fall back to the web `t(key, default)` English default — exactly as the sibling AccordionSection
 * surface resolves its affordance keys. Remembered against the resolved values so a locale change rebuilds it.
 */
@Composable
private fun rememberDataPipelineStrings(): DataPipelineStrings {
    val context = LocalContext.current
    val resolve: (String, String) -> String = { name, default -> context.optionalString(name) ?: default }
    return remember(context) {
        DataPipelineStrings(
            title = resolve("translation_Data_Pipeline", "Data Pipeline"),
            description =
                resolve(
                    "translation_Compression_statistics_and_export_job_queue",
                    "Compression statistics and export job queue",
                ),
            compressionStatistics = resolve("translation_Compression_Statistics", "Compression Statistics"),
            exportJobQueue = resolve("translation_Export_Job_Queue", "Export Job Queue"),
            compressionRatio = resolve("translation_Compression_Ratio", "Compression Ratio"),
            estimatedSavings = resolve("translation_Estimated_Savings", "Estimated Savings"),
            totalPositions = resolve("translation_Total_Positions", "Total Positions"),
            compressed = resolve("translation_Compressed", "Compressed"),
            savings = resolve("translation_Savings", "Savings"),
            pending = resolve("translation_Pending", "Pending"),
            processing = resolve("translation_Processing", "Processing"),
            completed = resolve("translation_Completed", "Completed"),
            failed = resolve("translation_Failed", "Failed"),
            statusHeader = resolve("translation_Status", "Status"),
            typeHeader = resolve("translation_Type", "Type"),
            formatHeader = resolve("translation_Format", "Format"),
            fileHeader = resolve("translation_File", "File"),
            recordsHeader = resolve("translation_Records", "Records"),
            createdHeader = resolve("translation_Created", "Created"),
            noExportJobs = resolve("translation_No_export_jobs", "No export jobs"),
            noExportJobsInQueue = resolve("translation_No_export_jobs_in_queue", "No export jobs in queue"),
            savedSuffix = resolve("translation_saved", "saved"),
            activeSuffix = resolve("translation_active", "active"),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the render-only
 * concern the sibling surfaces resolve the same way, kept out of the pure projection.
 */
@Composable
private fun rememberDataPipelineFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Optional by-name read from the Android string catalog — the seam reproducing web `t(key, default)`.
 * `getIdentifier` is the only way to attempt a key that may be absent (a compile-time `R.string` reference
 * cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed. Release builds
 * keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// Column weights tuned so the six-column table stays readable in a phone-width panel (web responsive table).
private const val WEIGHT_STATUS = 1.4f
private const val WEIGHT_TYPE = 1f
private const val WEIGHT_FORMAT = 1f
private const val WEIGHT_FILE = 1.6f
private const val WEIGHT_RECORDS = 1f
private const val WEIGHT_CREATED = 1.6f
private const val MAX_PERCENT = 100.0
private const val PURPLE_PALETTE_INDEX = 2

// ── Previews — one per genuinely reachable render state ─────────────────────────────────────────────────

/** No-op [Logger] for `@Preview` only — the live surface resolves the redacting logger from the container. */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

private val PREVIEW_STRINGS =
    DataPipelineStrings(
        title = "Data Pipeline",
        description = "Compression statistics and export job queue",
        compressionStatistics = "Compression Statistics",
        exportJobQueue = "Export Job Queue",
        compressionRatio = "Compression Ratio",
        estimatedSavings = "Estimated Savings",
        totalPositions = "Total Positions",
        compressed = "Compressed",
        savings = "Savings",
        pending = "Pending",
        processing = "Processing",
        completed = "Completed",
        failed = "Failed",
        statusHeader = "Status",
        typeHeader = "Type",
        formatHeader = "Format",
        fileHeader = "File",
        recordsHeader = "Records",
        createdHeader = "Created",
        noExportJobs = "No export jobs",
        noExportJobsInQueue = "No export jobs in queue",
        savedSuffix = "saved",
        activeSuffix = "active",
    )

private val PREVIEW_COMPRESSION =
    CompressionStats(
        total = 1_000_000,
        compressed = 720_000,
        savingsPercent = 72.4,
        totalPositions = 4_820_000,
        compressedPositions = 3_490_000,
        estimatedSavedRows = 1_330_000,
        estimatedSavedBytes = 268_435_456,
    )

private fun previewJob(
    id: String,
    status: String,
    type: String,
    records: Long,
) = ExportJobSummary(
    id = id,
    type = type,
    format = "csv",
    status = status,
    fileName = "$type-$id.csv",
    recordCount = records,
    createdAt = "2026-06-11T12:00:00Z",
)

private val PREVIEW_JOBS =
    listOf(
        previewJob("e1", "ready", "drives", 12_840),
        previewJob("e2", "processing", "charging", 3_120),
        previewJob("e3", "queued", "trips", 0),
        previewJob("e4", "failed", "analytics", 0),
    )

@Composable
private fun PreviewHost(
    state: UiState<DataPipelineData>,
    defaultOpen: Boolean = true,
) {
    TeslaSyncTheme(dynamicColor = false) {
        DataPipelineSectionContent(
            state = state,
            onRefresh = {},
            locale = Locale.US,
            zoneId = ZoneId.of("UTC"),
            strings = PREVIEW_STRINGS,
            defaultOpen = defaultOpen,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "DataPipelineSection · content", showBackground = true)
@Composable
private fun DataPipelineContentPreview() {
    PreviewHost(
        UiState(
            phase = UiPhase.Content,
            data = DataPipelineData(PREVIEW_COMPRESSION, PREVIEW_JOBS),
            fetchedAt = 1_000L,
        ),
    )
}

@Preview(name = "DataPipelineSection · loading", showBackground = true)
@Composable
private fun DataPipelineLoadingPreview() {
    PreviewHost(UiState.loading())
}

@Preview(name = "DataPipelineSection · empty", showBackground = true)
@Composable
private fun DataPipelineEmptyPreview() {
    PreviewHost(
        UiState(
            phase = UiPhase.Empty,
            data = DataPipelineData(null, emptyList()),
            fetchedAt = 1_000L,
        ),
    )
}

@Preview(name = "DataPipelineSection · error", showBackground = true)
@Composable
private fun DataPipelineErrorPreview() {
    PreviewHost(
        UiState(
            phase = UiPhase.Error,
            errorKind = ErrorKind.Network,
        ),
    )
}
