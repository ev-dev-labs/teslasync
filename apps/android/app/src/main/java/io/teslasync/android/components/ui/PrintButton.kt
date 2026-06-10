package io.teslasync.android.components.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Print affordance. The web version calls `window.print()`; Android has no DOM print, so this
 * primitive is a controlled trigger — the host wires [onPrint] to the Android `PrintManager`
 * (out of scope here per the prompt's networking/business-logic exclusion). Renders an icon-only
 * or labeled button per [iconOnly].
 */
@Composable
fun PrintButton(
    label: String,
    onPrint: () -> Unit,
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    enabled: Boolean = true,
) {
    if (iconOnly) {
        IconButton(
            imageVector = TeslaGlyphs.Printer,
            contentDescription = label,
            onClick = onPrint,
            modifier = modifier,
            enabled = enabled,
        )
    } else {
        Button(
            label = label,
            onClick = onPrint,
            modifier = modifier,
            variant = variant,
            size = size,
            enabled = enabled,
            leadingIcon = TeslaGlyphs.Printer,
        )
    }
}
