// The native Jetpack Compose + Material 3 MotorEfficiencyInsights feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx. The web component wraps a
// `<FadeIn delay={0.35}>` around a responsive `Grid` (`cols={{ default: 1, md: 3 }}`) of three `GlassPanel`s
// — Torque Distribution (Zap), Throttle Behavior (Gauge), Motor Thermal (Thermometer). Inside EACH panel it
// renders its readouts when `motorStats` exists, otherwise a shared "No motor data recorded yet" EmptyState
// (Activity glyph). This port keeps that contract: the three panels + titles always render, each panel shows
// its content or its own empty state (never a blank box), and the grid reflows from one column to three at
// the web Tailwind `md` (768dp) breakpoint.
//
// Every derivation flows through the pure [MotorEfficiencyInsightsProjection]; this file is a thin render
// layer that binds the web component's two data sources — `useTranslation` (the generated i18n catalog,
// P1/S10) and `useUnits` (the live temperature display preference + locale from the data container, P1/S8) —
// and records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition. Because the host
// supplies the motor slice through the shared state-holder layer as a [UiState], this surface also renders
// every lifecycle state that layer can carry — a loading skeleton (panel chrome + shimmering bodies), a hard
// error with retry (the web `QueryError` equivalent), the friendly per-panel empty state, content, and a
// stale/offline freshness chip over still-shown cached data — none of which the presentational web component
// owns itself. The panel titles, readout labels, badge labels, and empty message all resolve through the
// catalog (`dynamics.*` + `a11y.loading`/`common.*`/`error.*`/`freshness.*` keys); there is no English
// literal in this file.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/MotorEfficiencyInsights) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorefficiencyinsights

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/** Web `<FadeIn delay={0.35}>` — the surface fades in 350 ms after its parent. */
private const val ENTRY_DELAY_MS: Int = 350

/** Web Tailwind `md` breakpoint (768px): at or above this width the three panels lay out in one row. */
private val GRID_MD_MIN_WIDTH = 768.dp

/** Web `md:3` — three panels per row at or above [GRID_MD_MIN_WIDTH]. */
private const val GRID_COLUMNS_MD: Int = 3

/** Web `default:1` — one panel per row (stacked) below [GRID_MD_MIN_WIDTH]. */
private const val GRID_COLUMNS_BASE: Int = 1

/** The loading skeleton renders this many shimmering rows per panel (the web panels show ~3 readouts). */
private const val SKELETON_ROW_COUNT: Int = 3

/** Each skeleton row's height, sized to a single readout line. */
private val SKELETON_ROW_HEIGHT = 16.dp

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * The already-localized strings the surface renders. The web component is anonymous — it resolves every
 * label through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary,
 * keeping the rest of the surface free of any English literal.
 */
data class MotorEfficiencyInsightsStrings(
    val torqueDistribution: String,
    val throttleBehavior: String,
    val motorThermal: String,
    val noMotorData: String,
    val avgTorque: String,
    val maxTorque: String,
    val highTorqueTime: String,
    val avgPower: String,
    val drivingStyle: String,
    val conservative: String,
    val moderate: String,
    val aggressive: String,
    val avgMotorTemp: String,
    val maxMotorTemp: String,
    val thermalGood: String,
    val thermalWarm: String,
    val thermalHot: String,
    val loadingLabel: String,
)

/**
 * Stateful entry point — the faithful 1:1 port of the web `MotorEfficiencyInsights({ … })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), reads the live unit preference + locale
 * from the data container (web `useUnits`, P1/S8), and renders every lifecycle [state] the shared motor feed
 * can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never
 * performs HTTP. The surface fades in to mirror the web `<FadeIn>`.
 *
 * @param state the cache-then-network projection of the [MotorEfficiencySnapshot] (motor stats + style).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param units the live SI → display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun MotorEfficiencyInsights(
    state: UiState<MotorEfficiencySnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MotorEfficiencyInsightsDiagnostics.recordViewOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    FadeIn(modifier = modifier.fillMaxWidth(), delayMs = ENTRY_DELAY_MS) {
        MotorEfficiencyInsightsContent(state = state, onRetry = onRetry, prefs = formatter.prefs)
    }
}

/**
 * Web-parity overload mirroring the web component's `({ motorStats, throttleStyle, … })` props, for hosts
 * that already hold the computed motor slice. Projects the inputs onto a [UiState] via
 * [MotorEfficiencyInsightsProjection.projectUiState] (content when motor stats exist, else the per-panel
 * empty state) and delegates to the stateful entry, which records `view.opened`. There is no fetch behind
 * it, so it offers no retry affordance.
 */
