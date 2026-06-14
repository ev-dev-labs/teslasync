// Off-device unit coverage for the VehicleTwin surface's pure model (P3 acceptance: adapter + per-state + a11y
// label tests). Exercises the paint inference + id parsing (web `inferPaintFromTesla` / `isPaintPaletteId`), the
// `useVehiclePaint` resolution precedence (override > inferred(exterior_color) > Pearl-White fallback), the
// selected-vehicle resolver, the adapter that projects a cached fleet + selection + override onto the resolved
// paint, the cache-then-network resource projection mapped through the shared `toUiState` (per-state coverage:
// loading / content / empty / error / stale / offline), the accessible physical-state summary (a11y label
// coverage), the recovery error-kind mapper, and the PII-safe `view.opened` diagnostic. No Compose / Android
// framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour the web
// component + hooks produce.

package io.teslasync.android.sharedsurfaces.vehicletwin

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class VehicleTwinModelTest {
    private fun vehicle(
        id: Long,
        name: String = "Car $id",
        color: String? = null,
        vin: String = "VIN$id",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = name,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = vin,
            color = color,
        )

    private fun labels(): VehicleTwinLabels =
        VehicleTwinLabels(
            twinTitle = "Real-time vehicle physical state",
            open = "Open",
            closed = "Closed",
            partial = "Partial",
            unknown = "Unknown",
            locked = "Locked",
            unlocked = "Unlocked",
            charging = "Charging",
            driving = "Driving",
            sentry = "Sentry Mode",
            headlights = "Headlights",
            doors = "Doors",
            windows = "Windows",
        )

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

    // ── argb packing ──────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun argbPacksAlphaRedGreenBlue() {
        assertEquals(0xFFFFFFFF.toInt(), argb(255, 255, 255, 1.0).toInt())
        assertEquals(0x00000000, argb(0, 0, 0, 0.0).toInt())
        // rgba(34,197,94,0.82) → alpha round(0.82*255)=209=0xD1
        assertEquals(0xD122C55E.toInt(), argb(34, 197, 94, 0.82).toInt())
    }

    // ── paint inference + id parsing (web inferPaintFromTesla / isPaintPaletteId) ──────────────────────────────

    @Test
    fun inferPaintMapsTeslaColorCodes() {
        assertEquals(PaintPaletteId.PearlWhite, inferPaintFromTesla("PearlWhiteMultiCoat").id)
        assertEquals(PaintPaletteId.PearlWhite, inferPaintFromTesla("white").id)
        assertEquals(PaintPaletteId.MidnightSilver, inferPaintFromTesla("MidnightSilverMetallic").id)
        assertEquals(PaintPaletteId.MidnightSilver, inferPaintFromTesla("silver").id)
        assertEquals(PaintPaletteId.DeepBlue, inferPaintFromTesla("Deep Blue Metallic").id)
        assertEquals(PaintPaletteId.SolidBlack, inferPaintFromTesla("SolidBlack").id)
        assertEquals(PaintPaletteId.SolidBlack, inferPaintFromTesla("obsidianblack").id)
        assertEquals(PaintPaletteId.RedMulticoat, inferPaintFromTesla("Red Multi-Coat").id)
    }

    @Test
    fun inferPaintFallsBackToPearlWhiteForUnknownOrNull() {
        assertEquals(FALLBACK_PAINT.id, inferPaintFromTesla(null).id)
        assertEquals(PaintPaletteId.PearlWhite, FALLBACK_PAINT.id)
        assertEquals(FALLBACK_PAINT.id, inferPaintFromTesla("Chartreuse").id)
        assertEquals(FALLBACK_PAINT.id, inferPaintFromTesla("").id)
    }

    @Test
    fun paintPaletteIdOrNullNarrowsKnownWireValues() {
        assertEquals(PaintPaletteId.DeepBlue, paintPaletteIdOrNull("deep-blue"))
        assertNull(paintPaletteIdOrNull("teal"))
        assertNull(paintPaletteIdOrNull(null))
    }

    // ── useVehiclePaint resolution precedence ─────────────────────────────────────────────────────────────────

    @Test
    fun resolvePaintPrefersOverrideThenInferredThenFallback() {
        // Override wins over the inferred colour.
        assertEquals(PaintPaletteId.SolidBlack, resolvePaint(PaintPaletteId.SolidBlack, "PearlWhite").id)
        // No override ⇒ inferred from the exterior colour.
        assertEquals(PaintPaletteId.RedMulticoat, resolvePaint(null, "RedMulticoat").id)
        // No override + no colour ⇒ fallback.
        assertEquals(FALLBACK_PAINT.id, resolvePaint(null, null).id)
    }

    // ── selected-vehicle resolver + label ─────────────────────────────────────────────────────────────────────

    @Test
    fun resolveSelectedVehiclePicksSelectionElseFirstElseNull() {
        val fleet = listOf(vehicle(1), vehicle(2))
        assertEquals(2L, resolveSelectedVehicle(fleet, 2L)?.id)
        assertEquals(1L, resolveSelectedVehicle(fleet, null)?.id)
        assertEquals(1L, resolveSelectedVehicle(fleet, 999L)?.id)
        assertNull(resolveSelectedVehicle(emptyList(), 1L))
    }

    @Test
    fun vehicleLabelFallsBackDisplayNameThenVinThenId() {
        assertEquals("Red Rocket", vehicleTwinLabel(vehicle(1, name = "Red Rocket")))
        assertEquals("VIN7", vehicleTwinLabel(vehicle(7, name = "", vin = "VIN7")))
        assertEquals("Vehicle 9", vehicleTwinLabel(vehicle(9, name = "", vin = "")))
    }

    // ── adapter: fleet + selection + override → resolved paint ────────────────────────────────────────────────

    @Test
    fun projectResolvesActiveVehiclePaint() {
        val fleet = listOf(vehicle(1, color = "PearlWhite"), vehicle(2, color = "RedMulticoat"))
        val data = projectVehicleTwin(fleet, selectedId = 2L, overrideId = null)
        assertEquals(PaintPaletteId.RedMulticoat, data.paint.id)
        assertEquals("Car 2", data.vehicleLabel)
        assertTrue(data.hasVehicle)
        assertFalse(data.overridden)
    }

    @Test
    fun projectAppliesOverrideOverInferred() {
        val fleet = listOf(vehicle(1, color = "PearlWhite"))
        val data = projectVehicleTwin(fleet, selectedId = 1L, overrideId = PaintPaletteId.DeepBlue)
        assertEquals(PaintPaletteId.DeepBlue, data.paint.id)
        assertTrue(data.overridden)
    }

    @Test
    fun projectEmptyFleetIsNeutralFallbackWithNoVehicle() {
        val data = projectVehicleTwin(emptyList(), selectedId = null, overrideId = null)
        assertEquals(FALLBACK_PAINT.id, data.paint.id)
        assertFalse(data.hasVehicle)
        assertTrue(isVehicleTwinEmpty(data))
    }

    // ── cache-then-network resource projection (per-state via shared toUiState) ───────────────────────────────

    @Test
    fun loadingWithNoCacheIsLoadingPhase() {
        val res = Resource.Loading<List<Vehicle>>(cached = null, fetchedAt = null, stale = false)
        val ui = projectVehicleTwinResource(res, null, null).toUiState { isVehicleTwinEmpty(it) }
        assertEquals(UiPhase.Loading, ui.phase)
    }

    @Test
    fun successWithVehicleIsContentPhase() {
        val res = Resource.Success(listOf(vehicle(1, color = "DeepBlue")), fetchedAt = 100L, stale = false)
        val ui = projectVehicleTwinResource(res, 1L, null).toUiState { isVehicleTwinEmpty(it) }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(PaintPaletteId.DeepBlue, ui.data?.paint?.id)
    }

    @Test
    fun successWithEmptyFleetIsEmptyPhase() {
        val res = Resource.Success(emptyList<Vehicle>(), fetchedAt = 100L, stale = false)
        val ui = projectVehicleTwinResource(res, null, null).toUiState { isVehicleTwinEmpty(it) }
        assertEquals(UiPhase.Empty, ui.phase)
    }

    @Test
    fun errorWithNoCacheIsErrorPhase() {
        val res = Resource.Error<List<Vehicle>>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val ui = projectVehicleTwinResource(res, null, null).toUiState { isVehicleTwinEmpty(it) }
        assertEquals(UiPhase.Error, ui.phase)
        assertTrue(ui.hasError)
        assertFalse(ui.hasData)
    }

    @Test
    fun errorWithCachedFleetIsOfflineContentWithRetry() {
        val res =
            Resource.Error(
                cached = listOf(vehicle(1, color = "SolidBlack")),
                fetchedAt = 100L,
                stale = true,
                error = ApiError.Network(),
            )
        val ui = projectVehicleTwinResource(res, 1L, null).toUiState { isVehicleTwinEmpty(it) }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(PaintPaletteId.SolidBlack, ui.data?.paint?.id)
        assertTrue(ui.stale)
        assertTrue(ui.isOffline)
        assertTrue(ui.canRetry)
    }

    @Test
    fun loadingWithCachedFleetIsRefreshingContent() {
        val res =
            Resource.Loading(
                cached = listOf(vehicle(1, color = "MidnightSilver")),
                fetchedAt = 100L,
                stale = true,
            )
        val ui = projectVehicleTwinResource(res, 1L, null).toUiState { isVehicleTwinEmpty(it) }
        assertEquals(UiPhase.Content, ui.phase)
        assertTrue(ui.refreshing)
        assertEquals(PaintPaletteId.MidnightSilver, ui.data?.paint?.id)
    }

    // ── accessibility summary (a11y label coverage) ───────────────────────────────────────────────────────────

    @Test
    fun accessibilitySummaryFoldsPhysicalState() {
        val state =
            VehicleTwinState(
                doors = DoorStates(driverFront = true),
                windowFD = WindowState.Open,
                locked = false,
                isCharging = true,
                isDriving = false,
                sentryMode = true,
                headlights = true,
            )
        val summary = vehicleTwinAccessibilitySummary(state, labels())
        assertTrue(summary.startsWith("Real-time vehicle physical state"))
        assertTrue(summary.contains("Doors: 1 Open"))
        assertTrue(summary.contains("Windows: Open"))
        assertTrue(summary.contains("Unlocked"))
        assertTrue(summary.contains("Charging"))
        assertTrue(summary.contains("Sentry Mode"))
        assertTrue(summary.contains("Headlights"))
        assertFalse(summary.contains("Driving"))
    }

    @Test
    fun accessibilitySummaryClosedWhenAllShut() {
        val summary = vehicleTwinAccessibilitySummary(EMPTY_TWIN_STATE, labels())
        assertTrue(summary.contains("Doors: Closed"))
        assertTrue(summary.contains("Windows: Closed"))
    }

    @Test
    fun windowAndBoolLabelsResolve() {
        val l = labels()
        assertEquals("Open", windowLabel(WindowState.Open, l))
        assertEquals("Partial", windowLabel(WindowState.Partial, l))
        assertEquals("Unknown", windowLabel(WindowState.Unknown, l))
        assertEquals("Open", boolLabel(true, "Open", "Closed", "Unknown"))
        assertEquals("Closed", boolLabel(false, "Open", "Closed", "Unknown"))
        assertEquals("Unknown", boolLabel(null, "Open", "Closed", "Unknown"))
    }

    // ── render helpers ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun windowFillIsNullForClosedSoTheGlassGradientIsUsed() {
        assertNull(windowFillArgb(WindowState.Closed))
        assertEquals(TwinColors.glassOpen, windowFillArgb(WindowState.Open))
    }

    @Test
    fun flashingPredicatesFollowHazardsAndTurnSignal() {
        assertTrue(frontFlashing(EMPTY_TWIN_STATE.copy(turnSignal = TurnSignalState.Left)))
        assertTrue(frontFlashing(EMPTY_TWIN_STATE.copy(hazards = true)))
        assertFalse(frontFlashing(EMPTY_TWIN_STATE.copy(turnSignal = TurnSignalState.Right)))
        assertTrue(rearFlashing(EMPTY_TWIN_STATE.copy(turnSignal = TurnSignalState.Right)))
        assertTrue(passengerWindowAlert(EMPTY_TWIN_STATE.copy(windowFP = WindowState.Partial)))
        assertFalse(passengerWindowAlert(EMPTY_TWIN_STATE))
    }

    // ── recovery error-kind mapper ────────────────────────────────────────────────────────────────────────────

    @Test
    fun errorKindMapsConnectivityAndStatus() {
        assertEquals(QueryErrorKind.Offline, vehicleTwinErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Waiting, vehicleTwinErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, vehicleTwinErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, vehicleTwinErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
    }

    // ── diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun viewOpenedDiagnosticCarriesOnlyTheSlug() {
        val logger = RecordingLogger()
        recordVehicleTwinOpened(logger)
        val opened = logger.records.single { it.event == EVENT_VIEW_OPENED }
        assertEquals(LogLevel.Info, opened.level)
        assertEquals("VehicleTwin", opened.fields[SURFACE_KEY])
        assertEquals(1, opened.fields.size)
    }

    private companion object {
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 500
    }
}
