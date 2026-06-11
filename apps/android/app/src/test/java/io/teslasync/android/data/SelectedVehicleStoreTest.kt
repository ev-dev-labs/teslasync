package io.teslasync.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Tests the app-scoped active-vehicle selection, including the self-healing [SelectedVehicleStore.reconcile]. */
class SelectedVehicleStoreTest {
    @Test
    fun startsWithNoSelection() {
        assertNull(SelectedVehicleStore().selectedId.value)
    }

    @Test
    fun selectAndClear() {
        val store = SelectedVehicleStore()

        store.select(7L)
        assertEquals(7L, store.selectedId.value)
        store.clear()
        assertNull(store.selectedId.value)
    }

    @Test
    fun reconcileAutoSelectsFirstWhenNoneChosen() {
        val store = SelectedVehicleStore()

        store.reconcile(listOf(3L, 5L))

        assertEquals(3L, store.selectedId.value)
    }

    @Test
    fun reconcileKeepsAStillAvailableSelection() {
        val store = SelectedVehicleStore()
        store.select(5L)

        store.reconcile(listOf(3L, 5L))

        assertEquals(5L, store.selectedId.value)
    }

    @Test
    fun reconcileReplacesAVanishedSelectionWithFirst() {
        val store = SelectedVehicleStore()
        store.select(9L)

        store.reconcile(listOf(3L, 5L))

        assertEquals(3L, store.selectedId.value)
    }

    @Test
    fun reconcileClearsOnEmptyFleet() {
        val store = SelectedVehicleStore()
        store.select(3L)

        store.reconcile(emptyList())

        assertNull(store.selectedId.value)
    }
}
