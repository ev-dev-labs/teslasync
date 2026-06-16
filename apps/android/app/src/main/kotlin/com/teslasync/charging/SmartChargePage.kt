// The native Jetpack Compose + Material 3 SmartChargePage charging surface — a parity port of
// web/src/features/charging/pages/SmartChargePage.tsx (route /charging/schedule), the time-of-use charge planner.
// It reproduces every panel the web page renders — the charge-settings form (GlassPanel 1), the 24-hour rate
// timeline (GlassPanel 2), the charge-now / optimized-cost / savings stat cards, the recommended-schedule + apply
// panel (GlassPanel 6), and the plan-history table (GlassPanel 7) — every data state (the history feed's loading
// skeleton / empty / error-retry / content, plus the optimize + apply mutations' in-flight / success / error), and
// every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [SmartChargePage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the form snapshot + the two feeds + the two mutation
// states + the live display preferences); [SmartChargePageContent] is the stateless render layer. The optimize
// result drives the conditional timeline / cost / schedule panels exactly as the web page gates them on `result`,
// and the framework-free model owns all wire decoding + formatting so this stays a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 charging pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.smartcharge

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatTrend
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.TableSkeleton
import io.teslasync.android.components.forms.UnitInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlin.math.roundToInt

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade `delay`). */
private const val FADE_STEP_MS = 50

/** Height of the 24-hour rate timeline bar chart (web `h-24`). */
private val TIMELINE_HEIGHT = 96.dp

/** Minimum bar height fraction so an all-zero hour still draws a sliver (web `Math.max(heightPct, 5)`). */
private const val MIN_BAR_FRACTION = 0.05f

/** Bar tint alpha for an in-window vs an out-of-window hour (web `bg-cyan-400/70` vs `bg-*-500/40`). */
private const val IN_WINDOW_ALPHA = 0.85f
private const val OUT_WINDOW_ALPHA = 0.45f

/** Legend swatch size (web `w-3 h-3`). */
private val SWATCH_SIZE = 12.dp

/** The off-peak rate tiers (web `OFF_PEAK` / `SUPER_OFF_PEAK`). */
private val OFF_PEAK_TIERS = setOf("OFF_PEAK", "SUPER_OFF_PEAK")

/** Hour-label cadence on the timeline axis (web `rate.hour % 3 === 0`). */
private const val HOUR_LABEL_STEP = 3

/**
 * The web fallback rate-plan options shown until `/charge-planner/rate-plans` resolves a non-empty list — the
 * verbatim port of the web `ratePlanOptions.length > 0 ? … : [ … ]` fallback (utility brand names, not localized
 * on either platform).
 */
private val FALLBACK_RATE_OPTIONS =
    listOf(
        SelectOption("pge-ev2a", "PG&E EV2-A"),
        SelectOption("sce-tou-d", "SCE TOU-D"),
        SelectOption("sdge-tou-dr1", "SDG&E TOU-DR1"),
    )

/** The page's interaction callbacks, wired to the [SmartChargePageViewModel] (web event handlers). */
data class SmartChargeActions(
    val onTargetSoc: (Int) -> Unit,
    val onDepartBy: (String) -> Unit,
    val onRatePlan: (String) -> Unit,
    val onMaxAmps: (Int) -> Unit,
    val onBatteryCapacity: (Double) -> Unit,
    val onOptimize: () -> Unit,
    val onApply: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SmartChargePageViewModel] over the supplied [source] (the host wires the shared
 * charging repository + the app-scoped active-vehicle selection via [smartChargePageSourceOf]). [logger] defaults
 * to the app's redacting logger.
 */
@Composable
fun SmartChargePage(
    source: SmartChargePageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SmartChargePageViewModel =
        viewModel(
            key = SmartChargePageRegistration.SLUG,
            factory = viewModelFactory { initializer { SmartChargePageViewModel(source, logger) } },
        )
    SmartChargePage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] form snapshot + feeds + mutation states to the stateless content. */
