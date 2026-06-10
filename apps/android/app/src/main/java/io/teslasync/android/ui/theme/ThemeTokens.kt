package io.teslasync.android.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import io.teslasync.android.ui.theme.generated.ChartPalette
import io.teslasync.android.ui.theme.generated.DarkStatusColors
import io.teslasync.android.ui.theme.generated.StatusColors

/**
 * Semantic status colors for the active theme. [TeslaSyncTheme] provides the palette
 * that matches the chosen scheme; the default is the dark brand palette so previews and
 * un-themed composables still resolve a sensible value.
 */
val LocalStatusColors = staticCompositionLocalOf { DarkStatusColors }

/**
 * Accessor for TeslaSync design-token values that live outside the Material 3
 * [androidx.compose.material3.ColorScheme]: the per-theme semantic [status] palette and
 * the theme-invariant [chart] palette. Mirrors the `MaterialTheme.colorScheme` access
 * style, e.g. `TeslaTokens.status.danger` or `TeslaTokens.chart.battery`.
 */
object TeslaTokens {
    val status: StatusColors
        @Composable
        @ReadOnlyComposable
        get() = LocalStatusColors.current

    val chart: ChartPalette
        get() = ChartPalette
}
