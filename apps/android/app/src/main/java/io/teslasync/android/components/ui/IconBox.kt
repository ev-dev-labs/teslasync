package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius

/** Semantic tone for an [IconBox] background ring. */
enum class IconBoxTone { Primary, Success, Warning, Danger, Info, Neutral }

/** Box footprint for [IconBox]. */
enum class IconBoxSize(
    val box: Dp,
    val corner: Dp,
) {
    Sm(32.dp, Radius.sm),
    Md(40.dp, Radius.md),
    Lg(48.dp, Radius.lg),
}

/**
 * Colored icon container with a tinted background, mirroring web `components/ui/IconBox`. The
 * background uses a low-alpha wash of the tone color; callers place an [Icon] (already tinted by
 * [iconColorFor]) inside via [content].
 */
@Composable
fun IconBox(
    tone: IconBoxTone = IconBoxTone.Primary,
    modifier: Modifier = Modifier,
    size: IconBoxSize = IconBoxSize.Md,
    content: @Composable () -> Unit,
) {
    val color = iconColorFor(tone)
    Surface(
        modifier = modifier.size(size.box),
        shape = RoundedCornerShape(size.corner),
        color = color.copy(alpha = WASH_ALPHA),
        contentColor = color,
    ) {
        Box(contentAlignment = Alignment.Center) { content() }
    }
}

/** The full-strength tone color, suitable for the [Icon] tint placed inside an [IconBox]. */
@Composable
fun iconColorFor(tone: IconBoxTone): Color =
    when (tone) {
        IconBoxTone.Primary -> MaterialTheme.colorScheme.primary
        IconBoxTone.Success -> TeslaTokens.status.success
        IconBoxTone.Warning -> TeslaTokens.status.warning
        IconBoxTone.Danger -> TeslaTokens.status.danger
        IconBoxTone.Info -> TeslaTokens.status.info
        IconBoxTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private const val WASH_ALPHA = 0.14f
