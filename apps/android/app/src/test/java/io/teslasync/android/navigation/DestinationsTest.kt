package io.teslasync.android.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the [Destinations] registry invariants: stable unique identity, route-pattern
 * derivation from the web path, and the chrome/auth/nav flags the shell relies on. Title and group
 * string-resource completeness is enforced at compile time (NavStrings references one R.string per
 * id/group), so it is not re-checked here.
 */
class DestinationsTest {
    @Test
    fun idsAreUnique() {
        assertEquals(Destinations.all.size, Destinations.byId.size)
    }

    @Test
    fun webPathsAreUnique() {
        assertEquals(
            Destinations.all.size,
            Destinations.all
                .map { it.webPath }
                .toSet()
                .size,
        )
    }

    @Test
    fun routePatternsAreUnique() {
        assertEquals(
            Destinations.all.size,
            Destinations.all
                .map { it.route }
                .toSet()
                .size,
        )
    }

    @Test
    fun registryCoversTheWholeWebTaxonomy() {
        // Locks parity with web/src/App.tsx (137 canonical pages); update with the generator only.
        assertEquals(137, Destinations.all.size)
    }

    @Test
    fun requireThrowsForUnknownId() {
        assertThrows(NoSuchElementException::class.java) { Destinations.require("nope") }
    }

    @Test
    fun routeIsDerivedFromWebPathWithBraces() {
        assertEquals("dashboard", Destinations.require("dashboard").route)
        assertEquals("vehicles/{id}", Destinations.require("vehicleDetail").route)
        assertEquals("drives/{id}/replay", Destinations.require("tripReplay").route)
        assertEquals("s/{token}", Destinations.require("sharedDrive").route)
        assertEquals("admin/telemetry/coverage", Destinations.require("adminTelemetryCoverage").route)
    }

    @Test
    fun parameterizedFlagTracksArguments() {
        assertTrue(Destinations.require("vehicleDetail").isParameterized)
        assertFalse(Destinations.require("dashboard").isParameterized)
    }

    @Test
    fun parameterizedDestinationsAreHiddenFromNav() {
        Destinations.all.filter { it.isParameterized }.forEach { assertFalse(it.id, it.showInNav) }
    }

    @Test
    fun standaloneDestinationsAreHiddenFromNav() {
        Destinations.all.filter { it.chrome == Chrome.Standalone }.forEach { assertFalse(it.id, it.showInNav) }
    }

    @Test
    fun publicDestinationsAreStandalone() {
        Destinations.all
            .filter { it.auth == AuthRequirement.Public }
            .forEach { assertEquals(it.id, Chrome.Standalone, it.chrome) }
    }

    @Test
    fun everyNavGroupHasALead() {
        NavGroup.entries.forEach { group ->
            assertTrue(group.name, RouteTable.groupLeads.containsKey(group))
        }
    }
}
