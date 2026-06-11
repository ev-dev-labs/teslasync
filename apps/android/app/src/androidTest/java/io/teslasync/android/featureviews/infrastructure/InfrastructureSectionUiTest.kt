package io.teslasync.android.featureviews.infrastructure

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [InfrastructureSectionContent] across every state
 * the web component renders (idle "no result yet", success JSON + Success badge, a failed `{error}` body,
 * a transport/offline failure). Asserts the rendered i18n strings and that the Run / Send Test controls
 * fire with the right tool. Runs under `connectedAndroidTest`; the gate's `testReleaseUnitTest` covers the
 * pure projection/state logic off-device.
 *
 * Missing-catalog keys (`Db Stats`, `Env Check`, `Send Test`, `No result yet`, `Request failed`) resolve to
 * the key text via the i18n facade's natural-key fallback, exactly as react-i18next does on the web, so the
 * asserted strings match the web verbatim.
 */
class InfrastructureSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: InfrastructureSectionState,
        onRun: (InfraTool, String, String) -> Unit = { _, _, _ -> },
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InfrastructureSectionContent(state = state, onRun = onRun)
            }
        }
    }

    @Test
    fun idleShowsEveryToolWithRunControlsAndNoResultHint() {
        setContent(InfrastructureSectionState.initial())
        // Tool titles (one of each missing-catalog title falls back to the key text).
        compose.onAllNodesWithText("Mqtt").assertCountEquals(2) // header + result-panel caption
        compose.onNodeWithText("Send Test").assertIsDisplayed()
        // Four backend tools each carry a Run control.
        compose.onAllNodesWithText("Run").assertCountEquals(4)
        // Every tool shows its idle "no result yet" region — never a blank box.
        compose.onAllNodesWithText("No result yet").assertCountEquals(5)
    }

    @Test
    fun successShowsResultJsonAndSuccessBadge() {
        val payload = buildJsonObject { put("tables", JsonPrimitive(7)) }
        setContent(
            InfrastructureSectionState
                .initial()
                .with(InfraTool.DbStats, ToolRun(phase = RunPhase.Succeeded, result = payload)),
        )
        compose.onNodeWithText("Success").assertIsDisplayed()
        compose.onNodeWithText("tables", substring = true).assertIsDisplayed()
    }

    @Test
    fun failedBackendBodyShowsFailedBadgeAndVerbatimError() {
        setContent(
            InfrastructureSectionState
                .initial()
                .with(InfraTool.Migrations, ToolRun(phase = RunPhase.Failed, errorDetail = "boom")),
        )
        compose.onNodeWithText("Failed").assertIsDisplayed()
        compose.onNodeWithText("boom").assertIsDisplayed()
    }

    @Test
    fun offlineFailureShowsOfflineChipAndGenericMessage() {
        setContent(
            InfrastructureSectionState
                .initial()
                .with(InfraTool.EnvCheck, ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.Network)),
        )
        compose.onNodeWithText("Offline").assertIsDisplayed()
        compose.onNodeWithText("Request failed").assertIsDisplayed()
    }

    @Test
    fun runControlFiresForFirstBackendTool() {
        var fired: InfraTool? = null
        setContent(InfrastructureSectionState.initial(), onRun = { tool, _, _ -> fired = tool })
        compose.onAllNodesWithText("Run")[0].performClick()
        assertEquals(InfraTool.DbStats, fired)
    }

    @Test
    fun sendTestFiresForMqttTool() {
        var fired: InfraTool? = null
        setContent(InfrastructureSectionState.initial(), onRun = { tool, _, _ -> fired = tool })
        compose.onNodeWithText("Send Test").performClick()
        assertEquals(InfraTool.MqttTest, fired)
    }
}
