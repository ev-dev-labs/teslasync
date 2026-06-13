// The native Jetpack Compose + Material 3 SavedViewMenu shared surface — a parity port of
// web/src/components/data-display/SavedViewMenu.tsx. The web surface is a list-page "save this filter combo and
// recall it later" affordance composed of three coordinated pieces: a trigger button (whose label collapses to
// the active view's name when the current querystring matches a saved view), an anchored popover (pinned views
// first, each row offering apply / set-default / pin / rename / delete), and a small "applied" badge with a
// clear button when a view is active. It also auto-applies the default view once on first mount when the URL
// carries no querystring, and offers Save / Rename / Delete-confirm / Manage dialogs.
//
// There is no native popover/badge atom beyond the shared ui/feedback primitives (the atomic SavedViewMenu in
// components/data-display is the OUT-OF-SCOPE P3 component-library bundle and uses a different id shape), so the
// trigger + popover + dialogs are composed here from the shared atoms (GlassPanel/Popover/Button/Badge/Input/
// Modal/ConfirmDialog/EmptyState/QueryError/Skeleton/StatusPill/typography). All data flows through the shared
// [SavedViewMenuViewModel] (P1/S8); the view performs NO HTTP. Every visible string resolves through the i18n
// catalog (P1/S10) and the interactive elements carry TalkBack labels; apply/clear outcomes are announced
// through a polite live region (the web `useAnnouncer`).
//
// Every state the web draws plus the feed's lifecycle is reproduced without hiding a region: loading skeleton,
// the rows, a friendly empty state with a "Save current view" action, a classified QueryError with retry, and a
// stale/offline freshness chip over cached rows.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SavedViewMenu) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content, dialogs, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.savedviewmenu

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.savedviews.SavedView

/** Web `w-72` popover width (18rem). */
private val PANEL_WIDTH: Dp = 288.dp

/** Web `max-h-72` scrollable rows region. */
private val PANEL_LIST_MAX_HEIGHT: Dp = 288.dp

/** The per-row action callbacks, bundled so the popover rows and the manage-dialog rows share one shape. */
data class SavedViewRowActions(
    val onApply: (SavedView) -> Unit,
    val onToggleDefault: (SavedView) -> Unit,
    val onTogglePin: (SavedView) -> Unit,
    val onRename: (SavedView) -> Unit,
    val onDelete: (SavedView) -> Unit,
)

/**
 * Stateful entry point — the faithful port of the web `SavedViewMenu`. Binds the saved-views feed + mutations
 * via [source] into a [SavedViewMenuViewModel], records the one-shot `view.opened` diagnostic, folds the live
 * feed through [SavedViewMenuProjection], auto-applies the default once on first mount (web mount effect),
 * auto-refreshes a stale cache, owns the transient menu/dialog open-state (web `useState`), and renders the
 * trigger + popover + applied badge + dialogs. The surface performs no HTTP.
 *
 * @param source the saved-views read + mutation seam (host-wired from the shared S8 `SavedViewsStore`).
 * @param route the SPA list-page route this menu manages views for (web `route` prop).
 * @param currentQuery the current canonical querystring for the page, no leading '?' (web `currentQuery`).
 * @param onApply applies a saved view's querystring; the empty string clears back to the unfiltered route.
 */
