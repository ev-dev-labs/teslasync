package io.teslasync.android.dashboardwidgets.systemhealth

import io.teslasync.android.components.datadisplay.SystemHealth
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
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Pure unit tests for the System Health model + projection — the data adapter the prompt requires.
 * Covers the overall-status bucketing, the four-service grid + level mapping from the `components` map,
 * the healthy-count derivation, the DB Size fallback chain, the Active Conns / Memory / Goroutines
 * formatting (incl. the absent-`memoryMB` em-dash the web also renders), the service-key humanization,
 * the resolved/empty truthiness, the badge + dot + error-kind mappings, and the registry
 * metadata/bounds. These run in the `:android:testReleaseUnitTest` gate with no device.
 */
class SystemHealthWidgetModelTest {
    private val locale = Locale.US

    /** A realistic `/system/health` body — top-level `status` + a `components` map (web `useSystemHealth`). */
    private fun health(
        status: String,
        components: Map<String, String> = DEFAULT_COMPONENTS,
        databaseSize: String? = null,
    ) = buildJsonObject {
        put("status", status)
        databaseSize?.let { put("database_size", it) }
        putJsonObject("components") {
            components.forEach { (name, value) -> putJsonObject(name) { put("status", value) } }
        }
    }

    // ── Projection: full payload ──────────────────────────────────────────────────

    @Test
    fun buildProjectsOverallServicesCountAndStats() {
        val health =
            health(
                status = "degraded",
                components =
                    mapOf(
                        "database" to "healthy",
                        "mqtt" to "healthy",
                        "tesla_api" to "degraded",
                        "fleet_telemetry" to "unhealthy",
                    ),
            )
        val dbStats = buildJsonObject { put("database_size", 1_288_490_188L) }
        val pool =
            buildJsonObject {
                put("in_use", 4)
                put("max_open", 25)
                put("goroutines", 148)
            }

        val data = SystemHealthProjection.build(health, dbStats, pool)

        assertTrue(data.hasData)
        assertEquals(SystemOverall.Degraded, data.overall)
        assertEquals(4, data.serviceCount)
        assertEquals(listOf("database", "mqtt", "tesla_api", "fleet_telemetry"), data.services.map { it.key })
        assertEquals(
            listOf(
                SystemServiceLevel.Ok,
                SystemServiceLevel.Ok,
                SystemServiceLevel.Degraded,
                SystemServiceLevel.Down,
            ),
            data.services.map { it.level },
        )
        assertEquals(2, data.healthyCount)
        assertEquals(4L, data.activeConns)
        assertEquals(25L, data.maxConns)
        assertEquals(148L, data.goroutines)
        // /system/health has no database_size, so the db-stats value (raw bytes) is the fallback (web behavior).
        assertEquals("1288490188", data.dbSize)
        // runtime-info emits no memory_mb / memoryMB ⇒ web renders the em-dash; we reproduce that.
        assertEquals(SYSTEM_HEALTH_EM_DASH, SystemHealthProjection.formatMemory(data.memoryMb, locale))
    }

    @Test
    fun buildMissingComponentsAreUnhealthyDots() {
        val health =
            buildJsonObject {
                put("status", "healthy")
                putJsonObject("components") { putJsonObject("database") { put("status", "healthy") } }
            }
        val data = SystemHealthProjection.build(health, null, null)

        // database ok; the other three are absent ⇒ web `?? 'unhealthy'` ⇒ Down dots.
        assertEquals(SystemServiceLevel.Ok, data.services.first { it.key == "database" }.level)
        assertEquals(SystemServiceLevel.Down, data.services.first { it.key == "mqtt" }.level)
        assertEquals(SystemServiceLevel.Down, data.services.first { it.key == "tesla_api" }.level)
        assertEquals(1, data.healthyCount)
        assertEquals(0L, data.activeConns)
        assertEquals(0L, data.maxConns)
        assertEquals(SYSTEM_HEALTH_EM_DASH, data.dbSize)
    }

    @Test
    fun buildResolvedMirrorsWebHasDataTruthiness() {
        assertTrue(SystemHealthProjection.build(health("healthy"), null, null).hasData)
        assertFalse(SystemHealthProjection.build(null, null, null).hasData)
        assertFalse(SystemHealthProjection.build(JsonNull, null, null).hasData)
        assertFalse(SystemHealthProjection.build(JsonPrimitive("nope"), null, null).hasData)
        assertFalse(SystemHealthData.EMPTY.hasData)
        assertEquals(4, SystemHealthData.EMPTY.serviceCount)
    }

    // ── DB Size fallback chain (web `health.databaseSize ?? dbStats.databaseSize ?? '—'`) ─────────

    @Test
    fun dbSizePrefersHealthThenDbStatsThenEmDash() {
        assertEquals("9.9 GB", SystemHealthProjection.build(health("healthy", databaseSize = "9.9 GB"), null, null).dbSize)
        val db = buildJsonObject { put("database_size", "3.3 GB") }
        assertEquals("3.3 GB", SystemHealthProjection.build(health("healthy"), db, null).dbSize)
        assertEquals(SYSTEM_HEALTH_EM_DASH, SystemHealthProjection.build(health("healthy"), null, null).dbSize)
    }

    // ── Overall + service-level mapping ─────────────────────────────────────────────

    @Test
    fun overallMatchesWebLabelMapping() {
        assertEquals(SystemOverall.Healthy, SystemHealthProjection.overallOf("healthy"))
        assertEquals(SystemOverall.Degraded, SystemHealthProjection.overallOf("degraded"))
        assertEquals(SystemOverall.Down, SystemHealthProjection.overallOf("unhealthy"))
        assertEquals(SystemOverall.Down, SystemHealthProjection.overallOf("unknown"))
        assertEquals(SystemOverall.Down, SystemHealthProjection.overallOf(null))
    }

