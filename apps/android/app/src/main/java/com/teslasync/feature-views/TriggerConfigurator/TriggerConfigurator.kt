// The native Jetpack Compose + Material 3 TriggerConfigurator feature view — a parity port of
// web/src/features/automations/pages/TriggerConfigurator.tsx. It is a controlled form sub-component: it
// takes a `trigger` value + an `onChange` callback (the web props) and renders one of four kind-specific
// bodies — schedule (a simple time + day-of-week picker that folds to/from a cron expression, or an advanced
// cron field, plus a timezone select), vehicle event (an event select), geofence (a geofence select + event
// select + an optional dwell-minutes field), or signal threshold (a signal select + operator select + a
// value control + a "fire on any change" toggle).
//
// The form's only data-bound surface is the geofence dropdown, fed by the shared cache-then-network
// `useGeofences` feed (P1/S8) through [TriggerConfiguratorViewModel]. Every cache-then-network state the
// feed can be in is reproduced HONESTLY on that dropdown — a loading indicator while the first list loads, a
// "no geofences configured" hint when the resolved list is empty, an offline chip + retry when a refresh
// fails over cached data, and an error message + retry when the first load fails — while the rest of the
// form stays fully usable (the geofence list is never a gate on the whole surface). The view performs no
// HTTP; it only collects state and emits `onChange`. Every string resolves through the i18n facade (P1/S10)
// and every interactive control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TriggerConfigurator) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed because the file is named after its primary composable while it
// also hosts the stateless renderer + the private body composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.triggerconfigurator

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.locations.Geofence

private val CHIP_MIN_TOUCH = 44.dp

/**
 * Stateful entry point. Binds the cache-then-network geofence feed via [source] into a
 * [TriggerConfiguratorViewModel], records the one-shot `view.opened` diagnostic, resolves the localized
 * strings, and renders the form for the current [trigger]. A host (the automation builder) supplies the
 * [source] (an adapter over the shared S8 Locations data layer), the current [trigger], an [onChange]
 * callback, and a unique [instanceKey] per placement.
 *
 * @param trigger the current trigger value (the web `trigger` prop).
 * @param onChange invoked with the next trigger whenever the user edits a field (the web `onChange` prop).
 * @param source the cache-then-network geofence seam (a [TriggerConfiguratorSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey unique key per placement so multiple instances keep independent state holders.
 */
