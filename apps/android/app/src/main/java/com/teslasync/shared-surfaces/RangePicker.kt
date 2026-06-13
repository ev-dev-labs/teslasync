// The native Jetpack Compose + Material 3 RangePicker shared surface — a parity port of
// web/src/components/forms/RangePicker.tsx. The web surface is a single-trigger date range filter: a compact
// trigger (always visible) shows the active preset label + the formatted committed range; clicking it opens a
// popover with a preset list (each preset applies immediately + closes + fires `onChange`), a range calendar
// that STAGES a selection (only `Apply` commits; `Cancel` / dismiss discards), an optional "Compare to previous
// period" toggle, and a footer day-count summary. The `presetsOnly` variant hides the calendar + footer.
//
// This native surface keeps that contract end to end while using platform-idiomatic primitives (spec rule 3 +
// the prompt's "the popover renders below md breakpoint as a bottom-pinned sheet … the internal layout collapses
// to a single column"): the trigger is the shared `ui/Button`; the panel is the shared `ui/Popover` containing
// the preset chips (a horizontally-scrolling row — the web mobile `overflow-x-auto` collapse), the committed
// day-count caption, the calendar entry, and the compare toggle; the range calendar itself is the Material 3
// `DateRangePicker` shown in the platform's `DatePickerDialog` (the HIG range-selection pattern), staged exactly
// like the web — `Apply` enabled only on a dirty staged range, `Cancel` / dismiss discards. Every preset / range
// / day-count / active-match / "All time" floor is folded by the pure RangePickerModel.kt so this file stays a
// thin render layer.
//
// It performs NO HTTP and binds NO data state holder: the web component fetches nothing — its only hook is
// `useTranslation` (the i18n catalog, P1/S10, resolved here at the render boundary). See RangePickerModel.kt for
// the honesty rationale and why the generic loading/empty/stale/offline/error states do not apply to a
// controlled input, plus the enumeration of the surface's REAL states (collapsed trigger, open preset list with
// active vs. custom, calendar with no staged selection → Apply disabled, calendar with a dirty staged range →
// Apply enabled, the presetsOnly variant, the compare-enabled variant) — every one of which is reproduced here
// and previewed/tested. Strings resolve through the i18n catalog (P1/S10); the trigger exposes a merged TalkBack
// label and every interactive element keeps an accessible name; a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) fires on first composition and the preset/custom/cancel/compare interactions emit PII-safe
// diagnostics carrying only constant identifiers, never the selected dates.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RangePicker) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderers + previews.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.rangepicker

import androidx.annotation.StringRes
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate
import java.util.Locale

/** Test tag identifying the always-visible trigger — used by the instrumented per-state + a11y UI tests. */
const val RANGE_PICKER_TRIGGER_TEST_TAG: String = "range-picker-trigger"

/** Test tag identifying the popover panel container. */
const val RANGE_PICKER_PANEL_TEST_TAG: String = "range-picker-panel"

/** Test tag identifying the "open calendar" entry button inside the panel. */
const val RANGE_PICKER_OPEN_CALENDAR_TEST_TAG: String = "range-picker-open-calendar"

/** Test tag identifying the compare toggle inside the panel. */
const val RANGE_PICKER_COMPARE_TEST_TAG: String = "range-picker-compare"

/** Test tag identifying the calendar dialog's Apply button. */
const val RANGE_PICKER_APPLY_TEST_TAG: String = "range-picker-apply"

/** Test tag identifying the calendar dialog's Cancel button. */
const val RANGE_PICKER_CANCEL_TEST_TAG: String = "range-picker-cancel"

private val POPOVER_MAX_WIDTH = 320.dp
private val CALENDAR_MAX_HEIGHT = 420.dp
private val TRIGGER_HEIGHT_SM = 36.dp
private val TRIGGER_HEIGHT_MD = 44.dp

