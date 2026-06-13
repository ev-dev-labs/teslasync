// Compose render layer for the AddAnnotationPopover modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/components/charts/AddAnnotationPopover.tsx). It is a thin shell over the pure
// [AddAnnotationProjection] derivations: a Material 3 modal hosting the (fixed or editable) date, the required label,
// the colour-coded category pills, the optional description, and the Cancel + Add-annotation actions (the Add button
// disables until a non-blank label is typed, web `disabled={!label.trim()}`). Every string is resolved from the i18n
// catalog (P1/S10); the category accent colours come from the model's SI-of-colour `colorArgb` carriers (mirroring
// the web `ANNOTATION_COLORS`); spacing comes from the generated theme tokens (P1/S9). The view performs NO HTTP and
// owns no store: the web component's only hook is `useTranslation`, and the assembled annotation is handed back to
// the parent through the [onAdd] callback exactly as the web `onAdd` prop is.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/AddAnnotationPopover) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting
// declarations (the localized-strings carrier + the authored category glyph set).
@file:OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.addannotationpopover

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Selected-pill container tint (the accent colour at low alpha — web `bg-gray-100 dark:bg-white/10` + accent text). */
private const val SELECTED_CONTAINER_ALPHA = 0.16f

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one
 * carrier so the stateless content takes plain strings and stays trivially previewable + UI-testable.
 */
data class AddAnnotationStrings(
    val title: String,
    val close: String,
    val date: String,
    val label: String,
    val labelHint: String,
    val category: String,
    val milestone: String,
    val maintenance: String,
    val trip: String,
    val issue: String,
    val upgrade: String,
    val custom: String,
    val description: String,
    val descriptionHint: String,
    val cancel: String,
    val add: String,
    val confirm: String,
)

/** Resolves every [AddAnnotationStrings] entry from the generated i18n catalog keys (P1/S10). */
@Composable
fun rememberAddAnnotationStrings(): AddAnnotationStrings =
    AddAnnotationStrings(
        title = stringResource(R.string.translation_annotation_addTitle),
        close = stringResource(R.string.translation_common_close),
        date = stringResource(R.string.translation_annotation_date),
        label = stringResource(R.string.translation_annotation_label),
        labelHint = stringResource(R.string.translation_annotation_labelPlaceholder), // parity:allow web i18n key name
        category = stringResource(R.string.translation_annotation_category),
        milestone = stringResource(R.string.translation_annotation_cat_milestone),
        maintenance = stringResource(R.string.translation_annotation_cat_maintenance),
        trip = stringResource(R.string.translation_annotation_cat_trip),
        issue = stringResource(R.string.translation_annotation_cat_issue),
        upgrade = stringResource(R.string.translation_annotation_cat_upgrade),
        custom = stringResource(R.string.translation_annotation_cat_custom),
        description = stringResource(R.string.translation_annotation_description),
        descriptionHint = stringResource(R.string.translation_annotation_descPlaceholder), // parity:allow web i18n key name
        cancel = stringResource(R.string.translation_common_cancel),
        add = stringResource(R.string.translation_annotation_add),
        confirm = stringResource(R.string.translation_common_confirm),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `AddAnnotationPopover` props. Renders nothing while
 * [open] is false (the Compose idiom for the web `open` prop), records the one-shot PII-safe `view.opened`
 * diagnostic on open (P1/S11), and hosts the modal form. The assembled annotation is handed to [onAdd]; [onCancel]
 * dismisses. No HTTP, no store — the parent owns both callbacks exactly as the web component's props are.
 *
 * @param open whether the dialog is shown (web `open`).
 * @param timestamp the ISO instant of the annotated point (web `timestamp`); shown as-is when the date is fixed and
 *   used as the occurred-at when [editableDate] is false.
 * @param onAdd receives the assembled [AnnotationResult] on a valid submit (web `onAdd(label, category, …)`).
 * @param onCancel dismiss callback (web `onCancel`).
 * @param editableDate when true the date becomes editable via a capped Material 3 date picker (web `editableDate`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AddAnnotationPopover(
    open: Boolean,
    timestamp: String,
    onAdd: (AnnotationResult) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    editableDate: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    LaunchedEffect(Unit) { AddAnnotationPopoverDiagnostics.recordViewOpened(logger) }
    val strings = rememberAddAnnotationStrings()
    Modal(
        onDismissRequest = onCancel,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        AddAnnotationPopoverContent(
            timestamp = timestamp,
            editableDate = editableDate,
            strings = strings,
            onAdd = onAdd,
            onCancel = onCancel,
        )
    }
}

/**
 * Stateless renderer + form-state owner — the unit/UI-test and preview entry point. Owns the ephemeral draft (web
 * `useState`), clamps each edit to the web `maxLength` bounds, re-syncs the editable date whenever [timestamp]
 * changes (web `useEffect([open, timestamp])`), and assembles the result through the pure [AddAnnotationProjection].
 * Every control carries an accessible label; the Add action stays disabled until the label is non-blank.
 */
@Composable
fun AddAnnotationPopoverContent(
    timestamp: String,
    editableDate: Boolean,
    strings: AddAnnotationStrings,
    onAdd: (AnnotationResult) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf(AnnotationDraft()) }
    // Re-sync the date field whenever the popover (re)opens with a fresh timestamp — web `useEffect` re-sync.
    LaunchedEffect(timestamp) {
        draft = draft.copy(editedDate = AddAnnotationDates.toDateInputValue(timestamp))
    }
    val labelFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { labelFocus.requestFocus() } }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (editableDate) {
            AnnotationDateField(
                value = draft.editedDate,
                strings = strings,
                onPick = { picked -> draft = draft.copy(editedDate = picked) },
            )
        } else {
            HelperText(timestamp)
        }

        Input(
            value = draft.label,
            onValueChange = { draft = draft.copy(label = AddAnnotationProjection.clampLabel(it)) },
            modifier = Modifier.focusRequester(labelFocus),
            label = strings.label,
            hint = strings.labelHint,
        )

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FieldLabelText(strings.category)
            CategoryPills(
                selected = draft.category,
                strings = strings,
                onSelect = { draft = draft.copy(category = it) },
            )
        }

        Input(
            value = draft.description,
            onValueChange = { draft = draft.copy(description = AddAnnotationProjection.clampDescription(it)) },
            label = strings.description,
            hint = strings.descriptionHint,
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
            Button(
                label = strings.add,
                onClick = {
                    val result = AddAnnotationProjection.buildResult(draft, editableDate, timestamp)
                    if (result != null) {
                        onAdd(result)
                        // Web resets label/category/description after onAdd; the seeded date is preserved.
                        draft = draft.copy(label = "", category = AnnotationCategory.DEFAULT, description = "")
                    }
                },
                size = ButtonSize.Sm,
                enabled = AddAnnotationProjection.isLabelValid(draft.label),
            )
        }
    }
}

