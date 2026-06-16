package io.teslasync.android.admin.fleetapi

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.PollingConfig
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises the framework-free FleetAPIPage model derivations off-device (the web page's inline computations):
 * the `api_suspended` parse, the per-key polling-toggle read/flip, the enabled/total count, the retention
 * fallback, and the settings-document projection. Runs in the offline unit-test gate.
 */
class FleetAPIPageModelTest {
    @Test
    fun parseApiSuspendedReadsSnakeCaseTrue() {
        val doc = buildJsonObject { put("api_suspended", true) }
        assertTrue(parseApiSuspended(doc))
    }

    @Test
    fun parseApiSuspendedDefaultsFalseWhenAbsentOrNull() {
        assertFalse(parseApiSuspended(buildJsonObject { put("other", 1) }))
        assertFalse(parseApiSuspended(null))
    }

    @Test
    fun parseApiSuspendedToleratesCamelCaseMirror() {
        val doc = buildJsonObject { put("apiSuspended", true) }
        assertTrue(parseApiSuspended(doc))
    }

    @Test
    fun isEnabledReadsTheNamedFieldByWireKey() {
        val config = PollingConfig(chargeState = true, telemetryCapture = false)
        assertTrue(config.isEnabled(KEY_CHARGE_STATE))
        assertFalse(config.isEnabled(KEY_TELEMETRY_CAPTURE))
        assertFalse(config.isEnabled("unknown_key"))
    }

    @Test
    fun togglingFlipsExactlyTheNamedField() {
        val before = PollingConfig(chargeState = false, climateState = true)
        val after = before.toggling(KEY_CHARGE_STATE)
        assertTrue(after.chargeState)
        assertTrue(after.climateState)
    }

    @Test
    fun togglingAnUnknownKeyReturnsTheConfigUnchanged() {
        val config = PollingConfig(driveState = true)
        assertEquals(config, config.toggling("unknown_key"))
    }

    @Test
    fun totalToggleCountIsTwentyOne() {
        assertEquals(21, TOTAL_TOGGLE_COUNT)
        assertEquals(TOTAL_TOGGLE_COUNT, ALL_TOGGLE_KEYS.size)
        assertTrue(ALL_TOGGLE_KEYS.contains(KEY_TELEMETRY_CAPTURE))
    }

    @Test
    fun enabledToggleCountCountsOnlyTrackedKeys() {
        val config = PollingConfig(chargeState = true, wakeUp = true, telemetryCapture = true)
        assertEquals(3, config.enabledToggleCount())
    }

    @Test
    fun effectiveRetentionDaysFallsBackToSevenWhenZero() {
        assertEquals(DEFAULT_RETENTION_DAYS, PollingConfig(telemetryCaptureRetentionDays = 0).effectiveRetentionDays())
        assertEquals(14, PollingConfig(telemetryCaptureRetentionDays = 14).effectiveRetentionDays())
    }

    @Test
    fun retentionOptionsAreTheWebFiveInOrder() {
        assertEquals(listOf(1, 3, 7, 14, 30), RETENTION_DAY_OPTIONS)
    }

    @Test
    fun asSettingsSnapshotMapsSuccessAndPreservesParse() {
        val element: JsonElement = buildJsonObject { put("api_suspended", true) }
        val snapshot = Resource.Success(element, fetchedAt = 5L, stale = false).asSettingsSnapshot()
        assertTrue(snapshot is Resource.Success)
        assertTrue((snapshot as Resource.Success).data.apiSuspended)
        assertEquals(5L, snapshot.fetchedAt)
    }

    @Test
    fun asSettingsSnapshotKeepsErrorPhaseWithCachedValue() {
        val element: JsonElement = buildJsonObject { put("api_suspended", false) }
        val snapshot =
            Resource.Error(cached = element, fetchedAt = 1L, stale = true, error = RuntimeException("x")).asSettingsSnapshot()
        assertTrue(snapshot is Resource.Error)
        assertFalse((snapshot as Resource.Error).cached!!.apiSuspended)
    }
}