@Composable
fun MotorEfficiencyInsights(
    motorStats: MotorStats?,
    throttleStyle: ThrottleStyle?,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(motorStats, throttleStyle) {
            MotorEfficiencyInsightsProjection.projectUiState(
                MotorEfficiencySnapshot(motorStats = motorStats, throttleStyle = throttleStyle),
                isLoading = false,
            )
        }
    MotorEfficiencyInsights(state = state, onRetry = {}, modifier = modifier, units = units, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's three-panel grid (with each panel's own empty state) and adds the lifecycle chrome the host's
 * feed implies: a loading skeleton, a hard-error retry surface, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [prefs] supplies the SI → display unit conversion + formatting.
 */
@Composable
fun MotorEfficiencyInsightsContent(
    state: UiState<MotorEfficiencySnapshot>,
    onRetry: () -> Unit,
    prefs: UnitPref,
    modifier: Modifier = Modifier,
    strings: MotorEfficiencyInsightsStrings = motorEfficiencyInsightsStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    Column(modifier = modifier.fillMaxWidth()) {
        when {
            state.isLoading -> MotorLoadingGrid(strings = strings)
            state.isError -> MotorEfficiencyError(onRetry = onRetry)
            else -> MotorEfficiencyLoaded(state = state, prefs = prefs, strings = strings)
        }
    }
}

/**
 * The content / empty / stale / offline branch — an optional freshness chip above the three panels, each of
 * which renders its readouts (web `motorStats ? … `) or its own empty state (web `: noData`). Emitted into
 * the enclosing column so the freshness chrome the host's feed implies sits directly above the web grid.
 */
@Composable
private fun MotorEfficiencyLoaded(
    state: UiState<MotorEfficiencySnapshot>,
    prefs: UnitPref,
    strings: MotorEfficiencyInsightsStrings,
) {
    if (state.stale || state.refreshing || state.hasError) {
        MotorFreshnessRow(state = state)
    }
    val display = remember(state.data, prefs) { MotorEfficiencyInsightsProjection.project(state.data, prefs) }
    MotorPanelGrid(
        listOf(
            { cardModifier -> TorquePanel(data = display.torque, strings = strings, loading = false, modifier = cardModifier) },
            { cardModifier -> ThrottlePanel(data = display.throttle, strings = strings, loading = false, modifier = cardModifier) },
            { cardModifier -> ThermalPanel(data = display.thermal, strings = strings, loading = false, modifier = cardModifier) },
        ),
    )
}

/** The loading branch — the three panels with their titles and shimmering skeleton bodies (web panel chrome). */
@Composable
private fun MotorLoadingGrid(strings: MotorEfficiencyInsightsStrings) {
    MotorPanelGrid(
        listOf(
            { cardModifier -> TorquePanel(data = null, strings = strings, loading = true, modifier = cardModifier) },
            { cardModifier -> ThrottlePanel(data = null, strings = strings, loading = true, modifier = cardModifier) },
            { cardModifier -> ThermalPanel(data = null, strings = strings, loading = true, modifier = cardModifier) },
        ),
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun MotorEfficiencyError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The freshness chip shown over cached data while refreshing/stale/offline — the honest "last known" label. */
@Composable
private fun MotorFreshnessRow(state: UiState<*>) {
    val formatAge = rememberMotorFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
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
 * Lays out the three [cards] as the web responsive grid: three-per-row at or above [GRID_MD_MIN_WIDTH]
 * (`md:3`), one-per-row below it (`default:1`). Each card fills its column via [Modifier.weight]; a partial
 * trailing row is padded with weighted spacers so the cards keep a uniform width. Cells are spaced by
 * `Spacing.md`, the native expression of the web `gap-4`.
 */
@Composable
private fun MotorPanelGrid(cards: List<@Composable (Modifier) -> Unit>) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_MD_MIN_WIDTH) GRID_COLUMNS_MD else GRID_COLUMNS_BASE
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            cards.chunked(columns).forEach { rowCards ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowCards.forEach { card -> card(Modifier.weight(1f)) }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Torque Distribution panel (web Zap / blue): three torque readouts, a skeleton, or the empty state. */
@Composable
private fun TorquePanel(
    data: TorquePanelData?,
    strings: MotorEfficiencyInsightsStrings,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    MotorGlassPanel(
        title = strings.torqueDistribution,
        icon = MotorEfficiencyInsightsGlyphs.Zap,
        accent = TeslaTokens.chart.speed,
        modifier = modifier,
    ) {
        when {
            loading -> PanelSkeleton(loadingLabel = strings.loadingLabel)
            data != null -> {
                MetricRow(label = strings.avgTorque, value = data.avgTorque)
                MetricRow(label = strings.maxTorque, value = data.maxTorque)
                MetricRow(label = strings.highTorqueTime, value = data.highTorqueTime)
            }
            else -> MotorEmptyState(message = strings.noMotorData)
        }
    }
}

/** Throttle Behavior panel (web Gauge / cyan): power readout + style badge + power bar, skeleton, or empty. */
@Composable
private fun ThrottlePanel(
    data: ThrottlePanelData?,
    strings: MotorEfficiencyInsightsStrings,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    MotorGlassPanel(
        title = strings.throttleBehavior,
        icon = MotorEfficiencyInsightsGlyphs.Gauge,
        accent = TeslaTokens.chart.regen,
        modifier = modifier,
    ) {
        when {
            loading -> PanelSkeleton(loadingLabel = strings.loadingLabel)
            data != null -> {
                MetricRow(label = strings.avgPower, value = data.avgPower)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Caption(strings.drivingStyle)
                    Badge(text = strings.throttleLabel(data.style), variant = data.style.level.badgeVariant())
                }
                MetricBar(
                    value = data.powerBarValue,
                    max = data.powerBarMax,
                    label = "",
                    valueText = "",
                    color = data.style.level.barColor(),
                )
            }
            else -> MotorEmptyState(message = strings.noMotorData)
        }
    }
}

/** Motor Thermal panel (web Thermometer / amber): two temperature readouts + thermal badge, skeleton, or empty. */
@Composable
private fun ThermalPanel(
    data: ThermalPanelData?,
    strings: MotorEfficiencyInsightsStrings,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    MotorGlassPanel(
        title = strings.motorThermal,
        icon = MotorEfficiencyInsightsGlyphs.Thermometer,
        accent = TeslaTokens.status.warning,
        modifier = modifier,
    ) {
        when {
            loading -> PanelSkeleton(loadingLabel = strings.loadingLabel)
            data != null -> {
                MetricRow(label = strings.avgMotorTemp, value = data.avgMotorTemp)
                MetricRow(label = strings.maxMotorTemp, value = data.maxMotorTemp)
                Badge(text = strings.thermalLabel(data.status), variant = data.status.level.badgeVariant())
            }
            else -> MotorEmptyState(message = strings.noMotorData)
        }
    }
}

/**
 * One panel shell — a [GlassPanel] with the web header (the lucide [icon] tinted with [accent] beside the
 * `text-sm font-semibold` title) above the panel [body], laid out with consistent vertical spacing.
 */
@Composable
private fun MotorGlassPanel(
    title: String,
    icon: ImageVector,
    accent: Color,
    modifier: Modifier = Modifier,
    body: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(modifier = modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Md, tint = accent)
            PanelTitle(title)
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm), content = body)
    }
}

