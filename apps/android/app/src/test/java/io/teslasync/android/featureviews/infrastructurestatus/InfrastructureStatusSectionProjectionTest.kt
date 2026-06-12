package io.teslasync.android.featureviews.infrastructurestatus

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure InfrastructureStatus data adapter — the field reads the web component
 * derives from its two `useQuery` payloads (`telemetry?.enabled` / `mode` / `endpoint` / `protocol` /
 * `speed_comparison.*` and the `extHealth?.database_pool` guard), the two-feed [combine], the emptiness
 * classification, the pool projection, and the integer formatter. Covers the web `latest`-undefined defaults,
 * a connected/polling snapshot, a connected/non-polling snapshot, and the absent-health branch. Run by the
 * offline `:app:testReleaseUnitTest` gate.
 */
class InfrastructureStatusSectionProjectionTest {
    private fun strings(): InfrastructureStatusStrings =
        InfrastructureStatusStrings(
            title = "Infrastructure",
            description = "SSE connections and polling engine diagnostics",
            connected = "Connected",
            disconnected = "Disconnected",
            sseConnection = "SSE Connection",
            connectionState = "Connection State",
            endpoint = "Endpoint",
            protocol = "Protocol",
            fallbackMode = "Fallback Mode",
            yesPolling = "Yes \u2014 Polling",
            no = "No",
            pollingEngine = "Polling Engine",
            active = "Active",
            standby = "Standby",
            mode = "Mode",
            speedComparison = "Speed Comparison",
            fleetTelemetryLatency = "Fleet Telemetry Latency",
            fleetApiPolling = "Fleet API Polling",
            totalConns = "Total Conns",
            acquired = "Acquired",
            idle = "Idle",
        )

    private val dash = InfrastructureStatusSectionProjection.EM_DASH

    // ── projection: empty (web telemetry-undefined defaults) ──────────────────────────
    @Test
    fun emptyPayloadRendersWebDefaults() {
        val display = InfrastructureStatusSectionProjection.project(InfrastructureStatusData(JsonNull, JsonNull), strings())

        assertFalse(display.sseConnected)
        assertEquals("Disconnected", display.connectionLabel)
        assertEquals(
            listOf(
                InfraStatusRow("Connection State", "Disconnected"),
                InfraStatusRow("Endpoint", dash),
                InfraStatusRow("Protocol", dash),
                InfraStatusRow("Fallback Mode", "No"),
            ),
            display.sseRows,
        )
        assertFalse(display.pollingActive)
        assertEquals("Standby", display.pollingLabel)
        assertEquals(
            listOf(
                InfraStatusRow("Mode", InfrastructureStatusSectionProjection.UNKNOWN_MODE),
                InfraStatusRow("Speed Comparison", dash),
                InfraStatusRow("Fleet Telemetry Latency", dash),
                InfraStatusRow("Fleet API Polling", dash),
            ),
            display.pollingRows,
        )
        assertNull(display.pool)
    }

    // ── projection: connected + polling fallback + pool ───────────────────────────────
    @Test
    fun connectedPollingSnapshotRendersValuesAndPool() {
        val data =
            InfrastructureStatusData(
                telemetry =
                    buildJsonObject {
                        put("enabled", true)
                        put("mode", "polling")
                        put("endpoint", "fleet-api.tesla.com")
                        put("protocol", "https")
                        put(
                            "speed_comparison",
                            buildJsonObject {
                                put("speedup", "3x faster")
                                put("fleet_telemetry_latency", "150 ms")
                                put("fleet_api_polling", "5 s")
                            },
                        )
                    },
                health =
                    buildJsonObject {
                        put(
                            "database_pool",
                            buildJsonObject {
                                put("total_conns", 25)
                                put("acquired_conns", 4)
                                put("idle_conns", 21)
                            },
                        )
                    },
            )

        val display = InfrastructureStatusSectionProjection.project(data, strings())

        assertTrue(display.sseConnected)
        assertEquals("Connected", display.connectionLabel)
        assertEquals("fleet-api.tesla.com", display.sseRows[1].value)
        assertEquals("https", display.sseRows[2].value)
        // mode === 'polling' → the localized fallback-mode value.
        assertEquals("Yes \u2014 Polling", display.sseRows[3].value)
        assertTrue(display.pollingActive)
        assertEquals("Active", display.pollingLabel)
        assertEquals("polling", display.pollingRows[0].value)
        assertEquals("3x faster", display.pollingRows[1].value)
        assertEquals("150 ms", display.pollingRows[2].value)
        assertEquals("5 s", display.pollingRows[3].value)
        assertEquals(PoolDisplay("25", "4", "21"), display.pool)
    }

