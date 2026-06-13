// The native Jetpack Compose + Material 3 ActiveVehicleSegment shared surface — a parity port of
// web/src/components/layout/status-bar/ActiveVehicleSegment.tsx. The web component is the canonical footer
// status-bar segment for the active vehicle: a compact chip showing the selected vehicle's name + live metrics
// (`${battery}% · ${range} ${unit}`) wired to the global `useSelectedVehicle()` store, rendered as a static chip
// for a single-vehicle account and as an interactive switcher (a popover vehicle listbox) for two-or-more, with
// an optional icon-only mode.
//
// This native surface keeps that contract end to end while using platform-idiomatic primitives (the shared
// Material 3 `Tooltip` / `Popover` / `Badge` / `Icon`, the shared `Skeleton` / `EmptyState` / `QueryError`) and
// renders every state the P3 matrix mandates without ever hiding a region: loading (a chip-shaped skeleton during
// the first fleet fetch), content (the static chip or the switcher), empty (a friendly state — the web returns
// `null` for an empty fleet, but P3 forbids a hidden surface), a hard error with Retry, and — through the
// ADR-013 cache-then-network freshness contract — stale / offline (the cached fleet kept shown with a freshness
// chip). All data flows through [ActiveVehicleSegmentViewModel] (P1/S8); the view performs NO HTTP. Every string
// resolves through the i18n facade (P1/S10) via `stringResource`; the trigger exposes a merged TalkBack label
// and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ActiveVehicleSegment) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.activevehiclesegment

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
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
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the rendered segment in any state. */
const val ACTIVE_VEHICLE_SEGMENT_TEST_TAG: String = "active-vehicle-segment"

/** Test tag on the multi-vehicle switcher trigger (the web switcher `button`) — used by the a11y + UI tests. */
const val ACTIVE_VEHICLE_SEGMENT_TRIGGER_TEST_TAG: String = "active-vehicle-segment-trigger"

/** Test tag on the switcher popover listbox (the web `role="listbox"` popover). */
const val ACTIVE_VEHICLE_SEGMENT_MENU_TEST_TAG: String = "active-vehicle-segment-menu"

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests/previews pass a deterministic instance), keeping the render branches locale-stable. Every string
 * resolves through the P1/S10 catalog.
 *
 * @property fallbackWord the "Vehicle" word used to build the "Vehicle {id}" label fallback.
 * @property noneWord the "No vehicle" label shown when nothing is selected.
 * @property tooltipWord the tooltip lead word ("Active vehicle").
 * @property ariaWord the accessible/listbox label ("Active vehicle").
 * @property switchWord the switcher action word ("Switch vehicle").
 * @property loadingLabel the TalkBack label for the loading skeleton.
 * @property staleLabel the freshness chip shown when the cached fleet is past its TTL.
 * @property offlineLabel the freshness chip shown when the cached fleet is served after a failed refresh.
 * @property updatingLabel the freshness chip shown while a refresh is in flight over the cached fleet.
 * @property emptyTitle the empty-state title.
 * @property emptyDesc the empty-state body.
 * @property errorResource the resource noun the error surface personalises.
 */
data class ActiveVehicleSegmentStrings(
    val fallbackWord: String,
    val noneWord: String,
    val tooltipWord: String,
    val ariaWord: String,
    val switchWord: String,
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
    val updatingLabel: String,
    val emptyTitle: String,
    val emptyDesc: String,
    val errorResource: String,
)

/**
 * Stateful entry point — the parity port of the web `<ActiveVehicleSegment iconOnly={…} />`. Binds the selection
 * + fleet + state + units seam via [source] into an [ActiveVehicleSegmentViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11) on first composition, collects the live cache-then-network state, and renders
 * the segment.
 *
 * [source] defaults to the shared P1/S8 holders from the [LocalDataContainer] (so the segment is a true drop-in
 * like the web component); a host or test may inject a different seam. [logger] defaults to the process logger.
 *
 * @param iconOnly when true, renders only the car icon (web `iconOnly`, default false).
 */
