package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Pin toggle mirroring web `PinButton`. The web version is backed by the `usePinned` API hook;
 * networking is out of scope here, so this is a controlled toggle — the host owns [pinned] and
 * reacts to [onToggle]. When pinned the icon is tinted with the warning/amber status color. Set
 * [showLabel] to render the state text beside the icon.
 */
@Composable
fun PinButton(
    pinned: Boolean,
    onToggle: () -> Unit,
    pinLabel: String,
    pinnedLabel: String,
    modifier: Modifier = Modifier,
    showLabel: Boolean = false,
    enabled: Boolean = true,
    size: IconSize = IconSize.Md,
) {
    val label = if (pinned) pinnedLabel else pinLabel
    val tint: Color = if (pinned) TeslaTokens.status.warning else LocalContentColor.current

    if (showLabel) {
        Button(onClick = onToggle, modifier = modifier, variant = ButtonVariant.Ghost, size = ButtonSize.Sm, enabled = enabled) {
            Icon(TeslaGlyphs.Pin, contentDescription = null, size = IconSize.Sm, tint = tint)
            Spacer(Modifier.width(Spacing.sm))
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    } else {
        IconButton(
            imageVector = TeslaGlyphs.Pin,
            contentDescription = label,
            onClick = onToggle,
            modifier = modifier,
            enabled = enabled,
            size = size,
            tint = tint,
        )
    }
}
