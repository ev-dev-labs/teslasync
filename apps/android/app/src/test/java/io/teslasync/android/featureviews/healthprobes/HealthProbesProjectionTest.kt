package io.teslasync.android.featureviews.healthprobes

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device unit tests for the pure Health Probes model + projection (the gate's "adapter unit test").
 * Covers the `/system/health` parse (liveness/database statuses, goroutines, uptime, optional latency, pool
 * connections, snake_case + camelCase tolerance, the no-data fallback), the web helper ports
 * (`statusToBadgeVariant`, `formatUptime`, `fmtInt`, `fmtNumber`) and the error-kind classifier — every
 * branch the composable renders, verified without a device.
 */
class HealthProbesProjectionTest {
    private fun fullHealth() =
        buildJsonObject {
            put("status", "healthy")
            putJsonObject("database") {
                put("status", "ok")
                put("latency_ms", 2.5)
            }
            putJsonObject("database_pool") { put("total_conns", 12) }
            putJsonObject("system") {
                put("goroutines", 148)
                put("uptime_seconds", 93_784)
            }
        }

    // ── build: full payload ─────────────────────────────────────────────────────
    @Test
    fun buildParsesEveryFieldFromAResolvedObject() {
        val data = HealthProbesProjection.build(fullHealth())
        assertTrue(data.resolved)
        assertTrue(data.hasData)
        assertEquals("healthy", data.livenessStatus)
        assertEquals("ok", data.dbStatus)
        assertEquals(148L, data.goroutines)
        assertEquals(93_784L, data.uptimeSeconds)
        assertEquals(2.5, data.dbLatencyMs!!, 0.0001)
        assertEquals(12L, data.poolTotalConns)
    }

    // ── build: non-object payloads ⇒ the no-data projection (web `data == null`) ──
    @Test
    fun buildOnNullOrScalarYieldsEmptyUnresolved() {
        for (element in listOf(null, JsonNull, JsonPrimitive(5), JsonPrimitive("x"))) {
            val data = HealthProbesProjection.build(element)
            assertFalse(data.resolved)
            assertFalse(data.hasData)
            assertEquals(HEALTH_PROBES_UNKNOWN_STATUS, data.livenessStatus)
            assertEquals(HEALTH_PROBES_UNKNOWN_STATUS, data.dbStatus)
            assertEquals(0L, data.goroutines)
            assertNull(data.dbLatencyMs)
        }
    }

    // ── build: missing fields ⇒ the web defaults (`?? 'unknown'`, `?? 0`, latency null) ──
    @Test
    fun buildAppliesWebDefaultsForMissingFields() {
        val data = HealthProbesProjection.build(buildJsonObject { put("status", "degraded") })
        assertEquals("degraded", data.livenessStatus)
        assertEquals(HEALTH_PROBES_UNKNOWN_STATUS, data.dbStatus)
        assertEquals(0L, data.goroutines)
        assertEquals(0L, data.uptimeSeconds)
        assertNull(data.dbLatencyMs)
        assertEquals(0L, data.poolTotalConns)
        assertTrue(data.resolved)
    }

    // ── build: camelCase tolerance (post-`camelCaseKeys` shapes) ──────────────────
    @Test
    fun buildAcceptsCamelCaseKeys() {
        val camel =
            buildJsonObject {
                put("status", "healthy")
                putJsonObject("database") { put("latencyMs", 4.0) }
                putJsonObject("databasePool") { put("totalConns", 7) }
                putJsonObject("system") { put("uptimeSeconds", 60) }
            }
        val data = HealthProbesProjection.build(camel)
        assertEquals(4.0, data.dbLatencyMs!!, 0.0001)
        assertEquals(7L, data.poolTotalConns)
        assertEquals(60L, data.uptimeSeconds)
    }

    // ── statusBadgeVariant (web statusToBadgeVariant) ─────────────────────────────
    @Test
    fun statusBadgeVariantMapsEveryBucketCaseInsensitively() {
        for (s in listOf("healthy", "OK", "online", "Ready", "sent", "completed")) {
            assertEquals(BadgeVariant.Success, HealthProbesProjection.statusBadgeVariant(s))
        }
        for (s in listOf("degraded", "Warning", "pending", "queued", "processing")) {
            assertEquals(BadgeVariant.Warning, HealthProbesProjection.statusBadgeVariant(s))
        }
        for (s in listOf("unhealthy", "Offline", "error", "down", "failed")) {
            assertEquals(BadgeVariant.Danger, HealthProbesProjection.statusBadgeVariant(s))
        }
        for (s in listOf("unknown", "", "weird")) {
            assertEquals(BadgeVariant.Neutral, HealthProbesProjection.statusBadgeVariant(s))
        }
    }

    // ── formatUptime (web formatUptime) ───────────────────────────────────────────
    @Test
    fun formatUptimeMatchesWebBranches() {
        assertEquals("1d 2h 3m", HealthProbesProjection.formatUptime(93_784L))
        assertEquals("2h 3m", HealthProbesProjection.formatUptime(7_384L))
        assertEquals("3m", HealthProbesProjection.formatUptime(184L))
        assertEquals("0m", HealthProbesProjection.formatUptime(0L))
        assertEquals("0m", HealthProbesProjection.formatUptime(-5L))
    }

    // ── formatCount / formatLatency (web fmtInt / fmtNumber) ──────────────────────
    @Test
    fun formatCountGroupsWithLocale() {
        assertEquals("1,234", HealthProbesProjection.formatCount(1_234L, Locale.US))
        assertEquals("0", HealthProbesProjection.formatCount(0L, Locale.US))
    }

    @Test
    fun formatLatencyShowsValueWithUnitOrEmDash() {
        assertEquals("2.4 ms", HealthProbesProjection.formatLatency(2.4, Locale.US))
        assertEquals("\u2014", HealthProbesProjection.formatLatency(null, Locale.US))
    }

    // ── error-kind classification ─────────────────────────────────────────────────
    @Test
    fun errorKindClassifiesNetworkAsOfflineAndHttpByStatus() {
        assertEquals(QueryErrorKind.Offline, healthProbesErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.NotFound, healthProbesErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, healthProbesErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, healthProbesErrorKind(ErrorKind.CircuitOpen, null))
    }

    // ── EMPTY constant ─────────────────────────────────────────────────────────────
    @Test
    fun emptyConstantIsUnresolved() {
        assertFalse(HealthProbesData.EMPTY.hasData)
        assertEquals(HEALTH_PROBES_UNKNOWN_STATUS, HealthProbesData.EMPTY.livenessStatus)
    }
}
