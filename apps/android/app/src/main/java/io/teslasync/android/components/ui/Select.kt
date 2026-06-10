// File named after its primary @Composable; the co-located enum/data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/** A single option for [Select]: a stable [value], a display [label], and an [enabled] flag. */
data class SelectOption(
    val value: String,
    val label: String,
    val enabled: Boolean = true,
)

/**
 * Dropdown select mirroring web `components/ui/Select`, built on Material 3
 * [ExposedDropdownMenuBox]. The read-only anchor field shows the selected option's label (or
 * [emptyLabel] when nothing is chosen). [hint]/[errorText] render as supporting text below.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Select(
    options: List<SelectOption>,
    selectedValue: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    emptyLabel: String? = null,
    hint: String? = null,
    errorText: String? = null,
    enabled: Boolean = true,
    required: Boolean = false,
) {
    var expanded by remember { mutableStateOf(false) }
    val selectedLabel = options.firstOrNull { it.value == selectedValue }?.label ?: emptyLabel.orEmpty()

    ExposedDropdownMenuBox(
        expanded = expanded && enabled,
        onExpandedChange = { if (enabled) expanded = it },
        modifier = modifier,
    ) {
        OutlinedTextField(
            value = selectedLabel,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            isError = errorText != null,
            label = label?.let { text -> { FieldLabelSlot(text, required) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            supportingText = supportingSlot(errorText ?: hint),
            shape = MaterialTheme.shapes.medium,
            modifier =
                Modifier
                    .menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable)
                    .fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.label) },
                    enabled = option.enabled,
                    onClick = {
                        onSelect(option.value)
                        expanded = false
                    },
                )
            }
        }
    }
}
