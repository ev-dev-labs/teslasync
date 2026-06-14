// The native Jetpack Compose + Material 3 SignalQueryControls shared surface — a parity port of
// web/src/components/SignalQueryControls.tsx, the reusable query toolkit the Signal Log Viewer + Signal
// Explorer pages share. The web module bundles a signal multi-select bound to `GET /signals/available` (its one
// `useQuery`), a `datetime-local` From/To range with five quick presets, a rows-per-page + Query control, and a
// typed results table (#, timestamp, color-coded value, type badge) with server-side pagination. This native
// surface reproduces that whole composition end to end and renders every state the prompt's matrix mandates
// without ever hiding a region: the picker's first-fetch skeleton (loading), the selectable chips + multi-
// select (content), the resolved-but-no-signals note (empty), a classified error with Retry, and the
// stale/offline freshness chip over a cached signal list.
//
// It performs NO HTTP and binds the available-signals feed only through the shared S8/S7 Telemetry seam
// ([SignalQueryControlsSource]) folded through [SignalQueryControlsViewModel] + the pure
// [SignalQueryControlsProjection]; the query state (selected signals, From/To range, page size, the loaded page
// of rows) stays controlled by the host, one-for-one with the web pages that own the server-side query. Per
// Android guidelines the UI is built from native primitives + shared components + design tokens (P1/S9), never
// ported Tailwind classes: the web `<Input type="datetime-local">` becomes a tap-to-pick field backed by
// Material 3 Date/Time pickers; the web custom select dropdown becomes the shared ComboboxMulti; the rows
// select becomes the shared Select; the table becomes the shared DataTable + Pagination. Every visible string
// resolves through the i18n catalog (P1/S10). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SignalQueryControls) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.signalquerycontrols

import android.text.format.DateFormat
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.ComboboxMulti
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

/** Test tag on the surface root so on-device UI tests can locate the rendered toolkit in any state. */
const val SIGNAL_QUERY_CONTROLS_TEST_TAG: String = "signal-query-controls"

/** Test tag on the signal-picker region so on-device UI tests can assert its per-state surface. */
const val SIGNAL_QUERY_PICKER_TAG: String = "signal-query-picker"

/** Test tag on the results table so on-device UI tests can assert the rendered rows. */
const val SIGNAL_QUERY_TABLE_TAG: String = "signal-query-table"

private val PICKER_SKELETON_HEIGHT = 44.dp
private val ROWS_SELECT_WIDTH = 132.dp
private const val INDEX_HEADER = "#"
private const val INDEX_WEIGHT = 0.6f
private const val TIME_WEIGHT = 2.2f
private const val SIGNAL_WEIGHT = 2.2f
private const val VALUE_WEIGHT = 1.6f
private const val TYPE_WEIGHT = 1.1f
private const val TABLE_SKELETON_ROWS = 5
private val TABLE_SKELETON_HEIGHT = 32.dp

/**
 * Stateful entry point — the parity composition of the web `SignalQueryControls.tsx` toolkit. Binds the shared
 * available-signals feed via [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, collects the [io.teslasync.android.data.UiState], projects it, auto-refreshes a stale cache, and
 * renders. The query state stays owned by the host: the picker reports the next selection through
 * [onSelectedSignalsChange]; the range, page size, page, and Query action are controlled callbacks.
 *
 * @param viewModel the state holder bound to the shared S8 TelemetryStore / S7 TelemetryRepository seam.
 * @param selectedSignals the controlled signal selection (web `selected`).
 * @param onSelectedSignalsChange invoked with the next selection when a signal is toggled or removed.
 * @param fromValue the controlled From `datetime-local` window (web `fromStr`).
 * @param toValue the controlled To `datetime-local` window (web `toStr`).
 * @param onFromChange invoked with the next From window (web `onFromChange`).
 * @param onToChange invoked with the next To window (web `onToChange`).
 * @param perPage the controlled rows-per-page page size (web `perPage`).
 * @param onPerPageChange invoked with the next page size (web `onPerPageChange`).
 * @param onQuery invoked when the Query button is pressed (web `onQuery`).
 * @param rows the controlled current page of results (web `rows`).
 * @param page the controlled 1-based page (web `page`).
 * @param total the controlled total row count (web `total`).
 * @param onPageChange invoked with the chosen 1-based page (web `onPageChange`).
 * @param maxSignals an optional hard selection cap (web `maxSignals`); `null` for no cap.
 * @param queryLoading whether a query is in flight (web `loading` on the Query button).
 * @param tableLoading whether the results page is loading (web `loading` on the table).
 */
