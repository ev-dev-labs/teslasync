// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** Destructive vs cautionary confirmation styling. */
enum class ConfirmSeverity { Danger, Warning }

/**
 * Confirmation dialog mirroring web `components/ui/ConfirmDialog`. Built on [Modal] with a
 * severity icon, a message, optional typed-confirmation gate (the confirm button stays disabled
 * until the user types [requireTypedConfirmation]), and a [loading] state that disables both
 * buttons and spins the confirm button. Render conditionally with `if (open) ConfirmDialog(...)`.
 */
@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    cancelLabel: String,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    severity: ConfirmSeverity = ConfirmSeverity.Danger,
    loading: Boolean = false,
    requireTypedConfirmation: String? = null,
    typedConfirmationLabel: String? = null,
    closeLabel: String = "Close",
) {
    var typed by remember { mutableStateOf("") }
    val typedMatches = requireTypedConfirmation == null || typed == requireTypedConfirmation
    val confirmEnabled = !loading && typedMatches

    Modal(
        onDismissRequest = { if (!loading) onCancel() },
        modifier = modifier,
        title = title,
        closeLabel = closeLabel,
        dismissOnBackdrop = !loading,
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Icon(severityGlyph(severity), contentDescription = null, size = IconSize.Lg, tint = severityColor(severity))
            Spacer(Modifier.width(Spacing.sm))
            BodyText(message)
        }
        if (requireTypedConfirmation != null) {
            Spacer(Modifier.height(Spacing.md))
            Input(
                value = typed,
                onValueChange = { typed = it },
                label = typedConfirmationLabel ?: requireTypedConfirmation,
                enabled = !loading,
            )
        }
        Spacer(Modifier.height(Spacing.lg))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(cancelLabel, onCancel, variant = ButtonVariant.Secondary, enabled = !loading)
            Button(
                label = confirmLabel,
                onClick = onConfirm,
                variant = if (severity == ConfirmSeverity.Danger) ButtonVariant.Danger else ButtonVariant.Primary,
                enabled = confirmEnabled,
                loading = loading,
            )
        }
    }
}

private fun severityGlyph(severity: ConfirmSeverity): ImageVector =
    when (severity) {
        ConfirmSeverity.Danger -> TeslaGlyphs.Octagon
        ConfirmSeverity.Warning -> TeslaGlyphs.Warning
    }

@Composable
private fun severityColor(severity: ConfirmSeverity): Color =
    when (severity) {
        ConfirmSeverity.Danger -> TeslaTokens.status.danger
        ConfirmSeverity.Warning -> TeslaTokens.status.warning
    }
