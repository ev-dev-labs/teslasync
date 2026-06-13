// Instrumented Compose UI + accessibility verification of [SessionExpiredContent] — the single hard-block
// render branch the web component shows (web/src/components/feedback/SessionExpiredModal.tsx): the rose lock
// badge, the "Session expired" heading, the security explanation, and the full-width "Sign in again" re-auth
// action. Every asserted label is the localized copy the surface exposes to TalkBack, the title is verified as
// an accessibility heading, and the one interactive element is verified to expose its name + click action.
// Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + the
// AuthUiState bridge.
package io.teslasync.android.modalsdialogs.sessionexpiredmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SessionExpiredUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SessionExpiredStrings(
            title = "Session expired",
            body = "For your security, your session has timed out. Sign in again to pick up where you left off.",
            signIn = "Sign in again",
        )

    private fun setContent(onSignIn: () -> Unit = {}) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SessionExpiredContent(strings = strings, onSignIn = onSignIn)
                }
            }
        }
    }

    @Test
    fun headingBodyAndActionAllRender() {
        setContent()

        compose.onNodeWithTag(SessionExpiredTestTags.ROOT).assertIsDisplayed()
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithTag(SessionExpiredTestTags.BODY).assertIsDisplayed()
        compose.onNodeWithText(strings.body).assertIsDisplayed()
        // The single interactive element exposes its accessible name and is actionable (a11y label test).
        compose
            .onNodeWithText(strings.signIn)
            .assertIsDisplayed()
            .assertHasClickAction()
    }

    @Test
    fun titleIsExposedAsAnAccessibilityHeading() {
        setContent()

        compose
            .onNodeWithText(strings.title)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    @Test
    fun signInInvokesOnSignIn() {
        var signedIn = false
        setContent(onSignIn = { signedIn = true })

        compose.onNodeWithText(strings.signIn).performClick()
        assertTrue("tapping Sign in again must invoke onSignIn", signedIn)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 720.dp
    }
}
