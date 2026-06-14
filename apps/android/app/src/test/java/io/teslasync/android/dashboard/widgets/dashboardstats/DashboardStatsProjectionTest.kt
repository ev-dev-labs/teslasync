package io.teslasync.android.dashboard.widgets.dashboardstats

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.DashboardStats
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Off-device coverage for the pure [DashboardStatsProjection] — the web component's `useMemo` derivations + the
 * merged-freshness fold reproduced as pure functions, so every render branch (compact / standard / wide /
 * empty) and every cache-then-network state (loading / content / empty / stale-offline / error) is asserted in
 * the :android:testReleaseUnitTest gate without a device. These assertions double as the per-state snapshot.
 */
class DashboardStatsProjectionTest {
    private val nowMillis = 1_000_000_000_000L

    private fun strings() =
        DashboardStatsStrings(
            title = "Dashboard Stats",
            vehicles = "Vehicles",
            trips = "Trips",
            sessions = "Charge Sessions",
            fsmState = "FSM State",
            active = "active",
            currentState = "Current State",
            recentTransitions = "Recent Transitions",
            noData = "No dashboard stats available",
            justNow = "just now",
            minutesAgo = "%1\$sm ago",
            hoursAgo = "%1\$sh ago",
            daysAgo = "%1\$sd ago",
        )

    private fun stats() = DashboardStats(totalVehicles = 3, totalChargingSessions = 214, totalTrips = 1_286)

    private fun fsmJson(state: String): JsonElement = buildJsonObject { put("state", state) }

    private fun timelineJson(vararg transitions: Pair<String, String?>): JsonElement =
        buildJsonObject {
            put(
                "transitions",
                buildJsonArray {
                    transitions.forEach { (state, startedAt) ->
                        add(
                            buildJsonObject {
                                put("state", state)
                                if (startedAt != null) put("startedAt", startedAt)
                            },
                        )
                    }
                },
            )
        }

    // ---- fmtInt + formatRelative -------------------------------------------------------------

    @Test
    fun fmtIntGroupsThousands() {
        assertEquals("1,286", DashboardStatsProjection.fmtInt(1_286L, Locale.US))
        assertEquals("0", DashboardStatsProjection.fmtInt(0L, Locale.US))
    }

    @Test
    fun formatRelativeNullStampIsEmDash() {
        assertEquals(EM_DASH, DashboardStatsProjection.formatRelative(null, nowMillis, strings(), Locale.US))
    }

    @Test
    fun formatRelativeBucketsMatchWeb() {
        val s = strings()
        assertEquals("just now", DashboardStatsProjection.formatRelative(nowMillis - 30_000L, nowMillis, s, Locale.US))
        assertEquals("5m ago", DashboardStatsProjection.formatRelative(nowMillis - 5 * 60_000L, nowMillis, s, Locale.US))
        assertEquals("3h ago", DashboardStatsProjection.formatRelative(nowMillis - 3 * 3_600_000L, nowMillis, s, Locale.US))
        assertEquals("2d ago", DashboardStatsProjection.formatRelative(nowMillis - 2 * 86_400_000L, nowMillis, s, Locale.US))
    }

