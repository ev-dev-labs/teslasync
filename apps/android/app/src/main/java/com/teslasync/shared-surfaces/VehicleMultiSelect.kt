// The native Jetpack Compose + Material 3 VehicleMultiSelect shared surface — a parity port of
// web/src/components/forms/VehicleMultiSelect.tsx. The web component is the Alert-Studio multi-vehicle picker:
// a custom trigger (a neutral summary badge + chevron) opening a popover whose rows are checkbox-semantic
// buttons — the "All vehicles (current + future)" sentinel, then one row per enrolled vehicle, then any
// unknown (selected-but-not-enrolled) ids preserved with an "Unknown" badge. This native surface keeps that
// contract end to end and renders every state the prompt's matrix mandates without ever hiding a region:
// loading (the first fleet fetch's skeleton trigger), content (the trigger + popover), empty (the disabled
// trigger + add-a-vehicle help, the web `isFleetEmpty` branch), a hard error with Retry, and a stale/offline
// freshness chip over a cached fleet.
//
// It performs NO HTTP and binds the enrolled-vehicle feed only through the shared S8/S7 Vehicles seam
// ([VehicleMultiSelectSource]) folded through [VehicleMultiSelectViewModel] + the pure
// [VehicleMultiSelectProjection]; the selection stays controlled by the host (the web `value` / `onChange`
// props). The composable resolves the i18n labels (P1/S10) + design tokens (P1/S9) and draws what the
// projection returns, using the shared component library (ui Badge/Checkbox/typography/Icon, feedback
// QueryError/Skeleton, motion FadeIn). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on
// first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleMultiSelect) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclemultiselect

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered picker in any state. */
const val VEHICLE_MULTI_SELECT_TEST_TAG: String = "vehicle-multi-select"

/** Test tag on the open popover so on-device UI tests can assert the option list rendered. */
const val VEHICLE_MULTI_SELECT_POPOVER_TAG: String = "vehicle-multi-select-popover"

/**
 * Stateful entry point — the parity port of the controlled web `<VehicleMultiSelect value onChange … />`. Binds
 * the shared enrolled-vehicle feed via [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on
 * first composition, collects the [io.teslasync.android.data.UiState], projects it together with the controlled
 * [value], auto-refreshes a stale cache, and renders. The selection stays owned by the host: the popover rows
 * compute the next [VehicleSelection] and report it through [onChange] (web `onChange`).
 *
 * @param viewModel the state holder bound to the shared S8 VehiclesStore / S7 VehiclesRepository seam.
 * @param value the controlled selection (web `value`).
 * @param onChange invoked with the next selection when a row is toggled (web `onChange`).
 * @param enabled when false the trigger is inert (web `disabled`).
 * @param errorText optional already-localized inline error (web `errorKey` resolved) shown below the trigger.
 */
@Composable
fun VehicleMultiSelect(
    viewModel: VehicleMultiSelectViewModel,
    value: VehicleSelection,
    onChange: (VehicleSelection) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    errorText: String? = null,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberVehicleMultiSelectStrings()
    val state by viewModel.vehicles.collectAsStateWithLifecycle()
    val display = remember(state, value, strings) { VehicleMultiSelectProjection.project(state, value, strings) }

    // Remember the last explicit subset so toggling the all-sticky sentinel OFF restores it (web D13).
    var previousSpecific by remember { mutableStateOf(value.specificIds) }
    LaunchedEffect(value) { if (value is VehicleSelection.Specific) previousSpecific = value.vehicleIds }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        VehicleMultiSelectContent(
            display = display,
            strings = strings,
            enabled = enabled,
            errorText = errorText,
            onToggleAll = { onChange(toggleAll(value, previousSpecific)) },
            onToggleVehicle = { id -> onChange(toggleVehicle(value, id)) },
            onRetry = viewModel::retry,
        )
    }
}