@Composable
public fun TriggerConfigurator(
    trigger: AutomationTriggerInput,
    onChange: (AutomationTriggerInput) -> Unit,
    source: TriggerConfiguratorSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TriggerConfiguratorRegistration.SLUG,
) {
    val viewModel: TriggerConfiguratorViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { TriggerConfiguratorViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val geofenceState by viewModel.geofences.collectAsStateWithLifecycle()

    TriggerConfiguratorContent(
        trigger = trigger,
        onChange = onChange,
        geofenceState = geofenceState,
        onRetryGeofences = viewModel::retry,
        resolve = rememberStringResolver(),
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Resolves the chrome strings, then dispatches on the
 * trigger kind to the matching body. [geofenceState] drives the geofence dropdown's cache-then-network
 * surface; [onRetryGeofences] re-collects the feed. [resolve] is the i18n facade seam so tests can inject a
 * deterministic dictionary.
 */
@Composable
public fun TriggerConfiguratorContent(
    trigger: AutomationTriggerInput,
    onChange: (AutomationTriggerInput) -> Unit,
    geofenceState: UiState<List<Geofence>>,
    onRetryGeofences: () -> Unit,
    resolve: StringResolver,
    modifier: Modifier = Modifier,
) {
    val strings = remember(resolve) { buildTriggerConfiguratorStrings(resolve) }
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        when (trigger) {
            is AutomationTriggerInput.Schedule -> ScheduleFields(trigger, onChange, strings, resolve)
            is AutomationTriggerInput.Event -> EventFields(trigger, onChange, strings, resolve)
            is AutomationTriggerInput.Geofence ->
                GeofenceFields(trigger, onChange, geofenceState, onRetryGeofences, strings, resolve)
            is AutomationTriggerInput.Signal -> SignalFields(trigger, onChange, strings, resolve)
        }
    }
}

// ── Schedule ───────────────────────────────────────────────────────────────────

@Composable
private fun ScheduleFields(
    trigger: AutomationTriggerInput.Schedule,
    onChange: (AutomationTriggerInput) -> Unit,
    strings: TriggerConfiguratorStrings,
    resolve: StringResolver,
) {
    val parsed = remember(trigger.cronExpr) { parseCronExpr(trigger.cronExpr) }
    val isSimple = parsed != null
    val hour = parsed?.hour ?: DEFAULT_HOUR
    val minute = parsed?.minute ?: 0
    val selectedDays = parsed?.days ?: emptyList()

    val updateCron: (Int, Int, List<Int>) -> Unit = { h, m, d ->
        onChange(trigger.copy(cronExpr = buildCronExpr(h, m, d)))
    }

    if (isSimple) {
        Input(
            value = formatTime(hour, minute),
            onValueChange = { typed ->
                val (h, m) = parseTime(typed, hour, minute)
                updateCron(h, m, selectedDays)
            },
            label = strings.time,
            keyboardType = KeyboardType.Number,
        )
        DayPicker(
            label = strings.days,
            selectedDays = selectedDays,
            resolve = resolve,
            onToggle = { index -> updateCron(hour, minute, toggleDay(selectedDays, index)) },
        )
    } else {
        LabeledFieldHeader(label = strings.cronExpr, helpText = strings.cronHelp, helpLabel = strings.helpLabel)
        Input(
            value = trigger.cronExpr,
            onValueChange = { onChange(trigger.copy(cronExpr = it)) },
            hint = if (trigger.cronExpr.isBlank()) strings.cronExample else strings.cronHint,
        )
    }

    Button(
        label = if (isSimple) strings.advancedCron else strings.simpleCron,
        onClick = {
            onChange(trigger.copy(cronExpr = if (isSimple) trigger.cronExpr else TriggerCatalog.DEFAULT_CRON))
        },
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    )

    Select(
        label = strings.timezone,
        options = remember(resolve) { timezoneOptions(resolve).toSelectOptions() },
        selectedValue = trigger.timezone,
        onSelect = { onChange(trigger.copy(timezone = it)) },
    )
}

@Composable
private fun DayPicker(
    label: String,
    selectedDays: List<Int>,
    resolve: StringResolver,
    onToggle: (Int) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(label)
        DayToggleRow(selectedDays = selectedDays, resolve = resolve, onToggle = onToggle)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DayToggleRow(
    selectedDays: List<Int>,
    resolve: StringResolver,
    onToggle: (Int) -> Unit,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        TriggerCatalog.DAYS.indices.forEach { index ->
            DayToggleChip(
                shortLabel = dayShortLabel(resolve, index),
                fullName = dayFullLabel(index),
                selected = isDayActive(selectedDays, index),
                onToggle = { onToggle(index) },
            )
        }
    }
}

@Composable
private fun DayToggleChip(
    shortLabel: String,
    fullName: String,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    val container = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val content = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = container,
        contentColor = content,
        modifier =
            Modifier
                .defaultMinSize(minWidth = CHIP_MIN_TOUCH, minHeight = CHIP_MIN_TOUCH)
                .toggleable(value = selected, role = Role.Checkbox, onValueChange = { onToggle() })
                .semantics { contentDescription = fullName },
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(horizontal = Spacing.md)) {
            Caption(shortLabel)
        }
    }
}

// ── Vehicle event ────────────────────────────────────────────────────────────────

@Composable
private fun EventFields(
    trigger: AutomationTriggerInput.Event,
    onChange: (AutomationTriggerInput) -> Unit,
    strings: TriggerConfiguratorStrings,
    resolve: StringResolver,
) {
    Select(
        label = strings.event,
        options = remember(resolve) { eventOptions(resolve).toSelectOptions() },
        selectedValue = trigger.eventType,
        onSelect = { onChange(trigger.copy(eventType = it)) },
    )
}

