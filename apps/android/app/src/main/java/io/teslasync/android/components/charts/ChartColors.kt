package io.teslasync.android.components.charts

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.ChartPalette

/*
 * Token-based color resolution for the chart layer. Every chart color comes from
 * the P3/A1 generated palette (ChartPalette), the per-theme TeslaTokens.status
 * colors, or the Material 3 scheme — never a raw hex literal in component code, so
 * light / dark / high-contrast all stay correct.
 */

/** Stable categorical series color by [index] (wraps around the brand palette). */
fun paletteColor(index: Int): Color {
    val colors = ChartPalette.categorical
    if (colors.isEmpty()) return Color.Gray
    return colors[((index % colors.size) + colors.size) % colors.size]
}

/** Resolves a series' explicit [override] color, falling back to the palette at [index]. */
fun seriesColor(
    override: Color?,
    index: Int,
): Color = override ?: paletteColor(index)

/** Per-theme color for a marker [severity]. */
@Composable
@ReadOnlyComposable
fun markerColor(severity: MarkerSeverity): Color =
    when (severity) {
        MarkerSeverity.Info -> TeslaTokens.status.info
        MarkerSeverity.Warn -> TeslaTokens.status.warning
        MarkerSeverity.Critical -> TeslaTokens.status.danger
        MarkerSeverity.Success -> TeslaTokens.status.success
    }

/** Resolves a marker's explicit color or its [ChartVerticalMarker.severity] tint. */
@Composable
@ReadOnlyComposable
fun resolveMarkerColor(marker: ChartVerticalMarker): Color = marker.color ?: markerColor(marker.severity)

/** Per-theme color for an annotation [category], drawn from the status + chart palettes. */
@Composable
@ReadOnlyComposable
fun annotationColor(category: AnnotationCategory): Color =
    when (category) {
        AnnotationCategory.Milestone -> TeslaTokens.chart.speed
        AnnotationCategory.Maintenance -> TeslaTokens.status.warning
        AnnotationCategory.Trip -> TeslaTokens.status.success
        AnnotationCategory.Issue -> TeslaTokens.status.danger
        AnnotationCategory.Upgrade -> TeslaTokens.chart.power
        AnnotationCategory.Custom -> MaterialTheme.colorScheme.onSurfaceVariant
    }
