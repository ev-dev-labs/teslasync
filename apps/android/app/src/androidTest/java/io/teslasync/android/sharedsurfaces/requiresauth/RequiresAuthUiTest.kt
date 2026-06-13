package io.teslasync.android.sharedsurfaces.requiresauth

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.AuthModeCapabilities
import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the RequiresAuth shared surface across every outcome the
 * web component renders (web/src/components/feedback/RequiresAuth.tsx): the auth-gated notice for open mode (title
 * + body, with and without the operator's provider hint), the loading notice (web's "render the notice while the
 * contract resolves" policy), the unlocked pass-through that renders the wrapped children and no notice, the
 * stable per-capability test tag, and the merged TalkBack announcement (the web `role="status"`). Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class RequiresAuthUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val featureLabel get() = context.getString(R.string.translation_requiresAuth_featureName_sessionList)
    private val title get() = context.getString(R.string.translation_requiresAuth_title, featureLabel)
    private val body get() = context.getString(R.string.translation_requiresAuth_body, featureLabel)
    private val sessionListTestTag get() = requiresAuthEmptyTestId(RequiresAuthCapability.SessionList)

    private fun contentState(
        isForwardAuth: Boolean,
        capabilities: AuthModeCapabilities = AuthModeCapabilities(),
        providerHint: String? = null,
    ): UiState<AuthModeView> =
        UiState(
            phase = UiPhase.Content,
            data = AuthModeView(isForwardAuth = isForwardAuth, capabilities = capabilities, providerHint = providerHint),
        )

    private fun setContent(
        state: UiState<AuthModeView>,
        capability: RequiresAuthCapability = RequiresAuthCapability.SessionList,
        children: String = "Unlocked section",
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RequiresAuthContent(state = state, capability = capability) {
                    BodyText(children)
                }
            }
        }
    }

    @Test
    fun openModeShowsTheNoticeWithTitleAndBody() {
        setContent(contentState(isForwardAuth = false, providerHint = null))
        compose.onNodeWithTag(sessionListTestTag).assertIsDisplayed()
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(body, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun openModeWithAProviderHintRendersTheHintInTheBody() {
        val provider = "Authentik"
        val bodyWithHint = context.getString(R.string.translation_requiresAuth_bodyWithHint, featureLabel, provider)
        setContent(contentState(isForwardAuth = false, providerHint = provider))
        compose.onNodeWithTag(sessionListTestTag).assertIsDisplayed()
        compose.onNodeWithText(bodyWithHint, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun loadingRendersTheNoticeWithoutAProviderHint() {
        setContent(UiState.loading())
        compose.onNodeWithTag(sessionListTestTag).assertIsDisplayed()
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(body, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun noticeExposesAMergedPoliteAccessibilityAnnouncement() {
        setContent(contentState(isForwardAuth = false, providerHint = null))
        compose.onNodeWithContentDescription(title, substring = true).assertIsDisplayed()
    }

    @Test
    fun forwardAuthWithTheCapabilityRendersTheChildrenAndNoNotice() {
        setContent(contentState(isForwardAuth = true, capabilities = AuthModeCapabilities(sessionList = true)))
        compose.onNodeWithText("Unlocked section").assertIsDisplayed()
        compose.onNodeWithTag(sessionListTestTag).assertDoesNotExist()
    }

    @Test
    fun forwardAuthWithTheCapabilityDisabledStillRendersTheNotice() {
        setContent(contentState(isForwardAuth = true, capabilities = AuthModeCapabilities(sessionList = false), providerHint = "Keycloak"))
        compose.onNodeWithTag(sessionListTestTag).assertIsDisplayed()
        compose.onNodeWithText("Unlocked section").assertDoesNotExist()
    }

    @Test
    fun statefulRequiresAuthBindsAForwardAuthContractAndRendersChildren() {
        val source =
            object : RequiresAuthSource {
                override val authMode: StateFlow<Resource<AuthModeResponse>> =
                    MutableStateFlow(
                        Resource.Success(
                            AuthModeResponse(mode = "forward_auth", capabilities = AuthModeCapabilities(sessionList = true)),
                            fetchedAt = STAMP,
                            stale = false,
                        ),
                    )

                override fun refresh() = Unit
            }
        val vm = RequiresAuthViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RequiresAuth(capability = RequiresAuthCapability.SessionList, viewModel = vm) {
                    BodyText("Bound unlocked section")
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Bound unlocked section").assertIsDisplayed()
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
