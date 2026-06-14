// The native Jetpack Compose + Material 3 ContextMenu shared surface — a parity port of the web context-menu
// primitive web/src/components/ui/ContextMenu.tsx. The web surface is a portal-rendered floating menu driven by a
// module-level pub/sub store: a caller opens it at a cursor position with a list of rows (enabled / disabled /
// destructive, each optionally carrying a leading icon and a right-aligned shortcut), it corrects viewport
// overflow by flipping its anchor edge, supports full keyboard navigation, and dismisses on Escape / Tab /
// outside-click. It fetches nothing and has exactly one string of its own — the menu's accessible label.
//
// This native surface keeps that contract end to end. It binds the one input the web hook exposes — the in-process
// menu store (P1/S8, the `useSyncExternalStore` analogue) — through [ContextMenuViewModel] folded over the pure
// model (ContextMenuModel.kt), and performs NO HTTP from the view (ADR-002). [ContextMenuHost] is the native
// `ContextMenuRoot`: it renders the active snapshot in a `Popup` whose position provider reproduces the web
// viewport-flip geometry, dismisses on back / Escape / Tab / outside-tap, and routes the same keyboard navigation
// (Arrow Up/Down skip disabled rows, Home/End jump to the ends, Enter/Space invoke). `rememberContextMenu()` +
// `Modifier.contextMenuAnchor(...)` are the native `useContextMenu`: a long-press (Android's right-click idiom)
// opens the menu at the touch point. The menu label resolves through the P1/S10 i18n catalog and the chrome uses
// the P1/S9 design tokens; the one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// States reproduced (the web source's real states; the honesty rationale for why the generic async states do not
// apply lives in ContextMenuModel.kt): closed (no snapshot → the host renders nothing), open, the per-row variants
// (enabled / disabled / destructive / with-icon / with-shortcut), keyboard focus, and dismissal. The web open-guard
// (no menu opens for an empty list) is reproduced in the store; the stateless [ContextMenuSurface] additionally
// renders a friendly empty row if it is ever handed an empty list directly, so a caller never sees a blank box.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ContextMenu) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located handle, position provider, stateless content, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.contextmenu

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlin.math.roundToInt

/** Test tag on the menu root so on-device UI tests can locate the rendered menu when it is open. */
const val CONTEXT_MENU_TEST_TAG: String = "context-menu"

/** Prefix for each row's test tag (`context-menu-item-<id>`), mirroring the web `data-testid`. */
const val CONTEXT_MENU_ITEM_TEST_TAG_PREFIX: String = "context-menu-item-"

private const val ENABLED_ALPHA = 1f
private const val DISABLED_ALPHA = 0.6f
private val MENU_MIN_WIDTH = 192.dp
private val MENU_MAX_WIDTH = 320.dp
private val MENU_ROW_GAP = 2.dp
private val CONTEXT_MENU_ACTIVATION_KEYS = setOf(Key.Enter, Key.NumPadEnter, Key.Spacebar)

/**
 * Imperative handle returned by [rememberContextMenu] — the native port of the web `useContextMenu` return
 * (`{ openMenu, close }`). It drives the process-global [ContextMenuController], so opening from any screen
 * surfaces the menu in the single mounted [ContextMenuHost] without prop-drilling, exactly like the web module
 * store. Pair it with [Modifier.contextMenuAnchor] to wire a long-press trigger.
 */
@Stable
class ContextMenuHandle internal constructor() {
    /** Opens the menu with [items] at viewport pixel ([x], [y]) (web `openMenu`). */
    fun open(
        items: List<ContextMenuItem>,
        x: Int,
        y: Int,
    ) = ContextMenuController.open(items, x, y)

    /** Opens the menu with [items] at [anchor] (web `openMenu`). */
    fun open(
        items: List<ContextMenuItem>,
        anchor: ContextMenuAnchor,
    ) = ContextMenuController.open(items, anchor)

    /** Closes the menu (web `close`). */
    fun close() = ContextMenuController.close()
}

