package io.teslasync.android.featureviews.autopilotsection

import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device coverage of the pure AutopilotSection model — the [AutopilotSectionProjection] display
 * derivation (SI → display speed, 0-fraction-digit formatting, follow-distance parse, em-dash fallbacks, the
 * unit label), the observation readers ([latestNumeric] / [latestText] / [followDistanceRawFrom]),
 * [parseFollowDistance], [AutopilotSnapshot.hasAny], and the [combineAutopilotSnapshot] feed fold. Run by the
 * offline `:app:testReleaseUnitTest` gate.
 */
class AutopilotSectionProjectionTest {
    private val metric: UnitPref = UnitPreferences.fromSettings(null)
    private val imperial: UnitPref = UnitPreferences.fromSettings(buildJsonObject { put("unit_of_length", "mi") })

    // ── Projection: speed conversion + formatting ─────────────────────────────────
    @Test
    fun metricConvertsAndFormatsSpeedsToWholeKmh() {
        val display =
            AutopilotSectionProjection.project(
                AutopilotSnapshot(speedMps = 10.0, cruiseSetMps = 27.5, followDistanceRaw = "FollowDistance7"),
                metric,
                Locale.US,
            )
        assertEquals("36", display.currentSpeedValue)
        assertEquals("99", display.cruiseSetValue)
        assertEquals("7", display.followDistanceValue)
        assertEquals("km/h", display.speedUnit)
    }

    @Test
    fun imperialConvertsSpeedsToMphWithTheMphLabel() {
        val display =
            AutopilotSectionProjection.project(
                AutopilotSnapshot(speedMps = 26.8224, cruiseSetMps = 26.8224),
                imperial,
                Locale.US,
            )
        assertEquals("60", display.currentSpeedValue)
        assertEquals("60", display.cruiseSetValue)
        assertEquals("mph", display.speedUnit)
    }

    @Test
    fun absentReadingsRenderEmDashesAndKeepTheUnitLabel() {
        val display = AutopilotSectionProjection.project(AutopilotSnapshot(), metric, Locale.US)
        assertEquals(EM_DASH, display.currentSpeedValue)
        assertEquals(EM_DASH, display.cruiseSetValue)
        assertEquals(EM_DASH, display.followDistanceValue)
        assertEquals("km/h", display.speedUnit)
    }

    // ── parseFollowDistance ───────────────────────────────────────────────────────
    @Test
    fun parseFollowDistancePeelsTheProtoEnumPrefix() {
        assertEquals("7", parseFollowDistance("FollowDistance7"))
        assertEquals("3", parseFollowDistance("FollowDistance3"))
        assertEquals("2", parseFollowDistance("2"))
    }

    @Test
    fun parseFollowDistanceFallsBackToRawWhenNoTrailingDigit() {
        assertEquals("Standard", parseFollowDistance("Standard"))
    }

    @Test
    fun parseFollowDistanceNullStaysNull() {
        assertNull(parseFollowDistance(null))
    }

    // ── observation readers ───────────────────────────────────────────────────────
    @Test
    fun latestReadersTakeTheFirstRow() {
        val numeric = listOf(obs(numeric = 31.29), obs(numeric = 1.0))
        assertEquals(31.29, latestNumeric(numeric)!!, 1e-9)
        assertNull(latestText(numeric))

        val text = listOf(obs(text = "FollowDistance5"))
        assertEquals("FollowDistance5", latestText(text))
        assertNull(latestNumeric(text))

        assertNull(latestNumeric(emptyList()))
        assertNull(latestText(null))
    }

    @Test
    fun followDistanceRawPrefersTextThenStringifiedNumber() {
        assertEquals("FollowDistance7", followDistanceRawFrom(listOf(obs(text = "FollowDistance7"))))
        assertEquals("3", followDistanceRawFrom(listOf(obs(numeric = 3.0))))
        assertNull(followDistanceRawFrom(emptyList()))
        assertNull(followDistanceRawFrom(null))
    }

    // ── hasAny content/empty boundary ─────────────────────────────────────────────
    @Test
    fun hasAnyIsTrueWhenAnyReadingIsPresent() {
        assertTrue(AutopilotSnapshot(speedMps = 1.0).hasAny)
        assertTrue(AutopilotSnapshot(cruiseSetMps = 1.0).hasAny)
        assertTrue(AutopilotSnapshot(followDistanceRaw = "FollowDistance7").hasAny)
        assertFalse(AutopilotSnapshot().hasAny)
    }

    // ── combineAutopilotSnapshot fold ─────────────────────────────────────────────
    @Test
    fun combineFoldsStateAndObservationsIntoOneSuccessSnapshot() {
        val result =
            combineAutopilotSnapshot(
                state = Resource.Success(env(speed = 10.0), fetchedAt = 100L, stale = false),
                cruise = Resource.Success(listOf(obs(numeric = 27.5)), fetchedAt = 100L, stale = false),
                follow = Resource.Success(listOf(obs(text = "FollowDistance7")), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Success)
        val snapshot = result.cached!!
        assertEquals(10.0, snapshot.speedMps!!, 1e-9)
        assertEquals(27.5, snapshot.cruiseSetMps!!, 1e-9)
        assertEquals("FollowDistance7", snapshot.followDistanceRaw)
    }

    @Test
    fun combineLoadingWithNoReadingsHasNullCache() {
        val result =
            combineAutopilotSnapshot(
                state = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                cruise = Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
                follow = Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Loading)
        assertNull(result.cached)
    }

    @Test
    fun combineErrorKeepsCachedReadingsWhenPresent() {
        val result =
            combineAutopilotSnapshot(
                state = Resource.Error(cached = env(speed = 10.0), fetchedAt = 100L, stale = true, error = RuntimeException("x")),
                cruise = Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
                follow = Resource.Success(emptyList(), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Error)
        assertEquals(10.0, result.cached!!.speedMps!!, 1e-9)
        assertTrue(result.stale)
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────
    private fun obs(
        numeric: Double? = null,
        text: String? = null,
    ): SignalObservation =
        SignalObservation(
            vehicleId = 1L,
            ts = "2026-01-01T00:00:00Z",
            signalName = "CruiseSignal",
            valueNumeric = numeric,
            valueText = text,
            valueBool = null,
            source = "fleet_telemetry",
        )

    private fun env(speed: Double?): VehicleStateEnvelope = VehicleStateEnvelope(state = speed?.let { vehicleState(it) }, live = false)

    private fun vehicleState(speed: Double) =
        io.teslasync.shared.core.api.generated.VehicleState(
            batteryLevel = 80,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = false,
            softwareVersion = "2025.0",
            speed = speed,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )
}
