// The native Jetpack Compose + Material 3 VampireDrainPage surface — a parity port of
// web/src/features/battery/pages/VampireDrainPage.tsx, the phantom-energy-loss dashboard. It reproduces the page's nine
// panels, three charts, every data state (loading / error / success, plus the per-chart/table empty surface and the
// cache-then-network stale/offline tier), and every visible string (resolved from the generated translation_* catalog +
// the app-owned vampire_drain_* resources, ADR-014).
//
// Panel ↔ symbol map (the 9 manifest panels + the 3 charts):
//   1 Avg-Drain-Rate / 2 Total-Phantom-Loss / 3 Worst-Session / 4 Drain-Score → [SummaryMetricsGrid]
//   5 GlassPanel5 → [DrainScoreGaugePanel] (web gauge <GlassPanel>, L180)   chart RadialGauge → its [RadialGauge]
//   6 GlassPanel6 → [DrainRateTrendPanel]  (web trend <GlassPanel>, L195)   chart LineChart   → its [LineChartWrapper]
//   7 GlassPanel7 → [DailyDrainPanel]      (web daily <GlassPanel>, L216)   chart BarChart    → its [BarChartWrapper]
//   8 GlassPanel8 → [DrainSessionsPanel]   (web sessions <GlassPanel>, L239)
//   9 GlassPanel9 → [DrainTipsPanel]       (web tips <GlassPanel>, L261)
//
// Composition: [VampireDrainPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the stats feed + the live display preferences); [VampireDrainPageContent]
// is the stateless render layer (the chrome — title / subtitle / freshness chip / vehicle-scope picker — then the
// stats-gated body: a first-load loader, a retryable error, or the nine panels). All decode + derivation lives in the
// framework-free model (VampireDrainPageModel.kt); this file only resolves i18n + draws. The legacy %/kWh figures render
// verbatim (no SI scaling applies to percentages), exactly like the web.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LargeClass` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LargeClass")

package io.teslasync.android.battery.vampiredrain

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.toggledBy
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 100

/** The drain-score radial gauge size (web `RadialGauge size={160}`). */
private val GAUGE_SIZE = 160.dp

/** Theme-aware chart-palette accent indices (web per-card color), one per metric tile / series. */
private const val ACCENT_CYAN = 0
private const val ACCENT_GREEN = 1
private const val ACCENT_AMBER = 2
private const val ACCENT_RED = 3
private const val ACCENT_PURPLE = 4

/** Decimals for the trend-line y-axis (web `fmtNumber(drain_rate_pct_hr, 2)`) and the bar y-axis. */
private const val RATE_AXIS_DECIMALS = 2
private const val BAR_AXIS_DECIMALS = 1

/** Relative widths of the seven Drain-Sessions columns (web `compact` table). */
private const val COL_WEIGHT_DATE = 1.6f
private const val COL_WEIGHT_NUM = 1f
private const val COL_WEIGHT_BADGE = 1.2f

// ── Stateful entry ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [VampireDrainPageViewModel] over the supplied [source] (the host wires the shared
 * Energy + Settings holders + the app-scoped active-vehicle selection via [vampireDrainPageSourceOf]). [logger] defaults
 * to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the content.
 */
