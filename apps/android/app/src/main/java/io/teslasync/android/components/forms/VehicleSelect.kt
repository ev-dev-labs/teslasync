// File holds the vehicle selectors; the co-located data class is a supporting type.
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
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs

/** One vehicle option: a stable [id] and a display [label] (e.g. display name / VIN tail). */
data class VehicleOption(
    val id: Long,
    val label: String,
)

/**
 * Single-vehicle picker mirroring web `components/forms/VehicleSelect`. A thin wrapper over the
 * shared [Select] that maps [VehicleOption]s to options and emits the chosen vehicle id.
 */
@Composable
fun VehicleSelect(
    vehicles: List<VehicleOption>,
    selectedId: Long?,
    onSelect: (Long) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = "Vehicle",
    emptyLabel: String = "Select a vehicle",
) {
    Select(
        options = vehicles.map { SelectOption(it.id.toString(), it.label) },
        selectedValue = selectedId?.toString(),
        onSelect = { value -> value.toLongOrNull()?.let(onSelect) },
        modifier = modifier,
        label = label,
        emptyLabel = emptyLabel,
    )
}

/**
 * Multi-vehicle picker mirroring web `components/forms/VehicleMultiSelect`. A read-only anchor
 * summarises the [VehicleSelection] ("All vehicles" / "N selected"); the menu offers an All toggle
 * plus per-vehicle toggles, all routed through the shared selection logic ([toggleVehicle]) so
 * "all selected" collapses to the compact payload on save (see [buildVehiclePayload]).
 */
@Composable
fun VehicleMultiSelect(
    vehicles: List<VehicleOption>,
    selection: VehicleSelection,
    onSelectionChange: (VehicleSelection) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = "Vehicles",
    allLabel: String = "All vehicles",
) {
    var expanded by remember { mutableStateOf(false) }
    val allIds = vehicles.map { it.id }
    val summary = if (selection.allSelected) allLabel else "${selection.ids.size} selected"

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
            DropdownMenuItem(
                text = { Text(allLabel) },
                leadingIcon = checkIcon(selection.allSelected),
                onClick = { onSelectionChange(VehicleSelection(allIds.toSet(), allIds.isNotEmpty())) },
            )
            vehicles.forEach { vehicle ->
                DropdownMenuItem(
                    text = { Text(vehicle.label) },
                    leadingIcon = checkIcon(!selection.allSelected && vehicle.id in selection.ids),
                    onClick = { onSelectionChange(toggleVehicle(selection, vehicle.id, allIds)) },
                )
            }
        }
    }
}

private fun checkIcon(checked: Boolean): (@Composable () -> Unit)? =
    if (checked) {
        { Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm) }
    } else {
        null
    }
