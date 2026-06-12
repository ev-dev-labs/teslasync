// The native Jetpack Compose + Material 3 LayoutSwitcher feature view — a parity port of
// web/src/features/dashboard/components/LayoutSwitcher.tsx. The web component is a compact dropdown for
// switching between saved dashboard layouts: a bordered trigger button ("Layout" + the active layout name + an
// optional "modified" badge + an optional pinned-vehicle badge + a chevron), an inline edit/save-as/reset
// action group, and a popup menu listing the layouts visible for the current vehicle (each a radio row with an
// active check + optional "default" badge + pin glyph) followed by "New layout from current", a
// pin/unpin-to-vehicle toggle, "Reset to default", and a footer hint. Save-as prompts for a name; reset routes
// through a confirmation dialog.
//
// This port keeps that composition end to end and performs NO HTTP. The layouts + active id + dirty/edit flags
// + callbacks are host-owned props (exactly as the web component receives them). The ONLY async input — the
// selected vehicle (web `useSelectedVehicle`) — is bound through the shared P1/S8 vehicles feed as a [UiState]
// (via [LayoutSwitcherViewModel] for self-binding hosts, or supplied directly by a host that already resolved
// it). Because that feed carries the full ADR-013 lifecycle, the surface renders every state it can produce:
// the trigger is ALWAYS visible (the switcher is never hidden — layout switching never depends on the vehicle),
// a loading vehicle scope shows skeleton chrome beside the trigger, a stale/offline scope shows a freshness
// chip and auto-refreshes, a hard failure surfaces an inline retry affordance in the menu, and the dropdown's
// own empty branch ("No layouts available for this vehicle.") is the web's genuine empty state. Every visible
// string resolves through the i18n catalog (P1/S10); every interactive element carries a TalkBack label.
//
// `window.prompt` (web save-as) has no native analogue, so it becomes a Material dialog with a text [Input].
// The reset `ConfirmDialog` maps 1:1. Recharts/Leaflet are not used by this surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LayoutSwitcher — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutswitcher

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Stable web-parity test tag for the trigger button. */
private const val TRIGGER_TAG: String = "layout-switcher-trigger"

/** Test-tag prefix for a layout menu row (`layout-item-<id>`). */
private const val ITEM_TAG_PREFIX: String = "layout-item-"

/** The web menu `min-w-[16rem]` (256dp) — the dropdown never collapses narrower than its content. */
private val MENU_MIN_WIDTH: Dp = 240.dp

/** Max width of the truncating active-layout name (web `max-w-[10rem]`). */
private val ACTIVE_NAME_MAX_WIDTH: Dp = 160.dp

/** Width of the loading skeleton chip shown beside the trigger while the vehicle scope resolves. */
private val LOADING_CHIP_WIDTH: Dp = 44.dp

/** Height of the loading skeleton chip. */
private val LOADING_CHIP_HEIGHT: Dp = 14.dp

/**
 * Stateful entry point. Binds the shared enrolled-vehicle feed via [source] into a [LayoutSwitcherViewModel]
 * (web `useSelectedVehicle`), resolves the localized [LayoutSwitcherStrings] from the catalog (P1/S10), records
 * the one-shot `view.opened` diagnostic, and renders the surface. The layouts + active id + flags + callbacks
 * are host-owned props mirroring the web component's prop surface. An explicit [vehicleId] pins the scope to
 * one vehicle, otherwise the first enrolled vehicle is used.
 */