@Composable
fun SignalQueryControls(
    viewModel: SignalQueryControlsViewModel,
    selectedSignals: List<String>,
    onSelectedSignalsChange: (List<String>) -> Unit,
    fromValue: String,
    toValue: String,
    onFromChange: (String) -> Unit,
    onToChange: (String) -> Unit,
    perPage: Int,
    onPerPageChange: (Int) -> Unit,
    onQuery: () -> Unit,
    rows: List<SignalLogEntry>,
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    maxSignals: Int? = null,
    queryLoading: Boolean = false,
    tableLoading: Boolean = false,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberSignalQueryControlsStrings()
    val state by viewModel.availableSignals.collectAsStateWithLifecycle()
    val display = remember(state) { SignalQueryControlsProjection.project(state) }

    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    SignalQueryControlsContent(
        display = display,
        strings = strings,
        selectedSignals = selectedSignals,
        onSelectedSignalsChange = onSelectedSignalsChange,
        fromValue = fromValue,
        toValue = toValue,
        onFromChange = onFromChange,
        onToChange = onToChange,
        perPage = perPage,
        onPerPageChange = onPerPageChange,
        onQuery = onQuery,
        rows = rows,
        page = page,
        total = total,
        onPageChange = onPageChange,
        modifier = modifier,
        maxSignals = maxSignals,
        queryLoading = queryLoading,
        tableLoading = tableLoading,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless toolkit — renders the picker (every feed lifecycle state), the datetime range, the query controls,
 * and the results table. Hoisted out of the ViewModel so it is preview- and screenshot-testable per state.
 */
@Composable
fun SignalQueryControlsContent(
    display: SignalPickerDisplay,
    strings: SignalQueryControlsStrings,
    selectedSignals: List<String>,
    onSelectedSignalsChange: (List<String>) -> Unit,
    fromValue: String,
    toValue: String,
    onFromChange: (String) -> Unit,
    onToChange: (String) -> Unit,
    perPage: Int,
    onPerPageChange: (Int) -> Unit,
    onQuery: () -> Unit,
    rows: List<SignalLogEntry>,
    page: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    maxSignals: Int? = null,
    queryLoading: Boolean = false,
    tableLoading: Boolean = false,
    onRetry: () -> Unit = {},
) {
    FadeIn(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth().testTag(SIGNAL_QUERY_CONTROLS_TEST_TAG),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            GlassPanel {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    SignalPickerSection(
                        display = display,
                        strings = strings,
                        selected = selectedSignals,
                        onSelectedChange = onSelectedSignalsChange,
                        maxSignals = maxSignals,
                        onRetry = onRetry,
                    )
                    DateTimeRangeControls(
                        fromValue = fromValue,
                        toValue = toValue,
                        onFromChange = onFromChange,
                        onToChange = onToChange,
                        strings = strings,
                    )
                    QueryControls(
                        perPage = perPage,
                        onPerPageChange = onPerPageChange,
                        onQuery = onQuery,
                        queryEnabled = selectedSignals.isNotEmpty(),
                        queryLoading = queryLoading,
                        strings = strings,
                    )
                }
            }
            SignalDataTable(
                rows = rows,
                page = page,
                perPage = perPage,
                total = total,
                onPageChange = onPageChange,
                loading = tableLoading,
                strings = strings,
            )
        }
    }
}

// ── Signal multi-select (the data-bound region; renders every feed state) ──

/**
 * The signal picker — the native port of the web `SignalMultiSelect`. The label row carries the count/cap
 * label and a freshness chip; the body switches on the bound available-signals feed: a loading skeleton, a
 * classified error with retry, a friendly empty note, or the selected chips + the shared multi-select.
 */
