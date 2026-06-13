// Compose render layer for the WidgetSettingsModal surface — the native analogue of the JSX the web component returns
// (web/src/features/dashboard/components/WidgetSettingsModal.tsx). It is a thin shell over the pure
// [WidgetSettingsProjection] derivations + the [WidgetSettingsModalViewModel] vehicle feed: a Material 3 modal titled
// `${def.name} Settings`, hosting up to four sections — the vehicle picker (vehicle-scoped widgets only), the
// refresh-interval picker, the time-range picker (chart widgets only), and the "show widget title" toggle — above the
// Cancel + Save actions (Save hands the edited config to `onSave` then dismisses, web `handleSave`). The working config
// is local Compose state seeded from `widget.config` (web `useState`); spacing comes from the generated theme tokens
// (P1/S9). No HTTP.
//
// States: the only data source is the `useVehicles` feed behind the vehicle dropdown, so the ADR-013 cache lifecycle
// is surfaced there (and only there) via [UiState]: a first-load skeleton, a stale "updating" chip, an offline
// "last known" chip with retry, a hard-error inline message with retry, and a friendly "no vehicles" note — never a
// blank box, and the "All Vehicles" sentinel stays selectable through every phase so the control is always usable. The
// remaining three sections have no data source (pure local config), so they always render, exactly as the web
// component renders them unconditionally.
//
// i18n note (P1/S10): the web source titles the dialog `${def.name} Settings` and otherwise calls
// `t('dashboard.settings.*', '<default>')` / `t('common.*', '<default>')`. The `dashboard.settings.*` keys are NOT
// defined in the shared catalog (it carries `dashboard.settings` as the leaf string "Settings"), so every one of those
// calls resolves to its inline English default — exactly the SignalConfigModal situation. Every string still flows
// through the single [WidgetSettingsStrings] carrier (a localization seam a host/test/preview can override): the
// carrier binds the catalog keys that DO exist and are faithful (common.vehicle/cancel/save/close/retry/loading/
// offline, dashboard.settings -> the "Settings" title suffix) and otherwise carries the web's own inline-default copy
// verbatim. The vehicle-feed cache-phase chrome ("no vehicles", the load-error note) has no web analogue (the web
// silently degrades to an empty dropdown) and is the native-idiomatic surfacing the P3 states contract requires; it,
// too, flows through the carrier.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/WidgetSettingsModal) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed because the file's primary export is the `WidgetSettingsModal` composable (matching the filename); the
// co-located carrier/test-tags are supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.widgetsettingsmodal

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormSection
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects. */
object WidgetSettingsModalTestTags {
    const val ROOT: String = "widget-settings-modal"
    const val VEHICLE_SELECT: String = "widget-settings-vehicle-select"
    const val VEHICLE_LOADING: String = "widget-settings-vehicle-loading"
    const val VEHICLE_EMPTY: String = "widget-settings-vehicle-empty"
    const val VEHICLE_ERROR: String = "widget-settings-vehicle-error"
    const val VEHICLE_OFFLINE: String = "widget-settings-vehicle-offline"
    const val VEHICLE_STALE: String = "widget-settings-vehicle-stale"
    const val REFRESH_SELECT: String = "widget-settings-refresh-select"
    const val TIME_RANGE_SELECT: String = "widget-settings-timerange-select"
    const val SHOW_TITLE_TOGGLE: String = "widget-settings-show-title"
    const val CANCEL: String = "widget-settings-cancel"
    const val SAVE: String = "widget-settings-save"
}

/**
 * The already-resolved dialog microcopy the composable reads. Bundled into one carrier so the stateless
 * [WidgetSettingsModalContent] takes plain strings and stays trivially previewable + UI-testable. Where the shared
 * catalog (P1/S10) carries a faithful key it is reused via [rememberWidgetSettingsStrings]; the rest is the web
 * source's own inline-default copy (its `dashboard.settings.*` keys are not in the catalog — see the file header).
 */
