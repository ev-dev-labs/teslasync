package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for the framework-free AnomalyDetectorWidget layer: the registry spec, the
 * `JsonElement` -> [AnomalyProjection] adapter, severity ranking, relative-time bucketing, ISO
 * parsing, z-score formatting, query-error mapping, the per-state [toUiState] projection that the
 * view switches on, and the accessibility-label builders. The Compose render layer is covered by the
 * instrumented test; only the pure logic is exercised here so it runs in the JVM gate.
 */
class AnomalyDetectorWidgetTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun parse(text: String): JsonElement = json.parseToJsonElement(text)

    private fun envelope(vararg anomalies: String): JsonElement = parse("""{"anomalies":[${anomalies.joinToString(",")}]}""")

    private fun anomaly(
        signal: String,
        severity: String,
        z: Double,
        detectedAt: String = "2024-01-01T00:00:00Z",
        message: String = "msg",
    ): String =
        """{"signal":"$signal","severity":"$severity","z_score":$z,""" +
            """"detected_at":"$detectedAt","message":"$message"}"""

    // ── Registry spec (web registry/analytics.ts: anomaly-detector) ──────────────────────────────

    @Test
    fun specMatchesWebRegistryMetadata() {
        assertEquals("anomaly-detector", AnomalyDetectorWidgetSpec.id)
        assertEquals("analytics", AnomalyDetectorWidgetSpec.category)
        assertEquals(DashboardWidgetGridSize(2, 4), AnomalyDetectorWidgetSpec.defaultSize)
        assertEquals(DashboardWidgetGridSize(1, 2), AnomalyDetectorWidgetSpec.minSize)
        assertEquals(DashboardWidgetGridSize(4, 40), AnomalyDetectorWidgetSpec.maxSize)
        assertEquals("AnomalyDetectorWidget", ANOMALY_DETECTOR_SURFACE_SLUG)
    }

    @Test
    fun clampHoldsSizeInsideMinMaxEnvelope() {
        assertEquals(DashboardWidgetGridSize(1, 40), AnomalyDetectorWidgetSpec.clamp(DashboardWidgetGridSize(0, 100)))
        assertEquals(DashboardWidgetGridSize(4, 2), AnomalyDetectorWidgetSpec.clamp(DashboardWidgetGridSize(10, 1)))
    }

    @Test
    fun isCompactOnlyForSingleColumn() {
        assertTrue(AnomalyDetectorWidgetSpec.isCompact(DashboardWidgetGridSize(1, 4)))
        assertTrue("zero columns clamp up to one => compact", AnomalyDetectorWidgetSpec.isCompact(DashboardWidgetGridSize(0, 4)))
        assertFalse(AnomalyDetectorWidgetSpec.isCompact(DashboardWidgetGridSize(2, 4)))
    }

    // ── Severity ranking (web SEVERITY_ORDER) ────────────────────────────────────────────────────

    @Test
    fun severityFromWireIsCaseInsensitiveAndDefaultsToInfo() {
        assertEquals(AnomalySeverity.Critical, AnomalySeverity.fromWire("critical"))
        assertEquals(AnomalySeverity.Warning, AnomalySeverity.fromWire("WARNING"))
        assertEquals(AnomalySeverity.Info, AnomalySeverity.fromWire("info"))
        assertEquals(AnomalySeverity.Info, AnomalySeverity.fromWire(null))
        assertEquals(AnomalySeverity.Info, AnomalySeverity.fromWire("nonsense"))
    }

    @Test
    fun severityRankOrdersCriticalFirst() {
        assertEquals(0, AnomalySeverity.Critical.order)
        assertEquals(1, AnomalySeverity.Warning.order)
        assertEquals(2, AnomalySeverity.Info.order)
    }

    // ── Adapter: projectAnomalies ────────────────────────────────────────────────────────────────

    @Test
    fun projectSortsBySeverityAndParsesFields() {
        val projection =
            projectAnomalies(
                envelope(
                    anomaly("range", "info", 1.2),
                    anomaly("battery", "critical", 4.8),
                    anomaly("temp", "warning", 3.1),
                ),
            )

        assertEquals(3, projection.count)
        assertEquals(listOf("battery", "temp", "range"), projection.entries.map { it.signal })
        assertEquals(AnomalySeverity.Critical, projection.entries.first().severity)
        assertEquals(4.8, projection.entries.first().zScore!!, 1e-9)
        assertEquals("2024-01-01T00:00:00Z", projection.entries.first().detectedAtIso)
        assertEquals("msg", projection.entries.first().message)
    }

    @Test
    fun projectHandlesNullMalformedAndMissingKey() {
        assertTrue(projectAnomalies(null).entries.isEmpty())
        assertTrue(projectAnomalies(parse("""[1,2,3]""")).entries.isEmpty())
        assertTrue(projectAnomalies(parse("""{"other":true}""")).entries.isEmpty())
        assertTrue(projectAnomalies(parse("""{"anomalies":"oops"}""")).entries.isEmpty())
    }

    @Test
    fun projectToleratesMissingFieldsAndSkipsNonObjects() {
        val projection = projectAnomalies(parse("""{"anomalies":[{},42,{"signal":"x"}]}"""))

        assertEquals(2, projection.count)
        val first = projection.entries.first { it.signal == null }
        assertNull(first.zScore)
        assertNull(first.detectedAtIso)
        assertEquals(AnomalySeverity.Info, first.severity)
    }

    @Test
    fun maxSeverityIsWorstPresentOrInfoWhenEmpty() {
        assertEquals(AnomalySeverity.Info, projectAnomalies(envelope()).maxSeverity)
        assertEquals(
            AnomalySeverity.Warning,
            projectAnomalies(envelope(anomaly("a", "warning", 3.0), anomaly("b", "info", 1.0))).maxSeverity,
        )
        assertEquals(
            AnomalySeverity.Critical,
            projectAnomalies(envelope(anomaly("a", "warning", 3.0), anomaly("b", "critical", 5.0))).maxSeverity,
        )
    }

    // ── Relative time (web formatRelativeTime) ───────────────────────────────────────────────────

    @Test
    fun relativeTimeBucketsMatchWeb() {
        val now = 10_000_000_000L
        assertNull(relativeTimeOf(null, now))
        assertEquals(RelativeUnit.JustNow, relativeTimeOf(now, now)?.unit)
        assertEquals(RelativeUnit.JustNow, relativeTimeOf(now - 30_000L, now)?.unit)
        assertEquals(RelativeTime(RelativeUnit.Minutes, 5), relativeTimeOf(now - 5L * 60_000L, now))
        assertEquals(RelativeTime(RelativeUnit.Hours, 1), relativeTimeOf(now - 90L * 60_000L, now))
        assertEquals(RelativeTime(RelativeUnit.Days, 2), relativeTimeOf(now - 50L * 3_600_000L, now))
    }

    @Test
    fun relativeTimeClampsFutureToJustNow() {
        val now = 10_000_000_000L
        assertEquals(RelativeUnit.JustNow, relativeTimeOf(now + 60_000L, now)?.unit)
    }

    // ── ISO parsing ──────────────────────────────────────────────────────────────────────────────

    @Test
    fun parseIsoHandlesZoneVariantsAndUtcFallback() {
        assertEquals(0L, parseIsoToEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(0L, parseIsoToEpochMillis("1970-01-01T01:00:00+01:00"))
        assertEquals(0L, parseIsoToEpochMillis("1970-01-01T00:00:00"))
    }

    @Test
    fun parseIsoReturnsNullForBlankOrGarbage() {
        assertNull(parseIsoToEpochMillis(null))
        assertNull(parseIsoToEpochMillis("   "))
        assertNull(parseIsoToEpochMillis("not-a-date"))
    }

    // ── z-score formatting (web fmtNumber(z, 1)) ─────────────────────────────────────────────────

    @Test
    fun formatZScoreUsesOneDecimalAndNullZero() {
        assertEquals("0.0", formatZScore(null))
        assertEquals("3.1", formatZScore(3.14))
        assertEquals("2.0", formatZScore(2.0))
        assertEquals("-1.3", formatZScore(-1.27))
    }

    // ── Query-error mapping ──────────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsTaxonomyToCopyBuckets() {
        assertEquals(QueryErrorKind.Waiting, queryErrorKindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, queryErrorKindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Offline, queryErrorKindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.NotFound, queryErrorKindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.Unauthorized, queryErrorKindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.ServerError, queryErrorKindFor(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Network, queryErrorKindFor(ErrorKind.Decode, null))
        assertEquals(QueryErrorKind.Network, queryErrorKindFor(null, null))
    }

    // ── Per-state projection the view switches on (loading/content/empty/stale/offline/error) ─────

    private val isEmpty: (JsonElement) -> Boolean = { projectAnomalies(it).entries.isEmpty() }

    @Test
    fun loadingStateHasNoData() {
        val state = Resource.Loading<JsonElement>(cached = null, fetchedAt = null, stale = false).toUiState(isEmpty)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.isLoading)
    }

    @Test
    fun contentStateWhenAnomaliesPresent() {
        val resource = Resource.Success(data = envelope(anomaly("battery", "critical", 5.0)), fetchedAt = 1L, stale = false)
        val state = resource.toUiState(isEmpty)
        assertEquals(UiPhase.Content, state.phase)
        assertFalse(projectAnomalies(state.data).entries.isEmpty())
    }

    @Test
    fun emptyStateWhenNoAnomalies() {
        val state = Resource.Success(data = envelope(), fetchedAt = 1L, stale = false).toUiState(isEmpty)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(projectAnomalies(state.data).entries.isEmpty())
    }

    @Test
    fun staleStateWhileRefreshingOverCache() {
        val resource = Resource.Loading(cached = envelope(anomaly("temp", "warning", 3.0)), fetchedAt = 1L, stale = true)
        val state = resource.toUiState(isEmpty)
        assertTrue(state.stale)
        assertTrue(state.refreshing)
        assertEquals(UiPhase.Content, state.phase)
    }

    @Test
    fun offlineStateKeepsCacheWithErrorFlag() {
        val resource =
            Resource.Error(
                cached = envelope(anomaly("battery", "critical", 5.0)),
                fetchedAt = 1L,
                stale = true,
                error = ApiError.Network(),
            )
        val state = resource.toUiState(isEmpty)
        assertTrue("cached data shown while offline", state.isOffline)
        assertTrue(state.hasError)
        assertEquals(ErrorKind.Network, state.errorKind)
    }

    @Test
    fun errorStateWhenNoCache() {
        val resource =
            Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 500))
        val state = resource.toUiState(isEmpty)
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(QueryErrorKind.ServerError, queryErrorKindFor(state.errorKind, state.httpStatus))
    }

    // ── Accessibility label builders ─────────────────────────────────────────────────────────────

    @Test
    fun compactAccessibilityLabelDescribesCountAndSeverity() {
        assertEquals(
            "3 active, Critical",
            compactAccessibilityLabel(
                count = 3,
                severityLabel = "Critical",
                activeCountLabel = "3 active",
                noAnomaliesLabel = "No anomalies",
            ),
        )
        assertEquals(
            "No anomalies",
            compactAccessibilityLabel(
                count = 0,
                severityLabel = null,
                activeCountLabel = "0 active",
                noAnomaliesLabel = "No anomalies",
            ),
        )
    }

    @Test
    fun rowAccessibilityLabelJoinsPresentPartsOnly() {
        assertEquals(
            "Critical, battery, z=4.8, 5m ago, Cell drift",
            anomalyRowAccessibilityLabel("battery", "Critical", "z=4.8", "5m ago", "Cell drift"),
        )
        assertEquals(
            "Info, z=0.0",
            anomalyRowAccessibilityLabel(
                signal = null,
                severityLabel = "Info",
                zScoreLabel = "z=0.0",
                relativeLabel = "  ",
                message = null,
            ),
        )
    }
}
