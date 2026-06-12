// The native Jetpack Compose + Material 3 FleetStatsBar feature view — a parity port of
// web/src/features/dashboard/components/FleetStatsBar.tsx. The web component is purely presentational: the
// owning Dashboard page computes the fleet analytics, the vehicle/online/unread-alert counts, the recent
// drives/charges, and the `useUnits` distance/efficiency converters + unit labels, and threads them all down
// as props (its only hook is `useTranslation`). It renders a responsive grid (`grid-cols-2 → sm:3 → md:4 →
// lg:5`) wrapped in a `StaggerContainer`, with five `StaggerItem` cards, each a `GlassPanel`:
//   1. Fleet Size — the vehicle count (AnimatedNumber, primary text) over a "{online} online" subtext;
//   2. Distance (30d) — the converted trailing-30-day distance + unit (cyan) over a recent-drives MiniChart;
//   3. Energy (30d) — the trailing-30-day kWh (decimals=1, emerald) over a recent-charges MiniChart;
//   4. Efficiency — the converted fleet-average efficiency + unit (amber) over a "fleet average" subtext;
//   5. Alerts — the unread-alert count (red when > 0, else emerald) over an "unread" subtext.
//
// This port keeps that contract exactly. The grid reflows at the web Tailwind `sm`/`md`/`lg` breakpoints, the
// five cards stagger their entrance like the web `StaggerItem`s, and every card is ALWAYS present — with no
// data they render zeros (web `?? 0`) and a flat trend (web `?? [0]`), never a blank box, so the "empty / no
// value" state is a friendly zero-valued surface. The cache-then-network states (loading / hard fetch-error /
// stale / offline) are owned by the Dashboard page in the web source, exactly as in the committed
// SummaryStatsRow / QuickMetrics siblings, so they are not re-implemented in this presentational bar.
//
// Every derivation flows through the pure [FleetStatsBarProjection]; this file is a thin render layer that
// resolves the i18n labels (P1/S10 `translation_fleet_*`), the live display units (P1/S8 — the shared
// `UnitFormatter`, the web `useUnits` boundary), the design-token accents (P1/S9), and the reduced-motion
// preference, then draws them. There is no English literal and no HTTP here. The one-shot `view.opened`
// diagnostic (P1/S11) fires on first composition.
//
// The count-up value renderer is local rather than the shared `AnimatedNumber`: like the sibling QuickMetrics
// port, the shared component forces the on-surface metric colour (so it cannot carry the web's cyan / emerald
// / amber / red accents) and does not honour reduced motion, so a local count-up reproduces its contract
// (count up from zero on first composition; collapse to a static figure under reduced motion) while adding
// the per-card colour. The other shared components map 1:1 to their native counterparts: GlassPanel →
// [GlassPanel], MiniChart → [MiniChart], the motion stagger → [StaggerItem].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetStatsBar) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleetstatsbar

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.MiniChart
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the five cards lay out in one row. */
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp

