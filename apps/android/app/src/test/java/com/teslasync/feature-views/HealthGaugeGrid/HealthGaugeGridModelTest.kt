// Off-device unit coverage for the HealthGaugeGrid feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-key tests). Exercises the settings -> display-prefs adapter (distance/speed units + grouping
// locale — the web `useUnits` derivation), the wire decoders (`/drivetrain/health` + `/drives/stats`), the
// SI -> display row projection (the four Drive Statistics rows with their `convertDistanceFromSI` /
// `convertSpeedFromSI` conversions and `fmtInt`/`fmtNumber` formats; the four Motor Details rows incl. the
// capitalized status label and present-sensor count; the gauge model), the lifecycle classifier the composable
// switches on (per-state coverage), and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP —
// runs in :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthgaugegrid

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthGaugeGridModelTest {
    private val metric = HealthGaugeGridDisplayPrefs.DEFAULT
    private val imperial = HealthGaugeGridDisplayPrefs.from(Json.parseToJsonElement("""{"unit_of_length":"mi"}"""))

    private val strings =
        HealthGaugeGridStrings(
            healthScore = "Health Score",
            healthScoreDesc = "Overall drivetrain condition rating",
            motorDetails = "Motor Details",
            driveStats = "Drive Statistics",
            motorStatus = "Motor Status",
            overallHealth = "Overall Health",
            healthScoreLabel = "Health Score",
            sensorCount = "Active Sensors",
            realTime = "Real-time telemetry active",
            totalDrives = "Total Drives",
            totalDistance = "Total Distance",
            avgSpeed = "Avg Speed",
            topSpeed = "Top Speed",
            statusGood = "Good",
            statusWarning = "Warning",
            statusCritical = "Critical",
            noData = "No data",
        )

    // 487 drives, 42_300 m driven, 18.2 m/s avg, 33.5 m/s top — SI values under the legacy `_km`/`_kmh` wire keys.
    private val stats =
        DrivingStatsSummary(
            totalDrives = 487.0,
            totalDistanceM = 42_300.0,
            avgSpeedMps = 18.2,
            topSpeedMps = 33.5,
        )

    private val snapshot =
        HealthGaugeGridSnapshot(
            overallHealth = HealthStatus.Good,
            motorStatus = "Nominal",
            sensorTempsC = listOf(42.0, 44.0, 51.0, 28.0),
            stats = stats,
        )

    private fun statsRow(
        prefs: HealthGaugeGridDisplayPrefs,
        label: String,
    ): String? = HealthGaugeGridProjection.statsRows(stats, prefs, strings).firstOrNull { it.label == label }?.value

    private fun motorRow(
        snap: HealthGaugeGridSnapshot,
        label: String,
    ): String? = HealthGaugeGridProjection.motorRows(snap, strings).firstOrNull { it.label == label }?.value

    // ── Settings -> display-prefs adapter (web `useUnits`) ───────────────────────

    @Test
    fun defaultPrefsAreMetricEnUs() {
        assertEquals(DistanceUnitPref.KM, metric.units.distance)
        assertEquals(SpeedUnitPref.KMH, metric.units.speed)
        assertEquals("en-US", metric.locale.toLanguageTag())
    }

    @Test
    fun imperialSettingsSelectMilesAndMph() {
        assertEquals(DistanceUnitPref.MI, imperial.units.distance)
        assertEquals(SpeedUnitPref.MPH, imperial.units.speed)
    }

    // ── Status enum (web `HealthStatus` + `HEALTH_SCORE` + `?? 'good'` guard) ─────

    @Test
    fun healthStatusDecodesWireAndDefaultsToGood() {
        assertEquals(HealthStatus.Good, HealthStatus.fromWire("good"))
        assertEquals(HealthStatus.Warning, HealthStatus.fromWire("warning"))
        assertEquals(HealthStatus.Critical, HealthStatus.fromWire("critical"))
        assertEquals(HealthStatus.Critical, HealthStatus.fromWire("CRITICAL"))
        assertEquals(HealthStatus.Good, HealthStatus.fromWire(null))
        assertEquals(HealthStatus.Good, HealthStatus.fromWire("unknown"))
    }

    @Test
    fun healthScoresMatchTheWebConstants() {
        assertEquals(95, HealthStatus.Good.score)
        assertEquals(60, HealthStatus.Warning.score)
        assertEquals(25, HealthStatus.Critical.score)
    }

    // ── Snapshot derivations (web `healthScore` + active-sensor count) ───────────

    @Test
    fun healthScoreAndActiveSensorCountDeriveFromTheSnapshot() {
        assertEquals(95, snapshot.healthScore)
        assertEquals(4, snapshot.activeSensorCount)
        assertEquals(2, snapshot.copy(sensorTempsC = listOf(42.0, null, 51.0, null)).activeSensorCount)
        assertEquals(0, snapshot.copy(sensorTempsC = listOf(null, null, null, null)).activeSensorCount)
    }

    // ── Wire decoders (`/drivetrain/health` + `/drives/stats`) ───────────────────

    @Test
    fun snapshotDecodesHealthAndStatsFromWire() {
        val health =
            """{"overall_health":"warning","motor_status":"Warm","front_motor_temp_c":80,
               "rear_motor_temp_c":null,"inverter_temp_c":90,"battery_temp_c":40}"""
        val statsJson = """{"total_drives":487,"total_distance_km":42300,"avg_speed_kmh":18.2,"top_speed_kmh":33.5}"""
        val decoded =
            HealthGaugeGridSnapshot.fromJson(
                Json.parseToJsonElement(health),
                Json.parseToJsonElement(statsJson),
            )
        assertEquals(HealthStatus.Warning, decoded?.overallHealth)
        assertEquals("Warm", decoded?.motorStatus)
        assertEquals(3, decoded?.activeSensorCount)
        assertEquals(DrivingStatsSummary(487.0, 42_300.0, 18.2, 33.5), decoded?.stats)
    }

    @Test
    fun absentHealthPayloadDecodesToNull() {
        assertNull(HealthGaugeGridSnapshot.fromJson(null, null))
    }

    @Test
    fun absentStatsPayloadKeepsHealthButLeavesStatsNull() {
        val health = """{"overall_health":"good","motor_status":"Idle"}"""
        val decoded = HealthGaugeGridSnapshot.fromJson(Json.parseToJsonElement(health), null)
        assertEquals(HealthStatus.Good, decoded?.overallHealth)
        assertNull(decoded?.stats)
        assertEquals(0, decoded?.activeSensorCount)
    }

    @Test
    fun emptyStatsObjectDecodesToZerosNotNull() {
        assertEquals(
            DrivingStatsSummary(0.0, 0.0, 0.0, 0.0),
            DrivingStatsSummary.fromJson(Json.parseToJsonElement("{}")),
        )
        assertNull(DrivingStatsSummary.fromJson(null))
    }

    // ── Drive Statistics rows: metric (web conversions + formats) ────────────────

    @Test
    fun metricStatsRowValuesMatchTheWebFormatting() {
        assertEquals("487", statsRow(metric, "Total Drives"))
        assertEquals("42 km", statsRow(metric, "Total Distance"))
        assertEquals("65.5 km/h", statsRow(metric, "Avg Speed"))
        assertEquals("120.6 km/h", statsRow(metric, "Top Speed"))
    }

    @Test
    fun imperialStatsRowsConvertThroughTheDisplayBoundary() {
        // 42_300 m -> 26.28 mi; 18.2 m/s -> 40.7 mph; 33.5 m/s -> 74.9 mph.
        assertEquals("487", statsRow(imperial, "Total Drives"))
        assertEquals("26 mi", statsRow(imperial, "Total Distance"))
        assertEquals("40.7 mph", statsRow(imperial, "Avg Speed"))
        assertEquals("74.9 mph", statsRow(imperial, "Top Speed"))
    }

    @Test
    fun nonFiniteStatsRenderAsZeroNotEmDash() {
        val broken = stats.copy(avgSpeedMps = Double.NaN, totalDrives = Double.POSITIVE_INFINITY)
        val rows = HealthGaugeGridProjection.statsRows(broken, metric, strings).associate { it.label to it.value }
        assertEquals("0", rows["Total Drives"])
        assertEquals("0.0 km/h", rows["Avg Speed"])
    }

    @Test
    fun statsRowsAppearInWebSourceOrder() {
        val order = HealthGaugeGridProjection.statsRows(stats, metric, strings).map { it.label }
        assertEquals(listOf("Total Drives", "Total Distance", "Avg Speed", "Top Speed"), order)
    }

    // ── Motor Details rows (web KVList) ──────────────────────────────────────────

    @Test
    fun motorRowsMatchTheWebValuesAndOrder() {
        val rows = HealthGaugeGridProjection.motorRows(snapshot, strings)
        assertEquals(listOf("Motor Status", "Overall Health", "Health Score", "Active Sensors"), rows.map { it.label })
        assertEquals("Nominal", motorRow(snapshot, "Motor Status"))
        assertEquals("Good", motorRow(snapshot, "Overall Health"))
        assertEquals("95%", motorRow(snapshot, "Health Score"))
        assertEquals("4", motorRow(snapshot, "Active Sensors"))
    }

    @Test
    fun overallHealthRowUsesTheLocalizedCapitalizedStatus() {
        assertEquals("Warning", motorRow(snapshot.copy(overallHealth = HealthStatus.Warning), "Overall Health"))
        assertEquals("Critical", motorRow(snapshot.copy(overallHealth = HealthStatus.Critical), "Overall Health"))
    }

    @Test
    fun blankMotorStatusRendersAnEmDash() {
        assertEquals("\u2014", motorRow(snapshot.copy(motorStatus = "  "), "Motor Status"))
    }

    @Test
    fun statusLabelMapsEveryStatusToItsLocalizedString() {
        assertEquals("Good", strings.statusLabel(HealthStatus.Good))
        assertEquals("Warning", strings.statusLabel(HealthStatus.Warning))
        assertEquals("Critical", strings.statusLabel(HealthStatus.Critical))
    }

    // ── Gauge model (web `<RadialGauge>`) ────────────────────────────────────────

    @Test
    fun gaugeModelCarriesTheScorePercentAndLocalizedLabels() {
        val gauge = HealthGaugeGridProjection.gauge(snapshot.copy(overallHealth = HealthStatus.Warning), strings)
        assertEquals(60.0, gauge.value, 0.0)
        assertEquals(GAUGE_MAX, gauge.max, 0.0)
        assertEquals("%", gauge.unit)
        assertEquals("Health Score", gauge.label)
        assertEquals("Overall drivetrain condition rating", gauge.description)
        assertEquals(HealthStatus.Warning, gauge.status)
    }

    // ── i18n / a11y label keys (web `t('drivetrain.*')`) ─────────────────────────

    @Test
    fun rowLabelsComeFromTheSuppliedI18nStrings() {
        val rebranded = strings.copy(totalDistance = "Distance Total", motorStatus = "Statut Moteur")
        val statsLabels = HealthGaugeGridProjection.statsRows(stats, metric, rebranded).map { it.label }
        val motorLabels = HealthGaugeGridProjection.motorRows(snapshot, rebranded).map { it.label }
        assertTrue(statsLabels.contains("Distance Total"))
        assertEquals("Statut Moteur", motorLabels.first())
    }

    // ── Lifecycle surface classifier (per-state) ─────────────────────────────────

    @Test
    fun projectUiStateCoversLoadingContentAndEmpty() {
        assertEquals(UiPhase.Loading, HealthGaugeGridProjection.projectUiState(snapshot, isLoading = true).phase)
        assertEquals(UiPhase.Empty, HealthGaugeGridProjection.projectUiState(null, isLoading = false).phase)
        val content = HealthGaugeGridProjection.projectUiState(snapshot, isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(snapshot, content.data)
    }

    @Test
    fun offlineCachedStateStaysContentAndIsFlaggedStale() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = snapshot,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertFalse(offline.isLoading)
        assertFalse(offline.isError)
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
        // Cached data still projects the full Drive Statistics grid while stale.
        val cachedRows = HealthGaugeGridProjection.statsRows(offline.data!!.stats!!, metric, strings)
        assertEquals(HealthGaugeGridProjection.STATS_ROW_COUNT, cachedRows.size)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeEventWithSurfaceSlug() {
        val logger = RecordingLogger()
        HealthGaugeGridDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "HealthGaugeGrid"), record.fields)
        assertEquals("HealthGaugeGrid", HealthGaugeGridDiagnostics.SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
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
}