@Composable
fun SavedViewMenu(
    source: SavedViewMenuSource,
    route: String,
    currentQuery: String,
    onApply: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SavedViewMenuRegistration.SLUG,
) {
    val viewModel: SavedViewMenuViewModel =
        viewModel(key = "$instanceKey:$route", factory = SavedViewMenuViewModel.factory(source, route, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val state by viewModel.views.collectAsStateWithLifecycle()
    val saving by viewModel.saving.collectAsStateWithLifecycle()
    val renaming by viewModel.renaming.collectAsStateWithLifecycle()
    val deleting by viewModel.deleting.collectAsStateWithLifecycle()
    val display = remember(state, currentQuery) { SavedViewMenuProjection.project(state, currentQuery) }
    val strings = rememberSavedViewMenuStrings()

    // Auto-apply the default view once on first mount when no query is applied (web `autoAppliedRef` effect).
    val autoApplied = rememberSaveable(route) { mutableStateOf(false) }
    LaunchedEffect(display.defaultView, currentQuery) {
        val default = display.defaultView
        if (!autoApplied.value && default != null) {
            autoApplied.value = true
            if (SavedViewMenuProjection.shouldAutoApplyDefault(currentQuery, default)) onApply(default.query)
        }
    }

    // Stale cache → auto-refresh (the prompt's stale-state contract); keyed on the freshness stamp so it fires
    // at most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    var menuExpanded by rememberSaveable(route) { mutableStateOf(false) }
    var saveOpen by rememberSaveable(route) { mutableStateOf(false) }
    var manageOpen by rememberSaveable(route) { mutableStateOf(false) }
    var renameTarget by remember { mutableStateOf<SavedView?>(null) }
    var deleteTarget by remember { mutableStateOf<SavedView?>(null) }
    var announcement by remember { mutableStateOf("") }

    val rowActions =
        SavedViewRowActions(
            onApply = { view ->
                onApply(view.query)
                menuExpanded = false
                announcement = strings.announceApplied(view.name)
            },
            onToggleDefault = viewModel::toggleDefault,
            onTogglePin = viewModel::togglePin,
            onRename = { view ->
                renameTarget = view
                menuExpanded = false
            },
            onDelete = { view ->
                deleteTarget = view
                menuExpanded = false
            },
        )

    FadeIn(modifier = modifier) {
        SavedViewMenuContent(
            display = display,
            strings = strings,
            expanded = menuExpanded,
            announcement = announcement,
            actions = rowActions,
            onExpandedChange = { menuExpanded = it },
            onClear = {
                onApply("")
                announcement = strings.announceCleared
            },
            onManage = {
                menuExpanded = false
                manageOpen = true
            },
            onSaveCurrent = {
                menuExpanded = false
                saveOpen = true
            },
            onRetry = viewModel::retry,
        )
    }

    if (saveOpen) {
        SavedViewSaveDialog(
            strings = strings,
            saving = saving,
            onDismiss = { saveOpen = false },
            onSave = { name, makeDefault ->
                viewModel.create(name, makeDefault, currentQuery) { saveOpen = false }
            },
        )
    }
    renameTarget?.let { target ->
        SavedViewRenameDialog(
            view = target,
            strings = strings,
            saving = renaming,
            onDismiss = { renameTarget = null },
            onRename = { name -> viewModel.rename(target, name) { renameTarget = null } },
        )
    }
    deleteTarget?.let { target ->
        SavedViewDeleteDialog(
            view = target,
            strings = strings,
            loading = deleting,
            onCancel = { deleteTarget = null },
            onConfirm = { viewModel.delete(target) { deleteTarget = null } },
        )
    }
    if (manageOpen) {
        SavedViewManageDialog(
            display = display,
            strings = strings,
            currentQuery = currentQuery,
            actions =
                rowActions.copy(
                    onApply = { view ->
                        onApply(view.query)
                        manageOpen = false
                        announcement = strings.announceApplied(view.name)
                    },
                    onRename = { renameTarget = it },
                    onDelete = { deleteTarget = it },
                ),
            onDismiss = { manageOpen = false },
        )
    }
}

/**
 * Stateless trigger + anchored-popover host + applied badge — the unit/UI-test + preview entry point. Renders
 * the trigger always; the [Popover] (a focusable Compose `Popup` that dismisses on Back / outside tap) carries
 * the [SavedViewMenuPanel] while [expanded], anchored directly below the trigger via its measured height. The
 * applied badge + polite [Announcer] are rendered alongside.
 */
@Composable
fun SavedViewMenuContent(
    display: SavedViewMenuDisplay,
    strings: SavedViewMenuStrings,
    expanded: Boolean,
    actions: SavedViewRowActions,
    onExpandedChange: (Boolean) -> Unit,
    onClear: () -> Unit,
    onManage: () -> Unit,
    onSaveCurrent: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    announcement: String = "",
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box {
                var anchorHeightPx by remember { mutableIntStateOf(0) }
                SavedViewTrigger(
                    active = display.activeView,
                    title = strings.title,
                    onClick = { onExpandedChange(!expanded) },
                    modifier = Modifier.onSizeChanged { anchorHeightPx = it.height },
                )
                Popover(
                    expanded = expanded,
                    onDismissRequest = { onExpandedChange(false) },
                    alignment = Alignment.TopStart,
                    offset = IntOffset(0, anchorHeightPx),
                    accessibleName = strings.title,
                ) {
                    SavedViewMenuPanel(
                        display = display,
                        strings = strings,
                        actions = actions,
                        onManage = onManage,
                        onSaveCurrent = onSaveCurrent,
                        onRetry = onRetry,
                    )
                }
            }
            display.activeView?.let { active ->
                AppliedBadge(view = active, strings = strings, onClear = onClear)
            }
        }
        if (announcement.isNotEmpty()) {
            Announcer(announcement)
        }
    }
}