    @Test
    fun serviceLevelMatchesWebStatusColor() {
        assertEquals(SystemServiceLevel.Ok, SystemHealthProjection.serviceLevelOf("ok"))
        assertEquals(SystemServiceLevel.Ok, SystemHealthProjection.serviceLevelOf("healthy"))
        assertEquals(SystemServiceLevel.Degraded, SystemHealthProjection.serviceLevelOf("degraded"))
        assertEquals(SystemServiceLevel.Down, SystemHealthProjection.serviceLevelOf("unhealthy"))
        assertEquals(SystemServiceLevel.Down, SystemHealthProjection.serviceLevelOf(null))
    }

    // ── Service-key humanization (web `t()` fallback) ───────────────────────────────

    @Test
    fun humanizeServiceKeyMatchesWebFallback() {
        assertEquals("Database", SystemHealthProjection.humanizeServiceKey("database"))
        assertEquals("Mqtt", SystemHealthProjection.humanizeServiceKey("mqtt"))
        assertEquals("Tesla Api", SystemHealthProjection.humanizeServiceKey("tesla_api"))
        assertEquals("Fleet Telemetry", SystemHealthProjection.humanizeServiceKey("fleet_telemetry"))
    }

    // ── Stat formatting ─────────────────────────────────────────────────────────────

    @Test
    fun formatActiveConnsMatchesWeb() {
        assertEquals("4/25", SystemHealthProjection.formatActiveConns(4, 25, locale))
        assertEquals("4", SystemHealthProjection.formatActiveConns(4, 0, locale))
        assertEquals("1,284/2,048", SystemHealthProjection.formatActiveConns(1284, 2048, locale))
    }

    @Test
    fun formatMemoryAndGoroutinesHandleNull() {
        assertEquals("312 MB", SystemHealthProjection.formatMemory(312, locale))
        assertEquals(SYSTEM_HEALTH_EM_DASH, SystemHealthProjection.formatMemory(null, locale))
        assertEquals("148", SystemHealthProjection.formatGoroutines(148, locale))
        assertEquals(SYSTEM_HEALTH_EM_DASH, SystemHealthProjection.formatGoroutines(null, locale))
    }

    @Test
    fun formatCountAppliesLocaleGrouping() {
        assertEquals("1,284", SystemHealthProjection.formatCount(1284, locale))
        assertEquals("0", SystemHealthProjection.formatCount(0, locale))
    }

    // ── Badge / dot / error-kind mappings ───────────────────────────────────────────

    @Test
    fun badgeVariantMapsOverall() {
        assertEquals(BadgeVariant.Success, systemOverallBadgeVariant(SystemOverall.Healthy))
        assertEquals(BadgeVariant.Warning, systemOverallBadgeVariant(SystemOverall.Degraded))
        assertEquals(BadgeVariant.Danger, systemOverallBadgeVariant(SystemOverall.Down))
    }

    @Test
    fun serviceDotMapsLevel() {
        assertEquals(SystemHealth.Healthy, systemServiceDot(SystemServiceLevel.Ok))
        assertEquals(SystemHealth.Degraded, systemServiceDot(SystemServiceLevel.Degraded))
        assertEquals(SystemHealth.Down, systemServiceDot(SystemServiceLevel.Down))
    }

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, systemHealthErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, systemHealthErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, systemHealthErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, systemHealthErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, systemHealthErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.ServerError, systemHealthErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, systemHealthErrorKind(ErrorKind.Unknown, null))
    }

    // ── Registry + footprint constraints ────────────────────────────────────────────

    @Test
    fun registrationMetadataMatchesWebRegistry() {
        assertEquals("system-health", SystemHealthRegistration.ID)
        assertEquals("system", SystemHealthRegistration.CATEGORY)
        assertEquals("SystemHealthWidget", SystemHealthRegistration.SLUG)
        assertEquals(SystemHealthSize(2, 4), SystemHealthRegistration.DEFAULT_SIZE)
        assertEquals(SystemHealthSize(1, 2), SystemHealthRegistration.MIN_SIZE)
        assertEquals(SystemHealthSize(4, 40), SystemHealthRegistration.MAX_SIZE)
    }

    @Test
    fun registrationBoundsAndClampHonourTheFootprint() {
        assertTrue(SystemHealthRegistration.isWithinBounds(SystemHealthSize(2, 4)))
        assertFalse(SystemHealthRegistration.isWithinBounds(SystemHealthSize(0, 4)))
        assertFalse(SystemHealthRegistration.isWithinBounds(SystemHealthSize(2, 41)))
        assertEquals(SystemHealthSize(1, 2), SystemHealthRegistration.clamp(SystemHealthSize(0, 0)))
        assertEquals(SystemHealthSize(4, 40), SystemHealthRegistration.clamp(SystemHealthSize(9, 99)))
    }

    @Test
    fun sizeDerivesCompact() {
        assertTrue(SystemHealthSize(1, 2).isCompact)
        assertFalse(SystemHealthSize(2, 4).isCompact)
    }

    private companion object {
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_SERVER_ERROR = 500

        val DEFAULT_COMPONENTS =
            mapOf(
                "database" to "healthy",
                "mqtt" to "healthy",
                "tesla_api" to "healthy",
                "fleet_telemetry" to "healthy",
            )
    }
}
