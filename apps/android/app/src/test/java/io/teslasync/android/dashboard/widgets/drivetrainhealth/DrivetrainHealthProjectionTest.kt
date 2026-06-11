package io.teslasync.android.dashboard.widgets.drivetrainhealth

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the DrivetrainHealthWidget's pure logic — the web `healthScore`/`healthColor`
 * maps, the `health?.frontMotorTempC ?? motor?.motor_temp_c_front` field-fallback chains, the SI→display
 * temperature conversion, the cache-then-network state fold (loading / content / empty / hard error /
 * offline), and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/DrivetrainHealthWidget.tsx).
 */
class DrivetrainHealthProjectionTest {
    private val strings =
        DrivetrainHealthStrings(
            title = "Drivetrain Health",
            score = "health",
            motorTemp = "Motor Temp",
            statorTemp = "Stator Temp",
            inverterHealth = "Inverter",
            driveState = "Drive State",
            noData = "No drivetrain data",
        )

    private fun prefs(temperature: TemperatureUnitPref = TemperatureUnitPref.CELSIUS): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.KM,
            speed = SpeedUnitPref.KMH,
            temperature = temperature,
            pressure = PressureUnitPref.KPA,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
        )

    private fun health(): JsonElement =
        buildJsonObject {
            put("front_motor_temp_c", 45.0)
            put("rear_motor_temp_c", 48.0)
            put("inverter_temp_c", 52.0)
            put("motor_status", "Normal")
            put("overall_health", "good")
        }

    private fun motor(): JsonElement =
        buildJsonObject {
            put("motor_temp_c_front", 46.0)
            put("di_stator_temp", 61.0)
            put("inverter_temp_c", 53.0)
            put("state_front", "Drive")
        }

    private fun project(
        snapshot: DrivetrainHealthSnapshot,
        prefs: UnitPref = prefs(),
    ): DrivetrainHealthDisplay = DrivetrainHealthProjection.project(snapshot, prefs, strings)

    @Test
    fun healthScoreMapMirrorsWeb() {
        assertEquals(95.0, DrivetrainHealthProjection.healthScore("good"), 0.0)
        assertEquals(60.0, DrivetrainHealthProjection.healthScore("warning"), 0.0)
        assertEquals(25.0, DrivetrainHealthProjection.healthScore("critical"), 0.0)
        assertEquals(0.0, DrivetrainHealthProjection.healthScore(null), 0.0)
        assertEquals(0.0, DrivetrainHealthProjection.healthScore("unknown"), 0.0)
    }

    @Test
    fun bandThresholdsMirrorWebHealthColor() {
        assertEquals(HealthBand.Good, DrivetrainHealthProjection.bandFor(95.0))
        assertEquals(HealthBand.Good, DrivetrainHealthProjection.bandFor(80.0))
        assertEquals(HealthBand.Warning, DrivetrainHealthProjection.bandFor(60.0))
        assertEquals(HealthBand.Warning, DrivetrainHealthProjection.bandFor(50.0))
        assertEquals(HealthBand.Critical, DrivetrainHealthProjection.bandFor(25.0))
        assertEquals(HealthBand.Critical, DrivetrainHealthProjection.bandFor(0.0))
    }

    @Test
    fun bothPresentPrefersHealthTempsAndMotorStatorAndDriveState() {
        val display = project(DrivetrainHealthSnapshot(health(), motor()))
        assertTrue(display.hasData)
        assertEquals(95.0, display.score, 0.0)
        assertEquals("95", display.scoreText)
        assertEquals("health", display.scoreUnit)
        assertEquals(HealthBand.Good, display.band)
        // motorTemp ← health.front_motor_temp_c; statorTemp ← motor.di_stator_temp;
        // inverterTemp ← health.inverter_temp_c; driveState ← motor.state_front.
        assertEquals(DrivetrainStat("Motor Temp", "45", "\u00B0C"), display.stats[0])
        assertEquals(DrivetrainStat("Stator Temp", "61", "\u00B0C"), display.stats[1])
        assertEquals(DrivetrainStat("Inverter", "52", "\u00B0C"), display.stats[2])
        assertEquals(DrivetrainStat("Drive State", "Drive", null), display.stats[3])
    }

    @Test
    fun fahrenheitConvertsTemperaturesAtRenderBoundary() {
        val display = project(DrivetrainHealthSnapshot(health(), motor()), prefs(TemperatureUnitPref.FAHRENHEIT))
        // 45°C → 113°F, 61°C → 142°F, 52°C → 126°F (web convertTempFromSI + fmtNumber(_, 0)).
        assertEquals(DrivetrainStat("Motor Temp", "113", "\u00B0F"), display.stats[0])
        assertEquals(DrivetrainStat("Stator Temp", "142", "\u00B0F"), display.stats[1])
        assertEquals(DrivetrainStat("Inverter", "126", "\u00B0F"), display.stats[2])
    }

    @Test
    fun motorOnlyFallsBackToMotorFieldsAndZeroScore() {
        val display = project(DrivetrainHealthSnapshot(health = null, motor = motor()))
        assertTrue(display.hasData)
        assertEquals(0.0, display.score, 0.0)
        assertEquals(HealthBand.Critical, display.band)
        assertEquals("46", display.stats[0].value) // motor.motor_temp_c_front
        assertEquals("61", display.stats[1].value) // motor.di_stator_temp
        assertEquals("53", display.stats[2].value) // motor.inverter_temp_c
        assertEquals("Drive", display.stats[3].value) // motor.state_front
    }

    @Test
    fun healthOnlyFallsBackToHealthRearStatorAndMotorStatus() {
        val display = project(DrivetrainHealthSnapshot(health = health(), motor = null))
        assertTrue(display.hasData)
        assertEquals("45", display.stats[0].value) // health.front_motor_temp_c
        assertEquals("48", display.stats[1].value) // motor.di_stator_temp absent → health.rear_motor_temp_c
        assertEquals("52", display.stats[2].value) // health.inverter_temp_c
        assertEquals("Normal", display.stats[3].value) // motor.state_front absent → health.motor_status
    }

    @Test
    fun emptySnapshotShowsEmDashesAndNoData() {
        val display = project(DrivetrainHealthSnapshot(health = null, motor = null))
        assertFalse(display.hasData)
        assertEquals(0.0, display.score, 0.0)
        assertEquals("\u2014", display.stats[0].value)
        assertEquals("\u2014", display.stats[1].value)
        assertEquals("\u2014", display.stats[2].value)
        assertEquals("\u2014", display.stats[3].value)
    }

    @Test
    fun foldLoadingWhenEitherFeedFirstLoads() {
        assertEquals(UiPhase.Loading, DrivetrainHealthProjection.foldState(loading(), loading()).phase)
        // A still-loading motor feed keeps the skeleton even once health has resolved (web isLoading = ||).
        assertEquals(UiPhase.Loading, DrivetrainHealthProjection.foldState(success(health()), loading()).phase)
    }

    @Test
    fun foldContentWhenBothResolveCarryingMaxFreshness() {
        val state = DrivetrainHealthProjection.foldState(success(health(), 100L), success(motor(), 200L))
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(200L, state.fetchedAt)
        assertNull(state.errorKind)
        assertFalse(state.stale)
        assertEquals(health(), state.data?.health)
        assertEquals(motor(), state.data?.motor)
    }

    @Test
    fun foldEmptyWhenNeitherDocumentPresent() {
        val state = DrivetrainHealthProjection.foldState(success(JsonNull, 50L), success(JsonNull, 60L))
        assertEquals(UiPhase.Empty, state.phase)
        assertEquals(UiPhase.Empty, DrivetrainHealthProjection.emptyState().phase)
    }

    @Test
    fun foldHardErrorWhenHealthFailsWithNoCache() {
        val state = DrivetrainHealthProjection.foldState(error(cached = null, ApiError.Network()), success(motor()))
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Network, state.errorKind)
        assertTrue(state.canRetry)
    }

    @Test
    fun foldOfflineKeepsCachedHealthOnErrorWithCache() {
        // ADR-013 honest freshness: an error with a cached document stays visible as stale/offline content
        // (the spec's mandated `offline` state) rather than blanking, where the web shell would show error.
        val state = DrivetrainHealthProjection.foldState(error(cached = health(), ApiError.Timeout()), success(motor()))
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertEquals(ErrorKind.Timeout, state.errorKind)
        assertEquals(health(), state.data?.health)
    }

    @Test
    fun foldIgnoresMotorErrorForTheErrorSurface() {
        // Web shell only receives `healthError`; a motor failure must not blank the widget.
        val state = DrivetrainHealthProjection.foldState(success(health(), 100L), error(cached = null, ApiError.Network()))
        assertEquals(UiPhase.Content, state.phase)
        assertNull(state.errorKind)
    }

    @Test
    fun foldMarksRefreshingWhenAFeedRefreshesOverCache() {
        val state =
            DrivetrainHealthProjection.foldState(
                Resource.Loading(cached = health(), fetchedAt = 100L, stale = false),
                success(motor(), 100L),
            )
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
    }

    @Test
    fun formattersReproduceWebEnUsHalfExpandContract() {
        assertEquals("1,234.5", DrivetrainHealthProjection.formatNumber(1234.5, decimals = 1))
        assertEquals("1,235", DrivetrainHealthProjection.formatInt(1234.5))
        assertEquals("13", DrivetrainHealthProjection.formatInt(12.5))
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("drivetrain-health", DrivetrainHealthRegistration.ID)
        assertEquals("vehicle", DrivetrainHealthRegistration.CATEGORY)
        assertEquals("DrivetrainHealthWidget", DrivetrainHealthRegistration.SLUG)
        assertEquals(DrivetrainHealthSize(cols = 2, rows = 4), DrivetrainHealthRegistration.DEFAULT_SIZE)
        assertEquals(DrivetrainHealthSize(cols = 1, rows = 2), DrivetrainHealthRegistration.MIN_SIZE)
        assertEquals(DrivetrainHealthSize(cols = 4, rows = 40), DrivetrainHealthRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampsBoundsAndDetectsCompact() {
        assertEquals(DrivetrainHealthSize(4, 40), DrivetrainHealthRegistration.clamp(DrivetrainHealthSize(9, 99)))
        assertEquals(DrivetrainHealthSize(1, 2), DrivetrainHealthRegistration.clamp(DrivetrainHealthSize(0, 0)))
        assertTrue(DrivetrainHealthRegistration.isWithinBounds(DrivetrainHealthSize(2, 4)))
        assertFalse(DrivetrainHealthRegistration.isWithinBounds(DrivetrainHealthSize(5, 4)))
        assertTrue(DrivetrainHealthRegistration.isCompact(DrivetrainHealthSize(1, 2)))
        assertFalse(DrivetrainHealthRegistration.isCompact(DrivetrainHealthSize(2, 4)))
    }

    private companion object {
        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun success(
            value: JsonElement,
            fetchedAt: Long = 100L,
        ): Resource<JsonElement> = Resource.Success(value, fetchedAt = fetchedAt, stale = false)

        fun error(
            cached: JsonElement?,
            error: Throwable,
        ): Resource<JsonElement> = Resource.Error(cached = cached, fetchedAt = 100L, stale = cached != null, error = error)
    }
}
