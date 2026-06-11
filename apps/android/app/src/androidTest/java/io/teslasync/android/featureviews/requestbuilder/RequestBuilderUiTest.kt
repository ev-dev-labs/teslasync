package io.teslasync.android.featureviews.requestbuilder

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.endpointsidebar.EndpointBody
import io.teslasync.android.featureviews.endpointsidebar.EndpointParam
import io.teslasync.android.featureviews.endpointsidebar.HttpMethod
import io.teslasync.android.featureviews.endpointsidebar.ParamLocation
import io.teslasync.android.featureviews.endpointsidebar.ParsedEndpoint
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [RequestBuilderContent] across every state the web
 * component renders (the loading skeleton chrome, the data-empty "select an endpoint" placeholder, the
 * request form — URL bar + Send + parameter / body / auth editors, the inline destructive confirmation, a
 * hard error + retry, and the stale/offline cached path). Asserts the rendered i18n strings, the URL build,
 * the destructive confirm → send flow, the non-destructive immediate send, the in-flight `sending` label,
 * and the TalkBack labels (the loading region, the URL field, the refresh control and every editor are
 * named; the parameter/auth fields expose a set-text action). Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the pure projection + adapter + state-holder logic.
 */
class RequestBuilderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<RequestBuilderSnapshot>,
        sending: Boolean = false,
        onSend: (RequestDraft) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    RequestBuilderContent(
                        state = state,
                        sending = sending,
                        onSend = onSend,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun emptyShowsSelectEndpointPlaceholder() {
        setContent(UiState(UiPhase.Empty, data = RequestBuilderSnapshot.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("Select an endpoint from the sidebar to start testing").assertIsDisplayed()
    }

    @Test
    fun contentShowsUrlSendAndQueryAndAuthSections() {
        setContent(content(getEndpoint()))
        compose.onNodeWithContentDescription("/api/v1/vehicles").assertIsDisplayed()
        compose.onNodeWithText("Send").assertIsDisplayed()
        compose.onNodeWithText("Query Parameters", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Authentication (Optional)", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun contentShowsPathParamsAndRequestBodySections() {
        setContent(content(postEndpoint()))
        compose.onNodeWithText("Path Parameters", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Request Body", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("application/json", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun sendingDisablesSendAndShowsSendingLabel() {
        setContent(content(getEndpoint()), sending = true)
        compose.onNodeWithText("Sending...").assertIsDisplayed()
        compose.onNodeWithText("Sending...").assertIsNotEnabled()
    }

    @Test
    fun nonDestructiveSendInvokesOnSendImmediately() {
        var draft: RequestDraft? = null
        setContent(content(getEndpoint()), onSend = { draft = it })
        compose.onNodeWithText("Send").performClick()
        assertEquals("/vehicles", draft?.url)
        assertEquals("GET", draft?.method)
        // No confirmation appears for a non-destructive verb.
        compose.onNodeWithText("Yes, send").assertDoesNotExist()
    }

    @Test
    fun destructiveSendShowsConfirmationThenSends() {
        var draft: RequestDraft? = null
        setContent(content(postEndpoint()), onSend = { draft = it })

        compose.onNodeWithText("Send").performClick()
        // The confirm banner appears and nothing is sent yet (web `setConfirmOpen(true)`).
        compose.onNodeWithText("Yes, send").assertIsDisplayed()
        assertNull(draft)

        compose.onNodeWithText("Yes, send").performClick()
        assertEquals("POST", draft?.method)
        assertEquals("/vehicles/{vehicleID}/command", draft?.url)
    }

    @Test
    fun destructiveCancelDismissesConfirmationWithoutSending() {
        var draft: RequestDraft? = null
        setContent(content(postEndpoint()), onSend = { draft = it })

        compose.onNodeWithText("Send").performClick()
        compose.onNodeWithText("Cancel").performClick()

        compose.onNodeWithText("Yes, send").assertDoesNotExist()
        assertNull(draft)
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedFormVisibleWithLabelledRefresh() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = RequestBuilderSnapshot(getEndpoint()),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        compose.onNodeWithContentDescription("/api/v1/vehicles").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun authFieldExposesAccessibleTextAction() {
        // A minimal endpoint (no params, no body) leaves the X-API-Key field as the only editor, so the
        // set-text action assertion is unambiguous.
        setContent(content(minimalEndpoint()))
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private fun content(endpoint: ParsedEndpoint): UiState<RequestBuilderSnapshot> =
        UiState(UiPhase.Content, data = RequestBuilderSnapshot(endpoint), fetchedAt = NOW)

    private fun getEndpoint(): ParsedEndpoint =
        ParsedEndpoint(
            method = HttpMethod.Get,
            path = "/vehicles",
            tag = "Vehicles",
            summary = "List all vehicles",
            operationId = "listVehicles",
            parameters =
                listOf(
                    EndpointParam("limit", ParamLocation.Query, required = false, type = "integer", description = ""),
                ),
        )

    private fun postEndpoint(): ParsedEndpoint =
        ParsedEndpoint(
            method = HttpMethod.Post,
            path = "/vehicles/{vehicleID}/command",
            tag = "Vehicles",
            summary = "Send a vehicle command",
            operationId = "sendCommand",
            parameters =
                listOf(
                    EndpointParam("vehicleID", ParamLocation.Path, required = true, type = "string", description = "The vehicle id"),
                ),
            requestBody = EndpointBody(contentType = "application/json", example = "{\"command\":\"honk_horn\"}"),
        )

    private fun minimalEndpoint(): ParsedEndpoint =
        ParsedEndpoint(
            method = HttpMethod.Get,
            path = "/ping",
            tag = "System",
            summary = "Health check",
            operationId = "ping",
        )

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 1600.dp
    }
}
