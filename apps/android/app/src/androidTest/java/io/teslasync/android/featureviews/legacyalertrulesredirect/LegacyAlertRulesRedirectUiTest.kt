package io.teslasync.android.featureviews.legacyalertrulesredirect

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [LegacyAlertRulesRedirectContent] across the branches
 * the surface renders: the one-shot redirect emission (web `<Navigate replace>`), the animated and the
 * reduced-motion redirecting affordances (each exposing a single accessible name so the route is never a
 * blank box and TalkBack always announces a status), and the defensive empty fallback for an unresolved
 * target. The offline gate's `testReleaseUnitTest` covers the pure projection + diagnostics; this covers
 * render + a11y. Mirrors the web spec (web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx).
 */
class LegacyAlertRulesRedirectUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        target: LegacyAlertRulesRedirectTarget? =
            LegacyAlertRulesRedirectProjection.resolve(LegacyLocation(search = "?tab=active")),
        reduceMotion: Boolean = false,
        onRedirect: (LegacyAlertRulesRedirectTarget) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertRulesRedirectContent(
                    target = target,
                    onRedirect = onRedirect,
                    reduceMotion = reduceMotion,
                )
            }
        }
    }

    @Test
    fun firesTheRedirectExactlyOnceWithTheResolvedTarget() {
        val redirects = mutableListOf<LegacyAlertRulesRedirectTarget>()
        setContent(onRedirect = { redirects += it })

        compose.waitForIdle()

        assertEquals(1, redirects.size)
        val redirect = redirects.single()
        assertEquals("notifications/rules", redirect.route)
        assertEquals("?tab=active", redirect.search)
        assertEquals(true, redirect.replace)
    }

    @Test
    fun animatedBranchShowsAnAccessibleRedirectingAffordanceNotABlankBox() {
        setContent(reduceMotion = false)

        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
    }

    @Test
    fun reducedMotionBranchShowsAStaticAccessibleAffordance() {
        setContent(reduceMotion = true)

        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
        compose.onNodeWithText("Loading...").assertIsDisplayed()
    }

    @Test
    fun unresolvedTargetShowsFriendlyEmptyStateAndDoesNotRedirect() {
        val redirects = mutableListOf<LegacyAlertRulesRedirectTarget>()
        setContent(target = null, onRedirect = { redirects += it })

        compose.waitForIdle()

        compose.onNodeWithText("No data available").assertIsDisplayed()
        assertEquals(0, redirects.size)
    }
}
