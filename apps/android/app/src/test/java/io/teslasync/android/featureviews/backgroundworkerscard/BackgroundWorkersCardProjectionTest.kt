package io.teslasync.android.featureviews.backgroundworkerscard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the BackgroundWorkersCard's pure logic — the native analogue of every derivation
 * the web component performs (web/src/features/system/components/status/BackgroundWorkersCard.tsx): `groupByName`
 * (grouping, healthy counts, rollup severity, name sort), the two-axis summary (`healthyGroups` /
 * `healthyInstances` / `multiInstanceGroups`), `shortHost`, `fmtLatency`, the `instanceClasses` wire mapping,
 * the empty guard, the scale-hint visibility, and the PII-safe `view.opened` diagnostic. Mirrors the cases in
 * the web spec test (`__tests__/BackgroundWorkersCard.test.tsx`). Runs in the :android:testReleaseUnitTest gate.
 */
class BackgroundWorkersCardProjectionTest {
    private fun instance(
        name: String,
        host: String,
        status: WorkerInstanceStatus = WorkerInstanceStatus.Healthy,
        latencyMs: Double? = 12.0,
        error: String? = null,
    ) = WorkerInstance(name = name, host = host, status = status, latencyMs = latencyMs, error = error)

    private val singleInstance =
        WorkersHealthData(
            listOf(
                instance("notification-worker", "http://notification-worker:8081/healthz"),
                instance("export-worker", "http://export-worker:8082/healthz"),
                instance("automation-worker", "http://automation-worker:8083/healthz"),
            ),
        )

    private val scaled =
        WorkersHealthData(
            listOf(
                instance("notification-worker", "http://nw-1:8081/healthz", latencyMs = 8.0),
                instance("notification-worker", "http://nw-2:8081/healthz", latencyMs = 14.0),
                instance("notification-worker", "http://nw-3:8081/healthz", latencyMs = 9.0),
                instance("export-worker", "http://export-worker:8082/healthz"),
                instance("automation-worker", "http://automation-worker:8083/healthz"),
            ),
        )

    // ── groupByName ─────────────────────────────────────────────────────────────────

    @Test
    fun groupsOneRowPerWorkerForTheSingleInstanceDefault() {
        val groups = WorkersProjection.groupByName(singleInstance.workers)

        // One group per name, sorted by name (web `localeCompare`).
        assertEquals(listOf("automation-worker", "export-worker", "notification-worker"), groups.map { it.name })
        assertTrue(groups.all { it.total == 1 })
        assertTrue(groups.all { it.healthy == 1 })
        assertTrue(groups.all { it.severity == GroupSeverity.Healthy })
        assertTrue(groups.none { it.isMultiInstance })
    }

    @Test
    fun groupsMultipleInstancesByNameKeepingEveryHost() {
        val groups = WorkersProjection.groupByName(scaled.workers)
        val notification = groups.first { it.name == "notification-worker" }

        assertEquals(3, notification.total)
        assertTrue(notification.isMultiInstance)
        // Both shared-name instances survive in one group (web's stable-key guarantee).
        assertEquals(
            listOf("http://nw-1:8081/healthz", "http://nw-2:8081/healthz", "http://nw-3:8081/healthz"),
            notification.instances.map { it.host },
        )
    }

    @Test
    fun rollupIsHealthyOnlyWhenEveryInstanceIsHealthy() {
        val groups =
            WorkersProjection.groupByName(
                listOf(
                    instance("nw", "http://nw-1/healthz", WorkerInstanceStatus.Healthy),
                    instance("nw", "http://nw-2/healthz", WorkerInstanceStatus.Healthy),
                ),
            )
        assertEquals(GroupSeverity.Healthy, groups.single().severity)
        assertEquals(2, groups.single().healthy)
    }

    @Test
    fun rollupEscalatesToDegradedWhenOneInstanceIsUnhealthy() {
        val groups =
            WorkersProjection.groupByName(
                listOf(
                    instance("nw", "http://nw-1/healthz", WorkerInstanceStatus.Healthy),
                    instance("nw", "http://nw-2/healthz", WorkerInstanceStatus.Unhealthy),
                ),
            )
        assertEquals(GroupSeverity.Degraded, groups.single().severity)
        assertEquals(1, groups.single().healthy)
    }

    @Test
    fun rollupIsDownOnlyWhenEveryInstanceIsDown() {
        val groups =
            WorkersProjection.groupByName(
                listOf(
                    instance("ew", "http://e1/healthz", WorkerInstanceStatus.Down),
                    instance("ew", "http://e2/healthz", WorkerInstanceStatus.Down),
                ),
            )
        assertEquals(GroupSeverity.Down, groups.single().severity)
        assertEquals(0, groups.single().healthy)
    }

    // ── project (two-axis summary) ────────────────────────────────────────────────────

