// The native Jetpack Compose + Material 3 SafetySettingsPage vehicle-systems surface — a parity port of
// web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx, the ADAS-features / safety-score / driving-stats
// dashboard. It reproduces the page's panels (the safety-score radial gauge, the four score stat cards, the four live
// seat-belt/lock signal cards, the two driving-distance metrics, the nine ADAS feature cards, the safety-states step
// chart and the settings-history table), every data state (loading / empty / error / success, plus the
// cache-then-network stale/offline tier), and every visible string (resolved from the generated res/values catalog,
// ADR-014).
//
// Composition: [SafetySettingsPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the four feeds + the live display preferences);
// [SafetySettingsPageContent] is the stateless render layer (the page chrome — title / subtitle / freshness chip /
// vehicle scope picker — then the loading / error / empty / loaded body). The loaded body draws every panel from the
// decoded models; all decode + formatting lives in the framework-free model (SafetySettingsPageModel.kt), so this file
// only resolves i18n + draws. SI metres are converted to the user's distance unit only here at the display boundary
// via `prefs.distance` (Phase-48 SI-canonical).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions` for the parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod")

package io.teslasync.android.vehiclesystems.safetysettings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.LineChartWrapper
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicleselect.VehicleSelect
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

/** Stagger between the body panels' entrance fades (web `FadeIn delay` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** Safety-score thresholds (web `scoreColor` / badge variant): ≥80 green, ≥50 amber, else red. */
private const val SCORE_HIGH = 80.0
private const val SCORE_MID = 50.0

/** Full safety score denominator for the gauge (the arc fills score% of 100, web `enabled/9 == scorePct/100`). */
private const val SCORE_MAX = 100.0

/** The hard-coded percent unit the gauge centre + the score card render (web `%`, never i18n). */
private const val PERCENT_UNIT = "%"

/** The chart y-axis threshold separating the On (1) / Off (0) step levels. */
private const val ON_THRESHOLD = 0.5

private val GAUGE_SIZE = 120.dp
private val CHART_HEIGHT = 300.dp
private val SIGNAL_DOT = 8.dp
private val FEATURE_DOT = 8.dp

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SafetySettingsPageViewModel] over the supplied [source] (the host wires the
 * page-local safety repository + the shared Settings holder + the active-vehicle selection via
 * [safetySettingsPageSourceOf]). [logger] defaults to the app's redacting logger. Records the one-shot `view.opened`
 * diagnostic and binds the live state to the content.
 */
@Composable
fun SafetySettingsPage(
    source: SafetySettingsPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: SafetySettingsPageViewModel =
        viewModel(
            key = SafetySettingsPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SafetySettingsPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val history by viewModel.history.collectAsStateWithLifecycle()
    val security by viewModel.security.collectAsStateWithLifecycle()
    val prefs by viewModel.displayPrefs.collectAsStateWithLifecycle()

    SafetySettingsPageContent(
        state = state,
        history = history,
        security = security,
        prefs = prefs,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + the data-freshness chip + the vehicle-scope picker), then
 * the safety-latest-gated body — a centered loader on a first load, a retryable error panel on a hard failure, a
 * `No safety data…` empty-state when the vehicle has no snapshot, or the loaded panels otherwise. The history /
 * security feeds each render their own content-or-empty surface so no section is ever hidden.
 */
@Composable
fun SafetySettingsPageContent(
    state: UiState<SafetySnapshot>,
    history: UiState<List<SafetySnapshot>>,
    security: SecurityLatest,
    prefs: SafetyDisplayPrefs,
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
        SafetyChrome(state = state)

        when {
            state.isLoading || history.isLoading -> SafetyLoading()
            state.isError -> SafetyErrorSurface(onRetry = onRetry)
            state.isEmpty -> SafetyEmpty()
            else -> {
                if (state.hasError || history.hasError) SafetyOfflineBanner()
                SafetyBody(
                    snapshot = state.data ?: SafetySnapshot.EMPTY,
                    history = history,
                    security = security,
                    prefs = prefs,
                )
            }
        }
    }
}

/** The page chrome — title + subtitle (web `PageContainer` title/subtitle), the freshness chip, and the scope picker. */
@Composable
private fun SafetyChrome(state: UiState<SafetySnapshot>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_Safety_Settings))
                BodyText(
                    stringResource(R.string.translation_ADAS_features__safety_score__and_driving_stats),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
            )
        }
        VehicleSelect(withIcon = true)
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading` ▸ skeleton). */
@Composable
private fun SafetyLoading() {
    PageLoader(modifier = Modifier.fillMaxWidth())
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error` + the `error.loadFailed`). */
@Composable
private fun SafetyErrorSurface(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        onRetry = onRetry,
    )
}