/**
 * Stateful entry point — the faithful port of the web `RangePicker`. Renders the always-visible [RangePickerTrigger]
 * and, when open, the shared [Popover] containing the [RangePickerPanel]; the range calendar opens in a Material 3
 * [DatePickerDialog]. A preset click commits immediately (web `handlePreset` → `onChange(range, presetId)`); a
 * staged calendar range commits only on `Apply` (web `handleApply` → `onChange(range)`); `Cancel` / dismiss
 * discards (web `handleCancel`). Records the one-shot `view.opened` diagnostic on first composition.
 *
 * @param value the current committed ISO range (`YYYY-MM-DD`, inclusive) — the web `value` prop.
 * @param onChange called whenever the range is committed (preset click or Apply); the preset id is `null` for a
 *   custom Apply (web `onChange(value, presetId?)`).
 * @param presetIds the subset of preset ids to render, in canonical order (web `presetIds`).
 * @param minDate floor for "All time" + the earliest selectable date (web `minDate`).
 * @param maxDate latest selectable date; defaults to [today] (web `maxDate`).
 * @param enableCompare when true, show the "Compare to previous period" toggle (web `enableCompare`).
 * @param compare current value of the compare flag (web `compare`).
 * @param onCompareChange called when the compare toggle flips (web `onCompareChange`).
 * @param size trigger size on the shared Button scale (web `size`).
 * @param align popover horizontal alignment relative to the trigger (web `align`).
 * @param presetsOnly when true, hide the calendar + footer (web `presetsOnly`).
 * @param today the wall-clock day the presets resolve against; injected for deterministic tests.
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun RangePicker(
    value: RangePickerValue,
    onChange: (value: RangePickerValue, presetId: String?) -> Unit,
    modifier: Modifier = Modifier,
    presetIds: List<String> = RangePickerLogic.DEFAULT_PRESET_IDS,
    minDate: String? = null,
    maxDate: String? = null,
    enableCompare: Boolean = false,
    compare: Boolean = false,
    onCompareChange: (Boolean) -> Unit = {},
    size: ButtonSize = ButtonSize.Sm,
    align: Alignment.Horizontal = Alignment.Start,
    presetsOnly: Boolean = false,
    today: LocalDate = LocalDate.now(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RangePickerDiagnostics.recordViewOpened(logger) }

    var open by rememberSaveable { mutableStateOf(false) }
    var showCalendar by rememberSaveable { mutableStateOf(false) }

    val locale: Locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()
    val display = RangePickerProjection.project(value, today, locale)
    val triggerName = stringResource(R.string.translation_date_range_trigger)
    val activeLabel =
        if (display.activePresetId != null) {
            stringResource(presetLabelRes(display.activePresetId))
        } else {
            stringResource(R.string.translation_date_range_pickRange)
        }

    val popoverOffsetPx = with(LocalDensity.current) { triggerHeight(size).roundToPx() }

    Box(modifier = modifier) {
        RangePickerTrigger(
            activeLabel = activeLabel,
            rangeText = display.rangeText,
            accessibleName =
                RangePickerLogic.triggerAccessibilityLabel(triggerName, activeLabel, display.rangeText),
            size = size,
            onClick = { open = !open },
        )

        Popover(
            expanded = open,
            onDismissRequest = { open = false },
            alignment = if (align == Alignment.End) Alignment.TopEnd else Alignment.TopStart,
            offset = IntOffset(0, popoverOffsetPx),
            accessibleName = stringResource(R.string.translation_date_range_popoverLabel),
        ) {
            RangePickerPanel(
                presets = RangePickerLogic.presetsFor(presetIds),
                activePresetId = display.activePresetId,
                totalDays = display.totalDays,
                presetsOnly = presetsOnly,
                enableCompare = enableCompare,
                compare = compare,
                onPick = { id ->
                    val range = RangePickerLogic.appliedRangeForPreset(id, today, minDate)
                    if (range != null) {
                        RangePickerDiagnostics.recordPresetApplied(logger, id)
                        open = false
                        onChange(range, id)
                    }
                },
                onOpenCalendar = { showCalendar = true },
                onCompareChange = { next ->
                    RangePickerDiagnostics.recordCompareToggled(logger, next)
                    onCompareChange(next)
                },
            )
        }
    }

    if (showCalendar && !presetsOnly) {
        RangeCalendarDialog(
            value = value,
            today = today,
            minDate = minDate,
            maxDate = maxDate,
            onApply = { committed ->
                RangePickerDiagnostics.recordCustomApplied(logger)
                showCalendar = false
                open = false
                onChange(committed, null)
            },
            onDismiss = {
                RangePickerDiagnostics.recordCanceled(logger)
                showCalendar = false
            },
        )
    }
}

/**
 * Stateless trigger renderer — the always-visible control (web `<button>`), and a snapshot/preview/test entry
 * point. Shows a calendar glyph, the [activeLabel] (the active preset or "Custom range"), the formatted
 * [rangeText] sub-label, and a chevron, exposed to TalkBack as the merged [accessibleName] so the trigger is
 * never an unlabelled tap target.
 */
