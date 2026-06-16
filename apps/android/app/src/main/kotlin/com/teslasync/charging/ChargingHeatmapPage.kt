// The native Jetpack Compose + Material 3 ChargingHeatmapPage surface — a parity port of
// web/src/features/charging/pages/ChargingHeatmapPage.tsx, the "when & where you charge" dashboard. It reproduces the
// page's seven panels (the four summary cards — total sessions / energy / cost / average duration; the favorite-charging
// -time panel; the weekly day×hour heatmap with its legend; and the top-charging-locations bar chart), every data state
// (loading / empty / error / success, plus the cache-then-network stale/offline tier), and every visible string
// (resolved from the generated res/values catalog `charging.heatmap.*` / `common.*`, ADR-014).
//
// Composition: [ChargingHeatmapPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the paginated sessions feed + the live display preferences);
// [ChargingHeatmapPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip /
// vehicle scope picker — then the loading / error / loaded body). The loaded body draws every panel from the decoded
// sessions; all bucketing + aggregation lives in the framework-free model (ChargingHeatmapPageModel.kt), so this file
// only resolves i18n, maps heat tiers to design tokens, and draws. SI values are converted to display units only here at
// the boundary via the model's `prefs.energy` / `prefs.duration` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "LongMethod")

package io.teslasync.android.charging.chargingheatmap

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.currency.Currency
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.format.TextStyle

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 60

/** Heat grid cell + label dimensions. */
private val CELL_WIDTH: Dp = 18.dp
private val CELL_HEIGHT: Dp = 22.dp
private val CELL_RADIUS: Dp = 2.dp
private val CELL_GAP: Dp = 2.dp
private val DAY_LABEL_WIDTH: Dp = 46.dp
private val LEGEND_SWATCH_WIDTH: Dp = 22.dp
private val LEGEND_SWATCH_HEIGHT: Dp = 12.dp
private val CELL_SELECTED_BORDER: Dp = 1.5.dp

/** The chart's plotted height (web `ResponsiveContainer` height grows with rows; a fixed native height keeps it bounded). */
private val CHART_HEIGHT: Dp = 240.dp

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ChargingHeatmapPageViewModel] over the supplied [source] (the host wires the shared
 * Charging repository + Settings holder + the active-vehicle selection via [chargingHeatmapPageSourceOf]). [logger]
 * defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state.
 */
