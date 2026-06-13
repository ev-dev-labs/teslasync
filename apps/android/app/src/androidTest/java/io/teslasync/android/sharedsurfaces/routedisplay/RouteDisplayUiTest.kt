package io.teslasync.android.sharedsurfaces.routedisplay

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [RouteDisplay] view — the parity port of the web `RouteDisplay`
 * (web/src/components/data-display/RouteDisplay.tsx). Covers what the offline model test cannot: each web
 * branch renders a single accessibility node speaking the visible route line (the decorative map-pin glyph
 * is not announced), the `route.noLocationData` / `route.roundTrip` keys resolve through the P1/S10 catalog,
 * and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline `:android:testReleaseUnitTest`
 * gate covers the pure projection + the diagnostics emitter.
 */
class RouteDisplayUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: a point-to-point route speaks the "{start} → {end}" line ───────────────────────────────────

    @Test
    fun aPointToPointRouteRendersTheFromToLine() {
        mount(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Office"))

        compose.onNodeWithContentDescription(POINT_TO_POINT).assertExists()
    }

    // ── State: matched endpoints speak the localized "↻ round trip" line ──────────────────────────────────

    @Test
    fun aMatchedRouteRendersTheRoundTripLine() {
        mount(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Home"))

        compose.onNodeWithContentDescription(ROUND_TRIP).assertExists()
    }

    // ── State: an explicit single location speaks just the start (no "round trip", no arrow) ──────────────

    @Test
    fun aSingleLocationRendersJustTheStart() {
        mount(start = RouteEndpoint(address = "Supercharger Costco"), end = null)

        compose.onNodeWithContentDescription(SINGLE_LOCATION).assertExists()
        compose.onAllNodesWithContentDescription(ROUND_TRIP).assertCountEquals(0)
    }

    // ── State: a label-less pair speaks the localized "No location data" line ─────────────────────────────

    @Test
    fun anEmptyPairRendersTheLocalizedNoLocationLine() {
        mount(start = RouteEndpoint(), end = RouteEndpoint())

        compose.onNodeWithContentDescription(NO_LOCATION).assertExists()
    }

    // ── Accessibility: the whole line is one node (decorative glyph + visible text are not double-announced) ─

    @Test
    fun theRouteLineCollapsesIntoExactlyOneAccessibleNode() {
        mount(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Office"))

        compose.onAllNodesWithContentDescription(POINT_TO_POINT).assertCountEquals(1)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RouteDisplay(
                    start = RouteEndpoint(address = "Home"),
                    end = RouteEndpoint(address = "Office"),
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "RouteDisplay"), fields)
    }

    private fun mount(
        start: RouteEndpoint,
        end: RouteEndpoint?,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RouteDisplay(start = start, end = end, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        // The en catalog renderings (instrumentation default locale) the surface speaks for each branch.
        const val POINT_TO_POINT = "Home \u2192 Office"
        const val ROUND_TRIP = "Home \u21bb round trip"
        const val SINGLE_LOCATION = "Supercharger Costco"
        const val NO_LOCATION = "No location data"
    }
}