@Composable
fun ActiveVehicleSegment(
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    source: ActiveVehicleSegmentSource = rememberActiveVehicleSegmentSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ActiveVehicleSegmentViewModel =
        viewModel(
            key = ActiveVehicleSegmentRegistration.ID,
            factory = ActiveVehicleSegmentViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    ActiveVehicleSegmentContent(
        state = state,
        strings = rememberActiveVehicleSegmentStrings(),
        modifier = modifier,
        iconOnly = iconOnly,
        onSelect = viewModel::select,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the segment over
 * the cache-then-network [UiState]: loading ⇒ a chip-shaped skeleton, hard error ⇒ [QueryError] + retry, empty ⇒
 * a friendly [EmptyState], otherwise the static chip (single vehicle) or the switcher (two-or-more). Stale
 * (non-error) data auto-refreshes exactly once (web `useVehicles` refetch); offline keeps the cached fleet shown
 * with the offline chip.
 */
@Composable
fun ActiveVehicleSegmentContent(
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    onSelect: (Long) -> Unit = {},
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val data = state.data ?: ActiveVehicleSegmentData.EMPTY
    FadeIn(modifier = modifier.testTag(ACTIVE_VEHICLE_SEGMENT_TEST_TAG)) {
        when {
            state.isLoading -> ActiveVehicleSegmentLoading(iconOnly = iconOnly, strings = strings)
            state.isError -> ActiveVehicleSegmentError(state = state, strings = strings, onRetry = onRetry)
            state.isEmpty -> ActiveVehicleSegmentEmpty(strings = strings)
            else ->
                ActiveVehicleSegmentChip(
                    data = data,
                    state = state,
                    strings = strings,
                    iconOnly = iconOnly,
                    onSelect = onSelect,
                )
        }
    }
}

/**
 * The content branch — folds the active-vehicle [label] / sub-label / tooltip (the web inline derivations) and
 * dispatches to the static chip (single-vehicle account) or the switcher (two-or-more vehicles).
 */
@Composable
private fun ActiveVehicleSegmentChip(
    data: ActiveVehicleSegmentData,
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
    iconOnly: Boolean,
    onSelect: (Long) -> Unit,
) {
    val label = activeVehicleLabel(data.selectedRow, data.effectiveSelectedId, strings.fallbackWord, strings.noneWord)
    val subLabel = activeVehicleSubLabel(data.selectedRow)
    val tooltip = activeVehicleTooltip(strings.tooltipWord, label, subLabel, data.metricsLabel)
    if (data.isSwitchable) {
        ActiveVehicleSwitcher(
            data = data,
            state = state,
            strings = strings,
            iconOnly = iconOnly,
            label = label,
            tooltip = tooltip,
            onSelect = onSelect,
        )
    } else {
        ActiveVehicleStaticChip(
            state = state,
            strings = strings,
            iconOnly = iconOnly,
            label = label,
            tooltip = tooltip,
            metricsLabel = data.metricsLabel,
        )
    }
}

/**
 * The single-vehicle branch — a static, non-interactive chip (web `vehicles.length === 1`): the car icon, the
 * vehicle [label], the live metrics, and a freshness chip, wrapped in the tooltip and exposing the merged
 * "Active vehicle: {label}" TalkBack label.
 */
@Composable
private fun ActiveVehicleStaticChip(
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
    iconOnly: Boolean,
    label: String,
    tooltip: String,
    metricsLabel: String?,
) {
    Tooltip(text = tooltip) {
        SegmentChipBody(
            iconOnly = iconOnly,
            label = label,
            metricsLabel = metricsLabel,
            state = state,
            strings = strings,
            modifier =
                Modifier.semantics {
                    contentDescription = activeVehicleAccessibilityLabel(strings.ariaWord, label)
                },
        )
    }
}

/**
 * The multi-vehicle branch — the interactive switcher (web `vehicles.length > 1`): the same chip plus a chevron,
 * made clickable to toggle the [ActiveVehicleMenu] vehicle listbox. The trigger carries the
 * "Switch vehicle ({label})" TalkBack label; the chevron points up while open (web `rotate-180` when closed).
 */
@Composable
private fun ActiveVehicleSwitcher(
    data: ActiveVehicleSegmentData,
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
    iconOnly: Boolean,
    label: String,
    tooltip: String,
    onSelect: (Long) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Box {
        Tooltip(text = tooltip) {
            SegmentChipBody(
                iconOnly = iconOnly,
                label = label,
                metricsLabel = data.metricsLabel,
                state = state,
                strings = strings,
                modifier =
                    Modifier
                        .testTag(ACTIVE_VEHICLE_SEGMENT_TRIGGER_TEST_TAG)
                        .clickable(role = Role.Button, onClickLabel = strings.switchWord) { open = !open }
                        .semantics {
                            contentDescription = switchVehicleAccessibilityLabel(strings.switchWord, label)
                        },
            ) {
                Icon(
                    imageVector = if (open) TeslaGlyphs.ChevronUp else TeslaGlyphs.ChevronDown,
                    contentDescription = null,
                    size = IconSize.Xs,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        ActiveVehicleMenu(
            expanded = open,
            data = data,
            strings = strings,
            onDismiss = { open = false },
            onPick = { id ->
                onSelect(id)
                open = false
            },
        )
    }
}

/**
 * The popover vehicle listbox (web `role="listbox"`): one selectable row per enrolled vehicle, the active one
 * marked with a check. Dismisses on outside tap / Back via the shared [Popover].
 */
@Composable
private fun ActiveVehicleMenu(
    expanded: Boolean,
    data: ActiveVehicleSegmentData,
    strings: ActiveVehicleSegmentStrings,
    onDismiss: () -> Unit,
    onPick: (Long) -> Unit,
) {
    Popover(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.testTag(ACTIVE_VEHICLE_SEGMENT_MENU_TEST_TAG),
        alignment = Alignment.BottomEnd,
        accessibleName = strings.ariaWord,
    ) {
        data.vehicles.forEach { row ->
            ActiveVehicleMenuRow(row = row, fallbackWord = strings.fallbackWord, onPick = onPick)
        }
    }
}

/**
 * One listbox option (web `role="option"`): the car icon, the vehicle name + optional model, and a trailing
 * check on the active row. Selecting it writes the choice back through [onPick] (web `pick(v.id)`).
 */
@Composable
private fun ActiveVehicleMenuRow(
    row: ActiveVehicleRow,
    fallbackWord: String,
    onPick: (Long) -> Unit,
) {
    val name = vehicleRowLabel(row, fallbackWord)
    val model = row.model
    Row(
        modifier =
            Modifier
                .widthIn(min = MENU_MIN_WIDTH, max = MENU_MAX_WIDTH)
                .selectable(selected = row.selected, role = Role.Button) { onPick(row.id) }
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BodyText(
                text = name,
                color = if (row.selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
            if (!model.isNullOrBlank()) {
                Caption(model)
            }
        }
        if (row.selected) {
            Icon(
                imageVector = TeslaGlyphs.Check,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
        }
    }
}

/**
 * The shared chip body for the static chip + the switcher: the car icon, then (unless [iconOnly]) the truncating
 * [label], the muted metrics, the freshness chip, and any [trailing] affordance (the switcher's chevron).
 */
@Composable
private fun SegmentChipBody(
    iconOnly: Boolean,
    label: String,
    metricsLabel: String?,
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
    modifier: Modifier = Modifier,
    trailing: @Composable () -> Unit = {},
) {
    Row(
        modifier = modifier.padding(horizontal = Spacing.xs, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!iconOnly) {
            BodyText(
                text = label,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                modifier = Modifier.widthIn(max = SEGMENT_LABEL_MAX_WIDTH),
            )
            if (!metricsLabel.isNullOrBlank()) {
                BodyText(
                    text = "\u00B7 $metricsLabel",
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = METRICS_ALPHA),
                    maxLines = 1,
                )
            }
            ActiveVehicleFreshnessChip(state = state, strings = strings)
            trailing()
        }
    }
}

/**
 * The localized freshness chip: an offline chip while the cached fleet is shown after a failed refresh, an
 * "updating…" chip while a refresh is in flight, or a stale chip once the cached fleet passes its TTL. Renders
 * nothing while the fleet is fresh.
 */
@Composable
private fun ActiveVehicleFreshnessChip(
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
) {
    when {
        state.hasError && state.hasData -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        state.refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        state.stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

/** The loading branch — the car icon plus a chip-shaped skeleton (unless [iconOnly]), announced to TalkBack. */
@Composable
private fun ActiveVehicleSegmentLoading(
    iconOnly: Boolean,
    strings: ActiveVehicleSegmentStrings,
) {
    Row(
        modifier =
            Modifier
                .padding(horizontal = Spacing.xs, vertical = Spacing.xs)
                .semantics { contentDescription = strings.loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = NavGlyphs.Car,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (!iconOnly) {
            Box(modifier = Modifier.width(SEGMENT_SKELETON_WIDTH)) {
                Skeleton(height = SEGMENT_SKELETON_HEIGHT, rounded = true)
            }
        }
    }
}

/** The hard-error branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun ActiveVehicleSegmentError(
    state: UiState<ActiveVehicleSegmentData>,
    strings: ActiveVehicleSegmentStrings,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = activeVehicleSegmentErrorKind(state.errorKind, state.httpStatus),
        resourceName = strings.errorResource,
        onRetry = onRetry,
    )
}

/** The empty branch — the friendly state shown for an empty fleet (the web returns `null`; P3 never hides). */
@Composable
private fun ActiveVehicleSegmentEmpty(strings: ActiveVehicleSegmentStrings) {
    EmptyState(message = strings.emptyDesc, icon = NavGlyphs.Car, title = strings.emptyTitle)
}

/** Builds the localized labels from the P1/S10 catalog; tests/previews pass a deterministic instance. */
@Composable
private fun rememberActiveVehicleSegmentStrings(): ActiveVehicleSegmentStrings =
    ActiveVehicleSegmentStrings(
        fallbackWord = stringResource(R.string.translation_statusBar_vehicle_fallback),
        noneWord = stringResource(R.string.translation_statusBar_vehicle_none),
        tooltipWord = stringResource(R.string.translation_statusBar_vehicle_tooltip),
        ariaWord = stringResource(R.string.translation_statusBar_vehicle_aria),
        switchWord = stringResource(R.string.translation_statusBar_vehicle_switch),
        loadingLabel = stringResource(R.string.translation_common_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
        emptyTitle = stringResource(R.string.translation_common_noVehicleSelected_title),
        emptyDesc = stringResource(R.string.translation_common_noVehicleSelected_desc),
        errorResource = stringResource(R.string.translation_common_vehicle),
    )

/** Resolves the shared P1/S8 selection + fleet + state + units holders from the [LocalDataContainer]. */
@Composable
private fun rememberActiveVehicleSegmentSource(): ActiveVehicleSegmentSource {
    val container = LocalDataContainer.current
    return remember(container) {
        activeVehicleSegmentSource(container.selectedVehicleStore, container.vehiclesStore, container.unitFormatter)
    }
}

private val SEGMENT_LABEL_MAX_WIDTH = 160.dp
private val SEGMENT_SKELETON_WIDTH = 120.dp
private val SEGMENT_SKELETON_HEIGHT = 16.dp
private val MENU_MIN_WIDTH = 220.dp
private val MENU_MAX_WIDTH = 320.dp
private const val METRICS_ALPHA = 0.7f

// ── Previews — one per rendered state (single / switcher / icon-only / loading / empty / stale / offline /
// error). ───────────────────────────────────────────────────────────────────────────────────────────────────

private fun previewStrings(): ActiveVehicleSegmentStrings =
    ActiveVehicleSegmentStrings(
        fallbackWord = "Vehicle",
        noneWord = "No vehicle",
        tooltipWord = "Active vehicle",
        ariaWord = "Active vehicle",
        switchWord = "Switch vehicle",
        loadingLabel = "Loading...",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        updatingLabel = "updating…",
        emptyTitle = "No vehicle selected",
        emptyDesc = "Add a vehicle to your fleet to see data here.",
        errorResource = "Vehicle",
    )

private fun previewRow(
    id: Long,
    name: String,
    model: String?,
    selected: Boolean,
): ActiveVehicleRow = ActiveVehicleRow(id = id, displayName = name, vin = "5YJ3E1EA7KF00000$id", model = model, selected = selected)

private fun previewFleet(
    selectedId: Long,
    count: Int,
): ActiveVehicleSegmentData {
    val rows =
        listOf(
            previewRow(1, "Red Rocket", "Model 3", selected = selectedId == 1L),
            previewRow(2, "Spacehauler", "Model Y", selected = selectedId == 2L),
            previewRow(3, "Garage Queen", "Model S", selected = selectedId == 3L),
        ).take(count)
    return ActiveVehicleSegmentData(vehicles = rows, effectiveSelectedId = selectedId, metricsLabel = "82% \u00B7 240 mi")
}

@Preview(name = "ActiveVehicleSegment · single", showBackground = true)
@Composable
private fun ActiveVehicleSegmentSinglePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(state = UiState(UiPhase.Content, data = previewFleet(1, 1)), strings = previewStrings())
    }
}

@Preview(name = "ActiveVehicleSegment · switcher", showBackground = true)
@Composable
private fun ActiveVehicleSegmentSwitcherPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(state = UiState(UiPhase.Content, data = previewFleet(2, 3)), strings = previewStrings())
    }
}

@Preview(name = "ActiveVehicleSegment · icon only", showBackground = true)
@Composable
private fun ActiveVehicleSegmentIconOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(
            state = UiState(UiPhase.Content, data = previewFleet(2, 3)),
            strings = previewStrings(),
            iconOnly = true,
        )
    }
}

@Preview(name = "ActiveVehicleSegment · loading", showBackground = true)
@Composable
private fun ActiveVehicleSegmentLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(state = UiState.loading(), strings = previewStrings())
    }
}

@Preview(name = "ActiveVehicleSegment · empty", showBackground = true)
@Composable
private fun ActiveVehicleSegmentEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(
            state = UiState(UiPhase.Empty, data = ActiveVehicleSegmentData.EMPTY),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ActiveVehicleSegment · stale", showBackground = true)
@Composable
private fun ActiveVehicleSegmentStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(
            state = UiState(UiPhase.Content, data = previewFleet(2, 3), fetchedAt = 0L, stale = true, refreshing = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ActiveVehicleSegment · offline", showBackground = true)
@Composable
private fun ActiveVehicleSegmentOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(
            state = UiState(UiPhase.Content, data = previewFleet(1, 1), fetchedAt = 0L, stale = true, errorKind = ErrorKind.Network),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "ActiveVehicleSegment · error", showBackground = true)
@Composable
private fun ActiveVehicleSegmentErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveVehicleSegmentContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), strings = previewStrings())
    }
}
