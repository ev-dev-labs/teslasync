// The native Jetpack Compose + Material 3 TripListPage trips surface — a parity port of
// web/src/features/trips/pages/TripListPage.tsx, the multi-drive trip dashboard. It reproduces the page's four
// summary MetricCards (total distance, energy used, total cost, total trips), the top-trips-by-distance bar chart
// inside a ChartContainer (with CSV / JSON share export), the paginated "All Trips" GlassPanel list of TripRows,
// every data state (loading skeleton / empty / error-retry / content, plus the cache-then-network stale/offline
// tier the bound state holder carries), and every visible string (resolved from the generated res/values catalog,
// ADR-014).
//
// Composition: [TripListPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the trips feed + the interaction snapshot + the live display
// preferences); [TripListPageContent] is the stateless render layer. The single `useTrips` feed + the prefs are
// folded by the framework-free model (deriveTripListData) into the slices the panels read — exactly as the web
// page threads its loaded `trips` through the summary reduces, the chart memo, and the row map. SI values are
// converted to the user's units only here at the display boundary via the model's prefs helpers (Phase-48
// SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.trips.triplist

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartGlyphs
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The Material expanded-width breakpoint at which the stat grid widens to four columns (web `lg`). */
private val LARGE_WINDOW_BREAKPOINT = 840.dp

/** Two summary columns on a phone (web `sm:grid-cols-2`); four on a large window (web `lg:grid-cols-4`). */
private const val GRID_COLUMNS_DEFAULT = 2
private const val GRID_COLUMNS_LG = 4

/** The bar-chart height (web `height={280}`). */
private val CHART_HEIGHT = 280.dp

/** The TripRow leading icon disc diameter (web `h-10 w-10`). */
private val ROW_ICON_DISC = 40.dp

/** Translucency of the TripRow icon disc + the chart bar accent disc background (web `bg-cyan-500/10`). */
private const val DISC_BG_ALPHA = 0.1f

/** Number of skeleton list rows shown while the first load is in flight (web `Skeleton` cascade). */
private const val LIST_SKELETON_ROWS = 4

/**
 * Per-card accent colours — the web MetricCard `color="cyan|amber|green|purple"` props. These are fixed brand
 * accents the card tints its icon disc with (dynamic per-card values, not static theme tokens), the same
 * precedent as the sibling DrivesList trend palette; body text + surfaces still come from `MaterialTheme`.
 */
private val ACCENT_DISTANCE = Color(0xFF00F0FF)
private val ACCENT_ENERGY = Color(0xFFF59E0B)
private val ACCENT_COST = Color(0xFF10B981)
private val ACCENT_TRIPS = Color(0xFFA855F7)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TripListPageViewModel] over the supplied [source] (the host wires the shared
 * trips repository + settings holder + the app-scoped active-vehicle selection via [tripListPageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun TripListPage(
    source: TripListPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: TripListPageViewModel =
        viewModel(
            key = TripListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TripListPageViewModel(source, logger) } },
        )
    TripListPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] trips feed + interaction snapshot + display prefs to the content. */