@Composable
fun SmartChargePage(
    viewModel: SmartChargePageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val ratePlansState by viewModel.ratePlansState.collectAsStateWithLifecycle()
    val plansState by viewModel.plansState.collectAsStateWithLifecycle()
    val optimizing by viewModel.optimizing.collectAsStateWithLifecycle()
    val optimizeError by viewModel.optimizeError.collectAsStateWithLifecycle()
    val applying by viewModel.applying.collectAsStateWithLifecycle()
    val applyError by viewModel.applyError.collectAsStateWithLifecycle()
    val selectedVehicleId by viewModel.selectedVehicleId.collectAsStateWithLifecycle()
    val settings by LocalDataContainer.current.settingsStore.settings().collectAsStateWithLifecycle()

    val prefs = remember(settings.cached) { SmartChargePrefs.from(settings.cached) }
    val formatters = remember(prefs) { SmartChargeFormatters(prefs) }
    val rateOptions = remember(ratePlansState.data) { rateOptionsFor(decodeRatePlans(ratePlansState.data)) }

    val actions =
        remember(viewModel) {
            SmartChargeActions(
                onTargetSoc = viewModel::setTargetSoc,
                onDepartBy = viewModel::setDepartBy,
                onRatePlan = viewModel::setRatePlan,
                onMaxAmps = viewModel::setMaxAmps,
                onBatteryCapacity = viewModel::setBatteryCapacity,
                onOptimize = viewModel::optimize,
                onApply = viewModel::apply,
                onRetry = viewModel::retry,
            )
        }

    SmartChargePageContent(
        interaction = interaction,
        rateOptions = rateOptions,
        plansState = plansState,
        formatters = formatters,
        hasVehicle = (selectedVehicleId ?: 0L) > 0L,
        optimizing = optimizing,
        optimizeError = optimizeError,
        applying = applying,
        applyError = applyError,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the header, the always-present settings panel (GlassPanel 1), then — once an
 * optimization has produced a [SmartChargeInteractionState.result] — the rate timeline (GlassPanel 2), the cost
 * comparison cards, and the recommended-schedule + apply panel (GlassPanel 6), and finally the always-present plan
 * history panel (GlassPanel 7). Mirrors the web page's `{result && …}` gating exactly.
 */
@Composable
fun SmartChargePageContent(
    interaction: SmartChargeInteractionState,
    rateOptions: List<SelectOption>,
    plansState: UiState<JsonElement>,
    formatters: SmartChargeFormatters,
    hasVehicle: Boolean,
    optimizing: Boolean,
    optimizeError: String?,
    applying: Boolean,
    applyError: String?,
    actions: SmartChargeActions,
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
        SmartChargeHeader()

        FadeIn { SettingsPanel(interaction, rateOptions, hasVehicle, optimizing, optimizeError, actions) }

        val result = interaction.result
        if (result != null) {
            FadeIn(delayMs = FADE_STEP_MS) { RateTimelinePanel(result, formatters) }
            FadeIn(delayMs = FADE_STEP_MS * 2) { CostComparisonCards(result, formatters) }
            FadeIn(delayMs = FADE_STEP_MS * 3) {
                SchedulePanel(result, interaction.applied, applying, applyError, formatters, actions)
            }
        }

        FadeIn(delayMs = FADE_STEP_MS * 4) { HistoryPanel(plansState, formatters, actions) }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun SmartChargeHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_chargePlanner_title))
        BodyText(
            stringResource(R.string.translation_chargePlanner_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── GlassPanel 1 — Charge settings ────────────────────────────────────────────────────────────────────────────

/**
 * The charge-settings form (web Settings `GlassPanel`): the rate-plan select, the target-SOC slider, the
 * depart-by + max-amps inputs, the battery-capacity unit input, the optimize action, and the optimize error.
 */
@Composable
private fun SettingsPanel(
    interaction: SmartChargeInteractionState,
    rateOptions: List<SelectOption>,
    hasVehicle: Boolean,
    optimizing: Boolean,
    optimizeError: String?,
    actions: SmartChargeActions,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        SectionTitle(stringResource(R.string.translation_chargePlanner_settings))
        Column(
            modifier = Modifier.padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Select(
                options = rateOptions,
                selectedValue = interaction.ratePlanId,
                onSelect = actions.onRatePlan,
                label = stringResource(R.string.translation_chargePlanner_ratePlan),
            )
            Slider(
                value = interaction.targetSoc.toFloat(),
                onValueChange = { actions.onTargetSoc(it.roundToInt()) },
                label = stringResource(R.string.translation_chargePlanner_targetSoc),
                valueText = "${interaction.targetSoc}%",
                valueRange = SmartChargePageRegistration.MIN_TARGET_SOC.toFloat()..SmartChargePageRegistration.MAX_TARGET_SOC.toFloat(),
                steps = targetSocSteps(),
            )
            Input(
                value = interaction.departBy,
                onValueChange = actions.onDepartBy,
                label = stringResource(R.string.translation_chargePlanner_departBy),
            )
            Input(
                value = interaction.maxAmps.toString(),
                onValueChange = { text -> actions.onMaxAmps(text.filter(Char::isDigit).toIntOrNull() ?: 0) },
                label = stringResource(R.string.translation_chargePlanner_maxAmps),
                keyboardType = KeyboardType.Number,
            )
            UnitInput(
                value = interaction.batteryCapacity,
                onValueChange = { actions.onBatteryCapacity(it ?: 0.0) },
                unitSymbol = "kWh",
                label = stringResource(R.string.translation_chargePlanner_batteryCapacity),
                decimals = 0,
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                Button(
                    label = stringResource(R.string.translation_chargePlanner_optimize),
                    onClick = actions.onOptimize,
                    enabled = hasVehicle && !optimizing,
                    loading = optimizing,
                )
            }
            if (optimizeError != null) {
                ErrorText(optimizeError.ifBlank { stringResource(R.string.translation_chargePlanner_optimizeError) })
            }
        }
    }
}

// ── GlassPanel 2 — 24-hour rate timeline ──────────────────────────────────────────────────────────────────────

/** The 24-hour TOU rate timeline (web Rate Timeline `GlassPanel` + `RateTimeline`). */
@Composable
private fun RateTimelinePanel(
    result: OptimizeChargeResult,
    formatters: SmartChargeFormatters,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        SectionTitle(stringResource(R.string.translation_chargePlanner_rateTimeline))
        Column(
            modifier = Modifier.padding(top = Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (result.hourlyRates.isEmpty()) {
                HelperText(stringResource(R.string.translation_chargePlanner_noRateData))
            } else {
                RateTimelineLegend()
                RateTimelineBars(result)
                RateTimelineHourAxis(result.hourlyRates)
            }
            HelperText(
                stringResource(
                    R.string.translation_chargePlanner_windowInfo,
                    formatters.time(result.schedule.startTime),
                    formatters.time(result.schedule.endTime),
                ),
            )
        }
    }
}

/** The tier legend (web off-peak / mid-peak / on-peak / charge-window swatches). */
@Composable
private fun RateTimelineLegend() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        LegendSwatch(TeslaTokens.status.success, stringResource(R.string.translation_chargePlanner_offPeak))
        LegendSwatch(TeslaTokens.status.warning, stringResource(R.string.translation_chargePlanner_midPeak))
        LegendSwatch(TeslaTokens.status.danger, stringResource(R.string.translation_chargePlanner_onPeak))
        LegendSwatch(TeslaTokens.status.info, stringResource(R.string.translation_chargePlanner_chargeWindow))
    }
}

