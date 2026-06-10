package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Form field label with a visible + accessible required indicator, mirroring web
 * `components/ui/Label`. When [required] is set a tinted asterisk is shown and, if
 * [requiredDescription] is provided, the row's accessible name becomes "{text}, {required}"
 * so screen readers announce the requirement (WCAG 3.3.2). The shared field primitives render
 * their own label; reach for this when wiring a custom composite control.
 */
@Composable
fun FormLabel(
    text: String,
    modifier: Modifier = Modifier,
    required: Boolean = false,
    requiredDescription: String? = null,
) {
    val description =
        if (required && requiredDescription != null) "$text, $requiredDescription" else null
    val rowModifier =
        if (description != null) {
            modifier.semantics(mergeDescendants = true) { contentDescription = description }
        } else {
            modifier
        }
    Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
        FieldLabelText(text)
        if (required) {
            Spacer(Modifier.width(Spacing.xs))
            Text("*", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
        }
    }
}
