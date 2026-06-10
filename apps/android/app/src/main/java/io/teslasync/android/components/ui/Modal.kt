package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Surface modal mirroring web `components/ui/Modal`, built on a Compose [Dialog]. The dialog
 * scrim, outside-tap, and system-back dismissal are handled by the platform. Render it
 * conditionally (`if (open) Modal(...)`) — the Compose idiom for the web `open` prop. Supplies a
 * title row with a close button, a scrollable body, and a [paneTitle] for accessibility.
 */
@Composable
fun Modal(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    accessibleName: String? = null,
    closeLabel: String = "Close",
    dismissOnBackdrop: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties =
            DialogProperties(
                dismissOnClickOutside = dismissOnBackdrop,
                dismissOnBackPress = true,
                usePlatformDefaultWidth = false,
            ),
    ) {
        Surface(
            modifier =
                modifier
                    .fillMaxWidth(MODAL_WIDTH_FRACTION)
                    .widthIn(max = MODAL_MAX_WIDTH)
                    .semantics { paneTitle = title ?: accessibleName.orEmpty() },
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = Elevation.modal,
        ) {
            Column(modifier = Modifier.padding(Spacing.lg)) {
                if (title != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SectionTitle(title, modifier = Modifier.weight(1f))
                        IconButton(
                            imageVector = TeslaGlyphs.Close,
                            contentDescription = closeLabel,
                            onClick = onDismissRequest,
                            size = IconSize.Md,
                        )
                    }
                    Spacer(Modifier.height(Spacing.md))
                }
                Column(
                    modifier =
                        Modifier
                            .heightIn(max = MODAL_MAX_BODY_HEIGHT)
                            .verticalScroll(rememberScrollState()),
                    content = content,
                )
            }
        }
    }
}

private const val MODAL_WIDTH_FRACTION = 0.94f
private val MODAL_MAX_WIDTH = 560.dp
private val MODAL_MAX_BODY_HEIGHT = 560.dp