@Composable
fun VampireDrainPage(
    source: VampireDrainPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VampireDrainPageViewModel =
        viewModel(
            key = VampireDrainPageRegistration.ROUTE_ID,
            factory = viewModelFactory { initializer { VampireDrainPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val stats by viewModel.stats.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    VampireDrainPageContent(
        stats = stats,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + vehicle-scope picker + the stale/offline
 * banner), then the stats-gated body — a centered loader on a first load, a retryable error panel on a hard failure, or
 * the nine panels otherwise. Each chart/table renders its own content-or-empty surface so no section is ever hidden.
 */
@Composable
fun VampireDrainPageContent(
    stats: UiState<VampireDrainStats>,
    prefs: VampireDisplayPrefs,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    // web `usePageTitle(t('vampire.title', 'Vampire Drain'))` — the screen/document title; surfaced to TalkBack as the
    // accessible pane title (ADR-015), distinct from the visible `t('Vampire Drain')` header below.
    val paneTitleText = stringResource(R.string.translation_vampire_title)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .semantics { paneTitle = paneTitleText }
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        VampireDrainChrome(stats = stats)

        when {
            stats.isLoading -> VampireDrainLoading()
            stats.isError -> VampireDrainError(onRetry = onRetry)
            else -> VampireDrainBody(stats = stats.data ?: VampireDrainStats.EMPTY, prefs = prefs)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, the vehicle picker, and the stale banner. */
@Composable
private fun VampireDrainChrome(stats: UiState<VampireDrainStats>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.vampire_drain_title))
                BodyText(
                    stringResource(R.string.vampire_drain_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = stats.fetchedAt,
                isFetching = stats.refreshing,
                isStale = stats.stale,
                isError = stats.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `actions={<VehicleSelect />}` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
        // web `<LiveStaleDataBanner />` — surfaced only while cached data is shown because the network is unreachable.
        if (stats.isOffline) LiveStaleDataBanner()
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun VampireDrainLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun VampireDrainError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun VampireDrainBody(
    stats: VampireDrainStats,
    prefs: VampireDisplayPrefs,
) {
    FadeIn { SummaryMetricsGrid(stats = stats, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS) { DrainScoreGaugePanel(stats = stats) }
    FadeIn(delayMs = FADE_STEP_MS * 2) { DrainRateTrendPanel(stats = stats, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 3) { DailyDrainPanel(stats = stats, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 4) { DrainSessionsPanel(stats = stats, prefs = prefs) }
    FadeIn(delayMs = FADE_STEP_MS * 5) { DrainTipsPanel() }
}

// ── Panels 1-4 — Summary metric tiles ───────────────────────────────────────────────────────────────────────────

/**
 * Avg-Drain-Rate / Total-Phantom-Loss / Worst-Session / Drain-Score — the web 4-up summary `<MetricCard>` grid (always
 * visible, showing zeros before data lands), collapsed to two phone-width rows.
 */
@Composable
private fun SummaryMetricsGrid(
    stats: VampireDrainStats,
    prefs: VampireDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.vampire_drain_avg_rate),
                value = prefs.rate(stats.avgDrainRate),
                icon = VampireGlyphs.Bolt,
                accent = paletteColor(ACCENT_PURPLE),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.vampire_drain_total_loss),
                value = prefs.energyKwh(stats.totalEnergyLost),
                icon = VampireGlyphs.BatteryWarning,
                accent = paletteColor(ACCENT_RED),
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.vampire_drain_worst_session),
                value = prefs.percent1(stats.worstDrainPct),
                icon = VampireGlyphs.Activity,
                accent = paletteColor(ACCENT_AMBER),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.vampire_drain_score_card),
                value = prefs.score(stats.drainScore),
                icon = VampireGlyphs.ShieldAlert,
                accent = paletteColor(ACCENT_GREEN),
            )
        }
    }
}

// ── Panel 5 — Drain-score radial gauge (GlassPanel5) ────────────────────────────────────────────────────────────

/** GlassPanel5 — the web gauge panel: the drain-score [RadialGauge], colored by the score health tier (web `scoreColor`). */
@Composable
private fun DrainScoreGaugePanel(stats: VampireDrainStats) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            RadialGauge(
                value = stats.drainScore,
                max = DRAIN_SCORE_MAX,
                label = stringResource(R.string.translation_Score),
                unit = "/100",
                color = scoreTierColor(drainScoreTier(stats.drainScore)),
                size = GAUGE_SIZE,
            )
        }
    }
}

/** Maps the drain-score tier to the theme-aware status color the gauge sweeps in (web `CHART_COLORS` good/fair/poor). */
@Composable
private fun scoreTierColor(tier: DrainScoreTier): Color =
    when (tier) {
        DrainScoreTier.Good -> TeslaTokens.status.success
        DrainScoreTier.Fair -> TeslaTokens.status.warning
        DrainScoreTier.Poor -> TeslaTokens.status.danger
    }

// ── Panel 6 — Drain-rate trend line chart (GlassPanel6) ─────────────────────────────────────────────────────────

/**
 * GlassPanel6 — the web `Drain Rate Trend` line `<GlassPanel>`: the per-session idle-drain rate as a [LineChartWrapper]
 * inside a [ChartContainer] (which is itself the panel), or the empty surface when no session is recorded.
 */