/**
 * Returns a stable [ContextMenuHandle] for opening / closing the shared context menu — the native port of the web
 * `useContextMenu()`. Combine with [contextMenuAnchor] for the long-press trigger, or call [ContextMenuHandle.open]
 * directly when the rows depend on the long-pressed target.
 */
@Composable
fun rememberContextMenu(): ContextMenuHandle = remember { ContextMenuHandle() }

/**
 * Wires a long-press on this element to open the context menu of [items] at the touch point — the native port of
 * the web `contextMenuProps` (right-click) trigger, using Android's long-press idiom. A normal tap invokes the
 * optional [onClick]. The element's window position is tracked so the menu opens at the absolute touch location,
 * matching the web `clientX` / `clientY` capture.
 */
@Composable
fun Modifier.contextMenuAnchor(
    handle: ContextMenuHandle,
    items: List<ContextMenuItem>,
    onClick: () -> Unit = {},
): Modifier {
    var origin by remember { mutableStateOf(Offset.Zero) }
    return this
        .onGloballyPositioned { coordinates -> origin = coordinates.positionInWindow() }
        .pointerInput(items, handle) {
            detectTapGestures(
                onTap = { onClick() },
                onLongPress = { local ->
                    handle.open(
                        items = items,
                        x = (origin.x + local.x).roundToInt(),
                        y = (origin.y + local.y).roundToInt(),
                    )
                },
            )
        }
}

/**
 * The single context-menu host — the native port of the web `ContextMenuRoot`. Mount it once near the top of the
 * app tree (alongside the route announcer). It observes the shared store, renders the active menu in a [Popup] at
 * the flipped anchor position, and dismisses on back / Escape / Tab / outside-tap. Renders nothing while closed
 * (web `if (!snapshot) return null`). Emits the one-shot `view.opened` diagnostic on first composition.
 *
 * @param viewModel the state holder bound to the process-global [ContextMenuController] store.
 */
@Composable
fun ContextMenuHost(
    modifier: Modifier = Modifier,
    viewModel: ContextMenuViewModel = rememberContextMenuViewModel(),
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val menu by viewModel.state.collectAsStateWithLifecycle()
    val marginPx = with(LocalDensity.current) { ContextMenuPlacement.VIEWPORT_MARGIN_DP.dp.roundToPx() }
    menu?.let { current ->
        val positionProvider =
            remember(current.anchor, marginPx) {
                ContextMenuPositionProvider(current.anchor, marginPx)
            }
        Popup(
            popupPositionProvider = positionProvider,
            onDismissRequest = viewModel::dismiss,
            properties = PopupProperties(focusable = true, dismissOnBackPress = true, dismissOnClickOutside = true),
        ) {
            ContextMenuSurface(
                state = current,
                menuLabel = stringResource(R.string.translation_contextMenu_menuLabel),
                emptyLabel = stringResource(R.string.translation_None),
                onSelect = viewModel::select,
                onDismiss = viewModel::dismiss,
                modifier = modifier,
            )
        }
    }
}

/** Builds the host's ViewModel over the process-global store using the app's sanctioned redacting logger. */
@Composable
private fun rememberContextMenuViewModel(): ContextMenuViewModel {
    val logger = LocalDataContainer.current.logger
    return viewModel(
        factory = ContextMenuViewModel.factory(ContextMenuController.store, logger),
    )
}

/**
 * The [PopupPositionProvider] that places the menu at the captured anchor and flips it on viewport overflow — the
 * native port of the web `ContextMenuView` `useLayoutEffect`. The geometry is delegated to the pure
 * [ContextMenuPlacement.resolvePosition] so it is unit-tested off-device; the popup's measured content size feeds
 * the flip on the first layout pass, exactly like the web measure-and-flip.
 */
class ContextMenuPositionProvider(
    private val anchor: ContextMenuAnchor,
    private val marginPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val offset =
            ContextMenuPlacement.resolvePosition(
                anchor = anchor,
                menuSize = ContextMenuSize(width = popupContentSize.width, height = popupContentSize.height),
                windowSize = ContextMenuSize(width = windowSize.width, height = windowSize.height),
                marginPx = marginPx,
            )
        return IntOffset(offset.x, offset.y)
    }
}