@Composable
private fun SignalPickerSection(
    display: SignalPickerDisplay,
    strings: SignalQueryControlsStrings,
    selected: List<String>,
    onSelectedChange: (List<String>) -> Unit,
    maxSignals: Int?,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().testTag(SIGNAL_QUERY_PICKER_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Caption(pickerLabel(strings, selected.size, maxSignals))
            Spacer(modifier = Modifier.weight(1f))
            if (display.showFreshnessChip) PickerFreshnessChip(display, strings)
        }
        when (display.phase) {
            SignalPickerPhase.Loading ->
                Skeleton(
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
                    height = PICKER_SKELETON_HEIGHT,
                    rounded = true,
                )
            SignalPickerPhase.Error ->
                QueryError(
                    kind = SignalQueryControlsProjection.queryErrorKind(display),
                    resourceName = strings.signalsLabel,
                    onRetry = onRetry,
                )
            SignalPickerPhase.Empty -> HelperText(strings.noOptionsLabel)
            SignalPickerPhase.Content ->
                SignalPickerContent(
                    display = display,
                    strings = strings,
                    selected = selected,
                    onSelectedChange = onSelectedChange,
                    maxSignals = maxSignals,
                )
        }
    }
}

/** The resolved picker body — the removable selected chips, the multi-select, and the cap hint. */
@Composable
private fun SignalPickerContent(
    display: SignalPickerDisplay,
    strings: SignalQueryControlsStrings,
    selected: List<String>,
    onSelectedChange: (List<String>) -> Unit,
    maxSignals: Int?,
) {
    SelectedSignalChips(
        selected = selected,
        strings = strings,
        onRemove = { signal -> onSelectedChange(toggleSignal(selected, signal, maxSignals)) },
    )
    ComboboxMulti(
        options = SignalQueryControlsProjection.comboOptions(display.names, selected, maxSignals),
        selectedValues = selected.toSet(),
        onToggle = { signal -> onSelectedChange(toggleSignal(selected, signal, maxSignals)) },
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.signalsLabel },
        emptyLabel = strings.signalsLabel,
    )
    if (atSignalCap(selected, maxSignals)) HelperText(strings.maxReachedLabel)
}

/** The selected-signal chips — each a removable pill announcing "Remove {signal}" for TalkBack (web chips). */
@Composable
private fun SelectedSignalChips(
    selected: List<String>,
    strings: SignalQueryControlsStrings,
    onRemove: (String) -> Unit,
) {
    if (selected.isEmpty()) return
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        selected.forEach { signal ->
            SignalChip(signal = signal, removeAria = strings.removeAria(signal), onRemove = { onRemove(signal) })
        }
    }
}

/** One removable signal chip — a tonal pill; the whole chip is a [Role.Button] remove target. */
@Composable
private fun SignalChip(
    signal: String,
    removeAria: String,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            modifier =
                Modifier
                    .clickable(role = Role.Button, onClickLabel = removeAria, onClick = onRemove)
                    .semantics { contentDescription = removeAria }
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = signal,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Icon(TeslaGlyphs.Close, contentDescription = null, size = IconSize.Xs)
        }
    }
}

/** The localized freshness chip — offline (cached after a failed refresh), updating, or stale past its TTL. */
@Composable
private fun PickerFreshnessChip(
    display: SignalPickerDisplay,
    strings: SignalQueryControlsStrings,
) {
    when {
        display.offline -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        display.refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        display.stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

// ── DateTime range controls (From / To tap-to-pick fields + quick presets) ──

/**
 * The datetime range controls — the native port of the web `DateTimeRangeControls`. Two tap-to-pick From/To
 * fields (the web `<Input type="datetime-local">`) over a row of quick-range presets; the active preset is
 * derived from the current window pair exactly as the web `matchTimeRangePreset` memo does.
 */
@Composable
fun DateTimeRangeControls(
    fromValue: String,
    toValue: String,
    onFromChange: (String) -> Unit,
    onToChange: (String) -> Unit,
    strings: SignalQueryControlsStrings,
    modifier: Modifier = Modifier,
) {
    val activePreset = SignalQueryTime.matchTimeRangePreset(fromValue, toValue)
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(strings.fromLabel)
            DateTimeField(value = fromValue, onChange = onFromChange, fieldLabel = strings.fromLabel, strings = strings)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(strings.toLabel)
            DateTimeField(value = toValue, onChange = onToChange, fieldLabel = strings.toLabel, strings = strings)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(strings.quickRangeLabel)
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                TIME_RANGE_PRESETS.forEach { preset ->
                    PresetChip(
                        preset = preset,
                        active = activePreset == preset.hours,
                        aria = strings.presetAria(preset.label),
                        onApply = {
                            val (from, to) = SignalQueryTime.presetRange(preset.hours, LocalDateTime.now())
                            onFromChange(from)
                            onToChange(to)
                        },
                    )
                }
            }
        }
    }
}

