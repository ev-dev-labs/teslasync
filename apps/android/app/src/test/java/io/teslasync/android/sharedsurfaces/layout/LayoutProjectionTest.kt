package io.teslasync.android.sharedsurfaces.layout

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destination
import io.teslasync.android.navigation.NavGroup
import io.teslasync.android.navigation.NavSection
import io.teslasync.android.navigation.RouteTable
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.presentation.notifications.Alert
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the pure [LayoutProjection] + model — the cached → projection adapter test
 * the prompt mandates. Covers the web shell's nav-visibility filter (`isVisibleNavItem`), the active-route
 * match (`isActiveNavPath` / `findNavItemByPath`), the pinned + recent resolution, the badge counts, the
 * cache-then-network freshness fold (loading/content/empty/error/stale/offline), the alert-tone, and the
 * shared QueryError recovery bucket. No Android, no coroutines.
 */
class LayoutProjectionTest {
    private val authGated = dest("myActivity", "/me/activity", NavGroup.Settings)
    private val account = section(NavGroup.Settings, dest("settings", "/settings", NavGroup.Settings), authGated)
    private val vehicles =
        section(
            NavGroup.Vehicles,
            dest("vehicles", "/vehicles", NavGroup.Vehicles),
            dest("digitalTwin", "/digital-twin", NavGroup.Vehicles),
        )
    private val charging = section(NavGroup.Charging, dest("charging", "/charging", NavGroup.Charging))
    private val sections = listOf(vehicles, charging, account)

    @Test
    fun authGatedDestinationIsHiddenInOpenModeAndShownUnderForwardAuth() {
        assertFalse(LayoutProjection.isVisible(authGated, isForwardAuth = false))
        assertTrue(LayoutProjection.isVisible(authGated, isForwardAuth = true))
    }

    @Test
    fun visibleSectionsFiltersAuthGatedItemsAndKeepsTheRest() {
        val open = LayoutProjection.visibleSections(sections, isForwardAuth = false)
        val settings = open.single { it.group == NavGroup.Settings }
        assertTrue(settings.items.none { it.id == "myActivity" })
        assertTrue(settings.items.any { it.id == "settings" })

        val authed = LayoutProjection.visibleSections(sections, isForwardAuth = true)
        assertTrue(authed.single { it.group == NavGroup.Settings }.items.any { it.id == "myActivity" })
    }

    @Test
    fun visibleSectionsDropsSectionsLeftEmpty() {
        val onlyGated = listOf(section(NavGroup.Settings, authGated))
        assertTrue(LayoutProjection.visibleSections(onlyGated, isForwardAuth = false).isEmpty())
    }

    @Test
    fun badgesCountVehiclesAndUnreadAlertsAndAreZeroWhileLoading() {
        val loaded =
            LayoutProjection.badges(
                vehicles = content(listOf(vehicle(1), vehicle(2))),
                alerts = content(listOf(alert(1, read = false), alert(2, read = true), alert(3, read = false))),
            )
        assertEquals(2, loaded.vehicleCount)
        assertEquals(2, loaded.unreadAlerts)
        assertTrue(loaded.hasVehicles)
        assertTrue(loaded.hasUnreadAlerts)

        val loading = LayoutProjection.badges(UiState.loading(), UiState.loading())
        assertEquals(0, loading.vehicleCount)
        assertEquals(0, loading.unreadAlerts)
    }

    @Test
    fun alertBadgeTextCollapsesPastTheOverflowCap() {
        assertEquals("3", LayoutBadges(vehicleCount = 0, unreadAlerts = 3).alertBadgeText)
        assertEquals("9+", LayoutBadges(vehicleCount = 0, unreadAlerts = 12).alertBadgeText)
    }

    @Test
    fun freshnessFoldsTheCacheThenNetworkContract() {
        assertEquals(LayoutFreshness.Live, LayoutProjection.freshness(content(listOf(vehicle(1)))))
        assertEquals(
            LayoutFreshness.Stale,
            LayoutProjection.freshness(UiState(UiPhase.Content, data = listOf(vehicle(1)), stale = true, refreshing = true)),
        )
        assertEquals(
            LayoutFreshness.Offline,
            LayoutProjection.freshness(
                UiState(UiPhase.Content, data = listOf(vehicle(1)), stale = true, errorKind = ErrorKind.Network),
            ),
        )
    }

    @Test
    fun isActiveMatchesRootOnlyForRootAndPrefixesForDescendants() {
        assertTrue(LayoutProjection.isActive("/", "/"))
        assertFalse(LayoutProjection.isActive("/charging", "/"))
        assertTrue(LayoutProjection.isActive("/charging", "/charging"))
        assertTrue(LayoutProjection.isActive("/charging/42", "/charging"))
        assertFalse(LayoutProjection.isActive("/charging-curve", "/charging"))
    }

    @Test
    fun activeDestinationAndGroupResolveFromThePath() {
        assertEquals("digitalTwin", LayoutProjection.activeDestination(sections, "/digital-twin")?.id)
        assertEquals(NavGroup.Vehicles, LayoutProjection.activeGroup(sections, "/digital-twin"))
        assertNull(LayoutProjection.activeDestination(sections, "/nowhere"))
    }

    @Test
    fun pinnedDestinationsResolveInOrderAndDropUnknownAndGatedPaths() {
        val pinned = LayoutProjection.pinnedDestinations(sections, listOf("/charging", "/nope", "/vehicles"), isForwardAuth = true)
        assertEquals(listOf("charging", "vehicles"), pinned.map { it.id })

        val gated = LayoutProjection.pinnedDestinations(sections, listOf("/me/activity"), isForwardAuth = false)
        assertTrue(gated.isEmpty())
    }

