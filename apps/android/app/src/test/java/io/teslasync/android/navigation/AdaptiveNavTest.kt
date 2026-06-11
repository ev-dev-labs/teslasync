package io.teslasync.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for [AdaptiveNav]: width-driven layout, two-pane, drawer, and Up-affordance logic. */
class AdaptiveNavTest {
    @Test
    fun navLayoutFollowsWindowWidth() {
        assertEquals(NavLayout.BottomBar, AdaptiveNav.navLayout(WindowWidth.Compact))
        assertEquals(NavLayout.Rail, AdaptiveNav.navLayout(WindowWidth.Medium))
        assertEquals(NavLayout.Drawer, AdaptiveNav.navLayout(WindowWidth.Expanded))
    }

    @Test
    fun twoPaneIsUsedFromMediumWidthUp() {
        assertFalse(AdaptiveNav.useTwoPane(WindowWidth.Compact))
        assertTrue(AdaptiveNav.useTwoPane(WindowWidth.Medium))
        assertTrue(AdaptiveNav.useTwoPane(WindowWidth.Expanded))
    }

    @Test
    fun permanentDrawerOnlyAtExpandedWidth() {
        assertFalse(AdaptiveNav.usesPermanentDrawer(WindowWidth.Compact))
        assertFalse(AdaptiveNav.usesPermanentDrawer(WindowWidth.Medium))
        assertTrue(AdaptiveNav.usesPermanentDrawer(WindowWidth.Expanded))
    }

    @Test
    fun upAffordanceShownForDeepDestinationsOnly() {
        assertFalse(AdaptiveNav.showUp(Destinations.require("dashboard")))
        assertFalse(AdaptiveNav.showUp(Destinations.require("charging")))
        assertTrue(AdaptiveNav.showUp(Destinations.require("vehicleDetail")))
        assertTrue(AdaptiveNav.showUp(Destinations.require("chargingCurve")))
    }
}