/** Web Tailwind `md` breakpoint (768px): at or above this width the cards lay out four-per-row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cards lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_LG: Int = 5
private const val GRID_COLUMNS_MD: Int = 4
private const val GRID_COLUMNS_SM: Int = 3
private const val GRID_COLUMNS_BASE: Int = 2

/** Web `<MiniChart … width={60} height={24} />` — the inline trend under the Distance / Energy values. */
private val MINI_CHART_WIDTH: Dp = 60.dp
private val MINI_CHART_HEIGHT: Dp = 24.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `FleetStatsBar({ analytics, vehicleCount, … })`
 * props. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), resolves the live
 * display units from the shared settings store (P1/S8 — the `UnitFormatter`, the web `useUnits` boundary),
 * projects the [input] onto a [FleetStatsBarDisplay] via the pure [FleetStatsBarProjection], and renders.
 *
 * @param input the props the owning Dashboard page threads in (web `FleetStatsBarProps`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FleetStatsBar(
    input: FleetStatsBarInput,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { FleetStatsBarDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val prefs = remember(formatter) { FleetStatsBarDisplayPrefs.fromUnitPref(formatter.prefs) }
    val display = remember(input, prefs) { FleetStatsBarProjection.project(input, prefs) }
    FleetStatsBarContent(display = display, locale = prefs.locale, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the five always-present cards in
 * the web responsive grid; each card carries an accessible label + value (and a subtext or trend), so no
 * surface is ever hidden or blank. [locale] formats the count-up figures; [reduceMotion] collapses the
 * count-ups to static figures (the accessibility contract).
 */
@Composable
fun FleetStatsBarContent(
    display: FleetStatsBarDisplay,
    locale: Locale,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val cards: List<@Composable (Modifier) -> Unit> =
        listOf(
            { cardModifier -> FleetSizeCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> DistanceCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> EnergyCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> EfficiencyCard(display, reduceMotion, locale, cardModifier) },
            { cardModifier -> AlertsCard(display, reduceMotion, locale, cardModifier) },
        )
    FleetStatsGrid(cards = cards, modifier = modifier)
}

/**
 * Lays out the [cards] as the web responsive grid: five-per-row at or above [GRID_LG_MIN_WIDTH] (`lg:5`),
 * four at [GRID_MD_MIN_WIDTH] (`md:4`), three at [GRID_SM_MIN_WIDTH] (`sm:3`), and two below it
 * (`grid-cols-2`). The gap widens from `Spacing.sm` to `Spacing.md` at the `sm` breakpoint (web `gap-2
 * sm:gap-3`). Each card fills its column via [Modifier.weight] and the row's intrinsic max height so the
 * cards in a row stay uniform (web `h-full`); a partial trailing row is padded with weighted spacers. Each
 * card is wrapped in a [StaggerItem] keyed by its source-order index so the entrance staggers like the web.
 */
@Composable
private fun FleetStatsGrid(
    cards: List<@Composable (Modifier) -> Unit>,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_MD_MIN_WIDTH -> GRID_COLUMNS_MD
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        val gap = if (maxWidth >= GRID_SM_MIN_WIDTH) Spacing.md else Spacing.sm
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(gap),
        ) {
            cards.chunked(columns).forEachIndexed { rowIndex, rowCards ->
                Row(
                    modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                    horizontalArrangement = Arrangement.spacedBy(gap),
                ) {
                    rowCards.forEachIndexed { columnIndex, card ->
                        StaggerItem(
                            index = rowIndex * columns + columnIndex,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        ) {
                            card(Modifier.fillMaxSize())
                        }
                    }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

// ── Cards (web source order) ────────────────────────────────────────────────────────────────────────

/** Fleet Size: the vehicle count over a "{online} online" subtext (web `text-[var(--text-primary)]`). */
@Composable
private fun FleetSizeCard(
    display: FleetStatsBarDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val online = stringResource(R.string.translation_fleet_online)
    FleetStatCard(
        label = stringResource(R.string.translation_fleet_size),
        modifier = modifier,
        value = {
            FleetStatCountUp(
                value = display.fleetSize.toDouble(), // parity:allow Kotlin stdlib Int→Double, toDouble substring false positive
                decimals = COUNT_DECIMALS,
                color = MaterialTheme.colorScheme.onSurface,
                reduceMotion = reduceMotion,
                locale = locale,
            )
        },
        footer = { Caption("${display.onlineCount} $online") },
    )
}

/** Distance (30d): the converted distance + unit (cyan) over the recent-drives trend. */
@Composable
private fun DistanceCard(
    display: FleetStatsBarDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    FleetStatCard(
        label = stringResource(R.string.translation_fleet_distance),
        modifier = modifier,
        value = {
            FleetStatCountUp(
                value = display.distanceValue,
                decimals = DISTANCE_DECIMALS,
                suffix = " ${display.distanceUnit}",
                color = TeslaTokens.status.info,
                reduceMotion = reduceMotion,
                locale = locale,
            )
        },
        footer = {
            MiniChart(
                data = display.distanceTrend,
                color = TeslaTokens.status.info,
                width = MINI_CHART_WIDTH,
                height = MINI_CHART_HEIGHT,
            )
        },
    )
}

/** Energy (30d): the kWh total (one decimal, emerald) over the recent-charges trend. */
@Composable
private fun EnergyCard(
    display: FleetStatsBarDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    FleetStatCard(
        label = stringResource(R.string.translation_fleet_energy),
        modifier = modifier,
        value = {
            FleetStatCountUp(
                value = display.energyKwh,
                decimals = ENERGY_DECIMALS,
                suffix = " $ENERGY_UNIT",
                color = TeslaTokens.status.success,
                reduceMotion = reduceMotion,
                locale = locale,
            )
        },
        footer = {
            MiniChart(
                data = display.energyTrend,
                color = TeslaTokens.status.success,
                width = MINI_CHART_WIDTH,
                height = MINI_CHART_HEIGHT,
            )
        },
    )
}

/** Efficiency: the converted fleet-average efficiency + unit (amber) over a "fleet average" subtext. */
@Composable
private fun EfficiencyCard(
    display: FleetStatsBarDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    FleetStatCard(
        label = stringResource(R.string.translation_fleet_efficiency),
        modifier = modifier,
        value = {
            FleetStatCountUp(
                value = display.efficiencyValue,
                decimals = EFFICIENCY_DECIMALS,
                suffix = " ${display.efficiencyUnit}",
                color = TeslaTokens.status.warning,
                reduceMotion = reduceMotion,
                locale = locale,
            )
        },
        footer = { Caption(stringResource(R.string.translation_fleet_average)) },
    )
}

/** Alerts: the unread count (danger when any are unread, else success) over an "unread" subtext. */
@Composable
private fun AlertsCard(
    display: FleetStatsBarDisplay,
    reduceMotion: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val accent = if (display.alertsActive) TeslaTokens.status.danger else TeslaTokens.status.success
    FleetStatCard(
        label = stringResource(R.string.translation_fleet_alerts),
        modifier = modifier,
        value = {
            FleetStatCountUp(
                value = display.unreadAlerts.toDouble(), // parity:allow Kotlin stdlib Int→Double, toDouble substring false positive
                decimals = COUNT_DECIMALS,
                color = accent,
                reduceMotion = reduceMotion,
                locale = locale,
            )
        },
        footer = { Caption(stringResource(R.string.translation_fleet_unread)) },
    )
}

// ── Building blocks ─────────────────────────────────────────────────────────────────────────────────

/**
 * One stat card — a centered [label] (web `metric-label`), [value], and [footer] (a subtext or a trend) in a
 * [GlassPanel] that fills its grid cell (web `flex flex-col justify-center h-full text-center`).
 */
@Composable
private fun FleetStatCard(
    label: String,
    modifier: Modifier = Modifier,
    value: @Composable () -> Unit,
    footer: @Composable () -> Unit,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
        ) {
            MetricLabel(label)
            value()
            footer()
        }
    }
}

/**
 * The count-up figure for a stat card — the colored analogue of the shared `AnimatedNumber` (which forces
 * the on-surface metric colour and ignores reduced motion). It counts up from zero on first composition,
 * formats each frame with [decimals] + locale grouping via the shared [ChartFormat], and appends the optional
 * [suffix] (the distance / efficiency unit, or ` kWh`). Under [reduceMotion] it renders the final figure
 * statically (the reduced-motion accessibility contract). The figure uses the [MaterialTheme.typography]
 * `headlineSmall` SemiBold slot (the shared metric-value type) carrying the [color] accent.
 */
@Composable
private fun FleetStatCountUp(
    value: Double,
    decimals: Int,
    color: Color,
    reduceMotion: Boolean,
    locale: Locale,
    suffix: String = "",
    modifier: Modifier = Modifier,
) {
    val rendered =
        if (reduceMotion) {
            ChartFormat.number(value, decimals, locale) + suffix
        } else {
            val animated = remember(value) { Animatable(0f) }
            LaunchedEffect(value) {
                animated.animateTo(
                    targetValue = value.toFloat(),
                    animationSpec = tween(durationMillis = MotionDurations.slow, easing = FastOutSlowInEasing),
                )
            }
            ChartFormat.number(animated.value.toDouble(), decimals, locale) + suffix // parity:allow toDouble substring false positive
        }
    Text(
        text = rendered,
        modifier = modifier,
        color = color,
        style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
        textAlign = TextAlign.Center,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ────────────────────────

private val PREVIEW_INPUT =
    FleetStatsBarInput(
        analytics =
            FleetAnalyticsSnapshot(
                totalDistanceSI = 4_820_000.0,
                totalEnergyKwh = 812.4,
                avgEfficiencyWhKm = 168.0,
            ),
        vehicleCount = 4,
        onlineCount = 3,
        unreadAlerts = 0,
        recentDriveDistancesM = listOf(12_000.0, 32_500.0, 8_900.0, 41_000.0, 15_750.0),
        recentChargeEnergyWh = listOf(18_000.0, 42_000.0, 9_500.0, 51_000.0),
    )

@Preview(name = "Populated", showBackground = true, widthDp = 420)
@Composable
private fun FleetStatsBarPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetStatsBarContent(
            display = FleetStatsBarProjection.project(PREVIEW_INPUT, FleetStatsBarDisplayPrefs.METRIC_DEFAULT),
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Empty — no data (zeros)", showBackground = true, widthDp = 420)
@Composable
private fun FleetStatsBarEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetStatsBarContent(
            display =
                FleetStatsBarProjection.project(
                    FleetStatsBarInput(analytics = null, vehicleCount = 0, onlineCount = 0, unreadAlerts = 0),
                    FleetStatsBarDisplayPrefs.METRIC_DEFAULT,
                ),
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Alerts active (wide)", showBackground = true, widthDp = 720)
@Composable
private fun FleetStatsBarAlertsActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetStatsBarContent(
            display =
                FleetStatsBarProjection.project(
                    PREVIEW_INPUT.copy(unreadAlerts = 5),
                    FleetStatsBarDisplayPrefs.METRIC_DEFAULT,
                ),
            locale = Locale.US,
            reduceMotion = true,
        )
    }
}
