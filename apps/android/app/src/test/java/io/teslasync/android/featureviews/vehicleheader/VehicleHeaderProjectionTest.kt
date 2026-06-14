package io.teslasync.android.featureviews.vehicleheader

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehicleHeader's pure logic — the native analogue of everything the web component
 * derives from its props (web/src/features/vehicles/components/VehicleHeader.tsx): the title resolution (web
 * `display_name || vin || t('common.vehicle')`), the "model trim" descriptor join (web `${model} ${trim_badging}`),
 * the VIN read, the status derivation (web `vehicle ? getVehicleStatus(state) : 'offline'` / `deriveVehicleStatus`),
 * the cached → [VehicleHeaderData] adapter, the never-a-blank-box empty predicate, and the PII-safe `view.opened`
 * diagnostic. Runs in the `:android:testReleaseUnitTest` gate; the Compose render + a11y are covered by the
 * on-device VehicleHeaderUiTest.
 */
class VehicleHeaderProjectionTest {
    // ── Title: web `display_name || vin || t('common.vehicle')` ───────────────────────────────────────

    @Test
    fun titlePrefersDisplayNameThenFallsBackToVin() {
        assertEquals("My Model 3", VehicleHeaderProjection.title("My Model 3", "5YJ3VIN"))
        assertEquals("5YJ3VIN", VehicleHeaderProjection.title(null, "5YJ3VIN"))
        // A blank display name is falsy in the web `||`, so it falls through to the VIN.
        assertEquals("5YJ3VIN", VehicleHeaderProjection.title("  ", "5YJ3VIN"))
    }

    @Test
    fun titleIsNullWhenNeitherDisplayNameNorVinIsPresent() {
        // null ⇒ the composable resolves the `common.vehicle` catalog fallback.
        assertNull(VehicleHeaderProjection.title(null, null))
        assertNull(VehicleHeaderProjection.title("", "   "))
    }

    // ── Status token: raw token (web `{status}`), trimmed ─────────────────────────────────────────────

    @Test
    fun statusTokenTrimsTheRawTokenWithoutOtherwiseAlteringIt() {
        assertEquals("online", VehicleHeaderProjection.statusToken("  online  "))
        assertEquals("charging", VehicleHeaderProjection.statusToken("charging"))
    }

    // ── Descriptor: web `${model ?? ''} ${trim_badging ?? ''}` ────────────────────────────────────────

    @Test
    fun descriptorJoinsModelAndTrimWithASpace() {
        assertEquals("Model 3 Long Range", VehicleHeaderProjection.descriptor("Model 3", "Long Range"))
    }

    @Test
    fun descriptorDropsABlankPartWithoutADanglingSpace() {
        assertEquals("Model 3", VehicleHeaderProjection.descriptor("Model 3", ""))
        assertEquals("Long Range", VehicleHeaderProjection.descriptor(null, "  Long Range  "))
    }

    @Test
    fun descriptorIsNullWhenNoVehicleIsLoaded() {
        assertNull(VehicleHeaderProjection.descriptor(null, null))
        assertNull(VehicleHeaderProjection.descriptor("", "   "))
    }

    // ── Projection wiring + empty predicate ───────────────────────────────────────────────────────────

    @Test
    fun projectWiresEveryFieldFromTheRawInputs() {
        val model =
            VehicleHeaderProjection.project(
                VehicleHeaderData(
                    displayName = "My Model 3",
                    vin = "  5YJ3E1EA7KF000001 ",
                    model = "Model 3",
                    trim = "Long Range",
                    status = "  charging ",
                ),
            )
        assertEquals("My Model 3", model.title)
        assertEquals("charging", model.status)
        assertEquals("Model 3 Long Range", model.descriptor)
        assertEquals("5YJ3E1EA7KF000001", model.vin)
        assertFalse(model.isEmpty)
    }

    @Test
    fun modelIsEmptyOnlyWhenTitleDescriptorAndVinAreAllAbsent() {
        val model =
            VehicleHeaderProjection.project(
                VehicleHeaderData(displayName = null, vin = null, model = null, trim = null, status = "offline"),
            )
        assertTrue(model.isEmpty)
        assertNull(model.title)
        assertNull(model.descriptor)
        assertNull(model.vin)
        // The status token is still carried so the chip always renders (never a blank box).
        assertEquals("offline", model.status)
    }

