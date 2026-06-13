package io.teslasync.android.sharedsurfaces.bottomtabbar

import io.teslasync.android.navigation.RouteTable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the BottomTabBar's pure logic — the native mirror of the web component's per-tab
 * `isActive` derivation (web/src/components/layout/BottomTabBar.tsx): the root tab matches only an exact `/`,
 * every other tab matches its own path exactly OR a descendant (`startsWith(tab.path + '/')`), and a sibling
 * section never lights the tab. Because the composable is a thin render layer over
 * [BottomTabBarProjection.project], the per-branch assertions here double as the surface's state "snapshot".
 * Also guards that the five tabs can never drift from the canonical [RouteTable.bottomBar] set. Runs in the
 * :app:testReleaseUnitTest gate.
 */
class BottomTabBarProjectionTest {
    private val strings =
        BottomTabBarStrings(
            navLabel = "Quick navigation",
            dashboard = "Dashboard",
            drives = "Drives",
            charging = "Charging",
            battery = "Battery Health",
            liveMap = "Live Map",
        )

    // ── Parity guards: the native tab set IS the canonical route-table bottom bar, with the web's paths. ──

    @Test
    fun tabsMatchTheCanonicalRouteTableBottomBarInOrder() {
        assertEquals(
            RouteTable.bottomBar.map { it.id },
            BottomTab.entries.map { it.destinationId },
        )
    }

    @Test
    fun tabPathsMatchTheWebSourcePathsExactly() {
        // The web TABS array: '/', '/drives', '/charging', '/battery', '/live'.
        assertEquals("/", BottomTab.Dashboard.path)
        assertEquals("/drives", BottomTab.Drives.path)
        assertEquals("/charging", BottomTab.Charging.path)
        assertEquals("/battery", BottomTab.Battery.path)
        assertEquals("/live", BottomTab.LiveMap.path)
    }

    // ── isActive: the root tab matches ONLY an exact root (web `tab.path === '/' ? pathname === '/'`). ──

    @Test
    fun rootTabIsActiveOnlyForTheExactRootPath() {
        assertTrue(BottomTabBarProjection.isActive("/", "/"))
        assertFalse(BottomTabBarProjection.isActive("/drives", "/"))
        assertFalse(BottomTabBarProjection.isActive("/charging/123", "/"))
    }

    // ── isActive: a non-root tab matches its exact path or a descendant (web exact || startsWith). ──

    @Test
    fun sectionTabIsActiveForItsExactPath() {
        assertTrue(BottomTabBarProjection.isActive("/charging", "/charging"))
    }

    @Test
    fun sectionTabIsActiveForADescendantRoute() {
        assertTrue(BottomTabBarProjection.isActive("/charging/123", "/charging"))
        assertTrue(BottomTabBarProjection.isActive("/drives/42/replay", "/drives"))
    }

    @Test
    fun sectionTabIsNotActivatedByASiblingSection() {
        // The deliberate "+ '/'" in the web check: `/charging-curve` shares a prefix with `/charging` but is a
        // different section, so it must NOT light the Charging tab.
        assertFalse(BottomTabBarProjection.isActive("/charging-curve", "/charging"))
        assertFalse(BottomTabBarProjection.isActive("/battery-cells", "/battery"))
    }

    @Test
    fun sectionTabIsNotActiveForAnUnrelatedRoute() {
        assertFalse(BottomTabBarProjection.isActive("/settings", "/charging"))
    }

    // ── normalization: a trailing slash or query string never flips a tab. ──

    @Test
    fun trailingSlashAndQueryAreNormalizedBeforeMatching() {
        assertTrue(BottomTabBarProjection.isActive("/charging/", "/charging"))
        assertTrue(BottomTabBarProjection.isActive("/charging?tab=sessions", "/charging"))
        assertTrue(BottomTabBarProjection.isActive("/", "/"))
    }

    // ── project: every state renders all five tabs with exactly one (or zero) active. ──

    @Test
    fun projectAlwaysRendersAllFiveTabsWithTheirLocalizedLabels() {
        val display = BottomTabBarProjection.project("/", strings)
        assertEquals(5, display.items.size)
        assertEquals(BottomTab.entries.toList(), display.items.map { it.tab })
        assertEquals(
            listOf("Dashboard", "Drives", "Charging", "Battery Health", "Live Map"),
            display.items.map { it.label },
        )
        assertEquals("Quick navigation", display.navLabel)
    }

    @Test
    fun projectHighlightsTheDashboardTabAtTheRoot() {
        val display = BottomTabBarProjection.project("/", strings)
        assertEquals(BottomTab.Dashboard, display.activeTab)
        assertEquals(listOf(true, false, false, false, false), display.items.map { it.active })
    }

    @Test
    fun projectHighlightsTheChargingTabForADescendantRoute() {
        val display = BottomTabBarProjection.project("/charging/123", strings)
        assertEquals(BottomTab.Charging, display.activeTab)
        assertEquals(1, display.items.count { it.active })
    }

    @Test
    fun projectLeavesEveryTabInactiveForARouteOutsideTheBar() {
        val display = BottomTabBarProjection.project("/settings", strings)
        assertNull(display.activeTab)
        assertTrue(display.items.none { it.active })
    }

    @Test
    fun projectActivatesAtMostOneTabForEveryBottomBarRoute() {
        for (tab in BottomTab.entries) {
            val display = BottomTabBarProjection.project(tab.path, strings)
            assertEquals("exactly one tab active at ${tab.path}", 1, display.items.count { it.active })
            assertEquals(tab, display.activeTab)
        }
    }
}
