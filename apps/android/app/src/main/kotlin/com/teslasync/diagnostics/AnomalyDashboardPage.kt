// The native Jetpack Compose + Material 3 AnomalyDashboardPage diagnostics surface — a parity port of
// web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx, the automatic health-monitoring & signal-anomaly
// dashboard. It reproduces the page's seven panels (four summary stat-cards — signals-monitored, anomalies-7d,
// anomalies-24h, health-categories; the system-health category grid; the anomaly timeline; and the most-frequent-
// anomalies bar chart), every data state (loading / empty / error / success, plus the cache-then-network stale/offline
// tier), and every visible string (resolved from the generated res/values catalog `anomaly.*`, ADR-014).
//
// Composition: [AnomalyDashboardPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed); [AnomalyDashboardPageContent] is the stateless
// render layer (the page chrome — title / subtitle / freshness chip / vehicle scope picker — then the loading / error /
// empty / loaded body). The loaded body draws every panel from the decoded report; all decode + derivation lives in the
// framework-free model (AnomalyDashboardPageModel.kt), so this file only resolves i18n + draws. The anomaly value /
// baseline / z_score are raw, dimensionless signal readings rendered verbatim (web `fmtNumber`); there is no SI→display
// unit conversion on this surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/diagnostics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.diagnostics.anomalydashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
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
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.formatFreshnessAge
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Decimals for the z-score sigma chip (web `fmtNumber(z_score, 1)`). */
private const val Z_SCORE_DECIMALS = 1

/** Decimals for the value / baseline figures (web `fmtNumber(value, 2)` / `fmtNumber(baseline, 2)`). */
private const val VALUE_DECIMALS = 2

/** Whole counts (signals / anomaly tallies) carry no fraction (web `fmtNumber(count)` over integers). */
private const val COUNT_DECIMALS = 0

/** The sigma suffix the statistical chip reads as a literal (web `…σ`). */
private const val SIGMA_SUFFIX = "\u03C3"

/** Palette index the frequency bar fill resolves from (web `CHART_COLORS[3]`). */
private const val BAR_COLOR_INDEX = 3

/** Low-alpha washes that tint a timeline row by its severity (web `bg-…/[0.05]` + `border-…/15`). */
private const val ROW_BG_ALPHA = 0.06f
private const val ROW_BORDER_ALPHA = 0.16f

/** The health-category tokens the web maps to dedicated glyphs (web `HEALTH_ICONS`). */
private const val CATEGORY_BATTERY = "battery"
private const val CATEGORY_TIRES = "tires"
private const val CATEGORY_MOTORS = "motors"
private const val CATEGORY_HVAC = "hvac"
private const val CATEGORY_CHARGING = "charging"

/** Canonical severity tokens the web `severityVariant`/`toneOf` mapping keys on. */
private const val SEVERITY_CRITICAL = "critical"
private const val SEVERITY_WARNING = "warning"

/** Phone-width health grid: two tiles per row (web `grid-cols-2`). */
private const val HEALTH_COLUMNS = 2

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AnomalyDashboardPageViewModel] over the supplied [source] (the host wires the
 * shared-core anomalies repository + the active-vehicle selection via [anomalyDashboardPageSourceOf]). [logger]
 * defaults to the app's redacting logger. Records the one-shot `view.opened` diagnostic and binds the live state to the
 * content.
 */