/** One quick-range preset chip — selected styling + `aria-pressed` semantics mirror the web pressed state. */
@Composable
private fun PresetChip(
    preset: TimeRangePreset,
    active: Boolean,
    aria: String,
    onApply: () -> Unit,
) {
    Button(
        label = preset.label,
        onClick = onApply,
        modifier =
            Modifier.semantics {
                contentDescription = aria
                selected = active
            },
        variant = if (active) ButtonVariant.Secondary else ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
}

/**
 * The native analogue of a web `<Input type="datetime-local">`: a full-width tap-to-pick field showing the
 * current window (or the field label when unset, so it is never blank). Tapping opens a Material 3 date picker,
 * then a time picker; confirming both emits the combined moment as a seconds-precision `datetime-local` string,
 * preserving the controlled-prop contract. The field carries an explicit TalkBack description.
 */
@Composable
private fun DateTimeField(
    value: String,
    onChange: (String) -> Unit,
    fieldLabel: String,
    strings: SignalQueryControlsStrings,
) {
    var phase by remember { mutableStateOf(PickPhase.Idle) }
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    val seeded = remember(value) { SignalQueryTime.parseLocalDatetime(value) }
    val display = SignalQueryTime.displayLabel(value, fieldLabel)

    Button(
        label = display,
        onClick = { phase = PickPhase.Date },
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "$fieldLabel: $display" },
        variant = ButtonVariant.Outline,
        leadingIcon = SignalQueryGlyphs.Calendar,
    )

    when (phase) {
        PickPhase.Date ->
            DatePickerPopup(
                initial = seeded,
                strings = strings,
                onCancel = { phase = PickPhase.Idle },
                onConfirm = { date ->
                    pickedDate = date
                    phase = PickPhase.Time
                },
            )
        PickPhase.Time ->
            TimePickerPopup(
                initial = seeded,
                strings = strings,
                onCancel = { phase = PickPhase.Idle },
                onConfirm = { hour, minute ->
                    val date = pickedDate ?: seeded?.toLocalDate() ?: LocalDate.now()
                    val moment = LocalDateTime.of(date, LocalTime.of(hour, minute))
                    onChange(SignalQueryTime.toLocalDatetimeStr(moment))
                    phase = PickPhase.Idle
                },
            )
        PickPhase.Idle -> Unit
    }
}

/** Material 3 date-picker dialog seeded from the current window — the date part of `datetime-local`. */
@Composable
private fun DatePickerPopup(
    initial: LocalDateTime?,
    strings: SignalQueryControlsStrings,
    onCancel: () -> Unit,
    onConfirm: (LocalDate) -> Unit,
) {
    val initialMillis =
        initial
            ?.toLocalDate()
            ?.atStartOfDay(ZoneOffset.UTC)
            ?.toInstant()
            ?.toEpochMilli()
    val pickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
    DatePickerDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                label = strings.confirmLabel,
                onClick = {
                    val picked =
                        pickerState.selectedDateMillis?.let {
                            Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()
                        }
                    if (picked != null) onConfirm(picked) else onCancel()
                },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(label = strings.cancelLabel, onClick = onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
    ) {
        DatePicker(state = pickerState)
    }
}

/** Material 3 time-picker dialog seeded from the current window — the time part of `datetime-local`. */
@Composable
private fun TimePickerPopup(
    initial: LocalDateTime?,
    strings: SignalQueryControlsStrings,
    onCancel: () -> Unit,
    onConfirm: (Int, Int) -> Unit,
) {
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    val pickerState =
        rememberTimePickerState(
            initialHour = initial?.hour ?: 0,
            initialMinute = initial?.minute ?: 0,
            is24Hour = is24Hour,
        )
    AlertDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                label = strings.confirmLabel,
                onClick = { onConfirm(pickerState.hour, pickerState.minute) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(label = strings.cancelLabel, onClick = onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
        text = { TimePicker(state = pickerState) },
    )
}

// ── Query controls (rows-per-page + Query button) ──

/**
 * The query controls — the native port of the web `QueryControls`: a rows-per-page [Select] beside the Query
 * button. The button is disabled until at least one signal is selected (web `disabled`) and shows a spinner
 * while a query is in flight (web `loading`).
 */
@Composable
fun QueryControls(
    perPage: Int,
    onPerPageChange: (Int) -> Unit,
    onQuery: () -> Unit,
    queryEnabled: Boolean,
    queryLoading: Boolean,
    strings: SignalQueryControlsStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Bottom,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(strings.rowsLabel)
            Select(
                options = PAGE_SIZES.map { SelectOption(value = it.toString(), label = it.toString()) },
                selectedValue = perPage.toString(),
                onSelect = { value -> onPerPageChange(value.toIntOrNull() ?: perPage) },
                modifier = Modifier.width(ROWS_SELECT_WIDTH),
            )
        }
        Spacer(modifier = Modifier.weight(1f))
        Button(
            label = strings.queryLabel,
            onClick = onQuery,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = queryEnabled,
            loading = queryLoading,
            leadingIcon = if (queryLoading) null else SignalQueryGlyphs.Play,
        )
    }
}

