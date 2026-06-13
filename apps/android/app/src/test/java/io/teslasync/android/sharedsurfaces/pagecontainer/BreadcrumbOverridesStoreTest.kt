package io.teslasync.android.sharedsurfaces.pagecontainer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the producer-side breadcrumb-overrides state holder (P1/S8) — the native analogue
 * of the web `BreadcrumbOverridesContext` that `useSetBreadcrumbOverrides` pushes into. Confirms register /
 * merge / unregister semantics drive the merged [BreadcrumbOverridesStore.overrides] correctly so a breadcrumb
 * consumer always reads the labels of the pages currently on screen. Runs in the :android:testReleaseUnitTest gate.
 */
class BreadcrumbOverridesStoreTest {
    @Test
    fun startsEmpty() {
        assertEquals(emptyMap<String, String>(), BreadcrumbOverridesStore().current)
    }

    @Test
    fun registerPublishesLabelsToCurrentAndFlow() {
        val store = BreadcrumbOverridesStore()

        store.register(owner = Any(), labels = mapOf("/drives/:id" to "Trip to office"))

        assertEquals("Trip to office", store.current["/drives/:id"])
        assertEquals("the hot flow mirrors the merged snapshot", "Trip to office", store.overrides.value["/drives/:id"])
    }

    @Test
    fun laterOwnerWinsPerRouteKey() {
        val store = BreadcrumbOverridesStore()
        val first = Any()
        val second = Any()

        store.register(first, mapOf("/x" to "First", "/y" to "Y"))
        store.register(second, mapOf("/x" to "Second"))

        assertEquals("Second", store.current["/x"])
        assertEquals("untouched keys from other owners survive", "Y", store.current["/y"])
    }

    @Test
    fun unregisterRemovesOnlyThatOwnersLabels() {
        val store = BreadcrumbOverridesStore()
        val first = Any()
        val second = Any()
        store.register(first, mapOf("/x" to "X"))
        store.register(second, mapOf("/y" to "Y"))

        store.unregister(first)

        assertEquals(setOf("/y"), store.current.keys)
    }

    @Test
    fun unregisterAnUnknownOwnerLeavesTheMapUnchanged() {
        val store = BreadcrumbOverridesStore()
        store.register(Any(), mapOf("/x" to "X"))

        store.unregister(Any())

        assertEquals(setOf("/x"), store.current.keys)
    }

    @Test
    fun reRegisteringTheSameOwnerReplacesItsLabels() {
        val store = BreadcrumbOverridesStore()
        val owner = Any()

        store.register(owner, mapOf("/x" to "Before"))
        store.register(owner, mapOf("/x" to "After"))

        assertEquals("After", store.current["/x"])
        assertTrue("re-registering must not accumulate stale keys", store.current.keys == setOf("/x"))
    }
}
