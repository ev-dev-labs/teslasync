package io.teslasync.android.featureviews.whyendedpanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the WhyEndedPanel pure projection — the native port of the web component's
 * data derivations (web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx): the `why.data?.…`
 * decode of the raw SI response into the two arrays, the `{fsm}: {from} → {to}` transition title + the
 * `trigger || '—'` fallback, the absolute timestamp render, the `keyExtractor` row keys, the lazy
 * collapsed/expanded gate, and the cache-then-network status + freshness mapping. Because the composable is a
 * thin render layer, each [WhyEndedDisplay] field here is exactly what it draws, so these assertions double as
 * the per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class WhyEndedPanelProjectionTest {
    private val utc = ZoneId.of("UTC")
    private val locale = Locale.US

    private fun json(raw: String): JsonElement = Json.parseToJsonElement(raw)

    private val fullPayload =
        json(
            """
            {
              "drive_id": 42,
              "vehicle_id": 7,
              "start_ts": "2026-03-14T09:15:00Z",
              "end_ts": "2026-03-14T11:45:00Z",
              "ended_status": "parked",
              "window": "60s",
              "fsm_transitions": [
                {
                  "id": 2,
                  "ts": "2026-03-14T11:45:00Z",
                  "fsm_name": "drive",
                  "from_state": "driving",
                  "to_state": "parked",
                  "trigger": "shift_to_park",
                  "details_json": { "gear": "P" }
                },
                {
                  "id": 1,
                  "ts": "2026-03-14T11:44:50Z",
                  "fsm_name": "drive",
                  "from_state": "active",
                  "to_state": "driving",
                  "trigger": ""
                }
              ],
              "signal_window": [
                { "ts": "2026-03-14T11:45:00Z", "field": "Gear", "value": "P" },
                { "ts": "2026-03-14T11:44:55Z", "field": "VehicleSpeed", "value": "0" }
              ]
            }
            """.trimIndent(),
        )

    // ── decode (web `why.data?.…`) ─────────────────────────────────────────────────────────────────────

    @Test
    fun decodeReadsBothArraysAndIgnoresContextColumns() {
        val response = WhyEndedPanelProjection.decode(fullPayload)
        assertEquals(2, response?.fsmTransitions?.size)
        assertEquals(2, response?.signalWindow?.size)
        assertEquals("shift_to_park", response?.fsmTransitions?.first()?.trigger)
        assertEquals("Gear", response?.signalWindow?.first()?.field)
    }

    @Test
    fun decodeOfNullIsNull() {
        assertNull(WhyEndedPanelProjection.decode(null))
    }

    @Test
    fun decodeOfMalformedPayloadIsNullNotThrown() {
        // A bare scalar where an object is expected — the web `?.` simply yields undefined; we yield null.
        assertNull(WhyEndedPanelProjection.decode(JsonPrimitive("nonsense")))
    }

    @Test
    fun decodeOfMissingArraysDefaultsToEmpty() {
        val response = WhyEndedPanelProjection.decode(json("{}"))
        assertEquals(emptyList<DriveDiagnosticTransition>(), response?.fsmTransitions)
        assertEquals(emptyList<DriveDiagnosticSignal>(), response?.signalWindow)
    }

    // ── transition row (web Timeline item) ─────────────────────────────────────────────────────────────

    @Test
    fun transitionRowBuildsTheWebTitleAndTriggerFallback() {
        val response = WhyEndedPanelProjection.decode(fullPayload)!!
        val rows = WhyEndedPanelProjection.projectTransitions(response, utc, locale)

        assertEquals("drive: driving $STATE_ARROW parked", rows[0].title)
        assertEquals("shift_to_park", rows[0].trigger)
        // Web `tx.trigger || '—'`: a blank trigger becomes the em dash.
        assertEquals(EM_DASH, rows[1].trigger)
    }

    @Test
    fun transitionRowKeyStaysStableAcrossDuplicateTimestamps() {
        val response = WhyEndedPanelProjection.decode(fullPayload)!!
        val rows = WhyEndedPanelProjection.projectTransitions(response, utc, locale)
        assertEquals(rows.size, rows.map { it.key }.toSet().size)
    }

    // ── signal row (web DataTable row) ─────────────────────────────────────────────────────────────────

    @Test
    fun signalRowCarriesFieldAndValueVerbatimWithStableKey() {
        val response = WhyEndedPanelProjection.decode(fullPayload)!!
        val rows = WhyEndedPanelProjection.projectSignals(response, utc, locale)

        assertEquals("Gear", rows[0].field)
        assertEquals("P", rows[0].value)
        // Web `keyExtractor` `${ts}-${field}-${idx}` — the index disambiguates same-second re-emits.
        assertEquals("2026-03-14T11:45:00Z-Gear-0", rows[0].key)
        assertEquals(rows.size, rows.map { it.key }.toSet().size)
    }

    // ── absolute timestamp (web `<TimeStamp absolute>` / `toLocaleString`) ───────────────────────────────

    @Test
    fun formatAbsoluteRendersTheWallClockInstant() {
        val label = WhyEndedPanelProjection.formatAbsolute("2026-03-14T11:45:00Z", utc, locale)
        assertNotEquals(EM_DASH, label)
        assertTrue("expected the year, was \"$label\"", label.contains("2026"))
        assertTrue("expected the time, was \"$label\"", label.contains("11:45"))
    }

    @Test
    fun formatAbsoluteOfBlankOrGarbageIsEmDash() {
        assertEquals(EM_DASH, WhyEndedPanelProjection.formatAbsolute("", utc, locale))
        assertEquals(EM_DASH, WhyEndedPanelProjection.formatAbsolute("not-a-date", utc, locale))
    }

    // ── project: the lazy/cache-then-network state matrix (every state the surface renders) ──────────────

    @Test
    fun collapsedRendersHeaderOnly() {
        val display = WhyEndedPanelProjection.project(expanded = false, resource = null, zone = utc, locale = locale)
        assertEquals(WhyEndedStatus.Collapsed, display.status)
        assertTrue(display.transitions.isEmpty())
        assertTrue(display.signals.isEmpty())
    }

    @Test
    fun expandedWithNoFeedIsReadyWithEmptySections() {
        // The web disabled-query branch: expanded, `enabled:false` (no id) → undefined data → empty sections.
        val display = WhyEndedPanelProjection.project(expanded = true, resource = null, zone = utc, locale = locale)
        assertEquals(WhyEndedStatus.Ready, display.status)
        assertTrue(display.transitions.isEmpty())
        assertTrue(display.signals.isEmpty())
    }

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val display =
            WhyEndedPanelProjection.project(
                expanded = true,
                resource = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                zone = utc,
                locale = locale,
            )
        assertEquals(WhyEndedStatus.Loading, display.status)
        assertFalse(display.refreshing)
    }

    @Test
    fun successResolvesToReadyWithRowsAndNoFreshnessFlags() {
        val display =
            WhyEndedPanelProjection.project(
                expanded = true,
                resource = Resource.Success(fullPayload, fetchedAt = 100L, stale = false),
                zone = utc,
                locale = locale,
            )
        assertEquals(WhyEndedStatus.Ready, display.status)
        assertEquals(2, display.transitions.size)
        assertEquals(2, display.signals.size)
        assertFalse(display.stale)
        assertFalse(display.refreshing)
        assertFalse(display.offline)
        assertEquals(100L, display.fetchedAtMillis)
    }

    @Test
    fun loadingOverCacheKeepsRowsAndFlagsRefreshing() {
        val display =
            WhyEndedPanelProjection.project(
                expanded = true,
                resource = Resource.Loading(cached = fullPayload, fetchedAt = 50L, stale = false),
                zone = utc,
                locale = locale,
            )
        assertEquals(WhyEndedStatus.Ready, display.status)
        assertEquals(2, display.transitions.size)
        assertTrue(display.refreshing)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorAndRetryable() {
        val display =
            WhyEndedPanelProjection.project(
                expanded = true,
                resource = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                zone = utc,
                locale = locale,
            )
        assertEquals(WhyEndedStatus.Error, display.status)
        assertTrue(display.canRetry)
        assertEquals(ErrorKind.Network, display.errorKind)
        assertTrue(display.transitions.isEmpty())
    }

    @Test
    fun errorOverCacheStaysReadyOfflineWithLastKnownRows() {
        val display =
            WhyEndedPanelProjection.project(
                expanded = true,
                resource = Resource.Error(cached = fullPayload, fetchedAt = 100L, stale = true, error = ApiError.Timeout()),
                zone = utc,
                locale = locale,
            )
        assertEquals(WhyEndedStatus.Ready, display.status)
        assertEquals(2, display.signals.size)
        assertTrue(display.stale)
        assertTrue(display.offline)
        assertTrue(display.canRetry)
        assertEquals(ErrorKind.Timeout, display.errorKind)
    }

    // ── window enum (web `WINDOWS` + default) ────────────────────────────────────────────────────────────

    @Test
    fun windowTokensMatchTheWebContractAndDefault() {
        assertEquals(listOf("30s", "60s", "5m", "15m"), WhyEndedWindow.entries.map { it.wire })
        assertEquals(WhyEndedWindow.Sec60, WhyEndedWindow.DEFAULT)
        assertEquals(WhyEndedWindow.Min5, WhyEndedWindow.fromWire("5m"))
        // An unknown token falls back to the default rather than throwing.
        assertEquals(WhyEndedWindow.DEFAULT, WhyEndedWindow.fromWire("99h"))
    }

    // ── diagnostics (P1/S11, PII-safe) ───────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()
        WhyEndedPanelDiagnostics.recordViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to "WhyEndedPanel"), opened.second)
        // No drive id, FSM state, trigger, or signal value may ever appear in a diagnostics field.
        assertFalse(logger.events.any { it.second.containsKey("value") })
        assertFalse(logger.events.any { it.second.containsKey("trigger") })
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
