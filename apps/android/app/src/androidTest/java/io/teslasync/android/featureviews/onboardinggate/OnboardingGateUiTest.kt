package io.teslasync.android.featureviews.onboardinggate

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [OnboardingGateContent] across the guard's render
 * branches. Mirrors the web spec (web/src/features/onboarding/components/OnboardingGate.tsx): a
 * [OnboardingGateDecision.Redirect] fires the bounce once (web `navigate('/onboarding', { replace: true })`)
 * and shows the transient route-transition affordance carrying a single accessible "Loading" name for
 * TalkBack (the a11y label test), under both normal and reduced motion; a [OnboardingGateDecision.Pass] takes
 * no action so it never redirects (the faithful native form of `return null`). Asserts presence via
 * `assertIsDisplayed` and behaviour via the captured `onRedirect` callback — the robust style the sibling
 * LegacyAlertsRedirectUiTest uses. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest`
 * covers the resolver + ViewModel logic.
 */
class OnboardingGateUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun redirectShowsAccessibleLoadingAffordanceAndFiresOnce() {
        val redirects = renderRedirect(reduceMotion = false)

        // The affordance carries a single accessible "Loading" name for TalkBack (a11y label test).
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        assertEquals(1, redirects.size)
        assertEquals("onboarding", redirects.single().route)
        assertTrue(redirects.single().replace)
    }

    @Test
    fun redirectUnderReducedMotionStillExposesTheAccessibleNameAndRedirects() {
        val redirects = renderRedirect(reduceMotion = true)

        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        assertEquals(1, redirects.size)
    }

    @Test
    fun everyPassReasonTakesNoActionAndNeverRedirects() {
        val redirects = mutableListOf<OnboardingGateTarget>()
        // Compose every Pass reason at once (one setContent per rule): each takes no action, so onRedirect
        // never fires — the faithful native form of the web component's `return null`.
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Column {
                    OnboardingGatePassReason.entries.forEach { reason ->
                        OnboardingGateContent(
                            decision = OnboardingGateDecision.Pass(reason),
                            onRedirect = { redirects += it },
                            reduceMotion = false,
                        )
                    }
                }
            }
        }
        compose.waitForIdle()

        assertTrue("a Pass decision must never redirect", redirects.isEmpty())
    }

    private fun renderRedirect(reduceMotion: Boolean): List<OnboardingGateTarget> {
        val redirects = mutableListOf<OnboardingGateTarget>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingGateContent(
                    decision = OnboardingGateDecision.Redirect(OnboardingGateTarget()),
                    onRedirect = { redirects += it },
                    reduceMotion = reduceMotion,
                )
            }
        }
        compose.waitForIdle()
        return redirects
    }
}
