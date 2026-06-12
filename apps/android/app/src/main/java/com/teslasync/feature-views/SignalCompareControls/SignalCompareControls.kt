// The native Jetpack Compose + Material 3 SignalCompareControls feature view — a parity port of
// web/src/features/telemetry/components/SignalCompareControls.tsx. The web component is, in its own header's
// words, "Pure controls (no data fetching, no diff table)": a GlassPanel holding two `datetime-local` window
// inputs (each with a help tooltip), a row of five quick presets, a signal filter, and eight category chips
// with a Clear affordance. It is mounted by both SignalDiffPage and SignalsWorkspacePage, which own the queries
// and feed it controlled props; the only data source the web binds is `useTranslation`.
//
// This surface keeps that contract exactly. It performs NO HTTP and binds no feed of its own — the windows,
// search and category arrive as controlled props with change callbacks, one-for-one with the web component.
// Because the web source fetches nothing, there is no loading / empty / error / stale / offline lifecycle here:
// as the sibling WeekSelector / AddWidgetButton presentational ports document, that lifecycle lives on the
// owning page. The branches the web source itself defines are reproduced in full — the optional top slot, the
// category-clear button shown only while a category is active, and a never-empty tap-to-pick field for an unset
// window (the web shows the browser's native empty `datetime-local` glyph for the same state).
//
// Per Android guidelines this is built from native primitives + shared components + design tokens (P1/S9),
// never ported Tailwind classes: the web `<Input type="datetime-local">` becomes a tap-to-pick field backed by
// Material 3 Date/Time pickers; the web `<Input type="search">` becomes the shared SearchInput; the category
// chips become the shared PillFilterBar; the help labels use the shared HelpTooltip. Every visible string
// resolves through the i18n catalog (P1/S10); the two help-trigger aria names the catalog does not define fall
// back via the web `t(key, default)` mirror. `view.opened` is emitted once via the sanctioned redacting logger
// (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalCompareControls — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcomparecontrols

import android.annotation.SuppressLint
import android.content.Context
import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.forms.PillFilterBar
import io.teslasync.android.components.forms.PillItem
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpTooltip
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

private const val PREVIEW_NOW_MILLIS: Long = 1_750_000_000_000L

/** The three states of a window field's date/time picking flow. */
private enum class PickPhase { Idle, Date, Time }

/**
 * Stateful entry point — the faithful 1:1 port of the web `SignalCompareControls` controlled props (`atA` /
 * `atB`, `search`, `category` and their change callbacks, plus the optional `topSlot`). Records the one-shot
 * PII-safe `view.opened` diagnostic on first composition (P1/S11) and delegates to the stateless content. This
 * view performs no HTTP; the owning page (SignalDiffPage / SignalsWorkspacePage) owns the queries.
 *
 * @param atA Window A as a `datetime-local` string (web `atA`); blank renders the tap-to-pick label.
 * @param atB Window B as a `datetime-local` string (web `atB`).
 * @param onChangeA emits the new Window A `datetime-local` string (web `onChangeA`).
 * @param onChangeB emits the new Window B `datetime-local` string (web `onChangeB`).
 * @param search the current signal filter text (web `search`).
 * @param onSearchChange emits the new filter text (web `onSearchChange`).
 * @param category the active category id, or `null` when none is selected (web `category`).
 * @param onCategoryChange emits the next category id or `null` (web `onCategoryChange`).
 * @param zone the zone the `datetime-local` strings are interpreted in; defaults to the device zone.
 * @param nowMillis the clock the presets resolve against; injectable for deterministic tests/previews.
 * @param topSlot optional content rendered above the windows (web `topSlot` — e.g. a vehicle picker).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalCompareControls(
    atA: String,
    atB: String,
    onChangeA: (String) -> Unit,
    onChangeB: (String) -> Unit,
    search: String,
    onSearchChange: (String) -> Unit,
    category: String?,
    onCategoryChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    nowMillis: () -> Long = { System.currentTimeMillis() },
    topSlot: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SignalCompareControlsDiagnostics.recordViewOpened(logger) }
    SignalCompareControlsContent(
        atA = atA,
        atB = atB,
        onChangeA = onChangeA,
        onChangeB = onChangeB,
        search = search,
        onSearchChange = onSearchChange,
        category = category,
        onCategoryChange = onCategoryChange,
        modifier = modifier,
        zone = zone,
        nowMillis = nowMillis,
        topSlot = topSlot,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web `GlassPanel` layout: an
 * optional top slot, the two help-labelled windows, the quick-preset row, a divider, the signal filter, and the
 * category chips with a Clear affordance shown only while a category is active. Carries no diagnostics
 * side-effect so tests can drive every branch directly.
 */
