package io.teslasync.android.sharedsurfaces.teslareauthbanner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the TeslaReauthBanner shared surface across both states the
 * web component renders (web/src/components/feedback/TeslaReauthBanner.tsx): the visible warning banner with its
 * web-verbatim title/body, the labelled-and-clickable Reconnect CTA and X dismiss, and the dormant state where the
 * web returns null. It asserts the rendered i18n copy, that the interactive controls are labelled clickable elements
 * (a11y), and that they invoke their callbacks. Reduced motion keeps the entry animation from holding the test clock
 * busy. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + view-model,
 * this covers the render.
 */
class TeslaReauthBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun strings(): TeslaReauthBannerStrings =
        TeslaReauthBannerStrings(
            title = s(R.string.translation_tesla_reauth_title),
            body = s(R.string.translation_tesla_reauth_body),
            cta = s(R.string.translation_tesla_reauth_cta),
            dismiss = s(R.string.translation_common_dismiss),
        )

    private fun setSurface(
        render: TeslaReauthRender,
        onReconnect: () -> Unit = {},
        onDismiss: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    TeslaReauthBannerContent(
                        render = render,
                        strings = strings(),
                        onReconnect = onReconnect,
                        onDismiss = onDismiss,
                    )
                }
            }
        }
    }

    @Test
    fun visibleShowsTitleBodyReconnectAndDismiss() {
        setSurface(TeslaReauthRender.Visible)

        compose.onNodeWithTag(TESLA_REAUTH_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_tesla_reauth_title)).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_tesla_reauth_body)).assertIsDisplayed()
        // The Reconnect CTA is a labelled, clickable element (a11y).
        compose.onNodeWithText(s(R.string.translation_tesla_reauth_cta)).assertIsDisplayed().assertHasClickAction()
        // The X dismiss exposes its accessibility label and is clickable (a11y).
        compose.onNodeWithContentDescription(s(R.string.translation_common_dismiss)).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun reconnectAndDismissInvokeTheirCallbacks() {
        var reconnects = 0
        var dismisses = 0
        setSurface(TeslaReauthRender.Visible, onReconnect = { reconnects += 1 }, onDismiss = { dismisses += 1 })

        compose.onNodeWithText(s(R.string.translation_tesla_reauth_cta)).performClick()
        compose.onNodeWithContentDescription(s(R.string.translation_common_dismiss)).performClick()

        assertTrue("Reconnect invokes its callback (web navigate('/tesla-account'))", reconnects == 1)
        assertTrue("Dismiss invokes its callback (web setVisible(false))", dismisses == 1)
    }

    @Test
    fun dormantRendersNothing() {
        setSurface(TeslaReauthRender.Hidden)

        compose.onNodeWithTag(TESLA_REAUTH_BANNER_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText(s(R.string.translation_tesla_reauth_title)).assertDoesNotExist()
    }
}
