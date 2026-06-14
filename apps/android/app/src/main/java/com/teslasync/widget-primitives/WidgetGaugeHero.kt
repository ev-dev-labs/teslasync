// The native Jetpack Compose + Material 3 WidgetGaugeHero widget primitive — a parity port of the web shared
// widget building block web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx. The web component is purely
// presentational: it renders a `RadialGauge` (sized `compact ? 70 : 100`), then — only at the standard size —
// a centered flex-wrap row of supporting stat cells (each a small secondary label over a `text-sm` semibold
// primary value with an optional smaller secondary unit suffix) followed by an arbitrary `children` slot. It
// fetches nothing and owns no chrome beyond that.
//
// This native surface keeps that contract end to end. Every branch decision flows through the pure
// [WidgetGaugeHeroProjection] (see WidgetGaugeHero.Model.kt) — the gauge size, the `!compact && stats.length`
// stats guard, the `!compact` children guard, the `[0, max]` value clamp, and the web RadialGauge
// `isInteger(clamped) ? 0 : precision` decimal rule — so this composable is a thin render layer that hands the
// projection to the shared [RadialGauge] component (P3 component-library bundle) and lays the stat cells out in a
// FlowRow over the generated design tokens (P1/S9). The gauge always renders, so the surface is never a blank box.
//
// It performs NO HTTP and binds NO data state holder (the web component has no hook). See WidgetGaugeHero.Model.kt
// for the honesty rationale and why the generic loading/empty/error/stale/offline states do not apply to a leaf
// presentational primitive. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition,
// carrying only the surface slug — never the gauge value, label, unit, or any stat.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/widget-primitives)
// cannot form a valid Kotlin package (a hyphen is illegal in a package identifier). `MatchingDeclarationName` is
// suppressed for the co-located config type, stateless renderer, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetgaugehero

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The gauge configuration the hero draws — the native mirror of the web `GaugeHeroConfig`
 * ({ value, max, label, unit, color }). [color] is a Compose [Color] (the native-idiomatic equivalent of the web
 * CSS color string), so callers pass a design token (e.g. `TeslaTokens.status.success`) rather than a raw hex. The
 * optional [decimals] mirrors the web `RadialGauge` `decimals` prop (which `WidgetGaugeHero` leaves undefined): when
 * null the displayed precision follows the web rule (whole ⇒ 0, fractional ⇒ the global default).
 *
 * @property value the gauge's current value (web `gauge.value`); clamped into `[0, max]` for display + sweep.
 * @property max the gauge's denominator (web `gauge.max`).
 * @property label the label shown beneath the gauge and read with the value to TalkBack (web `gauge.label`).
 * @property unit the unit suffix on the centered value, or blank for none (web `gauge.unit`).
 * @property color the arc color (web `gauge.color`); a design-token [Color], not a raw hex.
 * @property decimals an explicit fraction-digit override, or null to follow the web default rule.
 */
data class GaugeHeroConfig(
    val value: Double,
    val max: Double,
    val label: String,
    val unit: String,
    val color: Color,
    val decimals: Int? = null,
)

/**
 * Stateful entry point — the faithful 1:1 port of the web `WidgetGaugeHero({ gauge, stats, compact, children })`.
 * Records the one-shot `view.opened` diagnostic on first composition (P1/S11), then delegates to the stateless
 * [WidgetGaugeHeroContent]. The [content] slot is the native analogue of the web `children` and renders only at
 * the standard size (web `!compact && children`).
 *
 * @param gauge the gauge configuration (web `gauge`).
 * @param modifier layout modifier applied to the surface's root column.
 * @param stats the supporting stat cells shown beneath the gauge at the standard size (web `stats`); empty ⇒ none.
 * @param compact whether to render the smaller, stats-and-children-suppressed variant (web `compact`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the optional children rendered beneath the stats at the standard size (web `children`).
 */
@Composable
fun WidgetGaugeHero(
    gauge: GaugeHeroConfig,
    modifier: Modifier = Modifier,
    stats: List<GaugeHeroStat> = emptyList(),
    compact: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit = {},
) {
    LaunchedEffect(Unit) { WidgetGaugeHeroDiagnostics.recordViewOpened(logger) }
    WidgetGaugeHeroContent(
        gauge = gauge,
        modifier = modifier,
        stats = stats,
        compact = compact,
        content = content,
    )
}

/**
 * Stateless renderer — the unit-test/preview entry point (no diagnostics, no data container). Always renders the
 * [RadialGauge] (so the surface is never blank), then — driven by the pure [WidgetGaugeHeroProjection] — the stats
 * row when `!compact` and [stats] is non-empty (web `!compact && stats.length > 0`) and the [content] slot when
 * `!compact` (web `!compact && children`). The gauge value + decimals are projected to match the web RadialGauge's
 * `[0, max]` clamp and `isInteger ? 0 : precision` rule.
 */