/** The no-data surface — the web `<EmptyState message="No safety data available for this vehicle." />`. */
@Composable
private fun SafetyEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_No_safety_data_available_for_this_vehicle_),
        icon = SafetyGlyphs.Shield,
    )
}

/** The offline/last-known banner shown when a refresh failed but cached data is still rendered (web `anyError`). */
@Composable
private fun SafetyOfflineBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_error_loadFailed),
        tone = Tone.Danger,
        icon = SafetyGlyphs.AlertCircle,
    )
}

/** The loaded body — every panel in its web order, each entering with a staggered fade. */
@Composable
private fun SafetyBody(
    snapshot: SafetySnapshot,
    history: UiState<List<SafetySnapshot>>,
    security: SecurityLatest,
    prefs: SafetyDisplayPrefs,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn { ScoreSection(snapshot) }
        FadeIn(delayMs = FADE_STEP_MS) { LiveSignalsPanel(security) }
        FadeIn(delayMs = FADE_STEP_MS * 2) { DrivingStatsPanel(snapshot, prefs) }
        FadeIn(delayMs = FADE_STEP_MS * 3) { AdasFeaturesPanel(snapshot) }
        FadeIn(delayMs = FADE_STEP_MS * 4) { SafetyStatesChartPanel(history) }
        FadeIn(delayMs = FADE_STEP_MS * 5) { SafetyHistoryPanel(history) }
    }
}

// ── Score section (GlassPanel1 gauge + the four stat cards) ─────────────────────────────────────────────────────

/** The safety-score gauge panel + the four score stat cards (web score section). */
@Composable
private fun ScoreSection(snapshot: SafetySnapshot) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        ScoreGaugePanel(snapshot)
        ScoreStatCards(snapshot)
    }
}

/** GlassPanel1 — the safety-score radial gauge with the `enabled/total enabled` badge below. */
@Composable
private fun ScoreGaugePanel(snapshot: SafetySnapshot) {
    val pct = snapshot.scorePercent
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            RadialGauge(
                value = pct,
                max = SCORE_MAX,
                label = stringResource(R.string.translation_Safety_Score),
                unit = PERCENT_UNIT,
                color = scoreColor(pct),
                size = GAUGE_SIZE,
            )
            Badge(
                text = "${snapshot.enabledCount}/$TOTAL_FEATURES ${stringResource(R.string.translation_enabled)}",
                variant = scoreBadgeVariant(pct),
            )
        }
    }
}

/** Safety-Score / Total-Features / Enabled / Disabled — the web four-up `<MetricCard>` grid (2×2 on phone). */
@Composable
private fun ScoreStatCards(snapshot: SafetySnapshot) {
    val pct = snapshot.scorePercent
    val disabled = snapshot.disabledCount
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Safety_Score),
                value = "${pctInt(pct)}$PERCENT_UNIT",
                accent = scoreColor(pct),
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Total_Features),
                value = TOTAL_FEATURES.toString(),
                accent = TeslaTokens.status.info,
            )
        }
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Enabled),
                value = snapshot.enabledCount.toString(),
                accent = TeslaTokens.status.success,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_Disabled),
                value = disabled.toString(),
                accent = if (disabled > 0) TeslaTokens.status.danger else TeslaTokens.status.success,
            )
        }
    }
}

