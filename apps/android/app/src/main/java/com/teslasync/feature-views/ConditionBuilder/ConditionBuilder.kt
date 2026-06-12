// The native Jetpack Compose + Material 3 ConditionBuilder feature view — a parity port of
// web/src/features/automations/pages/ConditionBuilder.tsx. It reproduces the web composition: a stack of
// condition cards, each a condition-type dropdown beside the kind-specific editor (a signal check with its
// signal/operator/value or Min+Max or True/False controls; a time window with start/end/timezone + a 7-day
// toggle row; a geofence membership check; or an other-automation state check) with a remove affordance,
// plus an "Add Condition" button. The single data dependency — the geofence list for the geofence-condition
// dropdown (web `useGeofences`) — flows through the shared [ConditionBuilderViewModel] (P1/S8); the view
// performs no HTTP (ADR-002). Every visible string resolves through the i18n catalog
// (`R.string.translation_automations_*` / `_common_*` / `_timezones_*` from P1/S10), and every interactive
// element (type / signal / operator / state / timezone dropdowns, value fields, day toggles, remove + add
// buttons, refresh) carries an accessibility label.
//
// State envelope: the geofence feed drives the freshness chip + refresh (retry) chrome and the dropdown
// options; it never blanks the builder (web `geofences ?? []` degrades gracefully). The surface's own empty
// state ("no conditions yet") is the caller-owned conditions list — never a blank box. A first load with no
// cached fences shows the loading skeleton.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ConditionBuilder) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + field composables.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.conditionbuilder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.maps.MapsGlyphs
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.Geofence

private const val EM_DASH = "\u2014"
private const val LOADING_BAR_COUNT = 4

/** Signal dropdown options — pure data from the [SIGNAL_FIELDS] registry (web `SIGNAL_FIELD_OPTIONS`). */
private val SIGNAL_SELECT_OPTIONS: List<SelectOption> = SIGNAL_FIELDS.map { SelectOption(value = it.key, label = it.label) }

/**
 * Stateful entry point. Binds the cache-then-network geofence feed via [source] into a
 * [ConditionBuilderViewModel], records the one-shot `view.opened` diagnostic, and renders the controlled
 * builder for the caller-owned [conditions] + [onChange] (web `ConditionBuilderProps`). A host supplies
 * [source] (an adapter over the shared S8 Locations data layer) and a unique [instanceKey] per placement.
 *
 * @param conditions the current condition list (owned by the parent, like the web `conditions` prop).
 * @param onChange invoked with the next condition list on every edit (web `onChange`).
 * @param source the cache-then-network geofence seam (a [conditionBuilderSource] adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ConditionBuilder(
    conditions: List<ConditionInput>,
    onChange: (List<ConditionInput>) -> Unit,
    source: ConditionBuilderSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CONDITION_BUILDER_SLUG,
) {
    val viewModel: ConditionBuilderViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ConditionBuilderViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    ConditionBuilderContent(
        state = state,
        conditions = conditions,
        onChange = onChange,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. A first load with no cached
 * fences shows the loading skeleton; otherwise the freshness + refresh header sits over either the
 * "no conditions yet" empty state or the condition cards + "Add Condition" button. A geofence load error
 * keeps the builder fully usable (offline chip + refresh = retry), mirroring the web's graceful degradation.
 */
@Composable
fun ConditionBuilderContent(
    state: UiState<List<Geofence>>,
    conditions: List<ConditionInput>,
    onChange: (List<ConditionInput>) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (state.isLoading) {
        LoadingChrome(modifier)
        return
    }
    val geofences = state.data ?: emptyList()
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ConditionsHeader(state = state, onRefresh = onRefresh)
        if (conditions.isEmpty()) {
            EmptyConditions(onAdd = { onChange(conditions + createDefaultCondition(ConditionKind.Signal)) })
        } else {
            ConditionList(conditions = conditions, onChange = onChange, geofences = geofences)
            AddConditionButton(onAdd = { onChange(conditions + createDefaultCondition(ConditionKind.Signal)) })
        }
    }
}