/**
 * The popover body — the web menu panel. Header (title + freshness chip + Manage), then the per-phase region
 * (loading skeleton / rows / friendly empty state / classified error), then the "Save current view" footer.
 */
@Composable
fun SavedViewMenuPanel(
    display: SavedViewMenuDisplay,
    strings: SavedViewMenuStrings,
    actions: SavedViewRowActions,
    onManage: () -> Unit,
    onSaveCurrent: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier.width(PANEL_WIDTH), padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(strings.title, modifier = Modifier.weight(1f))
            if (display.showFreshnessChip) {
                FreshnessChip(display = display, strings = strings)
            }
            if (display.hasViews) {
                Button(
                    label = strings.manage,
                    onClick = onManage,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }
        when (display.phase) {
            UiPhase.Loading -> PanelLoading(strings = strings)
            UiPhase.Error ->
                QueryError(
                    kind = SavedViewMenuProjection.queryErrorKind(display),
                    resourceName = strings.title,
                    onRetry = onRetry,
                )
            UiPhase.Empty ->
                EmptyState(
                    message = strings.empty,
                    action = EmptyStateAction(label = strings.saveCurrent, onClick = onSaveCurrent),
                )
            UiPhase.Content -> {
                Column(
                    modifier =
                        Modifier
                            .heightIn(max = PANEL_LIST_MAX_HEIGHT)
                            .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(Spacing.none),
                ) {
                    display.views.forEach { view ->
                        SavedViewRow(
                            view = view,
                            isActive = view.id == display.activeView?.id,
                            strings = strings,
                            actions = actions,
                        )
                    }
                }
                SavedViewFooter(strings = strings, onSaveCurrent = onSaveCurrent)
            }
        }
    }
}

/** A single popover row — the apply target (default star + name) plus the default / pin / rename / delete actions. */
@Composable
private fun SavedViewRow(
    view: SavedView,
    isActive: Boolean,
    strings: SavedViewMenuStrings,
    actions: SavedViewRowActions,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            onClick = { actions.onApply(view) },
            modifier = Modifier.weight(1f),
            variant = if (isActive) ButtonVariant.Secondary else ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        ) {
            if (view.isDefault) {
                Icon(
                    SavedViewGlyphs.Star,
                    contentDescription = strings.defaultBadge,
                    size = IconSize.Xs,
                    tint = TeslaTokens.status.warning,
                )
                Spacer(Modifier.width(Spacing.xs))
            }
            BodyText(view.name, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
        }
        SavedViewRowActionsRow(view = view, strings = strings, actions = actions, size = IconSize.Sm)
    }
}

/** The trailing per-row action buttons (default / pin / rename / delete), shared by the popover + manage rows. */
@Composable
private fun SavedViewRowActionsRow(
    view: SavedView,
    strings: SavedViewMenuStrings,
    actions: SavedViewRowActions,
    size: IconSize,
) {
    IconButton(
        imageVector = SavedViewGlyphs.Star,
        contentDescription = if (view.isDefault) strings.unsetDefault else strings.setDefault,
        onClick = { actions.onToggleDefault(view) },
        size = size,
        tint = if (view.isDefault) TeslaTokens.status.warning else LocalContentColor.current,
    )
    IconButton(
        imageVector = if (view.isPinned) SavedViewGlyphs.PinOff else TeslaGlyphs.Pin,
        contentDescription = if (view.isPinned) strings.unpin else strings.pin,
        onClick = { actions.onTogglePin(view) },
        size = size,
    )
    IconButton(
        imageVector = TeslaGlyphs.Edit,
        contentDescription = strings.rename,
        onClick = { actions.onRename(view) },
        size = size,
    )
    IconButton(
        imageVector = SavedViewGlyphs.Trash,
        contentDescription = strings.delete,
        onClick = { actions.onDelete(view) },
        size = size,
        tint = TeslaTokens.status.danger,
    )
}

