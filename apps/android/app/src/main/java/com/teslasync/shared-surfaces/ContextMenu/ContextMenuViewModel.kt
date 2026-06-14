// UI-thread-free state holder backing the ContextMenu surface — the native port of the web component's read of
// its module-level store (web/src/components/ui/ContextMenu.tsx, `useSyncExternalStore`). It binds the synchronous
// [ContextMenuStore] and performs no HTTP itself (ADR-002): the host composable collects [state] and folds it
// through the pure model. Open / close / select are the entire contract — the surface has no async dependency, so
// it surfaces no loading / error / stale / offline lifecycle (see ContextMenuModel.kt for the honesty rationale).
//
// `select` reproduces the web `invoke`: the menu closes first, then the item handler runs, and any handler
// failure is logged (slug only, never the item) instead of breaking the menu lifecycle — the native port of the
// web `try { item.onClick() } catch (...) { console.error(...) }`. `onViewOpened` emits the one PII-safe
// `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ContextMenu) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.contextmenu

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow

/**
 * State holder for the ContextMenu surface.
 *
 * Exposes the active menu [state] (the web `useSyncExternalStore` value) for the host to render, and the three
 * imperative intents the web component supports: [open] (web `openContextMenu`, guarded against an empty list by
 * the store), [dismiss] (web `closeContextMenu`, fired by outside-click / back / Escape / Tab), and [select] (web
 * `invoke`: close then run the row's handler). [onViewOpened] emits the one PII-safe `view.opened` diagnostic
 * (P1/S11) — slug only, never an item label, shortcut, or anchor coordinate.
 *
 * @param store the in-process menu store (the app-wide [ContextMenuController.store] in production, a fresh
 *   isolated store in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 */
class ContextMenuViewModel(
    private val store: ContextMenuStore,
    private val logger: Logger,
) : ViewModel() {
    private var viewOpenedRecorded = false

    /** The active menu snapshot, or `null` when closed — collected by the host (web `useSyncExternalStore`). */
    val state: StateFlow<ContextMenuState?> = store.state

    /** Opens the menu with [items] at [anchor] (web `openContextMenu`). */
    fun open(
        items: List<ContextMenuItem>,
        anchor: ContextMenuAnchor,
    ) = store.open(items, anchor)

    /** Opens the menu with [items] at viewport pixel ([x], [y]) (web `openContextMenu`). */
    fun open(
        items: List<ContextMenuItem>,
        x: Int,
        y: Int,
    ) = store.open(items, x, y)

    /** Closes the menu — outside-click / back / Escape / Tab all route here (web `closeContextMenu`). */
    fun dismiss() = store.close()

    /**
     * Invokes [item] — the native port of the web `invoke`. A disabled row is ignored; otherwise the menu closes
     * first (so navigations and recompositions the handler triggers see the menu already torn down) and then the
     * handler runs. A throwing handler is logged (slug only, PII-safe) rather than propagated, so one faulty
     * action never breaks the menu lifecycle.
     */
    fun select(item: ContextMenuItem) {
        if (!item.enabled) return
        store.close()
        runCatching { item.onClick() }.onFailure { ContextMenuDiagnostics.recordItemError(logger) }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no item label, shortcut, or anchor. Call from the host's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        ContextMenuDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** Wires the surface to the process-global [ContextMenuController] store (open-from-anywhere). */
        fun create(logger: Logger): ContextMenuViewModel = ContextMenuViewModel(ContextMenuController.store, logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel over a given [store]. */
        fun factory(
            store: ContextMenuStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ContextMenuViewModel(store, logger) }
            }
    }
}
