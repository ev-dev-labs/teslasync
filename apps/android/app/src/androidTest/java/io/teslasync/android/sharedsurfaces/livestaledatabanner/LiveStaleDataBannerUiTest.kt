package io.teslasync.android.sharedsurfaces.livestaledatabanner

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the LiveStaleDataBanner shared surface across both states
 * the web component renders (web/src/components/feedback/LiveStaleDataBanner.tsx): the amber "Live data
 * unavailable" warning shown once the live wire has been disconnected past two minutes, and the hidden state that
 * renders nothing (web `if (!show) return null`). It asserts the rendered i18n title + body and that the banner
 * exposes the title + body as a single TalkBack content description (a polite live region). Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class LiveStaleDataBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun setContent(render: StaleBannerRender) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LiveStaleDataBannerContent(render = render)
            }
        }
    }

    private fun title() = context.getString(R.string.translation_live_staleBanner_title)

    private fun message() = context.getString(R.string.translation_live_staleBanner_message)

    @Test
    fun visibleBannerShowsTitleMessageAndIsLabelled() {
        setContent(StaleBannerRender(visible = true))

        compose.onNodeWithTag(LIVE_STALE_DATA_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(title(), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(message(), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(title() + ". " + message()).assertIsDisplayed()
    }

    @Test
    fun hiddenStateRendersNothing() {
        setContent(StaleBannerRender(visible = false))

        compose.onNodeWithTag(LIVE_STALE_DATA_BANNER_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText(title(), useUnmergedTree = true).assertDoesNotExist()
    }
}