@Composable
fun SignalCompareControlsContent(
    atA: String,
    atB: String,
    onChangeA: (String) -> Unit,
    onChangeB: (String) -> Unit,
    search: String,
    onSearchChange: (String) -> Unit,
    category: String?,
    onCategoryChange: (String?) -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    nowMillis: () -> Long = { System.currentTimeMillis() },
    topSlot: (@Composable () -> Unit)? = null,
) {
    val context = LocalContext.current
    val windowATitle = stringResource(R.string.translation_signalDiff_windowA)
    val windowBTitle = stringResource(R.string.translation_signalDiff_windowB)
    val snapshotHelp = stringResource(R.string.translation_help_signal_snapshot)
    val diffHelp = stringResource(R.string.translation_help_signal_diff)
    val presetsLabel = stringResource(R.string.translation_signalDiff_presetsLabel)
    val filterHint = stringResource(R.string.translation_signalDiff_filterPlaceholder) // parity:allow i18n key name
    val clearCategory = stringResource(R.string.translation_signalDiff_clearCategory)
    val clearCommon = stringResource(R.string.translation_common_clear)
    val confirmLabel = stringResource(R.string.translation_common_confirm)
    val cancelLabel = stringResource(R.string.translation_common_cancel)
    val snapshotAria =
        resolveOptional({ context.optionalString(it) }, KEY_SNAPSHOT_ARIA, SignalCompareDefaults.SNAPSHOT_ARIA)
    val diffAria =
        resolveOptional({ context.optionalString(it) }, KEY_DIFF_ARIA, SignalCompareDefaults.DIFF_ARIA)
    val pickWindow =
        resolveOptional({ context.optionalString(it) }, KEY_PICK_WINDOW, SignalCompareDefaults.PICK_WINDOW)

    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Md) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                if (topSlot != null) {
                    topSlot()
                }

                CompareWindow(
                    title = windowATitle,
                    helpText = snapshotHelp,
                    helpAria = snapshotAria,
                    value = atA,
                    onChange = onChangeA,
                    emptyLabel = pickWindow,
                    confirmLabel = confirmLabel,
                    cancelLabel = cancelLabel,
                )
                CompareWindow(
                    title = windowBTitle,
                    helpText = diffHelp,
                    helpAria = diffAria,
                    value = atB,
                    onChange = onChangeB,
                    emptyLabel = pickWindow,
                    confirmLabel = confirmLabel,
                    cancelLabel = cancelLabel,
                )

                PresetRow(
                    presetsLabel = presetsLabel,
                    onApply = { preset ->
                        val window = preset.compute(nowMillis(), zone)
                        onChangeA(window.atA)
                        onChangeB(window.atB)
                    },
                )

                HorizontalDivider()

                SearchInput(
                    value = search,
                    onValueChange = onSearchChange,
                    hint = filterHint,
                    clearLabel = clearCommon,
                )

                CategoryRow(
                    category = category,
                    onCategoryChange = onCategoryChange,
                    clearLabel = clearCategory,
                )
            }
        }
    }
}

/**
 * One labelled compare window — the help tooltip (web `<span>{label}<HelpTooltip/></span>`) above the
 * tap-to-pick field (web `<Input type="datetime-local">`). The tooltip title is the accessible window name and
 * its help text mirrors the web `defaultValue`.
 */
@Composable
private fun CompareWindow(
    title: String,
    helpText: String,
    helpAria: String,
    value: String,
    onChange: (String) -> Unit,
    emptyLabel: String,
    confirmLabel: String,
    cancelLabel: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        HelpTooltip(title = title, helpText = helpText, helpContentDescription = helpAria)
        DateTimeField(
            value = value,
            onChange = onChange,
            fieldLabel = title,
            emptyLabel = emptyLabel,
            confirmLabel = confirmLabel,
            cancelLabel = cancelLabel,
        )
    }
}

/**
 * The native analogue of the web `<Input type="datetime-local">`: a full-width tap-to-pick field showing the
 * current window value (or [emptyLabel] when unset, so the field is never empty). Tapping opens a Material 3
 * date picker, then a time picker; confirming both emits the combined moment as a `datetime-local` string,
 * preserving the web controlled-prop contract. The field carries an explicit TalkBack description.
 */