/**
 * Stateless picker — renders every branch the web source draws plus the enrolled-vehicle feed's lifecycle: a
 * loading skeleton trigger, the trigger + popover content, the disabled trigger + empty-fleet help, and the
 * classified error with retry, with a stale/offline freshness chip over a cached fleet. Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state. The popover open state + the trigger
 * measurement are local UI concerns owned here.
 */
@Composable
fun VehicleMultiSelectContent(
    display: VehicleMultiSelectDisplay,
    strings: VehicleMultiSelectStrings,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    errorText: String? = null,
    onToggleAll: () -> Unit = {},
    onToggleVehicle: (Long) -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag(VEHICLE_MULTI_SELECT_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        when (display.phase) {
            VehicleMultiSelectPhase.Loading -> VehicleMultiSelectSkeleton(strings)
            VehicleMultiSelectPhase.Error ->
                QueryError(
                    kind = VehicleMultiSelectProjection.queryErrorKind(display),
                    resourceName = strings.triggerLabel,
                    onRetry = onRetry,
                )
            VehicleMultiSelectPhase.Empty -> {
                VehicleMultiSelectTrigger(display = display, strings = strings, enabled = false, hasError = errorText != null)
                HelperText(strings.emptyFleetHelp)
                errorText?.let { ErrorText(it) }
            }
            VehicleMultiSelectPhase.Content -> {
                VehicleMultiSelectPicker(
                    display = display,
                    strings = strings,
                    enabled = enabled,
                    hasError = errorText != null,
                    onToggleAll = onToggleAll,
                    onToggleVehicle = onToggleVehicle,
                )
                errorText?.let { ErrorText(it) }
            }
        }
    }
}

/** The trigger + anchored popover. The popover matches the trigger width and opens just beneath it. */
@Composable
private fun VehicleMultiSelectPicker(
    display: VehicleMultiSelectDisplay,
    strings: VehicleMultiSelectStrings,
    enabled: Boolean,
    hasError: Boolean,
    onToggleAll: () -> Unit,
    onToggleVehicle: (Long) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    var triggerSize by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current
    val gapPx = with(density) { Spacing.xs.roundToPx() }

    Box(modifier = Modifier.fillMaxWidth()) {
        VehicleMultiSelectTrigger(
            display = display,
            strings = strings,
            enabled = enabled,
            hasError = hasError,
            expanded = expanded,
            onClick = { expanded = !expanded },
            modifier = Modifier.onGloballyPositioned { triggerSize = it.size },
        )
        val popoverWidth = if (triggerSize.width > 0) Modifier.width(with(density) { triggerSize.width.toDp() }) else Modifier
        Popover(
            expanded = expanded && enabled,
            onDismissRequest = { expanded = false },
            modifier = popoverWidth,
            offset = IntOffset(x = 0, y = triggerSize.height + gapPx),
            accessibleName = strings.triggerLabel,
        ) {
            VehicleMultiSelectOptions(
                display = display,
                strings = strings,
                onToggleAll = onToggleAll,
                onToggleVehicle = onToggleVehicle,
            )
        }
    }
}

/**
 * The trigger control — an outlined, rounded field showing the summary badge, an optional freshness chip, and a
 * chevron that rotates when open. Clickable (a [Role.DropdownList]) only while [enabled]; the disabled empty
 * fleet renders the same chrome dimmed and inert, never collapsed.
 */
@Composable
private fun VehicleMultiSelectTrigger(
    display: VehicleMultiSelectDisplay,
    strings: VehicleMultiSelectStrings,
    enabled: Boolean,
    hasError: Boolean,
    modifier: Modifier = Modifier,
    expanded: Boolean = false,
    onClick: () -> Unit = {},
) {
    val borderColor = if (hasError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(width = 1.dp, color = borderColor),
    ) {
        val clickable =
            if (enabled) {
                Modifier.clickable(role = Role.DropdownList, onClickLabel = strings.triggerLabel, onClick = onClick)
            } else {
                Modifier.alpha(DISABLED_ALPHA)
            }
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .then(clickable)
                    .semantics { contentDescription = "${strings.triggerLabel}: ${display.summary}" }
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Badge(text = display.summary, variant = BadgeVariant.Neutral)
            Spacer(modifier = Modifier.weight(1f))
            if (display.showFreshnessChip) VehicleMultiSelectFreshnessChip(display = display, strings = strings)
            Icon(
                imageVector = TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.rotate(if (expanded) CHEVRON_OPEN_ROTATION else 0f),
            )
        }
    }
}

