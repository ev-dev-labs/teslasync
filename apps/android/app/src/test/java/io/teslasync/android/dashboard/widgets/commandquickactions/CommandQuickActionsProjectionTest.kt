package io.teslasync.android.dashboard.widgets.commandquickactions

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the CommandQuickActionsWidget's pure logic — the footprint flags, the
 * registry metadata, the command catalog (order + backend action names), the grid projection
 * (visible-count / column-count / label visibility / per-button `isRunning` + the
 * `disabled={!!activeCommand}` gate), and the cache-then-network scope mapper. Mirrors the web spec
 * (web/src/features/dashboard/widgets/CommandQuickActionsWidget.tsx) and the sibling ChargeStatusLive
 * parity tests.
 */
class CommandQuickActionsProjectionTest {
    private fun strings(): CommandQuickActionsStrings =
        CommandQuickActionsStrings(
            title = "Quick Actions",
            emptyMessage = "No vehicle selected",
            lock = "Lock",
            unlock = "Unlock",
            climateOn = "Climate On",
            climateOff = "Climate Off",
            frunk = "Frunk",
            horn = "Horn",
            flash = "Flash lights",
            trunk = "Trunk",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = { "" },
        )

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.fromEpochMilliseconds(0L),
            displayName = "Car $id",
            enrolledAt = Instant.fromEpochMilliseconds(0L),
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = Instant.fromEpochMilliseconds(0L),
            vin = "VIN$id",
        )

    // ---- registry metadata ----------------------------------------------------------

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("command-quick-actions", CommandQuickActionsRegistration.ID)
        assertEquals("commands", CommandQuickActionsRegistration.CATEGORY)
        assertEquals("CommandQuickActionsWidget", CommandQuickActionsRegistration.SLUG)
        assertEquals(CommandQuickActionsSize(cols = 2, rows = 2), CommandQuickActionsRegistration.defaultSize)
        assertEquals(CommandQuickActionsSize(cols = 1, rows = 2), CommandQuickActionsRegistration.minSize)
        assertEquals(CommandQuickActionsSize(cols = 4, rows = 40), CommandQuickActionsRegistration.maxSize)
    }

    @Test
    fun isWithinBoundsAndClampHonourFootprint() {
        assertTrue(CommandQuickActionsRegistration.isWithinBounds(CommandQuickActionsSize(cols = 2, rows = 2)))
        assertFalse(CommandQuickActionsRegistration.isWithinBounds(CommandQuickActionsSize(cols = 0, rows = 1)))
        assertFalse(CommandQuickActionsRegistration.isWithinBounds(CommandQuickActionsSize(cols = 5, rows = 50)))
        assertEquals(
            CommandQuickActionsSize(cols = 1, rows = 2),
            CommandQuickActionsRegistration.clamp(CommandQuickActionsSize(cols = 0, rows = 0)),
        )
        assertEquals(
            CommandQuickActionsSize(cols = 4, rows = 40),
            CommandQuickActionsRegistration.clamp(CommandQuickActionsSize(cols = 9, rows = 99)),
        )
    }

    @Test
    fun sizeFlagsMatchWebBreakpoints() {
        assertTrue(CommandQuickActionsSize(cols = 1, rows = 1).isCompact)
        assertFalse(CommandQuickActionsSize(cols = 1, rows = 1).isWide)
        assertTrue(CommandQuickActionsSize(cols = 3, rows = 2).isWide)
        assertFalse(CommandQuickActionsSize(cols = 3, rows = 2).isCompact)
        assertFalse(CommandQuickActionsSize(cols = 2, rows = 2).isCompact)
        assertFalse(CommandQuickActionsSize(cols = 2, rows = 2).isWide)
    }

    // ---- command catalog -------------------------------------------------------------

    @Test
    fun commandCatalogMatchesWebOrderAndActionNames() {
        assertEquals(8, COMMAND_QUICK_ACTIONS.size)
        assertEquals(
            listOf("lock", "unlock", "climate_on", "climate_off", "actuate_frunk", "honk_horn", "flash_lights", "actuate_trunk"),
            COMMAND_QUICK_ACTIONS.map { it.command },
        )
        assertEquals(
            listOf("lock", "unlock", "climate_on", "climate_off", "frunk", "honk", "flash", "trunk"),
            COMMAND_QUICK_ACTIONS.map { it.id },
        )
    }

    @Test
    fun labelForMapsEveryKey() {
        val s = strings()
        assertEquals("Lock", s.labelFor(CommandLabelKey.Lock))
        assertEquals("Unlock", s.labelFor(CommandLabelKey.Unlock))
        assertEquals("Climate On", s.labelFor(CommandLabelKey.ClimateOn))
        assertEquals("Climate Off", s.labelFor(CommandLabelKey.ClimateOff))
        assertEquals("Frunk", s.labelFor(CommandLabelKey.Frunk))
        assertEquals("Horn", s.labelFor(CommandLabelKey.Horn))
        assertEquals("Flash lights", s.labelFor(CommandLabelKey.Flash))
        assertEquals("Trunk", s.labelFor(CommandLabelKey.Trunk))
    }

    // ---- grid projection -------------------------------------------------------------

    @Test
    fun compactProjectionShowsFourIconOnlyCommands() {
        val display = CommandQuickActionsProjection.project(CommandQuickActionsSize(cols = 1, rows = 1), null, strings())
        assertTrue(display.isCompact)
        assertFalse(display.showLabels)
        assertEquals(CommandQuickActionsProjection.COMPACT_COLUMNS, display.columns)
        assertEquals(4, display.buttons.size)
        assertEquals(listOf("lock", "unlock", "climate_on", "climate_off"), display.buttons.map { it.command })
        assertFalse(display.anyRunning)
    }

    @Test
    fun defaultProjectionShowsSixLabeledCommands() {
        val display = CommandQuickActionsProjection.project(CommandQuickActionsSize(cols = 2, rows = 2), null, strings())
        assertFalse(display.isCompact)
        assertTrue(display.showLabels)
        assertEquals(CommandQuickActionsProjection.DEFAULT_COLUMNS, display.columns)
        assertEquals(6, display.buttons.size)
        assertEquals("Lock", display.buttons.first().label)
        assertEquals("Lock", display.buttons.first().contentDescription)
        assertEquals("Climate On", display.buttons[2].label)
    }

    @Test
    fun wideProjectionShowsAllEightCommands() {
        val display = CommandQuickActionsProjection.project(CommandQuickActionsSize(cols = 3, rows = 2), null, strings())
        assertTrue(display.isWide)
        assertTrue(display.showLabels)
        assertEquals(CommandQuickActionsProjection.WIDE_COLUMNS, display.columns)
        assertEquals(8, display.buttons.size)
        assertEquals("Trunk", display.buttons.last().label)
    }

    @Test
    fun activeCommandMarksRunningAndDisablesEveryButton() {
        val display = CommandQuickActionsProjection.project(CommandQuickActionsSize(cols = 2, rows = 2), "lock", strings())
        assertTrue(display.anyRunning)
        val lock = display.buttons.single { it.command == "lock" }
        assertTrue(lock.isRunning)
        assertTrue(display.buttons.filter { it.command != "lock" }.none { it.isRunning })
    }

    // ---- scope mapper ----------------------------------------------------------------

    @Test
    fun loadingWithNoCacheStaysLoadingWithNullScope() {
        val mapped = resolveCommandScope(Resource.Loading(cached = null, fetchedAt = null, stale = false), null, null)
        assertTrue(mapped is Resource.Loading)
        assertNull(mapped.cached)
    }

    @Test
    fun successWithVehiclesResolvesFirstId() {
        val mapped = resolveCommandScope(Resource.Success(listOf(vehicle(7), vehicle(9)), 100L, false), null, null)
        assertTrue(mapped is Resource.Success)
        assertEquals(7L, mapped.cached?.vehicleId)
        assertTrue(mapped.cached?.hasVehicle == true)
    }

    @Test
    fun successWithEmptyFleetResolvesZeroScope() {
        val mapped = resolveCommandScope(Resource.Success(emptyList(), 100L, false), null, null)
        assertTrue(mapped is Resource.Success)
        assertEquals(0L, mapped.cached?.vehicleId)
        assertFalse(mapped.cached?.hasVehicle == true)
    }

    @Test
    fun explicitVehicleIdWinsOverActiveAndFirst() {
        val mapped = resolveCommandScope(Resource.Success(listOf(vehicle(7)), 100L, false), explicitVehicleId = 42L, activeVehicleId = 9L)
        assertEquals(42L, mapped.cached?.vehicleId)
    }

    @Test
    fun activeVehicleIdUsedWhenNoExplicit() {
        val mapped = resolveCommandScope(Resource.Success(listOf(vehicle(7)), 100L, false), explicitVehicleId = null, activeVehicleId = 9L)
        assertEquals(9L, mapped.cached?.vehicleId)
    }

    @Test
    fun loadingWithActiveIdResolvesScopeEvenWithoutList() {
        val mapped = resolveCommandScope(Resource.Loading(cached = null, fetchedAt = null, stale = false), null, 11L)
        assertTrue(mapped is Resource.Loading)
        assertEquals(11L, mapped.cached?.vehicleId)
    }

    @Test
    fun errorWithCachedListPreservesScopeStaleAndError() {
        val boom = ApiError.Timeout()
        val mapped =
            resolveCommandScope(
                Resource.Error(cached = listOf(vehicle(5)), fetchedAt = 100L, stale = true, error = boom),
                null,
                null,
            )
        assertTrue(mapped is Resource.Error)
        assertEquals(5L, mapped.cached?.vehicleId)
        assertTrue(mapped.stale)
        assertSame(boom, (mapped as Resource.Error).error)
    }
}