// ── Geofence ─────────────────────────────────────────────────────────────────────

@Composable
private fun GeofenceFields(
    trigger: AutomationTriggerInput.Geofence,
    onChange: (AutomationTriggerInput) -> Unit,
    geofenceState: UiState<List<Geofence>>,
    onRetryGeofences: () -> Unit,
    strings: TriggerConfiguratorStrings,
    resolve: StringResolver,
) {
    val geofences = geofenceState.data ?: emptyList()
    val options = remember(geofences, strings.selectGeofence) { geofenceOptions(geofences, strings.selectGeofence).toSelectOptions() }

    Select(
        label = strings.geofence,
        options = options,
        selectedValue = if (trigger.placeId > 0L) trigger.placeId.toString() else "",
        emptyLabel = strings.selectGeofence,
        onSelect = { value -> onChange(trigger.copy(placeId = value.toLongOrNull()?.takeIf { value.isNotEmpty() } ?: 0L)) },
    )
    GeofenceStatusRow(state = geofenceState, strings = strings, onRetry = onRetryGeofences)

    Select(
        label = strings.geofenceEvent,
        options = remember(resolve) { geofenceEventOptions(resolve).toSelectOptions() },
        selectedValue = trigger.event,
        onSelect = { value ->
            onChange(
                trigger.copy(
                    event = value,
                    dwellMinutes = if (value == "dwell") trigger.dwellMinutes ?: TriggerCatalog.DEFAULT_DWELL_MINUTES else null,
                ),
            )
        },
    )

    if (trigger.event == "dwell") {
        LabeledFieldHeader(label = strings.dwellMinutes, helpText = strings.dwellHelp, helpLabel = strings.helpLabel)
        Input(
            value = (trigger.dwellMinutes ?: TriggerCatalog.DEFAULT_DWELL_MINUTES).toString(),
            onValueChange = { onChange(trigger.copy(dwellMinutes = dwellMinutesFromInput(it))) },
            hint = strings.dwellHint,
            keyboardType = KeyboardType.Number,
        )
    }
}

/**
 * The geofence dropdown's cache-then-network status line — the form's honest reproduction of every state the
 * web `useGeofences` query can be in: a loading spinner on first load, an error message + retry when the
 * first load fails, an offline chip + retry when a refresh fails over cached data, and a "no geofences"
 * hint when the resolved list is empty. Renders nothing on a clean, non-empty content load.
 */
@Composable
private fun GeofenceStatusRow(
    state: UiState<List<Geofence>>,
    strings: TriggerConfiguratorStrings,
    onRetry: () -> Unit,
) {
    when {
        state.isLoading ->
            Spinner(size = SpinnerSize.Sm, label = strings.loadingGeofences)

        state.isError ->
            RetryRow(message = strings.geofencesError, retryLabel = strings.retry, onRetry = onRetry, isError = true)

        state.isOffline ->
            RetryRow(message = strings.geofencesOffline, retryLabel = strings.retry, onRetry = onRetry, isError = false)

        state.isEmpty ->
            HelperText(strings.noGeofences)

        else -> Unit
    }
}

@Composable
private fun RetryRow(
    message: String,
    retryLabel: String,
    onRetry: () -> Unit,
    isError: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (isError) {
            ErrorText(message, modifier = Modifier.weight(1f))
        } else {
            Caption(message, modifier = Modifier.weight(1f))
        }
        Button(label = retryLabel, onClick = onRetry, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
    }
}

// ── Signal threshold ──────────────────────────────────────────────────────────────

