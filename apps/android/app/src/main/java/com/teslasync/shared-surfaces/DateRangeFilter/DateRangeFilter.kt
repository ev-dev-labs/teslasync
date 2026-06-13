// The native Jetpack Compose + Material 3 DateRangeFilter shared surface — a parity port of
// web/src/components/forms/DateRangeFilter.tsx. The web component is a controlled date-range filter: two date
// inputs (ISO `YYYY-MM-DD`), an optional Apply button, and a row of quick-select preset chips
// (web DatePresetChips), reading `startDate`/`endDate` and writing through the host's `useUrlBatch` URL setter.
// This native surface keeps that contract end to end and renders every state the prompt's matrix mandates
// without ever hiding the control: loading (the first URL-state read's skeleton), content (the filled
// control), empty (no range chosen — the control plus a "pick a range" prompt), a hard error with Retry, and
// a stale/offline freshness chip over a cached selection.
//
// It performs NO HTTP and binds the `from`/`to` selection only through the shared S8 URL-state seam
// ([DateRangeFilterSource]) folded through [DateRangeFilterViewModel] + the pure [DateRangeFilterProjection];
// the composable resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection
// returns, using the shared component library (ui Button/GlassPanel/StatusPill/typography, feedback
// QueryError/Skeleton, motion FadeIn) plus the idiomatic Material 3 date picker for the inputs. The one-shot
// PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DateRangeFilter) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.daterangefilter

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.LocalDate

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the surface logic locale-stable. Every string resolves
 * through the P1/S10 catalog; [presetLabels] maps each preset id to its localized chip label.
 */
data class DateRangeFilterStrings(
    val startLabel: String,
    val endLabel: String,
    val apply: String,
    val presetGroupLabel: String,
    val pickRange: String,
    val selectStart: String,
    val selectEnd: String,
    val confirm: String,
    val cancel: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val title: String,
    val presetLabels: Map<String, String>,
)

