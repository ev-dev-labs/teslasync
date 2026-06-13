// Off-device unit coverage for the KeyboardShortcutsModal surface's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the registry's last-writer-wins dedupe + first-seen ordering, the
// projection's scope filter (All / Global / This page), the route-prefix match for non-global entries, the
// case-insensitive description search, the group-by + fixed-priority-then-alphabetical sort with id-sorted rows,
// the app-global seed builder (web lib/globalShortcuts.tsx), the filter-mode persistence token, and the
// PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.keyboardshortcutsmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyboardShortcutsModalModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    private fun def(
        id: String,
        group: String,
        scope: ShortcutScope = ShortcutScope.Global,
        description: String = id,
        routeMatch: String? = null,
    ) = ShortcutDefinition(id = id, keys = listOf("?"), description = description, group = group, scope = scope, routeMatch = routeMatch)

    // ---- Registry: dedupe + order + register/unregister (web store.entries Map semantics) ----------

    @Test
    fun registry_registerDedupesByIdLastWriterWins() {
        val registry = KeyboardShortcutsRegistry()
        registry.register(def("dupe", "Actions", description = "first"))
        registry.register(def("dupe", "Actions", description = "second"))

        val snapshot = registry.snapshot()
        assertEquals(1, snapshot.size)
        assertEquals("second", snapshot.single().description)
    }

    @Test
    fun registry_unregisterRemovesById() {
        val registry = KeyboardShortcutsRegistry(listOf(def("a", "Actions"), def("b", "Actions")))
        registry.unregister(listOf("a"))
        assertEquals(listOf("b"), registry.snapshot().map { it.id })
    }

    @Test
    fun registry_preservesFirstSeenOrderWhenAnEntryIsUpdated() {
        val registry = KeyboardShortcutsRegistry()
        registry.register(listOf(def("a", "Actions"), def("b", "Actions")))
        registry.register(def("a", "Actions", description = "updated"))
        assertEquals(listOf("a", "b"), registry.snapshot().map { it.id })
    }

    @Test
    fun registry_shortcutsFlowReflectsLatestSnapshot() {
        val registry = KeyboardShortcutsRegistry()
        registry.register(def("a", "Actions"))
        assertEquals(listOf("a"), registry.shortcuts.value.map { it.id })
    }

    // ---- Projection: scope filter (web All / Global / This page) ----------------------------------

    @Test
    fun projection_globalFilterKeepsOnlyGlobalEntries() {
        val all =
            listOf(
                def("g1", "Actions", ShortcutScope.Global),
                def("p1", "Dashboard", ShortcutScope.Route, routeMatch = "dashboard"),
            )
        val groups = KeyboardShortcutsProjection.groups(all, FilterMode.Global, "dashboard", "")
        assertEquals(listOf("g1"), groups.flatMap { it.shortcuts }.map { it.id })
    }

    @Test
    fun projection_pageFilterHidesGlobalAndMatchesRoutePrefix() {
        val all =
            listOf(
                def("g1", "Actions", ShortcutScope.Global),
                def("p1", "Dashboard", ShortcutScope.Page, routeMatch = "dashboard"),
                def("p2", "Trip replay", ShortcutScope.Route, routeMatch = "drives/"),
            )
        val onDashboard = KeyboardShortcutsProjection.groups(all, FilterMode.Page, "dashboard", "")
        assertEquals(listOf("p1"), onDashboard.flatMap { it.shortcuts }.map { it.id })
    }

    @Test
    fun projection_routeScopedEntryHiddenWhenRouteDoesNotMatch() {
        val all = listOf(def("p2", "Trip replay", ShortcutScope.Route, routeMatch = "drives/"))
        val result = KeyboardShortcutsProjection.groups(all, FilterMode.All, "dashboard", "")
        assertTrue(result.isEmpty())
    }

    @Test
    fun projection_nonGlobalEntryWithoutRouteMatchIsNeverVisible() {
        // Web `if (def.scope !== 'global') { if (!def.routeMatch) return false }`.
        val all = listOf(def("p3", "Dashboard", ShortcutScope.Page, routeMatch = null))
        assertTrue(KeyboardShortcutsProjection.groups(all, FilterMode.All, "dashboard", "").isEmpty())
    }

    // ---- Projection: search (case-insensitive substring over description) -------------------------

    @Test
    fun projection_searchMatchesDescriptionCaseInsensitively() {
        val all =
            listOf(
                def("a", "Actions", description = "Open command palette"),
                def("b", "Actions", description = "Show keyboard shortcuts"),
            )
        val groups = KeyboardShortcutsProjection.groups(all, FilterMode.All, "", "PALETTE")
        assertEquals(listOf("a"), groups.flatMap { it.shortcuts }.map { it.id })
    }

    @Test
    fun projection_blankSearchKeepsEverything() {
        val all = listOf(def("a", "Actions"), def("b", "Actions"))
        val groups = KeyboardShortcutsProjection.groups(all, FilterMode.All, "", "   ")
        assertEquals(2, groups.flatMap { it.shortcuts }.size)
    }

    @Test
    fun projection_filterClearingEverythingYieldsTheEmptyState() {
        val all = listOf(def("a", "Actions", description = "Open command palette"))
        assertTrue(KeyboardShortcutsProjection.groups(all, FilterMode.All, "", "no-such-row").isEmpty())
    }

    // ---- Projection: grouping + ordering (priority desc, then alpha; rows by id) -------------------

    @Test
    fun projection_ordersGroupsByPriorityThenAlphabetical() {
        val all =
            listOf(
                def("z", "Zebra"),
                def("a", "Actions"),
                def("n", "Navigation (press g then…)"),
            )
        val titles = KeyboardShortcutsProjection.groups(all, FilterMode.All, "", "").map { it.title }
        assertEquals(listOf("Navigation (press g then…)", "Actions", "Zebra"), titles)
    }

    @Test
    fun projection_sortsRowsWithinAGroupById() {
        val all =
            listOf(
                def("global.goto.v", "Navigation (press g then…)"),
                def("global.goto.d", "Navigation (press g then…)"),
            )
        val rows =
            KeyboardShortcutsProjection
                .groups(all, FilterMode.All, "", "")
                .single()
                .shortcuts
                .map { it.id }
        assertEquals(listOf("global.goto.d", "global.goto.v"), rows)
    }

    @Test
    fun groupRank_matchesWebPriorityTable() {
        assertEquals(100, KeyboardShortcutsProjection.groupRank("Navigation (press g then…)"))
        assertEquals(90, KeyboardShortcutsProjection.groupRank("Actions"))
        assertEquals(0, KeyboardShortcutsProjection.groupRank("Custom Page"))
    }

    // ---- Seed builder (web lib/globalShortcuts.tsx) -----------------------------------------------

    @Test
    fun buildDefaultShortcuts_seedsUniversalsAndNavigationAllGlobal() {
        val strings =
            ShortcutSeedStrings(
                groupActions = "Actions",
                groupNavigation = "Navigation",
                openPalette = "Open command palette",
                openPaletteAlt = "Open command palette",
                openShortcuts = "Show keyboard shortcuts",
                closeModal = "Close modal / cancel",
            )
        val seed = buildDefaultShortcuts(strings, listOf(NavSeedTarget("d", "Go to Dashboard")))

        // Four universal keys + one navigation target, every entry global (always visible).
        assertEquals(5, seed.size)
        assertTrue(seed.all { it.scope == ShortcutScope.Global })

        val ctrlK = seed.single { it.id == "global.palette.ctrlk" }
        assertEquals(listOf("Ctrl", "K"), ctrlK.keys)
        assertEquals("Actions", ctrlK.group)

        val goto = seed.single { it.id == "global.goto.d" }
        assertEquals(listOf("g", "d"), goto.keys)
        assertEquals("Go to Dashboard", goto.description)
        assertEquals("Navigation", goto.group)
    }

    @Test
    fun buildDefaultShortcuts_groupsAndSortsIntoTheRenderedSections() {
        val strings =
            ShortcutSeedStrings(
                groupActions = "Actions",
                groupNavigation = "Navigation (press g then…)",
                openPalette = "Open command palette",
                openPaletteAlt = "Open command palette",
                openShortcuts = "Show keyboard shortcuts",
                closeModal = "Close modal / cancel",
            )
        val seed = buildDefaultShortcuts(strings, listOf(NavSeedTarget("d", "Go to Dashboard")))
        val titles = KeyboardShortcutsProjection.groups(seed, FilterMode.All, "", "").map { it.title }
        // Navigation (rank 100) renders before Actions (rank 90).
        assertEquals(listOf("Navigation (press g then…)", "Actions"), titles)
    }

    // ---- FilterMode persistence + holder (web sessionStorage) -------------------------------------

    @Test
    fun filterMode_roundTripsThroughItsPersistedId() {
        assertEquals(FilterMode.Page, FilterMode.fromId("page"))
        assertEquals(FilterMode.Global, FilterMode.fromId("global"))
        assertEquals(FilterMode.All, FilterMode.fromId("nonsense"))
        assertEquals(FilterMode.All, FilterMode.fromId(null))
    }

    @Test
    fun filterStore_persistsTheSelectedMode() {
        val store = KeyboardShortcutsFilterStore()
        assertEquals(FilterMode.All, store.mode.value)
        store.set(FilterMode.Global)
        assertEquals(FilterMode.Global, store.mode.value)
    }

    // ---- Registration + diagnostics ---------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("keyboard-shortcuts-modal", KeyboardShortcutsModalRegistration.ID)
        assertEquals("KeyboardShortcutsModal", KeyboardShortcutsModalRegistration.SLUG)
    }

    @Test
    fun recordOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordKeyboardShortcutsModalOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "KeyboardShortcutsModal"), fields)
    }
}
