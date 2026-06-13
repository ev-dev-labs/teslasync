// Instrumented Compose UI + accessibility verification of the stateless RateLimitBannerContent across the
// states the web component renders: the hidden surface (web `state === null` → nothing), the rate-limit
// countdown (message + the "Retry now" action disabled until the countdown elapses + dismiss), the elapsed
// retry-ready state (enabled action + callback), and the upstream-outage copy. Also asserts the polite
// live-region announcement (the web `aria-live="polite"`) and the dismiss callback. Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ratelimitbanner

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class RateLimitBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun hiddenSurfaceRendersNothing() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RateLimitBannerContent(surface = RateLimitSurface.Hidden)
            }
        }
        compose.onNodeWithText(RETRY).assertDoesNotExist()
        compose.onNodeWithContentDescription(DISMISS).assertDoesNotExist()
    }

    @Test
    fun rateLimitedCountingDownShowsMessageAndDisabledRetry() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RateLimitBannerContent(
                    surface = RateLimitSurface.Visible(RateLimitKind.RateLimited, remainingSeconds = 30, retryEnabled = false),
                )
            }
        }
        compose.onNodeWithText(RATE_LIMIT_MESSAGE, substring = true).assertIsDisplayed()
        compose.onNodeWithText(RETRY).assertIsDisplayed().assertIsNotEnabled()
        compose.onNodeWithContentDescription(DISMISS).assertIsDisplayed()
    }

    @Test
    fun bannerExposesMessageAsLiveRegionLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RateLimitBannerContent(
                    surface = RateLimitSurface.Visible(RateLimitKind.RateLimited, remainingSeconds = 30, retryEnabled = false),
                )
            }
        }
        // The web `aria-live="polite"` alert speaks the live message; it is mirrored onto the banner node.
        compose.onNodeWithContentDescription(RATE_LIMIT_MESSAGE, substring = true).assertIsDisplayed()
    }

    @Test
    fun upstreamDownShowsUpstreamMessage() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RateLimitBannerContent(
                    surface = RateLimitSurface.Visible(RateLimitKind.UpstreamDown, remainingSeconds = 15, retryEnabled = false),
                )
            }
        }
        compose.onNodeWithText(UPSTREAM_MESSAGE, substring = true).assertIsDisplayed()
    }

    @Test
    fun retryReadyEnablesActionAndInvokesCallback() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RateLimitBannerContent(
                    surface = RateLimitSurface.Visible(RateLimitKind.RateLimited, remainingSeconds = 0, retryEnabled = true),
                    onRetry = { retried = true },
                )
            }
        }
        compose.onNodeWithText(RETRY).assertIsEnabled().performClick()
        assertTrue(retried)
    }

    @Test
    fun dismissInvokesCallback() {
        var dismissed = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RateLimitBannerContent(
                    surface = RateLimitSurface.Visible(RateLimitKind.RateLimited, remainingSeconds = 30, retryEnabled = false),
                    onDismiss = { dismissed = true },
                )
            }
        }
        compose.onNodeWithContentDescription(DISMISS).performClick()
        assertTrue(dismissed)
    }

    private companion object {
        // English catalog values resolved on-device.
        const val RETRY = "Retry now"
        const val DISMISS = "Dismiss"
        const val RATE_LIMIT_MESSAGE = "Too many requests"
        const val UPSTREAM_MESSAGE = "Tesla upstream unavailable"
    }
}