/**
 * The stateless menu card — every row the web source draws, hoisted out of the host so it is preview- and
 * screenshot-testable in each state. Reproduces the web container chrome (rounded, bordered, elevated surface),
 * the keyboard navigation, and the per-row enabled / disabled / destructive / icon / shortcut variants. If handed
 * an empty list (the open-guard normally prevents this) it shows a friendly empty row, never a blank box.
 *
 * @param state the active menu snapshot.
 * @param menuLabel the accessible menu label (web `t('contextMenu.menuLabel')`).
 * @param emptyLabel the friendly label for the defensive empty row.
 * @param onSelect invoked with the chosen row (the host closes then runs the handler).
 * @param onDismiss invoked when Escape / Tab requests the menu close.
 */
@Composable
fun ContextMenuSurface(
    state: ContextMenuState,
    menuLabel: String,
    emptyLabel: String,
    onSelect: (ContextMenuItem) -> Unit,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit = {},
) {
    val items = state.items
    val focusRequesters = remember(state.nonce) { List(items.size) { FocusRequester() } }
    var focusedIndex by remember(state.nonce) { mutableIntStateOf(-1) }

    LaunchedEffect(state.nonce) {
        ContextMenuFocus.firstEnabledIndex(items)?.let { index ->
            runCatching { focusRequesters[index].requestFocus() }
        }
    }

    Surface(
        modifier =
            modifier
                .testTag(CONTEXT_MENU_TEST_TAG)
                .semantics {
                    paneTitle = menuLabel
                    contentDescription = menuLabel
                }.onPreviewKeyEvent { event -> handleMenuKey(event, items, focusedIndex, focusRequesters, onDismiss) },
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = Elevation.overlay,
        shadowElevation = Elevation.modal,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier =
                Modifier
                    .widthIn(min = MENU_MIN_WIDTH, max = MENU_MAX_WIDTH)
                    .padding(Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(MENU_ROW_GAP),
        ) {
            if (items.isEmpty()) {
                ContextMenuEmptyRow(label = emptyLabel)
            } else {
                items.forEachIndexed { index, item ->
                    ContextMenuItemRow(
                        item = item,
                        focusRequester = focusRequesters[index],
                        onFocused = { focusedIndex = index },
                        onSelect = onSelect,
                    )
                }
            }
        }
    }
}

@Composable
private fun ContextMenuItemRow(
    item: ContextMenuItem,
    focusRequester: FocusRequester,
    onFocused: () -> Unit,
    onSelect: (ContextMenuItem) -> Unit,
) {
    val rowColor =
        when {
            !item.enabled -> MaterialTheme.colorScheme.onSurfaceVariant
            item.destructive -> MaterialTheme.colorScheme.error
            else -> MaterialTheme.colorScheme.onSurface
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .focusRequester(focusRequester)
                .onFocusChanged { if (it.isFocused) onFocused() }
                .then(
                    if (item.enabled) {
                        Modifier.clickable(onClickLabel = item.label, role = Role.Button) { onSelect(item) }
                    } else {
                        Modifier
                    },
                ).onKeyEvent { event -> handleItemKey(event, item, onSelect) }
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .alpha(if (item.enabled) ENABLED_ALPHA else DISABLED_ALPHA)
                .testTag(CONTEXT_MENU_ITEM_TEST_TAG_PREFIX + item.id)
                .semantics {
                    contentDescription = item.label
                    if (!item.enabled) disabled()
                },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        item.leadingIcon?.let { glyph ->
            Icon(imageVector = glyph, contentDescription = null, size = IconSize.Sm, tint = rowColor)
        }
        BodyText(text = item.label, color = rowColor, maxLines = 1, modifier = Modifier.weight(1f))
        item.shortcut?.let { shortcut ->
            Caption(text = shortcut)
        }
    }
}

@Composable
private fun ContextMenuEmptyRow(label: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BodyText(text = label, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
    }
}