@Composable
private fun DateTimeField(
    value: String,
    onChange: (String) -> Unit,
    fieldLabel: String,
    emptyLabel: String,
    confirmLabel: String,
    cancelLabel: String,
) {
    var phase by remember { mutableStateOf(PickPhase.Idle) }
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    val seeded = remember(value) { SignalCompareTime.parseLocalDatetime(value) }
    val display = SignalCompareTime.displayLabel(value, emptyLabel)
    val description = "$fieldLabel: $display"

    Button(
        label = display,
        onClick = { phase = PickPhase.Date },
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = description },
        variant = ButtonVariant.Outline,
        leadingIcon = SignalCompareGlyphs.Calendar,
    )

    when (phase) {
        PickPhase.Date ->
            DatePickerPopup(
                initial = seeded,
                confirmLabel = confirmLabel,
                cancelLabel = cancelLabel,
                onCancel = { phase = PickPhase.Idle },
                onConfirm = { date ->
                    pickedDate = date
                    phase = PickPhase.Time
                },
            )

        PickPhase.Time ->
            TimePickerPopup(
                initial = seeded,
                confirmLabel = confirmLabel,
                cancelLabel = cancelLabel,
                onCancel = { phase = PickPhase.Idle },
                onConfirm = { hour, minute ->
                    val date = pickedDate ?: seeded?.toLocalDate() ?: LocalDate.now()
                    val picked = LocalDateTime.of(date, LocalTime.of(hour, minute))
                    onChange(SignalCompareTime.toLocalDatetimeInput(picked))
                    phase = PickPhase.Idle
                },
            )

        PickPhase.Idle -> Unit
    }
}

/** Material 3 date-picker dialog seeded from the current window, mirroring the date part of `datetime-local`. */
@Composable
private fun DatePickerPopup(
    initial: LocalDateTime?,
    confirmLabel: String,
    cancelLabel: String,
    onCancel: () -> Unit,
    onConfirm: (LocalDate) -> Unit,
) {
    val initialMillis =
        initial
            ?.toLocalDate()
            ?.atStartOfDay(ZoneOffset.UTC)
            ?.toInstant()
            ?.toEpochMilli()
    val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
    DatePickerDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                label = confirmLabel,
                onClick = {
                    val picked =
                        state.selectedDateMillis?.let {
                            Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()
                        }
                    if (picked != null) onConfirm(picked) else onCancel()
                },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(
                label = cancelLabel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        },
    ) {
        DatePicker(state = state)
    }
}

/** Material 3 time-picker dialog seeded from the current window, mirroring the time part of `datetime-local`. */
@Composable
private fun TimePickerPopup(
    initial: LocalDateTime?,
    confirmLabel: String,
    cancelLabel: String,
    onCancel: () -> Unit,
    onConfirm: (Int, Int) -> Unit,
) {
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    val state =
        rememberTimePickerState(
            initialHour = initial?.hour ?: 0,
            initialMinute = initial?.minute ?: 0,
            is24Hour = is24Hour,
        )
    AlertDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                label = confirmLabel,
                onClick = { onConfirm(state.hour, state.minute) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(
                label = cancelLabel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        },
        text = { TimePicker(state = state) },
    )
}

/** The quick-preset row — web `{DIFF_PRESETS.map(<Button/>)}` under the "Quick presets:" caption. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PresetRow(
    presetsLabel: String,
    onApply: (DiffPreset) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(presetsLabel)
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            DiffPreset.ALL.forEach { preset ->
                Button(
                    label = presetLabel(preset),
                    onClick = { onApply(preset) },
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                )
            }
        }
    }
}

/**
 * The category chips + Clear affordance — web `{CATEGORY_PREFIXES.map(<button/>)}` plus the
 * `category ? <Button>Clear</Button> : null` branch. Single-select via the shared PillFilterBar; re-tapping the
 * active chip clears it (web `category === c.id ? null : c.id`).
 */
