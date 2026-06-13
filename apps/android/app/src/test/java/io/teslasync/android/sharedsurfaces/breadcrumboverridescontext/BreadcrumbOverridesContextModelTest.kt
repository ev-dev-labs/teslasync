// Off-device unit coverage for the BreadcrumbOverridesContext surface's pure model + coordinator (P3
// acceptance: adapter + per-state tests). Exercises the prompt-mandated registration slug + id, the
// blank-dropping [normalizeOverrides] (web merge `if (v)`), the insertion-ordered [mergeOverrideRegistrations]
// (web `registrations.values()` shallow-left-to-right, later wins), the [resolveBreadcrumbLabel] bridge the
// downstream `useBreadcrumbs` performs (`override ?? fallback`), the [BreadcrumbOverridesRegistry] (membership,
// re-put keeps position, remove), the [BreadcrumbOverridesCoordinator] register/unregister lifecycle over its
// observable merged map, and the [NoopBreadcrumbOverridesController] (web outside-provider no-op). No Compose /
// Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference behaviour is
// web/src/components/layout/BreadcrumbOverridesContext.tsx.

package io.teslasync.android.sharedsurfaces.breadcrumboverridescontext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BreadcrumbOverridesContextModelTest {
    // -- registration metadata mirrors the prompt-mandated surface slug + id ------------------------------

    @Test
    fun registrationMetadataMatchesThePromptSlug() {
        assertEquals("breadcrumb-overrides-context", BreadcrumbOverridesContextRegistration.ID)
        assertEquals("BreadcrumbOverridesContext", BreadcrumbOverridesContextRegistration.SLUG)
        assertEquals(1, FIRST_REGISTRATION_ID)
    }

    // -- normalizeOverrides — the web merge's `if (v)` blank-drop, applied at registration -----------------

    @Test
    fun normalizeDropsBlankValuedEntriesAndKeepsTheRest() {
        assertEquals(
            mapOf("/drives/:id" to "Trip to the office"),
            normalizeOverrides(mapOf("/drives/:id" to "Trip to the office", "/drives" to "")),
        )
    }

    @Test
    fun normalizeIsIdempotent() {
        val once = normalizeOverrides(mapOf("/a" to "A", "/b" to ""))
        assertEquals(once, normalizeOverrides(once))
    }

    // -- mergeOverrideRegistrations — shallow-left-to-right, later wins, blank-dropped (web `overrides`) ---

    @Test
    fun mergeOfNoRegistrationsIsEmpty() {
        assertEquals(emptyMap<String, String>(), mergeOverrideRegistrations(emptyList()))
    }

    @Test
    fun mergeOfOneRegistrationDropsBlanks() {
        assertEquals(
            mapOf("/drives/:id" to "Trip"),
            mergeOverrideRegistrations(listOf(mapOf("/drives/:id" to "Trip", "/x" to ""))),
        )
    }

    @Test
    fun mergeLetsALaterRegistrationWinForTheSameKey() {
        // web latest-effect-wins: the second registration of the same route key overrides the first.
        val merged =
            mergeOverrideRegistrations(
                listOf(
                    mapOf("/drives/:id" to "First", "/drives" to "Drives"),
                    mapOf("/drives/:id" to "Second"),
                ),
            )
        assertEquals("Second", merged["/drives/:id"])
        assertEquals("Drives", merged["/drives"])
    }

    @Test
    fun mergeKeepsDisjointKeysFromEveryRegistration() {
        val merged =
            mergeOverrideRegistrations(
                listOf(mapOf("/a" to "A"), mapOf("/b" to "B"), mapOf("/c" to "C")),
            )
        assertEquals(mapOf("/a" to "A", "/b" to "B", "/c" to "C"), merged)
    }

    // -- resolveBreadcrumbLabel — the downstream useBreadcrumbs bridge (`override ?? fallback`) ------------

    @Test
    fun resolvePrefersAPresentOverride() {
        assertEquals(
            "Trip to the office",
            resolveBreadcrumbLabel(mapOf("/drives/:id" to "Trip to the office"), "/drives/:id", "Drive #4421"),
        )
    }

    @Test
    fun resolveFallsBackWhenNoOverrideOrBlank() {
        assertEquals("Drive #4421", resolveBreadcrumbLabel(emptyMap(), "/drives/:id", "Drive #4421"))
        // A defensively-blank override never shadows the route default.
        assertEquals("Drive #4421", resolveBreadcrumbLabel(mapOf("/drives/:id" to ""), "/drives/:id", "Drive #4421"))
    }

    // -- BreadcrumbOverridesRegistry — the web `registrations` Map + register + merged --------------------

    @Test
    fun registryPutMergedSizeAndRemove() {
        val registry = BreadcrumbOverridesRegistry()
        assertEquals(0, registry.size)
        assertEquals(emptyMap<String, String>(), registry.merged())

        registry.put(1, mapOf("/drives/:id" to "Trip", "/x" to ""))
        assertEquals(1, registry.size)
        assertEquals(mapOf("/drives/:id" to "Trip"), registry.merged())

        assertTrue(registry.remove(1))
        assertFalse("removing an absent id reports false", registry.remove(1))
        assertEquals(0, registry.size)
        assertEquals(emptyMap<String, String>(), registry.merged())
    }

    @Test
    fun reRegisteringTheSameIdReplacesItsMapWithoutChangingMergeOrder() {
        val registry = BreadcrumbOverridesRegistry()
        registry.put(1, mapOf("/drives/:id" to "A"))
        registry.put(2, mapOf("/drives/:id" to "B"))
        // id 2 registered later -> wins.
        assertEquals("B", registry.merged()["/drives/:id"])

        // Re-put id 1: its value changes but its insertion position stays BEFORE id 2, so id 2 still wins
        // (web `Map.set` on an existing key keeps its position).
        registry.put(1, mapOf("/drives/:id" to "A2"))
        assertEquals(2, registry.size)
        assertEquals("B", registry.merged()["/drives/:id"])
    }

    // -- BreadcrumbOverridesCoordinator — register/unregister over the observable merged map --------------

    @Test
    fun coordinatorStartsEmpty() {
        val coordinator = BreadcrumbOverridesCoordinator()
        assertEquals(emptyMap<String, String>(), coordinator.overrides.value)
        assertEquals(0, coordinator.registrationCount)
    }

    @Test
    fun coordinatorRegisterPublishesTheMergedMapAndUnregisterReverts() {
        val coordinator = BreadcrumbOverridesCoordinator()

        val unregister = coordinator.register(mapOf("/drives/:id" to "Trip to the office"))
        assertEquals(mapOf("/drives/:id" to "Trip to the office"), coordinator.overrides.value)
        assertEquals(1, coordinator.registrationCount)

        unregister()
        assertEquals(emptyMap<String, String>(), coordinator.overrides.value)
        assertEquals(0, coordinator.registrationCount)
    }

    @Test
    fun coordinatorLaterRegistrationWinsAndUnregisterRestoresTheEarlierOne() {
        val coordinator = BreadcrumbOverridesCoordinator()

        val unFirst = coordinator.register(mapOf("/drives/:id" to "First"))
        val unSecond = coordinator.register(mapOf("/drives/:id" to "Second"))
        assertEquals("Second", coordinator.overrides.value["/drives/:id"])

        // Removing the later registration falls back to the earlier one (web latest-effect-wins on unmount).
        unSecond()
        assertEquals("First", coordinator.overrides.value["/drives/:id"])

        unFirst()
        assertEquals(emptyMap<String, String>(), coordinator.overrides.value)
    }

    @Test
    fun coordinatorMergesDisjointRegistrationsFromDifferentPages() {
        val coordinator = BreadcrumbOverridesCoordinator()
        coordinator.register(mapOf("/drives/:id" to "Trip"))
        coordinator.register(mapOf("/charging/:id" to "Supercharge at HQ"))

        assertEquals(
            mapOf("/drives/:id" to "Trip", "/charging/:id" to "Supercharge at HQ"),
            coordinator.overrides.value,
        )
        assertEquals(2, coordinator.registrationCount)
    }

    @Test
    fun coordinatorAllocatesAFreshIdPerRegistrationSoUnregisterIsIndependent() {
        val coordinator = BreadcrumbOverridesCoordinator()
        // Two registrations of the SAME key get distinct ids; removing one leaves the other intact.
        val unA = coordinator.register(mapOf("/drives/:id" to "A"))
        coordinator.register(mapOf("/drives/:id" to "B"))

        unA()
        assertEquals("B", coordinator.overrides.value["/drives/:id"])
        assertEquals(1, coordinator.registrationCount)
    }

    // -- NoopBreadcrumbOverridesController — the web outside-provider early return ------------------------

    @Test
    fun noopControllerRegistersNothingAndReturnsAnInvocableNoOpUnregister() {
        // Outside a provider the controller is a no-op (web `if (!ctx) return`): register returns a cleanup
        // that is safe to invoke (and re-invoke). A throw in either step would fail this test by propagation.
        val unregister = NoopBreadcrumbOverridesController.register(mapOf("/drives/:id" to "ignored"))
        unregister()
        assertEquals(Unit, unregister())
    }
}
