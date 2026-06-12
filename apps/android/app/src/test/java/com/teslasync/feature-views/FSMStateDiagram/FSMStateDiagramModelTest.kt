// Off-device unit coverage for the FSMStateDiagram feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the FSM registry (the verbatim `web/src/types/fsm/*` state order +
// semantic variant), the transition roll-up (the web `useMemo`: per-state + per-edge counts, latest/current
// state, the `fsm_name`/`all` filter, tolerant `ts` parsing), the diagram projection (nodes always rendered
// incl. dimmed inactive + current marker + per-arrow counts, the busiest-edge summary, and the unknown-type
// null branch), the top-level lifecycle classifier the composable switches on (per-state coverage incl.
// stale/offline), and the i18n key mirrors (a11y/label coverage). No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmstatediagram

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FSMStateDiagramModelTest {
    private fun tr(
        fsmName: String = "vehicle",
        from: String,
        to: String,
        ts: String = "2026-06-11T10:00:00Z",
    ) = FsmTransitionRow(fsmName = fsmName, fromState = from, toState = to, ts = ts)

    private fun node(
        content: FsmDiagramContent,
        name: String,
    ): FsmStateNodeVm = content.nodes.first { it.name == name }

    // ── registry: verbatim port of web FSM_STATES order + *_STATE_ENTRIES variant ──

    @Test
    fun vehicleRegistryMatchesWebStatesAndVariants() {
        val states = FsmRegistry.definitionFor("vehicle")!!.states
        assertEquals(
            listOf("online", "driving", "charging", "parked", "updating", "asleep", "offline"),
            states.map { it.name },
        )
        assertEquals(FsmStateTone.Success, FsmRegistry.toneFor("vehicle", "online"))
        assertEquals(FsmStateTone.Success, FsmRegistry.toneFor("vehicle", "driving"))
        assertEquals(FsmStateTone.Warning, FsmRegistry.toneFor("vehicle", "charging"))
        assertEquals(FsmStateTone.Info, FsmRegistry.toneFor("vehicle", "parked"))
        assertEquals(FsmStateTone.Info, FsmRegistry.toneFor("vehicle", "updating"))
        assertEquals(FsmStateTone.Neutral, FsmRegistry.toneFor("vehicle", "asleep"))
        assertEquals(FsmStateTone.Danger, FsmRegistry.toneFor("vehicle", "offline"))
    }

    @Test
    fun telemetryConnectionRegistryMatchesWebStatesAndVariants() {
        val states = FsmRegistry.definitionFor("telemetry_connection")!!.states
        assertEquals(
            listOf("unknown", "connecting", "streaming", "stale", "disconnected", "polling_only"),
            states.map { it.name },
        )
        assertEquals(FsmStateTone.Success, FsmRegistry.toneFor("telemetry_connection", "streaming"))
        assertEquals(FsmStateTone.Danger, FsmRegistry.toneFor("telemetry_connection", "disconnected"))
        assertEquals(FsmStateTone.Info, FsmRegistry.toneFor("telemetry_connection", "polling_only"))
    }

    @Test
    fun allEightWebMachinesAreRegistered() {
        val expected =
            setOf(
                "vehicle",
                "drive_session",
                "charge_session",
                "command",
                "notification",
                "alert_cooldown",
                "automation",
                "telemetry_connection",
            )
        assertEquals(expected, FsmRegistry.definitions.keys)
    }

    @Test
    fun toneForFallsBackToVehicleForUnknownTypeAndNeutralForUnknownState() {
        // Web getStateColor: unknown fsmType uses FSM_REGISTRY.vehicle; unknown state -> DEFAULT_STATE.
        assertEquals(FsmStateTone.Success, FsmRegistry.toneFor("mystery", "online"))
        assertEquals(FsmStateTone.Neutral, FsmRegistry.toneFor("vehicle", "bogus"))
        // Case-insensitive lookup (web states[state.toLowerCase()]).
        assertEquals(FsmStateTone.Success, FsmRegistry.toneFor("vehicle", "ONLINE"))
    }

    // ── isKnownFsmType / project null branch (web !states || !edges) ──

    @Test
    fun unknownFsmTypeIsNotKnownAndProjectsNull() {
        assertFalse(FsmStateDiagramProjection.isKnownFsmType("all"))
        assertFalse(FsmStateDiagramProjection.isKnownFsmType(""))
        assertNull(FsmStateDiagramProjection.project("all", listOf(tr(from = "online", to = "driving"))))
    }

    @Test
    fun knownFsmTypeIsKnownAndProjectsNonNull() {
        assertTrue(FsmStateDiagramProjection.isKnownFsmType("vehicle"))
        assertNotNull(FsmStateDiagramProjection.project("vehicle", emptyList()))
    }

    // ── rollUp: the web useMemo (counts, edges, latest, fsm_name filter, ts parsing) ──

    @Test
    fun rollUpCountsBothEndpointsAndEdgesAndTracksLatest() {
        val transitions =
            listOf(
                tr(from = "online", to = "driving", ts = "2026-06-11T10:00:00Z"),
                tr(from = "driving", to = "parked", ts = "2026-06-11T10:30:00Z"),
                tr(from = "parked", to = "charging", ts = "2026-06-11T11:00:00Z"),
                tr(from = "charging", to = "parked", ts = "2026-06-11T12:00:00Z"),
            )
        val rollup = FsmStateDiagramProjection.rollUp("vehicle", transitions)
        assertEquals(1, rollup.stateCounts["online"])
        assertEquals(2, rollup.stateCounts["driving"])
        assertEquals(3, rollup.stateCounts["parked"])
        assertEquals(2, rollup.stateCounts["charging"])
        assertEquals(1, rollup.edgeCounts["online->driving"])
        assertEquals(1, rollup.edgeCounts["charging->parked"])
        // Latest by timestamp is the final transition's to_state.
        assertEquals("parked", rollup.latestState)
    }

    @Test
    fun rollUpFiltersByFsmNameUnlessAll() {
        val transitions =
            listOf(
                tr(fsmName = "vehicle", from = "online", to = "driving"),
                tr(fsmName = "telemetry_connection", from = "streaming", to = "stale"),
            )
        val vehicleOnly = FsmStateDiagramProjection.rollUp("vehicle", transitions)
        assertNull(vehicleOnly.stateCounts["streaming"])
        assertEquals(1, vehicleOnly.stateCounts["online"])
        // 'all' counts every machine's transitions (web fsmType === 'all' bypasses the skip).
        val all = FsmStateDiagramProjection.rollUp("all", transitions)
        assertEquals(1, all.stateCounts["streaming"])
        assertEquals(1, all.stateCounts["online"])
    }

    @Test
    fun rollUpIgnoresUnparseableTimestampForLatest() {
        // A bad ts must never win the latest race (web NaN > latestTime is always false).
        val transitions =
            listOf(
                tr(from = "online", to = "driving", ts = "2026-06-11T10:00:00Z"),
                tr(from = "driving", to = "offline", ts = "not-a-date"),
            )
        val rollup = FsmStateDiagramProjection.rollUp("vehicle", transitions)
        assertEquals("driving", rollup.latestState)
    }

    // ── project: nodes (ordered, dimmed, current, arrow counts) + edge summary ──

    @Test
    fun projectBuildsOrderedNodesWithCountsCurrentAndArrowCounts() {
        val transitions =
            listOf(
                tr(from = "online", to = "driving", ts = "2026-06-11T10:00:00Z"),
                tr(from = "driving", to = "parked", ts = "2026-06-11T10:30:00Z"),
                tr(from = "parked", to = "charging", ts = "2026-06-11T11:00:00Z"),
                tr(from = "charging", to = "parked", ts = "2026-06-11T12:00:00Z"),
            )
        val content = FsmStateDiagramProjection.project("vehicle", transitions)!!
        // Every canonical state renders, in order — even those with zero transitions (never hidden).
        assertEquals(
            listOf("online", "driving", "charging", "parked", "updating", "asleep", "offline"),
            content.nodes.map { it.name },
        )
        val online = node(content, "online")
        assertEquals(1, online.count)
        assertTrue(online.isActive)
        assertTrue(online.hasArrow)
        assertEquals(1, online.arrowCountToNext) // online->driving edge count
        val parked = node(content, "parked")
        assertEquals(3, parked.count)
        assertTrue(parked.isCurrent) // latest to_state
        val updating = node(content, "updating")
        assertEquals(0, updating.count)
        assertFalse(updating.isActive) // dimmed, not hidden
        assertFalse(updating.isCurrent)
        val offline = node(content, "offline")
        assertFalse(offline.hasArrow) // last node has no trailing arrow
        assertNull(offline.arrowCountToNext)
        // A consecutive pair with no observed transition carries no arrow count.
        assertNull(node(content, "driving").arrowCountToNext) // no driving->charging edge
    }

    @Test
    fun projectBuildsEdgeSummarySortedByCountDescendingAndCapped() {
        // online->driving x3, driving->parked x1, plus 11 distinct one-off edges to exceed the cap of 10.
        val transitions =
            buildList {
                repeat(3) { add(tr(from = "online", to = "driving")) }
                add(tr(from = "driving", to = "parked"))
                listOf(
                    "asleep" to "online",
                    "offline" to "online",
                    "parked" to "online",
                    "charging" to "online",
                    "online" to "charging",
                    "online" to "parked",
                    "parked" to "driving",
                    "charging" to "driving",
                    "asleep" to "driving",
                    "offline" to "driving",
                    "parked" to "asleep",
                ).forEach { (f, t) -> add(tr(from = f, to = t)) }
            }
        val summary = FsmStateDiagramProjection.project("vehicle", transitions)!!.edgeSummary
        assertEquals(EDGE_SUMMARY_LIMIT, summary.size) // capped at 10
        assertEquals("online", summary.first().from)
        assertEquals("driving", summary.first().to)
        assertEquals(3, summary.first().count) // busiest first
        // Endpoints carry their resolved tones (web colors each side via getStateColor).
        assertEquals(FsmStateTone.Success, summary.first().fromTone)
    }

    @Test
    fun projectEmptyTransitionsStillRendersAllNodesDimmedWithNoSummary() {
        val content = FsmStateDiagramProjection.project("vehicle", emptyList())!!
        assertEquals(7, content.nodes.size)
        assertTrue(content.nodes.none { it.isActive })
        assertTrue(content.nodes.none { it.isCurrent })
        assertTrue(content.edgeSummary.isEmpty())
    }

    // ── timestamp parsing (web new Date(ts).getTime()) ──

    @Test
    fun parseTimestampMillisIsTolerantAndGuardsInvalidInput() {
        val z = FsmStateDiagramProjection.parseTimestampMillis("2026-06-11T10:00:00Z")
        val later = FsmStateDiagramProjection.parseTimestampMillis("2026-06-11T11:00:00Z")
        assertNotNull(z)
        assertNotNull(later)
        assertTrue(later!! > z!!)
        assertNotNull(FsmStateDiagramProjection.parseTimestampMillis("2026-06-11T10:00:00+02:00"))
        assertNotNull(FsmStateDiagramProjection.parseTimestampMillis("2026-06-11T10:00:00"))
        assertNull(FsmStateDiagramProjection.parseTimestampMillis(""))
        assertNull(FsmStateDiagramProjection.parseTimestampMillis("   "))
        assertNull(FsmStateDiagramProjection.parseTimestampMillis("not-a-date"))
        assertNull(FsmStateDiagramProjection.parseTimestampMillis(null))
    }

    // ── per-state lifecycle classifier ──

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(FsmStateDiagramSurface.Loading, fsmStateDiagramSurfaceFor(isLoading = true, isError = false))
        assertEquals(FsmStateDiagramSurface.Error, fsmStateDiagramSurfaceFor(isLoading = false, isError = true))
        // Loading wins over error so a refresh-with-skeleton never flashes the error surface.
        assertEquals(FsmStateDiagramSurface.Loading, fsmStateDiagramSurfaceFor(isLoading = true, isError = true))
        assertEquals(FsmStateDiagramSurface.Ready, fsmStateDiagramSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(FsmStateDiagramSurface.Loading, surfaceFor(UiState.loading<List<FsmTransitionRow>>()))
        val error = UiState<List<FsmTransitionRow>>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(FsmStateDiagramSurface.Error, surfaceFor(error))
        assertEquals(FsmStateDiagramSurface.Ready, surfaceFor(UiState(UiPhase.Content, data = emptyList<FsmTransitionRow>())))
        assertEquals(FsmStateDiagramSurface.Ready, surfaceFor(UiState(UiPhase.Empty, data = emptyList<FsmTransitionRow>())))
        // Stale/offline "last known" stays on the Ready surface (cached diagram + freshness chip), never blanked.
        val offline =
            UiState(
                UiPhase.Content,
                data = listOf(tr(from = "online", to = "driving")),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(FsmStateDiagramSurface.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── a11y / i18n key mirrors + diagnostics slug ──

    @Test
    fun i18nKeyMirrorsFollowTheWebNamespace() {
        assertEquals("translation_fsm_stateDiagram", KEY_STATE_DIAGRAM)
        assertEquals("translation_fsm_selectFsmType", KEY_SELECT_FSM_TYPE)
    }

    @Test
    fun diagnosticsSlugIsStable() {
        assertEquals("FSMStateDiagram", FSM_STATE_DIAGRAM_SLUG)
    }

    /** Bridges a [UiState] to the composable's classifier the same way `FSMStateDiagramContent` does. */
    private fun surfaceFor(state: UiState<*>): FsmStateDiagramSurface =
        fsmStateDiagramSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
