package io.teslasync.android.navigation

import org.junit.Test

/**
 * Guards that [navGroupIcon] / [navIcon] resolve an icon for every group and destination — the
 * map-backed icon lookup would otherwise throw at runtime for a missing entry (navigation-bar and
 * rail items require an icon slot).
 */
class NavIconsTest {
    @Test
    fun everyNavGroupHasAnIcon() {
        NavGroup.entries.forEach { group -> navGroupIcon(group) }
    }

    @Test
    fun everyDestinationResolvesAnIcon() {
        Destinations.all.forEach { destination -> navIcon(destination) }
    }
}
