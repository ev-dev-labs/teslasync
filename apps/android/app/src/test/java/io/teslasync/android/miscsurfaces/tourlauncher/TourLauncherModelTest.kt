package io.teslasync.android.miscsurfaces.tourlauncher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage for the pure TourLauncher model — the registry order/versions, the
 * [TourRouteMatch] recommended-route semantics (web `isRecommendedForRoute`), the [TourCompletions]
 * localStorage projection (web `isTourCompleted` key scheme), the row projection, and the
 * [TourLauncherStore] adapter (cached persisted flags → projected snapshot, web `resetAllTours` /
 * `markTourListSeen`). Mirrors the web spec (web/src/features/onboarding/TourLauncher.tsx +
 * web/src/lib/tourRegistry.ts). Run by the `:android:testReleaseUnitTest` gate.
 */
class TourLauncherModelTest {
    @Test
    fun registryReproducesWebOrderAndVersions() {
        val ids = TourLauncherRegistry.TOURS.map { it.id }
        assertEquals(
            listOf("main", "vehicles", "drives", "charging", "alerts", "automations", "settings", "debugger"),
            ids,
        )
        // Only the main tour is at version 2 (web bumped it); every other tour is version 1.
        assertEquals(2, tour("main").version)
        TourLauncherRegistry.TOURS.filter { it.id != "main" }.forEach { assertEquals(1, it.version) }
    }

    @Test
    fun mainTourIsRecommendedOnlyOnExactRoot() {
        assertTrue(tour("main").isRecommendedForRoute("/"))
        assertFalse(tour("main").isRecommendedForRoute("/vehicles"))
        assertFalse(tour("main").isRecommendedForRoute("/dashboard"))
    }

    @Test
    fun eachTourIsRecommendedOnItsOwnRouteAndNotOthers() {
        // (id, a matching path, a non-matching path) — the web routeMatch RegExps, 1:1.
        val cases =
            listOf(
                Triple("vehicles", "/vehicles", "/drives"),
                Triple("vehicles", "/vehicles/42", "/"),
                Triple("drives", "/drives/9", "/charging"),
                Triple("charging", "/charging", "/automations"),
                Triple("charging", "/cost-analysis", "/settings"),
                Triple("charging", "/smart-charge/now", "/drives"),
                Triple("alerts", "/notifications/alerts", "/notifications"),
                Triple("alerts", "/notifications/studio", "/notifications/logs"),
                Triple("automations", "/automations", "/settings"),
                Triple("settings", "/settings/units", "/automations"),
                Triple("debugger", "/state-debugger", "/vehicles"),
                Triple("debugger", "/signal-explorer", "/"),
            )
        cases.forEach { (id, matching, nonMatching) ->
            assertTrue("$id should be recommended on $matching", tour(id).isRecommendedForRoute(matching))
            assertFalse("$id should not be recommended on $nonMatching", tour(id).isRecommendedForRoute(nonMatching))
        }
    }

    @Test
    fun completionsFromStorageParsesStatusKeysAndIgnoresEverythingElse() {
        val stored =
            mapOf(
                TourStorage.completionKey("main", 2) to "completed",
                TourStorage.completionKey("drives", 1) to "skipped",
                TourStorage.LIST_SEEN_KEY to "true",
                TourStorage.LEGACY_COMPLETED_KEY to "completed",
                "teslasync:tour:v1:bogus" to "garbage-value",
                "some.other.pref" to "completed",
            )
        val completions = TourCompletions.fromStorage(stored)

        assertEquals(
            mapOf(
                TourStorage.completionKey("main", 2) to TourCompletionStatus.Completed,
                TourStorage.completionKey("drives", 1) to TourCompletionStatus.Skipped,
            ),
            completions.entries,
        )
        // list-seen ('true'), legacy key, an unrecognised value, and an unrelated pref are all ignored.
        assertFalse(completions.entries.containsKey(TourStorage.LIST_SEEN_KEY))
        assertFalse(completions.entries.containsKey("some.other.pref"))
    }

