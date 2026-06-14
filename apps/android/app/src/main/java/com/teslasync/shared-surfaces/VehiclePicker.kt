// The native Jetpack Compose + Material 3 VehiclePicker shared surface — a parity port of
// web/src/components/layout/VehiclePicker.tsx. The web component is the persistent, app-wide vehicle selector
// mounted in the sidebar header: a drop-in `<Select>` wired to the global `useSelectedVehicle()` store, made
// PIN-AWARE by `usePinned('vehicle')` (pinned vehicles float to the top in pin order, the rest keep API order,
// and a pinned label is prefixed with 📌). It lists every enrolled vehicle (label =
// display_name || vin || "Vehicle {id}"), writes the chosen id back through `setVehicleId`, carries the
// accessible label "Select vehicle" behind a leading car icon, and HIDES itself for a fleet of <= 1 vehicle.
//
// This native surface keeps that contract end to end while using platform-idiomatic primitives (the shared
// Material 3 `Select` exposed-dropdown, the shared `Icon`/`Badge`/`Skeleton`/`EmptyState`/`QueryError`/
// `BodyText`) and renders every state the P3 matrix mandates without ever hiding a region: loading (a
// select-shaped skeleton during the first fleet fetch), content (the pin-ordered dropdown), single (a compact,
// non-interactive single-vehicle indicator — the web returns `null` here, a self-contained native surface
// shows the active vehicle instead of a blank box), empty (the friendly "no vehicle selected" state), a hard
// error with Retry, and — through the ADR-013 cache-then-network freshness contract — stale / offline (the
// cached fleet kept selectable with a freshness chip). All data flows through [VehiclePickerViewModel] (P1/S8);
// the view performs NO HTTP. Every string resolves through the i18n facade (P1/S10) via `stringResource`; the
// dropdown trigger exposes a merged TalkBack label and a one-shot PII-safe `view.opened` diagnostic (P1/S11)
// fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehiclePicker) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepicker

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the rendered picker in any state. */
const val VEHICLE_PICKER_TEST_TAG: String = "vehicle-picker"

/** Test tag on the dropdown trigger — used by the a11y + UI tests when the fleet has >= 2 vehicles. */
const val VEHICLE_PICKER_TRIGGER_TEST_TAG: String = "vehicle-picker-trigger"

/** Test tag on the single-vehicle indicator — used by the UI test when the fleet has exactly 1 vehicle. */
const val VEHICLE_PICKER_SINGLE_TEST_TAG: String = "vehicle-picker-single"

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests/previews pass a deterministic instance), keeping the render branches locale-stable. Every string
 * resolves through the P1/S10 catalog.
 *
 * @property ariaLabel the dropdown accessible label (web `t('vehiclePicker.aria', 'Select vehicle')`).
 * @property fallbackWord the "Vehicle" word used to build the "Vehicle {id}" option fallback.
 * @property loadingLabel the TalkBack label for the loading skeleton.
 * @property staleLabel the freshness chip shown when the cached fleet is past its TTL.
 * @property offlineLabel the freshness chip shown when the cached fleet is served after a failed refresh.
 * @property updatingLabel the freshness chip shown while a refresh is in flight over the cached fleet.
 * @property emptyTitle the empty-state title (web `NoVehicleSelected`).
 * @property emptyDesc the empty-state body.
 * @property errorResource the resource noun the error surface personalises.
 */
data class VehiclePickerStrings(
    val ariaLabel: String,
    val fallbackWord: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val updatingLabel: String,
    val emptyTitle: String,
    val emptyDesc: String,
    val errorResource: String,
)

/**
 * Stateful entry point — the parity port of the web `<VehiclePicker />` mounted in the sidebar header. Binds
 * the selection + fleet + pin seam via [source] into a [VehiclePickerViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11) on first composition, collects the live cache-then-network state, and
 * renders the picker.
 *
 * [source] defaults to the shared P1/S8 holders from the [LocalDataContainer] (so the picker is a true drop-in
 * like the web component); a host or test may inject a different seam. [logger] defaults to the process logger.
 */
