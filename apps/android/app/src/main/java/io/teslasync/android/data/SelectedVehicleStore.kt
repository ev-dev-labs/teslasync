package io.teslasync.android.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * App-scoped holder for the currently-selected vehicle id, shared across every screen scoped to "the
 * active vehicle" (detail, charging, driving, systems, ...). It is deliberately NOT a `ViewModel`:
 * the selection outlives any one screen and must survive navigation and configuration changes, so —
 * like the auth state — it is built once in the process DI graph and observed by page ViewModels.
 *
 * It owns no networking. [reconcile] is fed the live enrolled-vehicle id list (from the shared
 * `VehiclesStore`), so the selection self-heals: an explicit choice is kept while it remains
 * available, a vanished selection (or a cold start) auto-falls to the first vehicle, and an empty
 * fleet clears it. This reproduces the web "default to the first vehicle" behaviour without
 * duplicating any fetch or owning any business logic.
 */
class SelectedVehicleStore {
    private val mutableSelectedId = MutableStateFlow<Long?>(null)

    /** The currently-selected vehicle id, or `null` when no vehicle is available/selected. */
    val selectedId: StateFlow<Long?> = mutableSelectedId.asStateFlow()

    /** Explicitly selects [id] (a user tap on the vehicle switcher). */
    fun select(id: Long) {
        mutableSelectedId.value = id
    }

    /** Clears the selection (e.g. on sign-out). */
    fun clear() {
        mutableSelectedId.value = null
    }

    /**
     * Reconciles the selection against the currently-available [availableIds]: keeps the current
     * choice when it is still present, auto-selects the first vehicle when the current choice is
     * absent (or none was made), and clears the selection when the fleet is empty.
     */
    fun reconcile(availableIds: List<Long>) {
        val current = mutableSelectedId.value
        mutableSelectedId.value =
            when {
                availableIds.isEmpty() -> null
                current != null && current in availableIds -> current
                else -> availableIds.first()
            }
    }
}
