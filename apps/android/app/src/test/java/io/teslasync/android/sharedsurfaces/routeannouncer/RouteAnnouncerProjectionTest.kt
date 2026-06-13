package io.teslasync.android.sharedsurfaces.routeannouncer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RouteAnnouncer's pure logic — the native mirror of every decision the web
 * component makes inside its route-change effect (web/src/components/a11y/RouteAnnouncer.tsx): the
 * `firstRender` early-return, the empty-`document.title` clear, and the `counter % 4` zero-width-space
 * rotation that defeats screen-reader de-duplication of identical consecutive titles. Because the composable
 * is a thin render layer over [RouteAnnouncerProjection.reduce], the per-branch assertions here double as the
 * surface's state "snapshot". Runs in the :app:testReleaseUnitTest gate.
 */
class RouteAnnouncerProjectionTest {
    private val projection = RouteAnnouncerProjection

    // ── INITIAL + first-render suppression (web `firstRender`) ──────────────────────────────────────

    @Test
    fun initialStateIsUnprimedAndSilent() {
        val state = RouteAnnouncerProjection.INITIAL
        assertFalse("the announcer starts un-primed", state.primed)
        assertEquals(0, state.counter)
        assertEquals("", state.message)
    }

    @Test
    fun firstObservedRouteArmsButAnnouncesNothing() {
        // Web: the initial effect run returns early — the browser already spoke the initial page title.
        val armed = projection.reduce(RouteAnnouncerProjection.INITIAL, "Dashboard")
        assertTrue("the first route primes the announcer", armed.primed)
        assertEquals("the first route is not announced", "", armed.message)
        assertEquals(0, armed.counter)
    }

    @Test
    fun firstRouteIsSuppressedEvenWhenTitleIsBlank() {
        val armed = projection.reduce(RouteAnnouncerProjection.INITIAL, "")
        assertTrue(armed.primed)
        assertEquals("", armed.message)
    }

    // ── Announcing a route change (web non-empty `document.title` branch) ────────────────────────────

    @Test
    fun secondRouteAnnouncesTheTitleWithOneZeroWidthSpace() {
        val armed = projection.reduce(RouteAnnouncerProjection.INITIAL, "Dashboard")
        val announced = projection.reduce(armed, "Vehicles")
        assertEquals(1, announced.counter)
        assertEquals("Vehicles" + RouteAnnouncerProjection.ZERO_WIDTH_SPACE, announced.message)
    }

    @Test
    fun paddingRotatesModuloTheCycleAcrossSuccessiveAnnouncements() {
        var state = projection.reduce(RouteAnnouncerProjection.INITIAL, "Home") // armed, suppressed
        val observed = mutableListOf<Int>()
        for (title in listOf("B", "C", "D", "E", "F")) {
            state = projection.reduce(state, title)
            observed += state.counter
        }
        // 0 -> 1 -> 2 -> 3 -> 0 -> 1 (web `(counter + 1) % 4`).
        assertEquals(listOf(1, 2, 3, 0, 1), observed)
        assertEquals("F" + RouteAnnouncerProjection.ZERO_WIDTH_SPACE, state.message)
    }

    @Test
    fun identicalConsecutiveTitlesProduceDifferentMessages() {
        // Web example: /charging/123 -> /charging/456, both titled "Charging Session". The rotating pad makes
        // the live-region text differ so the second navigation is still spoken.
        val armed = projection.reduce(RouteAnnouncerProjection.INITIAL, "Charging Session")
        val first = projection.reduce(armed, "Charging Session")
        val second = projection.reduce(first, "Charging Session")
        assertNotEquals("identical titles must not produce identical announcements", first.message, second.message)
        assertTrue(first.message.startsWith("Charging Session"))
        assertTrue(second.message.startsWith("Charging Session"))
    }

    // ── Empty-title clear (web `if (!title) setMessage('')`) ────────────────────────────────────────

    @Test
    fun blankTitleClearsTheRegionWithoutAdvancingTheCounter() {
        val armed = projection.reduce(RouteAnnouncerProjection.INITIAL, "Dashboard")
        val announced = projection.reduce(armed, "Vehicles") // counter -> 1
        val cleared = projection.reduce(announced, "   ")
        assertEquals("a blank title clears the region", "", cleared.message)
        assertEquals("the rotation counter is untouched by an empty announcement", 1, cleared.counter)
        assertTrue(cleared.primed)
    }

    @Test
    fun nullTitleClearsTheRegion() {
        val armed = projection.reduce(RouteAnnouncerProjection.INITIAL, "Dashboard")
        val announced = projection.reduce(armed, "Vehicles")
        val cleared = projection.reduce(announced, null)
        assertEquals("", cleared.message)
    }

    // ── normalizeTitle + padding helpers ────────────────────────────────────────────────────────────

    @Test
    fun normalizeTitleTreatsNullBlankAndWhitespaceAsAbsent() {
        assertNull(projection.normalizeTitle(null))
        assertNull(projection.normalizeTitle(""))
        assertNull(projection.normalizeTitle("   "))
        assertNull(projection.normalizeTitle("\t\n"))
    }

    @Test
    fun normalizeTitleTrimsAPresentValue() {
        assertEquals("Dashboard", projection.normalizeTitle("  Dashboard "))
    }

    @Test
    fun paddingLengthMatchesTheCountAndIsAllZeroWidthSpaces() {
        for (count in 0 until RouteAnnouncerProjection.PADDING_CYCLE) {
            val pad = projection.padding(count)
            assertEquals(count, pad.length)
            assertTrue("the pad is built only from U+200B", pad.all { it == '\u200B' })
        }
    }
}