@Composable
fun VehiclePicker(
    modifier: Modifier = Modifier,
    source: VehiclePickerSource = rememberVehiclePickerSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VehiclePickerViewModel =
        viewModel(
            key = VehiclePickerRegistration.ID,
            factory = VehiclePickerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    VehiclePickerContent(
        state = state,
        strings = rememberVehiclePickerStrings(),
        modifier = modifier,
        onSelect = viewModel::select,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the picker over
 * the cache-then-network [UiState]: loading ⇒ a select-shaped skeleton, hard error ⇒ [QueryError] + retry,
 * empty ⇒ a friendly [EmptyState], single vehicle ⇒ a non-interactive context indicator (web hides the picker
 * here), otherwise the pin-ordered dropdown (with a freshness chip while stale / refreshing / offline). Stale
 * (non-error) data auto-refreshes exactly once (web `useVehicles` refetch); offline keeps the cached fleet
 * selectable with the offline chip.
 */
@Composable
fun VehiclePickerContent(
    state: UiState<VehiclePickerData>,
    strings: VehiclePickerStrings,
    modifier: Modifier = Modifier,
    onSelect: (Long) -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val data = state.data ?: VehiclePickerData.EMPTY
    Column(
        modifier = modifier.fillMaxWidth().testTag(VEHICLE_PICKER_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        FadeIn(modifier = Modifier.fillMaxWidth()) {
            when {
                state.isLoading -> VehiclePickerLoading(strings = strings)
                state.isError -> VehiclePickerErrorBody(state = state, strings = strings, onRetry = onRetry)
                state.isEmpty -> VehiclePickerEmptyBody(strings = strings)
                data.isSingle -> VehiclePickerSingle(data = data, state = state, strings = strings)
                else -> VehiclePickerControl(data = data, state = state, strings = strings, onSelect = onSelect)
            }
        }
    }
}

/**
 * The interactive content branch — the pin-ordered dropdown itself (fleet of >= 2). Maps each row to a
 * [SelectOption] (web `value = String(id)`, `label = (isPinned ? '📌 ' : '') + (display_name || vin || 'Vehicle
 * {id}')`), seeds the current selection, writes the chosen id back (web `setVehicleId`), and exposes a merged
 * TalkBack label ("Select vehicle, {active}") on the trigger behind the leading car icon. A freshness chip is
 * shown while the cached fleet is stale / refreshing / offline.
 */
@Composable
private fun VehiclePickerControl(
    data: VehiclePickerData,
    state: UiState<VehiclePickerData>,
    strings: VehiclePickerStrings,
    onSelect: (Long) -> Unit,
) {
    val options = data.vehicles.map { SelectOption(it.id.toString(), vehicleOptionLabel(it, strings.fallbackWord)) }
    val selectedLabel = data.selectedRow?.let { vehicleOptionLabel(it, strings.fallbackWord) } ?: ""
    val accessibleLabel = vehiclePickerAccessibilityLabel(strings.ariaLabel, selectedLabel)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .testTag(VEHICLE_PICKER_TRIGGER_TEST_TAG)
                    .semantics(mergeDescendants = true) { contentDescription = accessibleLabel },
        ) {
            Select(
                options = options,
                selectedValue = data.effectiveSelectedId?.toString(),
                onSelect = { value -> value.toLongOrNull()?.let(onSelect) },
                emptyLabel = strings.ariaLabel,
            )
        }
        VehiclePickerFreshnessChip(state = state, strings = strings)
    }
}

/**
 * The single-vehicle branch — a compact, non-interactive indicator of the only enrolled vehicle behind the
 * leading car icon. The web returns `null` for a fleet of <= 1 ("nothing meaningful to pick"); a self-contained
 * native surface shows the active vehicle here instead of hiding the region (P3 state matrix). The row carries
 * the vehicle name as its TalkBack label, and keeps the same freshness chip as the dropdown.
 */
@Composable
private fun VehiclePickerSingle(
    data: VehiclePickerData,
    state: UiState<VehiclePickerData>,
    strings: VehiclePickerStrings,
) {
    val activeRow = data.selectedRow ?: data.vehicles.firstOrNull()
    val label = activeRow?.let { vehicleBaseLabel(it, strings.fallbackWord) } ?: strings.fallbackWord
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(VEHICLE_PICKER_SINGLE_TEST_TAG)
                .semantics(mergeDescendants = true) { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BodyText(
            text = label,
            modifier = Modifier.weight(1f),
            maxLines = 1,
        )
        VehiclePickerFreshnessChip(state = state, strings = strings)
    }
}

/**
 * The localized freshness chip: an offline chip while the cached fleet is shown after a failed refresh (web
 * "last known"), an "updating…" chip while a refresh is in flight, or a stale chip once the cached fleet passes
 * its TTL. Renders nothing while the fleet is fresh.
 */
@Composable
private fun VehiclePickerFreshnessChip(
    state: UiState<VehiclePickerData>,
    strings: VehiclePickerStrings,
) {
    when {
        state.hasError && state.hasData -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        state.refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        state.stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

/** The loading branch — a select-shaped skeleton behind the leading car icon, announced to TalkBack. */
@Composable
private fun VehiclePickerLoading(strings: VehiclePickerStrings) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Skeleton(modifier = Modifier.weight(1f), height = TRIGGER_SKELETON_HEIGHT, rounded = true)
    }
}

/** The hard-error branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun VehiclePickerErrorBody(
    state: UiState<VehiclePickerData>,
    strings: VehiclePickerStrings,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = vehiclePickerErrorKind(state.errorKind, state.httpStatus),
        resourceName = strings.errorResource,
        onRetry = onRetry,
    )
}

/** The empty branch — the friendly "no vehicle selected" state (web `NoVehicleSelected`), never a blank box. */
@Composable
private fun VehiclePickerEmptyBody(strings: VehiclePickerStrings) {
    EmptyState(
        message = strings.emptyDesc,
        modifier = Modifier.fillMaxWidth(),
        icon = NavGlyphs.Car,
        title = strings.emptyTitle,
    )
}

/** Builds the localized labels from the P1/S10 catalog; tests/previews pass a deterministic instance. */
@Composable
private fun rememberVehiclePickerStrings(): VehiclePickerStrings =
    VehiclePickerStrings(
        ariaLabel = stringResource(R.string.translation_vehiclePicker_aria),
        fallbackWord = stringResource(R.string.translation_statusBar_vehicle_fallback),
        loadingLabel = stringResource(R.string.translation_common_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
        emptyTitle = stringResource(R.string.translation_common_noVehicleSelected_title),
        emptyDesc = stringResource(R.string.translation_common_noVehicleSelected_desc),
        errorResource = stringResource(R.string.translation_common_vehicle),
    )

/** Resolves the shared P1/S8 selection + fleet + pin holders from the [LocalDataContainer] into the seam. */
@Composable
private fun rememberVehiclePickerSource(): VehiclePickerSource {
    val container = LocalDataContainer.current
    return remember(container) {
        vehiclePickerSource(container.selectedVehicleStore, container.vehiclesStore, container.pinnedStore)
    }
}

private val TRIGGER_SKELETON_HEIGHT: Dp = 56.dp

// ── Previews — one per rendered state (loading / content / content + pins / single / empty / stale /
// offline / error). ─────────────────────────────────────────────────────────────────────────────────────

private fun previewStrings(): VehiclePickerStrings =
    VehiclePickerStrings(
        ariaLabel = "Select vehicle",
        fallbackWord = "Vehicle",
        loadingLabel = "Loading...",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        updatingLabel = "updating…",
        emptyTitle = "No vehicle selected",
        emptyDesc = "Add a vehicle to your fleet to see data on this page.",
        errorResource = "Vehicle",
    )

private fun previewRow(
    id: Long,
    name: String,
    model: String?,
    pinned: Boolean,
    selected: Boolean,
): VehiclePickerRow =
    VehiclePickerRow(id = id, displayName = name, vin = "5YJ3E1EA7KF00000$id", model = model, pinned = pinned, selected = selected)

private fun previewFleet(
    selectedId: Long,
    withPins: Boolean = false,
): VehiclePickerData {
    val rows =
        listOf(
            previewRow(2, "Spacehauler", "Model Y", pinned = withPins, selected = selectedId == 2L),
            previewRow(1, "Red Rocket", "Model 3", pinned = false, selected = selectedId == 1L),
            previewRow(3, "Garage Queen", "Model S", pinned = false, selected = selectedId == 3L),
        )
    return VehiclePickerData(vehicles = rows, effectiveSelectedId = selectedId)
}

@Preview(name = "VehiclePicker · content", showBackground = true)
@Composable
private fun VehiclePickerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(state = UiState(UiPhase.Content, data = previewFleet(2)), strings = previewStrings())
    }
}

@Preview(name = "VehiclePicker · content + pins", showBackground = true)
@Composable
private fun VehiclePickerPinnedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(state = UiState(UiPhase.Content, data = previewFleet(2, withPins = true)), strings = previewStrings())
    }
}