data class WidgetSettingsStrings(
    val settingsSuffix: String,
    val close: String,
    val vehicle: String,
    val allVehicles: String,
    val refreshInterval: String,
    val refreshDefault: String,
    val refresh5s: String,
    val refresh15s: String,
    val refresh30s: String,
    val refresh60s: String,
    val timeRange: String,
    val range24h: String,
    val range7d: String,
    val range30d: String,
    val range90d: String,
    val appearance: String,
    val showTitle: String,
    val cancel: String,
    val save: String,
    val vehiclesLoading: String,
    val vehiclesEmpty: String,
    val vehiclesError: String,
    val vehiclesOffline: String,
    val retry: String,
)

/** Resolves every [WidgetSettingsStrings] entry — faithful catalog keys where they exist, else the web inline copy. */
@Composable
fun rememberWidgetSettingsStrings(): WidgetSettingsStrings =
    WidgetSettingsStrings(
        settingsSuffix = stringResource(R.string.translation_dashboard_settings),
        close = stringResource(R.string.translation_common_close),
        vehicle = stringResource(R.string.translation_common_vehicle),
        allVehicles = ALL_VEHICLES_LABEL,
        refreshInterval = REFRESH_INTERVAL_LABEL,
        refreshDefault = REFRESH_DEFAULT_LABEL,
        refresh5s = REFRESH_5S_LABEL,
        refresh15s = REFRESH_15S_LABEL,
        refresh30s = REFRESH_30S_LABEL,
        refresh60s = REFRESH_60S_LABEL,
        timeRange = TIME_RANGE_LABEL,
        range24h = RANGE_24H_LABEL,
        range7d = RANGE_7D_LABEL,
        range30d = RANGE_30D_LABEL,
        range90d = RANGE_90D_LABEL,
        appearance = APPEARANCE_LABEL,
        showTitle = SHOW_TITLE_LABEL,
        cancel = stringResource(R.string.translation_common_cancel),
        save = stringResource(R.string.translation_common_save),
        vehiclesLoading = stringResource(R.string.translation_common_loading),
        vehiclesEmpty = VEHICLES_EMPTY_LABEL,
        vehiclesError = VEHICLES_ERROR_LABEL,
        vehiclesOffline = stringResource(R.string.translation_common_offline),
        retry = stringResource(R.string.translation_common_retry),
    )

/**
 * Stateful entry point — the faithful port of the web `WidgetSettingsModal({ widget, def, open, onClose, onSave })`.
 * The owning view gates composition (web `open`); on first composition it records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), binds the `useVehicles` feed (P1/S8) for the vehicle dropdown, and hosts the titled modal. The
 * edited config is handed to [onSave] and the sheet then dismisses (web `handleSave` -> `onSave(config)` + `onClose()`).
 *
 * @param def the widget definition (its name titles the dialog; its category drives which sections render, web `def`).
 * @param widget the widget instance being configured; its config seeds the working state (web `widget`).
 * @param onClose dismiss handler (web `onClose`); invoked by Cancel/close and after a successful save.
 * @param onSave receives the edited config on Save (web `onSave`).
 * @param source the enrolled-vehicle read seam (defaults to the shared S8 store binding; tests pass a fake).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WidgetSettingsModal(
    def: WidgetDefInfo,
    widget: WidgetInstanceInfo,
    onClose: () -> Unit,
    onSave: (WidgetConfig) -> Unit,
    modifier: Modifier = Modifier,
    source: WidgetSettingsVehiclesSource = widgetSettingsVehiclesSource(LocalDataContainer.current.vehiclesStore),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = WidgetSettingsModalRegistration.ID,
) {
    val viewModel: WidgetSettingsModalViewModel =
        viewModel(key = instanceKey, factory = WidgetSettingsModalViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val vehiclesState by viewModel.vehicles.collectAsStateWithLifecycle()
    val strings = rememberWidgetSettingsStrings()
    val title = "${def.name} ${strings.settingsSuffix}"

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = title,
        accessibleName = title,
        closeLabel = strings.close,
    ) {
        WidgetSettingsModalContent(
            def = def,
            widget = widget,
            vehiclesState = vehiclesState,
            strings = strings,
            onSave = onSave,
            onClose = onClose,
            onRefreshVehicles = viewModel::refresh,
        )
    }
}

/**
 * Stateless renderer + working-config owner — the unit/UI-test + preview entry point. Seeds its working config from
 * [widget] (web `useState(widget.config ?? {})`), renders the category-gated sections, projects every edit through
 * [WidgetSettingsProjection], and hands the assembled config back through [onSave] on Save (then [onClose]).
 */
