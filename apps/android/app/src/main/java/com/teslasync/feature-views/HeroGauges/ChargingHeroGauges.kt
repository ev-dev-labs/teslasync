// The native Jetpack Compose + Material 3 charging HeroGauges feature view — a parity port of
// web/src/features/charging/components/charging-list/HeroGauges.tsx. The web component renders a GlassPanel
// holding a responsive 2 / 3 / 5-column grid of four RadialGauges (Sessions, Energy, Total Cost, Avg Power)
// plus an avg-$/kWh count-up text cell when its `stats` prop is present, and a single EmptyState when it is
// `null`. This port keeps that exact two-branch contract: the panel is always rendered; inside it either the
// five-cell grid (gauges + avg-cost cell) or the friendly empty state shows — never a blank box.
//
// Every derivation flows through the pure [ChargingHeroGaugesProjection] (see ChargingHeroGaugesModel.kt); this
// composable is a thin render layer that resolves the i18n labels (P1/S10), maps the web gauge colors onto the
// design tokens (P1/S9), and hands the projection to the shared RadialGauge / AnimatedNumber / EmptyState
// components. The owning charging-list page threads the computed `ChargingStats` in as a prop, exactly as the
// web component receives it. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// See ChargingHeroGaugesModel.kt's header for the surface-name collision note (three web `HeroGauges` map to
// one native directory; the shipped analytics A-0058 surface is left untouched and this charging port lives in
// the `.charging` sub-package). `InvalidPackageDeclaration` is suppressed because the mandated surface
// directory (com/teslasync/feature-views/HeroGauges) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.herogauges.charging

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web Tailwind `md` breakpoint (768px): at or above this width the five cells lay out in a single row. */
private val GRID_MD_MIN_WIDTH: Dp = 768.dp

/** Web Tailwind `sm` breakpoint (640px): at or above this width the cells lay out three-per-row. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

private const val GRID_COLUMNS_MD = 5
private const val GRID_COLUMNS_SM = 3
private const val GRID_COLUMNS_BASE = 2

/**
 * Stateful entry point — the faithful 1:1 port of the web `HeroGauges({ stats })`. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), resolves the localized labels (P1/S10), projects the
 * prop onto a [ChargingHeroGaugesDisplay] via the pure [ChargingHeroGaugesProjection], and renders.
 *
 * @param stats the owning charging-list page's computed `ChargingStats`, or `null` when there are no sessions
 *   (the web `stats: ChargingStats | null` prop); `null` drives the EmptyState branch.
 * @param modifier layout modifier applied to the surface's GlassPanel.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingHeroGauges(
    stats: ChargingStats?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ChargingHeroGaugesDiagnostics.recordViewOpened(logger) }
    val strings = chargingHeroGaugesStrings()
    val display = remember(stats, strings) { ChargingHeroGaugesProjection.project(stats, strings) }
    ChargingHeroGaugesContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit-test and preview entry point. Always renders the GlassPanel; inside it the
 * web `stats ? <grid> : <EmptyState/>` ternary is reproduced exactly: when [ChargingHeroGaugesDisplay.empty]
 * is true a single EmptyState shows, otherwise the responsive five-cell grid of four RadialGauges plus the
 * avg-$/kWh count-up cell. No surface is ever hidden — the panel and exactly one branch always render.
 */
@Composable
fun ChargingHeroGaugesContent(
    display: ChargingHeroGaugesDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        if (display.empty) {
            EmptyState(message = display.emptyMessage)
        } else {
            ChargingHeroGaugesGrid(itemCount = ChargingHeroGaugesProjection.CELL_COUNT) { index, cellModifier ->
                val gauge = display.gauges.getOrNull(index)
                if (gauge != null) {
                    RadialGauge(
                        value = gauge.value,
                        max = gauge.max,
                        label = gauge.label,
                        modifier = cellModifier,
                        unit = gauge.unit.ifBlank { null },
                        color = chargingGaugeColor(gauge.accent),
                    )
                } else {
                    ChargingAvgCostCell(
                        value = display.avgCostPerKwh,
                        label = display.avgCostLabel,
                        modifier = cellModifier,
                    )
                }
            }
        }
    }
}

/**
 * The avg-$/kWh text cell — the web `<div className="flex flex-col items-center text-center">` holding a bold
 * `$<AnimatedNumber decimals={3} />` over a small muted label. Rendered as a centered Column so it sits in the
 * grid beside the four gauges. The whole cell exposes one TalkBack description (label + formatted value), the
 * same single-description treatment the shared RadialGauge applies, so the count-up animation never spams the
 * screen reader.
 */
