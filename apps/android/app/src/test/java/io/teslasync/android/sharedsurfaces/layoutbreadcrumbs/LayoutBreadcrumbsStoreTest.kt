// Off-device unit tests for [InMemoryBreadcrumbOverridesStore] — the native port of the web
// `BreadcrumbOverridesContext` (web/src/components/layout/BreadcrumbOverridesContext.tsx). They cover the
// register/unregister round-trip, the shallow left-to-right merge where a later registration wins a key conflict
// (web "latest-effect-wins"), the blank-value skip (web `if (v) merged[k] = v`), and the auto-id registration
// handle the web `useSetBreadcrumbOverrides` cleanup returns. Runs in the :app:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutBreadcrumbsStoreTest {
    @Test
    fun startsEmpty() {
        val store = InMemoryBreadcrumbOverridesStore()
        assertTrue(store.overrides.value.isEmpty())
    }

    @Test
    fun registerExposesTheMergedLabels() {
        val store = InMemoryBreadcrumbOverridesStore()
        store.register(1, mapOf("driveDetail" to "Trip to office"))

        assertEquals(mapOf("driveDetail" to "Trip to office"), store.overrides.value)
    }

    @Test
    fun separateRegistrationsMergeAcrossKeys() {
        val store = InMemoryBreadcrumbOverridesStore()
        store.register(1, mapOf("driveDetail" to "Trip to office"))
        store.register(2, mapOf("vehicleDetail" to "Model 3"))

        assertEquals(
            mapOf("driveDetail" to "Trip to office", "vehicleDetail" to "Model 3"),
            store.overrides.value,
        )
    }

    @Test
    fun aLaterRegistrationWinsAKeyConflict() {
        val store = InMemoryBreadcrumbOverridesStore()
        store.register(1, mapOf("driveDetail" to "Old"))
        store.register(2, mapOf("driveDetail" to "New"))

        assertEquals("New", store.overrides.value["driveDetail"])
    }

    @Test
    fun blankValuesAreSkipped() {
        val store = InMemoryBreadcrumbOverridesStore()
        store.register(1, mapOf("driveDetail" to "   ", "vehicleDetail" to "Model 3"))

        assertFalse(store.overrides.value.containsKey("driveDetail"))
        assertEquals("Model 3", store.overrides.value["vehicleDetail"])
    }

    @Test
    fun unregisterRemovesAContributionAndIsANoOpForUnknownIds() {
        val store = InMemoryBreadcrumbOverridesStore()
        store.register(1, mapOf("driveDetail" to "Trip to office"))

        store.unregister(99)
        assertEquals(mapOf("driveDetail" to "Trip to office"), store.overrides.value)

        store.unregister(1)
        assertTrue(store.overrides.value.isEmpty())
    }

    @Test
    fun autoIdRegistrationHandleWithdrawsTheLabels() {
        val store = InMemoryBreadcrumbOverridesStore()
        val handle = store.register(mapOf("driveDetail" to "Trip to office"))
        assertEquals("Trip to office", store.overrides.value["driveDetail"])

        handle.cancel()
        assertTrue(store.overrides.value.isEmpty())
        // Idempotent: a second cancel does not throw or corrupt state.
        handle.cancel()
        assertTrue(store.overrides.value.isEmpty())
    }

    @Test
    fun processDefaultStoreIsASingleSharedInstance() {
        assertTrue(BreadcrumbOverrides.store === BreadcrumbOverrides.store)
    }
}