    // ── Adapter: cached vehicle + state → VehicleHeaderData (web parent prop derivation) ───────────────

    @Test
    fun adapterFromNullVehicleYieldsOfflineWithNoIdentity() {
        val data = VehicleHeaderAdapter.from(vehicle = null, state = null)
        assertNull(data.displayName)
        assertNull(data.vin)
        assertNull(data.model)
        assertNull(data.trim)
        assertEquals("offline", data.status)
    }

    @Test
    fun adapterFromLoadedVehicleMapsIdentityAndDerivesStatus() {
        val data = VehicleHeaderAdapter.from(vehicle(), VehicleStateEnvelope(state = state(speed = 18.0), live = true))
        assertEquals("My Model 3", data.displayName)
        assertEquals("5YJ3VIN000007", data.vin)
        assertEquals("Model 3", data.model)
        // web `trim_badging` maps to the native `trim_level`.
        assertEquals("Long Range", data.trim)
        assertEquals("driving", data.status)
    }

    @Test
    fun adapterFromLoadedVehicleWithNoStateIsOffline() {
        val data = VehicleHeaderAdapter.from(vehicle(), state = null)
        assertEquals("My Model 3", data.displayName)
        assertEquals("offline", data.status)
    }

    // ── deriveVehicleStatus: web deriveVehicleStatus(state) ───────────────────────────────────────────

    @Test
    fun deriveStatusReturnsOfflineWhenThereIsNoState() {
        assertEquals("offline", VehicleHeaderAdapter.deriveVehicleStatus(null))
    }

    @Test
    fun deriveStatusReturnsChargingBeforeAnythingElse() {
        // Charging takes precedence over motion (web checks `is_charging` first).
        assertEquals("charging", VehicleHeaderAdapter.deriveVehicleStatus(state(isCharging = true, speed = 30.0)))
    }

    @Test
    fun deriveStatusReturnsDrivingWhenMovingAndNotCharging() {
        assertEquals("driving", VehicleHeaderAdapter.deriveVehicleStatus(state(speed = 12.5, stateToken = "online")))
    }

    @Test
    fun deriveStatusPassesAKnownStillTokenThrough() {
        assertEquals("parked", VehicleHeaderAdapter.deriveVehicleStatus(state(stateToken = "Parked")))
        assertEquals("asleep", VehicleHeaderAdapter.deriveVehicleStatus(state(stateToken = "asleep")))
        assertEquals("updating", VehicleHeaderAdapter.deriveVehicleStatus(state(stateToken = "  UPDATING ")))
    }

    @Test
    fun deriveStatusFallsBackToOnlineForAnUnknownStillToken() {
        assertEquals("online", VehicleHeaderAdapter.deriveVehicleStatus(state(stateToken = "teleporting")))
        assertEquals("online", VehicleHeaderAdapter.deriveVehicleStatus(state(stateToken = "")))
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        VehicleHeaderDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "VehicleHeader"), fields)
    }

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("VehicleHeader", VehicleHeaderDiagnostics.SLUG)
        assertEquals("vehicle-header", VehicleHeaderDiagnostics.ID)
    }

    // ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────

    private fun vehicle(): Vehicle =
        Json.decodeFromString(
            Vehicle.serializer(),
            """
            {"id":7,"tesla_id":42,"vin":"5YJ3VIN000007","display_name":"My Model 3","model":"Model 3",
             "trim_level":"Long Range","timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
             "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-06-01T00:00:00Z"}
            """.trimIndent(),
        )

    @Suppress("LongParameterList")
    private fun state(
        isCharging: Boolean = false,
        speed: Double = 0.0,
        stateToken: String = "online",
    ): VehicleState =
        VehicleState(
            batteryLevel = 72,
            chargeRate = 48_000.0,
            chargerPower = 0.0,
            idealRange = 380_000.0,
            insideTemp = 21.5,
            isCharging = isCharging,
            isClimateOn = false,
            isLocked = true,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 42_000_000.0,
            outsideTemp = 12.0,
            power = 0.0,
            ratedRange = 350_000.0,
            sentryMode = false,
            softwareVersion = "2026.20.1",
            speed = speed,
            state = stateToken,
            timeToFullCharge = 0.0,
            vehicleId = 7L,
        )

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
