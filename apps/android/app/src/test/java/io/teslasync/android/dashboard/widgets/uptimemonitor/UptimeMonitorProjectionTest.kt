package io.teslasync.android.dashboard.widgets.uptimemonitor

import io.teslasync.android.components.datadisplay.FreshnessAge
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

/**
 * Exercises the pure [UptimeMonitorProjection] + [UptimeHealth] parse + [UptimeMonitorRegistration]
 * off-device (no Compose, no Android), covering everything the web `UptimeMonitorWidget` derives: the
 * `/system/health` parse (overall status, per-service status with the `'unhealthy'` fallback, DB size +
 * table count incl. the camelCase variant + em-dash fallbacks), the `statusVariant` tone map, the
 * `services` memo + titleized labels, the healthy-count hero, the overall/per-service badge text
 * (healthy ⇒ "All OK"/"OK", else the raw token), the registry parity, and the folded compact TalkBack
 * description (the a11y-label check).
 */
class UptimeMonitorProjectionTest {
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("uptime-monitor", UptimeMonitorRegistration.ID)
        assertEquals("system", UptimeMonitorRegistration.CATEGORY)
        assertEquals("UptimeMonitorWidget", UptimeMonitorRegistration.SLUG)
        assertEquals(UptimeMonitorSize(2, 2), UptimeMonitorRegistration.DEFAULT_SIZE)
        assertEquals(UptimeMonitorSize(1, 2), UptimeMonitorRegistration.MIN_SIZE)
        assertEquals(UptimeMonitorSize(4, 40), UptimeMonitorRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsClampToTheRegistryConstraints() {
        assertTrue(UptimeMonitorRegistration.isWithinBounds(UptimeMonitorSize(2, 10)))
        assertFalse(UptimeMonitorRegistration.isWithinBounds(UptimeMonitorSize(0, 1)))
        assertFalse(UptimeMonitorRegistration.isWithinBounds(UptimeMonitorSize(5, 41)))
        assertEquals(UptimeMonitorSize(1, 2), UptimeMonitorRegistration.clamp(UptimeMonitorSize(0, 0)))
        assertEquals(UptimeMonitorSize(4, 40), UptimeMonitorRegistration.clamp(UptimeMonitorSize(9, 99)))
    }

    @Test
    fun sizeFlagsMatchTheWebBranches() {
        assertTrue(UptimeMonitorSize(1, 1).isCompact)
        assertFalse(UptimeMonitorSize(1, 1).isTall)
        assertFalse(UptimeMonitorSize(2, 2).isCompact)
        assertTrue(UptimeMonitorSize(2, 2).isTall)
        assertFalse(UptimeMonitorSize(1, 2).isCompact)
        assertTrue(UptimeMonitorSize(1, 2).isTall)
    }

    @Test
    fun titleizeReproducesTheWebFallback() {
        assertEquals("Database", UptimeMonitorProjection.titleizeServiceKey("database"))
        assertEquals("Mqtt", UptimeMonitorProjection.titleizeServiceKey("mqtt"))
        assertEquals("Tesla Api", UptimeMonitorProjection.titleizeServiceKey("tesla_api"))
        assertEquals("Fleet Telemetry", UptimeMonitorProjection.titleizeServiceKey("fleet_telemetry"))
    }

    @Test
    fun toneMatchesTheWebStatusVariant() {
        assertEquals(UptimeTone.Success, toneFor("ok"))
        assertEquals(UptimeTone.Success, toneFor("healthy"))
        assertEquals(UptimeTone.Success, toneFor("HEALTHY"))
        assertEquals(UptimeTone.Warning, toneFor("degraded"))
        assertEquals(UptimeTone.Danger, toneFor("unhealthy"))
        assertEquals(UptimeTone.Danger, toneFor("unknown"))
        assertTrue(isOkOrHealthy("ok"))
        assertTrue(isOkOrHealthy("healthy"))
        assertFalse(isOkOrHealthy("degraded"))
    }

    @Test
    fun parseReadsOverallComponentsSizeAndCount() {
        val json =
            buildJsonObject {
                put("status", "degraded")
                putJsonObject("components") {
                    putJsonObject("database") { put("status", "healthy") }
                    putJsonObject("mqtt") { put("status", "degraded") }
                    putJsonObject("tesla_api") { put("status", "unhealthy") }
                    // fleet_telemetry intentionally omitted → falls back to 'unhealthy'.
                }
                put("database_size", "1.4 GB")
                put("table_count", 87)
            }

        val health = UptimeHealth.parse(json)!!

        assertEquals("degraded", health.overallStatus)
        assertEquals("healthy", health.serviceStatus("database"))
        assertEquals("degraded", health.serviceStatus("mqtt"))
        assertEquals("unhealthy", health.serviceStatus("tesla_api"))
        assertEquals("unhealthy", health.serviceStatus("fleet_telemetry"))
        assertEquals("1.4 GB", health.databaseSize)
        assertEquals(87L, health.tableCount)
    }

    @Test
    fun parseToleratesCamelCaseSizeAndCount() {
        val json =
            buildJsonObject {
                put("status", "healthy")
                put("databaseSize", "2 GB")
                put("tableCount", 5)
            }

        val health = UptimeHealth.parse(json)!!

        assertEquals("2 GB", health.databaseSize)
        assertEquals(5L, health.tableCount)
    }

    @Test
    fun parseReturnsNullForAbsentOrNonObjectPayloads() {
        assertNull(UptimeHealth.parse(null))
        assertNull(UptimeHealth.parse(JsonNull))
        assertNull(UptimeHealth.parse(JsonPrimitive("not-an-object")))
    }

    @Test
    fun parseDefaultsOverallToUnknownAndSizeCountToNull() {
        val health = UptimeHealth.parse(buildJsonObject {})!!

        assertEquals("unknown", health.overallStatus)
        assertNull(health.databaseSize)
        assertNull(health.tableCount)
        assertEquals("unhealthy", health.serviceStatus("database"))
    }

    @Test
    fun projectBuildsAllFourServiceRowsInWebOrder() {
        val display = UptimeMonitorProjection.project(allHealthy(), strings(), UptimeMonitorSize(2, 2))

        assertEquals(listOf("database", "mqtt", "tesla_api", "fleet_telemetry"), display.services.map { it.key })
        assertEquals(listOf("Database", "Mqtt", "Tesla Api", "Fleet Telemetry"), display.services.map { it.label })
    }

    @Test
    fun projectHealthyOverallShowsAllOkAndGreenServices() {
        val display = UptimeMonitorProjection.project(allHealthy(), strings(), UptimeMonitorSize(2, 2))

        assertEquals("All OK", display.overallBadgeLabel)
        assertEquals(UptimeTone.Success, display.overallTone)
        assertEquals(4, display.healthyCount)
        assertEquals(4, display.serviceCount)
        assertEquals("4/4", display.countLabel)
        display.services.forEach { row ->
            assertEquals("OK", row.badgeLabel)
            assertEquals(UptimeTone.Success, row.tone)
        }
    }

    @Test
    fun projectNonHealthyShowsRawStatusTokenVerbatim() {
        val health =
            UptimeHealth(
                overallStatus = "degraded",
                componentStatuses =
                    mapOf(
                        "database" to "healthy",
                        "mqtt" to "degraded",
                        "tesla_api" to "unhealthy",
                        "fleet_telemetry" to "ok",
                    ),
                databaseSize = null,
                tableCount = null,
            )

        val display = UptimeMonitorProjection.project(health, strings(), UptimeMonitorSize(2, 2))

        // Overall: non-healthy → raw token (web `overallStatus`), warning tone.
        assertEquals("degraded", display.overallBadgeLabel)
        assertEquals(UptimeTone.Warning, display.overallTone)
        // Per-service: ok/healthy → "OK", else the raw status token.
        val byKey = display.services.associateBy { it.key }
        assertEquals("OK", byKey.getValue("database").badgeLabel)
        assertEquals("degraded", byKey.getValue("mqtt").badgeLabel)
        assertEquals("unhealthy", byKey.getValue("tesla_api").badgeLabel)
        assertEquals("OK", byKey.getValue("fleet_telemetry").badgeLabel)
        // healthyCount counts ok + healthy only (database + fleet_telemetry).
        assertEquals(2, display.healthyCount)
        assertEquals("2/4", display.countLabel)
    }

    @Test
    fun projectFallsBackToEmDashForMissingSizeAndCount() {
        val health = allHealthy(databaseSize = null, tableCount = null)
        val display = UptimeMonitorProjection.project(health, strings(), UptimeMonitorSize(2, 2))

        assertEquals(UPTIME_EM_DASH, display.databaseSize)
        assertEquals(UPTIME_EM_DASH, display.tableCount)
    }

    @Test
    fun projectFormatsSizeAndCountWhenPresent() {
        val health = allHealthy(databaseSize = "1.4 GB", tableCount = 87L)
        val display = UptimeMonitorProjection.project(health, strings(), UptimeMonitorSize(2, 4))

        assertEquals("1.4 GB", display.databaseSize)
        assertEquals("87", display.tableCount)
        assertTrue(display.isTall)
    }

    @Test
    fun overallContentDescriptionFoldsOverallAndCount() {
        val display = UptimeMonitorProjection.project(allHealthy(), strings(), UptimeMonitorSize(1, 1))

        assertTrue(display.isCompact)
        assertEquals("Overall, All OK, 4/4", display.overallContentDescription)
    }

    private companion object {
        fun allHealthy(
            databaseSize: String? = "1.4 GB",
            tableCount: Long? = 87L,
        ): UptimeHealth =
            UptimeHealth(
                overallStatus = "healthy",
                componentStatuses =
                    mapOf(
                        "database" to "healthy",
                        "mqtt" to "healthy",
                        "tesla_api" to "healthy",
                        "fleet_telemetry" to "healthy",
                    ),
                databaseSize = databaseSize,
                tableCount = tableCount,
            )

        fun strings(): UptimeMonitorStrings =
            UptimeMonitorStrings(
                title = "Uptime Monitor",
                overall = "Overall",
                allOk = "All OK",
                ok = "OK",
                dbSize = "DB Size",
                tables = "Tables",
                noData = "No system health data",
                refreshLabel = "Refresh",
                refreshingLabel = "Loading\u2026",
                offlineLabel = "Offline",
                formatRelative = { age ->
                    when (age) {
                        FreshnessAge.Unknown -> UPTIME_EM_DASH
                        FreshnessAge.JustNow -> "just now"
                        is FreshnessAge.Seconds -> "${age.value}s"
                        is FreshnessAge.Minutes -> "${age.value}m"
                        is FreshnessAge.Hours -> "${age.value}h"
                        is FreshnessAge.Days -> "${age.value}d"
                        is FreshnessAge.Weeks -> "${age.value}w"
                    }
                },
            )
    }
}
