// Off-device verification of the LayoutBreadcrumbs surface's pure logic — the native mirror of every decision the
// web breadcrumb graph makes before it paints (web/src/hooks/useBreadcrumbs.ts, web/src/lib/routeMeta.ts,
// web/src/components/layout/Breadcrumbs.tsx): the parent-chain walk, the override-then-title label resolution, the
// `{{param}}` / `{arg}` substitution, and the `items.length <= 1` self-suppression. Because the composable is a
// thin render layer over these functions, the per-branch assertions here double as the surface's state coverage.
// Runs in the :app:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.layoutbreadcrumbs

import io.teslasync.android.navigation.Destinations
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutBreadcrumbsModelTest {
    private fun titleOf(id: String): String = "title:$id"

    // ── breadcrumbChainIds: the web `while (current)` parent walk ────────────────────────────────────────────────

    @Test
    fun topLevelPageHasASingleItemChain() {
        // A page with no parent (web: no PARENT_OVERRIDES entry) yields a one-item chain that self-suppresses.
        assertEquals(listOf("dashboard"), breadcrumbChainIds("dashboard"))
        assertEquals(listOf("charging"), breadcrumbChainIds("charging"))
    }

    @Test
    fun detailPageWalksUpToItsParent() {
        assertEquals(listOf("drives", "driveDetail"), breadcrumbChainIds("driveDetail"))
        assertEquals(listOf("charging", "chargeDetail"), breadcrumbChainIds("chargeDetail"))
        assertEquals(listOf("trips", "tripDetail"), breadcrumbChainIds("tripDetail"))
    }

    @Test
    fun deeplyNestedPageWalksTheWholeChainRootFirst() {
        assertEquals(listOf("drives", "driveDetail", "tripReplay"), breadcrumbChainIds("tripReplay"))
        assertEquals(listOf("vehicles", "vehicleDetail", "vehicleAccess"), breadcrumbChainIds("vehicleAccess"))
    }

    @Test
    fun pageWhoseExplicitParentIsTheDashboardIncludesIt() {
        // Web `/me/activity` -> `/` : the only chain that surfaces the dashboard as a crumb.
        assertEquals(listOf("dashboard", "myActivity"), breadcrumbChainIds("myActivity"))
    }

    @Test
    fun unknownRouteIdYieldsNoChain() {
        // Web `useBreadcrumbs` returns [] for an unmatched route.
        assertEquals(emptyList<String>(), breadcrumbChainIds("nope-not-a-real-id"))
    }

    // ── buildBreadcrumbTrail: label resolution, leaf link, concrete routes ───────────────────────────────────────

    @Test
    fun trailUsesTitlesAndLeavesTheCurrentCrumbUnlinked() {
        val trail = buildBreadcrumbTrail("driveDetail", emptyMap(), emptyMap(), ::titleOf)

        assertEquals(2, trail.size)
        assertEquals("drives", trail[0].destinationId)
        assertEquals("title:drives", trail[0].label)
        assertEquals("drives", trail[0].route)
        assertEquals("title:driveDetail", trail[1].label)
        assertNull("the current crumb carries no link (web href undefined)", trail[1].route)
        assertTrue(trail[1].isCurrent)
    }

    @Test
    fun overrideLabelBeatsTheTitleForTheMatchingCrumb() {
        val overrides = mapOf("driveDetail" to "Trip to office")
        val trail = buildBreadcrumbTrail("driveDetail", emptyMap(), overrides, ::titleOf)

        assertEquals("Trip to office", trail[1].label)
        // Ancestors without an override fall back to the resolved title.
        assertEquals("title:drives", trail[0].label)
    }

    @Test
    fun labelTokensAreSubstitutedFromRouteArgs() {
        val overrides = mapOf("driveDetail" to "Drive #{{id}}")
        val trail = buildBreadcrumbTrail("driveDetail", mapOf("id" to "4421"), overrides, ::titleOf)

        assertEquals("Drive #4421", trail[1].label)
    }

    @Test
    fun ancestorRoutesAreFilledWithConcreteArgs() {
        val trail = buildBreadcrumbTrail("vehicleAccess", mapOf("id" to "42"), emptyMap(), ::titleOf)

        assertEquals(listOf("vehicles", "vehicleDetail", "vehicleAccess"), trail.map { it.destinationId })
        assertEquals("vehicles", trail[0].route)
        assertEquals("vehicles/42", trail[1].route)
        assertNull(trail[2].route)
    }

    // ── classifyBreadcrumbs: the web `items.length <= 1 ? null : <nav>` split ─────────────────────────────────────

    @Test
    fun chainsOfOneOrZeroSuppressTheTrail() {
        assertTrue(classifyBreadcrumbs(emptyList()) is BreadcrumbsSurface.Suppressed)
        assertTrue(classifyBreadcrumbs(crumbs(1)) is BreadcrumbsSurface.Suppressed)
    }

    @Test
    fun chainsOfTwoOrMoreRenderATrail() {
        val surface = classifyBreadcrumbs(crumbs(2))
        assertTrue(surface is BreadcrumbsSurface.Trail)
        assertEquals(2, (surface as BreadcrumbsSurface.Trail).items.size)
    }

    // ── concreteRoute + substituteParams helpers ─────────────────────────────────────────────────────────────────

    @Test
    fun concreteRouteFillsKnownSlotsAndIgnoresAbsentArgs() {
        val detail = Destinations.require("vehicleDetail")
        assertEquals("vehicles/7", concreteRoute(detail, mapOf("id" to "7")))
        // A missing arg leaves the slot untouched (web `replace` no-op), never throwing.
        assertEquals("vehicles/{id}", concreteRoute(detail, emptyMap()))
    }

    @Test
    fun substituteParamsReplacesEveryTokenAndLeavesPlainLabelsAlone() {
        assertEquals("Drive #9", substituteParams("Drive #{{id}}", mapOf("id" to "9")))
        assertEquals("Vehicles", substituteParams("Vehicles", mapOf("id" to "9")))
    }

    // ── parent-map integrity (the web routeMeta unit test's role) ────────────────────────────────────────────────

    @Test
    fun everyParentMapEndpointIsAKnownDestination() {
        for ((child, parent) in BREADCRUMB_PARENTS) {
            assertNotNull("child '$child' must be a real destination", Destinations.find(child))
            assertNotNull("parent '$parent' must be a real destination", Destinations.find(parent))
        }
    }

    @Test
    fun everyParentMapEntryProducesARenderableTwoPlusItemChain() {
        for (child in BREADCRUMB_PARENTS.keys) {
            val chain = breadcrumbChainIds(child)
            assertTrue("'$child' should render a trail", chain.size >= 2)
            assertEquals("the chain must end at the page itself", child, chain.last())
        }
    }

    // ── i18n key contract (P1/S10) ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun i18nKeyInventoryMatchesTheWebContract() {
        assertEquals(listOf("a11y.breadcrumb", "a11y.breadcrumbHome"), LayoutBreadcrumbsKeys.ALL)
        assertEquals(LayoutBreadcrumbsKeys.ALL.size, LayoutBreadcrumbsKeys.ALL.toSet().size)
    }

    private fun crumbs(count: Int): List<BreadcrumbItem> =
        (0 until count).map { BreadcrumbItem(destinationId = "id$it", label = "Crumb $it", route = "r$it") }
}