@Composable
fun TripListPage(
    viewModel: TripListPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.tripsState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    TripListPageContent(
        state = state,
        interaction = interaction,
        prefs = prefs,
        onSetPage = viewModel::setPage,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (with nothing cached) renders the full-page skeleton; otherwise
 * the page header is drawn, then the hard-error retry surface or the loaded body (which itself renders the
 * empty-data states inline — the chart empty state + the list empty state — so no region ever blanks).
 */
@Composable
fun TripListPageContent(
    state: UiState<List<Trip>>,
    interaction: TripListInteraction,
    prefs: TripListDisplayPrefs,
    onSetPage: (Int) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state.isLoading) {
        TripListLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TripListHeader(state = state)

        if (state.isError) {
            TripListError(onRetry = onRetry)
        } else {
            TripListLoaded(
                trips = state.data.orEmpty(),
                prefs = prefs,
                page = interaction.page,
                onSetPage = onSetPage,
            )
        }
    }
}

/** The page header — the `<h1>` title + muted subtitle + the query-freshness chip (web `PageContainer`). */
@Composable
private fun TripListHeader(state: UiState<List<Trip>>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(stringResource(R.string.translation_trips_title))
            BodyText(
                stringResource(R.string.translation_trips_subtitle),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0L },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
}

/** The hard-error surface for the trips feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun TripListError(onRetry: () -> Unit) {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            ErrorDisplay(
                message = stringResource(R.string.translation_error_serverError_message),
                title = stringResource(R.string.translation_error_serverError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_common_retry),
            )
        }
    }
}

/**
 * The loaded surface — the four summary cards, the top-trips chart with CSV/JSON export, the "All Trips" list
 * (or its empty state), and pagination. The single trips feed + prefs are folded by the framework-free model
 * into every slice; the i18n `trips.row.trip` word feeds the name fallbacks.
 */
@Composable
private fun TripListLoaded(
    trips: List<Trip>,
    prefs: TripListDisplayPrefs,
    page: Int,
    onSetPage: (Int) -> Unit,
) {
    val tripWord = stringResource(R.string.translation_trips_row_trip)
    val data = remember(trips, prefs, tripWord) { deriveTripListData(trips, prefs, tripWord) }
    val export = rememberTripExport()

    FadeIn { TripStatsGrid(data = data) }
    FadeIn(delayMs = FADE_STEP_MS) {
        TripTopChart(
            data = data,
            prefs = prefs,
            onExportCsv = { export(TripExportFormat.Csv, trips) },
            onExportJson = { export(TripExportFormat.Json, trips) },
        )
    }
    FadeIn(delayMs = FADE_STEP_MS * 2) { TripListPanel(data = data, tripWord = tripWord) }

    if (data.rows.isNotEmpty()) {
        TripListPagination(
            page = page,
            total = tripPaginationTotal(page, data.rows.size),
            locale = prefs.locale,
            onPageChange = onSetPage,
        )
    }
}

// ── Summary cards (web Stats Cards) ──────────────────────────────────────────────────────────────────────────

/** One summary tile's resolved label + value + subtitle + accent icon (web `MetricCard` props). */
private data class TripStatTile(
    val label: String,
    val value: String,
    val subtitle: String,
    val icon: ImageVector,
    val accent: Color,
)

/**
 * The four summary MetricCards in a responsive grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`): total
 * distance, energy used, total cost, total trips. Each card resolves its label + count subtitle from the i18n
 * catalog and takes its formatted value from the folded [TripListData].
 */
@Composable
private fun TripStatsGrid(data: TripListData) {
    val cards =
        listOf(
            TripStatTile(
                label = stringResource(R.string.translation_trips_stats_distance),
                value = data.distanceValue,
                subtitle = stringResource(R.string.translation_trips_stats_tripCount, data.tripCount.toString()),
                icon = DataDisplayGlyphs.MapPin,
                accent = ACCENT_DISTANCE,
            ),
            TripStatTile(
                label = stringResource(R.string.translation_trips_stats_energy),
                value = data.energyValue,
                subtitle = stringResource(R.string.translation_trips_stats_driveCount, data.driveCount.toString()),
                icon = DataDisplayGlyphs.Bolt,
                accent = ACCENT_ENERGY,
            ),
            TripStatTile(
                label = stringResource(R.string.translation_trips_stats_cost),
                value = data.costValue,
                subtitle = data.costSubtitle,
                icon = FormsGlyphs.Tag,
                accent = ACCENT_COST,
            ),
            TripStatTile(
                label = stringResource(R.string.translation_trips_stats_total),
                value = data.tripCount.toString(),
                subtitle = stringResource(R.string.translation_trips_stats_totalDrives, data.driveCount.toString()),
                icon = NavGlyphs.Route,
                accent = ACCENT_TRIPS,
            ),
        )
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= LARGE_WINDOW_BREAKPOINT) GRID_COLUMNS_LG else GRID_COLUMNS_DEFAULT
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            cards.chunked(columns).forEach { rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowCards.forEach { card ->
                        MetricCard(
                            label = card.label,
                            value = card.value,
                            subtitle = card.subtitle,
                            icon = card.icon,
                            accent = card.accent,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

// ── Top-trips chart (web ChartContainer + BarChart) ──────────────────────────────────────────────────────────

/**
 * The top-trips-by-distance bar chart inside the shared [ChartContainer] (web `ChartContainer` + `BarChart`).
 * The container header carries the title, the accessible aria description, the CSV/JSON export actions, and an
 * expandable data table (the screen-reader fallback); the body is the [BarChartWrapper] when data exists, or the
 * localized empty state when there is none — so the panel never blanks.
 */
@Composable
private fun TripTopChart(
    data: TripListData,
    prefs: TripListDisplayPrefs,
    onExportCsv: () -> Unit,
    onExportJson: () -> Unit,
) {
    val unit = data.chart.unitLabel
    val distanceColumn = "${stringResource(R.string.translation_trips_chart_distance)} ($unit)"
    val tripColumn = stringResource(R.string.translation_trips_chart_col_trip)
    val emptyMessage = stringResource(R.string.translation_trips_chart_empty)
    val csvLabel = stringResource(R.string.translation_trips_export_csv)
    val jsonLabel = stringResource(R.string.translation_trips_export_json)
    val series =
        remember(data.chart, distanceColumn) {
            listOf(
                ChartSeries(
                    key = "distance",
                    label = distanceColumn,
                    values = data.chart.values,
                    kind = ChartSeriesKind.Bar,
                    color = ACCENT_DISTANCE,
                    unit = unit,
                ),
            )
        }
    ChartContainer(
        title = stringResource(R.string.translation_trips_chart_title),
        status = if (data.chart.hasData) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        accessibleDescription = stringResource(R.string.translation_trips_chart_title_aria),
        emptyMessage = emptyMessage,
        dataTableHeader = listOf(tripColumn, distanceColumn),
        dataTableRows = data.chart.tableRows,
        dataTableLabel = tripColumn,
        action = {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Button(
                    label = csvLabel,
                    onClick = onExportCsv,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = ChartGlyphs.Download,
                )
                Button(
                    label = jsonLabel,
                    onClick = onExportJson,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    leadingIcon = ChartGlyphs.Download,
                )
            }
        },
    ) {
        BarChartWrapper(
            series = series,
            xLabels = data.chart.labels,
            modifier = Modifier.fillMaxWidth(),
            height = CHART_HEIGHT,
            yValueFormatter = { ChartFormat.number(it, 0, prefs.locale) },
            emptyMessage = emptyMessage,
        )
    }
}

// ── Trip list (web GlassPanel list of TripRows) ──────────────────────────────────────────────────────────────

/**
 * The "All Trips" GlassPanel (web `GlassPanel6`): a section heading over either the list empty state (no trips)
 * or the column of [TripRow]s. The panel always renders — an empty list shows the localized empty state, never
 * a blank region.
 */
@Composable
private fun TripListPanel(
    data: TripListData,
    tripWord: String,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        SectionTitle(stringResource(R.string.translation_trips_list_heading))
        Spacer(modifier = Modifier.height(Spacing.md))
        if (data.rows.isEmpty()) {
            EmptyState(
                message = stringResource(R.string.translation_trips_list_empty),
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                data.rows.forEach { row -> TripRow(row = row, tripWord = tripWord) }
            }
        }
    }
}

/**
 * One trip row (web `GlassPanel7` / `TripRow`): a leading route disc + the trip name + a metadata strip (date,
 * duration, drives, optional charges), and the trailing distance / energy+efficiency / optional cost columns.
 * The name fallback reuses the i18n `trips.row.trip` word ("Trip #id"); the count chips use the catalog plurals.
 */
@Composable
private fun TripRow(
    row: TripRowView,
    tripWord: String,
) {
    val title = row.name ?: "$tripWord #${row.id}"
    val drivesLabel = stringResource(R.string.translation_trips_row_drives, row.drives.toString())
    val chargesLabel = stringResource(R.string.translation_trips_row_charges, row.charges.toString())
    val costLabel = stringResource(R.string.translation_trips_row_cost)
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier =
                        Modifier
                            .size(ROW_ICON_DISC)
                            .clip(CircleShape)
                            .background(ACCENT_DISTANCE.copy(alpha = DISC_BG_ALPHA)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(NavGlyphs.Route, contentDescription = null, tint = ACCENT_DISTANCE, size = IconSize.Sm)
                }
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText(title)
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        InlineMetric(icon = FormsGlyphs.Calendar, value = row.dateLabel)
                        InlineMetric(icon = DataDisplayGlyphs.Clock, value = row.durationLabel)
                        Caption(drivesLabel)
                        if (row.showCharges) Caption(chargesLabel)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                TripRowMetric(value = row.distanceValue, caption = drivesLabel)
                TripRowMetric(value = row.energyValue, caption = row.efficiencyValue)
                if (row.costValue != null) {
                    TripRowMetric(value = row.costValue, caption = costLabel)
                }
            }
        }
    }
}