/**
 * Stateful entry point — the parity port of the web `DateRangeFilter`. Binds the shared URL-state selection
 * feed via [source] into a [DateRangeFilterViewModel], records the one-shot `view.opened` diagnostic (P1/S11)
 * on first composition, collects the selection [io.teslasync.android.data.UiState], projects it against the
 * local "today", auto-refreshes a stale cache, and renders. Edits route back through the ViewModel to the
 * seam (web `useUrlBatch`). The [source] defaults to the app's shared process-wide URL-state store.
 *
 * @param presets when false, hides the preset chip row (web `presets={false}`).
 * @param presetIds subset of preset ids to render (web `presetIds`); defaults to [DEFAULT_PRESET_IDS].
 * @param onApply optional host callback fired after a preset pick or the Apply button (web `onApply`); when
 *   null the Apply button is hidden, exactly like the web `{onApply && <Button/>}`.
 * @param source the URL-state selection seam (the process store, or a fake).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DateRangeFilter(
    modifier: Modifier = Modifier,
    presets: Boolean = true,
    presetIds: List<String> = DEFAULT_PRESET_IDS,
    onApply: (() -> Unit)? = null,
    source: DateRangeFilterSource = ProcessDateRangeStore,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DateRangeFilterViewModel =
        viewModel(
            key = DateRangeFilterRegistration.SLUG,
            factory = DateRangeFilterViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val today = remember { LocalDate.now() }
    val display = remember(state, today) { DateRangeFilterProjection.project(state, today) }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached selection, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        DateRangeFilterContent(
            display = display,
            strings = rememberDateRangeFilterStrings(),
            presetIds = if (presets) presetIds else emptyList(),
            showApply = onApply != null,
            onStartPicked = viewModel::onStartDateChange,
            onEndPicked = viewModel::onEndDateChange,
            onPreset = { id ->
                viewModel.onPresetSelected(id, today)
                onApply?.invoke()
            },
            onApply = { onApply?.invoke() },
            onRetry = viewModel::retry,
        )
    }
}

/**
 * Stateless DateRangeFilter card — renders every branch the web source draws plus the URL-state read's
 * lifecycle: the loading skeleton, the filled control, the empty control with a "pick a range" prompt, and the
 * classified error with retry, with a stale/offline freshness chip over a cached selection. Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun DateRangeFilterContent(
    display: DateRangeFilterDisplay,
    strings: DateRangeFilterStrings,
    presetIds: List<String>,
    showApply: Boolean,
    modifier: Modifier = Modifier,
    onStartPicked: (String) -> Unit = {},
    onEndPicked: (String) -> Unit = {},
    onPreset: (String) -> Unit = {},
    onApply: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        when (display.phase) {
            UiPhase.Loading -> DateRangeLoading(strings = strings)
            UiPhase.Error ->
                QueryError(
                    kind = DateRangeFilterProjection.queryErrorKind(display),
                    resourceName = strings.title,
                    onRetry = onRetry,
                )
            UiPhase.Content, UiPhase.Empty ->
                DateRangeControl(
                    display = display,
                    strings = strings,
                    presetIds = presetIds,
                    showApply = showApply,
                    emptyPrompt = display.phase == UiPhase.Empty,
                    onStartPicked = onStartPicked,
                    onEndPicked = onEndPicked,
                    onPreset = onPreset,
                    onApply = onApply,
                )
        }
    }
}

@Composable
private fun DateRangeControl(
    display: DateRangeFilterDisplay,
    strings: DateRangeFilterStrings,
    presetIds: List<String>,
    showApply: Boolean,
    emptyPrompt: Boolean,
    onStartPicked: (String) -> Unit,
    onEndPicked: (String) -> Unit,
    onPreset: (String) -> Unit,
    onApply: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DateField(
                label = strings.startLabel,
                value = display.start,
                selectTitle = strings.selectStart,
                strings = strings,
                onPicked = onStartPicked,
                modifier = Modifier.weight(1f),
            )
            Caption(RANGE_SEPARATOR)
            DateField(
                label = strings.endLabel,
                value = display.end,
                selectTitle = strings.selectEnd,
                strings = strings,
                onPicked = onEndPicked,
                modifier = Modifier.weight(1f),
            )
            if (display.showFreshnessChip) {
                FreshnessChip(display = display, strings = strings)
            }
        }
        if (emptyPrompt) {
            HelperText(strings.pickRange)
        }
        if (showApply) {
            Button(
                label = strings.apply,
                onClick = onApply,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        }
        if (presetIds.isNotEmpty()) {
            PresetChips(
                presetIds = presetIds,
                activeId = display.activePresetId,
                strings = strings,
                onPreset = onPreset,
            )
        }
    }
}

@Composable
private fun DateField(
    label: String,
    value: String,
    selectTitle: String,
    strings: DateRangeFilterStrings,
    onPicked: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var open by remember { mutableStateOf(false) }
    val shown = value.ifBlank { DateRangeFilterRegistration.EMPTY_VALUE }
    val spoken = if (value.isBlank()) label else "$label: $value"
    Button(
        label = shown,
        onClick = { open = true },
        modifier = modifier.semantics { contentDescription = spoken },
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
    )
    if (open) {
        DatePickerPopup(
            initialIso = value,
            title = selectTitle,
            strings = strings,
            onDismiss = { open = false },
            onConfirm = { iso ->
                onPicked(iso)
                open = false
            },
        )
    }
}

@Composable
private fun DatePickerPopup(
    initialIso: String,
    title: String,
    strings: DateRangeFilterStrings,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    val state = rememberDatePickerState(initialSelectedDateMillis = isoToUtcMillis(initialIso))
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            Button(
                label = strings.confirm,
                onClick = { onConfirm(state.selectedDateMillis?.let(::utcMillisToIso).orEmpty()) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(
                label = strings.cancel,
                onClick = onDismiss,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        },
    ) {
        DatePicker(
            state = state,
            title = { Caption(text = title, modifier = Modifier.padding(Spacing.lg)) },
        )
    }
}

@Composable
private fun PresetChips(
    presetIds: List<String>,
    activeId: String?,
    strings: DateRangeFilterStrings,
    onPreset: (String) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.presetGroupLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        presetIds.forEach { id ->
            val active = id == activeId
            Button(
                label = strings.presetLabels[id] ?: id,
                onClick = { onPreset(id) },
                variant = if (active) ButtonVariant.Primary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun FreshnessChip(
    display: DateRangeFilterDisplay,
    strings: DateRangeFilterStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
    }
}

@Composable
private fun DateRangeLoading(strings: DateRangeFilterStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(modifier = Modifier.weight(1f), height = FIELD_SKELETON_HEIGHT)
            Skeleton(modifier = Modifier.weight(1f), height = FIELD_SKELETON_HEIGHT)
        }
        Skeleton(widthFraction = CHIPS_SKELETON_FRACTION, height = CHIPS_SKELETON_HEIGHT)
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberDateRangeFilterStrings(): DateRangeFilterStrings =
    DateRangeFilterStrings(
        startLabel = stringResource(R.string.translation_date_range_start),
        endLabel = stringResource(R.string.translation_date_range_end),
        apply = stringResource(R.string.translation_date_range_apply),
        presetGroupLabel = stringResource(R.string.translation_date_preset_label),
        pickRange = stringResource(R.string.translation_date_range_pickRange),
        selectStart = stringResource(R.string.translation_date_range_selectStart),
        selectEnd = stringResource(R.string.translation_date_range_selectEnd),
        confirm = stringResource(R.string.translation_common_confirm),
        cancel = stringResource(R.string.translation_common_cancel),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        title = stringResource(R.string.translation_date_range_trigger),
        presetLabels =
            mapOf(
                "today" to stringResource(R.string.translation_date_preset_today),
                "yesterday" to stringResource(R.string.translation_date_preset_yesterday),
                "7d" to stringResource(R.string.translation_date_preset_last7),
                "30d" to stringResource(R.string.translation_date_preset_last30),
                "90d" to stringResource(R.string.translation_date_preset_last90),
                "mtd" to stringResource(R.string.translation_date_preset_mtd),
                "qtd" to stringResource(R.string.translation_date_preset_qtd),
                "ytd" to stringResource(R.string.translation_date_preset_ytd),
                "lastMonth" to stringResource(R.string.translation_date_preset_lastMonth),
                "1y" to stringResource(R.string.translation_date_preset_last1y),
                "all" to stringResource(R.string.translation_date_preset_all),
            ),
    )

/** The directional separator drawn between the two date fields (web `→`). A glyph, not translatable copy. */
private const val RANGE_SEPARATOR = "\u2192"