@Composable
fun LayoutSwitcher(
    source: LayoutSwitcherSource,
    dashboards: List<SavedDashboardSummary>,
    activeId: String,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
    dirty: Boolean = false,
    editMode: Boolean = false,
    onDuplicate: ((String) -> Unit)? = null,
    onToggleEdit: (() -> Unit)? = null,
    onPinToVehicle: ((layoutId: String, vehicleId: Long?) -> Unit)? = null,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = LayoutSwitcherRegistration.SLUG,
) {
    val viewModel: LayoutSwitcherViewModel =
        viewModel(key = instanceKey, factory = LayoutSwitcherViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val vehicleState by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberLayoutSwitcherStrings()

    LayoutSwitcherContent(
        dashboards = dashboards,
        activeId = activeId,
        dirty = dirty,
        editMode = editMode,
        vehicleState = vehicleState,
        strings = strings,
        onSwitch = onSwitch,
        onCreate = onCreate,
        onDuplicate = onDuplicate,
        onReset = onReset,
        onToggleEdit = onToggleEdit,
        onPinToVehicle = onPinToVehicle,
        onRetryVehicles = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload for hosts (and previews) that already hold the resolved selected vehicle — the common
 * case, since the dashboard page that mounts this control already knows the active vehicle. It wraps
 * [selectedVehicle] in a loaded [UiState] (empty when no vehicle) and renders without a ViewModel, so the
 * surface performs no work of its own. Records the one-shot `view.opened` diagnostic.
 */
@Composable
fun LayoutSwitcher(
    dashboards: List<SavedDashboardSummary>,
    activeId: String,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onReset: () -> Unit,
    modifier: Modifier = Modifier,
    dirty: Boolean = false,
    editMode: Boolean = false,
    onDuplicate: ((String) -> Unit)? = null,
    onToggleEdit: (() -> Unit)? = null,
    onPinToVehicle: ((layoutId: String, vehicleId: Long?) -> Unit)? = null,
    selectedVehicle: SelectedVehicleContext = SelectedVehicleContext.NONE,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LayoutSwitcherDiagnostics.recordViewOpened(logger) }
    val strings = rememberLayoutSwitcherStrings()
    val state =
        remember(selectedVehicle) {
            UiState(
                phase = if (selectedVehicle.hasVehicle) UiPhase.Content else UiPhase.Empty,
                data = selectedVehicle,
            )
        }
    LayoutSwitcherContent(
        dashboards = dashboards,
        activeId = activeId,
        dirty = dirty,
        editMode = editMode,
        vehicleState = state,
        strings = strings,
        onSwitch = onSwitch,
        onCreate = onCreate,
        onDuplicate = onDuplicate,
        onReset = onReset,
        onToggleEdit = onToggleEdit,
        onPinToVehicle = onPinToVehicle,
        onRetryVehicles = {},
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. The trigger + inline actions are
 * always present (the web switcher is never hidden); the vehicle [vehicleState] modulates the scope chrome
 * (loading skeleton / freshness chip / inline retry) and the layouts visible in the dropdown. A stale,
 * non-error scope auto-refreshes, mirroring the ADR-013 freshness contract.
 */
@Composable
fun LayoutSwitcherContent(
    dashboards: List<SavedDashboardSummary>,
    activeId: String,
    dirty: Boolean,
    editMode: Boolean,
    vehicleState: UiState<SelectedVehicleContext>,
    strings: LayoutSwitcherStrings,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onDuplicate: ((String) -> Unit)?,
    onReset: () -> Unit,
    onToggleEdit: (() -> Unit)?,
    onPinToVehicle: ((layoutId: String, vehicleId: Long?) -> Unit)?,
    onRetryVehicles: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(vehicleState.stale, vehicleState.refreshing, vehicleState.hasError) {
        if (vehicleState.stale && !vehicleState.refreshing && !vehicleState.hasError) onRetryVehicles()
    }
    val context = vehicleState.data ?: SelectedVehicleContext.NONE
    val model =
        remember(dashboards, activeId, context, strings) {
            LayoutSwitcherProjection.project(dashboards, activeId, context, strings)
        }

    var menuOpen by remember { mutableStateOf(false) }
    var confirmResetOpen by remember { mutableStateOf(false) }
    var namePromptOpen by remember { mutableStateOf(false) }

    Box(modifier = modifier) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            LayoutTrigger(
                model = model,
                dirty = dirty,
                strings = strings,
                loading = vehicleState.isLoading,
                onClick = { menuOpen = !menuOpen },
            )
            LayoutActionButtons(
                editMode = editMode,
                strings = strings,
                onToggleEdit = onToggleEdit,
                onSaveAs = { namePromptOpen = true },
                onReset = { confirmResetOpen = true },
            )
            if (vehicleState.fetchedAt != null || vehicleState.refreshing || vehicleState.hasError) {
                LayoutFreshnessChip(state = vehicleState, strings = strings)
            }
        }

        LayoutMenu(
            expanded = menuOpen,
            onDismiss = { menuOpen = false },
            model = model,
            vehicleState = vehicleState,
            strings = strings,
            showPin = onPinToVehicle != null && model.activeId != null,
            onSwitch = { id ->
                menuOpen = false
                onSwitch(id)
            },
            onSaveAs = {
                menuOpen = false
                namePromptOpen = true
            },
            onReset = {
                menuOpen = false
                confirmResetOpen = true
            },
            onPinToggle = {
                menuOpen = false
                onPinToVehicle?.let { handlePinToggle(model, context, it) }
            },
            onRetryVehicles = {
                menuOpen = false
                onRetryVehicles()
            },
        )
    }

    if (confirmResetOpen) {
        ConfirmDialog(
            title = strings.resetTitle,
            message = strings.resetMessage,
            confirmLabel = strings.resetConfirm,
            cancelLabel = strings.cancel,
            onConfirm = {
                confirmResetOpen = false
                onReset()
            },
            onCancel = { confirmResetOpen = false },
            severity = ConfirmSeverity.Danger,
            closeLabel = strings.close,
        )
    }

    if (namePromptOpen) {
        LayoutNamePromptDialog(
            suggestion = model.saveAsSuggestion,
            strings = strings,
            onCancel = { namePromptOpen = false },
            onConfirm = { name ->
                namePromptOpen = false
                handleSaveAs(name, model, onDuplicate, onCreate)
            },
        )
    }
}

/**
 * The always-visible trigger — web's bordered button. Shows the "Layout" label, the truncating active name, an
 * optional "modified" badge ([dirty]), the pinned-vehicle badge, a [loading] skeleton chip while the vehicle
 * scope resolves, and the chevron. The whole control is one accessible button announced as the localized
 * switcher label plus the current layout.
 */
@Composable
private fun LayoutTrigger(
    model: LayoutSwitcherModel,
    dirty: Boolean,
    strings: LayoutSwitcherStrings,
    loading: Boolean,
    onClick: () -> Unit,
) {
    val description =
        buildString {
            append(strings.switcherLabel)
            append(": ")
            append(model.activeName)
            if (dirty) {
                append(" \u00B7 ")
                append(strings.modified)
            }
            model.pinnedLabel?.let { pinned ->
                append(" \u00B7 ")
                append(pinned)
            }
        }
    Surface(
        onClick = onClick,
        modifier =
            Modifier
                .testTag(TRIGGER_TAG)
                .semantics {
                    contentDescription = description
                    role = Role.DropdownList
                },
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(strings.label)
            BodyText(
                model.activeName,
                modifier = Modifier.widthIn(max = ACTIVE_NAME_MAX_WIDTH),
                maxLines = 1,
            )
            if (dirty) {
                Badge(strings.modified, variant = BadgeVariant.Warning)
            }
            model.pinnedLabel?.let { label -> PinnedBadge(label) }
            if (loading) {
                Box(modifier = Modifier.width(LOADING_CHIP_WIDTH)) {
                    Skeleton(height = LOADING_CHIP_HEIGHT, rounded = true)
                }
            }
            Icon(
                TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The pinned-vehicle chip — a pin glyph beside a neutral [label] badge (web `<Badge><Pin/>{label}</Badge>`). */
@Composable
private fun PinnedBadge(label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            TeslaGlyphs.Pin,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Badge(label, variant = BadgeVariant.Neutral)
    }
}

/**
 * The inline edit / save-as / reset action group (web `hidden sm:flex`). Rendered as compact icon buttons so
 * every affordance stays reachable on a phone; each carries a localized TalkBack label. The edit toggle is
 * shown only when [onToggleEdit] is wired and reflects its pressed state via the selected semantic + tint.
 */
@Composable
private fun LayoutActionButtons(
    editMode: Boolean,
    strings: LayoutSwitcherStrings,
    onToggleEdit: (() -> Unit)?,
    onSaveAs: () -> Unit,
    onReset: () -> Unit,
) {
    onToggleEdit?.let { toggle ->
        IconButton(
            imageVector = TeslaGlyphs.Edit,
            contentDescription = if (editMode) strings.editExit else strings.editEnter,
            onClick = toggle,
            modifier = Modifier.semantics { selected = editMode },
            size = IconSize.Md,
            tint = if (editMode) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    IconButton(
        imageVector = LayoutSwitcherGlyphs.Save,
        contentDescription = strings.saveAs,
        onClick = onSaveAs,
        size = IconSize.Md,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    IconButton(
        imageVector = LayoutSwitcherGlyphs.Reset,
        contentDescription = strings.reset,
        onClick = onReset,
        size = IconSize.Md,
        tint = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Stale/offline freshness chip — maps the vehicle feed's freshness onto the shared [DataFreshness] indicator. */
@Composable
private fun LayoutFreshnessChip(
    state: UiState<SelectedVehicleContext>,
    strings: LayoutSwitcherStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.loadingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = rememberRelativeAgeFormatter(),
    )
}

/**
 * The popup layouts menu — the web `role="menu"` dropdown. Lists the visible layouts (or the empty message),
 * then "New layout from current", an optional pin/unpin toggle, "Reset to default", and the footer hint. When
 * the vehicle scope failed to load it leads with an inline offline + retry affordance so scoping/pinning can
 * recover, while layout switching keeps working.
 */
@Composable
private fun LayoutMenu(
    expanded: Boolean,
    onDismiss: () -> Unit,
    model: LayoutSwitcherModel,
    vehicleState: UiState<SelectedVehicleContext>,
    strings: LayoutSwitcherStrings,
    showPin: Boolean,
    onSwitch: (String) -> Unit,
    onSaveAs: () -> Unit,
    onReset: () -> Unit,
    onPinToggle: () -> Unit,
    onRetryVehicles: () -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.widthIn(min = MENU_MIN_WIDTH).semantics { contentDescription = strings.menuLabel },
    ) {
        if (vehicleState.canRetry) {
            OfflineRetryRow(strings = strings, onRetry = onRetryVehicles)
            HorizontalDivider()
        }

        if (model.isEmpty) {
            Box(modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm)) {
                Caption(strings.noneVisible)
            }
        } else {
            model.items.forEach { item ->
                LayoutItemRow(item = item, strings = strings, onClick = { onSwitch(item.id) })
            }
        }

        HorizontalDivider()

        DropdownMenuItem(
            text = { BodyText(strings.newFromCurrent) },
            onClick = onSaveAs,
            leadingIcon = {
                Icon(
                    TeslaGlyphs.Plus,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            },
        )

        if (showPin) {
            DropdownMenuItem(
                text = { BodyText(if (model.pinToggleIsUnpin) strings.unpin else strings.pin) },
                onClick = onPinToggle,
                enabled = model.canPinToggle,
                leadingIcon = {
                    Icon(
                        TeslaGlyphs.Pin,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                },
            )
        }

        DropdownMenuItem(
            text = { BodyText(strings.reset, color = MaterialTheme.colorScheme.error) },
            onClick = onReset,
            leadingIcon = {
                Icon(
                    LayoutSwitcherGlyphs.Reset,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.error,
                )
            },
        )

        HorizontalDivider()

        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                LayoutSwitcherGlyphs.MoreHorizontal,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(strings.menuFooter)
        }
    }
}

/** One layout row — name + optional "default" badge + pin glyph, with an active check + highlight + selected semantic. */
@Composable
private fun LayoutItemRow(
    item: LayoutMenuItem,
    strings: LayoutSwitcherStrings,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        modifier = Modifier.testTag("$ITEM_TAG_PREFIX${item.id}").semantics { selected = item.isActive },
        text = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                BodyText(
                    item.name,
                    maxLines = 1,
                    color =
                        if (item.isActive) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                )
                if (item.isDefault) {
                    Badge(strings.defaultBadge, variant = BadgeVariant.Neutral)
                }
                if (item.isPinned) {
                    Icon(
                        TeslaGlyphs.Pin,
                        contentDescription = null,
                        size = IconSize.Xs,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        trailingIcon =
            if (item.isActive) {
                {
                    Icon(
                        TeslaGlyphs.Check,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            } else {
                null
            },
        onClick = onClick,
    )
}

/** Inline offline + retry affordance shown atop the menu when the vehicle scope failed to load. */
@Composable
private fun OfflineRetryRow(
    strings: LayoutSwitcherStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(strings.offlineLabel)
        Button(
            label = strings.retry,
            onClick = onRetry,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/**
 * Save-as name dialog — the native analogue of the web `window.prompt`. Pre-fills [suggestion], requires a
 * non-blank trimmed name, and routes the confirmed value to [onConfirm]. Faithful to the web quirk, the typed
 * name is only consulted when the host supplied no `onDuplicate` (the caller in [handleSaveAs] enforces this).
 */
@Composable
private fun LayoutNamePromptDialog(
    suggestion: String,
    strings: LayoutSwitcherStrings,
    onCancel: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var name by remember(suggestion) { mutableStateOf(suggestion) }
    val trimmed = name.trim()
    Modal(
        onDismissRequest = onCancel,
        title = strings.saveAs,
        closeLabel = strings.close,
    ) {
        Input(
            value = name,
            onValueChange = { name = it },
            label = strings.saveAsPrompt,
            singleLine = true,
        )
        Spacer(Modifier.height(Spacing.lg))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.cancel,
                onClick = onCancel,
                variant = ButtonVariant.Secondary,
            )
            Button(
                label = strings.saveAsShort,
                onClick = { onConfirm(trimmed) },
                variant = ButtonVariant.Primary,
                enabled = trimmed.isNotEmpty(),
            )
        }
    }
}

/**
 * Routes a confirmed save-as: a blank name is ignored; otherwise the web precedence applies — duplicate the
 * active layout when [onDuplicate] is wired (the typed name is intentionally ignored, web parity), else create
 * a new layout with the typed [name].
 */
private fun handleSaveAs(
    name: String,
    model: LayoutSwitcherModel,
    onDuplicate: ((String) -> Unit)?,
    onCreate: (String) -> Unit,
) {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return
    val activeId = model.activeId
    if (onDuplicate != null && activeId != null) {
        onDuplicate(activeId)
    } else {
        onCreate(trimmed)
    }
}

/**
 * Routes a pin/unpin toggle (web `handlePinToggle`): unpins the active layout when it is currently pinned,
 * otherwise pins it to the selected vehicle when one is available; a no-op when neither applies.
 */
private fun handlePinToggle(
    model: LayoutSwitcherModel,
    context: SelectedVehicleContext,
    onPinToVehicle: (layoutId: String, vehicleId: Long?) -> Unit,
) {
    val activeId = model.activeId ?: return
    when {
        model.activeVehicleId != null -> onPinToVehicle(activeId, null)
        context.vehicleId != null -> onPinToVehicle(activeId, context.vehicleId)
        else -> Unit
    }
}

/**
 * Resolves the localized [LayoutSwitcherStrings] from the i18n catalog (P1/S10) — every `dashboard.layout.*`
 * key the web component reads via `t(...)`, plus the shared `common.*` / `freshness.*` chrome keys. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberLayoutSwitcherStrings(): LayoutSwitcherStrings {
    val label = stringResource(R.string.translation_dashboard_layout_label)
    val switcherLabel = stringResource(R.string.translation_dashboard_layout_switcherLabel)
    val untitled = stringResource(R.string.translation_dashboard_layout_untitled)
    val modified = stringResource(R.string.translation_dashboard_layout_modified)
    val menuLabel = stringResource(R.string.translation_dashboard_layout_menuLabel)
    val noneVisible = stringResource(R.string.translation_dashboard_layout_noneVisible)
    val defaultBadge = stringResource(R.string.translation_dashboard_layout_defaultBadge)
    val newFromCurrent = stringResource(R.string.translation_dashboard_layout_newFromCurrent)
    val pin = stringResource(R.string.translation_dashboard_layout_pin)
    val unpin = stringResource(R.string.translation_dashboard_layout_unpin)
    val reset = stringResource(R.string.translation_dashboard_layout_reset)
    val menuFooter = stringResource(R.string.translation_dashboard_layout_menuFooter)
    val editEnter = stringResource(R.string.translation_dashboard_layout_editEnter)
    val editExit = stringResource(R.string.translation_dashboard_layout_editExit)
    val editTitle = stringResource(R.string.translation_dashboard_layout_editTitle)
    val saveAs = stringResource(R.string.translation_dashboard_layout_saveAs)
    val saveAsShort = stringResource(R.string.translation_dashboard_layout_saveAsShort)
    val saveAsPrompt = stringResource(R.string.translation_dashboard_layout_saveAsPrompt)
    val newLayoutDefault = stringResource(R.string.translation_dashboard_layout_newLayoutDefault)
    val resetTitle = stringResource(R.string.translation_dashboard_layout_resetTitle)
    val resetMessage = stringResource(R.string.translation_dashboard_layout_resetMessage)
    val resetConfirm = stringResource(R.string.translation_dashboard_layout_resetConfirm)
    val cancel = stringResource(R.string.translation_common_cancel)
    val close = stringResource(R.string.translation_common_close)
    val loadingLabel = stringResource(R.string.translation_common_loading)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    val retry = stringResource(R.string.translation_common_retry)
    return remember(label, switcherLabel, untitled, menuLabel, noneVisible, saveAs, resetTitle, resetMessage) {
        LayoutSwitcherStrings(
            label = label,
            switcherLabel = switcherLabel,
            untitled = untitled,
            modified = modified,
            menuLabel = menuLabel,
            noneVisible = noneVisible,
            defaultBadge = defaultBadge,
            newFromCurrent = newFromCurrent,
            pin = pin,
            unpin = unpin,
            reset = reset,
            menuFooter = menuFooter,
            editEnter = editEnter,
            editExit = editExit,
            editTitle = editTitle,
            saveAs = saveAs,
            saveAsShort = saveAsShort,
            saveAsPrompt = saveAsPrompt,
            newLayoutDefault = newLayoutDefault,
            resetTitle = resetTitle,
            resetMessage = resetMessage,
            resetConfirm = resetConfirm,
            cancel = cancel,
            close = close,
            loadingLabel = loadingLabel,
            offlineLabel = offlineLabel,
            retry = retry,
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the render layer carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
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
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws lucide `Save`, `RotateCcw`, and `MoreHorizontal`. The shared [TeslaGlyphs] set does
// not carry them and a feature view may not expand the shared icon library from a surface prompt, so — exactly
// as the sibling surfaces author their local glyphs — they are drawn here as 24×24 stroked vectors recolored
// at render time by the `Icon` tint.
private object LayoutSwitcherGlyphs {
    /** lucide `Save` — a floppy disk: body with a cut corner, a top shutter, and a bottom label panel. */
    val Save: ImageVector =
        stroked("Save") {
            moveTo(5f, 5f)
            lineTo(15f, 5f)
            lineTo(19f, 9f)
            lineTo(19f, 19f)
            lineTo(5f, 19f)
            close()
            moveTo(8f, 5f)
            lineTo(8f, 9f)
            lineTo(14f, 9f)
            lineTo(14f, 5f)
            moveTo(8f, 13f)
            lineTo(16f, 13f)
            lineTo(16f, 19f)
            lineTo(8f, 19f)
            close()
        }

    /** lucide `RotateCcw` — a counter-clockwise circular arrow with a corner arrowhead at the top-left. */
    val Reset: ImageVector =
        stroked("RotateCcw") {
            moveTo(5f, 8.5f)
            arcTo(7f, 7f, 0f, true, true, 9f, 18.8f)
            moveTo(5f, 8.5f)
            lineTo(4.6f, 4.4f)
            moveTo(5f, 8.5f)
            lineTo(9.1f, 8f)
        }

    /** lucide `MoreHorizontal` — three round dots in a row. */
    val MoreHorizontal: ImageVector =
        stroked("MoreHorizontal") {
            dot(6f, 12f)
            dot(12f, 12f)
            dot(18f, 12f)
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_STRINGS =
    LayoutSwitcherStrings(
        label = "Layout",
        switcherLabel = "Switch dashboard layout",
        untitled = "Untitled",
        modified = "modified",
        menuLabel = "Saved layouts",
        noneVisible = "No layouts available for this vehicle.",
        defaultBadge = "default",
        newFromCurrent = "New layout from current",
        pin = "Pin to current vehicle",
        unpin = "Unpin from vehicle",
        reset = "Reset to default",
        menuFooter = "Manage layouts in the tab strip below",
        editEnter = "Edit",
        editExit = "Done",
        editTitle = "Edit dashboard (E)",
        saveAs = "Save as new layout",
        saveAsShort = "Save as",
        saveAsPrompt = "Name for the new layout:",
        newLayoutDefault = "New Layout",
        resetTitle = "Reset dashboard to default?",
        resetMessage = "This removes all customizations and restores the shipped default dashboard.",
        resetConfirm = "Reset",
        cancel = "Cancel",
        close = "Close",
        loadingLabel = "Loading...",
        offlineLabel = "Offline",
        retry = "Retry",
    )

private val PREVIEW_DASHBOARDS =
    listOf(
        SavedDashboardSummary(id = "default", name = "Overview", isDefault = true),
        SavedDashboardSummary(id = "trips", name = "Trips"),
        SavedDashboardSummary(id = "garage", name = "Garage", vehicleId = 1L),
    )

@Preview(name = "Content — pinned + dirty", showBackground = true)
@Composable
private fun LayoutSwitcherContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutSwitcherContent(
            dashboards = PREVIEW_DASHBOARDS,
            activeId = "garage",
            dirty = true,
            editMode = false,
            vehicleState = UiState(UiPhase.Content, data = SelectedVehicleContext(1L, "Model 3"), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
            onSwitch = {},
            onCreate = {},
            onDuplicate = {},
            onReset = {},
            onToggleEdit = {},
            onPinToVehicle = { _, _ -> },
            onRetryVehicles = {},
        )
    }
}

@Preview(name = "Loading scope", showBackground = true)
@Composable
private fun LayoutSwitcherLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutSwitcherContent(
            dashboards = PREVIEW_DASHBOARDS,
            activeId = "default",
            dirty = false,
            editMode = true,
            vehicleState = UiState.loading(),
            strings = PREVIEW_STRINGS,
            onSwitch = {},
            onCreate = {},
            onDuplicate = null,
            onReset = {},
            onToggleEdit = {},
            onPinToVehicle = null,
            onRetryVehicles = {},
        )
    }
}

@Preview(name = "Offline scope", showBackground = true)
@Composable
private fun LayoutSwitcherOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutSwitcherContent(
            dashboards = PREVIEW_DASHBOARDS,
            activeId = "trips",
            dirty = false,
            editMode = false,
            vehicleState =
                UiState(
                    UiPhase.Content,
                    data = SelectedVehicleContext(1L, "Model 3"),
                    stale = true,
                    errorKind = io.teslasync.android.data.ErrorKind.Network,
                    fetchedAt = 1L,
                ),
            strings = PREVIEW_STRINGS,
            onSwitch = {},
            onCreate = {},
            onDuplicate = {},
            onReset = {},
            onToggleEdit = {},
            onPinToVehicle = { _, _ -> },
            onRetryVehicles = {},
        )
    }
}