// ── GlassPanel8 — Live safety signals ───────────────────────────────────────────────────────────────────────────

/** GlassPanel8 — the four live seat-belt / seat / lock signal cards (web Live Safety Signals). */
@Composable
private fun LiveSignalsPanel(security: SecurityLatest) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_safety_liveSignals))
        Spacer(Modifier.height(Spacing.md))
        val buckled = stringResource(R.string.translation_safety_buckled)
        val unbuckled = stringResource(R.string.translation_safety_unbuckled)
        val occupied = stringResource(R.string.translation_safety_occupied)
        val empty = stringResource(R.string.translation_safety_empty)
        val locked = stringResource(R.string.translation_safety_locked)
        val unlocked = stringResource(R.string.translation_safety_unlocked)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricRow {
                SignalCard(
                    modifier = Modifier.weight(1f),
                    icon = SafetyGlyphs.UserCheck,
                    value = boolLabel(security.driverSeatBelt, buckled, unbuckled),
                    label = stringResource(R.string.translation_safety_driverBelt),
                    positive = security.driverSeatBelt,
                )
                SignalCard(
                    modifier = Modifier.weight(1f),
                    icon = SafetyGlyphs.UserCheck,
                    value = boolLabel(security.passengerSeatBelt, buckled, unbuckled),
                    label = stringResource(R.string.translation_safety_passengerBelt),
                    positive = security.passengerSeatBelt,
                )
            }
            MetricRow {
                SignalCard(
                    modifier = Modifier.weight(1f),
                    icon = SafetyGlyphs.Armchair,
                    value = boolLabel(security.driverSeatOccupied, occupied, empty),
                    label = stringResource(R.string.translation_safety_driverSeat),
                    positive = security.driverSeatOccupied,
                )
                SignalCard(
                    modifier = Modifier.weight(1f),
                    icon = SafetyGlyphs.Lock,
                    value = boolLabel(security.locked, locked, unlocked),
                    label = stringResource(R.string.translation_safety_vehicleLock),
                    positive = security.locked,
                )
            }
        }
    }
}

/** One live-signal card — a glass tile with an icon, a status value, and a caption (web `SignalCard`). */
@Composable
private fun SignalCard(
    icon: ImageVector,
    value: String,
    label: String,
    positive: Boolean?,
    modifier: Modifier = Modifier,
) {
    val color = signalColor(positive)
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "$label: $value" },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = color)
            MetricValue(value)
            Caption(label)
        }
    }
}

// ── GlassPanel9 — Driving statistics ────────────────────────────────────────────────────────────────────────────

/** GlassPanel9 — the two driving-distance metrics, SI metres converted at the display boundary (web Driving Stats). */
@Composable
private fun DrivingStatsPanel(
    snapshot: SafetySnapshot,
    prefs: SafetyDisplayPrefs,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_safety_drivingStats))
        Spacer(Modifier.height(Spacing.md))
        MetricRow {
            MetricCard(
                modifier = Modifier.weight(1f),
                icon = SafetyGlyphs.Navigation,
                label = stringResource(R.string.translation_safety_distanceSinceReset),
                value = snapshot.milesSinceReset?.let { prefs.number(prefs.distance(it)) } ?: EM_DASH,
                subtitle = prefs.distanceLabel,
                accent = TeslaTokens.status.info,
            )
            MetricCard(
                modifier = Modifier.weight(1f),
                icon = SafetyGlyphs.Cpu,
                label = stringResource(R.string.translation_safety_selfDrivingDistance),
                value = snapshot.selfDrivingMilesSinceReset?.let { prefs.number(prefs.distance(it)) } ?: EM_DASH,
                subtitle = stringResource(R.string.translation_safety_distanceAutopilot, prefs.distanceLabel),
                accent = TeslaTokens.chart.power,
            )
        }
    }
}

// ── GlassPanel12 — ADAS feature cards ───────────────────────────────────────────────────────────────────────────

