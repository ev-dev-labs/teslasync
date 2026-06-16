// Off-device unit coverage for the DrivetrainHealthPage surface's pure model + state projection (P3 acceptance:
// adapter + per-state + diagnostics tests). Exercises the JSON decoders (web `useDrivetrainHealth` / `useDrives` /
// `useDrivingStats` / `useMotorLatest` / `useMotorHistory` payloads → typed models), the derivations (thermal sensors,
// per-drive chart window + aggregates, motor history series, health-score, recommendations), the SI → display unit
// boundary (web `useUnits`), the `Resource.mapData` passthrough, the four-state [UiState] projection the composable
// switches on (loading / empty / error / success — the PARITY data-state coverage), and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testDebugUnitTest. Reference values are the strings +
// behaviour the web page + drivetrain-health components produce.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivetrainhealth

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DrivetrainHealthPageModelTest {
    private fun json(raw: String): JsonElement = Json.parseToJsonElement(raw)

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── Registration mirrors the web route + Destinations entry ──────────────────

    @Test
    fun registrationMirrorsWebRoute() {
        assertEquals("drivetrainHealth", DrivetrainHealthPageRegistration.ROUTE_ID)
        assertEquals("/drivetrain-health", DrivetrainHealthPageRegistration.WEB_PATH)
        assertEquals("DrivetrainHealthPage", DrivetrainHealthPageRegistration.SLUG)
    }

    // ── Health decode (web useDrivetrainHealth) ──────────────────────────────────

    @Test
    fun parseDrivetrainHealthDecodesRealPayload() {
        val health =
            parseDrivetrainHealth(
                json(
                    """{"front_motor_temp_c":45.0,"rear_motor_temp_c":50.0,"inverter_temp_c":70.0,
                       "battery_temp_c":30.0,"motor_status":"Overheating","overall_health":"critical"}""",
                ),
            )
        assertEquals(45.0, health.frontMotorTempC!!, EPS)
        assertEquals(70.0, health.inverterTempC!!, EPS)
        assertEquals("Overheating", health.motorStatus)
        assertEquals(HealthStatus.Critical, health.overallHealth)
        assertTrue(health.hasData)
        assertEquals(25, health.overallHealth.score)
    }

    @Test
    fun parseDrivetrainHealthEmptyObjectRoutesToEmptySurface() {
        val health = parseDrivetrainHealth(json("{}"))
        assertFalse(health.hasData)
        assertEquals("", health.motorStatus)
        assertEquals(HealthStatus.Good, health.overallHealth)
        assertNull(health.frontMotorTempC)
    }

    @Test
    fun healthStatusFromWireDefaultsToGood() {
        assertEquals(HealthStatus.Good, HealthStatus.fromWire("good"))
        assertEquals(HealthStatus.Warning, HealthStatus.fromWire("warning"))
        assertEquals(HealthStatus.Critical, HealthStatus.fromWire("critical"))
        assertEquals(HealthStatus.Good, HealthStatus.fromWire(null))
        assertEquals(95, HealthStatus.Good.score)
        assertEquals(60, HealthStatus.Warning.score)
    }

    // ── Stats / motor / drives decode ────────────────────────────────────────────

    @Test
    fun parseDrivingStatsDecodesAggregates() {
        val stats =
            parseDrivingStats(
                json(
                    """{"total_drives":12,"total_distance_km":1234.5,"avg_speed_kmh":15.0,"top_speed_kmh":40.0,
                       "regen_ratio":0.25,"regen_energy_wh":5000.0,"co2_saved_kg":12.3}""",
                ),
            )
        assertEquals(12, stats.totalDrives)
        assertEquals(1234.5, stats.totalDistanceKm, EPS)
        assertEquals(0.25, stats.regenRatio, EPS)
        assertTrue(stats.hasData)
        assertFalse(parseDrivingStats(json("{}")).hasData)
    }

    @Test
    fun parseMotorLatestHandlesNullAndReal() {
        assertFalse(parseMotorLatest(JsonNull).hasData)
        assertFalse(parseMotorLatest(json("{}")).hasData)
        val motor =
            parseMotorLatest(
                json(
                    """{"ts":"2024-01-15T13:45:30Z","shift_state":"D","power_kw":50.0,"regen_kw":0.0,
                       "source":"telemetry","motor_rpm_front":3000.0,"torque_nm_front":120.0,
                       "motor_temp_c_front":60.0,"inverter_temp_c":55.0}""",
                ),
            )
        assertTrue(motor.hasData)
        assertEquals("D", motor.shiftState)
        assertEquals(50.0, motor.powerKw!!, EPS)
        assertEquals(120.0, motor.torqueNmFront!!, EPS)
    }

    @Test
    fun parseMotorHistoryDecodesEachSnapshot() {
        val history =
            parseMotorHistory(
                json(
                    """[{"ts":"2024-01-15T13:45:30Z","motor_temp_c_front":60.0,"torque_nm_front":100.0},
                        {"ts":"2024-01-15T13:46:30Z","motor_temp_c_rear":62.0,"torque_nm_rear":110.0}]""",
                ),
            )
        assertEquals(2, history.size)
        assertEquals(60.0, history[0].motorTempCFront!!, EPS)
        assertTrue(parseMotorHistory(JsonNull).isEmpty())
    }

    @Test
    fun parseDrivesSkipsRowsWithoutStartTimestamp() {
        val drives =
            parseDrives(
                json(
                    """[{"start_ts":"2024-06-10T10:00:00Z","avg_power_w":20000.0,"outside_temp_avg_c":25.0,"distance_m":50000.0},
                        {"avg_power_w":1.0}]""",
                ),
            )
        assertEquals(1, drives.size)
        assertEquals(50000.0, drives[0].distanceM, EPS)
    }

    // ── Sensors (web sensors array) ──────────────────────────────────────────────

    @Test
    fun buildSensorsProducesFourReadingsInWebOrder() {
        val health = parseDrivetrainHealth(json("""{"front_motor_temp_c":140.0,"battery_temp_c":59.0,"motor_status":"Warm"}"""))
        val sensors = buildSensors(health)
        assertEquals(4, sensors.size)
        assertEquals(DrivetrainSensorId.FrontMotor, sensors[0].id)
        assertEquals(150.0, sensors[0].maxTempC, EPS)
        // 140/150 = 0.93 ≥ 0.85 → Critical; battery 59/60 = 0.983 → Critical; rear/inverter null → Unknown.
        assertEquals(TempSeverity.Critical, sensors[0].severity)
        assertEquals(TempSeverity.Unknown, sensors[1].severity)
        assertEquals(TempSeverity.Critical, sensors[3].severity)
        assertEquals(2, activeSensorCount(sensors))
    }

    // ── Per-drive chart window + aggregates (web chartData) ──────────────────────

    @Test
    fun buildChartDataFiltersWindowSortsAndConverts() {
        val drives =
            parseDrives(
                json(
                    """[{"start_ts":"2024-06-11T10:00:00Z","avg_power_w":30000.0,"distance_m":60000.0},
                        {"start_ts":"2024-06-10T10:00:00Z","avg_power_w":20000.0,"outside_temp_avg_c":25.0,"distance_m":50000.0},
                        {"start_ts":"2020-01-01T00:00:00Z","avg_power_w":99000.0,"distance_m":1.0}]""",
                ),
            )
        val start = epochMillisOf("2024-06-01T00:00:00Z")!!
        val end = epochMillisOf("2024-07-01T00:00:00Z")!!
        val points = buildChartData(drives, start, end, DrivetrainDisplayPrefs.DEFAULT)

        assertEquals(2, points.size)
        // Sorted ascending → 06/10 first.
        assertEquals("06/10", points[0].date)
        assertEquals(20.0, points[0].powerMax, EPS)
        assertEquals(50.0, points[0].distanceDisplay, EPS)
        assertEquals(25.0, points[0].outsideTempDisplay!!, EPS)
        assertNull(points[1].outsideTempDisplay)

        assertEquals(30.0, peakPower(points), EPS)
        assertEquals(25.0, averagePower(points), EPS)
        assertEquals(0.0, minRegenPower(points), EPS)
        assertEquals(1, temperatureTrend(points).size)
    }

    @Test
    fun buildMotorChartDataConvertsTempsAndPicksTorque() {
        val history =
            parseMotorHistory(
                json(
                    """[{"ts":"2024-01-15T13:45:30Z","motor_temp_c_front":60.0,"motor_temp_c_rear":62.0,
                        "inverter_temp_c":58.0,"torque_nm_rear":110.0}]""",
                ),
            )
        val points = buildMotorChartData(history, DrivetrainDisplayPrefs.DEFAULT)
        assertEquals("13:45", points[0].time)
        assertEquals(60.0, points[0].stator!!, EPS)
        assertEquals(58.0, points[0].statorRer!!, EPS)
        // No front torque → falls back to rear (web `torque_nm_front ?? torque_nm_rear`).
        assertEquals(110.0, points[0].torque!!, EPS)
        assertTrue(hasTorque(points))
    }

    // ── Recommendations (web HealthRecommendations) ──────────────────────────────

    @Test
    fun buildRecommendationsBranchesByTier() {
        assertEquals(4, buildRecommendations(HealthStatus.Good).size)
        assertEquals(7, buildRecommendations(HealthStatus.Warning).size)
        val critical = buildRecommendations(HealthStatus.Critical)
        assertEquals(9, critical.size)
        assertEquals(RecommendationTip.CriticalStop, critical.first())
        assertEquals(RecommendationPriority.High, critical.first().priority)
        assertEquals(RecommendationTip.MonitorTemps, critical.last())
    }

    // ── Display preferences (web useUnits) ───────────────────────────────────────

    @Test
    fun defaultDisplayPrefsAreMetric() {
        val prefs = DrivetrainDisplayPrefs.fromSettings(null)
        assertEquals("km", prefs.distanceLabel)
        assertEquals("km/h", prefs.speedLabel)
        assertEquals(1.0, prefs.distance(1000.0), EPS)
        assertEquals(36.0, prefs.speed(10.0), EPS)
        assertEquals(25.0, prefs.temperature(25.0), EPS)
    }

    @Test
    fun imperialSettingsConvertAtDisplayBoundary() {
        val prefs = DrivetrainDisplayPrefs.fromSettings(json("""{"unit_of_length":"mi","unit_of_temp":"F"}"""))
        assertEquals("mi", prefs.distanceLabel)
        assertEquals("mph", prefs.speedLabel)
        // 1609.34 m ≈ 1 mile; 0°C → 32°F.
        assertEquals(1.0, prefs.distance(1609.344), 0.01)
        assertEquals(32.0, prefs.temperature(0.0), EPS)
    }

    // ── Resource.mapData preserves the lifecycle case ────────────────────────────

    @Test
    fun mapDataPreservesResourceCase() {
        val real = json("""{"motor_status":"Normal","overall_health":"good"}""")
        assertTrue(Resource.Loading(real, 1L, false).mapData(::parseDrivetrainHealth) is Resource.Loading)
        assertTrue(Resource.Success(real, 1L, false).mapData(::parseDrivetrainHealth) is Resource.Success)
        assertTrue(Resource.Error<JsonElement>(null, null, false, RuntimeException()).mapData(::parseDrivetrainHealth) is Resource.Error)
    }

    // ── Four-state UiState projection (PARITY data states) ───────────────────────

    @Test
    fun healthFeedProjectsLoadingState() {
        val state = Resource.Loading<JsonElement>(null, null, false).mapData(::parseDrivetrainHealth).toUiState { !it.hasData }
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun healthFeedProjectsEmptyState() {
        val state = Resource.Success(json("{}"), 0L, false).mapData(::parseDrivetrainHealth).toUiState { !it.hasData }
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun healthFeedProjectsSuccessState() {
        val real = json("""{"motor_status":"Normal","overall_health":"good","front_motor_temp_c":40.0}""")
        val state = Resource.Success(real, 0L, false).mapData(::parseDrivetrainHealth).toUiState { !it.hasData }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.data!!.hasData)
    }

    @Test
    fun healthFeedProjectsErrorState() {
        val state =
            Resource.Error<JsonElement>(null, null, false, RuntimeException("boom"))
                .mapData(::parseDrivetrainHealth)
                .toUiState { !it.hasData }
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.hasError)
    }

    // ── PII-safe diagnostics ─────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlugWithoutPii() {
        val logger = RecordingLogger()
        recordDrivetrainHealthOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.first()
        assertEquals("view.opened", record.event)
        assertEquals("DrivetrainHealthPage", record.fields["surface"])
        assertEquals(1, record.fields.size)
    }

    private companion object {
        const val EPS = 1e-6
    }
}
