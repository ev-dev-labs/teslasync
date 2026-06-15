// The native Jetpack Compose + Material 3 ChargingCurvePage charging surface — a parity port of
// web/src/features/charging/pages/ChargingCurvePage.tsx, the power-vs-state-of-charge explorer. It reproduces the
// page's two inline panels (the no-sessions empty panel and the "select a session" hint panel), every data state
// (loading skeleton / empty / error-retry / content, plus the cache-then-network stale/offline tier the bound
// state holder carries), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [ChargingCurvePage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the sessions feed + the interaction snapshot);
// [ChargingCurvePageContent] is the stateless render layer. The single `useChargingSessionsPaginated` feed is
// fanned out by the framework-free model (ChargingCurvePageModel.deriveChargingCurveData) into the slices the
// existing A3 charging-curve feature views consume — SummaryStatsGrid, SessionCurveChart, SessionDetailPanel,
// SessionComparisonChart, ChargerTypeChart, SpeedTrendChart, TimeToChargeSection — exactly as the web page
// threads its loaded `sessions` / computed `stats` / `selectedSession` / `curveData` down to those same
// components. Each feature view owns its own loading / empty / error / content matrix, so this page wires the
// selection + the session selector and adds the page chrome (title, subtitle, the two inline panels).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingcurve

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ChartBlockSkeleton
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageHeaderSkeleton
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.StatGridSkeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.chargertypechart.ChargerTypeChart
import io.teslasync.android.featureviews.sessioncomparisonchart.ChargerKind
import io.teslasync.android.featureviews.sessioncomparisonchart.SessionComparisonChart
import io.teslasync.android.featureviews.sessioncomparisonchart.SessionComparisonChartProjection
import io.teslasync.android.featureviews.sessioncurvechart.SessionCurveChart
import io.teslasync.android.featureviews.sessiondetailpanel.SessionDetailPanel
import io.teslasync.android.featureviews.speedtrendchart.SpeedTrendChart
import io.teslasync.android.featureviews.summarystatsgrid.SummaryStatsGrid
import io.teslasync.android.featureviews.timetochargesection.TimeToChargeSection
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 50

/** Whole watt-hours per kilowatt-hour — the web `wh / 1000` divisor for the session-selector energy label. */
private const val WATTS_PER_KW = 1000.0

