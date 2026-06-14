package io.teslasync.android.widgetprimitives.widgetmapview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WidgetMapView frame across every branch the web
 * component renders (web/src/features/dashboard/widgets/shared/WidgetMapView.tsx): the empty state (web
 * `isEmpty`) and the map frame. Asserts the EmptyState message is shown and announced to TalkBack, the localized
 * default copy is used when no message is supplied, the map frame carries its surface tag in the populated state,
 * and the one-shot PII-safe `view.opened` diagnostic fires once with only the surface slug. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model + diagnostics logic off-device.
 */
class WidgetMapViewUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Empty state: the shared EmptyState message renders and is announced (web `isEmpty` branch) ─────────

    @Test
    fun emptyStateRendersTheMessageAndIsAnnounced() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetMapViewContent(center = CENTER, isEmpty = true, emptyMessage = EMPTY_MESSAGE)
                }
            }
        }
        compose.onNodeWithText(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithContentDescription(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_MAP_VIEW_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyStateFallsBackToTheLocalizedDefault() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetMapViewContent(center = CENTER, isEmpty = true)
                }
            }
        }
        compose.onNodeWithText(DEFAULT_EMPTY_MESSAGE).assertIsDisplayed()
    }

    // ── Map frame: the populated state stamps the surface tag (web `else` branch) ──────────────────────────

    @Test
    fun mapFrameRendersWithItsSurfaceTagWhenNotEmpty() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetMapViewContent(center = CENTER)
                }
            }
        }
        compose.onNodeWithTag(WIDGET_MAP_VIEW_TEST_TAG).assertExists()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug (fires before the render branch) ──────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetMapView(center = CENTER, isEmpty = true, logger = logger)
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "WidgetMapView"), opened.single().fields)
        assertTrue("no coordinate may leak", logger.records.none { it.fields.containsValue("37.7749") })
    }

    @Composable
    private fun Frame(content: @Composable () -> Unit) {
        Box(
            modifier =
                Modifier
                    .width(300.dp)
                    .height(200.dp),
            content = { content() },
        )
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
        private const val EMPTY_MESSAGE = "No saved location for this drive"
        private const val DEFAULT_EMPTY_MESSAGE = "No location data available"
        private val CENTER = GeoPoint(lat = 37.7749, lng = -122.4194)
    }
}
