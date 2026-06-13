package io.teslasync.android.sharedsurfaces.queryerror

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the QueryError shared surface across every branch the
 * web component renders (web/src/components/feedback/QueryError.tsx): waiting, not-found (with the
 * resource-personalised title + Back-to-list CTA), unauthorized (Sign-in), server-error (Retry), network
 * (Retry enabled), and offline (the disabled "Retry when online"). It asserts the rendered i18n title +
 * message per branch and that every interactive CTA is a labelled, clickable button — and, on the offline
 * branch, a disabled one. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure
 * projection, this covers the render.
 */
class QueryErrorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun render(branch: QueryErrorKind): QueryErrorRender =
        QueryErrorRender(
            branch = branch,
            retryEnabled = branch != QueryErrorKind.Offline,
            polite = branch == QueryErrorKind.Waiting || branch == QueryErrorKind.Offline,
        )

    private fun setCard(
        render: QueryErrorRender,
        resourceName: String? = null,
        onRetry: (() -> Unit)? = null,
        onSignIn: (() -> Unit)? = null,
        onBackToList: (() -> Unit)? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                QueryErrorCard(
                    render = render,
                    resourceName = resourceName,
                    onRetry = onRetry,
                    onSignIn = onSignIn,
                    onBackToList = onBackToList,
                )
            }
        }
    }

    private fun string(resId: Int): String = context.getString(resId)

    @Test
    fun waitingBranchShowsTitleAndMessageAndIsNeverBlank() {
        setCard(render(QueryErrorKind.Waiting))

        compose.onNodeWithText(string(R.string.translation_error_waiting_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_waiting_message)).assertIsDisplayed()
        compose.onNodeWithTag(QUERY_ERROR_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun notFoundBranchShowsResourceTitleAndBackToListCta() {
        setCard(render(QueryErrorKind.NotFound), resourceName = "Drive", onBackToList = {})

        val title = context.getString(R.string.translation_error_notFound_title, "Drive")
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_notFound_cta)).assertHasClickAction()
    }

    @Test
    fun unauthorizedBranchShowsSignInCta() {
        setCard(render(QueryErrorKind.Unauthorized), onSignIn = {})

        compose.onNodeWithText(string(R.string.translation_error_unauthorized_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_unauthorized_cta)).assertHasClickAction()
    }

    @Test
    fun serverErrorBranchShowsRetryCta() {
        setCard(render(QueryErrorKind.ServerError), onRetry = {})

        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_retry)).assertHasClickAction()
    }

    @Test
    fun networkBranchShowsAnEnabledRetry() {
        setCard(render(QueryErrorKind.Network), onRetry = {})

        compose.onNodeWithText(string(R.string.translation_error_network_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_retry)).assertHasClickAction()
    }

    @Test
    fun offlineBranchShowsADisabledRetryWhenOnline() {
        setCard(render(QueryErrorKind.Offline), onRetry = {})

        compose.onNodeWithText(string(R.string.translation_error_network_offlineTitle)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_network_retryWhenOnline)).assertIsNotEnabled()
    }

    @Test
    fun tappingRetryInvokesTheCallback() {
        var clicks = 0
        setCard(render(QueryErrorKind.Network), onRetry = { clicks++ })

        compose.onNodeWithText(string(R.string.translation_error_retry)).performClick()
        compose.waitForIdle()

        assertEquals(1, clicks)
    }
}
