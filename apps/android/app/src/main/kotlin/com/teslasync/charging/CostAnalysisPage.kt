// The native Jetpack Compose + Material 3 CostAnalysisPage charging surface — a parity port of
// web/src/features/charging/pages/CostAnalysisPage.tsx, the electricity-cost / gas-savings / charging-economics
// dashboard. It reproduces the page's no-charging-data empty state, its full-page loading skeleton, and every one
// of its panels — the six-card cost summary, the monthly-cost + cost-per-kWh charts, the charger-type breakdown,
// the gas-vs-EV savings calculator, the monthly-cost table, the time-of-use analysis, the cost-forecast section,
// the forecast details, and the lifetime-summary + environmental-impact pair — by composing the existing A3
// cost-analysis feature views (the same decomposition the web page uses), threading each its web-parity prop
// bundle. Every visible string resolves from the generated res/values catalog (ADR-014); every figure is computed
// from SI at the model's display boundary (Phase-48 SI-canonical).
//
// Composition: [CostAnalysisPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the sessions + forecast feeds, the range, the live
// display preferences, and the active vehicle); [CostAnalysisPageContent] is the stateless render layer. The
// single `useChargingSessionsPaginated` feed is fanned out by the framework-free model
// (CostAnalysisPageModel.deriveCostAnalysisData) into each feature view's input; the `useCostForecast` JSON is
// parsed into the two forecast feature views' inputs. Each feature view owns its own loading / empty / error /
// content matrix, so this page wires the page chrome (title, subtitle, freshness, range filter) plus the two
// page-level states (the no-sessions empty panel and the first-load skeleton).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete set.
@file:Suppress(
    "InvalidPackageDeclaration",
    "MatchingDeclarationName",
    "TooManyFunctions",
    "LongMethod",
)

package io.teslasync.android.charging.costanalysis

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.forms.DateRangeFilter
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.chargertypebreakdown.ChargerTypeBreakdown
import io.teslasync.android.featureviews.costforecastsection.CostForecastSection
import io.teslasync.android.featureviews.costperkwhchart.CostPerKwhChart
import io.teslasync.android.featureviews.costsummarycards.CostSummaryCards
import io.teslasync.android.featureviews.environmentalimpact.EnvironmentalImpact
import io.teslasync.android.featureviews.forecastdetails.ForecastDetails
import io.teslasync.android.featureviews.lifetimesummary.LifetimeSummary
import io.teslasync.android.featureviews.monthlycostchart.MonthlyCostChart
import io.teslasync.android.featureviews.monthlycosttable.MonthlyCostTable
import io.teslasync.android.featureviews.savingscalculator.SavingsCalculator
import io.teslasync.android.featureviews.timeofuseanalysis.TimeOfUseAnalysis
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import java.time.LocalDate
import java.time.ZoneId

/** Stagger between the body panels' entrance fades (web `FadeIn` / `space-y-6` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The skeleton stat-tile counts (web `xl:grid-cols-6` summary row, narrowed to 3 for a phone). */
private const val SUMMARY_SKELETON_TILES = 3

/** The page's interaction callbacks, wired to the [CostAnalysisPageViewModel] (web event handlers). */
data class CostAnalysisActions(
    val onSetRange: (LocalDate, LocalDate) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [CostAnalysisPageViewModel] over the supplied [source] (the host wires the shared
 * charging repository + the app-scoped active-vehicle selection + the settings store via
 * [costAnalysisPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun CostAnalysisPage(
    source: CostAnalysisPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: CostAnalysisPageViewModel =
        viewModel(
            key = CostAnalysisPageRegistration.SLUG,
            factory = viewModelFactory { initializer { CostAnalysisPageViewModel(source, logger) } },
        )
    CostAnalysisPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + range + display prefs to the stateless content. */
@Composable
fun CostAnalysisPage(
    viewModel: CostAnalysisPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val sessionsState by viewModel.sessionsState.collectAsStateWithLifecycle()
    val forecastState by viewModel.forecastState.collectAsStateWithLifecycle()
    val range by viewModel.range.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()
    val vehicleId by viewModel.vehicleId.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            CostAnalysisActions(
                onSetRange = viewModel::setRange,
                onRetry = viewModel::retry,
            )
        }

    CostAnalysisPageContent(
        sessionsState = sessionsState,
        forecastState = forecastState,
        range = range,
        prefs = prefs,
        vehicleId = vehicleId,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading sessions feed (with nothing cached) renders the full-page skeleton (web
 * `LoadingSkeleton`); otherwise the page header is drawn, then the hard-error retry surface, the no-charging-data
 * empty panel (web `!sessions || sessions.length === 0` branch), or the loaded content (the ten cost panels).
 */
@Composable
fun CostAnalysisPageContent(
    sessionsState: UiState<List<ChargingSession>>,
    forecastState: UiState<JsonElement>,
    range: CostRange,
    prefs: CostDisplayPrefs,
    vehicleId: Long?,
    actions: CostAnalysisActions,
    modifier: Modifier = Modifier,
) {
    if (sessionsState.isLoading) {
        CostAnalysisLoading(modifier)
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
        CostAnalysisHeader(sessionsState = sessionsState, range = range, onSetRange = actions.onSetRange)

        when {
            sessionsState.isError -> CostAnalysisError(onRetry = actions.onRetry)
            sessionsState.isEmpty -> CostAnalysisEmptyPanel()
            else ->
                CostAnalysisSuccess(
                    sessions = sessionsState.data.orEmpty(),
                    forecastJson = forecastState.data,
                    prefs = prefs,
                    vehicleId = vehicleId,
                )
        }
    }
}

/** The page header — the `<h1>` title, the muted subtitle, the query-freshness chip, and the date-range filter. */
@Composable
private fun CostAnalysisHeader(
    sessionsState: UiState<List<ChargingSession>>,
    range: CostRange,
    onSetRange: (LocalDate, LocalDate) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_costAnalysis_title))
                BodyText(
                    stringResource(R.string.translation_costAnalysis_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = sessionsState.fetchedAt?.takeIf { it > 0L },
                isFetching = sessionsState.refreshing,
                isStale = sessionsState.stale,
                isError = sessionsState.hasError,
                compact = true,
            )
        }
        DateRangeFilter(
            startEpochDay = range.start.toEpochDay(),
            endEpochDay = range.end.toEpochDay(),
            onRangeChange = { start, end ->
                onSetRange(
                    start?.let(LocalDate::ofEpochDay) ?: range.start,
                    end?.let(LocalDate::ofEpochDay) ?: range.end,
                )
            },
        )
    }
}

/**
 * The no-charging-data empty panel (web `!sessions || sessions.length === 0` branch). Shows the empty headline +
 * the muted hint, so the region never collapses to a blank box.
 */
@Composable
private fun CostAnalysisEmptyPanel() {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(
                title = stringResource(R.string.translation_costAnalysis_empty_title),
                message = stringResource(R.string.translation_costAnalysis_empty_message),
            )
        }
    }
}

