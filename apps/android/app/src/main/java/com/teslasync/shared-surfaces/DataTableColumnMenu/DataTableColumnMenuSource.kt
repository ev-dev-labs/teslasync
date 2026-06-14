// The single persistence seam the DataTableColumnMenu shared surface binds to — the native analogue of the web
// component's storage-agnostic contract (web/src/components/ui/DataTableColumnMenu.tsx delegates the localStorage
// round-trip to its host via `layout` + `onChange` + `onReset`, backed by web/src/lib/columnOrderStore.ts). The
// surface performs NO data fetch, so unlike the data-bound surfaces there is no store or SSE feed here; the only
// abstracted dependency is the column-layout cache, which is what makes the view-model's toggle / reorder / reset
// wiring fully unit-testable off-device (a fake store stands in for the persistence round-trip). The view-model
// depends on this abstraction, never on a concrete Compose state, so the view performs no business logic (P1/S8
// boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/DataTableColumnMenu) cannot form a valid Kotlin package;
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the port interface + its production
// state holder + factory co-located in one file.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The persisted per-table column layout the [DataTableColumnMenuViewModel] reads + mutates — the native mirror of
 * the web `columnOrderStore` localStorage layer the host DataTable owns. [layout] is the observable current layout
 * (web `getColumnLayout(tableId)`, `null` until the user customizes anything — exactly the web "nothing stored"
 * sentinel that makes the menu fall back to source-defined defaults); [apply] persists a new layout (web
 * `setColumnLayout` driven by the menu's `onChange`); [reset] clears it back to defaults (web `resetColumnLayout`
 * driven by the menu's `onReset`). A real [InMemoryColumnLayoutStore] is used in production; a fake implements this
 * interface directly in tests so the toggle / reorder / reset logic runs without a UI.
 */
interface ColumnLayoutStore {
    /** The current cached layout — `null` until the user customizes the table (web "nothing stored" sentinel). */
    val layout: StateFlow<ColumnLayout?>

    /**
     * Persists [next] as the new current layout — web `setColumnLayout(tableId, next)`, invoked from the menu's
     * controlled `onChange`. The [next] layout is already a complete `{order, hidden}` picture (the model's
     * [toggleColumnLayout] / [moveColumnInLayout] seed it from the defaults), never a partial one.
     */
    fun apply(next: ColumnLayout)

    /**
     * Clears the stored layout so the table reverts to its source-defined order + `defaultVisible` visibility — web
     * `resetColumnLayout(tableId)`, invoked from the menu's "Reset" affordance. Returns [layout] to `null`.
     */
    fun reset()
}

/**
 * The production [ColumnLayoutStore]: a small, self-contained state holder backing the host's column-layout cache.
 * Seeded with the [initial] layout a host has already read from its own persistence (or `null` for a pristine
 * table), it republishes every [apply] / [reset] so the bound table re-renders from the same source of truth.
 * Instances are scoped to a single table placement (created in the composable and remembered), so no cross-instance
 * synchronization is required — mutations are invoked from the main dispatcher.
 */
class InMemoryColumnLayoutStore(
    initial: ColumnLayout? = null,
) : ColumnLayoutStore {
    private val layoutState = MutableStateFlow(initial)

    override val layout: StateFlow<ColumnLayout?> = layoutState.asStateFlow()

    override fun apply(next: ColumnLayout) {
        layoutState.value = next
    }

    override fun reset() {
        layoutState.value = null
    }
}

/**
 * Builds the production [ColumnLayoutStore] for a table placement, seeded with the host's already-read [initial]
 * layout (or `null` for a pristine table). A test fake implements [ColumnLayoutStore] directly.
 */
fun columnLayoutStore(initial: ColumnLayout? = null): ColumnLayoutStore = InMemoryColumnLayoutStore(initial)