/** One label/value readout row — the web `flex justify-between` (muted label left, value right). */
@Composable
private fun MetricRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        BodyText(value)
    }
}

/** A panel's empty body — the web shared `noData` EmptyState (Activity glyph), so the panel is never blank. */
@Composable
private fun MotorEmptyState(message: String) {
    EmptyState(message = message, icon = MotorEfficiencyInsightsGlyphs.Activity)
}

/**
 * A panel's loading body — shimmering rows carrying a single TalkBack "Loading" announcement so the state is
 * announced rather than read as empty boxes.
 */
@Composable
private fun PanelSkeleton(loadingLabel: String) {
    Column(
        modifier = Modifier.semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROW_COUNT) { Skeleton(height = SKELETON_ROW_HEIGHT) }
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberMotorFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Maps the shared accent level onto the [Badge] variant — the web `success` / `warning` / `danger` props. */
private fun MotorAccentLevel.badgeVariant(): BadgeVariant =
    when (this) {
        MotorAccentLevel.Good -> BadgeVariant.Success
        MotorAccentLevel.Caution -> BadgeVariant.Warning
        MotorAccentLevel.Alert -> BadgeVariant.Danger
    }

/** Maps the shared accent level onto the power-bar fill color — the web `#22c55e` / `#eab308` / `#ef4444`. */
@Composable
private fun MotorAccentLevel.barColor(): Color =
    when (this) {
        MotorAccentLevel.Good -> TeslaTokens.status.success
        MotorAccentLevel.Caution -> TeslaTokens.status.warning
        MotorAccentLevel.Alert -> TeslaTokens.status.danger
    }

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful
 * entry, the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun motorEfficiencyInsightsStrings(): MotorEfficiencyInsightsStrings =
    MotorEfficiencyInsightsStrings(
        torqueDistribution = stringResource(R.string.translation_dynamics_torqueDistribution),
        throttleBehavior = stringResource(R.string.translation_dynamics_throttleBehavior),
        motorThermal = stringResource(R.string.translation_dynamics_motorThermal),
        noMotorData = stringResource(R.string.translation_dynamics_noMotorData),
        avgTorque = stringResource(R.string.translation_dynamics_avgTorque),
        maxTorque = stringResource(R.string.translation_dynamics_maxTorque),
        highTorqueTime = stringResource(R.string.translation_dynamics_highTorqueTime),
        avgPower = stringResource(R.string.translation_dynamics_avgPower),
        drivingStyle = stringResource(R.string.translation_dynamics_drivingStyle),
        conservative = stringResource(R.string.translation_dynamics_conservative),
        moderate = stringResource(R.string.translation_dynamics_moderate),
        aggressive = stringResource(R.string.translation_dynamics_aggressive),
        avgMotorTemp = stringResource(R.string.translation_dynamics_avgMotorTemp),
        maxMotorTemp = stringResource(R.string.translation_dynamics_maxMotorTemp),
        thermalGood = stringResource(R.string.translation_dynamics_thermalGood),
        thermalWarm = stringResource(R.string.translation_dynamics_thermalWarm),
        thermalHot = stringResource(R.string.translation_dynamics_thermalHot),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/** Resolves the throttle badge label — the web `conservative ? … : moderate ? … : 'Aggressive'`. */
private fun MotorEfficiencyInsightsStrings.throttleLabel(style: ThrottleStyle): String =
    when (style) {
        ThrottleStyle.Conservative -> conservative
        ThrottleStyle.Moderate -> moderate
        ThrottleStyle.Aggressive -> aggressive
    }

/** Resolves the thermal badge label — the web `< 100 ? 'Good' : < 140 ? 'Warm' : 'Hot'`. */
private fun MotorEfficiencyInsightsStrings.thermalLabel(status: ThermalStatus): String =
    when (status) {
        ThermalStatus.Good -> thermalGood
        ThermalStatus.Warm -> thermalWarm
        ThermalStatus.Hot -> thermalHot
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private fun motorEfficiencyInsightsSampleSnapshot(): MotorEfficiencySnapshot =
    MotorEfficiencySnapshot(
        motorStats =
            MotorStats(
                avgTorque = 215.4,
                maxTorque = 342.0,
                highTorquePct = 12.5,
                avgPower = 42.0,
                avgMotorTemp = 48.6,
                maxMotorTemp = 72.3,
            ),
        throttleStyle = ThrottleStyle.Moderate,
    )

@Preview(name = "Content — moderate", showBackground = true)
@Composable
private fun MotorEfficiencyInsightsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorEfficiencyInsightsContent(
            state = MotorEfficiencyInsightsProjection.projectUiState(motorEfficiencyInsightsSampleSnapshot(), isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
        )
    }
}

@Preview(name = "Empty — no motor data", showBackground = true)
@Composable
private fun MotorEfficiencyInsightsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorEfficiencyInsightsContent(
            state = MotorEfficiencyInsightsProjection.projectUiState(MotorEfficiencySnapshot(null, null), isLoading = false),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun MotorEfficiencyInsightsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorEfficiencyInsightsContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun MotorEfficiencyInsightsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorEfficiencyInsightsContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
        )
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun MotorEfficiencyInsightsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MotorEfficiencyInsightsContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = motorEfficiencyInsightsSampleSnapshot(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
        )
    }
}
