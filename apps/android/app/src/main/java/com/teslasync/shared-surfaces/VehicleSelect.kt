// The native Jetpack Compose + Material 3 VehicleSelect shared surface — a parity port of
// web/src/components/forms/VehicleSelect.tsx. The web component is the canonical per-page vehicle-scope
// picker: a drop-in `<Select>` wired to the global `useSelectedVehicle()` store that lists every enrolled
// vehicle (label = display_name || vin || "Vehicle {id}"), renders for any fleet of >= 1 vehicle, writes the
// chosen id back through `setVehicleId`, carries the accessible label "Select vehicle", and optionally
// prefixes a small car icon (`withIcon`).
//
// This native surface keeps that contract end to end while using platform-idiomatic primitives (the shared
// Material 3 `Select` exposed-dropdown, the shared `Icon`/`Badge`/`Skeleton`/`EmptyState`/`QueryError`) and
// renders every state the P3 matrix mandates without ever hiding a region: loading (a select-shaped skeleton
// during the first fleet fetch), content (the dropdown, optionally icon-prefixed), empty (the friendly
// "no vehicle selected" state — the web defers this to the host page's `<NoVehicleSelected>`, a self-contained
// native surface shows it itself), a hard error with Retry, and — through the ADR-013 cache-then-network
// freshness contract — stale / offline (the cached fleet kept selectable with a freshness chip). All data
// flows through [VehicleSelectViewModel] (P1/S8); the view performs NO HTTP. Every string resolves through the
// i18n facade (P1/S10) via `stringResource`; the dropdown trigger exposes a merged TalkBack label and a
// one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// The atomic `components/forms/VehicleSelect` is the bare presentational dropdown (the component-library
// bundle, out of scope here); THIS surface is the state-aware, store-bound picker built around the same
// `Select`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleSelect) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicleselect

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
const val VEHICLE_SELECT_TEST_TAG: String = "vehicle-select"

/** Test tag on the dropdown trigger (the web `data-testid="vehicle-select"`) — used by the a11y + UI tests. */
const val VEHICLE_SELECT_TRIGGER_TEST_TAG: String = "vehicle-select-trigger"

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests/previews pass a deterministic instance), keeping the render branches locale-stable. Every string
 * resolves through the P1/S10 catalog.
 *
 * @property ariaLabel the dropdown accessible label (web `t('vehicleSelect.aria', 'Select vehicle')`).
 * @property fallbackWord the "Vehicle" word used to build the "Vehicle {id}" option fallback.
 * @property loadingLabel the TalkBack label for the loading skeleton.
 * @property staleLabel the freshness chip shown when the cached fleet is past its TTL.
 * @property offlineLabel the freshness chip shown when the cached fleet is served after a failed refresh.
 * @property updatingLabel the freshness chip shown while a refresh is in flight over the cached fleet.
 * @property emptyTitle the empty-state title (web `NoVehicleSelected`).
 * @property emptyDesc the empty-state body.
 * @property errorResource the resource noun the error surface personalises.
 */
