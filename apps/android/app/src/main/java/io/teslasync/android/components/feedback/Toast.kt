// File named after its primary @Composable; toasts share the ToastItem type from FeedbackLogic.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Transient feedback surfaces mirroring web `components/feedback/Toast`. A single [Toast] renders
 * one [ToastItem] as a Material 3 [Snackbar] with a leading tone glyph, an optional action, and an
 * optional dismiss; [ToastHost] stacks an ordered queue (see [enqueueToast]/[dismissToast]) at the
 * bottom of the screen. Use for post-mutation confirmations; use [AlertBanner] for persistent
 * conditions.
 */
@Composable
fun Toast(
    item: ToastItem,
    modifier: Modifier = Modifier,
    onAction: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
    dismissLabel: String = "Dismiss",
) {
    Snackbar(
        modifier = modifier.padding(Spacing.sm),
        action =
            if (item.actionLabel != null && onAction != null) {
                {
                    Button(item.actionLabel, onClick = onAction, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                }
            } else {
                null
            },
        dismissAction =
            onDismiss?.let {
                {
                    IconButton(TeslaGlyphs.Close, contentDescription = dismissLabel, onClick = it, size = IconSize.Sm)
                }
            },
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(toneGlyph(item.tone), contentDescription = null, size = IconSize.Sm, tint = toneColor(item.tone))
            Text(item.message, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/**
 * Bottom-anchored stack of active toasts. [onDismiss]/[onAction] receive the [ToastItem.id] of the
 * affected toast so the host stays a controlled component owned by the caller's queue state.
 */
@Composable
fun ToastHost(
    toasts: List<ToastItem>,
    onDismiss: (Long) -> Unit,
    modifier: Modifier = Modifier,
    onAction: (Long) -> Unit = {},
) {
    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            toasts.forEach { item ->
                Toast(
                    item = item,
                    onAction = if (item.actionLabel != null) ({ onAction(item.id) }) else null,
                    onDismiss = { onDismiss(item.id) },
                )
            }
        }
    }
}
