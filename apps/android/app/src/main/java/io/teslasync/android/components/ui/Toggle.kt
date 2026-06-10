package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Switch toggle mirroring web `components/ui/Toggle` (WAI-ARIA `role="switch"`). With a [label]
 * the entire row is one switch target (Material `Role.Switch`, ≥48 dp); the label sits left and
 * the switch right, the common settings-row layout. A null [onCheckedChange] renders read-only.
 */
@Composable
fun Toggle(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
) {
    if (label == null) {
        Switch(checked = checked, onCheckedChange = onCheckedChange, modifier = modifier, enabled = enabled)
        return
    }
    val rowModifier =
        if (onCheckedChange != null) {
            modifier
                .fillMaxWidth()
                .minimumInteractiveComponentSize()
                .toggleable(value = checked, enabled = enabled, role = Role.Switch) { onCheckedChange(it) }
        } else {
            modifier.fillMaxWidth()
        }
    Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.width(Spacing.sm))
        Switch(checked = checked, onCheckedChange = null, enabled = enabled)
    }
}