/** The "Save current view…" footer affordance below the rows (web popover footer). */
@Composable
private fun SavedViewFooter(
    strings: SavedViewMenuStrings,
    onSaveCurrent: () -> Unit,
) {
    Button(
        label = strings.saveCurrent,
        onClick = onSaveCurrent,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = TeslaGlyphs.Plus,
        modifier = Modifier.padding(top = Spacing.xs),
    )
}

/** The trigger button — bookmark glyph + the active view's name (primary) or the "Saved views" title. */
@Composable
private fun SavedViewTrigger(
    active: SavedView?,
    title: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Button(
        label = active?.name ?: title,
        onClick = onClick,
        modifier = modifier,
        variant = if (active != null) ButtonVariant.Primary else ButtonVariant.Secondary,
        size = ButtonSize.Sm,
        leadingIcon = if (active != null) SavedViewGlyphs.BookmarkCheck else SavedViewGlyphs.Bookmark,
    )
}

/** The "View: <name>" applied chip + a clear button (web `Badge` + `X`). */
@Composable
private fun AppliedBadge(
    view: SavedView,
    strings: SavedViewMenuStrings,
    onClear: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Badge(text = "${strings.appliedBadge}: ${view.name}", variant = BadgeVariant.Info)
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = strings.clearApplied,
            onClick = onClear,
            size = IconSize.Sm,
        )
    }
}

/** The stale/offline freshness chip shown over cached rows (the prompt's stale/offline contract). */
@Composable
private fun FreshnessChip(
    display: SavedViewMenuDisplay,
    strings: SavedViewMenuStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
    }
}

/** The first-load skeleton chrome — never a blank box (the prompt's loading contract). */
@Composable
private fun PanelLoading(strings: SavedViewMenuStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = ROW_SKELETON_FRACTION_WIDE, height = ROW_SKELETON_HEIGHT)
        Skeleton(widthFraction = ROW_SKELETON_FRACTION_MID, height = ROW_SKELETON_HEIGHT)
        Skeleton(widthFraction = ROW_SKELETON_FRACTION_NARROW, height = ROW_SKELETON_HEIGHT)
    }
}

/** An off-screen polite live region so TalkBack reads apply/clear outcomes (web `useAnnouncer`). */
@Composable
private fun Announcer(text: String) {
    Box(
        modifier =
            Modifier
                .size(ANNOUNCER_SIZE)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = text
                },
    )
}

// ── Dialogs ──────────────────────────────────────────────────────────────────────────────────────────

/** The "Save current view…" dialog — a name field, a "make default" checkbox, and Cancel / Save actions. */
@Composable
private fun SavedViewSaveDialog(
    strings: SavedViewMenuStrings,
    saving: Boolean,
    onDismiss: () -> Unit,
    onSave: (name: String, makeDefault: Boolean) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var makeDefault by rememberSaveable { mutableStateOf(false) }
    val trimmed = name.trim()
    Modal(onDismissRequest = onDismiss, title = strings.saveCurrent, closeLabel = strings.close) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = name,
                onValueChange = { name = it },
                label = strings.name,
                hint = strings.nameHint,
            )
            Checkbox(checked = makeDefault, onCheckedChange = { makeDefault = it }, label = strings.makeDefault)
            DialogActions(
                cancelLabel = strings.cancel,
                confirmLabel = if (saving) strings.saving else strings.save,
                confirmEnabled = trimmed.isNotEmpty() && !saving,
                loading = saving,
                onCancel = onDismiss,
                onConfirm = { onSave(trimmed, makeDefault) },
            )
        }
    }
}