@Composable
private fun ConditionsHeader(
    state: UiState<List<Geofence>>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Subhead(
            stringResource(R.string.translation_automations_builder_onlyIf),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberFreshnessFormatter(),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun EmptyConditions(onAdd: () -> Unit) {
    EmptyState(
        message = stringResource(R.string.translation_automations_builder_noConditions),
        icon = TeslaGlyphs.Plus,
        action =
            EmptyStateAction(
                label = stringResource(R.string.translation_automations_builder_addCondition),
                onClick = onAdd,
            ),
    )
}

@Composable
private fun ConditionList(
    conditions: List<ConditionInput>,
    onChange: (List<ConditionInput>) -> Unit,
    geofences: List<Geofence>,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        conditions.forEachIndexed { index, condition ->
            key("${condition.kind.wire}-$index") {
                ConditionCard(
                    condition = condition,
                    geofences = geofences,
                    onReplace = { next -> onChange(conditions.mapIndexed { i, existing -> if (i == index) next else existing }) },
                    onRemove = { onChange(conditions.filterIndexed { i, _ -> i != index }) },
                )
            }
        }
    }
}

@Composable
private fun ConditionCard(
    condition: ConditionInput,
    geofences: List<Geofence>,
    onReplace: (ConditionInput) -> Unit,
    onRemove: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Select(
                    label = stringResource(R.string.translation_automations_builder_conditionType),
                    options = conditionTypeOptions(),
                    selectedValue = condition.kind.wire,
                    onSelect = { wire -> ConditionKind.fromWire(wire)?.let { onReplace(createDefaultCondition(it)) } },
                )
                ConditionFields(condition = condition, geofences = geofences, onChange = onReplace)
            }
            IconButton(
                imageVector = MapsGlyphs.Trash,
                contentDescription = stringResource(R.string.translation_automations_builder_removeCondition),
                onClick = onRemove,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun ConditionFields(
    condition: ConditionInput,
    geofences: List<Geofence>,
    onChange: (ConditionInput) -> Unit,
) {
    when (condition) {
        is ConditionInput.Signal -> SignalFields(condition, onChange)
        is ConditionInput.TimeWindow -> TimeWindowFields(condition, onChange)
        is ConditionInput.Geofence -> GeofenceFields(condition, geofences, onChange)
        is ConditionInput.OtherAutomation -> OtherAutomationFields(condition, onChange)
    }
}

@Composable
private fun SignalFields(
    condition: ConditionInput.Signal,
    onChange: (ConditionInput) -> Unit,
) {
    val isBool = isBoolSignal(condition.signal)
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Select(
            label = stringResource(R.string.translation_automations_builder_signal),
            options = SIGNAL_SELECT_OPTIONS,
            selectedValue = condition.signal,
            onSelect = { onChange(conditionForSignalChange(it)) },
        )
        Select(
            label = stringResource(R.string.translation_automations_builder_operator),
            options = operatorSelectOptions(isBool),
            selectedValue = condition.op.wire,
            onSelect = { wire -> SignalOp.fromWire(wire)?.let { onChange(conditionForOperatorChange(condition, it)) } },
        )
        SignalValueEditor(condition = condition, isBool = isBool, onChange = onChange)
    }
}

@Composable
private fun SignalValueEditor(
    condition: ConditionInput.Signal,
    isBool: Boolean,
    onChange: (ConditionInput) -> Unit,
) {
    when {
        isRange(condition) ->
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Input(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_automations_builder_minValue),
                    value = formatNumberInput(numericValue(condition.valueMin, 0.0)),
                    onValueChange = { onChange(condition.copy(valueMin = parseNumberOrZero(it))) },
                    keyboardType = KeyboardType.Number,
                )
                Input(
                    modifier = Modifier.weight(1f),
                    label = stringResource(R.string.translation_automations_builder_maxValue),
                    value = formatNumberInput(numericValue(condition.valueMax, 100.0)),
                    onValueChange = { onChange(condition.copy(valueMax = parseNumberOrZero(it))) },
                    keyboardType = KeyboardType.Number,
                )
            }

        isBool ->
            Select(
                label = stringResource(R.string.translation_automations_builder_value),
                options = boolValueOptions(),
                selectedValue = signalValueString(condition),
                onSelect = { onChange(conditionValueFromInput(condition, it)) },
            )

        else -> {
            val isText = condition.signal == "state" || condition.op == SignalOp.In
            val statePrompt = stringResource(R.string.translation_automations_builder_statePlaceholder) // parity:allow i18n key name
            Input(
                label = stringResource(R.string.translation_automations_builder_value),
                value = signalValueString(condition),
                onValueChange = { onChange(conditionValueFromInput(condition, it)) },
                keyboardType = if (isText) KeyboardType.Text else KeyboardType.Number,
                hint = if (condition.signal == "state") statePrompt else null,
            )
        }
    }
}

