package io.teslasync.android.featureviews.fsmsubfsmpanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/**
 * Off-device verification of the FSMSubFSMPanel's pure projection — the native port of the web component's
 * render contract (web/src/features/system/components/FSMSubFSMPanel.tsx): the `fsmType` visibility gate, the
 * `type === 'drive'` kind branch, the `!terminalStates.includes(state)` active test, the
 * `getStateColor` → semantic tone mapping, the `active_subs` JSON decode, the `(subs, isLoading, error)` and
 * `Resource` → lifecycle [UiPhase] adapters, the tolerant ISO-8601 parse, and the PII-safe `view.opened`
 * diagnostic. Runs in the :android:testReleaseUnitTest gate; no Compose, no device.
 */
class FSMSubFSMPanelProjectionTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun sub(
        kind: SubFsmKind = SubFsmKind.Drive,
        state: String = "active",
        startTime: String = "2026-06-11T11:30:00Z",
    ): ActiveSubFsm = ActiveSubFsm(kind = kind, state = state, startTime = startTime)

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

    // ── Kind from wire (web `type === 'drive' ? … : …`) ───────────────────────────────────────────────

    @Test
    fun fromWireMapsDriveElseCharge() {
        assertEquals(SubFsmKind.Drive, SubFsmKind.fromWire("drive"))
        assertEquals(SubFsmKind.Charge, SubFsmKind.fromWire("charge"))
        assertEquals(SubFsmKind.Charge, SubFsmKind.fromWire("something_future"))
        assertEquals(SubFsmKind.Charge, SubFsmKind.fromWire(null))
    }

    // ── Visibility gate (web `fsmType === 'vehicle' || 'all'`) ────────────────────────────────────────

    @Test
    fun isVehicleViewOnlyForVehicleAndAll() {
        assertTrue(FSMSubFSMPanelProjection.isVehicleView("vehicle"))
        assertTrue(FSMSubFSMPanelProjection.isVehicleView("all"))
        assertFalse(FSMSubFSMPanelProjection.isVehicleView("telemetry_connection"))
        assertFalse(FSMSubFSMPanelProjection.isVehicleView(""))
        assertFalse(FSMSubFSMPanelProjection.isVehicleView("drive"))
    }

    // ── Active test (web `!terminalStates.includes(sub.state)`) ───────────────────────────────────────

    @Test
    fun driveIsActiveUnlessCompletedOrRecovered() {
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "pending")))
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "active")))
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "ending")))
        assertFalse(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "completed")))
        assertFalse(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "recovered")))
        // `done` is a charge terminal, not a drive terminal — a drive in `done` stays active (web parity).
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "done")))
    }

    @Test
    fun chargeIsActiveUnlessDoneOrRecovered() {
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Charge, "pending")))
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Charge, "active")))
        assertTrue(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Charge, "completing")))
        assertFalse(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Charge, "done")))
        assertFalse(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Charge, "recovered")))
    }

    @Test
    fun isActiveIsCaseInsensitive() {
        assertFalse(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Drive, "COMPLETED")))
        assertFalse(FSMSubFSMPanelProjection.isActive(sub(SubFsmKind.Charge, "Done")))
    }

    // ── State → tone (web getStateColor base variants) ────────────────────────────────────────────────

    @Test
    fun driveStateTones() {
        assertEquals(SubFsmStateTone.Warning, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "pending"))
        assertEquals(SubFsmStateTone.Success, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "active"))
        assertEquals(SubFsmStateTone.Warning, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "ending"))
        assertEquals(SubFsmStateTone.Info, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "completed"))
        assertEquals(SubFsmStateTone.Neutral, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "recovered"))
    }

    @Test
    fun chargeStateTones() {
        assertEquals(SubFsmStateTone.Warning, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Charge, "pending"))
        assertEquals(SubFsmStateTone.Success, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Charge, "active"))
        assertEquals(SubFsmStateTone.Info, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Charge, "completing"))
        assertEquals(SubFsmStateTone.Success, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Charge, "done"))
        assertEquals(SubFsmStateTone.Neutral, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Charge, "recovered"))
    }

    @Test
    fun unknownStateToneIsNeutralAndCaseInsensitive() {
        assertEquals(SubFsmStateTone.Neutral, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "future_state"))
        assertEquals(SubFsmStateTone.Success, FSMSubFSMPanelProjection.stateTone(SubFsmKind.Drive, "ACTIVE"))
    }

    // ── active_subs JSON decode (web `statsQuery.data?.active_subs ?? []`) ─────────────────────────────

    @Test
    fun parseActiveSubsDecodesEveryRow() {
        val element =
            json.parseToJsonElement(
                """
                {
                  "enabled": true,
                  "stats": { "active": 1000 },
                  "active_subs": [
                    { "type": "drive", "state": "active", "start_time": "2026-06-11T11:30:00Z", "drive_id": 42 },
                    { "type": "charge", "state": "completing", "start_time": "2026-06-11T11:55:00Z", "session_id": 7 }
                  ]
                }
                """.trimIndent(),
            )
        val subs = FSMSubFSMPanelProjection.parseActiveSubs(element)
        assertEquals(2, subs.size)
        assertEquals(SubFsmKind.Drive, subs[0].kind)
        assertEquals("active", subs[0].state)
        assertEquals("2026-06-11T11:30:00Z", subs[0].startTime)
        assertEquals(42L, subs[0].driveId)
        assertEquals(SubFsmKind.Charge, subs[1].kind)
        assertEquals("completing", subs[1].state)
        assertEquals(7L, subs[1].sessionId)
    }

    @Test
    fun parseActiveSubsToleratesMissingFieldsAndSkipsNonObjects() {
        val element =
            json.parseToJsonElement(
                """
                {
                  "active_subs": [
                    { "type": "charge" },
                    "garbage",
                    42
                  ]
                }
                """.trimIndent(),
            )
        val subs = FSMSubFSMPanelProjection.parseActiveSubs(element)
        assertEquals(1, subs.size)
        assertEquals(SubFsmKind.Charge, subs[0].kind)
        assertEquals("", subs[0].state)
        assertEquals("", subs[0].startTime)
        assertNull(subs[0].driveId)
    }

    @Test
    fun parseActiveSubsEmptyWhenKeyMissingOrNotObject() {
        assertTrue(FSMSubFSMPanelProjection.parseActiveSubs(json.parseToJsonElement("""{ "stats": {} }""")).isEmpty())
        assertTrue(FSMSubFSMPanelProjection.parseActiveSubs(json.parseToJsonElement("""[1,2,3]""")).isEmpty())
        assertTrue(FSMSubFSMPanelProjection.parseActiveSubs(null).isEmpty())
    }

    // ── (subs, isLoading, error) → lifecycle UiState + web branch precedence ──────────────────────────

    @Test
    fun loadingTakesPrecedenceOverEverything() {
        val state =
            FSMSubFSMPanelProjection.projectUiState(listOf(sub()), isLoading = true, isFetching = true, error = true)
        assertEquals(UiPhase.Loading, state.phase)
        assertTrue(state.refreshing)
    }

    @Test
    fun errorWhenErrorAndNotLoading() {
        val state =
            FSMSubFSMPanelProjection.projectUiState(emptyList(), isLoading = false, isFetching = false, error = true)
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Unknown, state.errorKind)
        assertTrue(state.hasError)
    }

    @Test
    fun emptyWhenNoSubsAndNoError() {
        val state =
            FSMSubFSMPanelProjection.projectUiState(emptyList(), isLoading = false, isFetching = false, error = false)
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.isEmpty)
        assertEquals(emptyList<ActiveSubFsm>(), state.data)
    }

    @Test
    fun contentWhenSubsPresentCarriesRefreshing() {
        val subs = listOf(sub(), sub(SubFsmKind.Charge, "active"))
        val state =
            FSMSubFSMPanelProjection.projectUiState(subs, isLoading = false, isFetching = true, error = false)
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(subs, state.data)
        assertTrue(state.refreshing)
    }

    // ── Resource fold (host owns the FsmStore.stats feed) ─────────────────────────────────────────────

    @Test
    fun resourceFirstLoadIsLoading() {
        val state =
            FSMSubFSMPanelProjection.projectFromResource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun resourceHardErrorWithNoCacheIsError() {
        val state =
            FSMSubFSMPanelProjection.projectFromResource(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")),
            )
        assertEquals(UiPhase.Error, state.phase)
        assertEquals(ErrorKind.Unknown, state.errorKind)
    }

    @Test
    fun resourceSuccessWithSubsIsContent() {
        val element = subsPayload()
        val state =
            FSMSubFSMPanelProjection.projectFromResource(
                Resource.Success(data = element, fetchedAt = FETCHED_AT, stale = false),
            )
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(2, state.data?.size)
        assertEquals(FETCHED_AT, state.fetchedAt)
        assertFalse(state.stale)
    }

    @Test
    fun resourceSuccessWithoutSubsIsEmpty() {
        val element = json.parseToJsonElement("""{ "active_subs": [] }""")
        val state =
            FSMSubFSMPanelProjection.projectFromResource(
                Resource.Success(data = element, fetchedAt = FETCHED_AT, stale = false),
            )
        assertEquals(UiPhase.Empty, state.phase)
        assertTrue(state.data?.isEmpty() == true)
    }

    @Test
    fun resourceErrorOverCachedKeepsContentAndFlagsStale() {
        val state =
            FSMSubFSMPanelProjection.projectFromResource(
                Resource.Error(cached = subsPayload(), fetchedAt = FETCHED_AT, stale = true, error = RuntimeException("net")),
            )
        // "Last known": cached rows stay visible while stale + errorKind are flagged (offline), never blanked.
        assertEquals(UiPhase.Content, state.phase)
        assertEquals(2, state.data?.size)
        assertTrue(state.stale)
        assertTrue(state.hasError)
    }

    // ── Tolerant ISO-8601 → epoch-millis parse ────────────────────────────────────────────────────────

    @Test
    fun parsesRfc3339AndOffsetAndZoneless() {
        val expected = Instant.parse("2026-06-11T12:00:00Z").toEpochMilli()
        assertEquals(expected, FSMSubFSMPanelProjection.parseIsoMillis("2026-06-11T12:00:00Z"))
        assertEquals(expected, FSMSubFSMPanelProjection.parseIsoMillis("2026-06-11T14:00:00+02:00"))
        assertEquals(expected, FSMSubFSMPanelProjection.parseIsoMillis("2026-06-11T12:00:00"))
    }

    @Test
    fun blankOrUnparseableStartTimeYieldsNull() {
        assertNull(FSMSubFSMPanelProjection.parseIsoMillis(null))
        assertNull(FSMSubFSMPanelProjection.parseIsoMillis(""))
        assertNull(FSMSubFSMPanelProjection.parseIsoMillis("   "))
        assertNull(FSMSubFSMPanelProjection.parseIsoMillis("not-a-timestamp"))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordFsmSubFsmPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "FSMSubFSMPanel"), opened.single().second)
        assertEquals("FSMSubFSMPanel", FSM_SUB_FSM_PANEL_SLUG)
    }

    private fun subsPayload(): JsonElement =
        json.parseToJsonElement(
            """
            {
              "active_subs": [
                { "type": "drive", "state": "active", "start_time": "2026-06-11T11:30:00Z" },
                { "type": "charge", "state": "done", "start_time": "2026-06-11T11:55:00Z" }
              ]
            }
            """.trimIndent(),
        )

    private companion object {
        const val FETCHED_AT = 1_750_000_000_000L
    }
}
