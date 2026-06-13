// The native Jetpack Compose + Material 3 ChartTooltip shared surface — a parity port of
// web/src/components/charts/ChartTooltip.tsx. The web surface is Recharts' custom-tooltip body: a rounded,
// bordered, elevated panel shown while the cursor is over a chart, with a formatted axis label on top and one
// row per series — a colored swatch, the series name, and the formatted (locale-aware, optionally
// unit-suffixed) value. It renders nothing while the chart is not hovered or has no rows, and accepts two
// optional formatter overrides so a chart can localize values / labels its own way. It is purely presentational
// — the parent chart owns the hover payload.
//
// This port keeps that contract end to end. A Material 3 [Surface] (rounded, tonal-elevated, hairline-bordered)
// is the faithful counterpart of the web blurred panel; the axis label and series names render through the
// shared `Caption` role, the value through the monospace `CodeText` role, and the unit through the dimmed
// `MetricLabel` role, so there is no ad-hoc typography. The panel is a polite live region carrying a merged
// TalkBack announcement (the web `role="tooltip"` + `aria-live="polite"`), and the swatches are decorative
// (the web `aria-hidden`). The body is entirely data — there is no static string — so there is no English
// literal to localize; numbers and dates route through the locale/zone-aware helpers in ChartTooltipModel.kt.
//
// All derivation flows through the pure reducers in ChartTooltipModel.kt ([isTooltipVisible],
// [formatTooltipLabel], [formatTooltipValue], [tooltipAccessibilityLabel]); this composable owns only the
// one-shot `view.opened` diagnostic (P1/S11) and the wiring of the optional override formatters. It performs
// NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartTooltip) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charttooltip

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The series swatch diameter — the web `h-2.5 w-2.5` (10 px) dot. */
private val SWATCH_SIZE: Dp = 10.dp

/** The tooltip panel's drop shadow — the web `shadow-xl` elevated card. */
private val PANEL_SHADOW_ELEVATION: Dp = 8.dp

/** Hairline border width — the web `border` on the panel. */
private val PANEL_BORDER_WIDTH: Dp = 1.dp

/**
 * One series row the tooltip renders — the native mirror of a web Recharts tooltip `payload` entry: the series
 * [name], its raw [value] (a number, a string, or absent — formatted by the model), the swatch [color], and an
 * optional [unit] suffix.
 */
data class ChartTooltipSeries(
    val name: String,
    val value: Any?,
    val color: Color,
    val unit: String? = null,
)

/**
 * Stateful entry point — the faithful port of the web `ChartTooltip`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) and delegates to the stateless [ChartTooltipContent], which renders nothing while the
 * surface is not visible (web returns `null`). Performs no HTTP; the parent owns the hover payload and
 * [logger] defaults to the process logger.
 *
 * @param active whether the chart is currently hovered (web Recharts `active`); with [series] gates visibility.
 * @param series the per-series rows for the hovered point (web `payload`): each a name, a raw value, a swatch
 *   color, and an optional unit.
 * @param label the axis label for the hovered point (web `label`); an absent / ISO / plain label is handled by
 *   the model's [formatTooltipLabel].
 * @param precision fraction digits for numeric values (web global precision); defaults to
 *   [CHART_TOOLTIP_DEFAULT_PRECISION].
 * @param locale locale for number + date formatting; defaults to the device locale (web browser locale).
 * @param zone zone for ISO label formatting; defaults to the device zone (web browser timezone).
 * @param valueFormatter optional override returning the value cell's text (web `valueFormatter`); when `null`
 *   the model default is used.
 * @param labelFormatter optional override returning the label text (web `labelFormatter`); when `null` the
 *   model default is used.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChartTooltip(
    active: Boolean,
    series: List<ChartTooltipSeries>,
    modifier: Modifier = Modifier,
    label: Any? = null,
    precision: Int = CHART_TOOLTIP_DEFAULT_PRECISION,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    valueFormatter: ((value: Any?, name: String, unit: String?) -> String)? = null,
    labelFormatter: ((label: Any?) -> String)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ChartTooltipDiagnostics.recordViewOpened(logger) }
    ChartTooltipContent(
        active = active,
        series = series,
        modifier = modifier,
        label = label,
        precision = precision,
        locale = locale,
        zone = zone,
        valueFormatter = valueFormatter,
        labelFormatter = labelFormatter,
    )
}

/**
 * Stateless renderer for every surface state — the preview + UI entry point. Renders nothing when the surface
 * is not visible ([isTooltipVisible] is false: inactive or no rows; web `null`); otherwise the panel with the
 * formatted label and one row per [series]. The optional [valueFormatter] / [labelFormatter] override the model
 * defaults, mirroring the web props.
 */