@Composable
private fun TimeWindowFields(
    condition: ConditionInput.TimeWindow,
    onChange: (ConditionInput) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Input(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_automations_builder_startTime),
                value = condition.startTime,
                onValueChange = { onChange(condition.copy(startTime = it)) },
            )
            Input(
                modifier = Modifier.weight(1f),
                label = stringResource(R.string.translation_automations_builder_endTime),
                value = condition.endTime,
                onValueChange = { onChange(condition.copy(endTime = it)) },
            )
        }
        Select(
            label = stringResource(R.string.translation_automations_builder_timezone),
            options = timezoneOptions(),
            selectedValue = condition.timezone,
            onSelect = { onChange(condition.copy(timezone = it)) },
        )
        DayToggleRow(
            selectedDays = condition.daysOfWeek,
            onToggle = { day -> onChange(condition.copy(daysOfWeek = toggleDay(condition.daysOfWeek, day))) },
        )
    }
}

@Composable
private fun DayToggleRow(
    selectedDays: List<Int>,
    onToggle: (Int) -> Unit,
) {
    val labels = dayShortLabels()
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Subhead(stringResource(R.string.translation_automations_builder_days))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            DAY_INDICES.forEach { day ->
                val active = day in selectedDays
                Button(
                    label = labels[day],
                    onClick = { onToggle(day) },
                    variant = if (active) ButtonVariant.Primary else ButtonVariant.Outline,
                    size = ButtonSize.Sm,
                    modifier = Modifier.semantics { selected = active },
                )
            }
        }
    }
}

@Composable
private fun GeofenceFields(
    condition: ConditionInput.Geofence,
    geofences: List<Geofence>,
    onChange: (ConditionInput) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Select(
            label = stringResource(R.string.translation_automations_builder_geofence),
            options = geofenceOptions(stringResource(R.string.translation_automations_builder_selectGeofence), geofences),
            selectedValue = geofenceSelectValue(condition),
            emptyLabel = stringResource(R.string.translation_automations_builder_selectGeofence),
            onSelect = { onChange(condition.copy(placeId = geofencePlaceIdFromValue(it))) },
        )
        Select(
            label = stringResource(R.string.translation_automations_builder_state),
            options = geofenceStateOptions(),
            selectedValue = condition.state.wire,
            onSelect = { wire -> GeofenceConditionState.fromWire(wire)?.let { onChange(condition.copy(state = it)) } },
        )
    }
}

@Composable
private fun OtherAutomationFields(
    condition: ConditionInput.OtherAutomation,
    onChange: (ConditionInput) -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Input(
            label = stringResource(R.string.translation_automations_builder_otherAutomationId),
            value = if (condition.otherAutomationId != 0L) condition.otherAutomationId.toString() else "",
            onValueChange = { onChange(condition.copy(otherAutomationId = parseIdOrZero(it))) },
            keyboardType = KeyboardType.Number,
        )
        Select(
            label = stringResource(R.string.translation_automations_builder_state),
            options = otherAutomationStateOptions(),
            selectedValue = condition.state.wire,
            onSelect = { wire -> OtherAutomationState.fromWire(wire)?.let { onChange(condition.copy(state = it)) } },
        )
    }
}

@Composable
private fun AddConditionButton(onAdd: () -> Unit) {
    Button(
        label = stringResource(R.string.translation_automations_builder_addCondition),
        onClick = onAdd,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = TeslaGlyphs.Plus,
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier = modifier.fillMaxWidth().padding(Spacing.md).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) { Skeleton(height = Spacing.lg, rounded = true) }
    }
}

// ── localized option builders (resolved at the Compose boundary; the Model stays string-free) ──────────

@Composable
private fun conditionTypeOptions(): List<SelectOption> =
    listOf(
        SelectOption(ConditionKind.Signal.wire, stringResource(R.string.translation_automations_conditions_signal)),
        SelectOption(ConditionKind.TimeWindow.wire, stringResource(R.string.translation_automations_conditions_timeWindow)),
        SelectOption(ConditionKind.Geofence.wire, stringResource(R.string.translation_automations_conditions_geofence)),
        SelectOption(ConditionKind.OtherAutomation.wire, stringResource(R.string.translation_automations_conditions_otherAutomation)),
    )