// ── Results table (#, timestamp, value, type) + server-side pagination ──

/** One indexed results row — the web `_rowNum` + entry; keyed by the 1-based row number for the table. */
private data class SignalTableRow(
    val rowNum: Int,
    val entry: SignalLogEntry,
)

/**
 * The results table — the native port of the web `SignalDataTable`. Renders the shared [DataTable] with the #,
 * timestamp, signal, color-coded value, and type-badge columns, its own loading + "No results" empty chrome
 * (never a blank box), and a server-side pagination footer shown only when the result spans more than one page.
 */
@Composable
fun SignalDataTable(
    rows: List<SignalLogEntry>,
    page: Int,
    perPage: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    loading: Boolean,
    strings: SignalQueryControlsStrings,
    modifier: Modifier = Modifier,
) {
    val zone = remember { ZoneId.systemDefault() }
    val indexed =
        remember(rows, page, perPage) {
            rows.mapIndexed { index, entry -> SignalTableRow((page - 1) * perPage + index + 1, entry) }
        }
    val pages = totalPages(total, perPage)

    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        Column(modifier = Modifier.fillMaxWidth().testTag(SIGNAL_QUERY_TABLE_TAG)) {
            when {
                loading -> SignalTableLoading(strings)
                indexed.isEmpty() ->
                    EmptyState(
                        message = strings.emptyResultsMessage,
                        title = strings.emptyResultsTitle,
                        icon = DataDisplayGlyphs.History,
                        modifier = Modifier.fillMaxWidth(),
                    )
                else ->
                    DataTable(
                        columns = signalTableColumns(strings, zone),
                        rows = indexed,
                        keyOf = { it.rowNum },
                        emptyText = strings.noResultsLabel,
                        modifier = Modifier.fillMaxWidth(),
                        footer =
                            if (pages > 1) {
                                {
                                    SignalTablePagination(
                                        page = page,
                                        perPage = perPage,
                                        total = total,
                                        onPageChange = onPageChange,
                                        strings = strings,
                                    )
                                }
                            } else {
                                null
                            },
                    )
            }
        }
    }
}

/** First-load body — the web five `<Skeleton className="h-8" />` bars, with an accessible "loading" label. */
@Composable
private fun SignalTableLoading(strings: SignalQueryControlsStrings) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(Spacing.md)
                .semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(TABLE_SKELETON_ROWS) { Skeleton(height = TABLE_SKELETON_HEIGHT) }
    }
}

/** The five results columns — each cell a thin map from a [SignalTableRow] to a shared primitive. */
private fun signalTableColumns(
    strings: SignalQueryControlsStrings,
    zone: ZoneId,
): List<TableColumn<SignalTableRow>> =
    listOf(
        TableColumn(key = "index", header = INDEX_HEADER, weight = INDEX_WEIGHT) { Caption(it.rowNum.toString()) },
        TableColumn(key = "time", header = strings.timestampHeader, weight = TIME_WEIGHT) {
            Caption(SignalQueryTime.formatTimestampMs(it.entry.createdAt, zone))
        },
        TableColumn(key = "signal", header = strings.signalHeader, weight = SIGNAL_WEIGHT) { CodeText(it.entry.signal) },
        TableColumn(key = "value", header = strings.valueHeader, weight = VALUE_WEIGHT) { ValueCell(it.entry) },
        TableColumn(key = "type", header = strings.typeHeader, weight = TYPE_WEIGHT) { row ->
            val type = row.entry.valueType()
            Badge(text = typeToken(type), variant = badgeVariantOf(type))
        },
    )