    @Test
    fun projectSummarizesTheSingleInstanceDefault() {
        val display = WorkersProjection.project(singleInstance)

        assertFalse(display.isEmpty)
        assertEquals(3, display.summary.groupCount)
        assertEquals(3, display.summary.healthyGroups)
        assertEquals(3, display.summary.totalInstances)
        assertEquals(3, display.summary.healthyInstances)
        assertEquals(0, display.summary.multiInstanceGroups)
        // No group replicated ⇒ the "set *_HOSTS to scale" callout is shown (web `multiInstanceGroups === 0`).
        assertTrue(display.showScaleHint)
    }

    @Test
    fun projectSummarizesTheScaledDeployment() {
        val display = WorkersProjection.project(scaled)

        assertEquals(3, display.summary.groupCount)
        assertEquals(3, display.summary.healthyGroups)
        assertEquals(5, display.summary.totalInstances)
        assertEquals(5, display.summary.healthyInstances)
        // Exactly one worker type (notification) is replicated (web "1 of 3 types").
        assertEquals(1, display.summary.multiInstanceGroups)
        assertFalse(display.showScaleHint)
    }

    @Test
    fun isEmptyWhenNoWorkersAreReporting() {
        assertTrue(WorkersProjection.project(WorkersHealthData()).isEmpty)
        assertTrue(WorkersProjection.project(WorkersHealthData(emptyList())).isEmpty)
    }

    // ── shortHost ──────────────────────────────────────────────────────────────────

    @Test
    fun shortHostStripsSchemeAndHealthzSuffix() {
        assertEquals("notification-worker:8081", WorkersProjection.shortHost("http://notification-worker:8081/healthz"))
        assertEquals("export-worker:8082", WorkersProjection.shortHost("https://export-worker:8082/healthz"))
        // Trailing slash variant + a host without the suffix are both handled.
        assertEquals("nw-1:8081", WorkersProjection.shortHost("http://nw-1:8081/healthz/"))
        assertEquals("plain-host:9000", WorkersProjection.shortHost("plain-host:9000"))
    }

    // ── fmtLatency ─────────────────────────────────────────────────────────────────

    @Test
    fun formatLatencyRoundsAndAppendsTheUnit() {
        assertEquals("23 ms", WorkersProjection.formatLatency(23.0))
        assertEquals("12 ms", WorkersProjection.formatLatency(12.4))
        assertEquals("13 ms", WorkersProjection.formatLatency(12.5))
    }

    @Test
    fun formatLatencyFallsBackToEmDashForMissingOrNonFiniteValues() {
        assertEquals(EM_DASH, WorkersProjection.formatLatency(null))
        assertEquals(EM_DASH, WorkersProjection.formatLatency(Double.NaN))
        assertEquals(EM_DASH, WorkersProjection.formatLatency(Double.POSITIVE_INFINITY))
    }

    // ── wire status mapping (web instanceClasses) ──────────────────────────────────────

    @Test
    fun fromWireMapsEveryKnownStatusAndDefaultsUnknownToDown() {
        assertEquals(WorkerInstanceStatus.Healthy, WorkerInstanceStatus.fromWire("healthy"))
        assertEquals(WorkerInstanceStatus.Unhealthy, WorkerInstanceStatus.fromWire("unhealthy"))
        assertEquals(WorkerInstanceStatus.Down, WorkerInstanceStatus.fromWire("down"))
        // Case-insensitive + unknown/null ⇒ down (web `instanceClasses` default branch).
        assertEquals(WorkerInstanceStatus.Down, WorkerInstanceStatus.fromWire("DOWN"))
        assertEquals(WorkerInstanceStatus.Down, WorkerInstanceStatus.fromWire("bogus"))
        assertEquals(WorkerInstanceStatus.Down, WorkerInstanceStatus.fromWire(null))
    }

    @Test
    fun errorMessageIsCarriedThroughOnTheInstance() {
        val display =
            WorkersProjection.project(
                WorkersHealthData(
                    listOf(
                        instance(
                            "automation-worker",
                            "http://aw-1:8083/healthz",
                            WorkerInstanceStatus.Down,
                            latencyMs = null,
                            error = "dial tcp: connection refused",
                        ),
                    ),
                ),
            )
        val group = display.groups.single()
        val onlyInstance = group.instances.single()
        assertEquals("dial tcp: connection refused", onlyInstance.error)
    }

    // ── diagnostics (PII-safe view.opened) ──────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsThePiiSafeSurfaceSlug() {
        val logger = RecordingLogger()

        BackgroundWorkersCardDiagnostics.recordViewOpened(logger)

        val entry = logger.entries.single()
        assertEquals(LogLevel.Info, entry.level)
        assertEquals("view.opened", entry.event)
        assertEquals(mapOf("surface" to "BackgroundWorkersCard"), entry.fields)
        assertEquals("BackgroundWorkersCard", BackgroundWorkersCardDiagnostics.SLUG)
        assertEquals("background-workers-card", BackgroundWorkersCardDiagnostics.ID)
    }

    /** Captures emitted diagnostics so the off-device test can assert the surface never leaks topology. */
    private class RecordingLogger : Logger {
        data class Entry(
            val level: LogLevel,
            val event: String,
            val fields: Map<String, String>,
        )

        val entries = mutableListOf<Entry>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            entries.add(Entry(level, event, fields))
        }
    }
}
