// Pure, framework-free model + projection for the ContextMenu shared surface — the native analogue of every
// decision the web component makes (web/src/components/ui/ContextMenu.tsx) before Compose paints anything. No
// Compose runtime, no Android UI, no HTTP: every declaration here is exercised by the :android:testReleaseUnitTest
// gate so the composable stays a thin render layer over it.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a portal-rendered
// context-menu primitive driven by a module-level pub/sub store read through `useSyncExternalStore`. A caller
// opens it imperatively (`openContextMenu(items, x, y)`) — typically from a right-click — and the host renders a
// floating `role="menu"` at the cursor with one `role="menuitem"` per row. Rows can be disabled (rendered but
// non-interactive), destructive (tinted red), and may carry a leading icon and a right-aligned shortcut hint.
// The menu corrects viewport overflow by flipping its anchor edge (right-edge flips to x, bottom-edge flips to y)
// after the first measured layout, supports full keyboard navigation (Arrow Up/Down skip disabled rows, Home/End
// jump to first/last, Enter/Space invoke, Escape/Tab close), and refuses to open with an empty item list.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// performs no query. Its only input is the in-process [ContextMenuStore] (the `useSyncExternalStore` analogue),
// a synchronous pub/sub that is always available and never "loads", "errors", goes "stale", or goes "offline".
// Inventing those states would model an async dependency the web spec does not have (honesty covenant: no scope
// narrowing, no silent drift). The surface's REAL, fully-reproduced states are: closed (no snapshot → the host
// renders nothing, the web `if (!snapshot) return null`), open (the menu with rows), the per-row variants
// (enabled / disabled / destructive / with-icon / with-shortcut), keyboard focus, and dismissal. The empty case
// is the web open-guard: opening with zero items is a no-op, so the menu never mounts empty and there is never a
// blank box. The keyboard-focus traversal and the viewport-flip geometry are reduced here as pure functions
// ([ContextMenuFocus], [ContextMenuPlacement]) and asserted off-device, doubling as the per-state projection.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ContextMenu — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling UserCell / StaggerContainer surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.contextmenu

import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.max

/** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); the slug the prompt mandates. */
const val CONTEXT_MENU_SLUG: String = "ContextMenu"

/**
 * Canonical registry metadata for the ContextMenu surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`ContextMenu`).
 */
object ContextMenuRegistration {
    /** Stable surface id. */
    const val ID: String = "context-menu"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = CONTEXT_MENU_SLUG
}

/**
 * One row in a context menu — the native port of the web `ContextMenuItem`
 * (`{ id, label, icon?, onClick, disabled?, destructive?, shortcut? }`). The web boolean `disabled` is modelled
 * as the inverse [enabled] (Kotlin-idiomatic, and consistent with the atomic `components/ui/ContextMenuItem`):
 * `enabled = !disabled`. A disabled row is still rendered — visibly muted and non-interactive — exactly like the
 * web `disabled` button, so the menu never silently drops rows.
 *
 * @property id stable identifier used as the list key and test tag suffix (web `item.id`).
 * @property label the text rendered inline in the row (web `item.label`).
 * @property onClick the action invoked on click / Enter / Space; the menu auto-closes first (web `item.onClick`).
 * @property enabled when false the row is shown but non-interactive (web `!item.disabled`).
 * @property destructive when true the row is tinted with the error color (web `item.destructive`, e.g. Delete).
 * @property leadingIcon optional leading glyph (web `item.icon`).
 * @property shortcut optional right-aligned shortcut hint, e.g. "⌘⇧D" (web `item.shortcut`).
 */
data class ContextMenuItem(
    val id: String,
    val label: String,
    val onClick: () -> Unit,
    val enabled: Boolean = true,
    val destructive: Boolean = false,
    val leadingIcon: ImageVector? = null,
    val shortcut: String? = null,
)

/**
 * The viewport-relative position the menu opens at, in pixels — the native port of the web `(x, y)` the
 * `onContextMenu` handler captures from `clientX` / `clientY`. Carried in window coordinates so the host's
 * popup position provider can place the menu absolutely and flip it on overflow.
 */
data class ContextMenuAnchor(
    val x: Int,
    val y: Int,
)

/**
 * The resolved top-left the menu is finally placed at, in pixels, after the viewport-overflow flip — the native
 * port of the web `left` / `top` the `useLayoutEffect` writes onto the menu element.
 */
data class ContextMenuOffset(
    val x: Int,
    val y: Int,
)

/**
 * A pixel size — the measured menu, or the window — used by the placement flip. A small value type so
 * [ContextMenuPlacement.resolvePosition] stays a pure, few-argument function.
 */
data class ContextMenuSize(
    val width: Int,
    val height: Int,
)

