package io.teslasync.android.components.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Hover/long-press tooltip mirroring web `components/ui/Tooltip`, built on Material 3
 * [TooltipBox]. Wrap any [content] (commonly a button or icon); the platform shows [text] on
 * long-press (touch) or hover (pointer) and wires the `Role`/description for accessibility. Set
 * [rich] for a larger persistent surface suited to longer copy.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Tooltip(
    text: String,
    modifier: Modifier = Modifier,
    rich: Boolean = false,
    content: @Composable () -> Unit,
) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = {
            if (rich) {
                RichTooltip { Text(text) }
            } else {
                PlainTooltip { Text(text) }
            }
        },
        state = rememberTooltipState(),
        modifier = modifier,
        content = content,
    )
}