@Composable
private fun DrainRateTrendPanel(
    stats: VampireDrainStats,
    prefs: VampireDisplayPrefs,
) {
    val entries = stats.entries
    val ready = entries.isNotEmpty()
    val rateLabel = stringResource(R.string.vampire_drain_series_rate)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.vampire_drain_trend_title),
        accessibleDescription = stringResource(R.string.vampire_drain_trend_title),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_widget_vampireDrain_noData),
        dataTableHeader = if (ready) listOf(stringResource(R.string.translation_Date), rateLabel) else null,
        dataTableRows =
            if (ready) {
                entries.map { listOf(prefs.dateShort(it.date), prefs.number2(it.drainRatePctHr)) }
            } else {
                null
            },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "rate",
                        label = rateLabel,
                        values = entries.map { it.drainRatePctHr },
                        kind = ChartSeriesKind.Line,
                        color = paletteColor(ACCENT_AMBER),
                        unit = "%/hr",
                    ),
                ),
            xLabels = entries.map { prefs.dateShort(it.date) },
            yValueFormatter = { ChartFormat.number(it, RATE_AXIS_DECIMALS, prefs.locale) },
        )
    }
}

// ── Panel 7 — Daily parked-drain bar chart (GlassPanel7) ────────────────────────────────────────────────────────

/**
 * GlassPanel7 — the web `Daily Drain While Parked` bar `<GlassPanel>`: the per-day drain % + parked hours as a
 * [BarChartWrapper] inside a [ChartContainer]. The web plots the two series on dual y-axes; the native cartesian wrapper
 * shares one axis (the exact figures are in the accessible data table), an accepted platform adaptation.
 */
@Composable
private fun DailyDrainPanel(
    stats: VampireDrainStats,
    prefs: VampireDisplayPrefs,
) {
    val daily = stats.daily
    val ready = daily.isNotEmpty()
    val drainLabel = stringResource(R.string.vampire_drain_legend_drain_pct)
    val hoursLabel = stringResource(R.string.vampire_drain_legend_parked_hours)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.vampire_drain_daily_title),
        accessibleDescription = stringResource(R.string.vampire_drain_daily_title),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_widget_vampireDrain_noData),
        dataTableHeader =
            if (ready) {
                listOf(stringResource(R.string.translation_Date), drainLabel, hoursLabel)
            } else {
                null
            },
        dataTableRows =
            if (ready) {
                daily.map {
                    listOf(prefs.dateShort(it.date), prefs.percent1(it.drainPct), prefs.number2(it.hoursParked))
                }
            } else {
                null
            },
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries(
                        key = "drain",
                        label = drainLabel,
                        values = daily.map { it.drainPct },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_RED),
                        unit = "%",
                    ),
                    ChartSeries(
                        key = "hours",
                        label = hoursLabel,
                        values = daily.map { it.hoursParked },
                        kind = ChartSeriesKind.Bar,
                        color = paletteColor(ACCENT_CYAN),
                        unit = "h",
                    ),
                ),
            xLabels = daily.map { prefs.dateShort(it.date) },
            yValueFormatter = { ChartFormat.number(it, BAR_AXIS_DECIMALS, prefs.locale) },
        )
    }
}

// ── Panel 8 — Drain-sessions table (GlassPanel8) ────────────────────────────────────────────────────────────────

/**
 * GlassPanel8 — the web `Drain Sessions` `<GlassPanel>`: the session count chip, then the sortable [DataTable] of every
 * idle-drain session (date / duration / start% / end% / loss% badge / rate / sentry badge), or the empty message.
 */
@Composable
private fun DrainSessionsPanel(
    stats: VampireDrainStats,
    prefs: VampireDisplayPrefs,
) {
    var sortState by remember { mutableStateOf(SortState(VampireSortKey.DATE, SortDirection.Desc)) }
    val rows =
        remember(stats.entries, sortState) {
            sortVampireEntries(stats.entries, sortState.key, sortState.direction == SortDirection.Desc)
        }
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(stringResource(R.string.vampire_drain_sessions_title))
            Badge(
                text = "${stats.entries.size} ${stringResource(R.string.translation_sessions)}",
                variant = BadgeVariant.Neutral,
            )
        }
        Spacer(Modifier.size(Spacing.sm))
        DataTable(
            columns = sessionColumns(prefs),
            rows = rows,
            keyOf = { it.id },
            sortState = sortState,
            onSortChange = { key -> sortState = sortState.toggledBy(key) },
            emptyText = stringResource(R.string.vampire_drain_empty_sessions),
        )
    }
}