@Composable
fun AnomalyDashboardPage(
    source: AnomalyDashboardPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: AnomalyDashboardPageViewModel =
        viewModel(
            key = AnomalyDashboardPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AnomalyDashboardPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()

    AnomalyDashboardPageContent(
        state = state,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker), then the
 * report-gated body — a centered loader on a first load, a retryable error panel on a hard failure, a friendly empty
 * surface when no report exists for the scope, or the loaded panels otherwise. The loaded panels each render their own
 * content-or-empty surface so no section is ever hidden.
 */
@Composable
fun AnomalyDashboardPageContent(
    state: UiState<AnomalyReport>,
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
        AnomalyChrome(state = state)

        when {
            state.isLoading -> AnomalyLoading()
            state.isError -> AnomalyError(onRetry = onRetry)
            state.isEmpty -> AnomalyEmpty()
            else -> AnomalyBody(report = state.data ?: AnomalyReport.EMPTY)
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer` title/subtitle), the freshness chip, and the scope picker. */
@Composable
private fun AnomalyChrome(state: UiState<AnomalyReport>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_anomaly_title))
                BodyText(
                    stringResource(R.string.translation_anomaly_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        // web `actions={<VehicleSelect />}` — the global active-vehicle scope picker.
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun AnomalyLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun AnomalyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The no-report surface — shown when no vehicle is selected or the vehicle has no telemetry yet. */
@Composable
private fun AnomalyEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noVehicleSelected_desc),
        title = stringResource(R.string.translation_common_noVehicleSelected_title),
        icon = AnomalyDashboardGlyphs.Shield,
    )
}

/** The loaded body — the seven panels in their web order, each entering with a staggered fade. */
@Composable
private fun AnomalyBody(report: AnomalyReport) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { SummaryStatsGrid(report) }
        FadeIn(delayMs = FADE_STEP_MS) { HealthSummaryPanel(report.healthCategories) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { TimelinePanel(report.anomalies) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { FrequencyPanel(report.signalFrequency) }
    }
}

// ── Panels 1-4 — Summary stat cards ─────────────────────────────────────────────────────────────────────────────

/** Signals-Monitored / Anomalies-7d / Anomalies-24h / Health-Categories — the web 4-up `<StatCard>` grid. */
@Composable
private fun SummaryStatsGrid(report: AnomalyReport) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_anomaly_monitored),
                value = intText(report.signalsMonitored),
                icon = AnomalyDashboardGlyphs.Activity,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_anomaly_last7d),
                value = intText(report.anomaliesLast7d),
                icon = AnomalyDashboardGlyphs.AlertTriangle,
            )
        }
        MetricRow {
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_anomaly_last24h),
                value = intText(report.anomaliesLast24h),
                icon = AnomalyDashboardGlyphs.Shield,
            )
            StatCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_anomaly_categories),
                value = intText(report.healthCategoryCount),
                icon = AnomalyDashboardGlyphs.Thermometer,
            )
        }
    }
}

// ── Panel 5 — System health category grid ───────────────────────────────────────────────────────────────────────

/** GlassPanel5 — the system-health grid: a tile per category (icon + name + status badge), or the `noHealth` empty-state. */
@Composable
private fun HealthSummaryPanel(categories: List<AnomalyHealthCategory>) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_anomaly_healthSummary))
        Spacer(modifier = Modifier.height(Spacing.md))
        if (categories.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                categories.chunked(HEALTH_COLUMNS).forEach { rowItems ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    ) {
                        rowItems.forEach { HealthCategoryTile(category = it, modifier = Modifier.weight(1f)) }
                        if (rowItems.size < HEALTH_COLUMNS) Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        } else {
            EmptyState(message = stringResource(R.string.translation_anomaly_noHealth))
        }
    }
}

/** One health-category tile — the category glyph tinted by status, the capitalized name, and the raw status badge. */
@Composable
private fun HealthCategoryTile(
    category: AnomalyHealthCategory,
    modifier: Modifier = Modifier,
) {
    val tone = toneOf(category.status)
    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = tone.panelAccent()) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                healthIcon(category.category),
                contentDescription = null,
                size = IconSize.Lg,
                tint = tone.statusColor(),
            )
            BodyText(category.category.replaceFirstChar { it.uppercaseChar() })
            SeverityBadge(
                severity = tone.severityWire(),
                label = category.status,
                showIcon = false,
                size = ChipSize.Sm,
            )
        }
    }
}

// ── Panel 6 — Anomaly timeline ──────────────────────────────────────────────────────────────────────────────────

/** GlassPanel6 — the anomaly timeline: a row per detected anomaly, or the `noAnomalies` empty-state. */
@Composable
private fun TimelinePanel(anomalies: List<AnomalyEntry>) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                AnomalyDashboardGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            PanelTitle(stringResource(R.string.translation_anomaly_timeline))
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        if (anomalies.isNotEmpty()) {
            val now = remember { System.currentTimeMillis() }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                anomalies.forEach { TimelineRow(entry = it, nowMillis = now) }
            }
        } else {
            EmptyState(
                message = stringResource(R.string.translation_anomaly_noAnomalies),
                icon = AnomalyDashboardGlyphs.Shield,
            )
        }
    }
}

/** One timeline row — severity badge, signal + type chip + sigma, the message, and the value/baseline/detected-at meta. */
@Composable
private fun TimelineRow(
    entry: AnomalyEntry,
    nowMillis: Long,
) {
    val tone = toneOf(entry.severity)
    val toneColor = tone.statusColor()
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = toneColor.copy(alpha = ROW_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, toneColor.copy(alpha = ROW_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            SeverityBadge(
                severity = tone.severityWire(),
                label = entry.severity,
                showIcon = false,
                size = ChipSize.Sm,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Subhead(entry.signal)
                    Badge(text = entry.typeLabel, variant = BadgeVariant.Neutral)
                    if (entry.hasZScore) {
                        Caption(ChartFormat.number(entry.zScore, Z_SCORE_DECIMALS) + SIGMA_SUFFIX)
                    }
                }
                BodyText(entry.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    Caption(
                        stringResource(R.string.translation_anomaly_value) +
                            ": " + ChartFormat.number(entry.value, VALUE_DECIMALS),
                    )
                    Caption(
                        stringResource(R.string.translation_anomaly_baseline) +
                            ": " + ChartFormat.number(entry.baseline, VALUE_DECIMALS),
                    )
                    Caption(formatFreshnessAge(relativeAge(computeAgeSeconds(entry.detectedAtMillis, nowMillis))))
                }
            }
            Icon(
                AnomalyDashboardGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Panel 7 — Most frequent anomalies (bar chart) ───────────────────────────────────────────────────────────────

/** GlassPanel7 — the most-frequent-anomalies bar `<ChartContainer>`: count per signal, or the `noFrequency` empty-state. */
@Composable
private fun FrequencyPanel(frequency: List<AnomalySignalFrequency>) {
    val ready = frequency.isNotEmpty()
    val countLabel = stringResource(R.string.translation_anomaly_count)
    val title = stringResource(R.string.translation_anomaly_frequency)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = title,
        accessibleDescription = title,
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_anomaly_noFrequency),
        dataTableHeader = if (ready) listOf("", countLabel) else null,
        dataTableRows = if (ready) frequency.map { listOf(it.signal, intText(it.count)) } else null,
    ) {
        val series =
            listOf(
                ChartSeries(
                    key = "count",
                    label = countLabel,
                    values = frequency.map { it.count.toDouble() }, // parity:allow toDouble substring, not a stub
                    kind = ChartSeriesKind.Bar,
                    color = paletteColor(BAR_COLOR_INDEX),
                ),
            )
        BarChartWrapper(
            series = series,
            xLabels = frequency.map { it.signal },
            yValueFormatter = { ChartFormat.number(it, COUNT_DECIMALS) },
        )
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

/** A grouped whole-number string in the user's locale (web `fmtNumber` over an integer). */
private fun intText(value: Int): String = ChartFormat.number(value.toDouble(), COUNT_DECIMALS) // parity:allow toDouble

/** The category glyph the web `HEALTH_ICONS` map resolves (default: Shield). */
private fun healthIcon(category: String): ImageVector =
    when (category.trim().lowercase()) {
        CATEGORY_BATTERY -> AnomalyDashboardGlyphs.Battery
        CATEGORY_TIRES -> AnomalyDashboardGlyphs.Car
        CATEGORY_MOTORS -> AnomalyDashboardGlyphs.Bolt
        CATEGORY_HVAC -> AnomalyDashboardGlyphs.Wind
        CATEGORY_CHARGING -> AnomalyDashboardGlyphs.Activity
        else -> AnomalyDashboardGlyphs.Shield
    }

/**
 * The severity tone of a status / severity token — the web `severityVariant`: `critical`→danger, `warning`→warning,
 * anything else (including `info` and the healthy statuses) → the success tone.
 */
private enum class AnomalyTone { Critical, Warning, Normal }

private fun toneOf(raw: String): AnomalyTone =
    when (raw.trim().lowercase()) {
        SEVERITY_CRITICAL -> AnomalyTone.Critical
        SEVERITY_WARNING -> AnomalyTone.Warning
        else -> AnomalyTone.Normal
    }

/** The canonical severity token the shared [SeverityBadge] colors from (kept distinct from the displayed raw label). */
private fun AnomalyTone.severityWire(): String =
    when (this) {
        AnomalyTone.Critical -> "critical"
        AnomalyTone.Warning -> "warning"
        AnomalyTone.Normal -> "success"
    }

/** The tinted panel border accent for a health tile (web `statusBg`). */
private fun AnomalyTone.panelAccent(): PanelAccent =
    when (this) {
        AnomalyTone.Critical -> PanelAccent.Danger
        AnomalyTone.Warning -> PanelAccent.Warning
        AnomalyTone.Normal -> PanelAccent.Success
    }

/** The per-theme status color for an icon tint / row wash (web `statusColor`). */
@Composable
@ReadOnlyComposable
private fun AnomalyTone.statusColor(): Color =
    when (this) {
        AnomalyTone.Critical -> TeslaTokens.status.danger
        AnomalyTone.Warning -> TeslaTokens.status.warning
        AnomalyTone.Normal -> TeslaTokens.status.success
    }