/** The popover body — the all-vehicles sentinel, the enrolled rows, then the preserved unknown rows. */
@Composable
private fun VehicleMultiSelectOptions(
    display: VehicleMultiSelectDisplay,
    strings: VehicleMultiSelectStrings,
    onToggleAll: () -> Unit,
    onToggleVehicle: (Long) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(VEHICLE_MULTI_SELECT_POPOVER_TAG)
                .heightIn(max = POPOVER_MAX_HEIGHT)
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        VehicleOptionRow(
            checked = display.selectionIsAll,
            label = strings.allOption,
            subtitle = null,
            accessibilityLabel = strings.allOption,
            onToggle = onToggleAll,
        )
        VehicleOptionDivider()
        display.options.forEach { option ->
            VehicleOptionRow(
                checked = option.checked,
                label = option.label,
                subtitle = option.subtitle,
                accessibilityLabel = option.label,
                onToggle = { onToggleVehicle(option.id) },
            )
        }
        if (display.hasUnknown) {
            VehicleOptionDivider()
            display.unknownOptions.forEach { option ->
                VehicleOptionRow(
                    checked = true,
                    label = option.label,
                    subtitle = null,
                    accessibilityLabel = "${option.label}, ${strings.unknownBadge}",
                    onToggle = { onToggleVehicle(option.id) },
                    trailing = { Badge(text = strings.unknownBadge, variant = BadgeVariant.Warning) },
                )
            }
        }
    }
}

/**
 * A single checkbox-semantic option row — the native port of the web `<button role="checkbox" aria-checked>`.
 * The whole row is one [Role.Checkbox] toggle target carrying [accessibilityLabel] for TalkBack; the leading
 * box reflects the checked state and an optional [trailing] slot carries the "Unknown" badge.
 */
@Composable
private fun VehicleOptionRow(
    checked: Boolean,
    label: String,
    subtitle: String?,
    accessibilityLabel: String,
    onToggle: () -> Unit,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .toggleable(value = checked, role = Role.Checkbox, onValueChange = { onToggle() })
                .semantics { contentDescription = accessibilityLabel }
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(label, maxLines = 1)
            if (subtitle != null) Caption(subtitle)
        }
        trailing?.invoke()
    }
}

/** A hairline divider between option groups (web `<div className="h-px bg-[var(--border-subtle)]">`). */
@Composable
private fun VehicleOptionDivider() {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        color = MaterialTheme.colorScheme.outlineVariant,
    ) {
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = 1.dp, max = 1.dp))
    }
}

/**
 * The localized freshness chip: an offline chip while cached data is shown after a failed refresh, an
 * "updating…" chip while a refresh is in flight, or a stale chip once the cached value passes its TTL.
 */
@Composable
private fun VehicleMultiSelectFreshnessChip(
    display: VehicleMultiSelectDisplay,
    strings: VehicleMultiSelectStrings,
) {
    when {
        display.offline -> Badge(text = strings.offlineLabel, variant = BadgeVariant.Warning, dot = true)
        display.refreshing -> Badge(text = strings.updatingLabel, variant = BadgeVariant.Neutral, dot = true)
        display.stale -> Badge(text = strings.staleLabel, variant = BadgeVariant.Info, dot = true)
    }
}

