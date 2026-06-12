package io.teslasync.android.featureviews.servicehealth

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device unit tests for the pure Service Health model + projection (the gate's "adapter unit test").
 * Covers the `/telemetry` parse (enabled / mode / aggregate figures / the streaming-vehicle rows,
 * snake_case + camelCase tolerance, the no-data fallback), the active-count derivation, the web helper ports
 * (`fmtInt`, `fmtNumber`, `formatDateTime`, the streaming/enabled badge tone), the signal-count column sort,
 * and the error-kind classifier — every branch the composable renders, verified without a device.
 */
class ServiceHealthProjectionTest {
    private val utc = ZoneId.of("UTC")

    private fun fullTelemetry() =
        buildJsonObject {
            put("enabled", true)
            put("mode", "fleet_telemetry")
            putJsonObject("aggregate_stats") {
                put("total_signals_received", 27_762)
                put("avg_signals_per_second", "6.9")
            }
            putJsonObject("streaming_vehicles") {
                putJsonObject("5YJ3E1EA7KF000001") {
                    put("vin", "5YJ3E1EA7KF000001")
                    put("is_streaming", true)
                    put("signal_count", 18_240)
                    put("signals_per_second", 4.2)
                    put("latency_ms", 38)
                    put("last_received", "2023-11-14T22:13:20Z")
                }
                putJsonObject("5YJ3E1EA7KF000002") {
                    put("vin", "5YJ3E1EA7KF000002")
                    put("is_streaming", false)
                    put("signal_count", 412)
                }
            }
        }

    // ── build: full payload ─────────────────────────────────────────────────────
    @Test
    fun buildParsesEveryFieldFromAResolvedObject() {
        val data = ServiceHealthProjection.build(fullTelemetry())
        assertTrue(data.resolved)
        assertTrue(data.hasData)
        assertTrue(data.enabled)
        assertEquals("fleet_telemetry", data.mode)
        assertEquals(27_762L, data.totalSignals)
        assertEquals("6.9", data.avgSignalsPerSecond)
        assertEquals(2, data.vehicles.size)
        assertEquals(1, data.activeCount)

        val first = data.vehicles.first()
        assertEquals("5YJ3E1EA7KF000001", first.vin)
        assertTrue(first.isStreaming)
        assertEquals(18_240L, first.signalCount)
        assertEquals(4.2, first.signalsPerSecond, 0.0001)
        assertEquals(38.0, first.latencyMs, 0.0001)
        assertEquals("2023-11-14T22:13:20Z", first.lastReceived)
    }

    // ── build: non-object payloads ⇒ the no-data projection (web `data == null`) ──
    @Test
    fun buildOnNullOrScalarYieldsEmptyUnresolved() {
        for (element in listOf(null, JsonNull, JsonPrimitive(5), JsonPrimitive("x"))) {
            val data = ServiceHealthProjection.build(element)
            assertFalse(data.resolved)
            assertFalse(data.hasData)
            assertFalse(data.enabled)
            assertEquals(0, data.activeCount)
            assertTrue(data.vehicles.isEmpty())
        }
    }

    // ── build: missing fields ⇒ the web defaults (`?? 0`, `?? '0'`, no vehicles) ──
    @Test
    fun buildAppliesWebDefaultsForMissingFields() {
        val data = ServiceHealthProjection.build(buildJsonObject { put("mode", "polling") })
        assertFalse(data.enabled)
        assertEquals("polling", data.mode)
        assertEquals(0L, data.totalSignals)
        assertEquals(SERVICE_HEALTH_DEFAULT_AVG, data.avgSignalsPerSecond)
        assertTrue(data.vehicles.isEmpty())
        assertTrue(data.resolved)
    }

    // ── build: camelCase tolerance (post-`camelCaseKeys` shapes) ──────────────────
    @Test
    fun buildAcceptsCamelCaseKeys() {
        val camel =
            buildJsonObject {
                put("enabled", true)
                putJsonObject("aggregateStats") {
                    put("totalSignalsReceived", 100)
                    put("avgSignalsPerSecond", "2.5")
                }
                putJsonObject("streamingVehicles") {
                    putJsonObject("v1") {
                        put("vin", "VINCAMEL1")
                        put("isStreaming", true)
                        put("signalCount", 7)
                        put("signalsPerSecond", 1.5)
                        put("latencyMs", 12)
                        put("lastReceived", "2023-11-14T22:13:20Z")
                    }
                }
            }
        val data = ServiceHealthProjection.build(camel)
        assertEquals(100L, data.totalSignals)
        assertEquals("2.5", data.avgSignalsPerSecond)
        assertEquals(1, data.vehicles.size)
        val v = data.vehicles.first()
        assertEquals("VINCAMEL1", v.vin)
        assertTrue(v.isStreaming)
        assertEquals(7L, v.signalCount)
        assertEquals(1.5, v.signalsPerSecond, 0.0001)
        assertEquals(12.0, v.latencyMs, 0.0001)
    }

    // ── sortVehicles (web `sortable` on `signal_count`) ───────────────────────────
    @Test
    fun sortVehiclesOrdersBySignalCountWhenColumnActive() {
        val rows = ServiceHealthProjection.build(fullTelemetry()).vehicles
        val unsorted = ServiceHealthProjection.sortVehicles(rows, SortState())
        assertEquals(listOf(18_240L, 412L), unsorted.map { it.signalCount })

        val descending = ServiceHealthProjection.sortVehicles(rows, SortState(SERVICE_HEALTH_SIGNAL_COUNT_KEY, SortDirection.Desc))
        assertEquals(listOf(18_240L, 412L), descending.map { it.signalCount })

        val ascending = ServiceHealthProjection.sortVehicles(rows, SortState(SERVICE_HEALTH_SIGNAL_COUNT_KEY, SortDirection.Asc))
        assertEquals(listOf(412L, 18_240L), ascending.map { it.signalCount })
    }

    @Test
    fun sortVehiclesLeavesOrderUnchangedForOtherColumns() {
        val rows = ServiceHealthProjection.build(fullTelemetry()).vehicles
        val sorted = ServiceHealthProjection.sortVehicles(rows, SortState("vin", SortDirection.Asc))
        assertEquals(rows.map { it.vin }, sorted.map { it.vin })
    }

    // ── badge tone (web `variant={… ? 'success' : 'neutral'}`) ────────────────────
    @Test
    fun badgeVariantsMapStreamingAndEnabled() {
        assertEquals(BadgeVariant.Success, ServiceHealthProjection.enabledBadgeVariant(true))
        assertEquals(BadgeVariant.Neutral, ServiceHealthProjection.enabledBadgeVariant(false))
        assertEquals(BadgeVariant.Success, ServiceHealthProjection.streamingBadgeVariant(true))
        assertEquals(BadgeVariant.Neutral, ServiceHealthProjection.streamingBadgeVariant(false))
    }

    // ── formatters (web fmtInt / fmtNumber / formatDateTime) ──────────────────────
    @Test
    fun formatCountGroupsWithLocale() {
        assertEquals("1,234", ServiceHealthProjection.formatCount(1_234L, Locale.US))
        assertEquals("0", ServiceHealthProjection.formatCount(0L, Locale.US))
    }

    @Test
    fun formatThroughputUsesOneDecimal() {
        assertEquals("4.2", ServiceHealthProjection.formatThroughput(4.2, Locale.US))
        assertEquals("0.0", ServiceHealthProjection.formatThroughput(0.0, Locale.US))
    }

    @Test
    fun formatLatencyAppendsMilliseconds() {
        assertEquals("38 ms", ServiceHealthProjection.formatLatency(38.0, Locale.US))
        assertEquals("0 ms", ServiceHealthProjection.formatLatency(0.0, Locale.US))
    }

    @Test
    fun formatLastReceivedFormatsInstantOrEmDash() {
        assertEquals("Nov 14, 2023, 10:13 PM", ServiceHealthProjection.formatLastReceived("2023-11-14T22:13:20Z", utc, Locale.US))
        assertEquals("\u2014", ServiceHealthProjection.formatLastReceived(null, utc, Locale.US))
        assertEquals("\u2014", ServiceHealthProjection.formatLastReceived("", utc, Locale.US))
        assertEquals("\u2014", ServiceHealthProjection.formatLastReceived("not-a-date", utc, Locale.US))
    }

    // ── error-kind classification ─────────────────────────────────────────────────
    @Test
    fun errorKindClassifiesNetworkAsOfflineAndHttpByStatus() {
        assertEquals(QueryErrorKind.Offline, serviceHealthErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.NotFound, serviceHealthErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, serviceHealthErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, serviceHealthErrorKind(ErrorKind.CircuitOpen, null))
    }

    // ── EMPTY constant + registration ──────────────────────────────────────────────
    @Test
    fun emptyConstantIsUnresolved() {
        assertFalse(ServiceHealthData.EMPTY.hasData)
        assertEquals(0, ServiceHealthData.EMPTY.activeCount)
        assertEquals(SERVICE_HEALTH_DEFAULT_AVG, ServiceHealthData.EMPTY.avgSignalsPerSecond)
    }

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("service-health-section", ServiceHealthSectionRegistration.ID)
        assertEquals("ServiceHealthSection", ServiceHealthSectionRegistration.SLUG)
    }
}
