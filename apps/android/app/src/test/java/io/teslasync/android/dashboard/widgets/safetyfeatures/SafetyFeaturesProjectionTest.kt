package io.teslasync.android.dashboard.widgets.safetyfeatures

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * JVM unit tests for the framework-free Safety Features surface logic: the safety-snapshot → display
 * projection (the "data adapter"), the web `lib/safetyEnum.ts` port (`cleanSafetyEnum` /
 * `isSafetyEnumActive` — boolean / number / typed-enum / codec-stripped shapes, prefix stripping, the
 * SpeedAssistLevelNone → Off special case), the bool / inverted-bool / enum status mapping, the
 * `buildCells` ordering + values + statuses, the active-count, the empty-snapshot predicate, the registry
 * footprint constraints, and the active-vehicle resolution. These run in the `:android:testReleaseUnitTest`
 * gate with no device, mirroring the web spec (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx).
 */
class SafetyFeaturesProjectionTest {
    private fun strings(): SafetyStrings =
        SafetyStrings(
            fcw = "Forward Collision Warning",
            aeb = "Auto Emergency Braking",
            lda = "Lane Departure Avoidance",
            elda = "Emergency Lane Departure",
            bsc = "Blind Spot Camera",
            bscw = "Blind Spot Collision Warning",
            slw = "Speed Limit Warning",
            cfd = "Cruise Follow Distance",
            enabled = "Enabled",
            disabled = "Disabled",
            title = "Safety Features",
            activeFeatures = "Active Features",
            noData = "No safety data",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatRelative = { "" },
        )

    private fun cell(
        display: SafetyFeaturesDisplay,
        id: String,
    ): SafetyCell = display.cells.first { it.id == id }