/** The page's interaction callbacks, wired to the [ChargingCurvePageViewModel] (web event handlers). */
data class ChargingCurveActions(
    val onSelectSession: (Long?) -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [ChargingCurvePageViewModel] over the supplied [source] (the host wires the
 * shared charging repository + the app-scoped active-vehicle selection via [chargingCurvePageSourceOf]).
 * [logger] defaults to the app's redacting logger.
 */
@Composable
fun ChargingCurvePage(
    source: ChargingCurvePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: ChargingCurvePageViewModel =
        viewModel(
            key = ChargingCurvePageRegistration.SLUG,
            factory = viewModelFactory { initializer { ChargingCurvePageViewModel(source, logger) } },
        )
    ChargingCurvePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed + interaction snapshot to the stateless content. */
@Composable
fun ChargingCurvePage(
    viewModel: ChargingCurvePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val sessionsState by viewModel.sessionsState.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            ChargingCurveActions(
                onSelectSession = viewModel::selectSession,
                onRetry = viewModel::retry,
            )
        }

    ChargingCurvePageContent(
        interaction = interaction,
        sessionsState = sessionsState,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading feed (with nothing cached) renders the full-page skeleton (web
 * `LoadingSkeleton`); otherwise the page header is drawn, then the hard-error retry surface, the no-sessions
 * empty panel (web `isEmpty` branch — GlassPanel 1), or the loaded content (the session selector + the seven
 * charging-curve feature views, including the select-session hint panel — GlassPanel 2).
 */
@Composable
fun ChargingCurvePageContent(
    interaction: ChargingCurveInteraction,
    sessionsState: UiState<List<ChargingSession>>,
    actions: ChargingCurveActions,
    modifier: Modifier = Modifier,
) {
    if (sessionsState.isLoading) {
        ChargingCurveLoading(modifier)
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
        ChargingCurveHeader()

        when {
            sessionsState.isError -> ChargingCurveError(onRetry = actions.onRetry)
            sessionsState.isEmpty -> ChargingCurveEmptyPanel()
            else ->
                ChargingCurveSuccess(
                    sessions = sessionsState.data.orEmpty(),
                    interaction = interaction,
                    actions = actions,
                )
        }
    }
}

/** The page header — the `<h1>` title + muted subtitle (web `PageContainer` / empty-branch heading). */
@Composable
private fun ChargingCurveHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_charging_curve_title))
        BodyText(
            stringResource(R.string.translation_charging_curve_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * GlassPanel 1 — the no-sessions empty panel (web `isEmpty` branch). Shows the empty headline + the muted hint,
 * so the region never collapses to a blank box.
 */
@Composable
private fun ChargingCurveEmptyPanel() {
    FadeIn {
        GlassPanel(padding = PanelPadding.Lg) {
            EmptyState(
                title = stringResource(R.string.translation_charging_curve_empty),
                message = stringResource(R.string.translation_charging_curve_emptyHint),
            )
        }
    }
}

/** The hard-error surface for the sessions feed (no cached fallback) — a retry-able error panel. */
@Composable
private fun ChargingCurveError(onRetry: () -> Unit) {
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
 * The loaded surface — the session selector, the summary stats grid, the single-session curve + detail (or the
 * select-session hint panel, GlassPanel 2), the session comparison, the charger-type + speed-trend charts, and
 * the time-to-charge section. The single sessions feed is fanned out into each feature view's input by the
 * framework-free model.
 */
@Composable
private fun ChargingCurveSuccess(
    sessions: List<ChargingSession>,
    interaction: ChargingCurveInteraction,
    actions: ChargingCurveActions,
) {
    val data = remember(sessions, interaction) { deriveChargingCurveData(sessions, interaction) }
    val format = rememberChargingCurveFormat()

    val options = remember(sessions, format) { sessions.map { SelectOption(value = it.id.toString(), label = format.label(it)) } }
    val curveSessions = remember(sessions) { sessions.map { it.toCurveSession() } }
    val chargerSessions = remember(sessions) { sessions.map { it.toChargerSession() } }
    val speedSessions = remember(sessions) { sessions.map { it.toSpeedSession() } }
    val timeSessions = remember(sessions) { sessions.map { it.toTimeToChargeSession() } }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        // Session selector (web `<Select>`), with the selected session's timestamp + place beneath it.
        Select(
            options = options,
            selectedValue = interaction.selectedSessionId?.toString(),
            onSelect = { value -> actions.onSelectSession(value.toLongOrNull()) },
            emptyLabel = stringResource(R.string.translation_charging_curve_selectSession),
        )
        data.selectedSession?.let { Caption(format.subtitle(it)) }

        // Summary stats grid (web `<SummaryStatsGrid stats={stats} />`).
        SummaryStatsGrid(stats = data.stats)

        // Single-session curve + detail, or GlassPanel 2 (the select-session hint).
        FadeIn(delayMs = FADE_STEP_MS) {
            val selected = data.selectedSession
            if (selected != null) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                    SessionCurveChart(curveData = data.curve)
                    SessionDetailPanel(session = selected)
                }
            } else {
                GlassPanel(padding = PanelPadding.Lg) {
                    EmptyState(message = stringResource(R.string.translation_charging_curve_selectSessionHint))
                }
            }
        }

        // Session comparison (web `<SessionComparisonChart sessions={sessions} />`).
        FadeIn(delayMs = FADE_STEP_MS * 2) {
            SessionComparisonChart(sessions = curveSessions)
        }

        // Charger type + speed trend (web side-by-side grid; stacked mobile-first).
        FadeIn(delayMs = FADE_STEP_MS * 3) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                ChargerTypeChart(sessions = chargerSessions)
                SpeedTrendChart(sessions = speedSessions)
            }
        }

        // Time-to-charge analysis (web `<TimeToChargeSection sessions={sessions} />`).
        FadeIn(delayMs = FADE_STEP_MS * 4) {
            TimeToChargeSection(sessions = timeSessions)
        }
    }
}