@Composable
fun RangePickerTrigger(
    activeLabel: String,
    rangeText: String,
    accessibleName: String,
    modifier: Modifier = Modifier,
    size: ButtonSize = ButtonSize.Sm,
    onClick: () -> Unit = {},
) {
    Button(
        onClick = onClick,
        modifier =
            modifier
                .testTag(RANGE_PICKER_TRIGGER_TEST_TAG)
                .semantics(mergeDescendants = true) {
                    contentDescription = accessibleName
                    role = Role.Button
                },
        variant = ButtonVariant.Outline,
        size = size,
    ) {
        Icon(imageVector = FormsGlyphs.Calendar, contentDescription = null, size = IconSize.Sm)
        Spacer(Modifier.width(Spacing.xs))
        Text(
            text = activeLabel,
            style = MaterialTheme.typography.labelLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(Spacing.xs))
        Text(
            text = rangeText,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(Spacing.xs))
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * Stateless popover panel — the inner content of the open popover (web the popover's `<div>`), and a
 * snapshot/preview/test entry point that renders without a [Popover] host. Shows the horizontally-scrolling
 * preset list (each chip applies via [onPick]; the active one is highlighted + `selected`), and — unless
 * [presetsOnly] — the committed [totalDays] caption, the calendar entry ([onOpenCalendar]), and (when
 * [enableCompare]) the compare toggle ([onCompareChange]).
 */
@Composable
fun RangePickerPanel(
    presets: List<DatePresetSpec>,
    activePresetId: String?,
    totalDays: Int,
    modifier: Modifier = Modifier,
    presetsOnly: Boolean = false,
    enableCompare: Boolean = false,
    compare: Boolean = false,
    onPick: (String) -> Unit = {},
    onOpenCalendar: () -> Unit = {},
    onCompareChange: (Boolean) -> Unit = {},
) {
    Column(
        modifier = modifier.widthIn(max = POPOVER_MAX_WIDTH).testTag(RANGE_PICKER_PANEL_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PresetChips(presets = presets, activePresetId = activePresetId, onPick = onPick)

        if (!presetsOnly) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

            Text(
                text = pluralStringResource(R.plurals.translation_date_range_summaryDays, totalDays, totalDays),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Button(
                label = stringResource(R.string.translation_date_range_pickRange),
                onClick = onOpenCalendar,
                modifier = Modifier.fillMaxWidth().testTag(RANGE_PICKER_OPEN_CALENDAR_TEST_TAG),
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = FormsGlyphs.Calendar,
            )

            if (enableCompare) {
                Checkbox(
                    checked = compare,
                    onCheckedChange = onCompareChange,
                    modifier = Modifier.testTag(RANGE_PICKER_COMPARE_TEST_TAG),
                    label = stringResource(R.string.translation_date_range_compare),
                )
            }
        }
    }
}

/** The horizontally-scrolling preset chip row (web preset `role="listbox"`, mobile `overflow-x-auto`). */
@Composable
private fun PresetChips(
    presets: List<DatePresetSpec>,
    activePresetId: String?,
    onPick: (String) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()).selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        presets.forEach { preset ->
            val active = preset.id == activePresetId
            Button(
                label = stringResource(presetLabelRes(preset.id)),
                onClick = { onPick(preset.id) },
                modifier = Modifier.semantics { selected = active },
                variant = if (active) ButtonVariant.Primary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The Material 3 range calendar in a [DatePickerDialog] (the HIG range-selection pattern) — the native analogue
 * of the web popover's `DayPicker`. Seeds the staged selection from the committed [value], bounds it to
 * [[minDate], [maxDate]] (web `fromDate`/`toDate`), shows the staged day-count headline, and commits via
 * [onApply] only when the staged range is complete + dirty (web `Apply` disabled on a clean range); [onDismiss]
 * discards (web `Cancel` / click-outside / Esc).
 */
@Composable
private fun RangeCalendarDialog(
    value: RangePickerValue,
    today: LocalDate,
    minDate: String?,
    maxDate: String?,
    onApply: (RangePickerValue) -> Unit,
    onDismiss: () -> Unit,
) {
    val maxLocal = maxDate?.let(RangePickerLogic::dateOf) ?: today
    val minLocal = minDate?.let(RangePickerLogic::dateOf) ?: RangePickerLogic.dateOf(RangePickerLogic.ALL_TIME_BASELINE)
    val selectable = rememberRangeSelectableDates(minDate, maxLocal)
    val state =
        rememberDateRangePickerState(
            initialSelectedStartDateMillis = RangePickerLogic.isoToUtcMillis(value.start),
            initialSelectedEndDateMillis = RangePickerLogic.isoToUtcMillis(value.end),
            yearRange = minLocal.year..maxLocal.year,
            selectableDates = selectable,
        )

    val stagedStart = state.selectedStartDateMillis?.let(RangePickerLogic::utcMillisToIso)
    val stagedEnd = state.selectedEndDateMillis?.let(RangePickerLogic::utcMillisToIso)
    val dirty = RangePickerLogic.stagedIsDirty(stagedStart, stagedEnd, value)

    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(
                label = stringResource(R.string.translation_date_range_apply),
                onClick = { if (stagedStart != null && stagedEnd != null) onApply(RangePickerValue(stagedStart, stagedEnd)) },
                modifier = Modifier.testTag(RANGE_PICKER_APPLY_TEST_TAG),
                enabled = dirty,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(
                label = stringResource(R.string.translation_date_range_cancel),
                onClick = onDismiss,
                modifier = Modifier.testTag(RANGE_PICKER_CANCEL_TEST_TAG),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        },
    ) {
        DateRangePicker(
            state = state,
            modifier = Modifier.heightIn(max = CALENDAR_MAX_HEIGHT),
            title = null,
            headline = { RangeCalendarHeadline(stagedStart, stagedEnd) },
            showModeToggle = false,
        )
    }
}

/** The staged day-count headline inside the range calendar (web footer `{{count}} days`). */
@Composable
private fun RangeCalendarHeadline(
    stagedStart: String?,
    stagedEnd: String?,
) {
    val days = RangePickerLogic.stagedDayCount(stagedStart, stagedEnd)
    val text =
        if (days != null) {
            pluralStringResource(R.plurals.translation_date_range_summaryDays, days, days)
        } else {
            stringResource(R.string.translation_date_range_pickRange)
        }
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(horizontal = Spacing.xl2, vertical = Spacing.md),
    )
}

/** A [SelectableDates] bounding selection to `[minDate, maxDate]` (web `fromDate`/`toDate`). */
@Composable
private fun rememberRangeSelectableDates(
    minDate: String?,
    maxLocal: LocalDate,
): SelectableDates {
    val minMillis = minDate?.let(RangePickerLogic::isoToUtcMillis)
    val maxMillis = RangePickerLogic.isoToUtcMillis(RangePickerLogic.iso(maxLocal))
    return remember(minMillis, maxMillis) {
        object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean =
                (minMillis == null || utcTimeMillis >= minMillis) && utcTimeMillis <= maxMillis
        }
    }
}

@StringRes
private fun presetLabelRes(id: String): Int =
    when (id) {
        "today" -> R.string.translation_date_preset_today
        "yesterday" -> R.string.translation_date_preset_yesterday
        "7d" -> R.string.translation_date_preset_last7
        "30d" -> R.string.translation_date_preset_last30
        "90d" -> R.string.translation_date_preset_last90
        "mtd" -> R.string.translation_date_preset_mtd
        "qtd" -> R.string.translation_date_preset_qtd
        "ytd" -> R.string.translation_date_preset_ytd
        "lastMonth" -> R.string.translation_date_preset_lastMonth
        "1y" -> R.string.translation_date_preset_last1y
        "all" -> R.string.translation_date_preset_all
        else -> R.string.translation_date_range_pickRange
    }

private fun triggerHeight(size: ButtonSize): Dp =
    if (size == ButtonSize.Md || size == ButtonSize.Lg) TRIGGER_HEIGHT_MD else TRIGGER_HEIGHT_SM

// ── Previews (tooling-only; the sample ranges are never shipped UI) ───────────────────────────────────────

private val PREVIEW_PRESETS: List<DatePresetSpec> = RangePickerLogic.presetsFor(RangePickerLogic.DEFAULT_PRESET_IDS)

@Preview(name = "RangePicker · trigger (active preset)", showBackground = true)
@Composable
private fun RangePickerTriggerActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangePickerTrigger(activeLabel = "Last 7 days", rangeText = "Jan 1 – Jan 7, 2024", accessibleName = "Date range")
    }
}

@Preview(name = "RangePicker · trigger (custom range)", showBackground = true)
@Composable
private fun RangePickerTriggerCustomPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangePickerTrigger(activeLabel = "Custom range", rangeText = "Jan 3 – Feb 9, 2024", accessibleName = "Date range")
    }
}

@Preview(name = "RangePicker · panel (presets + calendar entry + compare)", showBackground = true)
@Composable
private fun RangePickerPanelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangePickerPanel(
            presets = PREVIEW_PRESETS,
            activePresetId = "7d",
            totalDays = 7,
            enableCompare = true,
            compare = true,
        )
    }
}

@Preview(name = "RangePicker · panel (presetsOnly)", showBackground = true)
@Composable
private fun RangePickerPanelPresetsOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RangePickerPanel(presets = PREVIEW_PRESETS, activePresetId = "30d", totalDays = 30, presetsOnly = true)
    }
}
