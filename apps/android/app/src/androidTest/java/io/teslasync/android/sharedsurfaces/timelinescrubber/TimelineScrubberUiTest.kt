package io.teslasync.android.sharedsurfaces.timelinescrubber

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TimelineScrubberContent] across the surface's real
 * states: the populated timeline (accessible slider name + per-marker button labels), the marker seek, the
 * track tap seek, and the empty timeline (a usable bare track, never a blank box). Asserts the rendered i18n
 * strings (the real catalog resolves `replay.controls.progress` + the `replay.markers.*` labels), the marker's
 * focusable "<name> at <pct>%" label, and that tap / marker gestures invoke `onSeek`. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/components/data-display/TimelineScrubber.tsx).
 */
class TimelineScrubberUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val progressLabel = "Playback progress"

    private val markers =
        listOf(
            TimelineMarker(at = 0.0, kind = TimelineMarkerKind.Start),
            TimelineMarker(at = 0.40, kind = TimelineMarkerKind.FastSegment, count = 3),
            TimelineMarker(at = 0.74, kind = TimelineMarkerKind.LowSoc),
        )

    private fun setContent(
        progress: Float = 0.4f,
        durationSeconds: Double = 1_830.0,
        markers: List<TimelineMarker> = emptyList(),
        onSeek: (Float) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TimelineScrubberContent(
                    progress = progress,
                    durationSeconds = durationSeconds,
                    onSeek = onSeek,
                    progressLabel = progressLabel,
                    markers = markers,
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                )
            }
        }
    }

    @Test
    fun contentExposesTheAccessibleSliderNameAndMarkerButtonLabels() {
        setContent(markers = markers)
        compose.onNodeWithContentDescription(progressLabel).assertIsDisplayed()
        // The real catalog resolves the kind label + the `at %1$s%%` phrase → "Fast segment at 40%".
        compose.onNodeWithContentDescription("Fast segment at 40%", useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription("Low battery at 74%", useUnmergedTree = true).assertExists()
    }

    @Test
    fun tappingAMarkerSeeksToItsPosition() {
        var seeked: Float? = null
        setContent(markers = markers, onSeek = { seeked = it })
        compose.onNodeWithContentDescription("Fast segment at 40%", useUnmergedTree = true).performClick()
        assertEquals(0.40f, seeked!!, 0.0001f)
    }

    @Test
    fun tappingTheTrackEmitsASeek() {
        var seeked: Float? = null
        setContent(onSeek = { seeked = it })
        compose.onNodeWithContentDescription(progressLabel).performClick()
        assertTrue(seeked != null && seeked!! in 0f..1f)
    }

    @Test
    fun emptyTimelineStillRendersAUsableTrack() {
        // No markers + unknown duration: the bare track renders (never a blank box), with its accessible name.
        setContent(progress = 0f, durationSeconds = 0.0, markers = emptyList())
        compose.onNodeWithContentDescription(progressLabel).assertIsDisplayed()
    }
}