    @Test
    fun isCompletedIsVersionScoped() {
        val completions =
            TourCompletions(mapOf(TourStorage.completionKey("main", 2) to TourCompletionStatus.Completed))
        assertTrue(completions.isCompleted("main", 2))
        // A flag at a different version reads as not-done (web "bump to silently invalidate").
        assertFalse(completions.isCompleted("main", 1))
        assertFalse(completions.isCompleted("vehicles", 1))
    }

    @Test
    fun projectionComputesCompletedAndRecommendedPerRow() {
        val completions =
            TourCompletions(
                mapOf(
                    TourStorage.completionKey("vehicles", 1) to TourCompletionStatus.Completed,
                    TourStorage.completionKey("drives", 1) to TourCompletionStatus.Skipped,
                ),
            )
        val rows = TourLauncherProjection.rows(TourLauncherRegistry.TOURS, completions, pathname = "/vehicles")

        // Order is preserved (registry order is the display order).
        assertEquals(TourLauncherRegistry.TOURS.map { it.id }, rows.map { it.id })
        val byId = rows.associateBy { it.id }
        assertTrue(byId.getValue("vehicles").completed)
        assertTrue(byId.getValue("drives").completed) // skipped counts as done
        assertFalse(byId.getValue("main").completed)
        // Only the route-matching tour is recommended.
        assertTrue(byId.getValue("vehicles").recommended)
        assertFalse(byId.getValue("main").recommended)
        assertFalse(byId.getValue("drives").recommended)
    }

    @Test
    fun storeProjectsPersistedCompletions() {
        val persistence =
            InMemoryPersistence(
                mutableMapOf(
                    TourStorage.completionKey("main", 2) to "completed",
                    TourStorage.LIST_SEEN_KEY to "true",
                ),
            )
        val store = TourLauncherStore(persistence)

        val completions = store.completions().value
        assertTrue(completions.isCompleted("main", 2))
        assertFalse(completions.isCompleted("vehicles", 1))
    }

    @Test
    fun resetAllClearsOwnedAndLegacyKeysButKeepsUnrelatedPrefs() {
        val persistence =
            InMemoryPersistence(
                mutableMapOf(
                    TourStorage.completionKey("main", 2) to "completed",
                    TourStorage.LIST_SEEN_KEY to "true",
                    TourStorage.LEGACY_COMPLETED_KEY to "completed",
                    "unrelated.pref" to "keep-me",
                ),
            )
        val store = TourLauncherStore(persistence)

        store.resetAll()

        assertEquals(TourCompletions.EMPTY, store.completions().value)
        val remaining = persistence.snapshot()
        assertEquals(mapOf("unrelated.pref" to "keep-me"), remaining)
    }

    @Test
    fun markListSeenWritesTheSeenFlag() {
        val persistence = InMemoryPersistence()
        val store = TourLauncherStore(persistence)

        store.markListSeen()

        assertEquals(TourStorage.SEEN_VALUE, persistence.snapshot()[TourStorage.LIST_SEEN_KEY])
    }

    @Test
    fun refreshRepublishesAfterAnExternalCompletionWrite() {
        val persistence = InMemoryPersistence()
        val store = TourLauncherStore(persistence)
        assertFalse(store.completions().value.isCompleted("vehicles", 1))

        // The tour player writes a completion directly to persistence, then the launcher refreshes.
        persistence.setValue(TourStorage.completionKey("vehicles", 1), "completed")
        store.refresh()

        assertTrue(store.completions().value.isCompleted("vehicles", 1))
    }

    @Test
    fun diagnosticsExposesStableSlug() {
        assertEquals("TourLauncher", TourLauncherDiagnostics.SLUG)
        assertEquals("tour-launcher", TourLauncherDiagnostics.ID)
    }

    private fun tour(id: String): TourDefinition = TourLauncherRegistry.TOURS.first { it.id == id }

    private class InMemoryPersistence(
        private val store: MutableMap<String, String> = mutableMapOf(),
    ) : TourCompletionPersistence {
        override fun snapshot(): Map<String, String> = store.toMap()

        override fun setValue(
            key: String,
            value: String,
        ) {
            store[key] = value
        }

        override fun removeKeys(predicate: (String) -> Boolean) {
            store.keys
                .filter(predicate)
                .toList()
                .forEach(store::remove)
        }
    }
}