/** The Value cell — the monospace value tinted by its type (the web `TYPE_VALUE_COLOR` dynamic-color map). */
@Composable
private fun ValueCell(entry: SignalLogEntry) {
    val type = entry.valueType()
    Text(
        text = entry.formatValue(),
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        color = valueColor(type),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The dynamic per-type value color — num→info, str→success, bool→warning, null→muted (web toned-down map). */
@Composable
private fun valueColor(type: SignalValueType): Color =
    when (type) {
        SignalValueType.Num -> TeslaTokens.status.info
        SignalValueType.Str -> TeslaTokens.status.success
        SignalValueType.Bool -> TeslaTokens.status.warning
        SignalValueType.Null -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Server-side pagination footer — the web `<Pagination page pageSize total onPageChange />`. */
@Composable
private fun SignalTablePagination(
    page: Int,
    perPage: Int,
    total: Int,
    onPageChange: (Int) -> Unit,
    strings: SignalQueryControlsStrings,
) {
    val context = LocalContext.current
    Pagination(
        page = page,
        pageSize = perPage,
        total = total,
        onPageChange = onPageChange,
        firstLabel = strings.paginationFirst,
        previousLabel = strings.paginationPrevious,
        nextLabel = strings.paginationNext,
        lastLabel = strings.paginationLast,
        showingText = { start, end, count ->
            context.getString(R.string.translation_pagination_showing, start, end, count)
        },
    )
}

// ── i18n strings + glyphs ──

/** The picker label — "Signals" or, when capped, the live "Signals (count / max)" form (web label). */
private fun pickerLabel(
    strings: SignalQueryControlsStrings,
    count: Int,
    max: Int?,
): String = if (max != null) "${strings.signalsLabel} ($count / $max)" else strings.signalsLabel

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
fun rememberSignalQueryControlsStrings(): SignalQueryControlsStrings =
    SignalQueryControlsStrings(
        fromLabel = stringResource(R.string.translation_signalQuery_from),
        toLabel = stringResource(R.string.translation_signalQuery_to),
        quickRangeLabel = stringResource(R.string.translation_signalQuery_quickRange),
        presetAriaTemplate = stringResource(R.string.translation_signalQuery_preset_aria),
        queryLabel = stringResource(R.string.translation_signalQuery_query),
        rowsLabel = stringResource(R.string.translation_signalQuery_rows),
        signalsLabel = stringResource(R.string.translation_Signals),
        noOptionsLabel = stringResource(R.string.translation_combobox_noResults),
        maxReachedLabel = stringResource(R.string.translation_combobox_maxReached),
        removeLabel = stringResource(R.string.translation_common_remove),
        timestampHeader = stringResource(R.string.translation_Timestamp),
        signalHeader = stringResource(R.string.translation_Signal),
        valueHeader = stringResource(R.string.translation_Value),
        typeHeader = stringResource(R.string.translation_Type),
        noResultsLabel = stringResource(R.string.translation_combobox_noResults),
        emptyResultsTitle = stringResource(R.string.translation_common_noData),
        emptyResultsMessage = stringResource(R.string.translation_signalGap_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
        retryLabel = stringResource(R.string.translation_common_retry),
        confirmLabel = stringResource(R.string.translation_common_confirm),
        cancelLabel = stringResource(R.string.translation_common_cancel),
        paginationFirst = stringResource(R.string.translation_pagination_first),
        paginationPrevious = stringResource(R.string.translation_pagination_previous),
        paginationNext = stringResource(R.string.translation_pagination_next),
        paginationLast = stringResource(R.string.translation_pagination_last),
    )

/** Local picker phase for a [DateTimeField]: idle, picking the date, or picking the time. */
private enum class PickPhase { Idle, Date, Time }

/**
 * The two glyphs this surface needs that the shared [TeslaGlyphs] set does not carry. The web `datetime-local`
 * field has no icon; the native tap-to-pick field uses a calendar affordance to signal it opens a picker, and
 * the Query button uses a play affordance (web lucide `Play`). Authored here as 24×24 stroked vectors, exactly
 * as the sibling SignalCompareControls surface authors its calendar glyph.
 */
private object SignalQueryGlyphs {
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

    val Play: ImageVector =
        stroked("Play") {
            moveTo(7f, 5f)
            lineTo(19f, 12f)
            lineTo(7f, 19f)
            close()
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

// ── Previews — one per rendered state (loading / empty / error / content / stale / offline + results). ──

private fun previewStrings(): SignalQueryControlsStrings =
    SignalQueryControlsStrings(
        fromLabel = "From",
        toLabel = "To",
        quickRangeLabel = "Quick Range",
        presetAriaTemplate = "%1\$s time range",
        queryLabel = "Query",
        rowsLabel = "Rows",
        signalsLabel = "Signals",
        noOptionsLabel = "No results",
        maxReachedLabel = "Maximum reached",
        removeLabel = "Remove",
        timestampHeader = "Timestamp",
        signalHeader = "Signal",
        valueHeader = "Value",
        typeHeader = "Type",
        noResultsLabel = "No results",
        emptyResultsTitle = "No data available",
        emptyResultsMessage = "No signal data available",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        updatingLabel = "updating\u2026",
        retryLabel = "Retry",
        confirmLabel = "Confirm",
        cancelLabel = "Cancel",
        paginationFirst = "First page",
        paginationPrevious = "Previous page",
        paginationNext = "Next page",
        paginationLast = "Last page",
    )

private fun previewRows(): List<SignalLogEntry> =
    listOf(
        SignalLogEntry(createdAt = "2026-01-01T10:00:00Z", signal = "VehicleSpeed", valueNum = 64.0),
        SignalLogEntry(createdAt = "2026-01-01T10:00:01Z", signal = "ChargeState", valueStr = "Charging"),
        SignalLogEntry(createdAt = "2026-01-01T10:00:02Z", signal = "Locked", valueBool = true),
    )

@Composable
private fun previewSurface(
    display: SignalPickerDisplay,
    selected: List<String> = listOf("VehicleSpeed"),
    rows: List<SignalLogEntry> = previewRows(),
) {
    TeslaSyncTheme(dynamicColor = false) {
        SignalQueryControlsContent(
            display = display,
            strings = previewStrings(),
            selectedSignals = selected,
            onSelectedSignalsChange = {},
            fromValue = "2026-01-01T09:00:00",
            toValue = "2026-01-01T10:00:00",
            onFromChange = {},
            onToChange = {},
            perPage = 25,
            onPerPageChange = {},
            onQuery = {},
            rows = rows,
            page = 1,
            total = rows.size,
            onPageChange = {},
        )
    }
}

@Preview(name = "SignalQueryControls · content", showBackground = true)
@Composable
private fun SignalQueryControlsContentPreview() {
    previewSurface(
        display = SignalPickerDisplay(phase = SignalPickerPhase.Content, names = listOf("VehicleSpeed", "ChargeState")),
    )
}

@Preview(name = "SignalQueryControls · loading", showBackground = true)
@Composable
private fun SignalQueryControlsLoadingPreview() {
    previewSurface(display = SignalPickerDisplay(phase = SignalPickerPhase.Loading), selected = emptyList(), rows = emptyList())
}

@Preview(name = "SignalQueryControls · empty signals", showBackground = true)
@Composable
private fun SignalQueryControlsEmptyPreview() {
    previewSurface(display = SignalPickerDisplay(phase = SignalPickerPhase.Empty), selected = emptyList(), rows = emptyList())
}

@Preview(name = "SignalQueryControls · error", showBackground = true)
@Composable
private fun SignalQueryControlsErrorPreview() {
    previewSurface(
        display = SignalPickerDisplay(phase = SignalPickerPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
        selected = emptyList(),
        rows = emptyList(),
    )
}

@Preview(name = "SignalQueryControls · stale", showBackground = true)
@Composable
private fun SignalQueryControlsStalePreview() {
    previewSurface(
        display = SignalPickerDisplay(phase = SignalPickerPhase.Content, names = listOf("VehicleSpeed"), stale = true),
    )
}

@Preview(name = "SignalQueryControls · offline", showBackground = true)
@Composable
private fun SignalQueryControlsOfflinePreview() {
    previewSurface(
        display =
            SignalPickerDisplay(
                phase = SignalPickerPhase.Content,
                names = listOf("VehicleSpeed"),
                offline = true,
                errorKind = ErrorKind.Network,
            ),
    )
}