@Composable
private fun LegendSwatch(
    color: Color,
    label: String,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier =
                Modifier
                    .size(SWATCH_SIZE)
                    .clip(RoundedCornerShape(Spacing.xs))
                    .background(color.copy(alpha = OUT_WINDOW_ALPHA)),
        )
        Caption(label)
    }
}

/** The variable-height bars, one per hour, tinted by tier and highlighted inside the optimal window. */
@Composable
private fun RateTimelineBars(result: OptimizeChargeResult) {
    val window = chargeWindowHours(result, ZONE)
    val maxRate = maxRateCents(result.hourlyRates)
    Row(
        modifier = Modifier.fillMaxWidth().height(TIMELINE_HEIGHT),
        horizontalArrangement = Arrangement.spacedBy(1.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        result.hourlyRates.forEach { rate ->
            val inWindow = isHourInWindow(rate.hour, window)
            val fraction = (safeNumber(rate.rateCents) / maxRate).toFloat().coerceIn(MIN_BAR_FRACTION, 1f)
            Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .fillMaxHeight(fraction)
                            .clip(RoundedCornerShape(topStart = Spacing.xs, topEnd = Spacing.xs))
                            .background(barColor(rate.tier, inWindow)),
                )
            }
        }
    }
}

/** The hour-of-day axis labels every three hours (web hour labels). */
@Composable
private fun RateTimelineHourAxis(rates: List<HourlyRate>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
        rates.forEach { rate ->
            Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                if (rate.hour % HOUR_LABEL_STEP == 0) HelperText(formatHourLabel(rate.hour))
            }
        }
    }
}

