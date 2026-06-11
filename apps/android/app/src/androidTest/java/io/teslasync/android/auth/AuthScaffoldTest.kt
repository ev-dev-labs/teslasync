package io.teslasync.android.auth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.support.FakeAuthSession
import io.teslasync.android.support.expiredSignedInState
import io.teslasync.android.support.signedInState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.auth.AuthState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.After
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the [AuthScaffold] gate (P3/A4, ADR-008). A [FakeAuthSession]
 * drives a real [AuthController] through the full A4 surface set — signed-out, authorizing,
 * authenticated, expired, reauth-required, error — and the user sign-out transition, asserting the
 * gated shell shows only when a session is live. The pure state mapping is covered by the no-device
 * `AuthUiStateMapperTest`/`AuthControllerTest`; this proves the surfaces actually render on a device
 * (connectedDebugAndroidTest). Copy is resolved from resources so assertions survive translation.
 */
class AuthScaffoldTest {
    @get:Rule
    val rule = createComposeRule()

    private val scope = CoroutineScope(Dispatchers.Main)
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @After
    fun tearDown() {
        scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
    }

    private fun renderScaffold(session: FakeAuthSession): AuthController {
        val controller = AuthController(session, scope, nowEpochSeconds = { NOW })
        rule.setContent {
            TeslaSyncTheme {
                AuthScaffold(controller = controller) { BodyText(APP_CONTENT) }
            }
        }
        return controller
    }

    private fun awaitText(text: String) {
        rule.waitUntil(TIMEOUT_MS) { rule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun awaitContentDescription(description: String) {
        rule.waitUntil(TIMEOUT_MS) {
            rule.onAllNodesWithContentDescription(description, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun signedOutShowsSignInSurfaceNotShell() {
        renderScaffold(FakeAuthSession(AuthState.SignedOut))
        awaitText(context.getString(R.string.auth_sign_in))
        rule.onNodeWithText(context.getString(R.string.auth_welcome_title)).assertIsDisplayed()
        rule.onNodeWithText(APP_CONTENT).assertDoesNotExist()
    }

    @Test
    fun authorizingShowsLoadingSurface() {
        val session = FakeAuthSession()
        session.onRestore = { session.emit(AuthState.Authenticating) }
        renderScaffold(session)
        awaitContentDescription(context.getString(R.string.auth_authorizing))
        rule.onNodeWithText(APP_CONTENT).assertDoesNotExist()
    }

    @Test
    fun authenticatedShowsTheGatedShell() {
        val session = FakeAuthSession()
        session.onRestore = { session.emit(signedInState(NOW)) }
        renderScaffold(session)
        awaitText(APP_CONTENT)
        rule.onNodeWithText(APP_CONTENT).assertIsDisplayed()
    }

    @Test
    fun expiredShowsExpiredSurface() {
        val session = FakeAuthSession()
        session.onRestore = { session.emit(expiredSignedInState(NOW)) }
        renderScaffold(session)
        awaitText(context.getString(R.string.auth_expired_title))
        rule.onNodeWithText(APP_CONTENT).assertDoesNotExist()
    }

    @Test
    fun serverInvalidationShowsReauthSurface() {
        val session = FakeAuthSession()
        session.onRestore = { session.emit(signedInState(NOW)) }
        renderScaffold(session)
        awaitText(APP_CONTENT)
        // A server-side invalidation (not a user sign-out) drops to SignedOut with a prior session.
        rule.runOnUiThread { session.emit(AuthState.SignedOut) }
        awaitText(context.getString(R.string.auth_reauth_title))
        rule.onNodeWithText(APP_CONTENT).assertDoesNotExist()
    }

    @Test
    fun signInErrorShowsErrorSurfaceWithMessage() {
        val session = FakeAuthSession()
        session.onRestore = { session.emit(AuthState.Error("Authorization failed")) }
        renderScaffold(session)
        awaitText(context.getString(R.string.auth_error_title))
        rule.onNodeWithText("Authorization failed").assertIsDisplayed()
    }

    @Test
    fun userSignOutReturnsToSignInSurface() {
        val session = FakeAuthSession()
        session.onRestore = { session.emit(signedInState(NOW)) }
        val controller = renderScaffold(session)
        awaitText(APP_CONTENT)
        rule.runOnUiThread { controller.signOut() }
        awaitText(context.getString(R.string.auth_sign_in))
        rule.onNodeWithText(APP_CONTENT).assertDoesNotExist()
    }

    private companion object {
        const val APP_CONTENT = "AUTHED_SHELL_CONTENT"
        const val NOW = 1_000L
        const val TIMEOUT_MS = 5_000L
    }
}
