package io.teslasync.android.dashboard.widgets.securitystatus

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * JVM unit tests for the framework-free Security Status surface logic: the pure security-snapshot → readout
 * "data adapter" (the door/window/lock/sentry parsing reproduced from the web source, including the native
 * boolean vs. string-enum forms), the readout → display projection (cell tones + localized values), the
 * empty-snapshot predicate, the active-vehicle resolution, and the registry footprint constraints. These
 * run in the `:android:testReleaseUnitTest` gate with no device.
 */
class SecurityStatusProjectionTest {
    private val strings =
        SecurityStatusStrings(
            security = "Security",
            lock = "Lock",
            locked = "Locked",
            unlocked = "Unlocked",
            sentry = "Sentry",
            active = "Active",
            off = "Off",
            doors = "Doors",
            windows = "Windows",
            allClosed = "All Closed",
            open = "Open",
        )

    // ── readout: empty / no-snapshot ─────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmptyReadout() {
        assertEquals(SecurityReadout.EMPTY, SecurityReadout.from(null))
        assertFalse(SecurityReadout.from(null).hasData)
    }

    @Test
    fun jsonNullAndNonObjectAreEmptyReadout() {
        assertFalse(SecurityReadout.from(JsonNull).hasData)
        assertFalse(SecurityReadout.from(JsonPrimitive(7)).hasData)
        assertFalse(SecurityReadout.from(buildJsonArray { add(1) }).hasData)
    }

    @Test
    fun emptySnapshotPredicateMatchesWebFalsyBranch() {
        assertTrue(SecurityStatusProjection.isEmptySnapshot(null))
        assertTrue(SecurityStatusProjection.isEmptySnapshot(JsonNull))
        assertTrue(SecurityStatusProjection.isEmptySnapshot(JsonPrimitive("x")))
        assertFalse(SecurityStatusProjection.isEmptySnapshot(buildJsonObject { put("locked", true) }))
    }

    // ── readout: lock / sentry booleans ──────────────────────────────────────────
    @Test
    fun lockAndSentryReadFromBooleans() {
        val readout =
            SecurityReadout.from(
                buildJsonObject {
                    put("locked", true)
                    put("sentry_mode", true)
                },
            )
        assertTrue(readout.hasData)
        assertTrue(readout.locked)
        assertTrue(readout.sentryMode)
    }

    @Test
    fun missingOrNonBooleanLockReadsUnlocked() {
        assertFalse(SecurityReadout.from(buildJsonObject { put("vehicle_id", 1) }).locked)
        assertFalse(SecurityReadout.from(buildJsonObject { put("locked", JsonNull) }).locked)
        assertFalse(SecurityReadout.from(buildJsonObject { put("sentry_mode", false) }).sentryMode)
    }

    // ── readout: door parsing (web door_state logic) ──────────────────────────────
    @Test
    fun doorStateNativeBooleanTrueIsOneOpen() {
        assertEquals(1, SecurityReadout.from(buildJsonObject { put("door_state", true) }).openDoorCount)
    }

    @Test
    fun doorStateNativeBooleanFalseIsNoneOpen() {
        assertEquals(0, SecurityReadout.from(buildJsonObject { put("door_state", false) }).openDoorCount)
    }

    @Test
    fun doorStateStringCountsOnlyOpenSegments() {
        assertEquals(0, openDoorCount(JsonPrimitive("df_closed,pr_closed")))
        assertEquals(1, openDoorCount(JsonPrimitive("df_open, pr_closed")))
        assertEquals(2, openDoorCount(JsonPrimitive("fl_OPEN,fr_open,rl_closed")))
    }

    @Test
    fun doorStateBlankOrMissingIsNoneOpen() {
        assertEquals(0, openDoorCount(JsonPrimitive("")))
        assertEquals(0, openDoorCount(null))
        assertEquals(0, openDoorCount(JsonNull))
    }

    // ── readout: window parsing (web fd/fp/rd/rp logic) ───────────────────────────
    @Test
    fun windowBooleanTrueIsOpenFalseIsClosed() {
        assertTrue(windowIsOpen(JsonPrimitive(true)))
        assertFalse(windowIsOpen(JsonPrimitive(false)))
    }

    @Test
    fun windowStringIsOpenUnlessClosed() {
        assertTrue(windowIsOpen(JsonPrimitive("open")))
        assertTrue(windowIsOpen(JsonPrimitive("vent")))
        assertFalse(windowIsOpen(JsonPrimitive("closed")))
        assertFalse(windowIsOpen(JsonPrimitive("CLOSED")))
        assertFalse(windowIsOpen(JsonPrimitive("")))
    }

    @Test
    fun windowMissingOrNullIsClosed() {
        assertFalse(windowIsOpen(null))
        assertFalse(windowIsOpen(JsonNull))
    }

    @Test
    fun openWindowCountSumsAllFourCorners() {
        val snapshot =
            buildJsonObject {
                put("fd_window", "open")
                put("fp_window", true)
                put("rd_window", "closed")
                put("rp_window", false)
            }
        assertEquals(2, SecurityReadout.from(snapshot).openWindowCount)
    }

    // ── projection: cells / tones / values ────────────────────────────────────────
    @Test
    fun healthyStateProjectsFourOkCells() {
        val snapshot =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", true)
                put("door_state", "df_closed")
                put("fd_window", "closed")
                put("fp_window", "closed")
                put("rd_window", "closed")
                put("rp_window", "closed")
            }
        val display = SecurityStatusProjection.project(snapshot, strings)

        assertTrue(display.hasData)
        assertEquals(4, display.cells.size)
        assertEquals(
            listOf(SecurityCellKind.Lock, SecurityCellKind.Sentry, SecurityCellKind.Doors, SecurityCellKind.Windows),
            display.cells.map { it.kind },
        )
        assertTrue(display.cells.all { it.status == CellStatus.Ok })
        assertEquals("Locked", cellOf(display, SecurityCellKind.Lock).value)
        assertEquals("Active", cellOf(display, SecurityCellKind.Sentry).value)
        assertEquals("All Closed", cellOf(display, SecurityCellKind.Doors).value)
        assertEquals("All Closed", cellOf(display, SecurityCellKind.Windows).value)
    }

    @Test
    fun unlockedProjectsErrorCellWithUnlockedValue() {
        val display = SecurityStatusProjection.project(buildJsonObject { put("locked", false) }, strings)
        val lock = cellOf(display, SecurityCellKind.Lock)
        assertEquals(CellStatus.Error, lock.status)
        assertEquals("Unlocked", lock.value)
        assertEquals("Lock", lock.label)
    }

    @Test
    fun sentryOffProjectsInactiveCellWithOffValue() {
        val display = SecurityStatusProjection.project(buildJsonObject { put("sentry_mode", false) }, strings)
        val sentry = cellOf(display, SecurityCellKind.Sentry)
        assertEquals(CellStatus.Inactive, sentry.status)
        assertEquals("Off", sentry.value)
    }

    @Test
    fun openDoorsProjectWarningCellWithCount() {
        val display = SecurityStatusProjection.project(buildJsonObject { put("door_state", "fl_open,fr_open") }, strings)
        val doors = cellOf(display, SecurityCellKind.Doors)
        assertEquals(CellStatus.Warning, doors.status)
        assertEquals("2 Open", doors.value)
    }

    @Test
    fun openWindowProjectsWarningCellWithCount() {
        val display = SecurityStatusProjection.project(buildJsonObject { put("fd_window", "open") }, strings)
        val windows = cellOf(display, SecurityCellKind.Windows)
        assertEquals(CellStatus.Warning, windows.status)
        assertEquals("1 Open", windows.value)
    }

    @Test
    fun emptySnapshotProjectsNoCells() {
        val display = SecurityStatusProjection.project(JsonNull, strings)
        assertFalse(display.hasData)
        assertTrue(display.cells.isEmpty())
        assertEquals("Security", display.contentDescription)
    }

    @Test
    fun contentDescriptionFoldsTitleAndEveryCell() {
        val snapshot =
            buildJsonObject {
                put("locked", true)
                put("sentry_mode", false)
                put("door_state", "df_closed")
                put("fd_window", "closed")
            }
        val display = SecurityStatusProjection.project(snapshot, strings)
        assertEquals(
            "Security, Lock, Locked, Sentry, Off, Doors, All Closed, Windows, All Closed",
            display.contentDescription,
        )
    }

    @Test
    fun openSummaryMatchesWebFormat() {
        assertEquals("All Closed", SecurityStatusProjection.openSummary(0, strings))
        assertEquals("1 Open", SecurityStatusProjection.openSummary(1, strings))
        assertEquals("3 Open", SecurityStatusProjection.openSummary(3, strings))
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("security-status", SecurityStatusRegistration.ID)
        assertEquals("security", SecurityStatusRegistration.CATEGORY)
        assertEquals("SecurityStatusWidget", SecurityStatusRegistration.SLUG)
        assertEquals(SecurityStatusSize(1, 2), SecurityStatusRegistration.DEFAULT_SIZE)
        assertEquals(SecurityStatusSize(1, 2), SecurityStatusRegistration.MIN_SIZE)
        assertEquals(SecurityStatusSize(2, 40), SecurityStatusRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsAndClamp() {
        assertTrue(SecurityStatusRegistration.isWithinBounds(SecurityStatusSize(1, 2)))
        assertTrue(SecurityStatusRegistration.isWithinBounds(SecurityStatusSize(2, 40)))
        assertFalse(SecurityStatusRegistration.isWithinBounds(SecurityStatusSize(3, 2)))
        assertFalse(SecurityStatusRegistration.isWithinBounds(SecurityStatusSize(1, 1)))
        assertEquals(SecurityStatusSize(2, 40), SecurityStatusRegistration.clamp(SecurityStatusSize(9, 99)))
        assertEquals(SecurityStatusSize(1, 2), SecurityStatusRegistration.clamp(SecurityStatusSize(0, 0)))
    }

    // ── active-vehicle resolution ────────────────────────────────────────────────
    @Test
    fun resolvesPreferredThenFirstThenNull() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(3))))
        assertEquals(3L, resolveVehicleId(null, listOf(vehicle(3), vehicle(4))))
        assertEquals(3L, resolveVehicleId(0L, listOf(vehicle(3))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    private fun cellOf(
        display: SecurityStatusDisplay,
        kind: SecurityCellKind,
    ): SecurityCell = display.cells.first { it.kind == kind }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
