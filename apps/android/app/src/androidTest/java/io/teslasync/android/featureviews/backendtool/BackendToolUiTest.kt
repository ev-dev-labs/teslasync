package io.teslasync.android.featureviews.backendtool

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [BackendToolContent] across every state the web
 * component renders: idle (the ToolCard header + Run button + the friendly "No result yet" panel, never a
 * blank box), running (the Run button disabled while in flight — web `mutation.isPending`), success (a
 * "Success" badge + a labelled copy affordance over the payload), and failure (a "Failed" badge + the
 * error line). Asserts the rendered i18n strings, the Run callback wiring, and the TalkBack labels (the
 * Run button and the copy affordance are both named). Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection + response envelope + state-holder logic.
 */
class BackendToolUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: BackendToolActionState,
        onRun: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    BackendToolContent(
                        state = state,
                        icon = BackendToolGlyphs.Play,
                        color = "cyan",
                        title = TITLE,
                        description = DESCRIPTION,
                        onRun = onRun,
                    )
                }
            }
        }
    }

    @Test
    fun idleShowsHeaderRunButtonAndFriendlyNoResult() {
        setContent(BackendToolActionState.Idle)
        // ToolCard header (caller-supplied, already-localized description — unique to the header).
        compose.onNodeWithText(DESCRIPTION).assertIsDisplayed()
        // The Run button (web `t('Run')`) and the friendly idle panel (web `'No result yet'`).
        compose.onNodeWithText("Run").assertIsDisplayed()
        compose.onNodeWithText("No result yet").assertIsDisplayed()
    }

    @Test
    fun idleShowsNoOutcomeBadge() {
        setContent(BackendToolActionState.Idle)
        // Web `{mutation.data && <Badge/>}`: no badge until a run completes.
        compose.onNodeWithText("Success").assertDoesNotExist()
        compose.onNodeWithText("Failed").assertDoesNotExist()
    }

    @Test
    fun runButtonInvokesOnRun() {
        var ran = false
        setContent(BackendToolActionState.Idle, onRun = { ran = true })
        compose.onNodeWithText("Run").performClick()
        assertTrue(ran)
    }

    @Test
    fun runningDisablesTheRunButton() {
        var ran = false
        setContent(BackendToolActionState.Running, onRun = { ran = true })
        // Web `loading={mutation.isPending}` disables the control (and shows its spinner).
        compose.onNodeWithText("Run").assertIsDisplayed()
        compose.onNodeWithText("Run").assertIsNotEnabled()
        assertFalse(ran)
    }

    @Test
    fun successShowsBadgeAndLabelledCopyOverThePayload() {
        setContent(BackendToolActionState.Done(BackendToolResponse.of(SUCCESS_PAYLOAD)))
        compose.onNodeWithText("Success").assertIsDisplayed()
        // The copy affordance carries its accessible "Copy" label (P1/S10 common.copyButton).
        compose.onNodeWithText("Copy").assertIsDisplayed()
        // The payload branch replaced the idle message.
        compose.onNodeWithText("No result yet").assertDoesNotExist()
    }

    @Test
    fun failureShowsBadgeAndErrorMessage() {
        setContent(BackendToolActionState.Done(BackendToolResponse.ofError(ERROR_MESSAGE)))
        compose.onNodeWithText("Failed").assertIsDisplayed()
        compose.onNodeWithText(ERROR_MESSAGE).assertIsDisplayed()
        compose.onNodeWithText("No result yet").assertDoesNotExist()
    }

    @Test
    fun runButtonKeepsItsAccessibleLabelAfterARun() {
        setContent(BackendToolActionState.Done(BackendToolResponse.of(SUCCESS_PAYLOAD)))
        // Every interactive element stays labelled across states (the Run button's name is "Run").
        compose.onNodeWithText("Run").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val TITLE = "Config"
        const val DESCRIPTION = "Fleet API configuration"
        const val ERROR_MESSAGE = "503 Service Unavailable"
        val HOST_WIDTH = 380.dp
        val HOST_HEIGHT = 900.dp

        val SUCCESS_PAYLOAD: JsonObject =
            buildJsonObject {
                put("authenticated", true)
                put("baseUrl", "https://fleet-api.prd.na.vn.cloud.tesla.com")
            }
    }
}