/** GlassPanel12 — the nine ADAS feature cards (web ADAS Features grid). */
@Composable
private fun AdasFeaturesPanel(snapshot: SafetySnapshot) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_ADAS_Features))
        Spacer(Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            snapshot.features().forEach { feature ->
                SafetyFeatureCard(feature)
            }
        }
    }
}

/** One ADAS feature card — a glass tile with a status dot, label, description, and value text (web `SafetyCard`). */
@Composable
private fun SafetyFeatureCard(feature: SafetyFeature) {
    val enabled = feature.enabled
    val valueText = feature.valueText ?: enabledLabel(enabled)
    val valueColor = if (enabled) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant
    GlassPanel(
        modifier = Modifier.fillMaxWidth(),
        padding = PanelPadding.Md,
        accent = if (enabled) PanelAccent.Success else PanelAccent.None,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Box(
                modifier =
                    Modifier
                        .size(FEATURE_DOT)
                        .clip(CircleShape)
                        .background(if (enabled) TeslaTokens.status.success else MaterialTheme.colorScheme.surfaceVariant),
            )
            Column(modifier = Modifier.weight(1f)) {
                BodyText(featureLabel(feature.id))
                HelperText(featureDescription(feature.id))
            }
            BodyText(valueText, color = valueColor)
        }
    }
}

// ── GlassPanel13 — Safety-states step chart ─────────────────────────────────────────────────────────────────────

/** GlassPanel13 — the AEB/BSCW/ELDA step line chart over time (web Safety States Over Time). */
@Composable
private fun SafetyStatesChartPanel(history: UiState<List<SafetySnapshot>>) {
    val rows = history.data ?: emptyList()
    val points = toSafetyChartData(rows)
    val labels = points.map { it.time }
    val onLabel = stringResource(R.string.translation_On)
    val offLabel = stringResource(R.string.translation_Off)
    val aebName = stringResource(R.string.translation_AEB)
    val bscwName = stringResource(R.string.translation_BSCW)
    val eldaName = stringResource(R.string.translation_ELDA)
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_Safety_States_Over_Time),
        status = if (points.isNotEmpty()) ChartStatus.Ready else ChartStatus.Empty,
        height = CHART_HEIGHT,
        emptyMessage = stringResource(R.string.translation_No_safety_state_history_to_chart_yet_),
        dataTableHeader = listOf(stringResource(R.string.translation_Time), aebName, bscwName, eldaName),
        dataTableRows =
            points.map { p ->
                listOf(p.time, stepLabel(p.aeb, onLabel, offLabel), stepLabel(p.bscw, onLabel, offLabel), stepLabel(p.elda, onLabel, offLabel))
            },
    ) {
        LineChartWrapper(
            series =
                listOf(
                    ChartSeries("aeb", aebName, points.map { it.aeb }, color = paletteColor(0)),
                    ChartSeries("bscw", bscwName, points.map { it.bscw }, color = paletteColor(1)),
                    ChartSeries("elda", eldaName, points.map { it.elda }, color = paletteColor(2)),
                ),
            xLabels = labels,
            height = CHART_HEIGHT,
            yValueFormatter = { if (it >= ON_THRESHOLD) onLabel else offLabel },
        )
    }
}

// ── GlassPanel14 — Settings history table ───────────────────────────────────────────────────────────────────────

/** One newest-first history row, index-keyed so the table renders stable keys even when `id` is absent. */
private data class SafetyHistoryRowVm(
    val index: Int,
    val snapshot: SafetySnapshot,
)

/** GlassPanel14 — the safety-settings history table, newest-first, or an empty-state (web Safety Settings History). */
@Composable
private fun SafetyHistoryPanel(history: UiState<List<SafetySnapshot>>) {
    val rows = sortedSafetyHistory(history.data ?: emptyList())
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        PanelTitle(stringResource(R.string.translation_Safety_Settings_History))
        Spacer(Modifier.height(Spacing.md))
        if (rows.isEmpty()) {
            EmptyState(message = stringResource(R.string.translation_No_history_records_found_))
        } else {
            val vms = rows.mapIndexed { index, snap -> SafetyHistoryRowVm(index, snap) }
            DataTable(
                columns = historyColumns(),
                rows = vms,
                keyOf = { it.index },
                emptyText = stringResource(R.string.translation_No_history_records_found_),
            )
        }
    }
}

