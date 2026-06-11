package io.teslasync.android.feature.views.jwtdecoder

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the JwtDecoder across every state the web tool
 * renders (web/src/features/admin/components/devtools/tools/JwtDecoder.tsx): Idle (just the labelled
 * input), Invalid (the "Invalid Jwt" line, no panels), and Decoded (the header + payload panels). Also
 * pins the web's conditional composition — the panels appear only when the token decodes — and exercises
 * the live recompute by typing into the field. The stateful entry's `view.opened` telemetry is verified
 * here too. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * decode + diagnostics logic, this covers render + a11y.
 */
class JwtDecoderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun decoded(): JwtDecodeResult.Decoded =
        JwtDecodeResult.Decoded(
            header = buildJsonObject { put("alg", "HS256") },
            payload = buildJsonObject { put("sub", "1234567890") },
        )

    private fun setContent(
        jwt: String,
        result: JwtDecodeResult,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                JwtDecoderContent(jwt = jwt, onJwtChange = {}, result = result)
            }
        }
    }

    @Test
    fun idleStateShowsLabelledInputAndNoResults() {
        setContent(jwt = "", result = JwtDecodeResult.Idle)
        // The ToolCard header + the labelled input are always present (never a blank box).
        compose.onNodeWithText("Jwt Decoder").assertIsDisplayed()
        compose.onNodeWithText("Jwt Input").assertIsDisplayed()
        // No error and no panels until there is something to decode (web `{decoded.header && …}`).
        compose.onNodeWithText("Invalid Jwt").assertDoesNotExist()
        compose.onNodeWithText("Jwt Header").assertDoesNotExist()
        compose.onNodeWithText("Jwt Payload").assertDoesNotExist()
    }

    @Test
    fun invalidStateShowsErrorLineAndNoPanels() {
        setContent(jwt = "not-a-jwt", result = JwtDecodeResult.Invalid)
        compose.onNodeWithText("Invalid Jwt").assertIsDisplayed()
        compose.onNodeWithText("Jwt Header").assertDoesNotExist()
        compose.onNodeWithText("Jwt Payload").assertDoesNotExist()
    }

    @Test
    fun decodedStateShowsHeaderAndPayloadPanels() {
        setContent(jwt = "h.p.s", result = decoded())
        compose.onNodeWithText("Jwt Header").assertIsDisplayed()
        compose.onNodeWithText("Jwt Payload").assertIsDisplayed()
        // Each ResultPanel folds its pretty-printed payload into one accessible node.
        compose.onNodeWithContentDescription("\"alg\": \"HS256\"", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("\"sub\": \"1234567890\"", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Invalid Jwt").assertDoesNotExist()
    }

    @Test
    fun inputExposesAccessibleLabel() {
        setContent(jwt = "", result = JwtDecodeResult.Idle)
        // The field's label is its TalkBack name; the placeholder example is its supporting hint.
        compose.onNodeWithText("Jwt Input").assertIsDisplayed()
        compose.onNodeWithText("eyJhbGciOiJSUzI1NiIs...").assertIsDisplayed()
    }

    @Test
    fun typingAnInvalidTokenSurfacesTheErrorReactively() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var jwt by remember { mutableStateOf("") }
                JwtDecoderContent(jwt = jwt, onJwtChange = { jwt = it }, result = JwtDecoderLogic.decode(jwt))
            }
        }
        compose.onNodeWithText("Invalid Jwt").assertDoesNotExist()
        compose.onNode(hasSetTextAction()).performTextInput("garbage")
        compose.onNodeWithText("Invalid Jwt").assertIsDisplayed()
    }

    @Test
    fun statefulEntryRendersAndEmitsViewOpened() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                JwtDecoder(logger = logger)
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Jwt Decoder").assertIsDisplayed()
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "JwtDecoder"), opened.single().second)
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
