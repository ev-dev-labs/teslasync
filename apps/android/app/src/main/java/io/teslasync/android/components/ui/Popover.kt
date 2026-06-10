package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Lightweight anchored popover mirroring web `components/ui/Popover`. Uses a focusable [Popup]
 * so Back and outside taps dismiss via [onDismissRequest]; it is intentionally NOT a focus trap
 * (use [Modal] for that). Place it inside a Box next to its trigger — [Popup] positions relative
 * to that parent — and pass [alignment]/[offset] to fine-tune placement.
 */
@Composable
fun Popover(
    expanded: Boolean,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    alignment: Alignment = Alignment.TopStart,
    offset: IntOffset = IntOffset.Zero,
    accessibleName: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (!expanded) return
    Popup(
        alignment = alignment,
        offset = offset,
        onDismissRequest = onDismissRequest,
        properties = PopupProperties(focusable = true),
    ) {
        Surface(
            modifier = modifier.semantics { accessibleName?.let { contentDescription = it } },
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = Elevation.overlay,
            shadowElevation = Elevation.overlay,
        ) {
            Column(modifier = Modifier.padding(Spacing.sm), content = content)
        }
    }
}
