package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the shared UI primitives, used by the @Preview entry points below to prove
 * the components render across the light, dark, and high-contrast themes. Each section exercises
 * the enabled/disabled/loading/empty states the components support.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComponentGallery() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Logo(showWordmark = true, size = 40.dp)
            ActionsSection()
            FeedbackSection()
            FormsSection()
            NavigationSection()
            TableSection()
            ThemeSection()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActionsSection() {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        SectionTitle("Actions")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button("Primary", onClick = {})
            Button("Secondary", onClick = {}, variant = ButtonVariant.Secondary)
            Button("Outline", onClick = {}, variant = ButtonVariant.Outline)
            Button("Danger", onClick = {}, variant = ButtonVariant.Danger)
            Button("Ghost", onClick = {}, variant = ButtonVariant.Ghost)
            Button("Loading", onClick = {}, loading = true)
            Button("Disabled", onClick = {}, enabled = false)
            Button("Add", onClick = {}, leadingIcon = TeslaGlyphs.Plus)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            IconButton(TeslaGlyphs.Copy, "Copy", onClick = {})
            IconButton(TeslaGlyphs.Edit, "Edit", onClick = {}, variant = IconButtonVariant.Tonal)
            IconButton(TeslaGlyphs.Close, "Close", onClick = {}, variant = IconButtonVariant.Outline)
            IconBox(tone = IconBoxTone.Success) { Icon(TeslaGlyphs.Check, null, tint = iconColorFor(IconBoxTone.Success)) }
            IconBox(tone = IconBoxTone.Danger) { Icon(TeslaGlyphs.Warning, null, tint = iconColorFor(IconBoxTone.Danger)) }
            CopyButton(text = "secret", copyLabel = "Copy", copiedLabel = "Copied")
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FeedbackSection() {
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        SectionTitle("Status")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Badge("Info", variant = BadgeVariant.Info, dot = true)
            Badge("Success", variant = BadgeVariant.Success)
            Badge("Warning", variant = BadgeVariant.Warning)
            Badge("Danger", variant = BadgeVariant.Danger)
            Badge("Neutral", variant = BadgeVariant.Neutral)
            StatusPill("Online", tone = StatusTone.Success, pulse = true)
            StatusPill("Idle", tone = StatusTone.Warning)
        }
        MaskedValue(
            value = "sk-1234567890",
            variant = MaskVariant.ApiKey,
            revealLabel = "Reveal",
            hideLabel = "Hide",
            accessibleName = "API key",
        )
    }
}

@Composable
private fun FormsSection() {
    var text by remember { mutableStateOf("Model Y") }
    var checked by remember { mutableStateOf(true) }
    var on by remember { mutableStateOf(false) }
    var slider by remember { mutableStateOf(0.4f) }
    var range by remember { mutableStateOf(0.2f..0.8f) }
    var selection by remember { mutableStateOf("a") }
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        SectionTitle("Forms")
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Input(value = text, onValueChange = { text = it }, label = "Vehicle name", required = true)
            Input(value = "", onValueChange = {}, label = "With error", errorText = "Required")
            Select(
                options = listOf(SelectOption("a", "Option A"), SelectOption("b", "Option B")),
                selectedValue = selection,
                onSelect = { selection = it },
                label = "Pick one",
            )
            Checkbox(checked = checked, onCheckedChange = { checked = it }, label = "Enabled")
            Toggle(checked = on, onCheckedChange = { on = it }, label = "Live updates")
            Slider(value = slider, onValueChange = { slider = it }, label = "Limit", valueText = "${(slider * 100).toInt()}%")
            RangeSlider(value = range, onValueChange = { range = it }, label = "Window")
            EditableText(value = text, onSave = { text = it }, editActionLabel = "Rename", saveLabel = "Save", cancelLabel = "Cancel")
        }
    }
}

@Composable
private fun NavigationSection() {
    var tab by remember { mutableStateOf("overview") }
    var nav by remember { mutableStateOf("day") }
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        SectionTitle("Navigation")
        Tabs(
            tabs = listOf(TabItem("overview", "Overview"), TabItem("trips", "Trips"), TabItem("charging", "Charging")),
            selectedKey = tab,
            onSelect = { tab = it },
        )
        TabNav(
            items = listOf(TabNavItem("day", "Day"), TabNavItem("week", "Week"), TabNavItem("month", "Month")),
            selectedKey = nav,
            onSelect = { nav = it },
            modifier = Modifier.padding(top = Spacing.sm),
        )
        Accordion(title = "Details", initiallyExpanded = true, modifier = Modifier.padding(top = Spacing.sm)) {
            BodyText("Collapsible content rendered inside the accordion body.")
        }
    }
}

private data class DemoRow(
    val id: Int,
    val name: String,
    val status: String,
)

@Composable
private fun TableSection() {
    val rows =
        remember {
            listOf(DemoRow(1, "Model Y", "Online"), DemoRow(2, "Model 3", "Asleep"), DemoRow(3, "Cybertruck", "Charging"))
        }
    var sort by remember { mutableStateOf(SortState("name", SortDirection.Asc)) }
    var selected by remember { mutableStateOf(setOf<Any>()) }
    var page by remember { mutableStateOf(1) }
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        SectionTitle("Data table")
        DataTable(
            columns =
                listOf(
                    TableColumn("name", "Name", weight = 2f, sortable = true) { BodyText(it.name) },
                    TableColumn("status", "Status", sortable = true) { Badge(it.status, variant = BadgeVariant.Info) },
                ),
            rows = rows,
            keyOf = { it.id },
            sortState = sort,
            onSortChange = { sort = sort.toggledBy(it) },
            selectable = true,
            selectedKeys = selected,
            onSelectedChange = { selected = it },
            footer = {
                Pagination(
                    page = page,
                    pageSize = 25,
                    total = 60,
                    onPageChange = { page = it },
                    firstLabel = "First",
                    previousLabel = "Previous",
                    nextLabel = "Next",
                    lastLabel = "Last",
                    showingText = { start, end, total -> "$start–$end of $total" },
                )
            },
        )
        DataTableBulkBar(
            count = selected.size,
            onClear = { selected = emptySet() },
            selectedText = { "$it selected" },
            clearLabel = "Clear",
            modifier = Modifier.padding(top = Spacing.sm),
        )
    }
}

@Composable
private fun ThemeSection() {
    val controller = rememberThemeController()
    GlassPanel(modifier = Modifier.fillMaxWidth()) {
        SectionTitle("Theme")
        ThemePicker(controller = controller)
        TriStateCheckbox(state = ToggleableState.Indeterminate, onClick = {
        }, label = "Mixed selection", modifier = Modifier.padding(top = Spacing.sm))
    }
}

@Preview(name = "Gallery · Light", showBackground = true, heightDp = 1600)
@Composable
private fun ComponentGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { ComponentGallery() }
}

@Preview(name = "Gallery · Dark", showBackground = true, heightDp = 1600)
@Composable
private fun ComponentGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { ComponentGallery() }
}

@Preview(name = "Gallery · High contrast", showBackground = true, heightDp = 1600)
@Composable
private fun ComponentGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { ComponentGallery() }
}