@Composable
fun WidgetSettingsModalContent(
    def: WidgetDefInfo,
    widget: WidgetInstanceInfo,
    vehiclesState: UiState<List<Vehicle>>,
    strings: WidgetSettingsStrings,
    onSave: (WidgetConfig) -> Unit,
    onClose: () -> Unit,
    onRefreshVehicles: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var config by remember(widget) { mutableStateOf(widget.config) }

    Column(
        modifier = modifier.testTag(WidgetSettingsModalTestTags.ROOT).fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        if (WidgetSettingsProjection.isVehicleWidget(def.category)) {
            VehicleSection(
                state = vehiclesState,
                config = config,
                strings = strings,
                onConfigChange = { config = it },
                onRetry = onRefreshVehicles,
            )
        }
        RefreshSection(config = config, strings = strings, onConfigChange = { config = it })
        if (WidgetSettingsProjection.isChartWidget(def.category)) {
            TimeRangeSection(config = config, strings = strings, onConfigChange = { config = it })
        }
        AppearanceSection(config = config, strings = strings, onConfigChange = { config = it })
        ActionsRow(
            strings = strings,
            onCancel = onClose,
            onSave = {
                onSave(config)
                onClose()
            },
        )
    }
}

/** Vehicle picker (web `isVehicleWidget` branch): the "all + enrolled vehicles" dropdown + its cache-phase chrome. */
@Composable
private fun VehicleSection(
    state: UiState<List<Vehicle>>,
    config: WidgetConfig,
    strings: WidgetSettingsStrings,
    onConfigChange: (WidgetConfig) -> Unit,
    onRetry: () -> Unit,
) {
    FormSection(title = strings.vehicle) {
        val options =
            remember(state.data, strings.allVehicles, strings.vehicle) {
                WidgetSettingsProjection
                    .vehicleOptions(state.data ?: emptyList(), strings.allVehicles, strings.vehicle)
                    .map { SelectOption(it.value, it.label) }
            }
        Select(
            options = options,
            selectedValue = WidgetSettingsProjection.vehicleSelectValue(config),
            onSelect = { onConfigChange(WidgetSettingsProjection.withVehicleId(config, it)) },
            modifier = Modifier.testTag(WidgetSettingsModalTestTags.VEHICLE_SELECT),
            emptyLabel = strings.allVehicles,
        )
        VehicleFeedStatus(state = state, strings = strings, onRetry = onRetry)
    }
}

/**
 * The vehicle feed's cache-phase chrome (ADR-013) — rendered beneath the always-usable dropdown so every state is
 * visible and none blanks the section: a first-load skeleton, an offline "last known" chip + retry, a hard-error note
 * + retry, a stale "updating" chip, and a friendly "no vehicles" note. A fresh, populated feed adds nothing (the
 * dropdown itself is the content).
 */
@Composable
private fun VehicleFeedStatus(
    state: UiState<List<Vehicle>>,
    strings: WidgetSettingsStrings,
    onRetry: () -> Unit,
) {
    when {
        state.isLoading -> LoadingRow(strings.vehiclesLoading)
        state.isError ->
            RetryRow(
                tag = WidgetSettingsModalTestTags.VEHICLE_ERROR,
                icon = TeslaGlyphs.Warning,
                tint = TeslaTokens.status.danger,
                message = strings.vehiclesError,
                retryLabel = strings.retry,
                onRetry = onRetry,
                danger = true,
            )
        state.isOffline ->
            RetryRow(
                tag = WidgetSettingsModalTestTags.VEHICLE_OFFLINE,
                icon = FeedbackGlyphs.WifiOff,
                tint = TeslaTokens.status.warning,
                message = strings.vehiclesOffline,
                retryLabel = strings.retry,
                onRetry = onRetry,
                danger = false,
            )
        state.refreshing -> UpdatingRow(strings.vehiclesLoading)
        state.isEmpty -> EmptyRow(strings.vehiclesEmpty)
        else -> Unit
    }
}

