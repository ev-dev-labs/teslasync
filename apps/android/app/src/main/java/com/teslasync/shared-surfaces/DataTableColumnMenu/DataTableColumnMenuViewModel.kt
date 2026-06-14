// The UI-thread-free state holder backing the DataTableColumnMenu shared surface — the native port of the web
// component's local `open` state (the `useState(false)` + the click-outside / Escape effect that closes it) and the
// controlled `onChange` / `onReset` round-trip (web/src/components/ui/DataTableColumnMenu.tsx). It owns the popover
// open flag, re-shares the bound [ColumnLayoutStore]'s layout, folds the model's visibility / reorder guards into
// the store, and exposes the one PII-safe `view.opened` diagnostic. The view performs NO business logic — it only
// collects [open] / [layout] and calls [setOpen] / [toggleOpen] / [onToggleColumn] / [onMoveColumn] / [applyLayout]
// / [resetLayout] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces
// /DataTableColumnMenu) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * @param store the persisted column-layout seam (web `columnOrderStore` round-trip); an [InMemoryColumnLayoutStore]
 *   in production, a fake in tests. The view-model owns no Compose state — it delegates persistence to this port.
 * @param logger the single sanctioned redacting logger (ADR-016); receives only the PII-safe `view.opened` event
 *   carrying the non-PII surface slug (never a column key, header, or any user content).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class DataTableColumnMenuViewModel(
    private val store: ColumnLayoutStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val openState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /** Whether the column popover is open — the web `open` state. */
    val open: StateFlow<Boolean> = openState.asStateFlow()

    /** The current persisted column layout — `null` until customized (web `layout` prop), from the bound store. */
    val layout: StateFlow<ColumnLayout?> = store.layout

    /** Opens or closes the popover — web `setOpen(open)`. */
    fun setOpen(value: Boolean) {
        openState.value = value
    }

    /** Toggles the popover — web `setOpen(v => !v)` on the trigger. */
    fun toggleOpen() {
        openState.value = !openState.value
    }

    /**
     * Applies the visibility toggle for [key] over [columns] — web `handleToggle`. The model refuses to hide the
     * last remaining visible column (returns `null`), so a guarded toggle is a no-op rather than emptying the table.
     */
    fun onToggleColumn(
        columns: List<ColumnDescriptor>,
        key: String,
    ) {
        val next = toggleColumnLayout(columns, store.layout.value, key) ?: return
        store.apply(next)
    }

    /**
     * Reorders [key] one slot in [direction] over [columns] — web `handleMove`. The model refuses a move past
     * either end of the list (returns `null`), so a guarded move is a no-op.
     */
    fun onMoveColumn(
        columns: List<ColumnDescriptor>,
        key: String,
        direction: MoveDirection,
    ) {
        val next = moveColumnInLayout(columns, store.layout.value, key, direction) ?: return
        store.apply(next)
    }

    /** Persists a controlled layout directly — the web `onChange` escape hatch for a host-driven update. */
    fun applyLayout(next: ColumnLayout) {
        store.apply(next)
    }

    /** Clears the stored layout so the table reverts to its defaults — web `onReset`. */
    fun resetLayout() {
        store.reset()
    }

    /** Emits the one PII-safe `view.opened` diagnostic (P1/S11), at most once per holder. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDataTableColumnMenuOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            store: ColumnLayoutStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DataTableColumnMenuViewModel(store, logger) }
            }
    }
}