@Composable
fun WidgetGaugeHeroContent(
    gauge: GaugeHeroConfig,
    modifier: Modifier = Modifier,
    stats: List<GaugeHeroStat> = emptyList(),
    compact: Boolean = false,
    content: @Composable () -> Unit = {},
) {
    val layout = remember(compact, stats.size) { WidgetGaugeHeroProjection.project(compact, stats.size) }
    val displayValue =
        remember(gauge.value, gauge.max) { WidgetGaugeHeroProjection.clampGaugeValue(gauge.value, gauge.max) }
    val decimals =
        remember(gauge.value, gauge.max, gauge.decimals) {
            WidgetGaugeHeroProjection.effectiveDecimals(gauge.value, gauge.max, gauge.decimals)
        }

    Column(
        modifier = modifier.testTag(WIDGET_GAUGE_HERO_TEST_TAG),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = displayValue,
            max = gauge.max,
            label = gauge.label,
            unit = gauge.unit.ifBlank { null },
            color = gauge.color,
            size = layout.gaugeSizeDp.dp,
            decimals = decimals,
        )

        if (layout.showStats) {
            WidgetGaugeHeroStats(stats = stats)
        }

        if (layout.showContent) {
            content()
        }
    }
}

/**
 * The supporting stat cells — the web `flex flex-wrap items-center justify-center gap-x-4 gap-y-1` row. A
 * [FlowRow] wraps the cells onto new lines like the web flex-wrap, centered horizontally (web `justify-center`),
 * with the `gap-x-4` (16 dp) / `gap-y-1` (4 dp) gutters expressed through the design-token spacing scale.
 */
@Composable
private fun WidgetGaugeHeroStats(
    stats: List<GaugeHeroStat>,
    modifier: Modifier = Modifier,
) {
    @OptIn(ExperimentalLayoutApi::class)
    FlowRow(
        modifier = modifier.testTag(WIDGET_GAUGE_HERO_STATS_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        stats.forEach { stat -> WidgetGaugeHeroStatCell(stat = stat) }
    }
}

/**
 * One stat cell — the web `<div className="flex min-w-0 flex-col items-center text-center">` holding a truncated
 * small secondary label over a `text-sm` semibold primary value with an optional smaller secondary unit suffix.
 * The label + inline value/unit reproduce the web's two type sizes; both truncate to a single line (web
 * `truncate`), so the role typography wrappers (which do not expose `maxLines`) are bypassed for an explicit
 * single-line [Text] whose styles still come from the Material 3 type ramp (P1/S9). The whole cell exposes one
 * TalkBack description (label + value + unit), the same single-description treatment the shared RadialGauge
 * applies, so the cell reads as one phrase.
 */
@Composable
private fun WidgetGaugeHeroStatCell(
    stat: GaugeHeroStat,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val type = MaterialTheme.typography
    val description = WidgetGaugeHeroProjection.statDescription(stat)

    val valueSpan = type.titleSmall.copy(fontWeight = FontWeight.SemiBold, color = colors.onSurface).toSpanStyle()
    val unitSpan = type.labelMedium.copy(fontWeight = FontWeight.Normal, color = colors.onSurfaceVariant).toSpanStyle()

    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stat.label,
            style = type.labelMedium,
            color = colors.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text =
                buildAnnotatedString {
                    withStyle(valueSpan) { append(stat.value) }
                    val unit = stat.unit
                    if (!unit.isNullOrBlank()) {
                        withStyle(unitSpan) { append(" $unit") }
                    }
                },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// ── Previews — one per rendered branch (standard + stats + children / standard, no children / standard, no stats /
// compact / fractional value / over-max clamp). The sample copy is tooling-only and never shipped UI. ───────────

private val previewGauge =
    GaugeHeroConfig(value = 72.0, max = 100.0, label = "Battery", unit = "%", color = Color(0xFF10B981))

private val previewStats =
    listOf(
        GaugeHeroStat(label = "Range", value = "248", unit = "mi"),
        GaugeHeroStat(label = "Health", value = "94", unit = "%"),
        GaugeHeroStat(label = "Cycles", value = "312"),
    )

@Preview(name = "WidgetGaugeHero · standard + stats + children", showBackground = true)
@Composable
private fun WidgetGaugeHeroStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetGaugeHeroContent(gauge = previewGauge, stats = previewStats) {
            Text(text = "Updated just now", style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Preview(name = "WidgetGaugeHero · standard, no children", showBackground = true)
@Composable
private fun WidgetGaugeHeroNoChildrenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetGaugeHeroContent(gauge = previewGauge, stats = previewStats)
    }
}

@Preview(name = "WidgetGaugeHero · standard, no stats", showBackground = true)
@Composable
private fun WidgetGaugeHeroNoStatsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetGaugeHeroContent(gauge = previewGauge)
    }
}

@Preview(name = "WidgetGaugeHero · compact (gauge only)", showBackground = true)
@Composable
private fun WidgetGaugeHeroCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetGaugeHeroContent(gauge = previewGauge, stats = previewStats, compact = true) {
            Text(text = "suppressed", style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Preview(name = "WidgetGaugeHero · fractional value", showBackground = true)
@Composable
private fun WidgetGaugeHeroFractionalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetGaugeHeroContent(
            gauge =
                GaugeHeroConfig(
                    value = 14.3,
                    max = 30.0,
                    label = "Efficiency",
                    unit = "%/100km",
                    color = TeslaTokens.status.info,
                ),
        )
    }
}

@Preview(name = "WidgetGaugeHero · over-max (clamps)", showBackground = true)
@Composable
private fun WidgetGaugeHeroOverMaxPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WidgetGaugeHeroContent(
            gauge =
                GaugeHeroConfig(
                    value = 130.0,
                    max = 100.0,
                    label = "Load",
                    unit = "%",
                    color = TeslaTokens.status.warning,
                ),
        )
    }
}
