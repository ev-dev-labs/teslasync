package io.teslasync.android.dashboard.widgets.fsmdistribution

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device verification of the FSMDistributionWidget's pure logic — the raw-JSON decode of both feeds,
 * the donut derivation (filter >0, percent, sort desc), the duration formatter, the compact/standard
 * projection branches (incl. the 3/5 transitions slice), the TalkBack content descriptions, the two-feed
 * cache-then-network fold (loading / content / empty / error / stale-offline), and the registry metadata.
 * Mirrors the web spec (web/src/features/dashboard/widgets/FSMDistributionWidget.tsx).
 */
class FSMDistributionProjectionTest {
    private val strings =
        FSMDistributionStrings(
            title = "State Distribution",
            recentTransitions = "Recent Transitions",
            noData = "No state data",
            hourSuffix = "h",
            minuteSuffix = "m",
            stateLabel = { raw -> raw.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() } },
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> "\u2014"
                    FreshnessAge.JustNow -> "just now"
                    is FreshnessAge.Seconds -> "${age.value}s ago"
                    is FreshnessAge.Minutes -> "${age.value}m ago"
                    is FreshnessAge.Hours -> "${age.value}h ago"
                    is FreshnessAge.Days -> "${age.value}d ago"
                    is FreshnessAge.Weeks -> "${age.value}w ago"
                }
            },
        )

    private val standardSize = FSMDistributionRegistration.defaultSize
    private val compactSize = FSMDistributionSize(cols = 1, rows = 4)

    // ── Decode ──────────────────────────────────────────────────────────────────

    @Test
    fun parseStatsReadsNestedStateMap() {
        val map = parseFSMStats(statsJson("driving" to 1_000.0, "charging" to 0.0, "asleep" to 500.0))
        assertEquals(3, map.size)
        assertEquals(1_000.0, map["driving"]!!, 0.0)
        assertEquals(0.0, map["charging"]!!, 0.0)
    }

    @Test
    fun parseStatsEmptyForNonObjectOrMissingStats() {
        assertTrue(parseFSMStats(null).isEmpty())
        assertTrue(parseFSMStats(buildJsonObject { put("enabled", true) }).isEmpty())
    }

    @Test
    fun parseTransitionsReadsRowsWithFallbacks() {
        val json =
            buildJsonObject {
                put(
                    "data",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("id", 7L)
                                put("from_state", "asleep")
                                put("to_state", "driving")
                                put("ts", "2026-01-01T00:00:00Z")
                            },
                        )
                        // Missing from/to/ts → em-dash + blank fallbacks (web `?? '—'` / `?? ''`).
                        add(buildJsonObject { put("id", 8L) })
                    },
                )
            }
        val rows = parseFSMTransitions(json)
        assertEquals(2, rows.size)
        assertEquals("asleep", rows[0].fromState)
        assertEquals("driving", rows[0].toState)
        assertEquals("\u2014", rows[1].fromState)
        assertEquals("", rows[1].ts)
    }

    // ── Donut ───────────────────────────────────────────────────────────────────

    @Test
    fun buildSegmentsDropsZeroSortsDescAndComputesPercent() {
        val segments =
            FSMDistributionProjection.buildSegments(
                mapOf("charging" to 0.0, "asleep" to 500.0, "driving" to 1_000.0),
                strings,
                Locale.US,
            )
        // Zero-time state dropped; sorted by time descending.
        assertEquals(listOf("driving", "asleep"), segments.map { it.state })
        assertEquals("67%", segments[0].pctText)
        assertEquals("33%", segments[1].pctText)
        assertEquals("Driving", segments[0].label)
    }

    @Test
    fun buildSegmentsEmptyWhenAllZero() {
        assertTrue(FSMDistributionProjection.buildSegments(mapOf("idle" to 0.0), strings).isEmpty())
    }

    // ── Duration formatter (web fmtDuration) ──────────────────────────────────────

    @Test
    fun formatDurationMinutesOnlyBelowOneHour() {
        assertEquals("5m", FSMDistributionProjection.formatDuration(5 * 60_000.0, strings))
        assertEquals("0m", FSMDistributionProjection.formatDuration(0.0, strings))
    }

    @Test
    fun formatDurationHoursAndMinutes() {
        assertEquals("2h 5m", FSMDistributionProjection.formatDuration(125 * 60_000.0, strings))
    }

    // ── Projection ────────────────────────────────────────────────────────────────

    @Test
    fun projectStandardBuildsDonutLegendAndCapsTransitionsAtFive() {
        val snapshot =
            FSMDistributionSnapshot(
                stats = statsJson("driving" to 1_000.0, "charging" to 500.0),
                transitions = transitionsJson((1..6).map { transition(it.toLong(), "idle", "driving", TS) }),
            )
        val display = FSMDistributionProjection.project(snapshot, standardSize, strings, NOW, Locale.US)

        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertEquals(2, display.segments.size)
        assertEquals(FSMDistributionProjection.STANDARD_TRANSITIONS, display.transitions.size)
        assertTrue(display.donutContentDescription.startsWith("State Distribution:"))
        assertEquals("Driving", display.currentStateLabel)
    }

    @Test
    fun projectCompactCapsTransitionsAtThreeAndFoldsHeroPhrase() {
        val snapshot =
            FSMDistributionSnapshot(
                stats = statsJson("driving" to 7_500_000.0),
                transitions = transitionsJson((1..6).map { transition(it.toLong(), "idle", "driving", TS) }),
            )
        val display = FSMDistributionProjection.project(snapshot, compactSize, strings, NOW, Locale.US)

        assertTrue(display.isCompact)
        assertEquals(FSMDistributionProjection.COMPACT_TRANSITIONS, display.transitions.size)
        // 7_500_000 ms = 125 min = 2h 5m.
        assertEquals("Driving, 2h 5m", display.compactContentDescription)
    }

    @Test
    fun projectEmptyWhenNoPositiveState() {
        val display =
            FSMDistributionProjection.project(
                FSMDistributionSnapshot(statsJson("idle" to 0.0), transitionsJson(emptyList())),
                standardSize,
                strings,
                NOW,
                Locale.US,
            )
        assertFalse(display.hasData)
        assertEquals("No state data", display.emptyMessage)
        assertEquals("\u2014", display.currentState)
    }

    @Test
    fun projectTransitionRowFoldsRelativeTimeAndDescription() {
        val snapshot =
            FSMDistributionSnapshot(
                stats = statsJson("driving" to 1_000.0),
                transitions = transitionsJson(listOf(transition(7L, "asleep", "driving", TS))),
            )
        val display = FSMDistributionProjection.project(snapshot, standardSize, strings, NOW, Locale.US)
        val row = display.transitions.single()
        assertEquals("Asleep", row.fromLabel)
        assertEquals("Driving", row.toLabel)
        assertEquals("5m ago", row.relativeTime)
        assertEquals("Asleep \u2014 Driving, 5m ago", row.contentDescription)
    }

    @Test
    fun projectTransitionRowUnknownTimestampIsEmDash() {
        val snapshot =
            FSMDistributionSnapshot(
                stats = statsJson("driving" to 1_000.0),
                transitions = transitionsJson(listOf(transition(9L, "idle", "driving", ""))),
            )
        val display = FSMDistributionProjection.project(snapshot, standardSize, strings, NOW, Locale.US)
        assertEquals("\u2014", display.transitions.single().relativeTime)
    }

    // ── Two-feed fold ─────────────────────────────────────────────────────────────

    @Test
    fun foldStateLoadingWhenEitherFeedFirstLoads() {
        val state = FSMDistributionProjection.foldState(loading(), success(transitionsJson(emptyList()), 10L))
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun foldStateContentMergesFreshnessStamp() {
        val state =
            FSMDistributionProjection.foldState(
                success(statsJson("driving" to 1_000.0), 100L),
                success(transitionsJson(emptyList()), 200L),
            )
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(200L, state.fetchedAt)
    }

    @Test
    fun foldStateEmptyWhenStatsHasNoPositiveState() {
        val state =
            FSMDistributionProjection.foldState(
                success(statsJson("idle" to 0.0), 100L),
                success(transitionsJson(emptyList()), 100L),
            )
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun foldStateHardErrorWhenStatsFailsWithNoCache() {
        val state =
            FSMDistributionProjection.foldState(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                success(transitionsJson(emptyList()), 100L),
            )
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Network, state.errorKind)
        assertTrue(state.canRetry)
    }

    @Test
    fun foldStateOfflineKeepsCachedStatsWithStaleAndError() {
        val cachedStats = statsJson("driving" to 1_000.0)
        val state =
            FSMDistributionProjection.foldState(
                Resource.Error(cached = cachedStats, fetchedAt = 100L, stale = true, error = ApiError.Timeout()),
                success(transitionsJson(emptyList()), 100L),
            )
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertEquals(ErrorKind.Timeout, state.errorKind)
    }

    @Test
    fun emptyStateIsEmptyPhase() {
        assertEquals(UiPhase.Empty, FSMDistributionProjection.emptyState().phase)
    }

    // ── Registry metadata ──────────────────────────────────────────────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("fsm-distribution", FSMDistributionRegistration.ID)
        assertEquals("analytics", FSMDistributionRegistration.CATEGORY)
        assertEquals("FSMDistributionWidget", FSMDistributionRegistration.SLUG)
        assertEquals(FSMDistributionSize(2, 4), FSMDistributionRegistration.defaultSize)
        assertEquals(FSMDistributionSize(1, 2), FSMDistributionRegistration.minSize)
        assertEquals(FSMDistributionSize(4, 40), FSMDistributionRegistration.maxSize)
    }

    @Test
    fun registrationClampsOutOfBoundsFootprint() {
        assertEquals(FSMDistributionSize(1, 2), FSMDistributionRegistration.clamp(FSMDistributionSize(0, 1)))
        assertEquals(FSMDistributionSize(4, 40), FSMDistributionRegistration.clamp(FSMDistributionSize(9, 99)))
        assertTrue(FSMDistributionRegistration.isWithinBounds(FSMDistributionSize(2, 4)))
        assertFalse(FSMDistributionRegistration.isWithinBounds(FSMDistributionSize(9, 1)))
    }

    private companion object {
        const val NOW = 1_780_000_300_000L

        // NOW minus 5 minutes, round-tripped through an RFC-3339 instant → "5m ago".
        val TS: String = Instant.ofEpochMilli(NOW - 300_000L).toString()

        fun statsJson(vararg entries: Pair<String, Double>): JsonElement =
            buildJsonObject {
                put("enabled", true)
                put("stats", buildJsonObject { entries.forEach { (state, ms) -> put(state, ms) } })
            }

        fun transition(
            id: Long,
            from: String,
            to: String,
            ts: String,
        ): JsonElement =
            buildJsonObject {
                put("id", id)
                put("from_state", from)
                put("to_state", to)
                put("ts", ts)
            }

        fun transitionsJson(rows: List<JsonElement>): JsonElement =
            buildJsonObject {
                put("data", buildJsonArray { rows.forEach { add(it) } })
                put("total", rows.size)
                put("page", 1)
                put("per_page", 5)
            }

        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun success(
            json: JsonElement,
            fetchedAt: Long,
        ): Resource<JsonElement> = Resource.Success(json, fetchedAt, false)
    }
}
