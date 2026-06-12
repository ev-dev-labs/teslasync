package io.teslasync.android.featureviews.livesignaltail

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveSignalTail pure projection — the native port of the web component's
 * `detectType` / `String(value)` value handling, the SSE-handler diff that turns merged-state changes into
 * tail rows, the capped newest-first buffer fold (web `[...new, ...prev].slice(0, max)`), the case-
 * insensitive name filter, the unique-signal count, the 1 Hz signals/sec rate counter, the body-state
 * classifier, the Type->Badge mapping, the accessibility-name fold, the i18n key mapping, and the PII-safe
 * `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/telemetry/components/LiveSignalTail.tsx + .../hooks/useLiveSignalStream.ts).
 */
class LiveSignalTailProjectionTest {
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

    // ── detectType (web detectType) ───────────────────────────────────────────────────────────────────

    @Test
    fun detectTypeNumberLiteral() {
        assertEquals(SignalValueType.Number, LiveSignalTailProjection.detectType(JsonPrimitive(64)))
        assertEquals(SignalValueType.Number, LiveSignalTailProjection.detectType(JsonPrimitive(64.5)))
    }

    @Test
    fun detectTypeBooleanLiteral() {
        assertEquals(SignalValueType.Boolean, LiveSignalTailProjection.detectType(JsonPrimitive(true)))
        assertEquals(SignalValueType.Boolean, LiveSignalTailProjection.detectType(JsonPrimitive(false)))
    }

    @Test
    fun detectTypeQuotedStringIsText() {
        assertEquals(SignalValueType.Text, LiveSignalTailProjection.detectType(JsonPrimitive("D")))
        // A quoted numeric string stays Text — web `typeof '64' === 'string'`.
        assertEquals(SignalValueType.Text, LiveSignalTailProjection.detectType(JsonPrimitive("64")))
    }

    @Test
    fun detectTypeNullIsText() {
        assertEquals(SignalValueType.Text, LiveSignalTailProjection.detectType(JsonNull))
    }

    // ── renderValue (web String(value)) ───────────────────────────────────────────────────────────────

    @Test
    fun renderValueStripsQuotesAndRendersNull() {
        assertEquals("Drive", LiveSignalTailProjection.renderValue(JsonPrimitive("Drive")))
        assertEquals("64", LiveSignalTailProjection.renderValue(JsonPrimitive(64)))
        assertEquals("true", LiveSignalTailProjection.renderValue(JsonPrimitive(true)))
        assertEquals(NULL_LITERAL, LiveSignalTailProjection.renderValue(JsonNull))
    }

    @Test
    fun isScalarRejectsObjectsAndArrays() {
        assertTrue(LiveSignalTailProjection.isScalar(JsonPrimitive(1)))
        assertTrue(LiveSignalTailProjection.isScalar(JsonNull))
        assertFalse(LiveSignalTailProjection.isScalar(buildJsonObject { put("a", 1) }))
        assertFalse(LiveSignalTailProjection.isScalar(buildJsonArray { }))
    }

    // ── diffToEntries (web SSE handler firehose) ──────────────────────────────────────────────────────

    @Test
    fun diffEmitsNewAndChangedScalarsInOrder() {
        val prev = mapOf("Speed" to JsonPrimitive(60))
        val next =
            linkedMapOf(
                "Speed" to JsonPrimitive(64),
                "Gear" to JsonPrimitive("D"),
            )
        val rows = LiveSignalTailProjection.diffToEntries(prev, next, startId = 10L, timestampMillis = 1_000L)

        assertEquals(listOf("Speed", "Gear"), rows.map { it.name })
        assertEquals(listOf(11L, 12L), rows.map { it.id })
        assertEquals("64", rows[0].value)
        assertEquals(SignalValueType.Number, rows[0].type)
        assertEquals(SignalValueType.Text, rows[1].type)
        assertTrue(rows.all { it.timestampMillis == 1_000L })
    }

    @Test
    fun diffSkipsUnchangedAndNonScalarValues() {
        val prev = mapOf("Speed" to JsonPrimitive(64))
        val next =
            linkedMapOf(
                "Speed" to JsonPrimitive(64),
                "Location" to buildJsonObject { put("lat", 1.0) },
            )
        val rows = LiveSignalTailProjection.diffToEntries(prev, next, startId = 0L, timestampMillis = 1L)
        assertTrue(rows.isEmpty())
    }

    // ── appendCapped (web [...new, ...prev].slice(0, max)) ─────────────────────────────────────────────

    @Test
    fun appendPrependsNewestAndCaps() {
        val older = listOf(entry(1, "A"), entry(2, "B"))
        val incoming = listOf(entry(3, "C"))
        val result = LiveSignalTailProjection.appendCapped(older, incoming, cap = 2)
        assertEquals(listOf("C", "A"), result.map { it.name })
    }

    @Test
    fun appendWithZeroCapIsEmpty() {
        assertTrue(LiveSignalTailProjection.appendCapped(listOf(entry(1, "A")), listOf(entry(2, "B")), cap = 0).isEmpty())
    }

    @Test
    fun appendTrimsAnOverlongBufferEvenWithNoIncoming() {
        val over = listOf(entry(1, "A"), entry(2, "B"), entry(3, "C"))
        assertEquals(2, LiveSignalTailProjection.appendCapped(over, emptyList(), cap = 2).size)
    }

    // ── filterEntries / uniqueSignalCount ─────────────────────────────────────────────────────────────

    @Test
    fun filterIsCaseInsensitiveAndBlankReturnsAll() {
        val rows = listOf(entry(1, "VehicleSpeed"), entry(2, "Gear"))
        assertEquals(2, LiveSignalTailProjection.filterEntries(rows, "").size)
        assertEquals(listOf("VehicleSpeed"), LiveSignalTailProjection.filterEntries(rows, "speed").map { it.name })
    }

    @Test
    fun uniqueSignalCountCountsDistinctNames() {
        val rows = listOf(entry(1, "Speed"), entry(2, "Speed"), entry(3, "Gear"))
        assertEquals(2, LiveSignalTailProjection.uniqueSignalCount(rows))
    }

    // ── ratePerSecond (web 1 Hz counter) ──────────────────────────────────────────────────────────────

    @Test
    fun rateCountsOnlyReceiptsWithinTheWindow() {
        val now = 10_000L
        val rows =
            listOf(
                entry(1, "A", ts = now),
                entry(2, "B", ts = now - 500L),
                entry(3, "C", ts = now - 1_500L),
            )
        assertEquals(2, LiveSignalTailProjection.ratePerSecond(rows, now, windowMillis = 1_000L))
    }

    @Test
    fun rateDecaysToZeroWhenAllReceiptsAgeOut() {
        val rows = listOf(entry(1, "A", ts = 0L))
        assertEquals(0, LiveSignalTailProjection.ratePerSecond(rows, nowMillis = 5_000L))
    }

    // ── bodyFor (the body branch the composable switches on) ──────────────────────────────────────────

    @Test
    fun bodyShowsDataWheneverEntriesExist() {
        assertEquals(LiveSignalTailBody.Data, LiveSignalTailProjection.bodyFor(LiveConnectionStatus.Disconnected, true))
    }

    @Test
    fun bodyClassifiesEmptyBranchesByWire() {
        assertEquals(LiveSignalTailBody.Error, LiveSignalTailProjection.bodyFor(LiveConnectionStatus.Disconnected, false))
        assertEquals(LiveSignalTailBody.Empty, LiveSignalTailProjection.bodyFor(LiveConnectionStatus.Connected, false))
        assertEquals(LiveSignalTailBody.Loading, LiveSignalTailProjection.bodyFor(LiveConnectionStatus.Unknown, false))
        assertEquals(LiveSignalTailBody.Loading, LiveSignalTailProjection.bodyFor(LiveConnectionStatus.Reconnecting, false))
    }

    @Test
    fun errorKindIsNetwork() {
        assertEquals(QueryErrorKind.Network, LiveSignalTailProjection.errorKind())
    }

    // ── badgeVariant (web Type-column variant + value color) ──────────────────────────────────────────

    @Test
    fun badgeVariantMatchesWebTernary() {
        assertEquals(BadgeVariant.Info, LiveSignalTailProjection.badgeVariant(SignalValueType.Number))
        assertEquals(BadgeVariant.Warning, LiveSignalTailProjection.badgeVariant(SignalValueType.Boolean))
        assertEquals(BadgeVariant.Success, LiveSignalTailProjection.badgeVariant(SignalValueType.Text))
    }

    // ── state derivations ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun stateDerivesUniqueAndBodyAndChips() {
        val state =
            LiveSignalTailState(
                entries = listOf(entry(1, "Speed"), entry(2, "Speed"), entry(3, "Gear")),
                rate = 3,
                paused = false,
                bufferMax = DEFAULT_BUFFER_MAX,
                status = LiveConnectionStatus.Connected,
                isStale = false,
                updatedAtMillis = 1L,
            )
        assertEquals(2, state.uniqueSignals)
        assertTrue(state.hasEntries)
        assertFalse(state.isOffline)
        assertEquals(LiveSignalTailBody.Data, state.body)
    }

    @Test
    fun stateOfflineAndConnectingFlags() {
        val offline = LiveSignalTailState.initial().copy(status = LiveConnectionStatus.Disconnected)
        assertTrue(offline.isOffline)
        assertEquals(LiveSignalTailBody.Error, offline.body)

        val connecting = LiveSignalTailState.initial()
        assertTrue(connecting.isConnecting)
        assertEquals(LiveSignalTailBody.Loading, connecting.body)
    }

    // ── accessibility-name fold ───────────────────────────────────────────────────────────────────────

    @Test
    fun accessibleNamesCoverEveryControlAndAreBlankFree() {
        val running = interactiveAccessibleNames(STRINGS, paused = false)
        assertEquals(listOf("Filter signals", "Pause", "Auto-scroll", "Clear"), running)
        assertTrue(running.none { it.isBlank() })

        val paused = interactiveAccessibleNames(STRINGS, paused = true)
        assertEquals("Resume", paused[1])
    }

    // ── i18n key mapping (P1/S10) ─────────────────────────────────────────────────────────────────────

    @Test
    fun i18nKeysMatchTheCatalogResourceNames() {
        assertEquals("translation_liveMonitor_time", KEY_TIME)
        assertEquals("translation_liveMonitor_signal", KEY_SIGNAL)
        assertEquals("translation_liveMonitor_value", KEY_VALUE)
        assertEquals("translation_liveMonitor_type", KEY_TYPE)
        assertEquals("translation_liveMonitor_freshness", KEY_FRESHNESS)
        assertEquals("translation_liveMonitor_filterPlaceholder", KEY_FILTER_HINT)
        assertEquals("translation_liveMonitor_filterLabel", KEY_FILTER_LABEL)
        assertEquals("translation_liveMonitor_resume", KEY_RESUME)
        assertEquals("translation_liveMonitor_pause", KEY_PAUSE)
        assertEquals("translation_liveMonitor_autoScroll", KEY_AUTO_SCROLL)
        assertEquals("translation_liveMonitor_clear", KEY_CLEAR)
        assertEquals("translation_liveMonitor_sigPerSec", KEY_SIG_PER_SEC)
        assertEquals("translation_liveMonitor_bufferSize", KEY_BUFFER_SIZE)
        assertEquals("translation_liveMonitor_uniqueSignals", KEY_UNIQUE_SIGNALS)
        assertEquals("translation_liveMonitor_filtered", KEY_FILTERED)
        assertEquals("translation_liveMonitor_waiting", KEY_WAITING)
        assertEquals("translation_liveMonitor_noMatch", KEY_NO_MATCH)
        assertEquals("translation_liveMonitor_title", KEY_TITLE)
    }

    // ── view.opened diagnostic ────────────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSlug() {
        val logger = RecordingLogger()
        recordLiveSignalTailOpened(logger)
        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("surface" to LIVE_SIGNAL_TAIL_SLUG), opened.second)
        assertFalse(opened.second.containsKey("value"))
    }

    private companion object {
        val STRINGS =
            LiveSignalTailStrings(
                title = "Live Monitor",
                time = "Time",
                signal = "Signal",
                value = "Value",
                type = "Type",
                freshness = "Freshness",
                filterHint = "Filter by signal name…",
                filterLabel = "Filter signals",
                resume = "Resume",
                pause = "Pause",
                autoScroll = "Auto-scroll",
                clear = "Clear",
                sigPerSec = "Signals / sec",
                bufferSize = "Buffer Size",
                uniqueSignals = "Unique Signals",
                filtered = "Filtered",
                waiting = "Waiting for signals…",
                noMatch = "No signals match filter",
            )

        fun entry(
            id: Long,
            name: String,
            ts: Long = 0L,
        ): LiveSignalEntry = LiveSignalEntry(id, ts, name, "v", SignalValueType.Text)
    }
}