/**
 * The active-menu snapshot the host renders — the native port of the web module-store `MenuState`
 * (`{ items, x, y, nonce }`). `null` means closed (the web `state === null`). [nonce] is a monotonic open-counter
 * so re-opening at an identical (items, anchor) still produces a distinct value and re-renders, exactly like the
 * web nonce (e.g. the user right-clicks twice in the same spot). The web `restoreFocusEl` is a DOM concern that
 * Compose's `Popup` focus restoration handles, so it is intentionally not modelled here.
 */
data class ContextMenuState(
    val items: List<ContextMenuItem>,
    val anchor: ContextMenuAnchor,
    val nonce: Long,
) {
    /** True when there are no rows — the open-guard ensures a live store snapshot is never empty. */
    val isEmpty: Boolean
        get() = items.isEmpty()

    /** True when at least one row is interactive (keyboard focus has somewhere to land). */
    val hasEnabledItem: Boolean
        get() = items.any { it.enabled }
}

/**
 * Pure keyboard-roving-focus math — the native port of the web `ContextMenuView` focus helpers
 * (`enabledIndices`, `focusFirstEnabled`, `focusLastEnabled`, `focusNextEnabled`). Disabled rows are skipped and
 * traversal wraps, exactly as the web Arrow Up / Arrow Down / Home / End handlers do. Pure so the contract is
 * asserted off-device and the composable only has to request focus on the index these functions return.
 */
object ContextMenuFocus {
    /** The indices of the interactive (enabled) rows, in display order (web `enabledIndices`). */
    fun enabledIndices(items: List<ContextMenuItem>): List<Int> = items.mapIndexedNotNull { index, item -> index.takeIf { item.enabled } }

    /** The first interactive row, or `null` when every row is disabled (web `focusFirstEnabled`). */
    fun firstEnabledIndex(items: List<ContextMenuItem>): Int? = enabledIndices(items).firstOrNull()

    /** The last interactive row, or `null` when every row is disabled (web `focusLastEnabled`). */
    fun lastEnabledIndex(items: List<ContextMenuItem>): Int? = enabledIndices(items).lastOrNull()

    /**
     * The next interactive row from [current] in the [forward] direction, wrapping at the ends and skipping
     * disabled rows — the native port of the web `focusNextEnabled`. When [current] is not itself an enabled row
     * (e.g. focus is on the menu container), traversal starts at the first enabled row going forward, or the last
     * going backward (the web first-Arrow behaviour). Returns `null` only when there is no enabled row.
     */
    fun nextEnabledIndex(
        items: List<ContextMenuItem>,
        current: Int,
        forward: Boolean,
    ): Int? {
        val enabled = enabledIndices(items)
        if (enabled.isEmpty()) return null
        val cursor = enabled.indexOf(current)
        val resolved =
            if (cursor < 0) {
                if (forward) enabled.first() else enabled.last()
            } else {
                val step = if (forward) 1 else -1
                enabled[(cursor + step + enabled.size) % enabled.size]
            }
        return resolved
    }
}

/**
 * Pure viewport-overflow placement — the native port of the web `ContextMenuView` `useLayoutEffect` flip. Given
 * the captured anchor, the measured menu size, the window size, and the safe [marginPx], it returns the final
 * top-left: when the menu would overflow the right edge it flips to open leftward of the anchor; when it would
 * overflow the bottom edge it flips to open above the anchor; each flipped edge is clamped to at least [marginPx]
 * from the window origin. Pure so the geometry is asserted off-device without a layout pass.
 */
object ContextMenuPlacement {
    /** The safe inset from each window edge (web `VIEWPORT_MARGIN = 8`), expressed in dp at the call site. */
    const val VIEWPORT_MARGIN_DP: Int = 8

    /** Resolves the flipped, clamped top-left for a menu of [menuSize] at the captured [anchor]. */
    fun resolvePosition(
        anchor: ContextMenuAnchor,
        menuSize: ContextMenuSize,
        windowSize: ContextMenuSize,
        marginPx: Int,
    ): ContextMenuOffset {
        val left =
            if (anchor.x + menuSize.width + marginPx > windowSize.width) {
                max(marginPx, anchor.x - menuSize.width)
            } else {
                anchor.x
            }
        val top =
            if (anchor.y + menuSize.height + marginPx > windowSize.height) {
                max(marginPx, anchor.y - menuSize.height)
            } else {
                anchor.y
            }
        return ContextMenuOffset(x = left, y = top)
    }
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no item labels, no shortcuts, no anchor coordinates — so observability can never leak what was shown
 * or where. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object ContextMenuDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = CONTEXT_MENU_SLUG

    /** The one-shot event emitted once when the surface (host) opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /** The structured event emitted when an item handler throws, so a faulty action never breaks the menu. */
    const val EVENT_ITEM_ERROR: String = "contextMenu.itemError"

    /** Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }

    /** Emits the PII-safe item-handler-failure diagnostic — slug only, never the item or its thrown message. */
    fun recordItemError(logger: Logger) {
        logger.warn(EVENT_ITEM_ERROR, mapOf(FIELD_SURFACE to SLUG))
    }
}
