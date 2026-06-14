// The data + mutation seam the PinButton shared surface binds to, plus its production binding over the
// shared P1/S8 PinnedStore. Named after the surface bundle (PinButton*) rather than the single interface
// it declares. The view (composable) performs NO HTTP — it only collects state from the ViewModel, which
// drives this seam, satisfying the "no direct HTTP from the view" contract (ADR-002).
//
// The web source composes two hooks from web/src/api/hooks/usePinned.ts — `usePinned(itemType, context)`
// (the cache-then-network pin feed the `isPinned` flag is derived from) and `useTogglePin(itemType)` (the
// POST-to-pin / resolve-then-DELETE-to-unpin mutation that invalidates `pinnedKeys.all`). This seam
// mirrors that pair 1:1: [pinned] is the read feed, [togglePin] is the mutation, and [refresh] restarts
// the read after a hard error (the holder-side analogue of re-running the query). The production
// `PinnedStore` already exists app-wide (P1/S8) and is wired into the `DataContainer`, so this pin button,
// the layout `VehiclePicker`, dashboard widgets, and every other pin-aware surface fold into one upstream
// per `(type, context)` bucket and observe one another's toggles.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PinButton) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `PinButton*` filename cannot match the
// `PinButtonSource` seam plus its co-located production adapter.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pinbutton

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import io.teslasync.shared.core.presentation.pinned.PinnedStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [PinButtonViewModel] depends on so it binds to an abstraction (the real
 * [PinnedStore] ↔ a test fake), never to a concrete client — the Android analogue of the web
 * `usePinned(itemType, context)` + `useTogglePin(itemType)` composition (P1/S8 state-holder boundary).
 *
 * [pinned] streams the cache-then-network pin list for the `(type, context)` bucket (web `usePinned`);
 * [togglePin] pins or unpins a single item and, on success, refreshes every observed feed (web
 * `useTogglePin`, which invalidates `pinnedKeys.all`); [refresh] restarts the read after a hard error
 * (the affordance the always-present button offers in place of the web's silent `[]` fallback). No HTTP
 * touches the view.
 */
interface PinButtonSource {
    /** Stream the cache-then-network pin list for the `(type, context)` bucket (web `usePinned`). */
    fun pinned(
        type: PinnedItemType,
        context: String?,
    ): Flow<Resource<List<PinnedItem>>>

    /**
     * Pin ([pin] = true) or unpin ([pin] = false) [itemId] within its `(type, context)` bucket, then
     * refresh every observed feed on success (web `useTogglePin`). A no-op unpin (no matching row) still
     * succeeds; any network failure is propagated as a failed [Result] and refreshes nothing.
     */
    suspend fun togglePin(
        type: PinnedItemType,
        itemId: String,
        pin: Boolean,
        context: String?,
    ): Result<PinnedItem?>

    /** Re-fetch every observed pin feed — the recovery path the Retry affordance drives after an error. */
    fun refresh()
}

/**
 * Binds the surface to the shared P1/S8 [PinnedStore]: [PinnedStore.pinned] is the read feed (the
 * `usePinned` port), [PinnedStore.togglePin] is the mutation (the `useTogglePin` port), and
 * [PinnedStore.refreshAll] is the recovery re-fetch. Every read uses the store's shared per-bucket feed,
 * so every observer folds into one upstream collection — the same pin set every pin-aware surface follows.
 */
fun pinButtonSource(pinnedStore: PinnedStore): PinButtonSource =
    object : PinButtonSource {
        override fun pinned(
            type: PinnedItemType,
            context: String?,
        ): Flow<Resource<List<PinnedItem>>> = pinnedStore.pinned(type, context)

        override suspend fun togglePin(
            type: PinnedItemType,
            itemId: String,
            pin: Boolean,
            context: String?,
        ): Result<PinnedItem?> = pinnedStore.togglePin(type, itemId, pin, context)

        override fun refresh() {
            pinnedStore.refreshAll()
        }
    }