// ── Cost comparison stat cards ────────────────────────────────────────────────────────────────────────────────

/** The charge-now / optimized-cost / savings comparison cards (web 3-up `StatCard` grid). */
@Composable
private fun CostComparisonCards(
    result: OptimizeChargeResult,
    formatters: SmartChargeFormatters,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatCard(
            label = stringResource(R.string.translation_chargePlanner_chargeNowCost),
            value = formatters.currency(result.comparison.chargeNowCost),
            sublabel = stringResource(R.string.translation_chargePlanner_currentRate),
        )
        StatCard(
            label = stringResource(R.string.translation_chargePlanner_optimizedCost),
            value = formatters.currency(result.comparison.optimizedCost),
            sublabel = "${result.schedule.rateTier} \u00B7 ${formatters.number(result.schedule.rateCentsKwh, 1)}\u00A2/kWh",
        )
        StatCard(
            label = stringResource(R.string.translation_chargePlanner_savings),
            value = formatters.currency(result.comparison.savings),
            trend =
                StatTrend(
                    direction = if (result.comparison.savings > 0.0) DeltaArrow.Down else DeltaArrow.Flat,
                    text = formatters.percent(result.comparison.savingsPercent, 0),
                    positive = result.comparison.savings > 0.0,
                ),
            sublabel =
                "${formatters.number(result.kwhNeeded, 1)} kWh \u00B7 ~${formatters.number(result.estimatedDurationHours, 1)}h",
        )
    }
}

// ── GlassPanel 6 — Recommended schedule + apply ───────────────────────────────────────────────────────────────