/** The "Rename view" dialog — a pre-filled name field and Cancel / Save actions. */
@Composable
private fun SavedViewRenameDialog(
    view: SavedView,
    strings: SavedViewMenuStrings,
    saving: Boolean,
    onDismiss: () -> Unit,
    onRename: (name: String) -> Unit,
) {
    var name by rememberSaveable(view.id) { mutableStateOf(view.name) }
    val trimmed = name.trim()
    Modal(onDismissRequest = onDismiss, title = strings.rename, closeLabel = strings.close) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Input(
                value = name,
                onValueChange = { name = it },
                label = strings.name,
                hint = strings.nameHint,
            )
            DialogActions(
                cancelLabel = strings.cancel,
                confirmLabel = if (saving) strings.saving else strings.save,
                confirmEnabled = trimmed.isNotEmpty() && !saving,
                loading = saving,
                onCancel = onDismiss,
                onConfirm = { onRename(trimmed) },
            )
        }
    }
}

/** The delete confirmation — the shared danger [ConfirmDialog] with the view's name interpolated. */
@Composable
private fun SavedViewDeleteDialog(
    view: SavedView,
    strings: SavedViewMenuStrings,
    loading: Boolean,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    ConfirmDialog(
        title = strings.deleteTitle,
        message = strings.deleteConfirm(view.name),
        confirmLabel = strings.delete,
        cancelLabel = strings.cancel,
        onConfirm = onConfirm,
        onCancel = onCancel,
        severity = ConfirmSeverity.Danger,
        loading = loading,
        closeLabel = strings.close,
    )
}

/** The "Manage views" dialog — every view as a full row, or a friendly empty state, with a Close action. */
@Composable
private fun SavedViewManageDialog(
    display: SavedViewMenuDisplay,
    strings: SavedViewMenuStrings,
    currentQuery: String,
    actions: SavedViewRowActions,
    onDismiss: () -> Unit,
) {
    Modal(onDismissRequest = onDismiss, title = strings.manage, closeLabel = strings.close) {
        if (display.views.isEmpty()) {
            EmptyState(message = strings.empty)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                display.views.forEach { view ->
                    SavedViewManageRow(
                        view = view,
                        isActive = view.query == currentQuery,
                        strings = strings,
                        actions = actions,
                    )
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = Spacing.md), horizontalArrangement = Arrangement.End) {
            Button(label = strings.close, onClick = onDismiss, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
        }
    }
}

/** A manage-dialog row — the name + default badge + the querystring caption, then the per-row actions. */
@Composable
private fun SavedViewManageRow(
    view: SavedView,
    isActive: Boolean,
    strings: SavedViewMenuStrings,
    actions: SavedViewRowActions,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(Spacing.none),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                if (view.isDefault) {
                    Badge(text = strings.defaultBadge, variant = BadgeVariant.Neutral)
                }
                BodyText(
                    view.name,
                    maxLines = 1,
                    color = if (isActive) TeslaTokens.status.info else LocalContentColor.current,
                )
            }
            Caption(view.query.ifEmpty { strings.emptyQuery })
        }
        Button(
            label = strings.appliedBadge,
            onClick = { actions.onApply(view) },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
        )
        SavedViewRowActionsRow(view = view, strings = strings, actions = actions, size = IconSize.Md)
    }
}

/** The shared Cancel / confirm action row used by the save + rename dialogs. */
@Composable
private fun DialogActions(
    cancelLabel: String,
    confirmLabel: String,
    confirmEnabled: Boolean,
    loading: Boolean,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(cancelLabel, onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        Button(confirmLabel, onConfirm, size = ButtonSize.Sm, enabled = confirmEnabled, loading = loading)
    }
}

/**
 * Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. Every string
 * resolves through a `translation_*` key — no English literal in native code.
 */
