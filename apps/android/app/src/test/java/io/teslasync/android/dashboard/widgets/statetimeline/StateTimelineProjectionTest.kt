package io.teslasync.android.dashboard.widgets.statetimeline

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
import java.util.Locale

/**
 * Off-device verification of the StateTimelineWidget's pure logic — the raw-JSON decode of both array feeds
 * (incl. the camelCase→snake_case wire tolerance), the stacked-bar derivation (sum, percent, insertion order
 * preserved — NOT sorted), the 24h-stripe derivation (sum, percent, drop <0.5%), the duration formatter, the
 * compact/standard/wide projection branches (incl. the 5-item legend cap + the wide stripe gate), the
 * TalkBack content descriptions, the two-feed cache-then-network fold (loading / content / empty / error /
 * stale-offline), and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/StateTimelineWidget.tsx).
 */
class StateTimelineProjectionTest {
    private val strings =
        StateTimelineStrings(
            title = "State Timeline",
            timelineLabel = "24h Timeline",
            noData = "No state data available",
            hourSuffix = "h",
            minuteSuffix = "m",
            stateLabel = { raw -> raw.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() } },
        )

    private val standardSize = StateTimelineRegistration.defaultSize
    private val compactSize = StateTimelineSize(cols = 1, rows = 4)
    private val wideSize = StateTimelineSize(cols = 3, rows = 4)

    // ── Decode ──────────────────────────────────────────────────────────────────

    @Test
    fun parseSummaryReadsRowsWithCamelCaseFields() {
        val rows = parseStateSummary(summaryJson("driving" to 70.0, "charging" to 30.0))
        assertEquals(2, rows.size)
        assertEquals("driving", rows[0].state)
        assertEquals(70.0, rows[0].totalMin, 0.0)
        assertEquals(30.0, rows[1].totalMin, 0.0)
    }

    @Test
    fun parseSummaryToleratesSnakeCaseWireAndMissingFields() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("state", "idle")
                        // snake_case wire form (web reads either via camelCaseKeys).
                        put("total_min", 42.0)
                        put("count", 3L)
                    },
                )
                // Missing fields → em-dash + zero fallbacks (web `?? '—'` / `?? 0`).
                add(buildJsonObject { put("count", 1L) })
            }
        val rows = parseStateSummary(json)
        assertEquals(2, rows.size)
        assertEquals(42.0, rows[0].totalMin, 0.0)
        assertEquals(3L, rows[0].count)
        assertEquals("\u2014", rows[1].state)
        assertEquals(0.0, rows[1].totalMin, 0.0)
    }

    @Test
    fun parseSummaryEmptyForNonArray() {
        assertTrue(parseStateSummary(null).isEmpty())
        assertTrue(parseStateSummary(buildJsonObject { put("oops", true) }).isEmpty())
    }

    @Test
    fun parseTimelineReadsTransitionsWithBlankStateFallback() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("state", "charging")
                        put("startDate", "2026-01-01T00:00:00Z")
                        put("durationMin", 60.0)
                    },
                )
                // Missing state → blank fallback (web `tr.state ?? ''`), NOT an em-dash.
                add(buildJsonObject { put("duration_min", 15.0) })
            }
        val rows = parseTimeline(json)
        assertEquals(2, rows.size)
        assertEquals("charging", rows[0].state)
        assertEquals(60.0, rows[0].durationMin, 0.0)
        assertEquals("", rows[1].state)
        assertEquals(15.0, rows[1].durationMin, 0.0)
    }

    // ── Stacked-bar segments ──────────────────────────────────────────────────────

    @Test
    fun buildSegmentsPreservesOrderAndComputesPercent() {
        val segments =
            StateTimelineProjection.buildSegments(
                listOf(RawStateSummary("idle", 30.0, 2), RawStateSummary("driving", 70.0, 5)),
                strings,
                Locale.US,
            )
        // Insertion order preserved (web does NOT sort the segments).
        assertEquals(listOf("idle", "driving"), segments.map { it.state })
        assertEquals("30.0%", segments[0].pctText)
        assertEquals("30%", segments[0].pctLegendText)
        assertEquals("70.0%", segments[1].pctText)
        assertEquals("Idle", segments[0].label)
    }

    @Test
    fun buildSegmentsEmptyWhenTotalZero() {
        assertTrue(StateTimelineProjection.buildSegments(listOf(RawStateSummary("idle", 0.0, 0)), strings).isEmpty())
        assertTrue(StateTimelineProjection.buildSegments(emptyList(), strings).isEmpty())
    }

    @Test
    fun buildSegmentsRowDescriptionFoldsLabelDurationPercent() {
        val segments =
            StateTimelineProjection.buildSegments(listOf(RawStateSummary("driving", 125.0, 1)), strings, Locale.US)
        // Single state ⇒ 100%; 125 min ⇒ 2h 5m.
        assertEquals("Driving, 2h 5m, 100.0%", segments.single().rowContentDescription)
    }

    // ── 24h stripe ────────────────────────────────────────────────────────────────

    @Test
    fun buildStripeDropsSubHalfPercentSlices() {
        val stripe =
            StateTimelineProjection.buildStripe(
                listOf(
                    RawTransition("driving", "", 100.0),
                    RawTransition("charging", "", 100.0),
                    RawTransition("idle", "", 0.1),
                ),
                strings,
            )
        // idle ≈ 0.05% < 0.5% is dropped; the two ~50% slices remain in order.
        assertEquals(listOf("driving", "charging"), stripe.map { it.state })
    }

    @Test
    fun buildStripeEmptyWhenTotalZero() {
        assertTrue(StateTimelineProjection.buildStripe(listOf(RawTransition("driving", "", 0.0)), strings).isEmpty())
        assertTrue(StateTimelineProjection.buildStripe(emptyList(), strings).isEmpty())
    }

    // ── Duration formatter (web fmtDuration, minutes input) ────────────────────────

    @Test
    fun formatDurationMinutesOnlyBelowOneHour() {
        assertEquals("5m", StateTimelineProjection.formatDuration(5.0, strings))
        assertEquals("0m", StateTimelineProjection.formatDuration(0.0, strings))
    }

    @Test
    fun formatDurationHoursAndMinutes() {
        assertEquals("2h 5m", StateTimelineProjection.formatDuration(125.0, strings))
    }

    // ── Projection ─────────────────────────────────────────────────────────────────

    @Test
    fun projectStandardBuildsBarAndRowsWithoutStripe() {
        val display =
            StateTimelineProjection.project(
                StateTimelineSnapshot(
                    summary = summaryJson("driving" to 70.0, "charging" to 30.0),
                    timeline = timelineJson(listOf("driving" to 120.0, "charging" to 60.0)),
                ),
                standardSize,
                strings,
                Locale.US,
            )
        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertEquals(2, display.segments.size)
        // 2-column standard footprint: no stripe even though transitions exist (web `isWide` gate).
        assertFalse(display.showStripe)
        assertTrue(display.stackedBarContentDescription.startsWith("State Timeline:"))
    }

    @Test
    fun projectWideShowsStripe() {
        val display =
            StateTimelineProjection.project(
                StateTimelineSnapshot(
                    summary = summaryJson("driving" to 70.0, "charging" to 30.0),
                    timeline = timelineJson(listOf("driving" to 120.0, "charging" to 60.0)),
                ),
                wideSize,
                strings,
                Locale.US,
            )
        assertTrue(display.isWide)
        assertTrue(display.showStripe)
        assertEquals(2, display.stripe.size)
        assertTrue(display.stripeContentDescription.startsWith("24h Timeline:"))
    }

    @Test
    fun projectCompactCapsLegendAtFive() {
        val display =
            StateTimelineProjection.project(
                StateTimelineSnapshot(
                    summary =
                        summaryJson(
                            "a" to 10.0,
                            "b" to 10.0,
                            "c" to 10.0,
                            "d" to 10.0,
                            "e" to 10.0,
                            "f" to 10.0,
                        ),
                    timeline = timelineJson(emptyList()),
                ),
                compactSize,
                strings,
                Locale.US,
            )
        assertTrue(display.isCompact)
        assertEquals(6, display.segments.size)
        // Web compact legend `segments.slice(0, 5)`.
        assertEquals(5, display.compactSegments.size)
        // Compact never shows the stripe even if transitions existed.
        assertFalse(display.showStripe)
    }

    @Test
    fun projectEmptyWhenNoPositiveState() {
        val display =
            StateTimelineProjection.project(
                StateTimelineSnapshot(summaryJson("idle" to 0.0), timelineJson(emptyList())),
                standardSize,
                strings,
                Locale.US,
            )
        assertFalse(display.hasData)
        assertTrue(display.segments.isEmpty())
        assertEquals("No state data available", display.emptyMessage)
    }

    // ── Two-feed fold ─────────────────────────────────────────────────────────────

    @Test
    fun foldStateLoadingWhenEitherFeedFirstLoads() {
        val state = StateTimelineProjection.foldState(loading(), success(summaryJson("driving" to 70.0), 10L))
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun foldStateContentMergesFreshnessStamp() {
        val state =
            StateTimelineProjection.foldState(
                success(summaryJson("driving" to 70.0), 100L),
                success(timelineJson(emptyList()), 200L),
            )
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(200L, state.fetchedAt)
    }

    @Test
    fun foldStateEmptyWhenSummaryHasNoPositiveState() {
        val state =
            StateTimelineProjection.foldState(
                success(summaryJson("idle" to 0.0), 100L),
                success(timelineJson(emptyList()), 100L),
            )
        assertEquals(UiPhase.Empty, state.phase)
    }

    @Test
    fun foldStateHardErrorWhenSummaryFailsWithNoCache() {
        val state =
            StateTimelineProjection.foldState(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                success(timelineJson(emptyList()), 100L),
            )
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Network, state.errorKind)
        assertTrue(state.canRetry)
    }

    @Test
    fun foldStateOfflineKeepsCachedSummaryWithStaleAndError() {
        val cached = summaryJson("driving" to 70.0)
        val state =
            StateTimelineProjection.foldState(
                Resource.Error(cached = cached, fetchedAt = 100L, stale = true, error = ApiError.Timeout()),
                success(timelineJson(emptyList()), 100L),
            )
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertEquals(ErrorKind.Timeout, state.errorKind)
    }

    @Test
    fun foldStateTimelineOnlyFailureFoldsIntoStaleNotError() {
        val state =
            StateTimelineProjection.foldState(
                success(summaryJson("driving" to 70.0), 100L),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        // Summary is primary: a timeline-only failure keeps content (bar visible) + flags stale/offline.
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.stale)
        assertEquals(ErrorKind.Network, state.errorKind)
    }

    @Test
    fun emptyStateIsEmptyPhase() {
        assertEquals(UiPhase.Empty, StateTimelineProjection.emptyState().phase)
    }

    // ── Registry metadata ──────────────────────────────────────────────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("state-timeline", StateTimelineRegistration.ID)
        assertEquals("analytics", StateTimelineRegistration.CATEGORY)
        assertEquals("StateTimelineWidget", StateTimelineRegistration.SLUG)
        assertEquals(StateTimelineSize(2, 4), StateTimelineRegistration.defaultSize)
        assertEquals(StateTimelineSize(1, 2), StateTimelineRegistration.minSize)
        assertEquals(StateTimelineSize(4, 40), StateTimelineRegistration.maxSize)
    }

    @Test
    fun registrationClampsOutOfBoundsFootprint() {
        assertEquals(StateTimelineSize(1, 2), StateTimelineRegistration.clamp(StateTimelineSize(0, 1)))
        assertEquals(StateTimelineSize(4, 40), StateTimelineRegistration.clamp(StateTimelineSize(9, 99)))
        assertTrue(StateTimelineRegistration.isWithinBounds(StateTimelineSize(2, 4)))
        assertFalse(StateTimelineRegistration.isWithinBounds(StateTimelineSize(9, 1)))
    }

    private companion object {
        fun summaryJson(vararg entries: Pair<String, Double>): JsonElement =
            buildJsonArray {
                entries.forEach { (state, totalMin) ->
                    add(
                        buildJsonObject {
                            put("state", state)
                            put("totalMin", totalMin)
                            put("count", 1L)
                        },
                    )
                }
            }

        fun timelineJson(rows: List<Pair<String, Double>>): JsonElement =
            buildJsonArray {
                rows.forEach { (state, durationMin) ->
                    add(
                        buildJsonObject {
                            put("state", state)
                            put("startDate", "")
                            put("durationMin", durationMin)
                        },
                    )
                }
            }

        fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun success(
            json: JsonElement,
            fetchedAt: Long,
        ): Resource<JsonElement> = Resource.Success(json, fetchedAt, false)
    }
}
