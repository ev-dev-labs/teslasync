package io.teslasync.android.featureviews.vehicleheader

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the VehicleHeader's pure logic — the native analogue of everything the web
 * component derives from its props (web/src/features/vehicles/components/vehicle-detail/VehicleHeader.tsx): the
 * status-token-to-tone mapping (web `statusVariant(status)` over `VEHICLE_STATE_ENTRIES`, with the `?? danger`
 * fall-through), the "model trim" descriptor join (web `${model ?? ''} ${trim ?? ''}`), the VIN read (web
 * `vehicle?.vin ?? ''`), the never-a-blank-box empty predicate, and the PII-safe `view.opened` diagnostic. Runs
 * in the `:android:testReleaseUnitTest` gate; the Compose render + a11y are covered by the on-device
 * VehicleHeaderUiTest.
 */
class VehicleHeaderProjectionTest {
    private fun data(
        model: String? = "Model 3",
        trimBadging: String? = "Long Range",
        vin: String? = "5YJ3E1EA7KF000001",
        status: String = "online",
    ): VehicleHeaderData =
        VehicleHeaderData(
            model = model,
            trimBadging = trimBadging,
            vin = vin,
            status = status,
        )

    // ── Status tone: web statusVariant(status) over VEHICLE_STATE_ENTRIES (?? danger) ─────────────────

    @Test
    fun statusToneMapsOnlineAndDrivingToSuccess() {
        assertEquals(VehicleStatusTone.Success, VehicleHeaderProjection.statusTone("online"))
        assertEquals(VehicleStatusTone.Success, VehicleHeaderProjection.statusTone("driving"))
    }

    @Test
    fun statusToneMapsChargingToWarning() {
        assertEquals(VehicleStatusTone.Warning, VehicleHeaderProjection.statusTone("charging"))
    }

    @Test
    fun statusToneMapsParkedAndUpdatingToInfo() {
        assertEquals(VehicleStatusTone.Info, VehicleHeaderProjection.statusTone("parked"))
        assertEquals(VehicleStatusTone.Info, VehicleHeaderProjection.statusTone("updating"))
    }

    @Test
    fun statusToneMapsAsleepToNeutral() {
        assertEquals(VehicleStatusTone.Neutral, VehicleHeaderProjection.statusTone("asleep"))
    }

    @Test
    fun statusToneMapsOfflineToDanger() {
        assertEquals(VehicleStatusTone.Danger, VehicleHeaderProjection.statusTone("offline"))
    }

    @Test
    fun statusToneFallsBackToDangerForAnUnknownOrBlankToken() {
        assertEquals(VehicleStatusTone.Danger, VehicleHeaderProjection.statusTone("teleporting"))
        assertEquals(VehicleStatusTone.Danger, VehicleHeaderProjection.statusTone(""))
    }

    @Test
    fun statusToneIsCaseAndWhitespaceInsensitive() {
        assertEquals(VehicleStatusTone.Success, VehicleHeaderProjection.statusTone("  ONLINE  "))
        assertEquals(VehicleStatusTone.Warning, VehicleHeaderProjection.statusTone("Charging"))
    }

    // ── Status label: raw token (web `{status}`), trimmed ─────────────────────────────────────────────

    @Test
    fun statusLabelTrimsTheRawTokenWithoutOtherwiseAlteringIt() {
        assertEquals("online", VehicleHeaderProjection.statusLabel("  online  "))
        assertEquals("charging", VehicleHeaderProjection.statusLabel("charging"))
    }

    // ── Descriptor: web `${model ?? ''} ${trim ?? ''}` ────────────────────────────────────────────────

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

    // ── VIN: web `vehicle?.vin ?? ''` ─────────────────────────────────────────────────────────────────

    @Test
    fun vinTrimsAndCollapsesBlankToNull() {
        assertEquals("5YJ3E1EA7KF000001", VehicleHeaderProjection.vin("  5YJ3E1EA7KF000001 "))
        assertNull(VehicleHeaderProjection.vin(null))
        assertNull(VehicleHeaderProjection.vin("   "))
    }

    // ── Projection wiring + empty predicate ───────────────────────────────────────────────────────────

    @Test
    fun projectWiresEveryFieldFromTheRawInputs() {
        val model = VehicleHeaderProjection.project(data(status = "charging"))
        assertEquals("charging", model.statusLabel)
        assertEquals(VehicleStatusTone.Warning, model.statusTone)
        assertEquals("Model 3 Long Range", model.descriptor)
        assertEquals("5YJ3E1EA7KF000001", model.vin)
    }

    @Test
    fun modelIsNotEmptyForALoadedVehicle() {
        assertFalse(VehicleHeaderProjection.project(data()).isEmpty)
    }

    @Test
    fun modelIsEmptyOnlyWhenDescriptorAndVinAreBothAbsent() {
        val model = VehicleHeaderProjection.project(data(model = null, trimBadging = null, vin = null))
        assertTrue(model.isEmpty)
        assertNull(model.descriptor)
        assertNull(model.vin)
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