@Composable
private fun rememberSavedViewMenuStrings(): SavedViewMenuStrings =
    SavedViewMenuStrings(
        title = stringResource(R.string.translation_savedViews_title),
        manage = stringResource(R.string.translation_savedViews_manage),
        empty = stringResource(R.string.translation_savedViews_empty),
        saveCurrent = stringResource(R.string.translation_savedViews_saveCurrent),
        defaultBadge = stringResource(R.string.translation_savedViews_defaultBadge),
        setDefault = stringResource(R.string.translation_savedViews_setDefault),
        unsetDefault = stringResource(R.string.translation_savedViews_unsetDefault),
        pin = stringResource(R.string.translation_savedViews_pin),
        unpin = stringResource(R.string.translation_savedViews_unpin),
        rename = stringResource(R.string.translation_savedViews_renamePrompt),
        delete = stringResource(R.string.translation_common_delete),
        cancel = stringResource(R.string.translation_common_cancel),
        save = stringResource(R.string.translation_common_save),
        saving = stringResource(R.string.translation_common_saving),
        close = stringResource(R.string.translation_common_close),
        name = stringResource(R.string.translation_savedViews_name),
        nameHint = stringResource(R.string.translation_savedViews_namePlaceholder), // parity:allow i18n resource key id
        makeDefault = stringResource(R.string.translation_savedViews_makeDefault),
        appliedBadge = stringResource(R.string.translation_savedViews_appliedBadge),
        clearApplied = stringResource(R.string.translation_savedViews_clearApplied),
        emptyQuery = stringResource(R.string.translation_savedViews_emptyQuery),
        deleteTitle = stringResource(R.string.translation_savedViews_deleteTitle),
        deleteConfirmTemplate = stringResource(R.string.translation_savedViews_deleteConfirm),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        announceAppliedTemplate = stringResource(R.string.translation_savedViews_announceApplied),
        announceCleared = stringResource(R.string.translation_savedViews_announceCleared),
    )

private const val ROW_SKELETON_FRACTION_WIDE = 0.9f
private const val ROW_SKELETON_FRACTION_MID = 0.7f
private const val ROW_SKELETON_FRACTION_NARROW = 0.5f
private val ROW_SKELETON_HEIGHT = 16.dp
private val ANNOUNCER_SIZE = 1.dp

// ── Locally authored glyphs (absent from the shared TeslaGlyphs catalog + outside this surface's allowed-
// files scope, so drawn here as 24×24 stroked vectors recolored at render time by the Icon tint, exactly as
// the sibling AIDigestNarration authors its Helix mark). ──────────────────────────────────────────────────

