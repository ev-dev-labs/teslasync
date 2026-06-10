@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.forms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.UiDensity
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the forms layer, used by the @Preview entry points below to prove every
 * primitive renders across the light, dark, and high-contrast themes. Each section is interactive
 * (state hoisted into `remember`) so selectors, filters, validation, and inputs exercise their
 * real callbacks.
 */
@Composable
private fun FormsGallery() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            FieldsSection()
            SelectorsSection()
            FiltersSection()
            RangesSection()
            TreeAndVehicleSection()
            ExportSection()
        }
    }
}

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionTitle(title)
        content()
    }
}

@Composable
private fun FieldsSection() {
    Section("Fields") {
        FormSection(title = "Profile", description = "Your account details") {
            var name by remember { mutableStateOf("") }
            FormField(label = "Display name", required = true, helperText = "Shown to other users") {
                Input(value = name, onValueChange = { name = it })
            }
            FormField(label = "Email", errorText = "Enter a valid email") {
                Input(value = "not-an-email", onValueChange = {})
            }
        }
        var search by remember { mutableStateOf("") }
        SearchInput(value = search, onValueChange = { search = it }, history = listOf("model y", "supercharger"), onSelectHistory = {
            search =
                it
        })
        var unit by remember { mutableStateOf<Double?>(60.0) }
        UnitInput(value = unit, onValueChange = { unit = it }, unitSymbol = "mph", label = "Speed")
        var price by remember { mutableStateOf<Double?>(1.5) }
        CurrencyInput(value = price, onValueChange = { price = it }, label = "Electricity cost")
        var tags by remember { mutableStateOf(listOf("home", "work")) }
        TagInput(tags = tags, onTagsChange = { tags = it }, label = "Tags")
    }
}

@Composable
private fun SelectorsSection() {
    Section("Selectors") {
        var single by remember { mutableStateOf<String?>(null) }
        Combobox(options = sampleOptions, selectedValue = single, onSelect = { single = it }, label = "Vehicle model")
        var multi by remember { mutableStateOf(setOf("m3")) }
        ComboboxMulti(options = sampleOptions, selectedValues = multi, onToggle = { multi = toggleSelection(multi, it) }, label = "Models")
        var field by remember { mutableStateOf("date") }
        var direction by remember { mutableStateOf(SortDirection.Desc) }
        SortControl(
            field = field,
            direction = direction,
            options = listOf(SortOption("date", "Date"), SortOption("distance", "Distance"), SortOption("score", "Score")),
            onFieldChange = { field = it },
            onDirectionChange = { direction = it },
        )
    }
}

@Composable
private fun FiltersSection() {
    Section("Filters") {
        var pill by remember { mutableStateOf("all") }
        PillFilterBar(
            items = listOf(PillItem("all", "All", 42), PillItem("active", "Active", 7), PillItem("idle", "Idle", 35)),
            selectedId = pill,
            onSelect = { pill = it },
        )
        var filters by remember {
            mutableStateOf(
                listOf(
                    ActiveFilter("vehicle", "Vehicle", "Model 3"),
                    ActiveFilter("range", "Range", "Last 7 days"),
                    ActiveFilter("min", "Min distance", "50 km"),
                ),
            )
        }
        ActiveFilterChips(
            filters = filters,
            onRemove = { key -> filters = filters.filterNot { it.key == key } },
            onClearAll = { filters = emptyList() },
            maxVisible = 2,
        )
        var preset by remember { mutableStateOf<DatePreset?>(DatePreset.Last7Days) }
        DatePresetChips(onSelect = { p, _ -> preset = p }, activePreset = preset)
        var density by remember { mutableStateOf(UiDensity.Comfortable) }
        DensityToggle(density = density, onDensityChange = { density = it })
    }
}

@Composable
private fun RangesSection() {
    Section("Ranges") {
        var min by remember { mutableStateOf<Double?>(10.0) }
        var max by remember { mutableStateOf<Double?>(80.0) }
        RangePicker(
            min = min,
            max = max,
            onRangeChange = { lo, hi ->
                min = lo
                max = hi
            },
            unitSymbol = "%",
        )
        var start by remember { mutableStateOf<Long?>(null) }
        var end by remember { mutableStateOf<Long?>(null) }
        DateRangeFilter(
            startEpochDay = start,
            endEpochDay = end,
            onRangeChange = { s, e ->
                start = s
                end = e
            },
        )
    }
}

@Composable
private fun TreeAndVehicleSection() {
    Section("Tree + vehicles") {
        var treeSelected by remember { mutableStateOf(setOf("speed")) }
        TreeSelect(groups = sampleTree, selected = treeSelected, onSelectedChange = { treeSelected = it })
        var vehicleId by remember { mutableStateOf<Long?>(1L) }
        VehicleSelect(vehicles = sampleVehicles, selectedId = vehicleId, onSelect = { vehicleId = it })
        var vehicleSel by remember { mutableStateOf(hydrateVehicleSelection(sampleVehicles.map { it.id }, listOf(1L))) }
        VehicleMultiSelect(
            vehicles = sampleVehicles,
            selection = vehicleSel,
            onSelectionChange = { vehicleSel = it },
        )
    }
}

@Composable
private fun ExportSection() {
    Section("Export") {
        ListExportMenu(onExport = {})
    }
}

private val sampleOptions =
    listOf(
        ComboOption("m3", "Model 3"),
        ComboOption("my", "Model Y"),
        ComboOption("ms", "Model S"),
        ComboOption("mx", "Model X", enabled = false),
    )

private val sampleVehicles =
    listOf(
        VehicleOption(1L, "Garage Model 3"),
        VehicleOption(2L, "Road-trip Model Y"),
        VehicleOption(3L, "Work Model S"),
    )

private val sampleTree =
    listOf(
        TreeGroup(
            id = "drive",
            label = "Drive signals",
            leaves = listOf(TreeLeaf("speed", "Speed"), TreeLeaf("heading", "Heading"), TreeLeaf("power", "Power")),
        ),
        TreeGroup(
            id = "charge",
            label = "Charge signals",
            leaves = listOf(TreeLeaf("soc", "State of charge"), TreeLeaf("rate", "Charge rate")),
        ),
    )

@Preview(name = "Forms \u00b7 Light", showBackground = true, heightDp = 2400)
@Composable
private fun FormsGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { FormsGallery() }
}

@Preview(name = "Forms \u00b7 Dark", showBackground = true, heightDp = 2400)
@Composable
private fun FormsGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { FormsGallery() }
}

@Preview(name = "Forms \u00b7 High contrast", showBackground = true, heightDp = 2400)
@Composable
private fun FormsGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { FormsGallery() }
}