private const val CHIPS_SKELETON_FRACTION = 0.85f
private val FIELD_SKELETON_HEIGHT = 36.dp
private val CHIPS_SKELETON_HEIGHT = 28.dp

/** The whole-day millisecond span used to convert between an ISO date and the picker's UTC-midnight millis. */
private const val MILLIS_PER_DAY = 86_400_000L

/** Converts an ISO `YYYY-MM-DD` to the picker's UTC-midnight millis via epoch-day (TZ-stable); blank ⇒ null. */
private fun isoToUtcMillis(iso: String): Long? =
    if (iso.isBlank()) {
        null
    } else {
        runCatching { LocalDate.parse(iso).toEpochDay() * MILLIS_PER_DAY }.getOrNull()
    }

/** Converts the picker's UTC-midnight millis back to an ISO `YYYY-MM-DD` via epoch-day. */
private fun utcMillisToIso(millis: Long): String = LocalDate.ofEpochDay(millis / MILLIS_PER_DAY).toString()

// ── Previews — one per rendered state (loading / content / empty / stale / offline / error). ─────────────

private fun previewStrings(): DateRangeFilterStrings =
    DateRangeFilterStrings(
        startLabel = "Start date",
        endLabel = "End date",
        apply = "Apply",
        presetGroupLabel = "Quick date range",
        pickRange = "Pick a date range",
        selectStart = "Select start date",
        selectEnd = "Select end date",
        confirm = "Confirm",
        cancel = "Cancel",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        title = "Date range",
        presetLabels =
            mapOf(
                "today" to "Today",
                "7d" to "Last 7 days",
                "30d" to "Last 30 days",
                "mtd" to "Month to date",
                "ytd" to "Year to date",
                "all" to "All time",
            ),
    )

private const val PREVIEW_START = "2026-06-01"
private const val PREVIEW_END = "2026-06-13"

@Preview(name = "DateRangeFilter · loading", showBackground = true)
@Composable
private fun DateRangeFilterLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DateRangeFilterContent(
            display = DateRangeFilterDisplay(phase = UiPhase.Loading),
            strings = previewStrings(),
            presetIds = DEFAULT_PRESET_IDS,
            showApply = true,
        )
    }
}

@Preview(name = "DateRangeFilter · content", showBackground = true)
@Composable
private fun DateRangeFilterContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DateRangeFilterContent(
            display =
                DateRangeFilterDisplay(
                    phase = UiPhase.Content,
                    start = PREVIEW_START,
                    end = PREVIEW_END,
                    activePresetId = "30d",
                ),
            strings = previewStrings(),
            presetIds = DEFAULT_PRESET_IDS,
            showApply = true,
        )
    }
}

@Preview(name = "DateRangeFilter · empty", showBackground = true)
@Composable
private fun DateRangeFilterEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DateRangeFilterContent(
            display = DateRangeFilterDisplay(phase = UiPhase.Empty),
            strings = previewStrings(),
            presetIds = DEFAULT_PRESET_IDS,
            showApply = false,
        )
    }
}

@Preview(name = "DateRangeFilter · stale", showBackground = true)
@Composable
private fun DateRangeFilterStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DateRangeFilterContent(
            display =
                DateRangeFilterDisplay(
                    phase = UiPhase.Content,
                    start = PREVIEW_START,
                    end = PREVIEW_END,
                    stale = true,
                    refreshing = true,
                ),
            strings = previewStrings(),
            presetIds = DEFAULT_PRESET_IDS,
            showApply = true,
        )
    }
}

@Preview(name = "DateRangeFilter · offline", showBackground = true)
@Composable
private fun DateRangeFilterOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DateRangeFilterContent(
            display =
                DateRangeFilterDisplay(
                    phase = UiPhase.Content,
                    start = PREVIEW_START,
                    end = PREVIEW_END,
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
            presetIds = DEFAULT_PRESET_IDS,
            showApply = true,
        )
    }
}

@Preview(name = "DateRangeFilter · error", showBackground = true)
@Composable
private fun DateRangeFilterErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DateRangeFilterContent(
            display =
                DateRangeFilterDisplay(
                    phase = UiPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = HTTP_SERVER_ERROR,
                ),
            strings = previewStrings(),
            presetIds = DEFAULT_PRESET_IDS,
            showApply = true,
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