/** First-load chrome (web silently degrades; native surfaces the loading phase): a shimmer bar + a localized hint. */
@Composable
private fun LoadingRow(label: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(WidgetSettingsModalTestTags.VEHICLE_LOADING)
                .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(modifier = Modifier.weight(1f), widthFraction = LOADING_SKELETON_FRACTION, height = LOADING_BAR_HEIGHT)
        HelperText(label)
    }
}

/** Stale/refreshing chrome: a small spinner + the "updating" hint while a refresh runs over cached vehicles. */
@Composable
private fun UpdatingRow(label: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(WidgetSettingsModalTestTags.VEHICLE_STALE)
                .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CircularProgressIndicator(modifier = Modifier.size(PROGRESS_SIZE), strokeWidth = PROGRESS_STROKE)
        HelperText(label)
    }
}

/** Empty chrome (web degrades to an "all"-only dropdown): a friendly localized note, never a blank box. */
@Composable
private fun EmptyRow(label: String) {
    Caption(
        text = label,
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(WidgetSettingsModalTestTags.VEHICLE_EMPTY)
                .semantics { contentDescription = label },
    )
}

/** Offline/error chrome: a tinted icon + message + a Retry action (the QueryError-equivalent for this inline section). */
@Composable
private fun RetryRow(
    tag: String,
    icon: ImageVector,
    tint: Color,
    message: String,
    retryLabel: String,
    onRetry: () -> Unit,
    danger: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(tag)
                .semantics { contentDescription = message },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Sm, tint = tint)
        if (danger) {
            ErrorText(message, modifier = Modifier.weight(1f))
        } else {
            Caption(message, modifier = Modifier.weight(1f))
        }
        Button(retryLabel, onClick = onRetry, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
    }
}

/** Refresh-interval picker (always shown, web unconditional): default + 5/15/30/60s cadences. */
@Composable
private fun RefreshSection(
    config: WidgetConfig,
    strings: WidgetSettingsStrings,
    onConfigChange: (WidgetConfig) -> Unit,
) {
    FormSection(title = strings.refreshInterval) {
        Select(
            options = refreshOptions(strings),
            selectedValue = WidgetSettingsProjection.refreshSelectValue(config),
            onSelect = { onConfigChange(WidgetSettingsProjection.withRefreshRate(config, it)) },
            modifier = Modifier.testTag(WidgetSettingsModalTestTags.REFRESH_SELECT),
        )
    }
}

/** Time-range picker (web `isChartWidget` branch): 24h/7d/30d/90d windows. */
@Composable
private fun TimeRangeSection(
    config: WidgetConfig,
    strings: WidgetSettingsStrings,
    onConfigChange: (WidgetConfig) -> Unit,
) {
    FormSection(title = strings.timeRange) {
        Select(
            options = timeRangeOptions(strings),
            selectedValue = WidgetSettingsProjection.timeRangeSelectValue(config),
            onSelect = { onConfigChange(WidgetSettingsProjection.withTimeRange(config, it)) },
            modifier = Modifier.testTag(WidgetSettingsModalTestTags.TIME_RANGE_SELECT),
        )
    }
}

/** Appearance section (always shown): the "show widget title" switch (web `config.showTitle !== false` default ON). */
@Composable
private fun AppearanceSection(
    config: WidgetConfig,
    strings: WidgetSettingsStrings,
    onConfigChange: (WidgetConfig) -> Unit,
) {
    FormSection(title = strings.appearance) {
        Toggle(
            checked = WidgetSettingsProjection.showTitleChecked(config),
            onCheckedChange = { onConfigChange(WidgetSettingsProjection.withShowTitle(config, it)) },
            label = strings.showTitle,
            modifier = Modifier.testTag(WidgetSettingsModalTestTags.SHOW_TITLE_TOGGLE),
        )
    }
}