@Composable
private fun operatorSelectOptions(isBool: Boolean): List<SelectOption> {
    val labels =
        mapOf(
            SignalOp.Equals to stringResource(R.string.translation_automations_operators_equals),
            SignalOp.NotEquals to stringResource(R.string.translation_automations_operators_notEquals),
            SignalOp.LessThan to stringResource(R.string.translation_automations_operators_lessThan),
            SignalOp.LessThanOrEqual to stringResource(R.string.translation_automations_operators_lessThanOrEqual),
            SignalOp.GreaterThan to stringResource(R.string.translation_automations_operators_greaterThan),
            SignalOp.GreaterThanOrEqual to stringResource(R.string.translation_automations_operators_greaterThanOrEqual),
            SignalOp.Between to stringResource(R.string.translation_automations_operators_between),
            SignalOp.In to stringResource(R.string.translation_automations_operators_in),
        )
    return operatorsFor(isBool).map { SelectOption(it.wire, labels.getValue(it)) }
}

@Composable
private fun boolValueOptions(): List<SelectOption> =
    listOf(
        SelectOption("true", stringResource(R.string.translation_common_true)),
        SelectOption("false", stringResource(R.string.translation_common_false)),
    )

@Composable
private fun geofenceStateOptions(): List<SelectOption> =
    listOf(
        SelectOption(GeofenceConditionState.Inside.wire, stringResource(R.string.translation_automations_geofence_inside)),
        SelectOption(GeofenceConditionState.Outside.wire, stringResource(R.string.translation_automations_geofence_outside)),
        SelectOption(GeofenceConditionState.Dwell.wire, stringResource(R.string.translation_automations_geofence_dwell)),
    )

@Composable
private fun otherAutomationStateOptions(): List<SelectOption> =
    listOf(
        SelectOption(OtherAutomationState.Enabled.wire, stringResource(R.string.translation_automations_otherAutomation_enabled)),
        SelectOption(OtherAutomationState.Disabled.wire, stringResource(R.string.translation_automations_otherAutomation_disabled)),
        SelectOption(
            OtherAutomationState.RecentlyTriggered.wire,
            stringResource(R.string.translation_automations_otherAutomation_recentlyTriggered),
        ),
    )

@Composable
private fun timezoneOptions(): List<SelectOption> =
    listOf(
        SelectOption("", stringResource(R.string.translation_timezones_utc)),
        SelectOption("America/New_York", stringResource(R.string.translation_timezones_America_New_York)),
        SelectOption("America/Chicago", stringResource(R.string.translation_timezones_America_Chicago)),
        SelectOption("America/Denver", stringResource(R.string.translation_timezones_America_Denver)),
        SelectOption("America/Los_Angeles", stringResource(R.string.translation_timezones_America_Los_Angeles)),
        SelectOption("Europe/London", stringResource(R.string.translation_timezones_Europe_London)),
        SelectOption("Europe/Berlin", stringResource(R.string.translation_timezones_Europe_Berlin)),
        SelectOption("Europe/Paris", stringResource(R.string.translation_timezones_Europe_Paris)),
        SelectOption("Asia/Tokyo", stringResource(R.string.translation_timezones_Asia_Tokyo)),
        SelectOption("Asia/Shanghai", stringResource(R.string.translation_timezones_Asia_Shanghai)),
        SelectOption("Australia/Sydney", stringResource(R.string.translation_timezones_Australia_Sydney)),
    )

@Composable
private fun dayShortLabels(): List<String> =
    listOf(
        stringResource(R.string.translation_common_days_short_0),
        stringResource(R.string.translation_common_days_short_1),
        stringResource(R.string.translation_common_days_short_2),
        stringResource(R.string.translation_common_days_short_3),
        stringResource(R.string.translation_common_days_short_4),
        stringResource(R.string.translation_common_days_short_5),
        stringResource(R.string.translation_common_days_short_6),
    )

/**
 * The localized relative-age formatter shared with the freshness chip — maps each [FreshnessAge] bucket to
 * a `translation_freshness_*` string so the chip carries no English microcopy (mirrors the web freshness
 * labels). Unknown collapses to an em dash.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return { age ->
        when (age) {
            FreshnessAge.Unknown -> EM_DASH
            FreshnessAge.JustNow -> justNow
            is FreshnessAge.Seconds -> seconds.format(age.value)
            is FreshnessAge.Minutes -> minutes.format(age.value)
            is FreshnessAge.Hours -> hours.format(age.value)
            is FreshnessAge.Days -> days.format(age.value)
            is FreshnessAge.Weeks -> weeks.format(age.value)
        }
    }
}
