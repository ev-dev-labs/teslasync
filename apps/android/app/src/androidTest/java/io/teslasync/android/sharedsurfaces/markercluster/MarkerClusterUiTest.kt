package io.teslasync.android.sharedsurfaces.markercluster

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [MarkerCluster] view — the parity port of the web `MarkerCluster`
 * (web/src/components/maps/MarkerCluster.tsx). Covers the chrome the offline model test cannot, without a live
 * Google base map: the empty state speaks the localized "no location" line through the P1/S10 catalog, the
 * accessible-summary list (the screen-reader alternative for the opaque map) speaks one line per marker, and
 * the one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on mount. The populated base map itself is a
 * Google Maps surface exercised by the maps-layer instrumentation; the offline `:android:testReleaseUnitTest`
 * gate covers the pure projection, the summary digest, and the diagnostics emitter.
 */
class MarkerClusterUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: no finite points speaks the localized empty line (never a blank box) ───────────────────────

    @Test
    fun anEmptyPointSetRendersTheLocalizedEmptyState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MarkerCluster(points = emptyList(), logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(EMPTY_MESSAGE).assertExists()
    }

    // ── Accessibility: the summary list speaks one line per marker (ariaLabel or coordinate) ──────────────

    @Test
    fun theAccessibleSummaryListsEachMarkerLine() {
        val projection =
            projectMarkerCluster(
                listOf(
                    ClusterPoint(id = "a", lat = 47.61, lng = -122.33, ariaLabel = "Alpha site"),
                    ClusterPoint(id = "b", lat = 47.62, lng = -122.35, ariaLabel = "Bravo site"),
                ),
            )
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MarkerClusterSummary(projection = projection, label = MAP_LABEL, emptyMessage = EMPTY_MESSAGE)
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Alpha site").assertExists()
        compose.onNodeWithText("Bravo site").assertExists()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires exactly once ────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MarkerCluster(points = emptyList(), logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "MarkerCluster"), fields)
    }

    @Test
    fun theEmptyStateIsASingleAccessibleNode() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MarkerCluster(points = emptyList(), logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onAllNodesWithContentDescription(EMPTY_MESSAGE).assertCountEquals(1)
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
        // The en catalog renderings (instrumentation default locale) the surface speaks.
        const val EMPTY_MESSAGE = "No location data available yet"
        const val MAP_LABEL = "Locations"
    }
}
