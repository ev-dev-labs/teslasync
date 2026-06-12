package io.teslasync.android.featureviews.quicknav

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the QuickNav surface's pure logic — the native analogue of the static composition
 * the web component owns (web/src/features/dashboard/components/QuickNav.tsx): the fixed `NAV_ITEMS` catalogue
 * (four items in Drives→Charging→Analytics→Battery order), each item's navigation route (the web `nav.to`), each
 * item's accent (the web `color`), the empty guard, and the PII-safe `view.opened` diagnostic. Runs in the
 * offline `:app:testReleaseUnitTest` gate; the Compose render + accessibility are covered by the on-device
 * QuickNavUiTest.
 */
class QuickNavProjectionTest {
    // ── Catalogue: membership + order ───────────────────────────────────────────────

    @Test
    fun projectionHasTheFourWebNavItemsInOrder() {
        val destinations = QuickNavProjection.items.map { it.destination }

        assertEquals(
            listOf(
                QuickNavDestination.Drives,
                QuickNavDestination.Charging,
                QuickNavDestination.Analytics,
                QuickNavDestination.Battery,
            ),
            destinations,
        )
    }

    @Test
    fun projectionListsEveryDestinationExactlyOnce() {
        val destinations = QuickNavProjection.items.map { it.destination }

        assertEquals(QuickNavDestination.entries.size, destinations.size)
        assertEquals(QuickNavDestination.entries.toSet(), destinations.toSet())
    }

    // ── Routes: match the web nav.to (canonical Navigation-Compose routes) ───────────

    @Test
    fun eachDestinationCarriesItsWebRoute() {
        assertEquals("drives", QuickNavDestination.Drives.route)
        assertEquals("charging", QuickNavDestination.Charging.route)
        assertEquals("analytics", QuickNavDestination.Analytics.route)
        assertEquals("battery", QuickNavDestination.Battery.route)
    }

    @Test
    fun routesAreNonBlankAndSlashFree() {
        QuickNavDestination.entries.forEach { destination ->
            assertTrue("route must be non-blank", destination.route.isNotBlank())
            assertFalse("route must not carry a leading slash", destination.route.startsWith("/"))
        }
    }

    // ── Accents: each item carries the web color ─────────────────────────────────────

    @Test
    fun eachItemCarriesItsWebAccent() {
        val accents = QuickNavProjection.items.associate { it.destination to it.accent }

        assertEquals(QuickNavAccent.Cyan, accents[QuickNavDestination.Drives])
        assertEquals(QuickNavAccent.Green, accents[QuickNavDestination.Charging])
        assertEquals(QuickNavAccent.Purple, accents[QuickNavDestination.Analytics])
        assertEquals(QuickNavAccent.Amber, accents[QuickNavDestination.Battery])
    }

    // ── Empty guard ─────────────────────────────────────────────────────────────────

    @Test
    fun catalogueIsNeverEmpty() {
        assertFalse(QuickNavProjection.isEmpty)
        assertTrue(QuickNavProjection.items.isNotEmpty())
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        QuickNavDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "QuickNav"), fields)
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("QuickNav", QuickNavDiagnostics.SLUG)
        assertEquals("quick-nav", QuickNavDiagnostics.ID)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