/** The loading branch — a skeleton bar standing in for the trigger while the first fleet fetch is in flight. */
@Composable
private fun VehicleMultiSelectSkeleton(strings: VehicleMultiSelectStrings) {
    Skeleton(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        height = TRIGGER_SKELETON_HEIGHT,
        rounded = true,
    )
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberVehicleMultiSelectStrings(): VehicleMultiSelectStrings =
    VehicleMultiSelectStrings(
        summaryAll = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryAll),
        summaryNone = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryNone),
        summaryOneTemplate = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryOne),
        summaryPartialTemplate = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryPartial),
        summaryCountTemplate = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesSummaryCount),
        allOption = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesAllOption),
        emptyFleetHelp = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesEmptyFleetHelp),
        unknownLabelTemplate = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesUnknownLabel),
        unknownBadge = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesUnknownBadge),
        triggerLabel = stringResource(R.string.translation_notifications_alertStudio_editor_vehiclesLabel),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
    )

private const val DISABLED_ALPHA = 0.6f
private const val CHEVRON_OPEN_ROTATION = 180f
private val TRIGGER_SKELETON_HEIGHT = 44.dp
private val POPOVER_MAX_HEIGHT = 288.dp

// ── Previews — one per rendered state (content / all-sticky / unknown / loading / empty / error / offline). ──

private fun previewStrings(): VehicleMultiSelectStrings =
    VehicleMultiSelectStrings(
        summaryAll = "All vehicles",
        summaryNone = "No vehicles selected",
        summaryOneTemplate = "%1\$s",
        summaryPartialTemplate = "%1\$s of %2\$s vehicles",
        summaryCountTemplate = "%1\$s vehicles",
        allOption = "All vehicles (current + future)",
        emptyFleetHelp = "Add a vehicle in Settings → Vehicles to use this rule.",
        unknownLabelTemplate = "Vehicle #%1\$s",
        unknownBadge = "Unknown",
        triggerLabel = "Vehicles",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        updatingLabel = "updating…",
    )

private fun previewOptions(): List<VehicleOption> =
    listOf(
        VehicleOption(id = 1, label = "Red Rocket", subtitle = "Model 3  ·  …0001", checked = true, known = true),
        VehicleOption(id = 2, label = "Spacehauler", subtitle = "Model Y  ·  …0002", checked = false, known = true),
        VehicleOption(id = 3, label = "Garage Queen", subtitle = "Model S  ·  …0003", checked = true, known = true),
    )

@Preview(name = "VehicleMultiSelect · content", showBackground = true)
@Composable
private fun VehicleMultiSelectContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Content,
                    summary = "2 of 3 vehicles",
                    selectionIsAll = false,
                    options = previewOptions(),
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleMultiSelect · all vehicles", showBackground = true)
@Composable
private fun VehicleMultiSelectAllPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Content,
                    summary = "All vehicles",
                    selectionIsAll = true,
                    options = previewOptions().map { it.copy(checked = false) },
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleMultiSelect · unknown id", showBackground = true)
@Composable
private fun VehicleMultiSelectUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Content,
                    summary = "3 vehicles",
                    selectionIsAll = false,
                    options = previewOptions(),
                    unknownOptions =
                        listOf(VehicleOption(id = 99, label = "Vehicle #99", subtitle = null, checked = true, known = false)),
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleMultiSelect · loading", showBackground = true)
@Composable
private fun VehicleMultiSelectLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Loading,
                    summary = "No vehicles selected",
                    selectionIsAll = false,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleMultiSelect · empty fleet", showBackground = true)
@Composable
private fun VehicleMultiSelectEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Empty,
                    summary = "No vehicles selected",
                    selectionIsAll = false,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleMultiSelect · error", showBackground = true)
@Composable
private fun VehicleMultiSelectErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Error,
                    summary = "No vehicles selected",
                    selectionIsAll = false,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "VehicleMultiSelect · offline", showBackground = true)
@Composable
private fun VehicleMultiSelectOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleMultiSelectContent(
            display =
                VehicleMultiSelectDisplay(
                    phase = VehicleMultiSelectPhase.Content,
                    summary = "2 of 3 vehicles",
                    selectionIsAll = false,
                    options = previewOptions(),
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
        )
    }
}