private object SavedViewGlyphs {
    val Bookmark: ImageVector =
        stroked("SavedViewBookmark") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 20f)
            lineTo(12f, 15.5f)
            lineTo(7f, 20f)
            close()
        }

    val BookmarkCheck: ImageVector =
        stroked("SavedViewBookmarkCheck") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 20f)
            lineTo(12f, 15.5f)
            lineTo(7f, 20f)
            close()
            moveTo(9.3f, 10f)
            lineTo(11.2f, 11.9f)
            lineTo(14.7f, 8f)
        }

    val Star: ImageVector =
        stroked("SavedViewStar") {
            moveTo(12f, 3f)
            lineTo(13.9f, 9.1f)
            lineTo(20f, 9.3f)
            lineTo(15.1f, 13.2f)
            lineTo(17f, 20f)
            lineTo(12f, 16.2f)
            lineTo(7f, 20f)
            lineTo(8.9f, 13.2f)
            lineTo(4f, 9.3f)
            lineTo(10.1f, 9.1f)
            close()
        }

    val PinOff: ImageVector =
        stroked("SavedViewPinOff") {
            moveTo(12f, 14f)
            lineTo(12f, 21f)
            moveTo(8f, 4f)
            lineTo(16f, 4f)
            moveTo(9f, 4f)
            lineTo(9.5f, 10f)
            lineTo(7f, 13f)
            lineTo(17f, 13f)
            lineTo(14.5f, 10f)
            lineTo(15f, 4f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    val Trash: ImageVector =
        stroked("SavedViewTrash") {
            moveTo(5f, 7f)
            lineTo(19f, 7f)
            moveTo(10f, 4f)
            lineTo(14f, 4f)
            moveTo(6.5f, 7f)
            lineTo(7.5f, 20f)
            lineTo(16.5f, 20f)
            lineTo(17.5f, 7f)
            moveTo(10f, 10.5f)
            lineTo(10f, 16.5f)
            moveTo(14f, 10.5f)
            lineTo(14f, 16.5f)
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

// ── Previews — one per rendered state. ──────────────────────────────────────────────────────────────────

private fun previewStrings(): SavedViewMenuStrings =
    SavedViewMenuStrings(
        title = "Saved views",
        manage = "Manage views",
        empty = "No saved views yet",
        saveCurrent = "Save current view…",
        defaultBadge = "Default",
        setDefault = "Set as default",
        unsetDefault = "Clear default",
        pin = "Pin",
        unpin = "Unpin",
        rename = "Rename view",
        delete = "Delete",
        cancel = "Cancel",
        save = "Save",
        saving = "Saving…",
        close = "Close",
        name = "Name",
        nameHint = "View name",
        makeDefault = "Apply automatically when I open this page",
        appliedBadge = "View",
        clearApplied = "Clear applied view",
        emptyQuery = "No filters",
        deleteTitle = "Delete saved view",
        deleteConfirmTemplate = "Delete saved view \"%1\$s\"?",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        loadingLabel = "Loading",
        announceAppliedTemplate = "View %1\$s applied",
        announceCleared = "Saved view cleared",
    )

private fun previewView(
    id: Long,
    name: String,
    query: String = "status=active",
    isDefault: Boolean = false,
    isPinned: Boolean = false,
): SavedView =
    SavedView(
        id = id,
        name = name,
        route = "/drives",
        query = query,
        isDefault = isDefault,
        isPinned = isPinned,
        createdAt = "2024-01-01T00:00:00Z",
        updatedAt = "2024-01-01T00:00:00Z",
    )

private val PREVIEW_VIEWS =
    listOf(
        previewView(1, "Long road trips", query = "min_distance=200", isPinned = true),
        previewView(2, "This week", query = "range=7d", isDefault = true),
        previewView(3, "Unfiltered", query = ""),
    )

private val PREVIEW_NO_ACTIONS =
    SavedViewRowActions(
        onApply = {},
        onToggleDefault = {},
        onTogglePin = {},
        onRename = {},
        onDelete = {},
    )

@Composable
private fun previewPanel(display: SavedViewMenuDisplay) {
    TeslaSyncTheme(dynamicColor = false) {
        SavedViewMenuPanel(
            display = display,
            strings = previewStrings(),
            actions = PREVIEW_NO_ACTIONS,
            onManage = {},
            onSaveCurrent = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Panel · content", showBackground = true)
@Composable
private fun SavedViewMenuContentPreview() {
    previewPanel(
        SavedViewMenuDisplay(
            phase = UiPhase.Content,
            views = SavedViewMenuProjection.sortViews(PREVIEW_VIEWS),
            activeView = PREVIEW_VIEWS[1],
            defaultView = PREVIEW_VIEWS[1],
        ),
    )
}

@Preview(name = "Panel · loading", showBackground = true)
@Composable
private fun SavedViewMenuLoadingPreview() {
    previewPanel(SavedViewMenuDisplay(phase = UiPhase.Loading))
}

@Preview(name = "Panel · empty", showBackground = true)
@Composable
private fun SavedViewMenuEmptyPreview() {
    previewPanel(SavedViewMenuDisplay(phase = UiPhase.Empty))
}

@Preview(name = "Panel · error", showBackground = true)
@Composable
private fun SavedViewMenuErrorPreview() {
    previewPanel(
        SavedViewMenuDisplay(
            phase = UiPhase.Error,
            errorKind = ErrorKind.Http,
            httpStatus = HTTP_SERVER_ERROR,
        ),
    )
}

@Preview(name = "Panel · stale", showBackground = true)
@Composable
private fun SavedViewMenuStalePreview() {
    previewPanel(
        SavedViewMenuDisplay(
            phase = UiPhase.Content,
            views = SavedViewMenuProjection.sortViews(PREVIEW_VIEWS),
            stale = true,
            refreshing = true,
        ),
    )
}

@Preview(name = "Trigger · applied + badge", showBackground = true)
@Composable
private fun SavedViewMenuTriggerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SavedViewMenuContent(
            display =
                SavedViewMenuDisplay(
                    phase = UiPhase.Content,
                    views = PREVIEW_VIEWS,
                    activeView = PREVIEW_VIEWS[1],
                ),
            strings = previewStrings(),
            expanded = false,
            actions = PREVIEW_NO_ACTIONS,
            onExpandedChange = {},
            onClear = {},
            onManage = {},
            onSaveCurrent = {},
            onRetry = {},
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
