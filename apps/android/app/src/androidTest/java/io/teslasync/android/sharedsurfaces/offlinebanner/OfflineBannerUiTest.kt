package io.teslasync.android.sharedsurfaces.offlinebanner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
 * On-device Compose UI + accessibility verification of the OfflineBanner shared surface across every state the web
 * component renders (web/src/components/feedback/OfflineBanner.tsx): the offline banner with its web-verbatim
 * title/body + reconnect affordance, the reconnecting nuance, and the dormant online / cold-start states where
 * the web returns null. It asserts the rendered i18n copy and that the reconnect control is a labelled, clickable
 * element. Reduced motion keeps the entry animation from holding the test clock busy. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class OfflineBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun strings(): OfflineBannerStrings =
        OfflineBannerStrings(
            offlineTitle = s(R.string.translation_pwa_offline_title),
            reconnectingTitle = s(R.string.translation_live_reconnecting),
            body = s(R.string.translation_pwa_offline_banner),
            reconnect = s(R.string.translation_error_network_retryWhenOnline),
        )

    private fun render(status: LiveConnectionStatus): OfflineBannerRender = OfflineBannerProjection.render(OfflineBannerSnapshot(status))

    private fun setSurface(render: OfflineBannerRender) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    OfflineBannerContent(render = render, strings = strings())
                }
            }
        }
    }

    @Test
    fun offlineShowsBannerTitleBodyAndReconnectAffordance() {
        setSurface(render(LiveConnectionStatus.Disconnected))

        compose.onNodeWithTag(OFFLINE_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_pwa_offline_title)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_pwa_offline_banner)).assertIsDisplayed()
        // The reconnect control is a labelled, clickable element (a11y).
        compose.onNodeWithText(s(R.string.translation_error_network_retryWhenOnline)).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun reconnectingShowsBannerWithReconnectingTitleAndCachedDataBody() {
        setSurface(render(LiveConnectionStatus.Reconnecting))

        compose.onNodeWithTag(OFFLINE_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_live_reconnecting)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_pwa_offline_banner)).assertIsDisplayed()
    }

    @Test
    fun onlineRendersNothing() {
        setSurface(render(LiveConnectionStatus.Connected))

        compose.onNodeWithTag(OFFLINE_BANNER_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText(s(R.string.translation_pwa_offline_title)).assertDoesNotExist()
    }

    @Test
    fun coldStartRendersNothing() {
        setSurface(render(LiveConnectionStatus.Unknown))

        compose.onNodeWithTag(OFFLINE_BANNER_TEST_TAG).assertDoesNotExist()
    }
}