/** The Cancel + Save footer (web actions row). Save is the primary affirmative; Cancel is the ghost dismissal. */
@Composable
private fun ActionsRow(
    strings: WidgetSettingsStrings,
    onCancel: () -> Unit,
    onSave: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
    ) {
        Button(
            label = strings.cancel,
            onClick = onCancel,
            variant = ButtonVariant.Ghost,
            modifier = Modifier.testTag(WidgetSettingsModalTestTags.CANCEL),
        )
        Button(
            label = strings.save,
            onClick = onSave,
            variant = ButtonVariant.Primary,
            modifier = Modifier.testTag(WidgetSettingsModalTestTags.SAVE),
        )
    }
}

/** The refresh dropdown options, in web presentation order (default + the [WidgetSettingsProjection] cadence ladder). */
private fun refreshOptions(strings: WidgetSettingsStrings): List<SelectOption> =
    buildList {
        add(SelectOption(WidgetSettingsProjection.REFRESH_DEFAULT_VALUE, strings.refreshDefault))
        WidgetSettingsProjection.REFRESH_RATE_VALUES.forEach { value ->
            add(SelectOption(value.toString(), refreshLabel(value, strings)))
        }
    }

private fun refreshLabel(
    value: Int,
    strings: WidgetSettingsStrings,
): String =
    when (value) {
        REFRESH_5S_VALUE -> strings.refresh5s
        REFRESH_15S_VALUE -> strings.refresh15s
        REFRESH_30S_VALUE -> strings.refresh30s
        REFRESH_60S_VALUE -> strings.refresh60s
        else -> value.toString()
    }

/** The time-range dropdown options, in web presentation order (the [WidgetSettingsProjection] window ladder). */
private fun timeRangeOptions(strings: WidgetSettingsStrings): List<SelectOption> =
    WidgetSettingsProjection.TIME_RANGE_VALUES.map { token -> SelectOption(token, timeRangeLabel(token, strings)) }

private fun timeRangeLabel(
    token: String,
    strings: WidgetSettingsStrings,
): String =
    when (token) {
        RANGE_24H_TOKEN -> strings.range24h
        RANGE_7D_TOKEN -> strings.range7d
        RANGE_30D_TOKEN -> strings.range30d
        RANGE_90D_TOKEN -> strings.range90d
        else -> token
    }

// Refresh-cadence wire values (web option `value`s) — named so the label lookup carries no bare literals.
private const val REFRESH_5S_VALUE = 5
private const val REFRESH_15S_VALUE = 15
private const val REFRESH_30S_VALUE = 30
private const val REFRESH_60S_VALUE = 60

// Time-range wire tokens (web option `value`s).
private const val RANGE_24H_TOKEN = "24h"
private const val RANGE_7D_TOKEN = "7d"
private const val RANGE_30D_TOKEN = "30d"
private const val RANGE_90D_TOKEN = "90d"

// Cache-phase chrome sizing.
private const val LOADING_SKELETON_FRACTION = 0.5f
private val LOADING_BAR_HEIGHT = 12.dp
private val PROGRESS_SIZE = 16.dp
private val PROGRESS_STROKE = 2.dp

// Web inline-default copy (its `dashboard.settings.*` keys are not in the catalog — see the file header). Carried here
// so the composable holds no inline copy and a host/test can override the whole carrier.
private const val ALL_VEHICLES_LABEL = "All Vehicles (first)"
private const val REFRESH_INTERVAL_LABEL = "Refresh Interval"
private const val REFRESH_DEFAULT_LABEL = "Default"
private const val REFRESH_5S_LABEL = "5 seconds"
private const val REFRESH_15S_LABEL = "15 seconds"
private const val REFRESH_30S_LABEL = "30 seconds"
private const val REFRESH_60S_LABEL = "1 minute"
private const val TIME_RANGE_LABEL = "Time Range"
private const val RANGE_24H_LABEL = "Last 24 hours"
private const val RANGE_7D_LABEL = "Last 7 days"
private const val RANGE_30D_LABEL = "Last 30 days"
private const val RANGE_90D_LABEL = "Last 90 days"
private const val APPEARANCE_LABEL = "Appearance"
private const val SHOW_TITLE_LABEL = "Show widget title"

// Vehicle-feed cache-phase chrome (no web analogue — the web degrades to an empty dropdown). Native-idiomatic copy.
private const val VEHICLES_EMPTY_LABEL = "No vehicles available"
private const val VEHICLES_ERROR_LABEL = "Couldn't load vehicles"