/** The seven Drain-Sessions columns (web `Column<VampireDrainEntry>[]`), each formatting one row field. */
@Composable
private fun sessionColumns(prefs: VampireDisplayPrefs): List<TableColumn<VampireDrainEntry>> =
    listOf(
        TableColumn(
            key = VampireSortKey.DATE,
            header = stringResource(R.string.translation_Date),
            weight = COL_WEIGHT_DATE,
            sortable = true,
        ) { BodyText(prefs.dateTime(it.date)) },
        TableColumn(
            key = VampireSortKey.DURATION,
            header = stringResource(R.string.translation_Duration),
            weight = COL_WEIGHT_NUM,
            sortable = true,
        ) { BodyText(prefs.durationHours(it.durationHours)) },
        TableColumn(
            key = VampireSortKey.START,
            header = stringResource(R.string.vampire_drain_col_start),
            weight = COL_WEIGHT_NUM,
            sortable = true,
        ) { BodyText(prefs.percent0(it.startBattery)) },
        TableColumn(
            key = VampireSortKey.END,
            header = stringResource(R.string.vampire_drain_col_end),
            weight = COL_WEIGHT_NUM,
            sortable = true,
        ) { BodyText(prefs.percent0(it.endBattery)) },
        TableColumn(
            key = VampireSortKey.LOSS,
            header = stringResource(R.string.vampire_drain_col_loss),
            weight = COL_WEIGHT_BADGE,
            sortable = true,
        ) { Badge(text = prefs.percent1(it.drainPct), variant = lossBadgeVariant(drainLossTier(it.drainPct))) },
        TableColumn(
            key = VampireSortKey.RATE,
            header = stringResource(R.string.vampire_drain_col_rate),
            weight = COL_WEIGHT_NUM,
            sortable = true,
        ) { BodyText(prefs.number2(it.drainRatePctHr)) },
        TableColumn(
            key = VampireSortKey.SENTRY,
            header = stringResource(R.string.translation_Sentry),
            weight = COL_WEIGHT_BADGE,
            sortable = true,
        ) { SentryBadge(active = it.sentryActive) },
    )

/** The Sentry on/off chip (web `<Badge variant={sentry_active ? 'warning' : 'neutral'}>On/Off</Badge>`). */
@Composable
private fun SentryBadge(active: Boolean) {
    Badge(
        text = if (active) stringResource(R.string.translation_On) else stringResource(R.string.translation_Off),
        variant = if (active) BadgeVariant.Warning else BadgeVariant.Neutral,
    )
}

/** Maps the per-row Loss-% tier to its badge tone (web `drain_pct > 5 ? 'danger' : > 2 ? 'warning' : 'success'`). */
private fun lossBadgeVariant(tier: DrainLossTier): BadgeVariant =
    when (tier) {
        DrainLossTier.High -> BadgeVariant.Danger
        DrainLossTier.Medium -> BadgeVariant.Warning
        DrainLossTier.Low -> BadgeVariant.Success
    }

// ── Panel 9 — Recommendations (GlassPanel9) ─────────────────────────────────────────────────────────────────────

/** GlassPanel9 — the web `Tips to Reduce Vampire Drain` `<GlassPanel glow="green">`: the icon header + the four tips. */
@Composable
private fun DrainTipsPanel() {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(VampireGlyphs.Lightbulb, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.success)
            PanelTitle(stringResource(R.string.vampire_drain_tips_title))
        }
        Spacer(Modifier.size(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TipRow(icon = VampireGlyphs.ShieldAlert, text = stringResource(R.string.vampire_drain_tip_sentry))
            TipRow(icon = VampireGlyphs.Clock, text = stringResource(R.string.vampire_drain_tip_polling))
            TipRow(icon = VampireGlyphs.BatteryWarning, text = stringResource(R.string.vampire_drain_tip_app_frequency))
            TipRow(icon = VampireGlyphs.Activity, text = stringResource(R.string.vampire_drain_tip_energy_saving))
        }
    }
}

/** One recommendation row — a leading muted icon + the tip sentence (web `<li>` with its lucide icon). */
@Composable
private fun TipRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        BodyText(text, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up metric row (the phone-width grid cell the web `grid-cols-2` collapses to). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}