/**
 * The colour-coded category selector — the web "category pills" row. Each [AnnotationCategory] renders as a
 * Material 3 [FilterChip] (single-select, TalkBack-announced as selected/unselected) whose selected container,
 * label, and leading glyph adopt the category's accent (web `style={{ color: ANNOTATION_COLORS[value] }}`).
 */
@Composable
private fun CategoryPills(
    selected: AnnotationCategory,
    strings: AddAnnotationStrings,
    onSelect: (AnnotationCategory) -> Unit,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        AnnotationCategory.entries.forEach { category ->
            val isSelected = category == selected
            val accent = Color(category.colorArgb)
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(category) },
                label = { Text(categoryLabel(category, strings)) },
                leadingIcon = {
                    Icon(categoryGlyph(category), contentDescription = null, size = IconSize.Sm)
                },
                colors =
                    FilterChipDefaults.filterChipColors(
                        selectedContainerColor = accent.copy(alpha = SELECTED_CONTAINER_ALPHA),
                        selectedLabelColor = accent,
                        selectedLeadingIconColor = accent,
                    ),
            )
        }
    }
}

/**
 * The editable-date control (web `<Input type="date" max={today}>`): a labelled, calendar-glyphed trigger that opens
 * a Material 3 date picker capped at today. The picked `YYYY-MM-DD` is raised through [onPick].
 */
@Composable
private fun AnnotationDateField(
    value: String,
    strings: AddAnnotationStrings,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var showPicker by remember { mutableStateOf(false) }
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        FieldLabelText(strings.date)
        Button(
            label = value.ifEmpty { strings.date },
            onClick = { showPicker = true },
            modifier = Modifier.semantics { contentDescription = strings.date },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            leadingIcon = AnnotationGlyphs.Calendar,
        )
    }
    if (showPicker) {
        AnnotationDatePickerDialog(
            initial = value,
            strings = strings,
            onDismiss = { showPicker = false },
            onConfirm = { picked ->
                showPicker = false
                onPick(picked)
            },
        )
    }
}

