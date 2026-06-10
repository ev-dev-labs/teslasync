package io.teslasync.android.components.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing

/** Inner padding scale for [GlassPanel]. [Auto] follows the ambient [UiDensity]. */
enum class PanelPadding { None, Sm, Md, Lg, Auto }

/** Optional accent that tints the panel's border, replacing the web "glow" affordance. */
enum class PanelAccent { None, Primary, Success, Warning, Danger, Info }

/**
 * Elevated translucent-style surface, the Android counterpart to web `GlassPanel`. Implemented
 * as a tonal Material 3 [Surface] (rounded `large` shape + subtle outline) instead of CSS
 * backdrop-blur. Content is laid out in a [ColumnScope].
 */
@Composable
fun GlassPanel(
    modifier: Modifier = Modifier,
    padding: PanelPadding = PanelPadding.Md,
    accent: PanelAccent = PanelAccent.None,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.raised,
        border = panelBorder(accent),
    ) {
        Column(modifier = Modifier.padding(panelPadding(padding)), content = content)
    }
}

@Composable
private fun panelPadding(padding: PanelPadding): PaddingValues =
    when (padding) {
        PanelPadding.None -> PaddingValues(Spacing.none)
        PanelPadding.Sm -> PaddingValues(Spacing.sm)
        PanelPadding.Md -> PaddingValues(Spacing.md)
        PanelPadding.Lg -> PaddingValues(Spacing.lg)
        PanelPadding.Auto -> PaddingValues(LocalUiDensity.current.metrics().paddingX)
    }

@Composable
private fun panelBorder(accent: PanelAccent): BorderStroke {
    val color =
        when (accent) {
            PanelAccent.None -> MaterialTheme.colorScheme.outlineVariant
            PanelAccent.Primary -> MaterialTheme.colorScheme.primary
            PanelAccent.Success -> TeslaTokens.status.success
            PanelAccent.Warning -> TeslaTokens.status.warning
            PanelAccent.Danger -> TeslaTokens.status.danger
            PanelAccent.Info -> TeslaTokens.status.info
        }
    val width = if (accent == PanelAccent.None) 1.dp else 1.5.dp
    return BorderStroke(width, color)
}
