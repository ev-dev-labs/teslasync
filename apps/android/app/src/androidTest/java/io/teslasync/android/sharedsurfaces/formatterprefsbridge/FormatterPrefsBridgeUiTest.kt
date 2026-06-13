// On-device UI + accessibility verification of the FormatterPrefsBridge surface — proves the reproduced web
// contract: the bridge is HEADLESS (web `return null`), so it contributes NO node and NO interactive element to
// the tree (there is therefore nothing to label, the honest a11y outcome for a side-effect-only mount), while
// still firing its one-shot `view.opened` diagnostic on first composition. Runs on a device/emulator via
// `:android:connectedAndroidTest`.

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodes
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onRoot
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class FormatterPrefsBridgeUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun bridgeIsHeadlessAndContributesNoNode() {
        setContent()
        compose.waitForIdle()

        // Headless parity (web `return null`): the mount adds nothing renderable to the tree.
        compose.onRoot().onChildren().assertCountEquals(0)
    }

    @Test
    fun bridgeExposesNoInteractiveElement() {
        setContent()
        compose.waitForIdle()

        // A side-effect-only mount has no controls, so there is nothing to label — the honest a11y outcome.
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    @Test
    fun bridgeFiresViewOpenedOnFirstComposition() {
        val logger = RecordingLogger()
        setContent(logger = logger)
        compose.waitForIdle()

        assertTrue(logger.records.any { it.event == "view.opened" })
    }

    private fun setContent(logger: Logger = RecordingLogger()) {
        compose.setContent {
            FormatterPrefsBridge(source = FakeSource(), logger = logger)
        }
    }

    private class FakeSource(
        val settings: MutableStateFlow<Resource<JsonElement>> =
            MutableStateFlow(
                Resource.Success(
                    data = buildJsonObject { put("locale", "en-US") },
                    fetchedAt = 0L,
                    stale = false,
                ),
            ),
        val changed: MutableSharedFlow<Unit> = MutableSharedFlow(extraBufferCapacity = 1),
    ) : FormatterPrefsBridgeSource {
        override fun settings(): Flow<Resource<JsonElement>> = settings

        override fun settingsChanged(): Flow<Unit> = changed
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }
}