/** A trailing trip-row metric column: a bold [value] over a muted [caption], merged for TalkBack. */
@Composable
private fun TripRowMetric(
    value: String,
    caption: String,
) {
    Column(
        horizontalAlignment = Alignment.End,
        modifier = Modifier.clearAndSetSemantics { contentDescription = "$value $caption" },
    ) {
        BodyText(value)
        Caption(caption)
    }
}

// ── Pagination (web Pagination) ──────────────────────────────────────────────────────────────────────────────

/** The list pagination strip (web `Pagination`). The "showing X–Y of Z" summary is locale-formatted in i18n. */
@Composable
private fun TripListPagination(
    page: Int,
    total: Int,
    locale: Locale,
    onPageChange: (Int) -> Unit,
) {
    val showingTemplate = stringResource(R.string.translation_pagination_showing)
    Pagination(
        page = page,
        pageSize = TripListPageRegistration.PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            String.format(locale, showingTemplate, start.toString(), end.toString(), count.toString())
        },
    )
}

/**
 * The heuristic total the pagination strip uses (web `estimatedTotal`): the backend returns no total count, so a
 * full page implies "there may be a next page" (`page*pageSize + 1`) while a short page is the true end
 * (`(page-1)*pageSize + size`).
 */
private fun tripPaginationTotal(
    page: Int,
    pageSize: Int,
): Int {
    val size = TripListPageRegistration.PAGE_SIZE
    return if (pageSize < size) (page - 1) * size + pageSize else page * size + 1
}