data class VehicleSelectStrings(
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
 * Stateful entry point — the parity port of the web `<VehicleSelect withIcon={…} />`. Binds the selection +
 * fleet seam via [source] into a [VehicleSelectViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, collects the live cache-then-network state, and renders the picker.
 *
 * [source] defaults to the shared P1/S8 holders from the [LocalDataContainer] (so the picker is a true
 * drop-in like the web component); a host or test may inject a different seam. [logger] defaults to the
 * process logger.
 *
 * @param withIcon when true, prefixes a small car icon before the dropdown (web `withIcon`, default false).
 */
@Composable
fun VehicleSelect(
    modifier: Modifier = Modifier,
    withIcon: Boolean = false,
    source: VehicleSelectSource = rememberVehicleSelectSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VehicleSelectViewModel =
        viewModel(
            key = VehicleSelectRegistration.ID,
            factory = VehicleSelectViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    VehicleSelectContent(
        state = state,
        strings = rememberVehicleSelectStrings(),
        modifier = modifier,
        withIcon = withIcon,
        onSelect = viewModel::select,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the compact
 * picker over the cache-then-network [UiState]: loading ⇒ a select-shaped skeleton, hard error ⇒ [QueryError]
 * + retry, empty ⇒ a friendly [EmptyState], otherwise the dropdown (with a freshness chip while stale /
 * refreshing / offline). Stale (non-error) data auto-refreshes exactly once (web `useVehicles` refetch);
 * offline keeps the cached fleet selectable with the offline chip.
 */
@Composable
fun VehicleSelectContent(
    state: UiState<VehicleSelectData>,
    strings: VehicleSelectStrings,
    modifier: Modifier = Modifier,
    withIcon: Boolean = false,
    onSelect: (Long) -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val data = state.data ?: VehicleSelectData.EMPTY
    Column(
        modifier = modifier.fillMaxWidth().testTag(VEHICLE_SELECT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        FadeIn(modifier = Modifier.fillMaxWidth()) {
            when {
                state.isLoading -> VehicleSelectLoading(withIcon = withIcon, strings = strings)
                state.isError -> VehicleSelectErrorBody(state = state, strings = strings, onRetry = onRetry)
                state.isEmpty -> VehicleSelectEmptyBody(strings = strings)
                else -> VehicleSelectControl(data = data, state = state, withIcon = withIcon, strings = strings, onSelect = onSelect)
            }
        }
    }
}

/**
 * The content branch — the dropdown itself. Maps each row to a [SelectOption] (web `value = String(id)`,
 * `label = display_name || vin || 'Vehicle {id}'`), seeds the current selection, writes the chosen id back
 * (web `setVehicleId`), and exposes a merged TalkBack label ("Select vehicle, {active}") on the trigger. A
 * freshness chip is shown while the cached fleet is stale / refreshing / offline.
 */
@Composable
private fun VehicleSelectControl(
    data: VehicleSelectData,
    state: UiState<VehicleSelectData>,
    withIcon: Boolean,
    strings: VehicleSelectStrings,
    onSelect: (Long) -> Unit,
) {
    val options = data.vehicles.map { SelectOption(it.id.toString(), vehicleOptionLabel(it, strings.fallbackWord)) }
    val selectedLabel = data.selectedRow?.let { vehicleOptionLabel(it, strings.fallbackWord) } ?: ""
    val accessibleLabel = vehicleSelectAccessibilityLabel(strings.ariaLabel, selectedLabel)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (withIcon) {
            Icon(
                NavGlyphs.Car,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .testTag(VEHICLE_SELECT_TRIGGER_TEST_TAG)
                    .semantics(mergeDescendants = true) { contentDescription = accessibleLabel },
        ) {
            Select(
                options = options,
                selectedValue = data.effectiveSelectedId?.toString(),
                onSelect = { value -> value.toLongOrNull()?.let(onSelect) },
                emptyLabel = strings.ariaLabel,
            )
        }
        VehicleSelectFreshnessChip(state = state, strings = strings)
    }
}

/**
 * The localized freshness chip: an offline chip while the cached fleet is shown after a failed refresh
 * (web "last known"), an "updating…" chip while a refresh is in flight, or a stale chip once the cached fleet
 * passes its TTL. Renders nothing while the fleet is fresh.
 */
@Composable
private fun VehicleSelectFreshnessChip(
    state: UiState<VehicleSelectData>,
    strings: VehicleSelectStrings,
) {
    when {
        state.hasError && state.hasData -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        state.refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        state.stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

/** The loading branch — a select-shaped skeleton (optionally icon-prefixed), announced to TalkBack. */
@Composable
private fun VehicleSelectLoading(
    withIcon: Boolean,
    strings: VehicleSelectStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (withIcon) {
            Icon(
                NavGlyphs.Car,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Skeleton(modifier = Modifier.weight(1f), height = TRIGGER_SKELETON_HEIGHT, rounded = true)
    }
}

/** The hard-error branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun VehicleSelectErrorBody(
    state: UiState<VehicleSelectData>,
    strings: VehicleSelectStrings,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = vehicleSelectErrorKind(state.errorKind, state.httpStatus),
        resourceName = strings.errorResource,
        onRetry = onRetry,
    )
}

/** The empty branch — the friendly "no vehicle selected" state (web `NoVehicleSelected`), never a blank box. */
@Composable
private fun VehicleSelectEmptyBody(strings: VehicleSelectStrings) {
    EmptyState(
        message = strings.emptyDesc,
        modifier = Modifier.fillMaxWidth(),
        icon = NavGlyphs.Car,
        title = strings.emptyTitle,
    )
}

/** Builds the localized labels from the P1/S10 catalog; tests/previews pass a deterministic instance. */
@Composable
private fun rememberVehicleSelectStrings(): VehicleSelectStrings =
    VehicleSelectStrings(
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

/** Resolves the shared P1/S8 selection + fleet holders from the [LocalDataContainer] into the surface seam. */
@Composable
private fun rememberVehicleSelectSource(): VehicleSelectSource {
    val container = LocalDataContainer.current
    return remember(container) { vehicleSelectSource(container.selectedVehicleStore, container.vehiclesStore) }
}

private val TRIGGER_SKELETON_HEIGHT: Dp = 56.dp

// ── Previews — one per rendered state (loading / content / content + icon / single / empty / stale /
// offline / error). ─────────────────────────────────────────────────────────────────────────────────────

private fun previewStrings(): VehicleSelectStrings =
    VehicleSelectStrings(
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
    selected: Boolean,
): VehicleSelectRow = VehicleSelectRow(id = id, displayName = name, vin = "5YJ3E1EA7KF00000$id", model = model, selected = selected)

private fun previewFleet(selectedId: Long): VehicleSelectData {
    val rows =
        listOf(
            previewRow(1, "Red Rocket", "Model 3", selected = selectedId == 1L),
            previewRow(2, "Spacehauler", "Model Y", selected = selectedId == 2L),
            previewRow(3, "Garage Queen", "Model S", selected = selectedId == 3L),
        )
    return VehicleSelectData(vehicles = rows, effectiveSelectedId = selectedId)
}

@Preview(name = "VehicleSelect · content", showBackground = true)
@Composable
private fun VehicleSelectContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(state = UiState(UiPhase.Content, data = previewFleet(2)), strings = previewStrings())
    }
}

@Preview(name = "VehicleSelect · content + icon", showBackground = true)
@Composable
private fun VehicleSelectIconPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(state = UiState(UiPhase.Content, data = previewFleet(1)), strings = previewStrings(), withIcon = true)
    }
}

@Preview(name = "VehicleSelect · single vehicle", showBackground = true)
@Composable
private fun VehicleSelectSinglePreview() {
    val data =
        VehicleSelectData(
            vehicles = listOf(previewRow(1, "Daily Driver", "Model 3", selected = true)),
            effectiveSelectedId = 1,
        )
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(state = UiState(UiPhase.Content, data = data), strings = previewStrings())
    }
}

@Preview(name = "VehicleSelect · loading", showBackground = true)
@Composable
private fun VehicleSelectLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(state = UiState.loading(), strings = previewStrings())
    }
}

@Preview(name = "VehicleSelect · empty", showBackground = true)
@Composable
private fun VehicleSelectEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(state = UiState(UiPhase.Empty, data = VehicleSelectData.EMPTY), strings = previewStrings())
    }
}

@Preview(name = "VehicleSelect · stale", showBackground = true)
@Composable
private fun VehicleSelectStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(
            state = UiState(UiPhase.Content, data = previewFleet(2), fetchedAt = 0L, stale = true, refreshing = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleSelect · offline", showBackground = true)
@Composable
private fun VehicleSelectOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(
            state = UiState(UiPhase.Content, data = previewFleet(2), fetchedAt = 0L, stale = true, errorKind = ErrorKind.Network),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleSelect · error", showBackground = true)
@Composable
private fun VehicleSelectErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleSelectContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), strings = previewStrings())
    }
}
