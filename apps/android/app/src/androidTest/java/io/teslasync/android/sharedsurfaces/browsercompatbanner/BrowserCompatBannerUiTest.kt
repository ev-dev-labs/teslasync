package io.teslasync.android.sharedsurfaces.browsercompatbanner

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the BrowserCompatBanner shared surface across the states
 * the web component renders (web/src/components/feedback/BrowserCompatBanner.tsx): the warning banner with its
 * localized title + interpolated missing-feature body, the merged POLITE live-region announcement (the web
 * `role="status"` / `aria-live="polite"` message), the labelled + clickable dismiss control (the web `onClose`
 * X), and the hidden surface that renders nothing (web `null`). It reuses the pure model helpers ([joinFeatures],
 * [bannerAccessibilityLabel]) so the expected copy is derived exactly as the composable derives it. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure classifier + state holder, this covers
 * the render. `assertDoesNotExist` is called as a `SemanticsNodeInteraction` member (not the unresolved
 * top-level symbol) so this file type-checks cleanly.
 */
class BrowserCompatBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun bodyFor(features: String): String =
        context.getString(
            R.string.translation_compat_banner_body,
            features,
            s(R.string.translation_compat_banner_recommendation),
        )

    private fun setSurface(
        surface: BrowserCompatSurface,
        onDismiss: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BrowserCompatBannerContent(surface = surface, onDismiss = onDismiss)
            }
        }
    }

    @Test
    fun activeRendersTitleBodyAndLabelledDismiss() {
        val missing =
            listOf(
                RequiredCapability.WebView,
                RequiredCapability.GooglePlayServices,
                RequiredCapability.CustomTabs,
            )
        setSurface(BrowserCompatSurface.Active(missing))

        compose.onNodeWithTag(BROWSER_COMPAT_BANNER_TEST_TAG).assertIsDisplayed()
        compose
            .onNodeWithText(s(R.string.translation_compat_banner_title), useUnmergedTree = true)
            .assertIsDisplayed()
        compose
            .onNodeWithText(joinFeatures(missing), substring = true, useUnmergedTree = true)
            .assertIsDisplayed()
        compose
            .onNodeWithContentDescription(s(R.string.translation_compat_banner_dismiss))
            .assertIsDisplayed()
            .assertHasClickAction()
    }

    @Test
    fun messageRegionExposesTheMergedPoliteAnnouncement() {
        val missing = listOf(RequiredCapability.GooglePlayServices)
        setSurface(BrowserCompatSurface.Active(missing))

        val announcement =
            bannerAccessibilityLabel(s(R.string.translation_compat_banner_title), bodyFor(joinFeatures(missing)))
        compose.onNodeWithContentDescription(announcement).assertIsDisplayed()
    }

    @Test
    fun dismissControlInvokesTheCallback() {
        var dismissed = false
        setSurface(BrowserCompatSurface.Active(listOf(RequiredCapability.WebView))) { dismissed = true }

        compose.onNodeWithTag(BROWSER_COMPAT_BANNER_DISMISS_TAG).performClick()
        assertTrue("tapping the dismiss control invokes onDismiss", dismissed)
    }

    @Test
    fun hiddenRendersNothing() {
        setSurface(BrowserCompatSurface.Hidden)
        compose.onNodeWithTag(BROWSER_COMPAT_BANNER_TEST_TAG).assertDoesNotExist()
    }
}
