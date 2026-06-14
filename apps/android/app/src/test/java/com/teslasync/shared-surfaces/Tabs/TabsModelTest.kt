// Off-device unit coverage for the Tabs surface's pure model + id seam (P3 acceptance: the adapter unit test).
// Exercises the registration slug the prompt mandates, the empty / populated projection branches that mirror
// the web `tabs.length === 0` vs `tabs.map(...)` outcomes, every per-tab field (selected / disabled), the
// keyboard-navigation math that is the heart of the web `handleKeyDown` (enabled-key filtering, ArrowLeft /
// ArrowRight wrap-around, Home / End, disabled-skip, and the no-op edges), the per-tab / per-panel id
// composition (web `${tablistId}-tab-${key}` / `${tablistId}-panel-${key}`), the `useId` seam (deterministic
// vs distinct ids), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the behaviour the web `Tabs` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TabsModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("tabs", TabsRegistration.ID)
        assertEquals("Tabs", TabsRegistration.SLUG)
    }

    // ── projection: empty / populated branches ────────────────────────────────────────

    @Test
    fun emptyTabsProjectTheEmptyBranch() {
        val projection = TabsProjection.project(TabsInput(emptyList(), activeKey = "x"))
        assertEquals(TabsProjection.Empty, projection)
    }

    @Test
    fun populatedTabsProjectResolvedPreservingOrderAndState() {
        val input =
            TabsInput(
                tabs =
                    listOf(
                        TabItemInput(key = "overview", label = "Overview"),
                        TabItemInput(key = "battery", label = "Battery"),
                        TabItemInput(key = "history", label = "History", disabled = true),
                    ),
                activeKey = "battery",
            )
        val resolved = TabsProjection.project(input) as TabsProjection.Resolved
        assertEquals(listOf("overview", "battery", "history"), resolved.tabs.map { it.key })

        val overview = resolved.tabs[0]
        assertEquals("Overview", overview.label)
        assertFalse(overview.selected)
        assertFalse(overview.disabled)

        val battery = resolved.tabs[1]
        assertTrue(battery.selected)
        assertFalse(battery.disabled)

        val history = resolved.tabs[2]
        assertFalse(history.selected)
        assertTrue(history.disabled)
    }

    @Test
    fun noTabIsSelectedWhenActiveKeyMatchesNothing() {
        val input = TabsInput(listOf(TabItemInput("a", "A"), TabItemInput("b", "B")), activeKey = "missing")
        val resolved = TabsProjection.project(input) as TabsProjection.Resolved
        assertTrue(resolved.tabs.none { it.selected })
    }

    // ── enabled-key filtering (web `tabs.filter(t => !t.disabled).map(t => t.key)`) ────

    @Test
    fun enabledKeysExcludeDisabledTabsPreservingOrder() {
        val tabs =
            listOf(
                TabItemInput("a", "A"),
                TabItemInput("b", "B", disabled = true),
                TabItemInput("c", "C"),
                TabItemInput("d", "D", disabled = true),
            )
        assertEquals(listOf("a", "c"), enabledTabKeys(tabs))
    }

    // ── keyboard navigation (web handleKeyDown) ───────────────────────────────────────

    @Test
    fun nextMovesRightAndWrapsPastTheLast() {
        val keys = listOf("a", "b", "c")
        assertEquals("b", nextTabKey(keys, "a", TabMove.Next))
        assertEquals("c", nextTabKey(keys, "b", TabMove.Next))
        // Wrap-around: web `(idx + 1 + len) % len`.
        assertEquals("a", nextTabKey(keys, "c", TabMove.Next))
    }

    @Test
    fun previousMovesLeftAndWrapsPastTheFirst() {
        val keys = listOf("a", "b", "c")
        assertEquals("b", nextTabKey(keys, "c", TabMove.Previous))
        assertEquals("a", nextTabKey(keys, "b", TabMove.Previous))
        // Wrap-around: web `(idx - 1 + len) % len`.
        assertEquals("c", nextTabKey(keys, "a", TabMove.Previous))
    }

    @Test
    fun homeAndEndJumpToTheFirstAndLastEnabledKey() {
        val keys = listOf("a", "b", "c")
        assertEquals("a", nextTabKey(keys, "b", TabMove.First))
        assertEquals("c", nextTabKey(keys, "b", TabMove.Last))
    }

    @Test
    fun navigationWalksOnlyEnabledKeysSoDisabledTabsAreSkipped() {
        // The composable passes enabledTabKeys(...) here, so a disabled "b" between "a" and "c" is skipped.
        val enabled = enabledTabKeys(listOf(TabItemInput("a", "A"), TabItemInput("b", "B", disabled = true), TabItemInput("c", "C")))
        assertEquals(listOf("a", "c"), enabled)
        assertEquals("c", nextTabKey(enabled, "a", TabMove.Next))
        assertEquals("a", nextTabKey(enabled, "c", TabMove.Next))
    }

    @Test
    fun navigationIsANoOpWhenNoTabsAreEnabled() {
        // Web `if (enabledKeys.length === 0) return;`
        assertNull(nextTabKey(emptyList(), "a", TabMove.Next))
        assertNull(nextTabKey(emptyList(), "a", TabMove.Previous))
        assertNull(nextTabKey(emptyList(), "a", TabMove.First))
        assertNull(nextTabKey(emptyList(), "a", TabMove.Last))
    }

    @Test
    fun arrowNavigationIsANoOpWhenCurrentKeyIsNotEnabled() {
        // Web `if (idx === -1) return;` — a disabled/active tab arrowing finds no index among enabled keys.
        val keys = listOf("a", "b")
        assertNull(nextTabKey(keys, "disabled", TabMove.Next))
        assertNull(nextTabKey(keys, "disabled", TabMove.Previous))
    }

    @Test
    fun singleEnabledKeyWrapsToItself() {
        val keys = listOf("only")
        assertEquals("only", nextTabKey(keys, "only", TabMove.Next))
        assertEquals("only", nextTabKey(keys, "only", TabMove.Previous))
    }

    // ── per-tab / per-panel id composition (web `${tablistId}-tab-${key}` etc.) ────────

    @Test
    fun tabAndPanelIdsMatchTheWebComposition() {
        assertEquals("tabs-7-tab-overview", tabElementId("tabs-7", "overview"))
        assertEquals("tabs-7-panel-overview", tabPanelId("tabs-7", "overview"))
    }

    // ── id seam (web useId) ───────────────────────────────────────────────────────────

    @Test
    fun staticIdSourceIsDeterministic() {
        val source = StaticTabsIdSource("fixed-id")
        assertEquals("fixed-id", source.nextId())
        assertEquals("fixed-id", source.nextId())
    }

    @Test
    fun processIdSourceMintsDistinctPrefixedIds() {
        val source = ProcessTabsIdSource()
        val first = source.nextId()
        val second = source.nextId()
        assertNotEquals(first, second)
        assertTrue(first.startsWith("tabs-"))
        assertTrue(second.startsWith("tabs-"))
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        recordTabsOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "Tabs"), record.fields)
        // No tab key or label can leak through the diagnostic.
        assertTrue(record.fields.values.none { it.contains("battery", ignoreCase = true) })
    }
}
