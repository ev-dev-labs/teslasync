// On-device verification of the FullscreenButton surface — the parity port of the web `FullscreenButton`
// (web/src/components/ui/FullscreenButton.tsx). Covers what the offline unit tests cannot: the button renders
// one clickable node carrying the flipping accessible name (web `aria-label` / `title`), a tap drives the
// bound controller seam and flips the icon + label from enter to exit, the stateless exit branch renders the
// exit affordance, and the one-shot PII-safe `view.opened` diagnostic fires on mount. The hidden
// (unsupported) branch is covered off-device by FullscreenButtonViewModelTest / FullscreenButtonModelTest (the
// gated layer). The offline :android:testReleaseUnitTest gate covers the pure model + the state holder.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fullscreenbutton

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class FullscreenButtonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val rootTag = FullscreenButtonRegistration.ROOT_TEST_TAG

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private class FakeFullscreenController(
        override val isSupported: Boolean = true,
        initial: Boolean = false,
    ) : FullscreenController {
        val changes = MutableStateFlow(initial)

        override fun isFullscreen(): Boolean = changes.value

        override fun fullscreenChanges(): Flow<Boolean> = changes.asStateFlow()

        override fun enter() {
            changes.value = true
        }

        override fun exit() {
            changes.value = false
        }
    }

    private fun str(id: Int): String = InstrumentationRegistry.getInstrumentation().targetContext.getString(id)

    // ── State: the enter affordance — flipping accessible name + a clickable node ────────────────────────

    @Test
    fun enterStateShowsEnterAffordanceAndIsClickable() {
        mount {
            FullscreenButton(
                controller = FakeFullscreenController(initial = false),
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithTag(rootTag).assertHasClickAction()
        compose.onNodeWithContentDescription(str(R.string.translation_common_fullscreen_enter)).assertIsDisplayed()
    }

    // ── State: a tap toggles fullscreen and flips the icon + accessible name to exit ────────────────────

    @Test
    fun tappingTogglesToExitAffordance() {
        mount {
            FullscreenButton(
                controller = FakeFullscreenController(initial = false),
                logger = RecordingLogger(),
            )
        }

        compose.onNodeWithTag(rootTag).performClick()
        compose.waitForIdle()

        compose.onNodeWithContentDescription(str(R.string.translation_common_fullscreen_exit)).assertIsDisplayed()
    }

    // ── Render: the stateless exit branch (deterministic, no controller) ────────────────────────────────

    @Test
    fun exitContentRendersTheExitAffordance() {
        mount {
            FullscreenButtonContent(
                isFullscreen = true,
                enterLabel = str(R.string.translation_common_fullscreen_enter),
                exitLabel = str(R.string.translation_common_fullscreen_exit),
                onToggle = {},
            )
        }

        compose.onNodeWithTag(rootTag).assertHasClickAction()
        compose.onNodeWithContentDescription(str(R.string.translation_common_fullscreen_exit)).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ─────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnostic() {
        val logger = RecordingLogger()
        mount {
            FullscreenButton(
                controller = FakeFullscreenController(initial = false),
                logger = logger,
            )
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == EVENT_VIEW_OPENED }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf(FIELD_SURFACE to FullscreenButtonRegistration.SLUG), record.fields)
    }

    private fun mount(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                content()
            }
        }
        compose.waitForIdle()
    }
}