    @Test
    fun formatRelativeBeyondAWeekFallsBackToAbsoluteDate() {
        val started = nowMillis - 10 * 86_400_000L
        val expected = SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(started))
        assertEquals(expected, DashboardStatsProjection.formatRelative(started, nowMillis, strings(), Locale.US))
    }

    // ---- parseFsmState + parseTransitions ----------------------------------------------------

    @Test
    fun parseFsmStateReadsStateOrFallsBackToEmDash() {
        assertEquals("driving", DashboardStatsProjection.parseFsmState(fsmJson("driving")))
        assertEquals(EM_DASH, DashboardStatsProjection.parseFsmState(buildJsonObject { }))
        assertEquals(EM_DASH, DashboardStatsProjection.parseFsmState(JsonPrimitive("driving")))
        assertEquals(EM_DASH, DashboardStatsProjection.parseFsmState(null))
    }

    @Test
    fun parseTransitionsUnwrapsTransitionsArrayWithPerRowFallbacks() {
        val parsed =
            DashboardStatsProjection.parseTransitions(
                timelineJson("charging" to "2026-06-14T01:00:00Z", "driving" to null),
            )
        assertEquals(2, parsed.size)
        assertEquals("charging", parsed[0].state)
        assertTrue(parsed[0].startedAtMillis != null)
        assertEquals("driving", parsed[1].state)
        assertNull(parsed[1].startedAtMillis)
    }

    @Test
    fun parseTransitionsEmptyForNonObjectOrMissingArray() {
        assertTrue(DashboardStatsProjection.parseTransitions(null).isEmpty())
        assertTrue(DashboardStatsProjection.parseTransitions(JsonPrimitive("x")).isEmpty())
        assertTrue(DashboardStatsProjection.parseTransitions(buildJsonObject { }).isEmpty())
    }

    // ---- project (per-footprint snapshots) ---------------------------------------------------

    @Test
    fun projectStandardBuildsFourTilesWithRawFsmState() {
        val snapshot = DashboardStatsSnapshot(stats(), "driving", emptyList())
        val display = DashboardStatsProjection.project(snapshot, DashboardStatsSize(2, 2), strings(), nowMillis, Locale.US)

        assertTrue(display.hasData)
        assertFalse(display.isCompact)
        assertFalse(display.isWide)
        assertEquals(4, display.statTiles.size)
        assertEquals(DashboardStatTile("Vehicles", "3"), display.statTiles[0])
        assertEquals(DashboardStatTile("Trips", "1,286"), display.statTiles[1])
        assertEquals(DashboardStatTile("Charge Sessions", "214"), display.statTiles[2])
        assertEquals(DashboardStatTile("FSM State", "driving"), display.statTiles[3])
        assertEquals("driving", display.fsmState)
        assertEquals("Current State, driving", display.currentStateContentDescription)
        assertTrue(display.recentTransitions.isEmpty())
    }

    @Test
    fun projectCompactExposesTripCountAndActiveLabel() {
        val snapshot = DashboardStatsSnapshot(stats(), "driving", emptyList())
        val display = DashboardStatsProjection.project(snapshot, DashboardStatsSize(1, 2), strings(), nowMillis, Locale.US)

        assertTrue(display.isCompact)
        assertEquals("1,286", display.compactValue)
        assertEquals("active", display.compactLabel)
        assertEquals("1,286 active", display.compactContentDescription)
    }

    @Test
    fun projectWideCapsRecentTransitionsAtFiveAndCapitalizes() {
        val transitions = (1..7).map { RawTransition("charging", nowMillis - it * 60_000L) }
        val snapshot = DashboardStatsSnapshot(stats(), "driving", transitions)
        val display = DashboardStatsProjection.project(snapshot, DashboardStatsSize(4, 4), strings(), nowMillis, Locale.US)

        assertTrue(display.isWide)
        assertEquals(5, display.recentTransitions.size)
        assertEquals("Charging", display.recentTransitions[0].label)
        assertEquals("1m ago", display.recentTransitions[0].timeText)
        assertEquals("Charging, 1m ago", display.recentTransitions[0].contentDescription)
    }

    @Test
    fun projectWithoutStatsIsEmptyWithEmDashTiles() {
        val snapshot = DashboardStatsSnapshot(null, EM_DASH, emptyList())
        val display = DashboardStatsProjection.project(snapshot, DashboardStatsSize(2, 2), strings(), nowMillis, Locale.US)

        assertFalse(display.hasData)
        assertEquals("0", display.statTiles[0].value)
        assertEquals(EM_DASH, display.statTiles[3].value)
        assertEquals("No dashboard stats available", display.emptyMessage)
    }

    // ---- foldState (cache-then-network state matrix) -----------------------------------------

    @Test
    fun foldStateLoadingWhileStatsFirstLoads() {
        val ui = DashboardStatsProjection.foldState(loadingStats(), null, null)
        assertEquals(UiPhase.Loading, ui.phase)
    }

    @Test
    fun foldStateLoadingWhileFsmFirstLoadsForResolvedVehicle() {
        val ui = DashboardStatsProjection.foldState(Resource.Success(stats(), 100L, false), loadingJson(), null)
        assertEquals(UiPhase.Loading, ui.phase)
    }

    @Test
    fun foldStateContentMergesFreshnessAndParsesFsm() {
        val ui =
            DashboardStatsProjection.foldState(
                Resource.Success(stats(), 100L, false),
                Resource.Success(fsmJson("charging"), 200L, false),
                Resource.Success(timelineJson(), 150L, false),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(200L, ui.fetchedAt)
        assertEquals("charging", ui.data?.fsmState)
        assertFalse(ui.hasError)
    }

    @Test
    fun foldStateEmptyWhenStatsErrorsWithNoCache() {
        val ui =
            DashboardStatsProjection.foldState(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                null,
                null,
            )
        assertEquals(UiPhase.Empty, ui.phase)
        assertEquals(ErrorKind.Network, ui.errorKind)
        assertNull(ui.data?.dashStats)
    }

    @Test
    fun foldStateStaleOfflineKeepsCachedStatsWithError() {
        val ui =
            DashboardStatsProjection.foldState(
                Resource.Error(cached = stats(), fetchedAt = 100L, stale = true, error = ApiError.Timeout()),
                null,
                null,
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertTrue(ui.stale)
        assertTrue(ui.isOffline)
        assertEquals(ErrorKind.Timeout, ui.errorKind)
    }

    @Test
    fun foldStateTimelineErrorFoldsIntoFreshnessWhileStatsStillContent() {
        val ui =
            DashboardStatsProjection.foldState(
                Resource.Success(stats(), 100L, false),
                Resource.Success(fsmJson("driving"), 90L, false),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 404)),
            )
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(ErrorKind.Http, ui.errorKind)
        assertEquals(404, ui.httpStatus)
        assertTrue(ui.hasData)
    }

    @Test
    fun foldStateDisabledFsmTimelineContributesNothing() {
        val ui = DashboardStatsProjection.foldState(Resource.Success(stats(), 100L, false), null, null)
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(EM_DASH, ui.data?.fsmState)
        assertTrue(ui.data?.transitions?.isEmpty() == true)
        assertFalse(ui.hasError)
    }

    private fun loadingStats(): Resource<DashboardStats> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
}