@Composable
fun ChargingHeatmapPage(
    source: ChargingHeatmapPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ChargingHeatmapPageViewModel =
        viewModel(
            key = ChargingHeatmapPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { ChargingHeatmapPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sessions by viewModel.sessions.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    ChargingHeatmapPageContent(
        sessions = sessions,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker), then the sessions-gated
 * body — a centered loader on a first load, a retryable error panel on a hard failure, or the loaded panels otherwise.
 * On an empty result the loaded body still draws every panel (zeroed cards, an all-cold grid, an empty locations state)
 * so no section is ever hidden.
 */
@Composable
fun ChargingHeatmapPageContent(
    sessions: UiState<List<ChargingSession>>,
    prefs: ChargingHeatmapDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        HeatmapChrome(sessions = sessions)

        when {
            sessions.isLoading -> HeatmapLoading()
            sessions.isError -> HeatmapErrorSurface(onRetry = onRetry)
            else -> HeatmapBody(sessions = sessions.data ?: emptyList(), prefs = prefs)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, and the scope picker (web actions). */
@Composable
private fun HeatmapChrome(sessions: UiState<List<ChargingSession>>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_charging_heatmap_title))
                BodyText(
                    stringResource(R.string.translation_charging_heatmap_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = sessions.fetchedAt,
                isFetching = sessions.refreshing,
                isStale = sessions.stale,
                isError = sessions.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `BatteryHealthSkeleton` analogue). */
@Composable
private fun HeatmapLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun HeatmapErrorSurface(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun HeatmapBody(
    sessions: List<ChargingSession>,
    prefs: ChargingHeatmapDisplayPrefs,
) {
    val zone = remember { ZoneId.systemDefault() }
    val unknownName = stringResource(R.string.translation_common_unknown)
    val stats = remember(sessions) { computeStats(sessions) }
    val grid = remember(sessions, zone) { buildGrid(sessions, zone) }
    val locations = remember(sessions, unknownName) { topLocations(sessions, unknownName) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { StatCardsSection(stats = stats, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS) { FavoritePanel(grid = grid, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { HeatmapGridPanel(grid = grid, prefs = prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { TopLocationsPanel(locations = locations, prefs = prefs) }
    }
}

// ── Panels 1-4 — Summary cards ──────────────────────────────────────────────────────────────────────────────────

/** GlassPanel1-4 — the four summary cards: total sessions, total energy, total cost, and average duration. */
@Composable
private fun StatCardsSection(
    stats: HeatStats,
    prefs: ChargingHeatmapDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_heatmap_totalSessions),
                accent = PanelAccent.Info,
            ) {
                MetricValue(prefs.integer(stats.count))
            }
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_heatmap_totalEnergy),
                accent = PanelAccent.Success,
            ) {
                MetricValue(prefs.energy(stats.totalEnergyWh))
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_heatmap_totalCost),
                accent = PanelAccent.Primary,
            ) {
                Currency(
                    value = stats.totalCost,
                    style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_charging_heatmap_avgDuration),
                accent = PanelAccent.None,
            ) {
                MetricValue(prefs.duration(stats.avgDurationSeconds))
            }
        }
    }
}

/** A single summary card — a [GlassPanel] with a caption label and a value slot (web stat `GlassPanel`). */
@Composable
private fun StatCard(
    label: String,
    accent: PanelAccent,
    modifier: Modifier = Modifier,
    value: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = accent) {
        Caption(label)
        Spacer(Modifier.height(Spacing.xs))
        value()
    }
}

/** The localized "N sessions" count text shared by the favorite panel + the heatmap cell detail (web `sessions`). */
@Composable
private fun sessionsCountText(
    prefs: ChargingHeatmapDisplayPrefs,
    count: Int,
): String = stringResource(R.string.translation_charging_heatmap_sessions_count, prefs.integer(count))

// ── Panel 5 — Favorite charging time ────────────────────────────────────────────────────────────────────────────

/** GlassPanel5 — the favorite (most-used) day + hour and its session count, or the empty note when no data exists. */
@Composable
private fun FavoritePanel(
    grid: HeatGrid,
    prefs: ChargingHeatmapDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg, accent = PanelAccent.Info) {
        Caption(stringResource(R.string.translation_charging_heatmap_favorite))
        Spacer(Modifier.height(Spacing.xs))
        if (grid.hasData) {
            MetricValue(
                stringResource(
                    R.string.translation_charging_heatmap_favorite_value,
                    dayName(grid.favoriteDay, TextStyle.FULL, prefs.locale),
                    hourLabel(grid.favoriteHour, prefs.locale),
                ),
            )
            Caption(sessionsCountText(prefs, grid.maxCount))
        } else {
            BodyText(
                stringResource(R.string.translation_common_noData),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Panel 6 — Weekly heatmap grid ───────────────────────────────────────────────────────────────────────────────

/** GlassPanel6 — the 7×24 day×hour heatmap, a tap-to-inspect detail line, and the Less→More legend. */
@Composable
private fun HeatmapGridPanel(
    grid: HeatGrid,
    prefs: ChargingHeatmapDisplayPrefs,
) {
    val dayShortNames = remember(prefs.locale) { (0 until DAYS_PER_WEEK).map { dayName(it, TextStyle.SHORT, prefs.locale) } }
    val hourTicks = remember(prefs.locale) { (0 until HOURS_PER_DAY).map { prefs.integer(it) } }
    var selected by remember { mutableStateOf<Pair<Int, Int>?>(null) }

    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_charging_heatmap_gridTitle))
        Spacer(Modifier.height(Spacing.md))
        Column(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(CELL_GAP),
        ) {
            HeatGridHeaderRow(hourTicks = hourTicks)
            for (day in 0 until DAYS_PER_WEEK) {
                HeatGridDayRow(
                    day = day,
                    dayLabel = dayShortNames[day],
                    grid = grid,
                    prefs = prefs,
                    selected = selected,
                    onSelect = { d, h -> selected = if (selected == d to h) null else d to h },
                )
            }
        }
        Spacer(Modifier.height(Spacing.md))
        HeatSelectedDetail(selected = selected, grid = grid, dayShortNames = dayShortNames, prefs = prefs)
        HeatLegend()
    }
}

/** The hour-of-day header row aligned above the cells (web hour header row). */
@Composable
private fun HeatGridHeaderRow(hourTicks: List<String>) {
    Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP), verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.width(DAY_LABEL_WIDTH))
        for (tick in hourTicks) {
            Box(modifier = Modifier.width(CELL_WIDTH), contentAlignment = Alignment.Center) {
                Caption(tick)
            }
        }
    }
}