    // ── projection: connected but not polling, no health ──────────────────────────────
    @Test
    fun connectedNonPollingSnapshotIsStandbyWithNoPool() {
        val data =
            InfrastructureStatusData(
                telemetry =
                    buildJsonObject {
                        put("enabled", true)
                        put("mode", "fleet_telemetry")
                        put("endpoint", "telemetry.tesla.com")
                    },
                health = JsonNull,
            )

        val display = InfrastructureStatusSectionProjection.project(data, strings())

        assertTrue(display.sseConnected)
        assertEquals("No", display.sseRows[3].value)
        // protocol absent → em-dash (web `?? '—'`).
        assertEquals(dash, display.sseRows[2].value)
        assertFalse(display.pollingActive)
        assertEquals("Standby", display.pollingLabel)
        assertEquals("fleet_telemetry", display.pollingRows[0].value)
        assertNull(display.pool)
    }

    // ── isEmpty classification ────────────────────────────────────────────────────────
    @Test
    fun isEmptyClassifiesBlankPayloads() {
        assertTrue(InfrastructureStatusSectionProjection.isEmpty(InfrastructureStatusData(null, null)))
        assertTrue(InfrastructureStatusSectionProjection.isEmpty(InfrastructureStatusData(JsonNull, JsonNull)))
        assertTrue(
            InfrastructureStatusSectionProjection.isEmpty(
                InfrastructureStatusData(JsonObject(emptyMap()), JsonObject(emptyMap())),
            ),
        )
        assertFalse(
            InfrastructureStatusSectionProjection.isEmpty(
                InfrastructureStatusData(buildJsonObject { put("enabled", true) }, null),
            ),
        )
        // A health-only payload still has content to show (the pool row).
        assertFalse(
            InfrastructureStatusSectionProjection.isEmpty(
                InfrastructureStatusData(null, buildJsonObject { put("database_pool", buildJsonObject { put("total_conns", 1) }) }),
            ),
        )
    }

    // ── poolOf ──────────────────────────────────────────────────────────────────────
    @Test
    fun poolOfReadsDatabasePoolOrNull() {
        assertNull(InfrastructureStatusSectionProjection.poolOf(null))
        assertNull(InfrastructureStatusSectionProjection.poolOf(JsonNull))
        assertNull(InfrastructureStatusSectionProjection.poolOf(buildJsonObject { put("status", "ok") }))
        val pool =
            InfrastructureStatusSectionProjection.poolOf(
                buildJsonObject {
                    put(
                        "database_pool",
                        buildJsonObject {
                            put("total_conns", 1000)
                            put("acquired_conns", 0)
                            put("idle_conns", 1000)
                        },
                    )
                },
            )
        assertEquals(PoolDisplay("1,000", "0", "1,000"), pool)
    }

    // ── formatConns ───────────────────────────────────────────────────────────────────
    @Test
    fun formatConnsGroupsThousands() {
        assertEquals("0", InfrastructureStatusSectionProjection.formatConns(0))
        assertEquals("25", InfrastructureStatusSectionProjection.formatConns(25))
        assertEquals("1,000", InfrastructureStatusSectionProjection.formatConns(1_000))
        assertEquals("1,948,223", InfrastructureStatusSectionProjection.formatConns(1_948_223))
    }

    // ── combine (two-feed composition) ─────────────────────────────────────────────────
    @Test
    fun combineSuccessFoldsBothPayloads() {
        val telemetry = buildJsonObject { put("enabled", true) }
        val health = buildJsonObject { put("database_pool", buildJsonObject { put("total_conns", 1) }) }
        val result =
            InfrastructureStatusSectionProjection.combine(
                telemetry = Resource.Success(telemetry, fetchedAt = 100L, stale = false),
                health = Resource.Success(health, fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Success)
        val data = (result as Resource.Success).data
        assertEquals(telemetry, data.telemetry)
        assertEquals(health, data.health)
    }

    @Test
    fun combineLoadingWithNoCacheStaysLoadingNull() {
        val result =
            InfrastructureStatusSectionProjection.combine(
                telemetry = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                health = Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )
        assertTrue(result is Resource.Loading)
        assertNull(result.cached)
    }

    @Test
    fun combineErrorWithCachedKeepsOfflinePayload() {
        val telemetry = buildJsonObject { put("enabled", true) }
        val health = buildJsonObject { put("database_pool", buildJsonObject { put("total_conns", 2) }) }
        val result =
            InfrastructureStatusSectionProjection.combine(
                telemetry = Resource.Error(cached = telemetry, fetchedAt = 100L, stale = true, error = ApiError.Network()),
                health = Resource.Success(health, fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Error)
        assertTrue(result.stale)
        val cached: InfrastructureStatusData? = result.cached
        assertEquals(telemetry, cached?.telemetry)
        assertEquals(health, cached?.health)
    }

    @Test
    fun combineDrivesPhaseOffTelemetryNotHealth() {
        // Telemetry succeeds, health hard-fails with no cache → still a success carrying a null pool source.
        val telemetry = buildJsonObject { put("enabled", true) }
        val result =
            InfrastructureStatusSectionProjection.combine(
                telemetry = Resource.Success(telemetry, fetchedAt = 100L, stale = false),
                health = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        assertTrue(result is Resource.Success)
        assertNull((result as Resource.Success).data.health)
    }
}
