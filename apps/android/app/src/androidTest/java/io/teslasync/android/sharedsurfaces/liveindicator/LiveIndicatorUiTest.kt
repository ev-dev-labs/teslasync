package io.teslasync.android.sharedsurfaces.liveindicator

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the LiveIndicator shared surface across every state the
 * web component renders (web/src/components/data-display/LiveIndicator.tsx): the connected pill ("Live · 3m
 * ago"), the connected-but-stale chip (aged stamp), the reconnecting chip ("Reconnecting…"), the disconnected
 * chip ("Offline"), the cold-start unknown chip ("Unknown"), and the bare dot (no text). It asserts the
 * rendered i18n label + freshness string and that the chip exposes its wire health as a single TalkBack
 * content description (web `role="status"` / `aria-label`). Every render is built with reduced motion so the
 * infinite reconnecting spin never keeps the test clock busy. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class LiveIndicatorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val base = 1_700_000_000_000L
    private val now = base + 3 * 60_000L

    private fun render(
        status: LiveConnectionStatus,
        variant: LiveIndicatorVariant = LiveIndicatorVariant.Pill,
        nowMs: Long = now,
        lastMessageAtMillis: Long? = base,
        stale: Boolean = false,
    ): LiveRender =
        LiveIndicatorProjection.render(
            snapshot = LiveConnectionSnapshot(status, lastMessageAtMillis, stale),
            variant = variant,
            nowMs = nowMs,
            reduceMotion = true,
        )

    private fun setChip(render: LiveRender) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    LiveIndicatorChip(render = render)
                }
            }
        }
    }

    private fun label(resId: Int) = context.getString(resId)

    @Test
    fun connectedPillShowsLabelFreshnessAndIsLabelled() {
        setChip(render(LiveConnectionStatus.Connected))

        compose.onNodeWithText(label(R.string.translation_live_connected), useUnmergedTree = true).assertIsDisplayed()
        val stamp = "\u00b7 " + context.getString(R.string.translation_freshness_minutes, 3)
        compose.onNodeWithText(stamp, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_live_connected)).assertIsDisplayed()
    }

    @Test
    fun reconnectingChipShowsLabelAndIsLabelled() {
        setChip(render(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))

        compose.onNodeWithText(label(R.string.translation_live_reconnecting), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_live_reconnecting)).assertIsDisplayed()
    }

    @Test
    fun disconnectedChipShowsOfflineAndIsLabelled() {
        setChip(render(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null))

        compose.onNodeWithText(label(R.string.translation_live_disconnected), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_live_disconnected)).assertIsDisplayed()
    }

    @Test
    fun unknownChipShowsUnknownAndIsLabelled() {
        setChip(render(LiveConnectionStatus.Unknown, lastMessageAtMillis = null))

        compose.onNodeWithText(label(R.string.translation_live_unknown), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_live_unknown)).assertIsDisplayed()
    }

    @Test
    fun connectedStaleChipStillShowsAnAgedStamp() {
        setChip(render(LiveConnectionStatus.Connected, nowMs = base + 5 * 60_000L, stale = true))

        val stamp = "\u00b7 " + context.getString(R.string.translation_freshness_minutes, 5)
        compose.onNodeWithText(stamp, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_live_connected)).assertIsDisplayed()
    }

    @Test
    fun dotVariantRendersANonBlankLabelledSurfaceWithNoText() {
        setChip(render(LiveConnectionStatus.Connected, variant = LiveIndicatorVariant.Dot))

        compose.onNodeWithTag(LIVE_INDICATOR_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(label(R.string.translation_live_connected)).assertIsDisplayed()
        compose.onNodeWithText(label(R.string.translation_live_connected), useUnmergedTree = true).assertDoesNotExist()
    }
}
