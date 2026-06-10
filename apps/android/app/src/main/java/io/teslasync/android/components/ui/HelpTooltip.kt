package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Page-level help affordance mirroring web `components/ui/HelpTooltip`: a [title] followed by a
 * [HelpIcon] that reveals [helpText]. Use beside technical metric titles ("Vampire Drain",
 * "Drive Score"). [helpContentDescription] names the help trigger for screen readers.
 */
@Composable
fun HelpTooltip(
    title: String,
    helpText: String,
    helpContentDescription: String,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Subhead(title)
        Spacer(Modifier.width(Spacing.xs))
        HelpIcon(helpText, helpContentDescription)
    }
}