/** One day row — its label plus the 24 hourly heat cells (web day row). */
@Composable
private fun HeatGridDayRow(
    day: Int,
    dayLabel: String,
    grid: HeatGrid,
    prefs: ChargingHeatmapDisplayPrefs,
    selected: Pair<Int, Int>?,
    onSelect: (Int, Int) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(CELL_GAP), verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.width(DAY_LABEL_WIDTH)) { Caption(dayLabel) }
        for (hour in 0 until HOURS_PER_DAY) {
            val cell = grid.cell(day, hour)
            val description =
                stringResource(
                    R.string.translation_charging_heatmap_cell,
                    dayLabel,
                    hourLabel(hour, prefs.locale),
                    sessionsCountText(prefs, cell.count),
                    prefs.energy(cell.totalEnergyWh),
                )
            HeatCellBox(
                level = heatLevel(cell.count, grid.maxCount),
                selected = selected == day to hour,
                description = description,
                onClick = { onSelect(day, hour) },
            )
        }
    }
}

/** A single heat cell — its background is the tier color, with a selection outline when tapped. */
@Composable
private fun HeatCellBox(
    level: Int,
    selected: Boolean,
    description: String,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(CELL_RADIUS)
    val base =
        Modifier
            .size(width = CELL_WIDTH, height = CELL_HEIGHT)
            .clip(shape)
            .background(heatColor(level))
            .clickable(onClick = onClick)
            .semantics { contentDescription = description }
    val outlined =
        if (selected) {
            base.border(BorderStroke(CELL_SELECTED_BORDER, MaterialTheme.colorScheme.onSurface), shape)
        } else {
            base
        }
    Spacer(modifier = outlined)
}

/** The tap-to-inspect detail line for the selected cell — the native analogue of the web hover tooltip. */
@Composable
private fun HeatSelectedDetail(
    selected: Pair<Int, Int>?,
    grid: HeatGrid,
    dayShortNames: List<String>,
    prefs: ChargingHeatmapDisplayPrefs,
) {
    if (selected == null) return
    val (day, hour) = selected
    val cell = grid.cell(day, hour)
    val detail =
        stringResource(
            R.string.translation_charging_heatmap_cell,
            dayShortNames[day],
            hourLabel(hour, prefs.locale),
            sessionsCountText(prefs, cell.count),
            prefs.energy(cell.totalEnergyWh),
        )
    BodyText(detail)
    Spacer(Modifier.height(Spacing.sm))
}

/** The Less→More density legend (web legend) — five swatches over the same tier colors the cells use. */
@Composable
private fun HeatLegend() {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
        Caption(stringResource(R.string.translation_charging_heatmap_less))
        for (level in 0..4) {
            Spacer(
                modifier =
                    Modifier
                        .size(width = LEGEND_SWATCH_WIDTH, height = LEGEND_SWATCH_HEIGHT)
                        .clip(RoundedCornerShape(CELL_RADIUS))
                        .background(heatColor(level)),
            )
        }
        Caption(stringResource(R.string.translation_charging_heatmap_more))
    }
}

/** Maps a heat tier (0 = empty … 4 = hottest) to a design-token color with computed alpha (web `heatColor`). */
@Composable
private fun heatColor(level: Int): Color =
    when (level) {
        1 -> TeslaTokens.status.info.copy(alpha = 0.25f)
        2 -> TeslaTokens.status.success.copy(alpha = 0.45f)
        3 -> TeslaTokens.status.warning.copy(alpha = 0.6f)
        4 -> TeslaTokens.status.danger.copy(alpha = 0.78f)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    }

// ── Panel 7 — Top charging locations ────────────────────────────────────────────────────────────────────────────

/** GlassPanel7 — the top-charging-locations bar chart, or the empty-state when fewer than two sessions share a place. */
@Composable
private fun TopLocationsPanel(
    locations: List<LocationCount>,
    prefs: ChargingHeatmapDisplayPrefs,
) {
    val seriesLabel = stringResource(R.string.translation_charging_heatmap_sessions_axis)
    val chartAria = stringResource(R.string.translation_charging_heatmap_grid_aria)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_charging_heatmap_topLocations))
        Spacer(Modifier.height(Spacing.md))
        if (locations.isNotEmpty()) {
            BarChartWrapper(
                series =
                    listOf(
                        ChartSeries(
                            key = "sessions",
                            label = seriesLabel,
                            values = locations.map { it.count * 1.0 },
                        ),
                    ),
                xLabels = locations.map { it.name },
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = chartAria },
                height = CHART_HEIGHT,
                yValueFormatter = { prefs.integer(it) },
            )
        } else {
            EmptyState(
                message = stringResource(R.string.translation_common_noData),
                icon = ChargingHeatmapGlyphs.Activity,
            )
        }
    }
}
