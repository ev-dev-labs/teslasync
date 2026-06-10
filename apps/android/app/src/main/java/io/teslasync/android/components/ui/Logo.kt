package io.teslasync.android.components.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

private const val LOGO_VIEWPORT = 200f
private const val LOGO_CORNER = 40f

/**
 * Brand mark mirroring web `components/ui/Logo`: a rounded-square gradient tile with a white
 * bolt, drawn natively with [Canvas] (no SVG). The gradient runs from the theme primary to the
 * brand energy accent, so the logo recolors with the active theme. Optionally shows the wordmark.
 */
@Composable
fun Logo(
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
    showWordmark: Boolean = false,
    wordmark: String = "TeslaSync",
) {
    val start = MaterialTheme.colorScheme.primary
    val end = TeslaTokens.chart.energy
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Canvas(modifier = Modifier.size(size)) {
            val side = this.size.minDimension
            val scale = side / LOGO_VIEWPORT
            drawRoundRect(
                brush = Brush.linearGradient(listOf(start, end)),
                size = Size(side, side),
                cornerRadius = CornerRadius(LOGO_CORNER * scale),
            )
            val bolt =
                Path().apply {
                    moveTo(112f * scale, 30f * scale)
                    lineTo(62f * scale, 108f * scale)
                    lineTo(96f * scale, 108f * scale)
                    lineTo(78f * scale, 170f * scale)
                    lineTo(136f * scale, 88f * scale)
                    lineTo(102f * scale, 88f * scale)
                    close()
                }
            drawPath(bolt, color = Color.White)
        }
        if (showWordmark) {
            Spacer(Modifier.width(Spacing.sm))
            Text(
                text = wordmark,
                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}
