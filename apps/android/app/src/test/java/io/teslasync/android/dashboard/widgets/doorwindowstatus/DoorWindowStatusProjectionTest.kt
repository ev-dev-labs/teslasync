package io.teslasync.android.dashboard.widgets.doorwindowstatus

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
 * JVM unit tests for the framework-free Door & Window Status surface logic: the pure security-snapshot →
 * readout "data adapter" (the door/window parsing reproduced from the web source, including the native
 * boolean vs. string-enum forms and the corner-keyword matching), the readout → display projection (cell
 * tones + localized values, the compact summary badges, and the size-driven compact/tall flags), the
 * empty-snapshot predicate, the active-vehicle resolution, and the registry footprint constraints. These
 * run in the `:android:testReleaseUnitTest` gate with no device.
 */
class DoorWindowStatusProjectionTest {
    private val strings =
        DoorWindowStatusStrings(
            title = "Door & Window Status",
            doors = "Doors",
            windows = "Windows",
            closed = "Closed",
            open = "Open",
            partial = "Partial",
            frontLeft = "Front Left",
            frontRight = "Front Right",
            rearLeft = "Rear Left",
            rearRight = "Rear Right",
            doorsAllClosed = "Doors \u2713",
            doorsOpen = "door(s) open",
            windowsAllClosed = "Windows \u2713",
            windowsOpen = "window(s) open",
            noData = "No door/window data",
        )

    private val fullSize = DoorWindowStatusSize(cols = 2, rows = 2)
    private val compactSize = DoorWindowStatusSize(cols = 1, rows = 1)

