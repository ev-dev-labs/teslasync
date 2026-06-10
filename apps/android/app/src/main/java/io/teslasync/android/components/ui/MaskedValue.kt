package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

private const val EM_DASH = "\u2014"

/**
 * Privacy primitive mirroring web `components/ui/MaskedValue`. Renders [value] masked by
 * [maskValue] with a click-to-reveal eye toggle that auto-hides after [autoHideMillis]. The
 * [accessibleName] is spoken instead of the bullet characters so screen readers never blurt the
 * raw secret. When [copyable] the raw value can still be copied regardless of mask state.
 */
@Composable
fun MaskedValue(
    value: String?,
    variant: MaskVariant,
    revealLabel: String,
    hideLabel: String,
    accessibleName: String,
    modifier: Modifier = Modifier,
    showLast: Int? = null,
    copyable: Boolean = false,
    copyLabel: String = "",
    copiedLabel: String = "",
    autoHideMillis: Long = 30_000L,
) {
    val raw = value.orEmpty()
    var revealed by remember(raw) { mutableStateOf(false) }

    LaunchedEffect(revealed) {
        if (revealed && autoHideMillis > 0) {
            delay(autoHideMillis)
            revealed = false
        }
    }

    if (raw.isEmpty()) {
        Caption(EM_DASH, modifier.semantics { contentDescription = accessibleName })
        return
    }

    val display = if (revealed) raw else maskValue(raw, variant, showLast)
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        CodeText(display, Modifier.semantics { contentDescription = accessibleName })
        Spacer(Modifier.width(Spacing.xs))
        IconButton(
            imageVector = if (revealed) TeslaGlyphs.EyeOff else TeslaGlyphs.Eye,
            contentDescription = if (revealed) hideLabel else revealLabel,
            onClick = { revealed = !revealed },
            size = IconSize.Sm,
        )
        if (copyable) {
            CopyButton(text = raw, copyLabel = copyLabel, copiedLabel = copiedLabel, iconOnly = true)
        }
    }
}
