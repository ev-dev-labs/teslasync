// Off-device unit coverage for the SafetySettingsPage surface's pure model + state projection (P3 acceptance:
// adapter + per-state + diagnostics tests). Exercises the JSON decoders (web `/safety/latest` / `/safety` /
// `useSecurityLatest` payloads → typed models), the safety-enum normalization choke point (web lib/safetyEnum.ts), the
// derivations (feature cards, 0..9 score, the step-chart series, the newest-first history), the SI → display distance
// boundary (web `useUnits`), the `Resource.mapData` passthrough, the four-state [UiState] projection the composable
// switches on (loading / empty / error / success — the PARITY data-state coverage), and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testDebugUnitTest.
@file:Suppress("InvalidPackageDeclaration", "LargeClass")

package io.teslasync.android.vehiclesystems.safetysettings

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

class SafetySettingsPageModelTest {
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
        assertEquals("safetySettings", SafetySettingsPageRegistration.ROUTE_ID)
        assertEquals("/safety-settings", SafetySettingsPageRegistration.WEB_PATH)
        assertEquals("SafetySettingsPage", SafetySettingsPageRegistration.SLUG)
    }

    // ── Snapshot decode (web /safety/latest) ─────────────────────────────────────

    @Test
    fun parseSafetySnapshotDecodesRealPayload() {
        val snap =
            parseSafetySnapshot(
                json(
                    """{"id":7,"automatic_emergency_braking_off":false,"automatic_blind_spot_camera":true,
                       "blind_spot_collision_warning":false,"emergency_lane_departure_avoidance":false,
                       "forward_collision_warning":"On","lane_departure_avoidance":false,
                       "speed_limit_warning":"SpeedAssistLevelNone","cruise_follow_distance":3,
                       "pin_to_drive_enabled":false,"miles_since_reset":1609.344,
                       "self_driving_miles_since_reset":3218.688,"created_at":"2024-06-10T10:00:00Z"}""",
                ),
            )
        assertTrue(snap.hasData)
        assertEquals(7L, snap.id)
        // AEB(on) + BSC(on) + FCW("On") + CFD(3) = 4 enabled; SLW=None ⇒ off, the rest off.
        assertEquals(4, snap.enabledCount)
        assertEquals(5, snap.disabledCount)
        assertEquals(44.44, snap.scorePercent, 0.01)
        assertEquals(1609.344, snap.milesSinceReset!!, EPS)
        assertEquals("2024-06-10T10:00:00Z", snap.createdAt)
    }

    @Test
    fun parseSafetySnapshotEmptyObjectRoutesToEmptySurface() {
        val snap = parseSafetySnapshot(json("{}"))
        assertFalse(snap.hasData)
        // AEB's inverted logic means an all-default snapshot still counts AEB as enabled (web `isAebEnabled(false)`),
        // so the empty snapshot scores 1/9. It is never displayed — hasData=false routes to the empty surface.
        assertEquals(1, snap.enabledCount)
        assertEquals(8, snap.disabledCount)
        assertNull(snap.milesSinceReset)
    }

    @Test
    fun aebUsesInvertedLogic() {
        // off=false means the feature IS enabled (web `isAebEnabled`).
        assertTrue(isAebEnabled(false))
        assertFalse(isAebEnabled(true))
        val on = parseSafetySnapshot(json("""{"automatic_emergency_braking_off":false}"""))
        assertTrue(on.features().first { it.id == SafetyFeatureId.Aeb }.enabled)
        val off = parseSafetySnapshot(json("""{"automatic_emergency_braking_off":true}"""))
        assertFalse(off.features().first { it.id == SafetyFeatureId.Aeb }.enabled)
    }

    @Test
    fun featuresProduceNineCardsInWebOrder() {
        val snap = parseSafetySnapshot(json("""{"automatic_emergency_braking_off":false,"cruise_follow_distance":3}"""))
        val features = snap.features()
        assertEquals(9, features.size)
        assertEquals(
            listOf(
                SafetyFeatureId.Aeb,
                SafetyFeatureId.Bsc,
                SafetyFeatureId.Fcw,
                SafetyFeatureId.Lda,
                SafetyFeatureId.Cfd,
                SafetyFeatureId.Slw,
                SafetyFeatureId.PinToDrive,
                SafetyFeatureId.Bscw,
                SafetyFeatureId.Elda,
            ),
            features.map { it.id },
        )
        // The four stringly fields carry their cleaned value; the booleans defer to the render layer (null).
        assertEquals("3", features.first { it.id == SafetyFeatureId.Cfd }.valueText)
        assertNull(features.first { it.id == SafetyFeatureId.Aeb }.valueText)
        assertTrue(features.first { it.id == SafetyFeatureId.Cfd }.enabled)
    }

    // ── Safety-enum normalization (web lib/safetyEnum.ts) ────────────────────────

    @Test
    fun cleanSafetyEnumHandlesEveryRuntimeShape() {
        assertEquals("On", cleanSafetyEnum(json("true"), SafetyEnumField.ForwardCollisionWarning))
        assertEquals("Off", cleanSafetyEnum(json("false"), SafetyEnumField.ForwardCollisionWarning))
        assertEquals("3", cleanSafetyEnum(json("3"), SafetyEnumField.CruiseFollowDistance))
        assertEquals("3", cleanSafetyEnum(json("3.0"), SafetyEnumField.CruiseFollowDistance))
        assertEquals("3", cleanSafetyEnum(json("\"FollowDistance3\""), SafetyEnumField.CruiseFollowDistance))
        assertEquals("High", cleanSafetyEnum(json("\"ForwardCollisionSensitivityHigh\""), SafetyEnumField.ForwardCollisionWarning))
        // SpeedAssistLevelNone collapses to Off (web special case).
        assertEquals("Off", cleanSafetyEnum(json("\"SpeedAssistLevelNone\""), SafetyEnumField.SpeedLimitWarning))
        assertEquals("Chime", cleanSafetyEnum(json("\"Chime\""), SafetyEnumField.SpeedLimitWarning))
        assertEquals(EM_DASH, cleanSafetyEnum(null, SafetyEnumField.SpeedLimitWarning))
        assertEquals(EM_DASH, cleanSafetyEnum(JsonNull, SafetyEnumField.SpeedLimitWarning))
    }

    @Test
    fun isSafetyEnumActiveClassifiesOffStatesAsFalse() {
        assertFalse(isSafetyEnumActive(null, SafetyEnumField.LaneDepartureAvoidance))
        assertFalse(isSafetyEnumActive(JsonNull, SafetyEnumField.LaneDepartureAvoidance))
        assertFalse(isSafetyEnumActive(json("false"), SafetyEnumField.LaneDepartureAvoidance))
        assertFalse(isSafetyEnumActive(json("\"Off\""), SafetyEnumField.LaneDepartureAvoidance))
        assertFalse(isSafetyEnumActive(json("\"SpeedAssistLevelNone\""), SafetyEnumField.SpeedLimitWarning))
        assertFalse(isSafetyEnumActive(json("0"), SafetyEnumField.CruiseFollowDistance))
        assertTrue(isSafetyEnumActive(json("true"), SafetyEnumField.LaneDepartureAvoidance))
        assertTrue(isSafetyEnumActive(json("3"), SafetyEnumField.CruiseFollowDistance))
        assertTrue(isSafetyEnumActive(json("\"Chime\""), SafetyEnumField.SpeedLimitWarning))
    }

    // ── History + security decode ────────────────────────────────────────────────

    @Test
    fun parseSafetyHistorySkipsEmptyRows() {
        val rows =
            parseSafetyHistory(
                json("""[{"created_at":"2024-06-10T10:00:00Z","automatic_blind_spot_camera":true},{}]"""),
            )
        assertEquals(1, rows.size)
        assertTrue(rows[0].automaticBlindSpotCamera)
        assertTrue(parseSafetyHistory(JsonNull).isEmpty())
    }

    @Test
    fun parseSecurityLatestIsNullSafe() {
        val empty = parseSecurityLatest(json("{}"))
        assertNull(empty.driverSeatBelt)
        assertNull(empty.locked)
        val real = parseSecurityLatest(json("""{"driver_seat_belt":true,"passenger_seat_belt":false,"locked":true}"""))
        assertEquals(true, real.driverSeatBelt)
        assertEquals(false, real.passengerSeatBelt)
        assertEquals(true, real.locked)
        assertNull(real.driverSeatOccupied)
    }

    // ── Chart + history projections (web toChartData / sortedHistory) ────────────

    @Test
    fun toSafetyChartDataSortsAscendingAndMapsStepValues() {
        val history =
            parseSafetyHistory(
                json(
                    """[{"created_at":"2024-01-02T10:00:00Z","automatic_emergency_braking_off":true,
                        "blind_spot_collision_warning":true,"emergency_lane_departure_avoidance":false},
                       {"created_at":"2024-01-01T10:00:00Z","automatic_emergency_braking_off":false,
                        "blind_spot_collision_warning":false,"emergency_lane_departure_avoidance":true}]""",
                ),
            )
        val points = toSafetyChartData(history)
        assertEquals(2, points.size)
        // Sorted ascending → 01-01 first: AEB on (off=false ⇒ 1), BSCW off (0), ELDA on (1).
        assertEquals(1.0, points[0].aeb, EPS)
        assertEquals(0.0, points[0].bscw, EPS)
        assertEquals(1.0, points[0].elda, EPS)
        // 01-02: AEB off (0), BSCW on (1), ELDA off (0).
        assertEquals(0.0, points[1].aeb, EPS)
        assertEquals(1.0, points[1].bscw, EPS)
        assertEquals(0.0, points[1].elda, EPS)
    }

    @Test
    fun sortedSafetyHistoryIsNewestFirst() {
        val history =
            parseSafetyHistory(
                json(
                    """[{"created_at":"2024-01-01T10:00:00Z"},{"created_at":"2024-01-03T10:00:00Z"},
                       {"created_at":"2024-01-02T10:00:00Z"}]""",
                ),
            )
        val sorted = sortedSafetyHistory(history)
        assertEquals("2024-01-03T10:00:00Z", sorted[0].createdAt)
        assertEquals("2024-01-01T10:00:00Z", sorted[2].createdAt)
    }

    // ── Display preferences (web useUnits) ───────────────────────────────────────

    @Test
    fun defaultDisplayPrefsAreMetric() {
        val prefs = SafetyDisplayPrefs.fromSettings(null)
        assertEquals("km", prefs.distanceLabel)
        assertEquals(1.0, prefs.distance(1000.0), EPS)
    }

    @Test
    fun imperialSettingsConvertDistanceAtBoundary() {
        val prefs = SafetyDisplayPrefs.fromSettings(json("""{"unit_of_length":"mi"}"""))
        assertEquals("mi", prefs.distanceLabel)
        // 1609.344 m ≈ 1 mile.
        assertEquals(1.0, prefs.distance(1609.344), 0.001)
    }

    // ── Resource.mapData preserves the lifecycle case ────────────────────────────

    @Test
    fun mapDataPreservesResourceCase() {
        val real = json("""{"automatic_blind_spot_camera":true}""")
        assertTrue(Resource.Loading(real, 1L, false).mapData(::parseSafetySnapshot) is Resource.Loading)
        assertTrue(Resource.Success(real, 1L, false).mapData(::parseSafetySnapshot) is Resource.Success)
        assertTrue(
            Resource.Error<JsonElement>(null, null, false, RuntimeException()).mapData(::parseSafetySnapshot) is Resource.Error,
        )
    }

    // ── Four-state UiState projection (PARITY data states) ───────────────────────

    @Test
    fun safetyFeedProjectsLoadingState() {
        val state = Resource.Loading<JsonElement>(null, null, false).mapData(::parseSafetySnapshot).toUiState { !it.hasData }
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun safetyFeedProjectsEmptyState() {
        val state = Resource.Success(json("{}"), 0L, false).mapData(::parseSafetySnapshot).toUiState { !it.hasData }
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun safetyFeedProjectsSuccessState() {
        val real = json("""{"automatic_blind_spot_camera":true,"created_at":"2024-06-10T10:00:00Z"}""")
        val state = Resource.Success(real, 0L, false).mapData(::parseSafetySnapshot).toUiState { !it.hasData }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.data!!.hasData)
    }

    @Test
    fun safetyFeedProjectsErrorState() {
        val state =
            Resource.Error<JsonElement>(null, null, false, RuntimeException("boom"))
                .mapData(::parseSafetySnapshot)
                .toUiState { !it.hasData }
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.hasError)
    }

    // ── PII-safe diagnostics ─────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlugWithoutPii() {
        val logger = RecordingLogger()
        recordSafetySettingsOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.first()
        assertEquals("view.opened", record.event)
        assertEquals("SafetySettingsPage", record.fields["surface"])
        assertEquals(1, record.fields.size)
    }

    private companion object {
        const val EPS = 1e-6
    }
}