/** The recommended-schedule detail + apply action (web Schedule Details `GlassPanel`). */
@Composable
private fun SchedulePanel(
    result: OptimizeChargeResult,
    applied: Boolean,
    applying: Boolean,
    applyError: String?,
    formatters: SmartChargeFormatters,
    actions: SmartChargeActions,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SectionTitle(stringResource(R.string.translation_chargePlanner_schedule))
            if (applied) {
                BodyText(
                    stringResource(R.string.translation_chargePlanner_applied),
                    color = TeslaTokens.status.success,
                )
            } else {
                Button(
                    label = stringResource(R.string.translation_chargePlanner_applySchedule),
                    onClick = actions.onApply,
                    enabled = !applying,
                    loading = applying,
                )
            }
        }
        if (applyError != null) {
            ErrorText(
                applyError.ifBlank { stringResource(R.string.translation_chargePlanner_applyError) },
                modifier = Modifier.padding(top = Spacing.sm),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            ScheduleField(
                stringResource(R.string.translation_chargePlanner_currentSoc),
                "${formatters.number(result.currentSoc, 0)}%",
                Modifier.weight(1f),
            )
            ScheduleField(
                stringResource(R.string.translation_chargePlanner_targetSocLabel),
                "${formatters.number(result.targetSoc, 0)}%",
                Modifier.weight(1f),
            )
            ScheduleField(
                stringResource(R.string.translation_chargePlanner_startTime),
                formatters.time(result.schedule.startTime),
                Modifier.weight(1f),
            )
            ScheduleField(
                stringResource(R.string.translation_chargePlanner_endTime),
                formatters.time(result.schedule.endTime),
                Modifier.weight(1f),
            )
        }
        if (result.alternativeWindows.isNotEmpty()) {
            AlternativeWindows(result.alternativeWindows, formatters)
        }
    }
}

@Composable
private fun ScheduleField(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        BodyText(value)
    }
}

/** The alternative-window rows beneath the schedule detail (web Alternative Windows list). */
@Composable
private fun AlternativeWindows(
    windows: List<ChargeWindow>,
    formatters: SmartChargeFormatters,
) {
    Column(
        modifier = Modifier.padding(top = Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Subhead(stringResource(R.string.translation_chargePlanner_alternatives))
        windows.forEach { window ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BodyText(
                    "${formatters.time(window.startTime)} \u2014 ${formatters.time(window.endTime)}",
                    modifier = Modifier.weight(1f),
                )
                Caption(window.rateTier)
                BodyText(formatters.currency(window.estimatedCost))
            }
        }
    }
}

// ── GlassPanel 7 — Plan history ───────────────────────────────────────────────────────────────────────────────

/**
 * The plan-history panel (web History `GlassPanel`): the full cache-then-network state matrix — loading skeleton,
 * hard-error retry, empty state, or the decoded history table.
 */
@Composable
private fun HistoryPanel(
    plansState: UiState<JsonElement>,
    formatters: SmartChargeFormatters,
    actions: SmartChargeActions,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        SectionTitle(stringResource(R.string.translation_chargePlanner_history))
        Column(modifier = Modifier.padding(top = Spacing.md)) {
            when {
                plansState.isLoading -> TableSkeleton(rows = HISTORY_SKELETON_ROWS, columns = HISTORY_COLUMNS)
                plansState.isError ->
                    ErrorDisplay(
                        message = stringResource(R.string.translation_error_serverError_message),
                        title = stringResource(R.string.translation_error_serverError_title),
                        onRetry = actions.onRetry,
                        retryLabel = stringResource(R.string.translation_common_retry),
                    )

                plansState.isEmpty ->
                    EmptyState(message = stringResource(R.string.translation_chargePlanner_noHistory))

                else -> HistoryTable(decodeChargePlans(plansState.data), formatters)
            }
        }
    }
}

/** The decoded plan-history table (web History grid). */
@Composable
private fun HistoryTable(
    plans: List<ChargePlan>,
    formatters: SmartChargeFormatters,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Caption(stringResource(R.string.translation_chargePlanner_date), Modifier.weight(HISTORY_DATE_WEIGHT))
            Caption(stringResource(R.string.translation_chargePlanner_window), Modifier.weight(HISTORY_WINDOW_WEIGHT))
            Caption(stringResource(R.string.translation_chargePlanner_plan), Modifier.weight(HISTORY_PLAN_WEIGHT))
            Caption(stringResource(R.string.translation_chargePlanner_cost_decimal), Modifier.weight(HISTORY_COST_WEIGHT))
            Caption(stringResource(R.string.translation_chargePlanner_savedAmount), Modifier.weight(HISTORY_COST_WEIGHT))
            Caption(stringResource(R.string.translation_chargePlanner_status), Modifier.weight(HISTORY_STATUS_WEIGHT))
        }
        plans.forEach { plan -> HistoryRow(plan, formatters) }
    }
}