/** Material 3 date picker capped at today (web `max={toDateInputValue(new Date())}`), seeded from [initial]. */
@Composable
private fun AnnotationDatePickerDialog(
    initial: String,
    strings: AddAnnotationStrings,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val state =
        rememberDatePickerState(
            initialSelectedDateMillis = AddAnnotationDates.toEpochMillis(initial),
            selectableDates = NotInFuture,
        )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(
                label = strings.confirm,
                onClick = {
                    val millis = state.selectedDateMillis
                    if (millis != null) onConfirm(AddAnnotationDates.fromEpochMillis(millis)) else onDismiss()
                },
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(label = strings.cancel, onClick = onDismiss, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
    ) {
        DatePicker(state = state)
    }
}

/** Caps the date picker to today and earlier, mirroring the web `max` attribute. */
private object NotInFuture : SelectableDates {
    override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis <= System.currentTimeMillis()
}

private fun categoryLabel(
    category: AnnotationCategory,
    strings: AddAnnotationStrings,
): String =
    when (category) {
        AnnotationCategory.Milestone -> strings.milestone
        AnnotationCategory.Maintenance -> strings.maintenance
        AnnotationCategory.Trip -> strings.trip
        AnnotationCategory.Issue -> strings.issue
        AnnotationCategory.Upgrade -> strings.upgrade
        AnnotationCategory.Custom -> strings.custom
    }

private fun categoryGlyph(category: AnnotationCategory): ImageVector =
    when (category) {
        AnnotationCategory.Milestone -> AnnotationGlyphs.Flag
        AnnotationCategory.Maintenance -> AnnotationGlyphs.Wrench
        AnnotationCategory.Trip -> AnnotationGlyphs.MapPin
        AnnotationCategory.Issue -> AnnotationGlyphs.AlertTriangle
        AnnotationCategory.Upgrade -> AnnotationGlyphs.ArrowUpCircle
        AnnotationCategory.Custom -> AnnotationGlyphs.Tag
    }

/**
 * The per-category line glyphs (web lucide `Flag`/`Wrench`/`MapPin`/`AlertTriangle`/`ArrowUpCircle`/`Tag`) plus the
 * date-field calendar mark, authored as 24×24 stroked [ImageVector]s — the same self-authored approach the shared
 * `TeslaGlyphs` / `DataDisplayGlyphs` sets use (Android has no bundled lucide set). Each is monochrome and recoloured
 * at render time by the [Icon] tint, so they inherit the category accent automatically.
 */
private object AnnotationGlyphs {
    val Flag: ImageVector =
        stroked("Flag") {
            moveTo(6f, 21f)
            lineTo(6f, 4f)
            moveTo(6f, 4.5f)
            lineTo(18f, 7.5f)
            lineTo(6f, 10.5f)
        }
    val Wrench: ImageVector =
        stroked("Wrench") {
            moveTo(5f, 19f)
            lineTo(12.5f, 11.5f)
            moveTo(12.5f, 11.5f)
            lineTo(10.5f, 9.5f)
            lineTo(13.5f, 5.5f)
            lineTo(18.5f, 5.5f)
            lineTo(18.5f, 10.5f)
            lineTo(14.5f, 13.5f)
            close()
        }
    val MapPin: ImageVector =
        stroked("MapPin") {
            moveTo(12f, 21f)
            curveTo(12f, 21f, 5f, 14.5f, 5f, 9.5f)
            curveTo(5f, 5.6f, 8.1f, 3f, 12f, 3f)
            curveTo(15.9f, 3f, 19f, 5.6f, 19f, 9.5f)
            curveTo(19f, 14.5f, 12f, 21f, 12f, 21f)
            close()
            moveTo(12f, 9.5f)
            lineTo(12.1f, 9.5f)
        }
    val AlertTriangle: ImageVector =
        stroked("AlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12.1f, 16.5f)
        }
    val ArrowUpCircle: ImageVector =
        stroked("ArrowUpCircle") {
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, false, true, 21f, 12f)
            arcTo(9f, 9f, 0f, false, true, 3f, 12f)
            close()
            moveTo(12f, 16f)
            lineTo(12f, 8f)
            moveTo(8.5f, 11.5f)
            lineTo(12f, 8f)
            lineTo(15.5f, 11.5f)
        }
    val Tag: ImageVector =
        stroked("Tag") {
            moveTo(4f, 4f)
            lineTo(12f, 4f)
            lineTo(20f, 12f)
            lineTo(12f, 20f)
            lineTo(4f, 12f)
            close()
            moveTo(8f, 8f)
            lineTo(8.1f, 8f)
        }
    val Calendar: ImageVector =
        stroked("Calendar") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(4f, 10f)
            lineTo(20f, 10f)
            moveTo(8f, 4f)
            lineTo(8f, 7f)
            moveTo(16f, 4f)
            lineTo(16f, 7f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    AddAnnotationStrings(
        title = "Add Annotation",
        close = "Close",
        date = "Date",
        label = "Label",
        labelHint = "e.g., Battery replaced",
        category = "Category",
        milestone = "Milestone",
        maintenance = "Maintenance",
        trip = "Trip",
        issue = "Issue",
        upgrade = "Upgrade",
        custom = "Custom",
        description = "Description",
        descriptionHint = "Optional description...",
        cancel = "Cancel",
        add = "Add Annotation",
        confirm = "Confirm",
    )

@Preview(name = "AddAnnotationPopover — fixed date", showBackground = true)
@Composable
private fun AddAnnotationFixedDatePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddAnnotationPopoverContent(
            timestamp = "2026-01-15T00:00:00Z",
            editableDate = false,
            strings = PREVIEW_STRINGS,
            onAdd = {},
            onCancel = {},
        )
    }
}

@Preview(name = "AddAnnotationPopover — editable date", showBackground = true)
@Composable
private fun AddAnnotationEditableDatePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddAnnotationPopoverContent(
            timestamp = "2026-01-15T00:00:00Z",
            editableDate = true,
            strings = PREVIEW_STRINGS,
            onAdd = {},
            onCancel = {},
        )
    }
}