// ── Loading skeleton (web Skeleton cascade) ──────────────────────────────────────────────────────────────────

@Composable
private fun TripListLoading(modifier: Modifier = Modifier) {
    FadeIn {
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            PageHeaderSkeleton()
            StatGridSkeleton(count = GRID_COLUMNS_LG)
            ChartBlockSkeleton(height = CHART_HEIGHT)
            repeat(LIST_SKELETON_ROWS) { Skeleton(height = 72.dp) }
        }
    }
}

// ── Export (web exportAsCSV / exportAsJSON → Android share sheet) ─────────────────────────────────────────────

/** The two tabular export formats the chart action offers (web "CSV" / "JSON" buttons). */
private enum class TripExportFormat { Csv, Json }

/** Pretty-printed JSON encoder for the trip export, with defaults emitted so every SI column is present. */
private val tripExportJson = Json { prettyPrint = true; encodeDefaults = true }

/**
 * The default download handler — serialises the trips and opens the system share sheet, the native analogue of
 * the web browser file download (`exportAsCSV` / `exportAsJSON`). Uses `ACTION_SEND` so no `FileProvider` /
 * manifest wiring is needed (the sibling TelemetryErrorsPanel precedent).
 */
@Composable
private fun rememberTripExport(): (TripExportFormat, List<Trip>) -> Unit {
    val context = LocalContext.current
    return remember(context) {
        { format, trips ->
            val (mime, fileName, body) =
                when (format) {
                    TripExportFormat.Csv -> Triple("text/csv", "teslasync-trips-v2.csv", tripsToCsv(trips))
                    TripExportFormat.Json -> Triple("application/json", "teslasync-trips.json", tripsToJson(trips))
                }
            val send =
                Intent(Intent.ACTION_SEND).apply {
                    type = mime
                    putExtra(Intent.EXTRA_SUBJECT, fileName)
                    putExtra(Intent.EXTRA_TEXT, body)
                }
            val chooser = Intent.createChooser(send, fileName).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            context.startActivity(chooser)
        }
    }
}

/** The SI trip columns the web CSV export maps (distance in metres, energy in Wh — never converted). */
private fun tripsToCsv(trips: List<Trip>): String {
    val header = listOf("id", "name", "start_date", "end_date", "distance_m", "energy_wh", "cost", "drives", "charges")
    val rows =
        trips.map { trip ->
            listOf(
                trip.id.toString(),
                trip.name.orEmpty(),
                trip.startDate,
                trip.endDate.orEmpty(),
                trip.totalDistanceM.toString(),
                trip.totalEnergyWh.toString(),
                trip.totalCost.toString(),
                trip.driveCount.toString(),
                trip.chargeCount.toString(),
            )
        }
    return (listOf(header) + rows).joinToString("\n") { row -> row.joinToString(",") { csvCell(it) } }
}

/** Quotes a CSV cell only when it contains a comma, quote, or newline (doubling embedded quotes). */
private fun csvCell(value: String): String =
    if (value.any { it == ',' || it == '"' || it == '\n' }) "\"${value.replace("\"", "\"\"")}\"" else value

/** The full SI trip records as a JSON array (web `exportAsJSON(allTrips, …)`). */
private fun tripsToJson(trips: List<Trip>): String =
    tripExportJson.encodeToString(ListSerializer(Trip.serializer()), trips)