@Composable
private fun SignalFields(
    trigger: AutomationTriggerInput.Signal,
    onChange: (AutomationTriggerInput) -> Unit,
    strings: TriggerConfiguratorStrings,
    resolve: StringResolver,
) {
    val isBool = isBoolSignal(trigger.signal)
    val value = signalValueString(trigger)

    Select(
        label = strings.signal,
        options = remember { signalFieldOptions().toSelectOptions() },
        selectedValue = trigger.signal,
        onSelect = { signal -> onChange(signalForField(trigger, signal)) },
    )

    Select(
        label = strings.operator,
        options = remember(resolve) { signalOperatorOptions(resolve).toSelectOptions() },
        selectedValue = trigger.op,
        onSelect = { op ->
            if (op == TriggerCatalog.OP_CHANGED) {
                onChange(AutomationTriggerInput.Signal(stepOrder = trigger.stepOrder, signal = trigger.signal, op = op))
            } else {
                onChange(signalValueFromInput(trigger.copy(op = op), value))
            }
        },
    )

    if (trigger.op != TriggerCatalog.OP_CHANGED) {
        if (isBool) {
            Select(
                label = strings.value,
                options =
                    listOf(
                        SelectOption(value = "true", label = strings.trueLabel),
                        SelectOption(value = "false", label = strings.falseLabel),
                    ),
                selectedValue = value,
                onSelect = { onChange(signalValueFromInput(trigger, it)) },
            )
        } else {
            val isState = trigger.signal == TriggerCatalog.STATE_SIGNAL
            Input(
                value = value,
                onValueChange = { onChange(signalValueFromInput(trigger, it)) },
                label = strings.value,
                hint = if (isState) strings.stateExample else null,
                keyboardType = if (isState) KeyboardType.Text else KeyboardType.Number,
            )
        }
    }

    Toggle(
        label = strings.changedOnly,
        checked = trigger.op == TriggerCatalog.OP_CHANGED,
        onCheckedChange = { checked ->
            if (checked) {
                onChange(
                    AutomationTriggerInput.Signal(stepOrder = trigger.stepOrder, signal = trigger.signal, op = TriggerCatalog.OP_CHANGED),
                )
            } else {
                onChange(signalValueFromInput(trigger.copy(op = "="), value))
            }
        },
    )
}

// ── Shared chrome ─────────────────────────────────────────────────────────────────

/** A field label row with an inline help affordance — the native analogue of the web `Input` `help` prop. */
@Composable
private fun LabeledFieldHeader(
    label: String,
    helpText: String,
    helpLabel: String,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(label)
        HelpIcon(text = helpText, contentDescription = "$helpLabel: $label")
    }
}

private fun List<OptionItem>.toSelectOptions(): List<SelectOption> = map { SelectOption(value = it.value, label = it.label) }

private const val DEFAULT_HOUR = 8
private const val TIME_PARTS = 2

/** Formats an hour + minute as a zero-padded `HH:MM` string (the web time-input value). */
private fun formatTime(
    hour: Int,
    minute: Int,
): String = "%02d:%02d".format(hour, minute)

/**
 * Parses an `HH:MM` time-input string into (hour, minute), falling back to the current [fallbackHour] /
 * [fallbackMinute] for any part that is missing or non-numeric — the web `value.split(':').map(Number)` with
 * its `?? hour` / `?? minute` guards.
 */
private fun parseTime(
    typed: String,
    fallbackHour: Int,
    fallbackMinute: Int,
): Pair<Int, Int> {
    val parts = typed.split(":")
    if (parts.size != TIME_PARTS) return fallbackHour to fallbackMinute
    val h = jsParseInt(parts[0]) ?: fallbackHour
    val m = jsParseInt(parts[1]) ?: fallbackMinute
    return h to m
}

/**
 * Builds the i18n facade the form resolves every string through (P1/S10): a by-name lookup against the
 * generated string catalog, folding the dotted key to its `translation_*` resource name, falling back to the
 * web's exact English text when the key is absent. Remembered against the context so a locale change
 * re-resolves the surface.
 */
@Composable
private fun rememberStringResolver(): StringResolver {
    val context = LocalContext.current
    return remember(context) {
        { key: String, fallback: String -> context.optionalString(foldCatalogKey(key)) ?: fallback }
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam reproducing web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}