    // ── readout: empty / no-snapshot ─────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmptyReadout() {
        assertEquals(DoorWindowReadout.EMPTY, DoorWindowReadout.from(null))
        assertFalse(DoorWindowReadout.from(null).hasData)
    }

    @Test
    fun jsonNullAndNonObjectAreEmptyReadout() {
        assertFalse(DoorWindowReadout.from(JsonNull).hasData)
        assertFalse(DoorWindowReadout.from(JsonPrimitive(7)).hasData)
        assertFalse(DoorWindowReadout.from(buildJsonArray { add(1) }).hasData)
    }

    @Test
    fun emptySnapshotPredicateMatchesWebFalsyBranch() {
        assertTrue(DoorWindowStatusProjection.isEmptySnapshot(null))
        assertTrue(DoorWindowStatusProjection.isEmptySnapshot(JsonNull))
        assertTrue(DoorWindowStatusProjection.isEmptySnapshot(JsonPrimitive("x")))
        assertFalse(DoorWindowStatusProjection.isEmptySnapshot(buildJsonObject { put("door_state", "open") }))
    }

    // ── door parsing: native boolean ─────────────────────────────────────────────
    @Test
    fun doorStateBooleanTrueOpensEveryCorner() {
        val doors = parseDoorStates(JsonPrimitive(true))
        assertTrue(Corner.entries.all { doors.getValue(it) == OpenState.Open })
    }

    @Test
    fun doorStateBooleanFalseClosesEveryCorner() {
        val doors = parseDoorStates(JsonPrimitive(false))
        assertTrue(Corner.entries.all { doors.getValue(it) == OpenState.Closed })
    }

    @Test
    fun doorStateNumberOrNullIsAllUnknown() {
        assertTrue(Corner.entries.all { parseDoorStates(JsonPrimitive(3)).getValue(it) == OpenState.Unknown })
        assertTrue(Corner.entries.all { parseDoorStates(null).getValue(it) == OpenState.Unknown })
        assertTrue(Corner.entries.all { parseDoorStates(JsonNull).getValue(it) == OpenState.Unknown })
    }

    // ── door parsing: string segments ────────────────────────────────────────────
    @Test
    fun doorStateAllClosedTokenClosesEveryCorner() {
        assertTrue(Corner.entries.all { parseDoorStates(JsonPrimitive("all_closed")).getValue(it) == OpenState.Closed })
        assertTrue(Corner.entries.all { parseDoorStates(JsonPrimitive("allclosed")).getValue(it) == OpenState.Closed })
    }

    @Test
    fun doorStateBlankOrCommaOnlyIsAllUnknown() {
        assertTrue(Corner.entries.all { parseDoorStates(JsonPrimitive("")).getValue(it) == OpenState.Unknown })
        assertTrue(Corner.entries.all { parseDoorStates(JsonPrimitive(",")).getValue(it) == OpenState.Unknown })
    }

    @Test
    fun doorStateNonOpenSegmentsStartAllClosed() {
        val doors = parseDoorStates(JsonPrimitive("df_closed,pr_closed"))
        assertTrue(Corner.entries.all { doors.getValue(it) == OpenState.Closed })
    }

    @Test
    fun doorStateDriverPassengerKeywordsMapEachCorner() {
        val doors =
            parseDoorStates(JsonPrimitive("driver_front_open,passenger_front_open,driver_rear_open,passenger_rear_open"))
        assertEquals(OpenState.Open, doors.getValue(Corner.FL))
        assertEquals(OpenState.Open, doors.getValue(Corner.FR))
        assertEquals(OpenState.Open, doors.getValue(Corner.RL))
        assertEquals(OpenState.Open, doors.getValue(Corner.RR))
    }

    @Test
    fun doorStateLeftRightKeywordsMapEachCorner() {
        val doors = parseDoorStates(JsonPrimitive("front_left_open,rear_right_open"))
        assertEquals(OpenState.Open, doors.getValue(Corner.FL))
        assertEquals(OpenState.Closed, doors.getValue(Corner.FR))
        assertEquals(OpenState.Closed, doors.getValue(Corner.RL))
        assertEquals(OpenState.Open, doors.getValue(Corner.RR))
    }

    @Test
    fun doorStateBareOpenOpensEveryCorner() {
        val doors = parseDoorStates(JsonPrimitive("open"))
        assertTrue(Corner.entries.all { doors.getValue(it) == OpenState.Open })
    }

    @Test
    fun doorStateOpenSegmentWithoutCornerKeywordStaysClosed() {
        // "fl_open" carries `open` but no front/rear/left/right/driver/passenger keyword → no corner opens.
        val doors = parseDoorStates(JsonPrimitive("fl_open"))
        assertTrue(Corner.entries.all { doors.getValue(it) == OpenState.Closed })
    }

    // ── window parsing ───────────────────────────────────────────────────────────
    @Test
    fun windowBooleanTrueIsOpenFalseIsClosed() {
        assertEquals(OpenState.Open, parseWindowState(JsonPrimitive(true)))
        assertEquals(OpenState.Closed, parseWindowState(JsonPrimitive(false)))
    }

    @Test
    fun windowStringClosedIsClosed() {
        assertEquals(OpenState.Closed, parseWindowState(JsonPrimitive("closed")))
        assertEquals(OpenState.Closed, parseWindowState(JsonPrimitive("CLOSED")))
    }

    @Test
    fun windowVentOrPartialIsPartial() {
        assertEquals(OpenState.Partial, parseWindowState(JsonPrimitive("vent")))
        assertEquals(OpenState.Partial, parseWindowState(JsonPrimitive("partial")))
        assertEquals(OpenState.Partial, parseWindowState(JsonPrimitive("vented_open")))
    }

    @Test
    fun windowOtherNonEmptyStringIsOpen() {
        assertEquals(OpenState.Open, parseWindowState(JsonPrimitive("open")))
        assertEquals(OpenState.Open, parseWindowState(JsonPrimitive("ajar")))
    }

    @Test
    fun windowEmptyOrNullOrNumberIsUnknown() {
        assertEquals(OpenState.Unknown, parseWindowState(JsonPrimitive("")))
        assertEquals(OpenState.Unknown, parseWindowState(null))
        assertEquals(OpenState.Unknown, parseWindowState(JsonNull))
        assertEquals(OpenState.Unknown, parseWindowState(JsonPrimitive(5)))
    }

    // ── readout: open counts ─────────────────────────────────────────────────────
    @Test
    fun openDoorCountCountsOnlyOpenDoors() {
        val readout = DoorWindowReadout.from(buildJsonObject { put("door_state", "driver_front_open,passenger_rear_open") })
        assertEquals(2, readout.openDoorCount)
    }

    @Test
    fun openWindowCountIncludesOpenAndPartialButNotClosedOrUnknown() {
        val snapshot =
            buildJsonObject {
                put("fd_window", "open")
                put("fp_window", true)
                put("rd_window", "vent")
                put("rp_window", "closed")
            }
        // fd open, fp open, rd partial → 3; rp closed → excluded.
        assertEquals(3, DoorWindowReadout.from(snapshot).openWindowCount)
    }

    @Test
    fun windowCornersMapToFdFpRdRpFields() {
        val snapshot =
            buildJsonObject {
                put("fd_window", "open")
                put("fp_window", "closed")
                put("rd_window", "closed")
                put("rp_window", "vent")
            }
        val readout = DoorWindowReadout.from(snapshot)
        assertEquals(OpenState.Open, readout.windows.getValue(Corner.FL))
        assertEquals(OpenState.Closed, readout.windows.getValue(Corner.FR))
        assertEquals(OpenState.Closed, readout.windows.getValue(Corner.RL))
        assertEquals(OpenState.Partial, readout.windows.getValue(Corner.RR))
    }

    // ── grid status + value labels ───────────────────────────────────────────────
    @Test
    fun gridStatusMapsClosedOkOpenPartialWarningUnknownUnknown() {
        assertEquals(CellStatus.Ok, toGridStatus(OpenState.Closed))
        assertEquals(CellStatus.Warning, toGridStatus(OpenState.Open))
        assertEquals(CellStatus.Warning, toGridStatus(OpenState.Partial))
        assertEquals(CellStatus.Unknown, toGridStatus(OpenState.Unknown))
    }

    @Test
    fun valueLabelMatchesWebStrings() {
        assertEquals("Closed", toValueLabel(OpenState.Closed, strings))
        assertEquals("Open", toValueLabel(OpenState.Open, strings))
        assertEquals("Partial", toValueLabel(OpenState.Partial, strings))
        assertEquals("\u2014", toValueLabel(OpenState.Unknown, strings))
    }

    // ── projection: cells ────────────────────────────────────────────────────────
    @Test
    fun projectionBuildsFourDoorAndFourWindowCellsInCornerOrder() {
        val display = DoorWindowStatusProjection.project(closedSnapshot(), fullSize, strings)
        assertTrue(display.hasData)
        assertEquals(listOf(Corner.FL, Corner.FR, Corner.RL, Corner.RR), display.doorCells.map { it.corner })
        assertEquals(listOf(Corner.FL, Corner.FR, Corner.RL, Corner.RR), display.windowCells.map { it.corner })
        assertEquals(
            listOf("Front Left", "Front Right", "Rear Left", "Rear Right"),
            display.doorCells.map { it.label },
        )
    }

    @Test
    fun allClosedProjectsOkCellsWithClosedValue() {
        val display = DoorWindowStatusProjection.project(closedSnapshot(), fullSize, strings)
        assertTrue(display.doorCells.all { it.status == CellStatus.Ok && it.value == "Closed" })
        assertTrue(display.windowCells.all { it.status == CellStatus.Ok && it.value == "Closed" })
    }

    @Test
    fun openDoorProjectsWarningCellWithOpenValue() {
        val display = DoorWindowStatusProjection.project(buildJsonObject { put("door_state", "driver_front_open") }, fullSize, strings)
        val fl = display.doorCells.first { it.corner == Corner.FL }
        assertEquals(CellStatus.Warning, fl.status)
        assertEquals("Open", fl.value)
    }

    @Test
    fun partialWindowProjectsWarningCellWithPartialValue() {
        val display = DoorWindowStatusProjection.project(buildJsonObject { put("fp_window", "vent") }, fullSize, strings)
        val fr = display.windowCells.first { it.corner == Corner.FR }
        assertEquals(CellStatus.Warning, fr.status)
        assertEquals("Partial", fr.value)
    }

    @Test
    fun unknownCornerProjectsUnknownCellWithDash() {
        val display = DoorWindowStatusProjection.project(buildJsonObject { put("door_state", JsonNull) }, fullSize, strings)
        assertTrue(display.doorCells.all { it.status == CellStatus.Unknown && it.value == "\u2014" })
    }

    // ── projection: compact summary badges ───────────────────────────────────────
    @Test
    fun badgesAllClosedAreSuccessWithCheckText() {
        val display = DoorWindowStatusProjection.project(closedSnapshot(), compactSize, strings)
        assertTrue(display.compact)
        assertFalse(display.doorBadge.isWarning)
        assertEquals("Doors \u2713", display.doorBadge.text)
        assertFalse(display.windowBadge.isWarning)
        assertEquals("Windows \u2713", display.windowBadge.text)
    }

    @Test
    fun badgesWithOpeningsAreWarningWithCount() {
        val snapshot =
            buildJsonObject {
                put("door_state", "driver_front_open,passenger_rear_open")
                put("fd_window", "open")
            }
        val display = DoorWindowStatusProjection.project(snapshot, compactSize, strings)
        assertTrue(display.doorBadge.isWarning)
        assertEquals("2 door(s) open", display.doorBadge.text)
        assertTrue(display.windowBadge.isWarning)
        assertEquals("1 window(s) open", display.windowBadge.text)
    }

    @Test
    fun badgeHelpersFormatMatchWeb() {
        assertEquals("Doors \u2713", DoorWindowStatusProjection.doorBadge(0, strings).text)
        assertEquals("3 door(s) open", DoorWindowStatusProjection.doorBadge(3, strings).text)
        assertEquals("Windows \u2713", DoorWindowStatusProjection.windowBadge(0, strings).text)
        assertEquals("1 window(s) open", DoorWindowStatusProjection.windowBadge(1, strings).text)
    }

    // ── projection: size-driven flags ────────────────────────────────────────────
    @Test
    fun compactAndTallFlagsComeFromSize() {
        assertTrue(DoorWindowStatusProjection.project(closedSnapshot(), compactSize, strings).compact)
        assertFalse(DoorWindowStatusProjection.project(closedSnapshot(), compactSize, strings).tall)
        assertFalse(DoorWindowStatusProjection.project(closedSnapshot(), fullSize, strings).compact)
        assertTrue(DoorWindowStatusProjection.project(closedSnapshot(), fullSize, strings).tall)
        assertFalse(DoorWindowStatusProjection.project(closedSnapshot(), DoorWindowStatusSize(2, 1), strings).tall)
    }

    // ── projection: empty / content description ──────────────────────────────────
    @Test
    fun emptySnapshotHasNoDataButStillComputesCells() {
        val display = DoorWindowStatusProjection.project(JsonNull, fullSize, strings)
        assertFalse(display.hasData)
        assertEquals(4, display.doorCells.size)
        assertEquals(4, display.windowCells.size)
        assertEquals("Door & Window Status", display.contentDescription)
    }

    @Test
    fun contentDescriptionFoldsSectionsWhenFull() {
        val display = DoorWindowStatusProjection.project(closedSnapshot(), fullSize, strings)
        assertEquals(
            "Door & Window Status, Doors, Front Left, Closed, Front Right, Closed, Rear Left, Closed, " +
                "Rear Right, Closed, Windows, Front Left, Closed, Front Right, Closed, Rear Left, Closed, " +
                "Rear Right, Closed",
            display.contentDescription,
        )
    }

    @Test
    fun contentDescriptionFoldsBadgesWhenCompact() {
        val display = DoorWindowStatusProjection.project(closedSnapshot(), compactSize, strings)
        assertEquals("Door & Window Status, Doors \u2713, Windows \u2713", display.contentDescription)
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("door-window-status", DoorWindowStatusRegistration.ID)
        assertEquals("security", DoorWindowStatusRegistration.CATEGORY)
        assertEquals("DoorWindowStatusWidget", DoorWindowStatusRegistration.SLUG)
        assertEquals(DoorWindowStatusSize(2, 2), DoorWindowStatusRegistration.DEFAULT_SIZE)
        assertEquals(DoorWindowStatusSize(1, 2), DoorWindowStatusRegistration.MIN_SIZE)
        assertEquals(DoorWindowStatusSize(4, 40), DoorWindowStatusRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsAndClamp() {
        assertTrue(DoorWindowStatusRegistration.isWithinBounds(DoorWindowStatusSize(2, 2)))
        assertTrue(DoorWindowStatusRegistration.isWithinBounds(DoorWindowStatusSize(1, 2)))
        assertTrue(DoorWindowStatusRegistration.isWithinBounds(DoorWindowStatusSize(4, 40)))
        assertFalse(DoorWindowStatusRegistration.isWithinBounds(DoorWindowStatusSize(5, 2)))
        assertFalse(DoorWindowStatusRegistration.isWithinBounds(DoorWindowStatusSize(1, 1)))
        assertEquals(DoorWindowStatusSize(4, 40), DoorWindowStatusRegistration.clamp(DoorWindowStatusSize(9, 99)))
        assertEquals(DoorWindowStatusSize(1, 2), DoorWindowStatusRegistration.clamp(DoorWindowStatusSize(0, 0)))
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

    private fun closedSnapshot() =
        buildJsonObject {
            put("door_state", "all_closed")
            put("fd_window", "closed")
            put("fp_window", "closed")
            put("rd_window", "closed")
            put("rp_window", "closed")
        }

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
