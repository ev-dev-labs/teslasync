package io.teslasync.android.feature.views.resultpanel

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ResultPanelContent] across every branch the web
 * component renders (web/src/features/admin/components/devtools/ResultPanel.tsx): the error line, the
 * pretty-printed result with its copy affordance, and the idle message. Also pins the web's independent
 * `{hasData ? <CopyButton/> : null}` rule — the copy button follows the presence of data even when an error
 * is showing. Runs under `connectedAndroidTest` (a device/emulator); the offline `testReleaseUnitTest` gate
 * covers the projection logic, this covers render + a11y.
 */
class ResultPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Run result"
    private val idle = "No result yet"

    private fun sampleData() =
        buildJsonObject {
            put("chart", "1.4.2")
            put("count", 3)
        }

    @Test
    fun errorStateShowsMessageAndHidesCopyWhenNoData() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ResultPanelContent(title = title, idleMessage = idle, error = "Boom")
            }
        }
        compose.onNodeWithText("Boom").assertIsDisplayed()
        compose.onNodeWithText("Copy").assertDoesNotExist()
    }

    @Test
    fun resultStateShowsPrettyJsonAndCopyAffordance() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ResultPanelContent(title = title, idleMessage = idle, data = sampleData())
            }
        }
        compose.onNodeWithText(title).assertIsDisplayed()
        // The result block folds its payload into one accessible node (web `<pre>` content).
        compose.onNodeWithContentDescription("\"chart\": \"1.4.2\"", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Copy").assertIsDisplayed()
    }

    @Test
    fun idleStateShowsTheProvidedMessage() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ResultPanelContent(title = title, idleMessage = idle)
            }
        }
        compose.onNodeWithText(idle).assertIsDisplayed()
        compose.onNodeWithText("Copy").assertDoesNotExist()
    }

    @Test
    fun errorCarryingDataStillShowsCopyAffordance() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ResultPanelContent(title = title, idleMessage = idle, data = sampleData(), error = "Boom")
            }
        }
        compose.onNodeWithText("Boom").assertIsDisplayed()
        compose.onNodeWithText("Copy").assertIsDisplayed()
    }
}