/** The hard-error surface for the sessions feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun CostAnalysisError(onRetry: () -> Unit) {
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
 * The loaded surface — the ten cost panels in web source order. The single loaded `sessions` array is folded once
 * by the framework-free model into each feature view's web-parity prop bundle; the forecast JSON is parsed into
 * the two forecast feature views' inputs. Each feature view owns its own loading / empty / error / content matrix.
 */
@Composable
private fun CostAnalysisSuccess(
    sessions: List<ChargingSession>,
    forecastJson: JsonElement?,
    prefs: CostDisplayPrefs,
    vehicleId: Long?,
) {
    val zone = remember { ZoneId.systemDefault() }
    val data = remember(sessions, prefs, zone) { deriveCostAnalysisData(sessions, prefs.isMiles, zone, prefs.locale) }
    val forecastSection = remember(forecastJson) { parseForecastSection(forecastJson) }
    val forecastDetails = remember(forecastJson) { parseForecastDetails(forecastJson) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        // 1 — the six summary cards (web <CostSummaryCards coreStats gasPrice distanceUnit isMiles/>).
        FadeIn {
            CostSummaryCards(
                coreStats = data.summaryStats,
                gasPrice = DEFAULT_GAS_PRICE,
                distanceUnit = data.distanceUnit,
                isMiles = data.isMiles,
            )
        }

        // 2 — the monthly-cost + cost-per-kWh charts (web side-by-side grid; stacked mobile-first).
        FadeIn(delayMs = FADE_STEP_MS) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                MonthlyCostChart(data = data.monthlyPoints, vehicleId = vehicleId?.toInt())
                CostPerKwhChart(data = data.costPerKwhTrend)
            }
        }

        // 3 — the charger-type breakdown (web <ChargerTypeBreakdown data totalCost/>).
        FadeIn(delayMs = FADE_STEP_MS * 2) {
            ChargerTypeBreakdown(data = data.chargerTypeData, totalCost = data.chargerTotalCost)
        }

        // 4 — the gas-vs-EV savings calculator (web <SavingsCalculator/>; owns its own assumptions inputs).
        FadeIn(delayMs = FADE_STEP_MS * 3) {
            SavingsCalculator(baseStats = data.savingsBaseStats, distanceUnit = data.distanceUnit)
        }

        // 5 — the monthly-cost table (web <MonthlyCostTable data/>).
        FadeIn(delayMs = FADE_STEP_MS * 4) {
            MonthlyCostTable(data = data.monthlyBuckets)
        }

        // 6 — the time-of-use analysis (web <TimeOfUseAnalysis hourlyData touInsights/>).
        FadeIn(delayMs = FADE_STEP_MS * 5) {
            TimeOfUseAnalysis(hourlyData = data.timeOfUse.hourlyData, touInsights = data.timeOfUse.insights)
        }

        // 7 — the cost-forecast section: the composed forecast chart + the cost-per-kWh trend (web CostForecastSection).
        FadeIn(delayMs = FADE_STEP_MS * 6) {
            CostForecastSection(forecastData = forecastSection)
        }

        // 8 — the forecast details: breakdown donut + savings + insights (web CostForecastSection ▸ ForecastDetails).
        FadeIn(delayMs = FADE_STEP_MS * 7) {
            ForecastDetails(forecastData = forecastDetails)
        }

        // 9 — the lifetime-summary + environmental-impact pair (web side-by-side grid; stacked mobile-first).
        FadeIn(delayMs = FADE_STEP_MS * 8) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                LifetimeSummary(coreStats = data.lifetimeCoreStats, lifetimeMetrics = data.lifetimeMetrics)
                EnvironmentalImpact(data = data.environmental)
            }
        }
    }
}

/**
 * The full-page loading skeleton (web `LoadingSkeleton`): the header, the six-tile summary grid, the two chart
 * blocks, the charger-type block, the savings block, and the table — so no region flashes blank while the first
 * load is in flight.
 */
@Composable
private fun CostAnalysisLoading(modifier: Modifier = Modifier) {
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
            StatGridSkeleton(count = SUMMARY_SKELETON_TILES)
            StatGridSkeleton(count = SUMMARY_SKELETON_TILES)
            ChartBlockSkeleton(height = 240.dp)
            ChartBlockSkeleton(height = 240.dp)
            ChartBlockSkeleton(height = 200.dp)
            TableSkeleton(rows = 5, columns = 4)
        }
    }
}
