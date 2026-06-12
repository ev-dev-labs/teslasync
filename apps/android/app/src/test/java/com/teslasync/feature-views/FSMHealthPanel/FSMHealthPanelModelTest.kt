// Off-device unit coverage for the FSMHealthPanel feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the alert detector (the web `useMemo` flap-window / stuck-session
// / recovery logic incl. the first-group flap-count snapshot), the `computeFlapIds` export, the card
// projection (raw-count message interpolation + grouped count badge), the severity/glyph/title/message
// classifiers, the tolerant timestamp parser, the top-level lifecycle classifier the composable switches on
// (per-state coverage incl. stale/offline), and the i18n key + registration mirrors. No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmhealthpanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class FSMHealthPanelModelTest {
    private val now: Long = Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()

    private fun tx(
        id: Long,
        ts: String,
        fsmName: String = "vehicle",
        toState: String = "online",
        vehicleId: Long = 1,
    ) = FSMTransition(
        id = id,
        vehicleId = vehicleId,
        ts = ts,
        fsmName = fsmName,
        fromState = "prev",
        toState = toState,
        trigger = "telemetry",
    )

    /** Builds [count] same-FSM transitions 5 seconds apart starting at [startSecond] (all within one minute). */
    private fun burst(
        fsmName: String,
        count: Int,
        startId: Long,
        startSecond: Int = 0,
    ): List<FSMTransition> =
        (0 until count).map { i ->
            val second = startSecond + i * 5
            tx(id = startId + i, ts = "2026-06-12T11:50:%02dZ".format(second), fsmName = fsmName)
        }

    // ── flap detection (web flap-window double loop) ──

    @Test
    fun moreThanFiveSameFsmTransitionsInAMinuteFlag() {
        val alerts = FSMHealthProjection.computeAlerts(burst("vehicle", count = 6, startId = 0), now)
        val flap = alerts.single { it.type == FSMHealthAlertType.Flap }
        assertEquals(FSMHealthSeverity.Warning, flap.severity)
        assertEquals(6, flap.count)
    }

    @Test
    fun exactlyFiveTransitionsDoNotFlap() {
        // Web `count > 5` — five in the window is not enough.
        val alerts = FSMHealthProjection.computeAlerts(burst("vehicle", count = 5, startId = 0), now)
        assertTrue(alerts.none { it.type == FSMHealthAlertType.Flap })
    }

    @Test
    fun transitionsSpreadBeyondTheWindowDoNotFlap() {
        // Six transitions 30s apart span 150s — no single 60s window holds more than five.
        val spread =
            (0 until 6).map { i ->
                tx(id = i.toLong(), ts = "2026-06-12T11:5$i:00Z", fsmName = "vehicle")
            }
        assertTrue(FSMHealthProjection.computeAlerts(spread, now).none { it.type == FSMHealthAlertType.Flap })
    }

    @Test
    fun flapAlertCountIsTheFirstGroupSnapshotNotTheGrandTotal() {
        // Web captures `flapped.size` the first time the accumulating set is non-empty while iterating FSM
        // groups in first-seen order. Group A (first) contributes 6; group B contributes 7 → alert count 6,
        // computeFlapIds total 13.
        val groupA = burst("fsm_a", count = 6, startId = 0)
        val groupB = burst("fsm_b", count = 7, startId = 100)
        val alerts = FSMHealthProjection.computeAlerts(groupA + groupB, now)
        assertEquals(6, alerts.single { it.type == FSMHealthAlertType.Flap }.count)
        assertEquals(13, FSMHealthProjection.computeFlapIds(groupA + groupB).size)
    }

    @Test
    fun computeFlapIdsReturnsTheExactFlaggedIds() {
        val ids = FSMHealthProjection.computeFlapIds(burst("vehicle", count = 6, startId = 10))
        assertEquals(setOf(10L, 11L, 12L, 13L, 14L, 15L), ids)
    }

    @Test
    fun computeFlapIdsIsEmptyWhenNothingFlaps() {
        assertTrue(FSMHealthProjection.computeFlapIds(burst("vehicle", count = 5, startId = 0)).isEmpty())
    }

    // ── stuck detection ──

    @Test
    fun sessionStuckInActivePastFourHoursIsCounted() {
        val stuck =
            tx(id = 1, ts = "2026-06-12T06:00:00Z", fsmName = "drive_session", toState = "active", vehicleId = 7)
        val alerts = FSMHealthProjection.computeAlerts(listOf(stuck), now)
        val alert = alerts.single { it.type == FSMHealthAlertType.Stuck }
        assertEquals(FSMHealthSeverity.Warning, alert.severity)
        assertEquals(1, alert.count)
    }

    @Test
    fun recentSessionIsNotStuck() {
        val recent =
            tx(id = 1, ts = "2026-06-12T11:30:00Z", fsmName = "charge_session", toState = "pending", vehicleId = 7)
        assertTrue(FSMHealthProjection.computeAlerts(listOf(recent), now).none { it.type == FSMHealthAlertType.Stuck })
    }

    @Test
    fun onlyTheLatestStateOfAnInstanceDecidesStuck() {
        // An old "active" superseded by a later "completed" for the same instance is not stuck (web latest-wins).
        val old =
            tx(id = 1, ts = "2026-06-12T05:00:00Z", fsmName = "drive_session", toState = "active", vehicleId = 7)
        val newer =
            tx(id = 2, ts = "2026-06-12T05:30:00Z", fsmName = "drive_session", toState = "completed", vehicleId = 7)
        assertTrue(
            FSMHealthProjection.computeAlerts(listOf(old, newer), now).none { it.type == FSMHealthAlertType.Stuck },
        )
    }

    @Test
    fun nonSessionFsmsAreIgnoredByTheStuckDetector() {
        val vehicleStuck =
            tx(id = 1, ts = "2026-06-12T01:00:00Z", fsmName = "vehicle", toState = "active", vehicleId = 7)
        assertTrue(
            FSMHealthProjection.computeAlerts(listOf(vehicleStuck), now).none { it.type == FSMHealthAlertType.Stuck },
        )
    }

    @Test
    fun stuckCountsDistinctInstancesSeparately() {
        val v7 = tx(id = 1, ts = "2026-06-12T01:00:00Z", fsmName = "drive_session", toState = "active", vehicleId = 7)
        val v8 = tx(id = 2, ts = "2026-06-12T01:00:00Z", fsmName = "drive_session", toState = "pending", vehicleId = 8)
        assertEquals(2, FSMHealthProjection.computeAlerts(listOf(v7, v8), now).single { it.type == FSMHealthAlertType.Stuck }.count)
    }

    // ── recovery detection ──

    @Test
    fun recoveredTransitionsAreCounted() {
        val recovered =
            listOf(
                tx(id = 1, ts = "2026-06-12T09:00:00Z", fsmName = "drive_session", toState = "recovered"),
                tx(id = 2, ts = "2026-06-12T09:01:00Z", fsmName = "charge_session", toState = "recovered"),
            )
        val alert = FSMHealthProjection.computeAlerts(recovered, now).single { it.type == FSMHealthAlertType.Recovery }
        assertEquals(FSMHealthSeverity.Info, alert.severity)
        assertEquals(2, alert.count)
    }

    // ── ordering + empty ──

    @Test
    fun alertsAreOrderedFlapThenStuckThenRecovery() {
        val data =
            burst("vehicle", count = 6, startId = 0) +
                tx(id = 50, ts = "2026-06-12T06:00:00Z", fsmName = "drive_session", toState = "active", vehicleId = 7) +
                tx(id = 60, ts = "2026-06-12T09:00:00Z", fsmName = "charge_session", toState = "recovered")
        val types = FSMHealthProjection.computeAlerts(data, now).map { it.type }
        assertEquals(
            listOf(FSMHealthAlertType.Flap, FSMHealthAlertType.Stuck, FSMHealthAlertType.Recovery),
            types,
        )
    }

    @Test
    fun noTransitionsYieldsNoAlerts() {
        assertTrue(FSMHealthProjection.computeAlerts(emptyList(), now).isEmpty())
    }

    @Test
    fun healthyTransitionsYieldNoAlerts() {
        val healthy =
            listOf(
                tx(id = 1, ts = "2026-06-12T11:58:00Z", fsmName = "vehicle", toState = "online"),
                tx(id = 2, ts = "2026-06-12T11:59:00Z", fsmName = "vehicle", toState = "asleep"),
            )
        assertTrue(FSMHealthProjection.computeAlerts(healthy, now).isEmpty())
    }

    // ── classifiers ──

    @Test
    fun severityForMatchesTheWebMapping() {
        assertEquals(FSMHealthSeverity.Warning, FSMHealthProjection.severityFor(FSMHealthAlertType.Flap))
        assertEquals(FSMHealthSeverity.Warning, FSMHealthProjection.severityFor(FSMHealthAlertType.Stuck))
        assertEquals(FSMHealthSeverity.Info, FSMHealthProjection.severityFor(FSMHealthAlertType.Recovery))
    }

    @Test
    fun glyphForMatchesTheWebLucideIcons() {
        assertEquals(FSMHealthGlyph.AlertTriangle, FSMHealthProjection.glyphFor(FSMHealthAlertType.Flap))
        assertEquals(FSMHealthGlyph.Timer, FSMHealthProjection.glyphFor(FSMHealthAlertType.Stuck))
        assertEquals(FSMHealthGlyph.RotateCw, FSMHealthProjection.glyphFor(FSMHealthAlertType.Recovery))
    }

    // ── card projection (message interpolation + count badge) ──

    @Test
    fun cardsInterpolateRawCountAndFormatTheBadge() {
        val strings =
            FSMHealthStrings(
                title = "title",
                allClear = "allClear",
                flapTitle = "Flap",
                stuckTitle = "Stuck",
                recoveryTitle = "Recovery",
                flapMessage = "%1\$s flapped",
                stuckMessage = "%1\$s stuck",
                recoveryMessage = "%1\$s recovered",
            )
        val alerts =
            listOf(
                FSMHealthAlert(FSMHealthAlertType.Flap, FSMHealthSeverity.Warning, 1234),
                FSMHealthAlert(FSMHealthAlertType.Stuck, FSMHealthSeverity.Warning, 2),
                FSMHealthAlert(FSMHealthAlertType.Recovery, FSMHealthSeverity.Info, 3),
            )
        val cards = FSMHealthProjection.cards(alerts, strings) { "#$it" }
        assertEquals(listOf("Flap", "Stuck", "Recovery"), cards.map { it.title })
        // Message uses the raw count (web `{{count}}`, no grouping); badge uses the injected grouped formatter.
        assertEquals("1234 flapped", cards[0].message)
        assertEquals("#1234", cards[0].countText)
        assertEquals(FSMHealthGlyph.AlertTriangle, cards[0].glyph)
        assertEquals(FSMHealthGlyph.RotateCw, cards[2].glyph)
        assertEquals("2 stuck", cards[1].message)
    }

    // ── tolerant timestamp parsing (web `new Date(ts).getTime()`) ──

    @Test
    fun parseTsMillisIsTolerantAndGuardsInvalidInput() {
        assertEquals(Instant.parse("2026-06-12T11:50:00Z").toEpochMilli(), FSMHealthProjection.parseTsMillis("2026-06-12T11:50:00Z"))
        assertEquals(
            Instant.parse("2026-06-12T11:50:00Z").toEpochMilli(),
            FSMHealthProjection.parseTsMillis("2026-06-12T13:50:00+02:00"),
        )
        // A zoneless local date-time is tolerated (treated as UTC).
        assertEquals(
            Instant.parse("2026-06-12T11:50:00Z").toEpochMilli(),
            FSMHealthProjection.parseTsMillis("2026-06-12T11:50:00"),
        )
        // Blank / unparseable inputs fall back to epoch so comparisons stay total.
        assertEquals(0L, FSMHealthProjection.parseTsMillis(""))
        assertEquals(0L, FSMHealthProjection.parseTsMillis("   "))
        assertEquals(0L, FSMHealthProjection.parseTsMillis("not-a-date"))
    }

    // ── lifecycle classifier (per-state coverage) ──

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(FSMHealthSurface.Loading, fsmHealthSurfaceFor(isLoading = true, isError = false))
        assertEquals(FSMHealthSurface.Error, fsmHealthSurfaceFor(isLoading = false, isError = true))
        // Loading wins over error so a refresh-with-skeleton never flashes the error surface.
        assertEquals(FSMHealthSurface.Loading, fsmHealthSurfaceFor(isLoading = true, isError = true))
        assertEquals(FSMHealthSurface.Ready, fsmHealthSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(FSMHealthSurface.Loading, surfaceFor(UiState.loading<List<FSMTransition>>()))
        val error = UiState<List<FSMTransition>>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(FSMHealthSurface.Error, surfaceFor(error))
        assertEquals(FSMHealthSurface.Ready, surfaceFor(UiState(UiPhase.Content, data = listOf(tx(1, "2026-06-12T11:50:00Z")))))
        assertEquals(FSMHealthSurface.Ready, surfaceFor(UiState(UiPhase.Empty, data = emptyList<FSMTransition>())))
        // Stale/offline "last known" stays on the Ready surface (cached alerts + freshness chip), never blanked.
        val offline =
            UiState(
                UiPhase.Content,
                data = listOf(tx(1, "2026-06-12T11:50:00Z")),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(FSMHealthSurface.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── i18n key + registration mirrors ──

    @Test
    fun i18nKeyMirrorsFollowTheWebNamespace() {
        assertEquals("translation_fsm_health_title", KEY_TITLE)
        assertEquals("translation_fsm_health_allClear", KEY_ALL_CLEAR)
        assertEquals("translation_fsm_health_flapTitle", KEY_FLAP_TITLE)
        assertEquals("translation_fsm_health_stuckTitle", KEY_STUCK_TITLE)
        assertEquals("translation_fsm_health_recoveryTitle", KEY_RECOVERY_TITLE)
        assertEquals("translation_fsm_health_flapping", KEY_FLAPPING)
        assertEquals("translation_fsm_health_stuck", KEY_STUCK)
        assertEquals("translation_fsm_health_recoveries", KEY_RECOVERIES)
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("FSMHealthPanel", FSMHealthPanelRegistration.SLUG)
        assertEquals("fsm-health-panel", FSMHealthPanelRegistration.ID)
    }

    @Test
    fun parseTsMillisDistinguishesOrdering() {
        assertFalse(
            FSMHealthProjection.parseTsMillis("2026-06-12T11:50:00Z") >=
                FSMHealthProjection.parseTsMillis("2026-06-12T11:51:00Z"),
        )
    }

    private fun surfaceFor(state: UiState<*>): FSMHealthSurface = fsmHealthSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
