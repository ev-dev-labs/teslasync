package io.teslasync.android.sharedsurfaces.livetelemetrysegment

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the LiveTelemetrySegment shared surface across every
 * state the web component renders (web/src/components/layout/status-bar/LiveTelemetrySegment.tsx): the
 * connected segment ("Live · 12s"), the connected-but-stale segment (aged stamp), the reconnecting segment
 * ("Reconnecting"), the disconnected segment ("Offline"), the cold-start unknown segment ("Idle"), and the
 * dense `iconOnly` form (dot + icon, no text). It asserts the rendered i18n label + age stamp, that the
 * segment exposes its wire health as a single TalkBack content description (web `<Link aria-label>`), and that
 * the labelled `Role.Button` tap target fires the navigation callback (web `<Link to="/signal-diff">`). Every
 * render is built with reduced motion so the infinite reconnecting spin never keeps the test clock busy. Runs
 * under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the
 * render.
 */
class LiveTelemetrySegmentUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val base = 1_700_000_000_000L
    private val now = base + 12_000L

    private fun render(
        status: LiveConnectionStatus,
        iconOnly: Boolean = false,
        nowMs: Long = now,
        lastMessageAtMillis: Long? = base,
        stale: Boolean = false,
    ): LiveTelemetryRender =
        LiveTelemetrySegmentProjection.render(
            snapshot = LiveTelemetrySnapshot(status, lastMessageAtMillis, stale),
            iconOnly = iconOnly,
            nowMs = nowMs,
            reduceMotion = true,
        )

    private fun setSegment(
        render: LiveTelemetryRender,
        onActivate: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    LiveTelemetrySegmentContent(render = render, onActivate = onActivate)
                }
            }
        }
    }

    private fun label(resId: Int) = context.getString(resId)

    private fun aria(shortResId: Int) = context.getString(R.string.translation_statusBar_live_aria) + ": " + label(shortResId)

    @Test
    fun connectedSegmentShowsLabelAgeStampAndIsLabelled() {
        setSegment(render(LiveConnectionStatus.Connected))

        compose.onNodeWithText(label(R.string.translation_statusBar_live_short), useUnmergedTree = true).assertIsDisplayed()
        val stamp = "\u00b7 12s"
        compose.onNodeWithText(stamp, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(R.string.translation_statusBar_live_short)).assertIsDisplayed()
    }

    @Test
    fun reconnectingSegmentShowsLabelAndIsLabelled() {
        setSegment(render(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))

        compose.onNodeWithText(label(R.string.translation_statusBar_live_reconnecting), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(R.string.translation_statusBar_live_reconnecting)).assertIsDisplayed()
    }

    @Test
    fun disconnectedSegmentShowsOfflineAndIsLabelled() {
        setSegment(render(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null))

        compose.onNodeWithText(label(R.string.translation_statusBar_live_offline), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(R.string.translation_statusBar_live_offline)).assertIsDisplayed()
    }

    @Test
    fun unknownSegmentShowsIdleAndIsLabelled() {
        setSegment(render(LiveConnectionStatus.Unknown, lastMessageAtMillis = null))

        compose.onNodeWithText(label(R.string.translation_statusBar_live_unknown), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(R.string.translation_statusBar_live_unknown)).assertIsDisplayed()
    }

    @Test
    fun connectedStaleSegmentStillShowsAnAgedStamp() {
        setSegment(render(LiveConnectionStatus.Connected, nowMs = base + 3 * 60_000L, stale = true))

        val stamp = "\u00b7 3m"
        compose.onNodeWithText(stamp, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(R.string.translation_statusBar_live_short)).assertIsDisplayed()
    }

    @Test
    fun iconOnlyRendersANonBlankLabelledTargetWithNoText() {
        setSegment(render(LiveConnectionStatus.Connected, iconOnly = true))

        compose.onNodeWithTag(LIVE_TELEMETRY_SEGMENT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(aria(R.string.translation_statusBar_live_short)).assertIsDisplayed()
        compose.onNodeWithText(label(R.string.translation_statusBar_live_short), useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun tappingTheSegmentFiresTheNavigationCallback() {
        var activated = false
        setSegment(render(LiveConnectionStatus.Connected), onActivate = { activated = true })

        compose.onNodeWithTag(LIVE_TELEMETRY_SEGMENT_TEST_TAG).performClick()

        assertTrue("tapping the segment navigates (web <Link to=\"/signal-diff\">)", activated)
    }
}