@Composable
private fun HistoryRow(
    plan: ChargePlan,
    formatters: SmartChargeFormatters,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        BodyText(formatters.dateTime(plan.createdAt), modifier = Modifier.weight(HISTORY_DATE_WEIGHT))
        BodyText(
            "${formatters.time(plan.scheduledStart)} \u2014 ${formatters.time(plan.scheduledEnd)}",
            modifier = Modifier.weight(HISTORY_WINDOW_WEIGHT),
        )
        BodyText(plan.ratePlan.ifBlank { SMART_CHARGE_EM_DASH }, modifier = Modifier.weight(HISTORY_PLAN_WEIGHT))
        BodyText(
            plan.estimatedCost?.let { formatters.currency(it) } ?: SMART_CHARGE_EM_DASH,
            modifier = Modifier.weight(HISTORY_COST_WEIGHT),
        )
        BodyText(
            plan.savings?.takeIf { it > 0.0 }?.let { formatters.currency(it) } ?: SMART_CHARGE_EM_DASH,
            color = TeslaTokens.status.success,
            modifier = Modifier.weight(HISTORY_COST_WEIGHT),
        )
        BodyText(
            plan.status.ifBlank { SMART_CHARGE_EM_DASH },
            color = statusColor(plan.status),
            modifier = Modifier.weight(HISTORY_STATUS_WEIGHT),
        )
    }
}

// ── Shared render helpers ─────────────────────────────────────────────────────────────────────────────────────

/** The discrete slider stops for the target-SOC range (web `step={5}` over `[20, 100]`). */
private fun targetSocSteps(): Int {
    val span = SmartChargePageRegistration.MAX_TARGET_SOC - SmartChargePageRegistration.MIN_TARGET_SOC
    return (span / SmartChargePageRegistration.TARGET_SOC_STEP) - 1
}

/** Builds the rate-plan dropdown options, falling back to the web defaults when the feed is empty. */
private fun rateOptionsFor(plans: List<RatePlanInfo>): List<SelectOption> =
    if (plans.isEmpty()) {
        FALLBACK_RATE_OPTIONS
    } else {
        plans.map { SelectOption(value = it.id, label = "${it.name} (${it.utility})") }
    }

/** Tier bar tint (web `tierColors`), highlighted to the charge-window color when [inWindow]. */
@Composable
private fun barColor(
    tier: String,
    inWindow: Boolean,
): Color {
    val base =
        when {
            inWindow -> TeslaTokens.status.info
            tier in OFF_PEAK_TIERS -> TeslaTokens.status.success
            tier == "MID_PEAK" -> TeslaTokens.status.warning
            tier == "ON_PEAK" -> TeslaTokens.status.danger
            else -> MaterialTheme.colorScheme.surfaceVariant
        }
    return base.copy(alpha = if (inWindow) IN_WINDOW_ALPHA else OUT_WINDOW_ALPHA)
}

/** Status text color (web scheduled⇒cyan / completed⇒emerald / cancelled⇒red / else muted). */
@Composable
private fun statusColor(status: String): Color =
    when (status) {
        "scheduled" -> TeslaTokens.status.info
        "completed" -> TeslaTokens.status.success
        "cancelled" -> TeslaTokens.status.danger
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The display zone for the rate-timeline window math (the device zone, matching the formatters). */
private val ZONE = java.time.ZoneId.systemDefault()

private const val HISTORY_SKELETON_ROWS = 4
private const val HISTORY_COLUMNS = 6
private const val HISTORY_DATE_WEIGHT = 1.3f
private const val HISTORY_WINDOW_WEIGHT = 1.4f
private const val HISTORY_PLAN_WEIGHT = 1f
private const val HISTORY_COST_WEIGHT = 0.9f
private const val HISTORY_STATUS_WEIGHT = 1f