/** The ten history columns (web `buildHistoryColumns`): the timestamp, the boolean toggles, and the cleaned enums. */
@Composable
private fun historyColumns(): List<TableColumn<SafetyHistoryRowVm>> {
    val onLabel = stringResource(R.string.translation_On)
    val offLabel = stringResource(R.string.translation_Off)
    return listOf(
        TableColumn(key = "time", header = stringResource(R.string.translation_Time)) { row ->
            Caption(formatTimestamp(row.snapshot.createdAt))
        },
        TableColumn(key = "aeb", header = stringResource(R.string.translation_AEB)) { row ->
            BoolBadge(isAebEnabled(row.snapshot.automaticEmergencyBrakingOff), onLabel, offLabel)
        },
        TableColumn(key = "bsc", header = stringResource(R.string.translation_BSC)) { row ->
            BoolBadge(row.snapshot.automaticBlindSpotCamera, onLabel, offLabel)
        },
        TableColumn(key = "bscw", header = stringResource(R.string.translation_BSCW)) { row ->
            BoolBadge(row.snapshot.blindSpotCollisionWarning, onLabel, offLabel)
        },
        TableColumn(key = "fcw", header = stringResource(R.string.translation_FCW)) { row ->
            EnumCell(row.snapshot.forwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning)
        },
        TableColumn(key = "lda", header = stringResource(R.string.translation_LDA)) { row ->
            EnumCell(row.snapshot.laneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance)
        },
        TableColumn(key = "elda", header = stringResource(R.string.translation_ELDA)) { row ->
            BoolBadge(row.snapshot.emergencyLaneDepartureAvoidance, onLabel, offLabel)
        },
        TableColumn(key = "cfd", header = stringResource(R.string.translation_CFD)) { row ->
            EnumCell(row.snapshot.cruiseFollowDistance, SafetyEnumField.CruiseFollowDistance)
        },
        TableColumn(key = "slw", header = stringResource(R.string.translation_SLW)) { row ->
            EnumCell(row.snapshot.speedLimitWarning, SafetyEnumField.SpeedLimitWarning)
        },
        TableColumn(key = "pin", header = stringResource(R.string.translation_PIN)) { row ->
            BoolBadge(row.snapshot.pinToDriveEnabled, onLabel, offLabel)
        },
    )
}

/** An On/Off status chip for a boolean history cell (web `boolCell`). */
@Composable
private fun BoolBadge(
    value: Boolean,
    onLabel: String,
    offLabel: String,
) {
    Badge(
        text = if (value) onLabel else offLabel,
        variant = if (value) BadgeVariant.Success else BadgeVariant.Danger,
    )
}

/** A cleaned, prefix-stripped enum value for a history cell (web stringly fields). */
@Composable
private fun EnumCell(
    value: JsonElement?,
    field: SafetyEnumField,
) {
    BodyText(cleanSafetyEnum(value, field), color = MaterialTheme.colorScheme.onSurfaceVariant)
}

// ── Small layout + mapping helpers ──────────────────────────────────────────────────────────────────────────────

/** A two-up metric row with the standard inter-card spacing (web responsive metric grid). */
@Composable
private fun MetricRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        content = content,
    )
}

/** The per-theme score color (web `scoreColor`): ≥80 green, ≥50 amber, else red. */
@Composable
private fun scoreColor(pct: Double): Color =
    when {
        pct >= SCORE_HIGH -> TeslaTokens.status.success
        pct >= SCORE_MID -> TeslaTokens.status.warning
        else -> TeslaTokens.status.danger
    }

