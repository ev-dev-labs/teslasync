// File holds the combobox family; options use ComboOption from FormsLogic.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.forms

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
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs

/**
 * Type-to-filter single-select combobox mirroring web `components/forms/Combobox`. Built on the
 * Material 3 [ExposedDropdownMenuBox]; typing filters the options (see [filterComboOptions]) and
 * selecting one emits its value. An empty filter result shows a disabled "[emptyLabel]" row so the
 * menu is never blank.
 */
@Composable
fun Combobox(
    options: List<ComboOption>,
    selectedValue: String?,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    emptyLabel: String = "No matches",
) {
    var expanded by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val selectedLabel = comboLabelFor(options, selectedValue).orEmpty()
    val filtered = filterComboOptions(options, query)

    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = if (expanded) query else selectedLabel,
            onValueChange = {
                query = it
                expanded = true
            },
            singleLine = true,
            label = label?.let { text -> { Text(text) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (filtered.isEmpty()) {
                DropdownMenuItem(text = { Text(emptyLabel) }, enabled = false, onClick = {})
            } else {
                filtered.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        enabled = option.enabled,
                        onClick = {
                            onSelect(option.value)
                            query = ""
                            expanded = false
                        },
                    )
                }
            }
        }
    }
}

/**
 * Multi-select combobox mirroring web `components/forms/ComboboxMulti`. The read-only anchor shows
 * a selected-count summary; each row toggles via [onToggle] (the menu stays open) with a leading
 * check on selected options (see [toggleSelection]).
 */
@Composable
fun ComboboxMulti(
    options: List<ComboOption>,
    selectedValues: Set<String>,
    onToggle: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    emptyLabel: String = "Select…",
) {
    var expanded by remember { mutableStateOf(false) }
    val summary = if (selectedValues.isEmpty()) emptyLabel else "${selectedValues.size} selected"

    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = summary,
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            label = label?.let { text -> { Text(text) } },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            if (options.isEmpty()) {
                DropdownMenuItem(text = { Text(emptyLabel) }, enabled = false, onClick = {})
            } else {
                options.forEach { option ->
                    val checked = option.value in selectedValues
                    DropdownMenuItem(
                        text = { Text(option.label) },
                        enabled = option.enabled,
                        leadingIcon =
                            if (checked) {
                                { Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm) }
                            } else {
                                null
                            },
                        onClick = { onToggle(option.value) },
                    )
                }
            }
        }
    }
}
