package io.teslasync.android.components.ui

import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch

/**
 * Field-level help affordance mirroring web `components/ui/HelpIcon`: a small `(?)` button that
 * reveals [text] in a persistent [RichTooltip]. Tapping the icon shows the tooltip (so touch
 * users get the same affordance as hover); [contentDescription] names it for screen readers
 * (e.g. "Help for {field}").
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpIcon(
    text: String,
    contentDescription: String,
    modifier: Modifier = Modifier,
    size: IconSize = IconSize.Sm,
) {
    val state = rememberTooltipState(isPersistent = true)
    val scope = rememberCoroutineScope()
    TooltipBox(
        positionProvider = TooltipDefaults.rememberRichTooltipPositionProvider(),
        tooltip = { RichTooltip { Text(text) } },
        state = state,
        modifier = modifier,
    ) {
        IconButton(
            imageVector = TeslaGlyphs.Help,
            contentDescription = contentDescription,
            onClick = { scope.launch { state.show() } },
            size = size,
        )
    }
}