// ── Pure key-event routing (off the composable so it stays a thin render layer) ─────────────────────────────

private fun handleMenuKey(
    event: KeyEvent,
    items: List<ContextMenuItem>,
    focusedIndex: Int,
    focusRequesters: List<FocusRequester>,
    onDismiss: () -> Unit,
): Boolean {
    if (event.type != KeyEventType.KeyDown) return false
    return when (event.key) {
        Key.DirectionDown -> requestFocusAt(ContextMenuFocus.nextEnabledIndex(items, focusedIndex, true), focusRequesters)
        Key.DirectionUp -> requestFocusAt(ContextMenuFocus.nextEnabledIndex(items, focusedIndex, false), focusRequesters)
        Key.MoveHome -> requestFocusAt(ContextMenuFocus.firstEnabledIndex(items), focusRequesters)
        Key.MoveEnd -> requestFocusAt(ContextMenuFocus.lastEnabledIndex(items), focusRequesters)
        Key.Escape, Key.Tab -> dismissAnd(onDismiss)
        else -> false
    }
}

private fun requestFocusAt(
    index: Int?,
    focusRequesters: List<FocusRequester>,
): Boolean {
    if (index == null || index !in focusRequesters.indices) return false
    runCatching { focusRequesters[index].requestFocus() }
    return true
}

private fun dismissAnd(onDismiss: () -> Unit): Boolean {
    onDismiss()
    return true
}

private fun handleItemKey(
    event: KeyEvent,
    item: ContextMenuItem,
    onSelect: (ContextMenuItem) -> Unit,
): Boolean {
    val activate = event.type == KeyEventType.KeyDown && item.enabled && event.key in CONTEXT_MENU_ACTIVATION_KEYS
    if (activate) onSelect(item)
    return activate
}

// ── Previews — one per rendered state (standard / icons + shortcuts / disabled + destructive / empty). ───────

private fun previewState(items: List<ContextMenuItem>): ContextMenuState =
    ContextMenuState(items = items, anchor = ContextMenuAnchor(x = 0, y = 0), nonce = 1L)

private fun previewRichItems(): List<ContextMenuItem> =
    listOf(
        ContextMenuItem(id = "open", label = "Open in new tab", onClick = {}, leadingIcon = TeslaGlyphs.Eye, shortcut = "⏎"),
        ContextMenuItem(id = "copy", label = "Copy link", onClick = {}, leadingIcon = TeslaGlyphs.Copy, shortcut = "⌘C"),
        ContextMenuItem(id = "edit", label = "Rename", onClick = {}, leadingIcon = TeslaGlyphs.Edit, shortcut = "F2"),
    )

private fun previewVariantItems(): List<ContextMenuItem> =
    listOf(
        ContextMenuItem(id = "pin", label = "Pin to top", onClick = {}, leadingIcon = TeslaGlyphs.Pin),
        ContextMenuItem(id = "export", label = "Export (unavailable)", onClick = {}, enabled = false),
        ContextMenuItem(id = "delete", label = "Delete", onClick = {}, destructive = true, leadingIcon = TeslaGlyphs.Close),
    )

@Preview(name = "ContextMenu · standard", showBackground = true)
@Composable
private fun ContextMenuStandardPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.lg)) {
            ContextMenuSurface(
                state = previewState(previewRichItems()),
                menuLabel = "Context menu",
                emptyLabel = "None",
                onSelect = {},
            )
        }
    }
}

@Preview(name = "ContextMenu · disabled + destructive", showBackground = true)
@Composable
private fun ContextMenuVariantsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.lg)) {
            ContextMenuSurface(
                state = previewState(previewVariantItems()),
                menuLabel = "Context menu",
                emptyLabel = "None",
                onSelect = {},
            )
        }
    }
}

@Preview(name = "ContextMenu · empty (defensive)", showBackground = true)
@Composable
private fun ContextMenuEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.lg)) {
            ContextMenuSurface(
                state = previewState(emptyList()),
                menuLabel = "Context menu",
                emptyLabel = "None",
                onSelect = {},
            )
        }
    }
}