@Preview(name = "VehiclePicker · single vehicle", showBackground = true)
@Composable
private fun VehiclePickerSinglePreview() {
    val data =
        VehiclePickerData(
            vehicles = listOf(previewRow(1, "Daily Driver", "Model 3", pinned = false, selected = true)),
            effectiveSelectedId = 1,
        )
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(state = UiState(UiPhase.Content, data = data), strings = previewStrings())
    }
}

@Preview(name = "VehiclePicker · loading", showBackground = true)
@Composable
private fun VehiclePickerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(state = UiState.loading(), strings = previewStrings())
    }
}

@Preview(name = "VehiclePicker · empty", showBackground = true)
@Composable
private fun VehiclePickerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(state = UiState(UiPhase.Empty, data = VehiclePickerData.EMPTY), strings = previewStrings())
    }
}

@Preview(name = "VehiclePicker · stale", showBackground = true)
@Composable
private fun VehiclePickerStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(
            state = UiState(UiPhase.Content, data = previewFleet(2), fetchedAt = 0L, stale = true, refreshing = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehiclePicker · offline", showBackground = true)
@Composable
private fun VehiclePickerOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(
            state = UiState(UiPhase.Content, data = previewFleet(2), fetchedAt = 0L, stale = true, errorKind = ErrorKind.Network),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehiclePicker · error", showBackground = true)
@Composable
private fun VehiclePickerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePickerContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), strings = previewStrings())
    }
}