@Composable
private fun ChargingAvgCostCell(
    value: Double,
    label: String,
    modifier: Modifier = Modifier,
) {
    val symbol = ChargingHeroGaugesProjection.CURRENCY_SYMBOL
    val formatted = ChartFormat.number(value, ChargingHeroGaugesProjection.AVG_COST_DISPLAY_DECIMALS)
    val description = "$label: $symbol$formatted"
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        AnimatedNumber(
            value = value,
            decimals = ChargingHeroGaugesProjection.AVG_COST_DISPLAY_DECIMALS,
            prefix = symbol,
        )
        MetricLabel(label)
    }
}

/**
 * Lays out [itemCount] cells as the web responsive grid: five-per-row at or above [GRID_MD_MIN_WIDTH]
 * (`md:grid-cols-5`), three-per-row at or above [GRID_SM_MIN_WIDTH] (`sm:grid-cols-3`), and two-per-row below
 * it (`grid-cols-2`). Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with
 * weighted spacers so the cells keep a uniform width. Rows are vertically centered (web `items-center`) and
 * spaced by `Spacing.lg`, the native expression of the web `gap-4 sm:gap-6` gutter.
 */
@Composable
private fun ChargingHeroGaugesGrid(
    itemCount: Int,
    modifier: Modifier = Modifier,
    item: @Composable (Int, Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_MD_MIN_WIDTH -> GRID_COLUMNS_MD
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        val rows = (0 until itemCount).chunked(columns)
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            rows.forEach { rowIndices ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    rowIndices.forEach { index -> item(index, Modifier.weight(1f)) }
                    repeat(columns - rowIndices.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Resolves the six localized strings from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun chargingHeroGaugesStrings(): ChargingHeroGaugesStrings =
    ChargingHeroGaugesStrings(
        sessions = stringResource(R.string.translation_charging_gauges_sessions),
        energy = stringResource(R.string.translation_charging_gauges_energy),
        totalCost = stringResource(R.string.translation_charging_gauges_totalCost),
        avgPower = stringResource(R.string.translation_charging_gauges_avgPower),
        avgCostPerKwh = stringResource(R.string.translation_charging_gauges_avgCostPerKwh),
        noStats = stringResource(R.string.translation_charging_noStats),
    )

/**
 * Maps a [ChargingGaugeAccent] to a design-token color (P1/S9). The web RadialGauge hex colors map to the
 * brand palette: cyan `#00F0FF` -> the info token (exact match), green `#10B981` -> the success token (exact
 * match), amber `#F59E0B` -> the warning token (exact match), and purple `#A855F7` -> the chart power hue
 * (exact match) — so no Tailwind class or raw hex survives into the view.
 */
@Composable
private fun chargingGaugeColor(accent: ChargingGaugeAccent): Color =
    when (accent) {
        ChargingGaugeAccent.Sessions -> TeslaTokens.status.info
        ChargingGaugeAccent.Energy -> TeslaTokens.status.success
        ChargingGaugeAccent.Cost -> TeslaTokens.status.warning
        ChargingGaugeAccent.Power -> TeslaTokens.chart.power
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val previewStrings =
    ChargingHeroGaugesStrings(
        sessions = "Sessions",
        energy = "Energy",
        totalCost = "Total Cost",
        avgPower = "Avg Power",
        avgCostPerKwh = "Avg $/kWh",
        noStats = "No charging statistics available yet",
    )

private val previewStats =
    ChargingStats(
        count = 128.0,
        totalEnergy = 2456.0,
        totalCost = 612.0,
        avgPower = 48.0,
        avgCostPerKwh = 0.18,
    )

@Preview(name = "Resolved", showBackground = true)
@Composable
private fun ChargingHeroGaugesResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingHeroGaugesContent(ChargingHeroGaugesProjection.project(previewStats, previewStrings))
    }
}

@Preview(name = "Resolved — all zeros", showBackground = true)
@Composable
private fun ChargingHeroGaugesZerosPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingHeroGaugesContent(
            ChargingHeroGaugesProjection.project(ChargingStats(0.0, 0.0, 0.0, 0.0, 0.0), previewStrings),
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargingHeroGaugesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingHeroGaugesContent(ChargingHeroGaugesProjection.project(stats = null, strings = previewStrings))
    }
}
