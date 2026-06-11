package io.teslasync.android.featureviews.windowstatusdetail

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage for the WindowStatusDetail feature view's pure model (P3 acceptance: adapter +
 * per-state + a11y/i18n-key tests). Exercises the `parseWindowState` value parser
 * (web security-access/helpers.ts), the state → accent classification (web `windowColor` / `windowTextClass`),
 * the fixed four-window projection (incl. decoding straight off the cached `/security/latest` JSON), the
 * responsive column count (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`), the top-level lifecycle classifier
 * the composable switches on (per-state coverage incl. stale/offline), and the i18n key mirrors. No Compose /
 * Android / HTTP — runs in :android:testReleaseUnitTest.
 */
class WindowStatusDetailModelTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun parse(value: JsonElement?): WindowState = WindowStatusDetailProjection.parseWindowState(value)

    private fun str(value: String): JsonElement = JsonPrimitive(value)

    // ── parseWindowState — a 1:1 port of the web helper ──

    @Test
    fun parseWindowStateTreatsAbsentNullAndNonStringsAsUnknown() {
        // Web `asNonEmptyString`: only a non-empty JSON string carries a state.
        assertEquals(WindowState.Unknown, parse(null))
        assertEquals(WindowState.Unknown, parse(JsonNull))
        assertEquals(WindowState.Unknown, parse(str("")))
        // A JSON boolean / number is not a string, so it reads as Unknown (web `typeof v === 'string'`).
        assertEquals(WindowState.Unknown, parse(JsonPrimitive(true)))
        assertEquals(WindowState.Unknown, parse(JsonPrimitive(false)))
        assertEquals(WindowState.Unknown, parse(JsonPrimitive(1)))
    }

    @Test
    fun parseWindowStateMapsClosedAndZeroToClosed() {
        assertEquals(WindowState.Closed, parse(str("closed")))
        assertEquals(WindowState.Closed, parse(str("Closed")))
        assertEquals(WindowState.Closed, parse(str("CLOSED")))
        assertEquals(WindowState.Closed, parse(str("0")))
    }

    @Test
    fun parseWindowStateMapsAnythingContainingVentToVenting() {
        assertEquals(WindowState.Venting, parse(str("vent")))
        assertEquals(WindowState.Venting, parse(str("Venting")))
        assertEquals(WindowState.Venting, parse(str("WindowStateVented")))
        // Web checks `vent` BEFORE `open`, so a value carrying both folds to Venting.
        assertEquals(WindowState.Venting, parse(str("venting/open")))
    }

    @Test
    fun parseWindowStateMapsEveryOtherNonEmptyStringToOpen() {
        // Web's final `lower.includes('open') || lower !== '0'` is always true here, so it collapses to Open.
        assertEquals(WindowState.Open, parse(str("open")))
        assertEquals(WindowState.Open, parse(str("Opened")))
        assertEquals(WindowState.Open, parse(str("WindowStateOpen")))
        assertEquals(WindowState.Open, parse(str("partial")))
        assertEquals(WindowState.Open, parse(str("anything")))
    }

    // ── accentFor — web windowColor / windowTextClass ──

    @Test
    fun accentForMapsEachStateToItsSemanticRole() {
        assertEquals(WindowAccentRole.Success, WindowStatusDetailProjection.accentFor(WindowState.Closed))
        assertEquals(WindowAccentRole.Warning, WindowStatusDetailProjection.accentFor(WindowState.Venting))
        assertEquals(WindowAccentRole.Danger, WindowStatusDetailProjection.accentFor(WindowState.Open))
        assertEquals(WindowAccentRole.Muted, WindowStatusDetailProjection.accentFor(WindowState.Unknown))
    }

    // ── project — the adapter (cached payload → four render-ready cards) ──

    @Test
    fun projectNullPayloadYieldsFourUnknownCardsInWindowKeyOrder() {
        // Web `latest === undefined` → four "Unknown" cards (never a blank box).
        val display = WindowStatusDetailProjection.project(null)
        assertEquals(4, display.panels.size)
        assertEquals(
            listOf(WindowPosition.Fd, WindowPosition.Fp, WindowPosition.Rd, WindowPosition.Rp),
            display.panels.map { it.position },
        )
        assertTrue(display.panels.all { it.state == WindowState.Unknown })
        assertTrue(display.panels.all { it.accent == WindowAccentRole.Muted })
    }

    @Test
    fun projectMapsEachWindowToItsParsedStateAndAccent() {
        val windows =
            SecurityWindows(
                fdWindow = str("closed"),
                fpWindow = str("open"),
                rdWindow = str("vent"),
                rpWindow = null,
            )
        val display = WindowStatusDetailProjection.project(windows)
        assertEquals(
            listOf(WindowState.Closed, WindowState.Open, WindowState.Venting, WindowState.Unknown),
            display.panels.map { it.state },
        )
        assertEquals(
            listOf(
                WindowAccentRole.Success,
                WindowAccentRole.Danger,
                WindowAccentRole.Warning,
                WindowAccentRole.Muted,
            ),
            display.panels.map { it.accent },
        )
    }

    @Test
    fun projectsStraightOffTheCachedApiJsonIgnoringUnknownColumns() {
        // The data-adapter path: the owning page caches the raw `/security/latest` response, whose columns
        // (locked, sentry_mode, door_state, …) far exceed the four windows this surface reads. Decoding +
        // projecting must yield the four parsed cards regardless. fd is a string, fp is a boolean (→ Unknown),
        // rd is JSON null (→ Unknown), rp is absent (→ Unknown).
        val json =
            """
            {
              "id": "evt-1",
              "locked": true,
              "sentry_mode": "Off",
              "door_state": "Closed",
              "fd_window": "Closed",
              "fp_window": false,
              "rd_window": null,
              "homelink_nearby": true,
              "created_at": "2026-06-11T14:30:00Z"
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<SecurityWindows>(json)

        val display = WindowStatusDetailProjection.project(decoded)

        assertEquals(WindowState.Closed, display.panels[0].state)
        assertEquals(WindowState.Unknown, display.panels[1].state)
        assertEquals(WindowState.Unknown, display.panels[2].state)
        assertEquals(WindowState.Unknown, display.panels[3].state)
    }

    @Test
    fun projectDecodesRealWindowEnumStringsLikeTheWebParser() {
        // The signal pipeline emits string enum values; the projection classifies them exactly as the web does.
        val json =
            """
            { "fd_window": "Opened", "fp_window": "Closed", "rd_window": "Vented", "rp_window": "Open" }
            """.trimIndent()
        val display = WindowStatusDetailProjection.project(lenientJson.decodeFromString<SecurityWindows>(json))
        assertEquals(
            listOf(WindowState.Open, WindowState.Closed, WindowState.Venting, WindowState.Open),
            display.panels.map { it.state },
        )
    }

    // ── columnsFor — the responsive web grid ──

    @Test
    fun columnsForMatchesTheTailwindBreakpoints() {
        // grid-cols-1 below sm (640), sm:grid-cols-2 from 640, lg:grid-cols-4 from 1024.
        assertEquals(1, WindowStatusDetailProjection.columnsFor(0))
        assertEquals(1, WindowStatusDetailProjection.columnsFor(360))
        assertEquals(1, WindowStatusDetailProjection.columnsFor(639))
        assertEquals(2, WindowStatusDetailProjection.columnsFor(640))
        assertEquals(2, WindowStatusDetailProjection.columnsFor(1023))
        assertEquals(4, WindowStatusDetailProjection.columnsFor(1024))
        assertEquals(4, WindowStatusDetailProjection.columnsFor(1600))
    }

    // ── per-state lifecycle classifier ──

    @Test
    fun surfaceForPrioritisesLoadingThenErrorThenEmptyThenReady() {
        assertEquals(WindowStatusSurface.Loading, windowStatusSurfaceFor(isLoading = true, isError = false, isEmpty = false))
        assertEquals(WindowStatusSurface.Error, windowStatusSurfaceFor(isLoading = false, isError = true, isEmpty = false))
        assertEquals(WindowStatusSurface.Empty, windowStatusSurfaceFor(isLoading = false, isError = false, isEmpty = true))
        assertEquals(WindowStatusSurface.Ready, windowStatusSurfaceFor(isLoading = false, isError = false, isEmpty = false))
        // Loading wins over error (refresh-with-skeleton never flashes error) and over empty (first load).
        assertEquals(WindowStatusSurface.Loading, windowStatusSurfaceFor(isLoading = true, isError = true, isEmpty = true))
        assertEquals(WindowStatusSurface.Error, windowStatusSurfaceFor(isLoading = false, isError = true, isEmpty = true))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(WindowStatusSurface.Loading, surfaceFor(UiState.loading<SecurityWindows>()))
        val error = UiState<SecurityWindows>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(WindowStatusSurface.Error, surfaceFor(error))
        assertEquals(WindowStatusSurface.Empty, surfaceFor(UiState(UiPhase.Empty, data = SecurityWindows())))
        assertEquals(WindowStatusSurface.Ready, surfaceFor(UiState(UiPhase.Content, data = SecurityWindows())))
        // Stale/offline "last known" stays on the Ready surface (cached cards + freshness chip), never blanked.
        val offline =
            UiState(
                UiPhase.Content,
                data = SecurityWindows(fdWindow = str("closed")),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(WindowStatusSurface.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── i18n key mirrors (every web `t('admin.security.*')` key this surface reads) ──

    @Test
    fun i18nKeyMirrorsFollowTheWebNamespace() {
        assertEquals("translation_admin_security_windowDetail", KEY_TITLE)
        assertEquals("translation_admin_security_window_fd", KEY_WINDOW_FD)
        assertEquals("translation_admin_security_window_fp", KEY_WINDOW_FP)
        assertEquals("translation_admin_security_window_rd", KEY_WINDOW_RD)
        assertEquals("translation_admin_security_window_rp", KEY_WINDOW_RP)
        assertEquals("translation_admin_security_windowState_closed", KEY_STATE_CLOSED)
        assertEquals("translation_admin_security_windowState_venting", KEY_STATE_VENTING)
        assertEquals("translation_admin_security_windowState_open", KEY_STATE_OPEN)
        assertEquals("translation_admin_security_windowState_unknown", KEY_STATE_UNKNOWN)
    }

    @Test
    fun enumsCarryTheirOwnI18nKeys() {
        assertEquals(KEY_WINDOW_FD, WindowPosition.Fd.labelKey)
        assertEquals(KEY_WINDOW_FP, WindowPosition.Fp.labelKey)
        assertEquals(KEY_WINDOW_RD, WindowPosition.Rd.labelKey)
        assertEquals(KEY_WINDOW_RP, WindowPosition.Rp.labelKey)
        assertEquals(KEY_STATE_CLOSED, WindowState.Closed.valueKey)
        assertEquals(KEY_STATE_VENTING, WindowState.Venting.valueKey)
        assertEquals(KEY_STATE_OPEN, WindowState.Open.valueKey)
        assertEquals(KEY_STATE_UNKNOWN, WindowState.Unknown.valueKey)
    }

    @Test
    fun stringsResolveLabelsAndValuesByPositionAndState() {
        val strings =
            WindowStatusStrings(
                title = "title",
                frontDriver = "FD",
                frontPassenger = "FP",
                rearDriver = "RD",
                rearPassenger = "RP",
                closed = "C",
                venting = "V",
                open = "O",
                unknown = "U",
            )
        assertEquals("FD", strings.labelFor(WindowPosition.Fd))
        assertEquals("FP", strings.labelFor(WindowPosition.Fp))
        assertEquals("RD", strings.labelFor(WindowPosition.Rd))
        assertEquals("RP", strings.labelFor(WindowPosition.Rp))
        assertEquals("C", strings.valueFor(WindowState.Closed))
        assertEquals("V", strings.valueFor(WindowState.Venting))
        assertEquals("O", strings.valueFor(WindowState.Open))
        assertEquals("U", strings.valueFor(WindowState.Unknown))
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("WindowStatusDetail", WindowStatusDetailRegistration.SLUG)
        assertEquals("window-status-detail", WindowStatusDetailRegistration.ID)
        assertFalse(WindowStatusDetailRegistration.SLUG.any(Char::isWhitespace))
    }

    /** Bridges a [UiState] to the composable's classifier the same way `WindowStatusDetailContent` does. */
    private fun surfaceFor(state: UiState<*>): WindowStatusSurface =
        windowStatusSurfaceFor(isLoading = state.isLoading, isError = state.isError, isEmpty = state.isEmpty)
}