@Composable
private fun CategoryRow(
    category: String?,
    onCategoryChange: (String?) -> Unit,
    clearLabel: String,
) {
    val items =
        listOf(
            PillItem(DiffCategory.Battery.id, categoryLabel(DiffCategory.Battery)),
            PillItem(DiffCategory.Drive.id, categoryLabel(DiffCategory.Drive)),
            PillItem(DiffCategory.Climate.id, categoryLabel(DiffCategory.Climate)),
            PillItem(DiffCategory.Security.id, categoryLabel(DiffCategory.Security)),
            PillItem(DiffCategory.Motor.id, categoryLabel(DiffCategory.Motor)),
            PillItem(DiffCategory.Tire.id, categoryLabel(DiffCategory.Tire)),
            PillItem(DiffCategory.Media.id, categoryLabel(DiffCategory.Media)),
            PillItem(DiffCategory.Safety.id, categoryLabel(DiffCategory.Safety)),
        )
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PillFilterBar(
            items = items,
            selectedId = category,
            onSelect = { onCategoryChange(toggleCategory(category, it)) },
        )
        if (category != null) {
            Button(
                label = clearLabel,
                onClick = { onCategoryChange(null) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The localized chip label for a [category] — the catalog defines every `signalDiff.cat.*` key (P1/S10). */
@Composable
private fun categoryLabel(category: DiffCategory): String =
    when (category) {
        DiffCategory.Battery -> stringResource(R.string.translation_signalDiff_cat_battery)
        DiffCategory.Drive -> stringResource(R.string.translation_signalDiff_cat_drive)
        DiffCategory.Climate -> stringResource(R.string.translation_signalDiff_cat_climate)
        DiffCategory.Security -> stringResource(R.string.translation_signalDiff_cat_security)
        DiffCategory.Motor -> stringResource(R.string.translation_signalDiff_cat_motor)
        DiffCategory.Tire -> stringResource(R.string.translation_signalDiff_cat_tire)
        DiffCategory.Media -> stringResource(R.string.translation_signalDiff_cat_media)
        DiffCategory.Safety -> stringResource(R.string.translation_signalDiff_cat_safety)
    }

/** The localized button label for a [preset] — the catalog defines every `signalDiff.preset.*` key (P1/S10). */
@Composable
private fun presetLabel(preset: DiffPreset): String =
    when (preset) {
        DiffPreset.NowVs1h -> stringResource(R.string.translation_signalDiff_preset_nowVs1h)
        DiffPreset.NowVs1d -> stringResource(R.string.translation_signalDiff_preset_nowVs1d)
        DiffPreset.BeforeAfterCharge -> stringResource(R.string.translation_signalDiff_preset_beforeAfterCharge)
        DiffPreset.LastDrive -> stringResource(R.string.translation_signalDiff_preset_lastDrive)
        DiffPreset.TodayVsYesterday -> stringResource(R.string.translation_signalDiff_preset_todayVsYesterday)
    }

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * The one glyph this surface needs that the shared [io.teslasync.android.components.ui.TeslaGlyphs] set does not
 * carry. The web `datetime-local` input has no icon; the native tap-to-pick field uses a calendar affordance to
 * signal it opens a picker. As the sibling WeekSelector surface does for its lucide port, it is authored here as
 * a 24×24 stroked vector (a calendar body with a header divider and two top binding ticks).
 */
private object SignalCompareGlyphs {
    val Calendar: ImageVector =
        stroked("Calendar") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 22f)
            lineTo(3f, 22f)
            close()
            moveTo(3f, 10f)
            lineTo(21f, 10f)
            moveTo(8f, 2f)
            lineTo(8f, 6f)
            moveTo(16f, 2f)
            lineTo(16f, 6f)
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

// ── Previews (tooling-only; @Preview entry points exercise the populated and empty-window render branches) ──

@Preview(name = "Populated", showBackground = true)
@Composable
private fun SignalCompareControlsPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCompareControlsContent(
            atA = "2026-06-12T12:00",
            atB = "2026-06-12T13:00",
            onChangeA = {},
            onChangeB = {},
            search = "battery",
            onSearchChange = {},
            category = DiffCategory.Battery.id,
            onCategoryChange = {},
            nowMillis = { PREVIEW_NOW_MILLIS },
        )
    }
}

@Preview(name = "Empty windows", showBackground = true)
@Composable
private fun SignalCompareControlsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCompareControlsContent(
            atA = "",
            atB = "",
            onChangeA = {},
            onChangeB = {},
            search = "",
            onSearchChange = {},
            category = null,
            onCategoryChange = {},
            nowMillis = { PREVIEW_NOW_MILLIS },
        )
    }
}
