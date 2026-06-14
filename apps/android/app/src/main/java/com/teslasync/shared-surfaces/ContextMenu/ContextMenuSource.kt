// The state-holder seam the ContextMenu surface binds to — the native analogue of the web module-level pub/sub
// store the component reads through `useSyncExternalStore` (web/src/components/ui/ContextMenu.tsx). The view
// (composable) performs NO HTTP and owns no menu state of its own (ADR-002): it only collects [ContextMenuStore.state]
// through the [ContextMenuViewModel] and folds it through the pure model. The store is a synchronous, in-process
// pub/sub — the genuine (and only) dependency a self-contained overlay primitive has — so there is no async
// lifecycle to surface; opening and closing are the entire contract.
//
// [ContextMenuController] is the process-global instance that reproduces the web design's defining property: any
// caller anywhere in the app can open the menu without prop-drilling a handler (web `openContextMenu` is a
// module-level function over a module-level store). [ContextMenuStore] is the testable unit behind it — page
// hosts and unit tests construct their own isolated store, while `rememberContextMenu()` opens the shared global
// one the mounted host observes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ContextMenu) cannot form a valid Kotlin package. `MatchingDeclarationName` and
// the ktlint filename rule are suppressed: the mandated `ContextMenu*` filename cannot match the
// `ContextMenuSource` seam plus the co-located global controller.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.contextmenu

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The in-process pub/sub backing one ContextMenu host — the native port of the web module-level menu store. Holds
 * the active [ContextMenuState] (or `null` when closed) as a [StateFlow] the host collects, and exposes the two
 * imperative operations the web store does: [open] (guarded against an empty item list, monotonic [nonce] so a
 * re-open at the same spot still re-renders) and [close]. UI-thread-free and synchronous; no I/O ever touches it.
 */
class ContextMenuStore {
    private var nonceCounter = 0L
    private val mutableState = MutableStateFlow<ContextMenuState?>(null)

    /** The active menu snapshot, or `null` when closed (web `useSyncExternalStore` value). */
    val state: StateFlow<ContextMenuState?> = mutableState.asStateFlow()

    /** True while a menu is open. */
    val isOpen: Boolean
        get() = mutableState.value != null

    /**
     * Opens the menu with [items] at [anchor] — the native port of `openContextMenu`. Reproduces the web
     * open-guard exactly: an empty [items] list is a no-op, so a live snapshot is never empty and the menu never
     * mounts as a blank box. Each open bumps the monotonic nonce so an identical re-open still emits a distinct
     * value (the web "right-click twice in the same spot still re-renders").
     */
    fun open(
        items: List<ContextMenuItem>,
        anchor: ContextMenuAnchor,
    ) {
        if (items.isEmpty()) return
        nonceCounter += 1
        mutableState.value = ContextMenuState(items = items, anchor = anchor, nonce = nonceCounter)
    }

    /** Opens the menu with [items] at viewport pixel ([x], [y]); convenience over [open]. */
    fun open(
        items: List<ContextMenuItem>,
        x: Int,
        y: Int,
    ) = open(items, ContextMenuAnchor(x = x, y = y))

    /** Closes the menu (no-op when already closed) — the native port of `closeContextMenu`. */
    fun close() {
        mutableState.value = null
    }
}

/**
 * The process-global ContextMenu store — the native port of the web module-level store that lets any caller open
 * the menu without prop-drilling (`openContextMenu(items, x, y)` from anywhere). The mounted [ContextMenuHost]
 * observes this same [store] (via its ViewModel), so a `rememberContextMenu().open(...)` from any screen surfaces
 * the menu in the single host. Page hosts and unit tests that want isolation construct their own [ContextMenuStore].
 */
object ContextMenuController {
    /** The shared store the app-wide host renders from. */
    val store: ContextMenuStore = ContextMenuStore()

    /** The active menu snapshot of the shared [store]. */
    val state: StateFlow<ContextMenuState?>
        get() = store.state

    /** Opens the shared menu with [items] at viewport pixel ([x], [y]). */
    fun open(
        items: List<ContextMenuItem>,
        x: Int,
        y: Int,
    ) = store.open(items, x, y)

    /** Opens the shared menu with [items] at [anchor]. */
    fun open(
        items: List<ContextMenuItem>,
        anchor: ContextMenuAnchor,
    ) = store.open(items, anchor)

    /** Closes the shared menu. */
    fun close() = store.close()
}
