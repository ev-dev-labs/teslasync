package io.teslasync.android.shortcuts

import io.teslasync.android.navigation.RouteTable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the framework-free launcher-shortcut matrix (P3/A8). */
class AppShortcutsTest {
    @Test
    fun everyShortcutTargetsARealNavigableDestination() {
        AppShortcuts.all.forEach { shortcut ->
            assertTrue("shortcut ${shortcut.id} must resolve to a real destination", AppShortcuts.isReal(shortcut))
        }
    }

    @Test
    fun coversTheSpecMatrix() {
        val ids = AppShortcuts.all.map { it.id }
        assertEquals(
            listOf("dashboard", "vehicles", "charging", "liveMap", "commands", "notifications", "search"),
            ids,
        )
    }

    @Test
    fun deepLinksAreAppSchemeUrisThatMatchARegisteredRoute() {
        AppShortcuts.all.forEach { shortcut ->
            val uri = AppShortcuts.deepLinkUri(shortcut)
            assertTrue("$uri must use the app scheme", uri.startsWith("${RouteTable.APP_SCHEME}://"))
            val destination = AppShortcuts.destination(shortcut)!!
            assertTrue("$uri must be a registered deep link for ${destination.id}", uri in RouteTable.deepLinkUris(destination))
        }
    }

    @Test
    fun dashboardResolvesToTheRootDeepLink() {
        val dashboard = AppShortcuts.all.first { it.id == "dashboard" }
        assertEquals("${RouteTable.APP_SCHEME}://app/", AppShortcuts.deepLinkUri(dashboard))
    }

    @Test
    fun namedDestinationsKeepTheirPathSegment() {
        val vehicles = AppShortcuts.all.first { it.id == "vehicles" }
        assertEquals("${RouteTable.APP_SCHEME}://app/vehicles", AppShortcuts.deepLinkUri(vehicles))
        val inbox = AppShortcuts.all.first { it.id == "notifications" }
        assertEquals("${RouteTable.APP_SCHEME}://app/notifications/inbox", AppShortcuts.deepLinkUri(inbox))
    }

    @Test
    fun publishedHonorsTheLauncherCapAndRankOrder() {
        val three = AppShortcuts.published(max = 3)
        assertEquals(listOf("dashboard", "vehicles", "charging"), three.map { it.id })
        assertEquals(AppShortcuts.all.size, AppShortcuts.published(max = 99).size)
    }

    @Test
    fun publishedReturnsNothingWhenNoSlotsAreAvailable() {
        assertTrue(AppShortcuts.published(max = 0).isEmpty())
        assertTrue(AppShortcuts.published(max = -1).isEmpty())
    }

    @Test
    fun anUnknownShortcutIsNeitherRealNorResolvable() {
        val bogus = AppShortcut("bogus", "no-such-destination", rank = 0)
        assertFalse(AppShortcuts.isReal(bogus))
        // Falls back to the start destination's deep link rather than fabricating a route.
        assertTrue(AppShortcuts.deepLinkUri(bogus).startsWith("${RouteTable.APP_SCHEME}://"))
    }
}
