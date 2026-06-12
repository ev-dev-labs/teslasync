package io.teslasync.android.featureviews.backendstatussection

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the BackendStatusSection pure logic — the snake-case JSON decode of all three
 * feeds, the component-row mapping + status colour band + healthy-count badge, the connection-pool stat
 * tiles, the runtime KVList with its `version ?? extHealth.system ?? fallback` chain, the sortable-column
 * client sort, the uptime / integer / last-check formatting, the structural empty guard, and the PII-safe
 * `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/system/components/status/BackendStatusSection.tsx).
 */
class BackendStatusSectionProjectionTest {
    private val strings =
        BackendStatusSectionStrings(
            title = "Backend Status",
            description = "desc",
            healthy = "healthy",
            componentHealth = "Component Health",
            databaseConnectionPool = "Database Connection Pool",
            systemRuntime = "System Runtime",
            noComponentsFound = "No components found",
            colStatus = "Status",
            colComponent = "Component",
            colLatency = "Latency",
            colFailures = "Failures",
            colLastCheck = "Last Check",
            maxOpen = "Max Open",
            open = "Open",
            inUse = "In Use",
            idle = "Idle",
            waitCount = "Wait Count",
            goVersion = "Go Version",
            uptime = "Uptime",
            goroutines = "Goroutines",
            osArch = "OS / Arch",
            refresh = "Refresh",
            refreshing = "Loading...",
            offline = "Offline",
            loading = "Loading...",
            emptyMessage = "No data available",
        )

    private val locale = Locale.US
    private val zone = ZoneOffset.UTC

    private fun healthJson() =
        buildJsonObject {
            put("status", "degraded")
            putJsonObject("components") {
                putJsonObject("database") {
                    put("status", "ok")
                    put("latency_ms", 1.4)
                    put("consecutive_failures", 0)
                    put("last_check", "2026-06-11T12:00:00Z")
                }
                putJsonObject("tesla_api") {
                    put("status", "degraded")
                    put("latency_ms", 142.0)
                    put("consecutive_failures", 3)
                    put("last_check", "")
                }
                putJsonObject("fleet_telemetry") {
                    put("status", "down")
                    put("consecutive_failures", 11)
                }
            }
            putJsonObject("system") {
                put("go_version", "go1.25")
                put("uptime_seconds", 271_440)
                put("goroutines", 84)
            }
        }

    private fun poolJson() =
        buildJsonObject {
            put("max_open", 25)
            put("open", 7)
            put("in_use", 2)
            put("idle", 5)
            put("wait_count", 0)
        }

    private fun versionJson() =
        buildJsonObject {
            put("go_version", "go1.25")
            put("os", "linux")
            put("arch", "amd64")
        }

    private fun fullData() = BackendStatusData.from(healthJson(), poolJson(), versionJson())

    @Test
    fun parsesComponentsInWireOrderWithDefaults() {
        val data = fullData()
        val rows = data.health?.components.orEmpty()
        assertEquals(listOf("database", "tesla_api", "fleet_telemetry"), rows.map { it.name })
        // fleet_telemetry has no latency_ms / last_check ⇒ defaults (web `?? 0` / `?? ''`).
        val fleet = rows.first { it.name == "fleet_telemetry" }
        assertEquals(0.0, fleet.latencyMs, 0.0)
        assertEquals(11L, fleet.failures)
        assertEquals("", fleet.lastCheck)
    }

    @Test
    fun statusToneMatchesWebColourSwitch() {
        assertEquals(StatusTone.Ok, statusToneFor("ok"))
        assertEquals(StatusTone.Ok, statusToneFor("HEALTHY"))
        assertEquals(StatusTone.Warn, statusToneFor("degraded"))
        assertEquals(StatusTone.Down, statusToneFor("down"))
        assertEquals(StatusTone.Neutral, statusToneFor("something-else"))
    }

    @Test
    fun healthyCountAndBadgeMirrorWeb() {
        val display = BackendStatusProjection.project(fullData(), strings, locale = locale, zone = zone)
        // Only `database` is exactly ok/healthy (web `okCount` is exact, not the broader tone band).
        assertEquals(1, display.okCount)
        assertEquals(3, display.total)
        assertEquals("1/3 healthy", display.badgeLabel)
        assertFalse(display.allHealthy)
    }

    @Test
    fun allHealthyBadgeWhenEveryComponentOk() {
        val allOk =
            buildJsonObject {
                putJsonObject("components") {
                    putJsonObject("database") { put("status", "ok") }
                    putJsonObject("mqtt") { put("status", "healthy") }
                }
            }
        val display = BackendStatusProjection.project(BackendStatusData.from(allOk, null, null), strings, locale = locale, zone = zone)
        assertEquals("2/2 healthy", display.badgeLabel)
        assertTrue(display.allHealthy)
    }

    @Test
    fun nullBadgeWhenNoComponents() {
        val display = BackendStatusProjection.project(BackendStatusData.from(null, poolJson(), null), strings, locale = locale, zone = zone)
        assertNull(display.badgeLabel)
    }

    @Test
    fun formatsLatencyFailuresAndLastCheck() {
        val display = BackendStatusProjection.project(fullData(), strings, locale = locale, zone = zone)
        val database = display.rows.first { it.name == "database" }
        assertEquals("1.4 ms", database.latencyText)
        assertEquals("0", database.failuresText)
        assertFalse(database.failuresIsError)
        assertTrue(database.lastCheckText.contains("2026"))

        val tesla = display.rows.first { it.name == "tesla_api" }
        assertEquals("3", tesla.failuresText)
        assertTrue(tesla.failuresIsError)
        // Empty last_check ⇒ em-dash (web `row.lastCheck ? formatDateTime : '—'`).
        assertEquals(EM_DASH, tesla.lastCheckText)
    }

    @Test
    fun poolStatsCarryEveryTileFormatted() {
        val display = BackendStatusProjection.project(fullData(), strings, locale = locale, zone = zone)
        val stats = display.poolStats
        assertEquals(5, stats?.size)
        assertEquals(listOf("Max Open", "Open", "In Use", "Idle", "Wait Count"), stats?.map { it.label })
        assertEquals("25", stats?.first { it.key == "max_open" }?.value)
        assertEquals("0", stats?.first { it.key == "wait_count" }?.value)
    }

    @Test
    fun poolSectionHiddenWhenNoPool() {
        val display =
            BackendStatusProjection.project(
                BackendStatusData.from(healthJson(), null, null),
                strings,
                locale = locale,
                zone = zone,
            )
        assertNull(display.poolStats)
    }

    @Test
    fun runtimeFallsThroughVersionThenSystem() {
        // version carries os/arch/go_version but NOT uptime_seconds/goroutines ⇒ those fall to extHealth.system.
        val display = BackendStatusProjection.project(fullData(), strings, locale = locale, zone = zone)
        val items = display.runtimeItems.orEmpty().associate { it.label to it.value }
        assertEquals("go1.25", items["Go Version"])
        assertEquals("3d 3h 24m", items["Uptime"]) // 271_440 s = 3d 3h 24m, from system (version lacks it)
        assertEquals("84", items["Goroutines"]) // from system
        assertEquals("linux / amd64", items["OS / Arch"])
    }

    @Test
    fun runtimePrefersVersionUptimeWhenPresent() {
        val versionWithUptime =
            buildJsonObject {
                put("go_version", "go1.25")
                put("os", "linux")
                put("arch", "amd64")
                put("uptime_seconds", 90)
                put("goroutines", 7)
            }
        val display =
            BackendStatusProjection.project(
                BackendStatusData.from(healthJson(), null, versionWithUptime),
                strings,
                locale = locale,
                zone = zone,
            )
        val items = display.runtimeItems.orEmpty().associate { it.label to it.value }
        assertEquals("1m", items["Uptime"]) // 90 s from version wins over system's 271_440
        assertEquals("7", items["Goroutines"])
    }

    @Test
    fun runtimeSectionHiddenWhenNoSystemAndNoVersion() {
        val noSystem = buildJsonObject { putJsonObject("components") { putJsonObject("db") { put("status", "ok") } } }
        val display = BackendStatusProjection.project(BackendStatusData.from(noSystem, null, null), strings, locale = locale, zone = zone)
        assertNull(display.runtimeItems)
    }

    @Test
    fun sortByNameAscendingAndDescending() {
        val rows = fullData().health?.components.orEmpty()
        val asc = BackendStatusProjection.sortRows(rows, SortState(BackendStatusColumns.NAME, SortDirection.Asc))
        assertEquals(listOf("database", "fleet_telemetry", "tesla_api"), asc.map { it.name })
        val desc = BackendStatusProjection.sortRows(rows, SortState(BackendStatusColumns.NAME, SortDirection.Desc))
        assertEquals(listOf("tesla_api", "fleet_telemetry", "database"), desc.map { it.name })
    }

    @Test
    fun sortByLatencyAndFailures() {
        val rows = fullData().health?.components.orEmpty()
        val latencyAsc = BackendStatusProjection.sortRows(rows, SortState(BackendStatusColumns.LATENCY, SortDirection.Asc))
        assertEquals(listOf("fleet_telemetry", "database", "tesla_api"), latencyAsc.map { it.name })
        val failuresDesc = BackendStatusProjection.sortRows(rows, SortState(BackendStatusColumns.FAILURES, SortDirection.Desc))
        assertEquals(listOf("fleet_telemetry", "tesla_api", "database"), failuresDesc.map { it.name })
    }

    @Test
    fun unsortedKeepsWireOrder() {
        val rows = fullData().health?.components.orEmpty()
        assertEquals(rows, BackendStatusProjection.sortRows(rows, SortState()))
    }

    @Test
    fun formatUptimeMatchesWebLadder() {
        assertEquals("0m", BackendStatusProjection.formatUptime(0))
        assertEquals("1m", BackendStatusProjection.formatUptime(90))
        assertEquals("1h 1m", BackendStatusProjection.formatUptime(3_661))
        assertEquals("1d 1h 1m", BackendStatusProjection.formatUptime(90_061))
    }

    @Test
    fun formatIntGroupsThousands() {
        assertEquals("0", BackendStatusProjection.formatInt(0, locale))
        assertEquals("1,234", BackendStatusProjection.formatInt(1_234, locale))
    }

    @Test
    fun isEmptyOnlyWhenNothingResolves() {
        assertTrue(BackendStatusData(null, null, null).isEmpty)
        // health resolved with empty components + no system, no pool, no version ⇒ empty.
        val emptyHealth = BackendStatusData.from(buildJsonObject { putJsonObject("components") {} }, JsonNull, JsonNull)
        assertTrue(emptyHealth.isEmpty)
        // a pool alone is enough to be non-empty.
        assertFalse(BackendStatusData.from(null, poolJson(), null).isEmpty)
        assertFalse(fullData().isEmpty)
    }

    @Test
    fun viewOpenedEmitsSurfaceSlugWithNoPayload() {
        val logger = RecordingLogger()
        recordBackendStatusSectionOpened(logger)
        val opened = logger.records.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "BackendStatusSection"), opened.single().second)
        assertEquals("BackendStatusSection", BACKEND_STATUS_SECTION_SLUG)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
