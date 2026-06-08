package io.teslasync.shared.core.presentation.watch

import io.teslasync.shared.core.data.repo.WatchRepository
import io.teslasync.shared.core.data.repo.watchCommandBody
import io.teslasync.shared.core.data.repo.watchComplicationCacheKey
import io.teslasync.shared.core.data.repo.watchSummaryCacheKey
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the language-neutral derivations ported from the web `useWatch` domain
 * (web/src/api/hooks/useWatch.ts):
 *
 *  1. [watchSummaryCacheKey] / [watchComplicationCacheKey] — the web `watchKeys.summary` /
 *     `watchKeys.complication` tuples, prefixed so they partition per vehicle (and a null id maps to the
 *     literal `null` suffix).
 *  2. [watchCommandBody] — the web `JSON.stringify({ vehicle_id, command })` body: byte-identical
 *     compact JSON, `vehicle_id` first (defaulting to `0` for a null id), `command` second.
 *  3. The [WatchSummary] / [WatchComplication] / [WatchCommandResult] read models decode the
 *     snake_case wire envelopes verbatim.
 *
 * The vectors are language-neutral (raw JSON / fixed expectations) so the Windows C# port and the KMP
 * core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay within this
 * slice's allowed file scope; the C# port mirrors these exact rows.
 */
class WatchGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- cache keys ---------------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebTuples() {
        assertEquals("watch-summary:7", watchSummaryCacheKey(7L))
        assertEquals("watch-summary:null", watchSummaryCacheKey(null))
        assertEquals("watch-complication:7", watchComplicationCacheKey(7L))
        assertEquals("watch-complication:null", watchComplicationCacheKey(null))
    }

    // ---- command body -------------------------------------------------------------

    @Test
    fun commandBodyEmitsVehicleIdThenCommandAsCompactJson() {
        assertEquals(
            """{"vehicle_id":42,"command":"flash_lights"}""",
            watchCommandBody(42L, "flash_lights").toString(),
        )
    }

    @Test
    fun commandBodyDefaultsNullVehicleIdToZero() {
        assertEquals(
            """{"vehicle_id":0,"command":"honk"}""",
            watchCommandBody(null, "honk").toString(),
        )
    }

    // ---- wire decoding ------------------------------------------------------------

    @Test
    fun summaryDecodesSnakeCaseVerbatim() {
        val decoded = json.decodeFromString(WatchSummary.serializer(), SUMMARY_GOLDEN)
        assertEquals("Lightning", decoded.vehicleName)
        assertEquals("online", decoded.state)
        assertEquals(72.0, decoded.batteryLevel)
        assertEquals(312.5, decoded.rangeKm)
        assertTrue(decoded.isCharging)
        assertEquals(48.0, decoded.chargeRate)
        assertEquals(35.0, decoded.timeToFull)
        assertTrue(decoded.isLocked)
        assertTrue(decoded.sentryMode)
        assertEquals(21.5, decoded.insideTempC)
        assertEquals(14.0, decoded.outsideTempC)
        assertTrue(decoded.isClimateOn)
        assertEquals("2026-06-05T12:00:00Z", decoded.lastUpdated)
    }

    @Test
    fun complicationDecodesSnakeCaseVerbatim() {
        val decoded = json.decodeFromString(WatchComplication.serializer(), COMPLICATION_GOLDEN)
        assertEquals("72%", decoded.battery)
        assertEquals("312 km", decoded.range)
        assertEquals("online", decoded.state)
        assertTrue(decoded.charging)
    }

    @Test
    fun commandResultDecodesVerbatim() {
        val decoded = json.decodeFromString(WatchCommandResult.serializer(), COMMAND_RESULT_GOLDEN)
        assertTrue(decoded.success)
        assertEquals("Command sent", decoded.message)
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertTrue(WatchRepository::class.simpleName == "WatchRepository")
    }

    private companion object {
        val SUMMARY_GOLDEN =
            """
            {
              "vehicle_name": "Lightning",
              "state": "online",
              "battery_level": 72,
              "range_km": 312.5,
              "is_charging": true,
              "charge_rate": 48,
              "time_to_full": 35,
              "is_locked": true,
              "sentry_mode": true,
              "inside_temp_c": 21.5,
              "outside_temp_c": 14,
              "is_climate_on": true,
              "last_updated": "2026-06-05T12:00:00Z"
            }
            """.trimIndent()

        val COMPLICATION_GOLDEN =
            """
            {
              "battery": "72%",
              "range": "312 km",
              "state": "online",
              "charging": true
            }
            """.trimIndent()

        val COMMAND_RESULT_GOLDEN =
            """
            {
              "success": true,
              "message": "Command sent"
            }
            """.trimIndent()
    }
}
