package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.selection.triStateToggleable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.state.ToggleableState
import io.teslasync.android.ui.theme.generated.Spacing
import androidx.compose.material3.Checkbox as M3Checkbox
import androidx.compose.material3.TriStateCheckbox as M3TriStateCheckbox

/**
 * Checkbox mirroring web `components/ui/Checkbox`. With a [label] the whole row is one toggle
 * target (Material `Role.Checkbox`, ≥48 dp), so tapping the text also toggles. A null
 * [onCheckedChange] renders a read-only/displayed checkbox.
 */
@Composable
fun Checkbox(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
) {
    if (label == null) {
        M3Checkbox(checked = checked, onCheckedChange = onCheckedChange, modifier = modifier, enabled = enabled)
        return
    }
    val rowModifier =
        if (onCheckedChange != null) {
            modifier
                .minimumInteractiveComponentSize()
                .toggleable(value = checked, enabled = enabled, role = Role.Checkbox) { onCheckedChange(it) }
        } else {
            modifier
        }
    Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
        M3Checkbox(checked = checked, onCheckedChange = null, enabled = enabled)
        Spacer(Modifier.width(Spacing.sm))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

/**
 * Tri-state checkbox for "select all" headers — the indeterminate (mixed) state the web
 * Checkbox modeled with its `indeterminate` prop. [state] is one of On/Off/Indeterminate.
 */
@Composable
fun TriStateCheckbox(
    state: ToggleableState,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
) {
    if (label == null) {
        M3TriStateCheckbox(state = state, onClick = onClick, modifier = modifier, enabled = enabled)
        return
    }
    val rowModifier =
        if (onClick != null) {
            modifier
                .minimumInteractiveComponentSize()
                .triStateToggleable(state = state, enabled = enabled, role = Role.Checkbox, onClick = onClick)
        } else {
            modifier
        }
    Row(modifier = rowModifier, verticalAlignment = Alignment.CenterVertically) {
        M3TriStateCheckbox(state = state, onClick = null, enabled = enabled)
        Spacer(Modifier.width(Spacing.sm))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