    @Test
    fun togglePinnedPrependsAndRemoves() {
        val pinnedOnce = LayoutProjection.togglePinned(listOf("/b"), "/a")
        assertEquals(listOf("/a", "/b"), pinnedOnce)
        assertEquals(listOf("/b"), LayoutProjection.togglePinned(pinnedOnce, "/a"))
    }

    @Test
    fun togglePinnedRespectsTheCap() {
        val full = (1..LayoutRegistration.MAX_PINNED).map { "/p$it" }
        val capped = LayoutProjection.togglePinned(full, "/new")
        assertEquals(LayoutRegistration.MAX_PINNED, capped.size)
        assertEquals("/new", capped.first())
    }

    @Test
    fun recentTrackingDedupesCapsAndExcludesTheActivePage() {
        var recent = LayoutProjection.trackRecent(emptyList(), "/charging")
        recent = LayoutProjection.trackRecent(recent, "/vehicles")
        recent = LayoutProjection.trackRecent(recent, "/charging")
        assertEquals(listOf("/charging", "/vehicles"), recent)

        val resolved = LayoutProjection.recentDestinations(sections, recent, activeWebPath = "/charging")
        assertEquals(listOf("vehicles"), resolved.map { it.id })
    }

    @Test
    fun defaultPinnedPathsResolveAgainstTheRealRegistry() {
        val paths = LayoutProjection.defaultPinnedPaths()
        assertEquals(LayoutRegistration.DEFAULT_PINNED_IDS.size, paths.size)
        assertTrue(paths.contains("/"))
        assertTrue(paths.contains("/charging"))
    }

    @Test
    fun latestUnreadAlertReturnsTheFirstUnread() {
        val latest =
            LayoutProjection.latestUnreadAlert(content(listOf(alert(1, read = true), alert(2, read = false), alert(3, read = false))))
        assertEquals(2L, latest?.id)
        assertNull(LayoutProjection.latestUnreadAlert(content(listOf(alert(1, read = true)))))
    }

    @Test
    fun alertToneMapsSeverity() {
        assertEquals(Tone.Danger, LayoutProjection.alertTone("critical"))
        assertEquals(Tone.Warning, LayoutProjection.alertTone("warning"))
        assertEquals(Tone.Info, LayoutProjection.alertTone("info"))
    }

    @Test
    fun queryErrorKindMapsTheRecoveryBucket() {
        assertEquals(QueryErrorKind.Network, LayoutProjection.queryErrorKind(errorState(ErrorKind.Network)))
        assertEquals(QueryErrorKind.Waiting, LayoutProjection.queryErrorKind(errorState(ErrorKind.CircuitOpen)))
        assertEquals(QueryErrorKind.Unauthorized, LayoutProjection.queryErrorKind(httpErrorState(HTTP_UNAUTHORIZED)))
        assertEquals(QueryErrorKind.NotFound, LayoutProjection.queryErrorKind(httpErrorState(HTTP_NOT_FOUND)))
        assertEquals(QueryErrorKind.ServerError, LayoutProjection.queryErrorKind(httpErrorState(HTTP_SERVER_ERROR)))
    }

    @Test
    fun unpinPageFillsTheTemplate() {
        assertEquals("Unpin Charging", deterministicStrings().unpinPage("Charging"))
    }

    @Test
    fun realDrawerSectionsAreNonEmptyAndFilterable() {
        val open = LayoutProjection.visibleSections(RouteTable.drawerSections, isForwardAuth = false)
        assertTrue(open.isNotEmpty())
        assertTrue(open.all { it.items.isNotEmpty() })
    }

    private fun deterministicStrings(): LayoutStrings =
        LayoutStrings(
            primaryNav = "",
            primaryHeader = "",
            openSidebar = "",
            closeSidebar = "",
            current = "",
            pinned = "",
            pinAction = "",
            pinnedAction = "",
            pinCurrent = "",
            unpinCurrent = "",
            unpinPageTemplate = "Unpin %1\$s",
            recentlyUsed = "",
            sections = "",
            expandAll = "",
            collapseAll = "",
            quickSearchHint = "",
            openThemePicker = "",
            customize = "",
            alertTitle = "",
            viewAction = "",
            notifications = "",
            loading = "",
            stale = "",
            offline = "",
            noVehiclesTitle = "",
            noVehiclesMessage = "",
        )

    private fun <T> content(value: T): UiState<T> = UiState(UiPhase.Content, data = value, fetchedAt = STAMP)

    private fun errorState(kind: ErrorKind): UiState<List<Vehicle>> = UiState(UiPhase.Error, errorKind = kind)

    private fun httpErrorState(status: Int): UiState<List<Vehicle>> =
        UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = status)

    private fun dest(
        id: String,
        path: String,
        group: NavGroup,
    ): Destination = Destination(id = id, webPath = path, group = group)

    private fun section(
        group: NavGroup,
        vararg items: Destination,
    ): NavSection = NavSection(group, items.toList())

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochSeconds(0),
            displayName = "Car $id",
            enrolledAt = Instant.fromEpochSeconds(0),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochSeconds(0),
            vin = "VIN$id",
        )

    private fun alert(
        id: Long,
        read: Boolean,
    ): Alert = Alert(id = id, isRead = read, severity = "info")

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 500
    }
}