/**
 * The full-page loading skeleton (web `LoadingSkeleton`): the header, the selector row, the six-tile summary
 * grid, the curve + comparison chart blocks, the side-by-side chart blocks, and the time-to-charge tiles — so no
 * region flashes blank while the first load is in flight.
 */
@Composable
private fun ChargingCurveLoading(modifier: Modifier = Modifier) {
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
            Skeleton(widthFraction = SELECTOR_SKELETON_FRACTION, height = 44.dp)
            StatGridSkeleton(count = SUMMARY_SKELETON_TILES)
            ChartBlockSkeleton(height = 240.dp)
            ChartBlockSkeleton(height = 200.dp)
            ChartBlockSkeleton(height = 180.dp)
            ChartBlockSkeleton(height = 180.dp)
            StatGridSkeleton(count = TIME_TO_CHARGE_SKELETON_TILES)
        }
    }
}

// ── Display formatting (web `sessionLabel` + the selected-session subtitle) ────────────────────────────────────

/** The selector-label + selection-subtitle formatters, resolving their localized charger-type names once. */
private class ChargingCurveFormat(
    val label: (ChargingSession) -> String,
    val subtitle: (ChargingSession) -> String,
)

/**
 * Builds the [ChargingCurveFormat] for the current composition — the native analogue of the web `sessionLabel`
 * (`{date} — {chargerLabel} — {energy} kWh`) plus the selector's secondary timestamp/place line. The connector
 * names resolve from the shared `charging.chargerTypes.*` catalog keys (P1/S10); the date/time use the device
 * locale + zone, and the energy is the web `total_energy_added_wh / 1000` to one decimal (or `?` when absent).
 */
@Composable
private fun rememberChargingCurveFormat(): ChargingCurveFormat {
    val supercharger = stringResource(R.string.translation_charging_chargerTypes_supercharger)
    val dcFast = stringResource(R.string.translation_charging_chargerTypes_dc)
    val homeAc = stringResource(R.string.translation_charging_chargerTypes_home)
    return remember(supercharger, dcFast, homeAc) {
        val locale: Locale = Locale.getDefault()
        val zone: ZoneId = ZoneId.systemDefault()
        val dateFmt = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zone)
        val dateTimeFmt =
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(zone)

        fun startedInstant(session: ChargingSession): Instant = Instant.ofEpochMilli(session.startedAt.toEpochMilliseconds())

        fun connectorLabel(session: ChargingSession): String =
            when (SessionComparisonChartProjection.chargerKind(session.toCurveSession())) {
                ChargerKind.Supercharger -> supercharger
                ChargerKind.DcFast -> dcFast
                ChargerKind.HomeAc -> homeAc
            }

        ChargingCurveFormat(
            label = { session ->
                val energy = session.totalEnergyAddedWh?.let { String.format(locale, "%.1f", it / WATTS_PER_KW) } ?: "?"
                "${dateFmt.format(startedInstant(session))} \u2014 ${connectorLabel(session)} \u2014 $energy kWh"
            },
            subtitle = { session ->
                val base = dateTimeFmt.format(startedInstant(session))
                session.startPlace?.takeIf { it.isNotBlank() }?.let { "$base \u00B7 $it" } ?: base
            },
        )
    }
}

/** Width fraction of the parent the selector-row loading skeleton fills. */
private const val SELECTOR_SKELETON_FRACTION = 0.7f

/** Tile count for the summary-grid loading skeleton (the web six-card grid, sized for the mobile row). */
private const val SUMMARY_SKELETON_TILES = 3

/** Tile count for the time-to-charge loading skeleton (the web four-card grid). */
private const val TIME_TO_CHARGE_SKELETON_TILES = 4