    // ── empty / no-snapshot ─────────────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmpty() {
        val display = SafetyFeaturesProjection.project(null, strings())
        assertFalse(display.hasData)
        assertTrue(display.cells.isEmpty())
        assertEquals(0, display.activeCount)
    }

    @Test
    fun jsonNullAndNonObjectSnapshotsAreEmpty() {
        assertTrue(SafetyFeaturesProjection.isEmptySnapshot(JsonNull))
        assertTrue(SafetyFeaturesProjection.isEmptySnapshot(JsonPrimitive(5)))
        assertTrue(SafetyFeaturesProjection.isEmptySnapshot(null))
        assertFalse(SafetyFeaturesProjection.project(JsonNull, strings()).hasData)
    }

    @Test
    fun objectSnapshotIsNotEmpty() {
        assertFalse(SafetyFeaturesProjection.isEmptySnapshot(buildJsonObject { put("forward_collision_warning", "On") }))
    }

    // ── content / buildCells ─────────────────────────────────────────────────────
    @Test
    fun projectsEightCellsInWebOrder() {
        val display = SafetyFeaturesProjection.project(buildJsonObject { }, strings())
        assertTrue(display.hasData)
        assertEquals(
            listOf("fcw", "aeb", "lda", "elda", "bsc", "bscw", "slw", "cfd"),
            display.cells.map { it.id },
        )
    }

    @Test
    fun projectsMixedSnapshotValuesStatusesAndActiveCount() {
        val snapshot =
            buildJsonObject {
                put("forward_collision_warning", "ForwardCollisionSensitivityMedium")
                put("automatic_emergency_braking_off", false)
                put("lane_departure_avoidance", "LaneAssistLevelNone")
                put("emergency_lane_departure_avoidance", true)
                put("blind_spot_collision_warning", false)
                put("speed_limit_warning", "SpeedAssistLevelNone")
                put("cruise_follow_distance", "FollowDistance3")
                // automatic_blind_spot_camera intentionally absent → Unknown / em dash.
            }
        val display = SafetyFeaturesProjection.project(snapshot, strings())

        // Forward collision warning: prefix stripped, active.
        assertEquals("Medium", cell(display, "fcw").value)
        assertEquals(SafetyStatus.Ok, cell(display, "fcw").status)
        // AEB "off" flag false → Enabled / Ok (inverted).
        assertEquals("Enabled", cell(display, "aeb").value)
        assertEquals(SafetyStatus.Ok, cell(display, "aeb").status)
        // Lane departure "None" stays "None" (not the SLW special case) and is inactive.
        assertEquals("None", cell(display, "lda").value)
        assertEquals(SafetyStatus.Inactive, cell(display, "lda").status)
        // Emergency lane departure true → Enabled / Ok.
        assertEquals("Enabled", cell(display, "elda").value)
        assertEquals(SafetyStatus.Ok, cell(display, "elda").status)
        // Blind spot camera absent → em dash / Unknown.
        assertEquals(EM_DASH, cell(display, "bsc").value)
        assertEquals(SafetyStatus.Unknown, cell(display, "bsc").status)
        // Blind spot collision warning false → Disabled / Inactive.
        assertEquals("Disabled", cell(display, "bscw").value)
        assertEquals(SafetyStatus.Inactive, cell(display, "bscw").status)
        // Speed limit warning SpeedAssistLevelNone → "Off" (SLW special case) / Inactive.
        assertEquals("Off", cell(display, "slw").value)
        assertEquals(SafetyStatus.Inactive, cell(display, "slw").status)
        // Cruise follow distance FollowDistance3 → "3" / Ok.
        assertEquals("3", cell(display, "cfd").value)
        assertEquals(SafetyStatus.Ok, cell(display, "cfd").status)

        // Active = fcw, aeb, elda, cfd.
        assertEquals(4, display.activeCount)
    }

    @Test
    fun booleanTypedEnumFieldRendersOnOff() {
        val on = SafetyFeaturesProjection.project(buildJsonObject { put("forward_collision_warning", true) }, strings())
        assertEquals("On", cell(on, "fcw").value)
        assertEquals(SafetyStatus.Ok, cell(on, "fcw").status)

        val off = SafetyFeaturesProjection.project(buildJsonObject { put("forward_collision_warning", false) }, strings())
        assertEquals("Off", cell(off, "fcw").value)
        assertEquals(SafetyStatus.Inactive, cell(off, "fcw").status)
    }

    // ── cleanSafetyEnum (lib/safetyEnum.ts parity) ───────────────────────────────
    @Test
    fun cleanSafetyEnumBooleanRendersOnOff() {
        assertEquals("On", cleanSafetyEnum(JsonPrimitive(true), SafetyEnumField.ForwardCollisionWarning))
        assertEquals("Off", cleanSafetyEnum(JsonPrimitive(false), SafetyEnumField.ForwardCollisionWarning))
    }

    @Test
    fun cleanSafetyEnumNumberRendersJsDecimal() {
        assertEquals("3", cleanSafetyEnum(JsonPrimitive(3.0), SafetyEnumField.CruiseFollowDistance))
        assertEquals("3.5", cleanSafetyEnum(JsonPrimitive(3.5), SafetyEnumField.CruiseFollowDistance))
        assertEquals("0", cleanSafetyEnum(JsonPrimitive(0.0), SafetyEnumField.CruiseFollowDistance))
    }

    @Test
    fun cleanSafetyEnumStripsPrefixAndCollapsesSpeedNone() {
        assertEquals("3", cleanSafetyEnum(JsonPrimitive("FollowDistance3"), SafetyEnumField.CruiseFollowDistance))
        assertEquals("Chime", cleanSafetyEnum(JsonPrimitive("SpeedAssistLevelChime"), SafetyEnumField.SpeedLimitWarning))
        // SpeedAssistLevelNone collapses to "Off"; the same suffix on another field does not.
        assertEquals("Off", cleanSafetyEnum(JsonPrimitive("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning))
        assertEquals("None", cleanSafetyEnum(JsonPrimitive("LaneAssistLevelNone"), SafetyEnumField.LaneDepartureAvoidance))
    }

    @Test
    fun cleanSafetyEnumPassesThroughUnprefixedAndFallsBack() {
        // A value that does not carry the field prefix is returned verbatim (web parity).
        assertEquals("Late", cleanSafetyEnum(JsonPrimitive("Late"), SafetyEnumField.CruiseFollowDistance))
        // Absent / JsonNull / empty string → fallback.
        assertEquals(EM_DASH, cleanSafetyEnum(null, SafetyEnumField.ForwardCollisionWarning))
        assertEquals(EM_DASH, cleanSafetyEnum(JsonNull, SafetyEnumField.ForwardCollisionWarning))
        assertEquals(EM_DASH, cleanSafetyEnum(JsonPrimitive(""), SafetyEnumField.ForwardCollisionWarning))
        assertEquals("—custom—", cleanSafetyEnum(null, SafetyEnumField.ForwardCollisionWarning, "—custom—"))
    }

    // ── isSafetyEnumActive (lib/safetyEnum.ts parity) ────────────────────────────
    @Test
    fun isSafetyEnumActiveClassifiesTheInactiveTokenSet() {
        // Inactive tokens (case-insensitive): off / none / disabled / 0.
        assertFalse(isSafetyEnumActive(JsonPrimitive("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning))
        assertFalse(isSafetyEnumActive(JsonPrimitive("Off"), SafetyEnumField.ForwardCollisionWarning))
        assertFalse(isSafetyEnumActive(JsonPrimitive("disabled"), SafetyEnumField.ForwardCollisionWarning))
        assertFalse(isSafetyEnumActive(JsonPrimitive("0"), SafetyEnumField.CruiseFollowDistance))
        assertFalse(isSafetyEnumActive(JsonPrimitive(0.0), SafetyEnumField.CruiseFollowDistance))
        assertFalse(isSafetyEnumActive(JsonPrimitive(false), SafetyEnumField.ForwardCollisionWarning))
        assertFalse(isSafetyEnumActive(null, SafetyEnumField.ForwardCollisionWarning))
        assertFalse(isSafetyEnumActive(JsonNull, SafetyEnumField.ForwardCollisionWarning))
    }

    @Test
    fun isSafetyEnumActiveTrueForRealValues() {
        assertTrue(isSafetyEnumActive(JsonPrimitive("FollowDistance3"), SafetyEnumField.CruiseFollowDistance))
        assertTrue(isSafetyEnumActive(JsonPrimitive(3.0), SafetyEnumField.CruiseFollowDistance))
        assertTrue(isSafetyEnumActive(JsonPrimitive(true), SafetyEnumField.ForwardCollisionWarning))
        assertTrue(isSafetyEnumActive(JsonPrimitive("ForwardCollisionSensitivityHigh"), SafetyEnumField.ForwardCollisionWarning))
    }

    // ── status mapping helpers ───────────────────────────────────────────────────
    @Test
    fun boolStatusAndInvertedBoolStatusMap() {
        assertEquals(SafetyStatus.Unknown, boolStatus(null))
        assertEquals(SafetyStatus.Ok, boolStatus(true))
        assertEquals(SafetyStatus.Inactive, boolStatus(false))

        assertEquals(SafetyStatus.Unknown, invertedBoolStatus(null))
        assertEquals(SafetyStatus.Inactive, invertedBoolStatus(true))
        assertEquals(SafetyStatus.Ok, invertedBoolStatus(false))
    }

    @Test
    fun safetyEnumStatusMapsNullActiveAndInactive() {
        assertEquals(SafetyStatus.Unknown, safetyEnumStatus(null, SafetyEnumField.SpeedLimitWarning))
        assertEquals(SafetyStatus.Unknown, safetyEnumStatus(JsonNull, SafetyEnumField.SpeedLimitWarning))
        assertEquals(SafetyStatus.Ok, safetyEnumStatus(JsonPrimitive("SpeedAssistLevelChime"), SafetyEnumField.SpeedLimitWarning))
        assertEquals(SafetyStatus.Inactive, safetyEnumStatus(JsonPrimitive("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning))
    }

    // ── compact count formatting ─────────────────────────────────────────────────
    @Test
    fun formatCountGroupsThousands() {
        assertEquals("0", SafetyFeaturesProjection.formatCount(0))
        assertEquals("8", SafetyFeaturesProjection.formatCount(8))
        assertEquals("1,234", SafetyFeaturesProjection.formatCount(1234))
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("safety-features", SafetyFeaturesRegistration.ID)
        assertEquals("security", SafetyFeaturesRegistration.CATEGORY)
        assertEquals("SafetyFeaturesWidget", SafetyFeaturesRegistration.SLUG)
        assertEquals(SafetyFeaturesSize(2, 4), SafetyFeaturesRegistration.DEFAULT_SIZE)
        assertEquals(SafetyFeaturesSize(1, 2), SafetyFeaturesRegistration.MIN_SIZE)
        assertEquals(SafetyFeaturesSize(4, 40), SafetyFeaturesRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsClampAndCompactGridColumns() {
        assertTrue(SafetyFeaturesRegistration.isWithinBounds(SafetyFeaturesSize(1, 2)))
        assertTrue(SafetyFeaturesRegistration.isWithinBounds(SafetyFeaturesSize(4, 40)))
        assertFalse(SafetyFeaturesRegistration.isWithinBounds(SafetyFeaturesSize(5, 2)))
        assertFalse(SafetyFeaturesRegistration.isWithinBounds(SafetyFeaturesSize(1, 1)))
        assertEquals(SafetyFeaturesSize(4, 40), SafetyFeaturesRegistration.clamp(SafetyFeaturesSize(9, 99)))
        assertEquals(SafetyFeaturesSize(1, 2), SafetyFeaturesRegistration.clamp(SafetyFeaturesSize(0, 0)))

        // size.cols <= 1 is compact; grid uses 4 columns at >= 3, else 2 (web `size.cols >= 3 ? 4 : 2`).
        assertTrue(SafetyFeaturesSize(1, 2).isCompact)
        assertFalse(SafetyFeaturesSize(2, 4).isCompact)
        assertEquals(2, SafetyFeaturesSize(2, 4).gridColumns)
        assertEquals(4, SafetyFeaturesSize(3, 4).gridColumns)
        assertEquals(4, SafetyFeaturesSize(4, 4).gridColumns)
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