@Composable
fun ChartTooltipContent(
    active: Boolean,
    series: List<ChartTooltipSeries>,
    modifier: Modifier = Modifier,
    label: Any? = null,
    precision: Int = CHART_TOOLTIP_DEFAULT_PRECISION,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    valueFormatter: ((value: Any?, name: String, unit: String?) -> String)? = null,
    labelFormatter: ((label: Any?) -> String)? = null,
) {
    if (!isTooltipVisible(active, series.size)) return

    val labelText = labelFormatter?.invoke(label) ?: formatTooltipLabel(label, locale, zone)
    val rows = series.map { resolveRow(it, precision, locale, valueFormatter) }
    val announcement =
        tooltipAccessibilityLabel(labelText, rows.map { TooltipRowText(it.name, it.valueText, it.unit) })

    Surface(
        modifier =
            modifier.semantics(mergeDescendants = true) {
                liveRegion = LiveRegionMode.Polite
                contentDescription = announcement
            },
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.overlay,
        shadowElevation = PANEL_SHADOW_ELEVATION,
        border = BorderStroke(PANEL_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (labelText.isNotEmpty()) {
                Caption(labelText)
            }
            rows.forEach { row -> ChartTooltipRow(row) }
        }
    }
}

/** A single tooltip row: a decorative color swatch, the series name, the monospace value, and a dimmed unit. */
@Composable
private fun ChartTooltipRow(row: TooltipRenderRow) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(
            modifier =
                Modifier
                    .size(SWATCH_SIZE)
                    .clip(CircleShape)
                    .background(row.color),
        )
        Caption("${row.name}:")
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            CodeText(row.valueText)
            if (!row.unit.isNullOrBlank()) {
                MetricLabel(row.unit)
            }
        }
    }
}

/** The render-ready row the view paints: the swatch [color], the series [name], the value text, and the unit. */
private data class TooltipRenderRow(
    val name: String,
    val color: Color,
    val valueText: String,
    val unit: String?,
)

/**
 * Resolve a [ChartTooltipSeries] into its render-ready row. A non-null [valueFormatter] override owns the whole
 * value cell (web custom `valueFormatter` returns the rendered node, so no separate unit suffix is appended);
 * otherwise the model's default [formatTooltipValue] supplies the text plus the dimmed unit.
 */
private fun resolveRow(
    series: ChartTooltipSeries,
    precision: Int,
    locale: Locale,
    valueFormatter: ((Any?, String, String?) -> String)?,
): TooltipRenderRow {
    val custom = valueFormatter?.invoke(series.value, series.name, series.unit)
    return if (custom != null) {
        TooltipRenderRow(series.name, series.color, custom, unit = null)
    } else {
        val parts = formatTooltipValue(series.value, series.unit, precision, locale)
        TooltipRenderRow(series.name, series.color, parts.text, parts.unit)
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────
// The surface's real visible states: a single numeric series under an ISO label (datetime-formatted), multiple
// numeric series under a pre-formatted "HH:MM" label (passed through), a textual value alongside an absent one
// (empty value cell), and a custom value formatter owning the whole cell. The inactive / no-row states render
// nothing and are asserted in ChartTooltipModelTest via [isTooltipVisible].

@Preview(name = "Single series — ISO label", showBackground = true)
@Composable
private fun ChartTooltipIsoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartTooltipContent(
            active = true,
            label = "2026-04-30T13:30:15Z",
            series = listOf(ChartTooltipSeries("Speed", 65, Color(0xFF3B82F6), unit = "km/h")),
        )
    }
}

@Preview(name = "Multiple series — time label", showBackground = true)
@Composable
private fun ChartTooltipMultiPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartTooltipContent(
            active = true,
            label = "14:25",
            series =
                listOf(
                    ChartTooltipSeries("Speed", 65, Color(0xFF3B82F6), unit = "km/h"),
                    ChartTooltipSeries("Power", 12.5, Color(0xFFF59E0B), unit = "kW"),
                ),
        )
    }
}

@Preview(name = "Textual + absent value", showBackground = true)
@Composable
private fun ChartTooltipTextualPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartTooltipContent(
            active = true,
            label = "State",
            series =
                listOf(
                    ChartTooltipSeries("Mode", "driving", Color(0xFF10B981)),
                    ChartTooltipSeries("Battery", null, Color(0xFF8B5CF6), unit = "%"),
                ),
        )
    }
}

@Preview(name = "Custom value formatter", showBackground = true)
@Composable
private fun ChartTooltipCustomPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChartTooltipContent(
            active = true,
            label = "Cabin",
            series = listOf(ChartTooltipSeries("Temp", 21.4, Color(0xFFEF4444), unit = "°C")),
            valueFormatter = { value, name, unit -> "$name=$value$unit" },
        )
    }
}