/** The score badge variant (web `scorePct >= 80 ? 'success' : scorePct >= 50 ? 'warning' : 'danger'`). */
private fun scoreBadgeVariant(pct: Double): BadgeVariant =
    when {
        pct >= SCORE_HIGH -> BadgeVariant.Success
        pct >= SCORE_MID -> BadgeVariant.Warning
        else -> BadgeVariant.Danger
    }

/** The integer percent string (web `fmtInt(scorePct)`). */
private fun pctInt(pct: Double): String = pct.toLong().toString()

/** The On/Off step label for the chart axis + accessible table (web `v === 1 ? On : Off`). */
private fun stepLabel(
    value: Double,
    onLabel: String,
    offLabel: String,
): String = if (value >= ON_THRESHOLD) onLabel else offLabel

/** A live-signal value: the positive label, the negative label, or the em dash when the signal is missing. */
private fun boolLabel(
    value: Boolean?,
    positiveLabel: String,
    negativeLabel: String,
): String =
    when (value) {
        true -> positiveLabel
        false -> negativeLabel
        null -> EM_DASH
    }

/** The per-theme color for a live signal (web green/red/muted by positive/negative/unknown). */
@Composable
private fun signalColor(positive: Boolean?): Color =
    when (positive) {
        true -> TeslaTokens.status.success
        false -> TeslaTokens.status.danger
        null -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The localized Enabled/Disabled label for a boolean feature card (web `Enabled`/`Disabled`). */
@Composable
private fun enabledLabel(enabled: Boolean): String =
    if (enabled) stringResource(R.string.translation_Enabled) else stringResource(R.string.translation_Disabled)

/** The localized ADAS feature label (web `buildFeatureCards` `label`). */
@Composable
private fun featureLabel(id: SafetyFeatureId): String =
    when (id) {
        SafetyFeatureId.Aeb -> stringResource(R.string.translation_Auto_Emergency_Braking)
        SafetyFeatureId.Bsc -> stringResource(R.string.translation_Blind_Spot_Camera)
        SafetyFeatureId.Fcw -> stringResource(R.string.translation_Forward_Collision_Warning)
        SafetyFeatureId.Lda -> stringResource(R.string.translation_Lane_Departure_Avoidance)
        SafetyFeatureId.Cfd -> stringResource(R.string.translation_Cruise_Follow_Distance)
        SafetyFeatureId.Slw -> stringResource(R.string.translation_Speed_Limit_Warning)
        SafetyFeatureId.PinToDrive -> stringResource(R.string.translation_Pin_to_Drive)
        SafetyFeatureId.Bscw -> stringResource(R.string.translation_Blind_Spot_Collision_Warning)
        SafetyFeatureId.Elda -> stringResource(R.string.translation_Emergency_Lane_Departure_Avoidance)
    }

/** The localized ADAS feature description (web `buildFeatureCards` `description`). */
@Composable
private fun featureDescription(id: SafetyFeatureId): String =
    when (id) {
        SafetyFeatureId.Aeb -> stringResource(R.string.translation_Automatic_collision_mitigation)
        SafetyFeatureId.Bsc -> stringResource(R.string.translation_Camera_view_when_signaling)
        SafetyFeatureId.Fcw -> stringResource(R.string.translation_Warns_of_potential_frontal_collisions)
        SafetyFeatureId.Lda -> stringResource(R.string.translation_Prevents_unintentional_lane_changes)
        SafetyFeatureId.Cfd -> stringResource(R.string.translation_Adaptive_cruise_headway_setting)
        SafetyFeatureId.Slw -> stringResource(R.string.translation_Alerts_when_exceeding_speed_limit)
        SafetyFeatureId.PinToDrive -> stringResource(R.string.translation_Requires_PIN_before_driving)
        SafetyFeatureId.Bscw -> stringResource(R.string.translation_Alerts_for_blind_spot_hazards)
        SafetyFeatureId.Elda -> stringResource(R.string.translation_Steers_back_on_unintentional_departure)
    }
