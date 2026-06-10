package io.teslasync.android.components.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import kotlinx.coroutines.delay

private const val COPIED_RESET_MS = 2000L

/**
 * One-click clipboard button mirroring web `CopyButton`. Writes [text] to the system clipboard
 * and flips to a "copied" confirmation (check icon + [copiedLabel]) for two seconds. Set
 * [iconOnly] for dense rows. [contentDescription]/[copyLabel] drive the accessible name.
 */
@Composable
fun CopyButton(
    text: String,
    copyLabel: String,
    copiedLabel: String,
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    variant: ButtonVariant = ButtonVariant.Ghost,
    size: ButtonSize = ButtonSize.Sm,
    enabled: Boolean = true,
    onCopy: (() -> Unit)? = null,
) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(COPIED_RESET_MS)
            copied = false
        }
    }

    val perform: () -> Unit = {
        clipboard.setText(AnnotatedString(text))
        copied = true
        onCopy?.invoke()
    }
    val glyph = if (copied) TeslaGlyphs.Check else TeslaGlyphs.Copy
    val current = if (copied) copiedLabel else copyLabel

    if (iconOnly) {
        IconButton(
            imageVector = glyph,
            contentDescription = current,
            onClick = perform,
            modifier = modifier,
            enabled = enabled,
            variant = IconButtonVariant.Standard,
        )
    } else {
        Button(
            label = current,
            onClick = perform,
            modifier = modifier,
            variant = variant,
            size = size,
            enabled = enabled,
            leadingIcon = glyph,
        )
    }
}
