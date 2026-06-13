package io.teslasync.android.sharedsurfaces.errordisplay

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ErrorDisplay shared surface across every state the
 * web component renders (web/src/components/feedback/ErrorDisplay.tsx): the 404 banner with a Back-to-list
 * CTA, the 401/403 Sign-in banner, the 5xx Server-error banner, the offline banner (disabled "Retry when
 * online"), and the network banner. It asserts the rendered i18n title + message and that each interactive
 * CTA is a labelled, clickable button (the offline CTA labelled but disabled), plus that the banner container
 * always renders (never a blank box). Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate
 * covers the pure projection, this covers the render.
 */
class ErrorDisplayUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun render(
        httpStatus: Int?,
        transportFailure: Boolean = false,
        online: Boolean = true,
        hasListHref: Boolean = false,
    ): ErrorRender =
        requireNotNull(
            ErrorDisplayProjection.render(
                snapshot =
                    ErrorSnapshot(
                        present = true,
                        httpStatus = httpStatus,
                        transportFailure = transportFailure,
                        online = online,
                    ),
                hasListHref = hasListHref,
                retryable = true,
            ),
        )

    private fun setCard(
        render: ErrorRender,
        resourceName: String? = null,
        compact: Boolean = false,
        onAction: (ErrorActionKind) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ErrorDisplayCard(render = render, resourceName = resourceName, compact = compact, onAction = onAction)
            }
        }
    }

    @Test
    fun notFoundBannerShowsResourceTitleAndBackToList() {
        setCard(render(httpStatus = 404, hasListHref = true), resourceName = "Drive")

        val title = context.getString(R.string.translation_error_notFound_title, "Drive")
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        val cta = context.getString(R.string.translation_error_notFound_cta)
        compose.onNodeWithText(cta).assertIsDisplayed()
        compose.onNodeWithText(cta).assertHasClickAction()
        compose.onNodeWithTag(ERROR_DISPLAY_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun unauthorizedBannerShowsSignIn() {
        setCard(render(httpStatus = 401))

        val title = context.getString(R.string.translation_error_unauthorized_title)
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        val cta = context.getString(R.string.translation_error_unauthorized_cta)
        compose.onNodeWithText(cta).assertHasClickAction()
    }

    @Test
    fun serverErrorBannerShowsRetry() {
        setCard(render(httpStatus = 503))

        val title = context.getString(R.string.translation_error_serverError_title)
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        val cta = context.getString(R.string.translation_error_retry)
        compose.onNodeWithText(cta).assertHasClickAction()
    }

    @Test
    fun offlineBannerShowsADisabledRetryWhenOnline() {
        setCard(render(httpStatus = null, transportFailure = true, online = false))

        val title = context.getString(R.string.translation_error_network_offlineTitle)
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        val cta = context.getString(R.string.translation_error_network_retryWhenOnline)
        compose.onNodeWithText(cta).assertIsDisplayed()
        compose.onNodeWithText(cta).assertHasNoClickAction()
    }

    @Test
    fun networkBannerShowsMessageAndRetry() {
        setCard(render(httpStatus = null, online = true))

        val title = context.getString(R.string.translation_error_network_title)
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        val message = context.getString(R.string.translation_error_network_message)
        compose.onNodeWithText(message, useUnmergedTree = true).assertIsDisplayed()
        val cta = context.getString(R.string.translation_error_retry)
        compose.onNodeWithText(cta).assertHasClickAction()
    }

    @Test
    fun tappingRetryInvokesTheActionCallback() {
        var invoked: ErrorActionKind? = null
        setCard(render(httpStatus = 503), onAction = { invoked = it })

        val cta = context.getString(R.string.translation_error_retry)
        compose.onNodeWithText(cta).performClick()
        compose.waitForIdle()

        assertEquals(ErrorActionKind.Retry, invoked)
    }
}
