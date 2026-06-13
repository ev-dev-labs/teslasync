package io.teslasync.android.sharedsurfaces.scrollrestoration

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodes
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of the ScrollRestoration shared surface across the
 * states the web component reproduces (web/src/components/layout/ScrollRestoration.tsx): a PUSH navigation
 * resets the scroll container to the top, a POP restores the previously saved offset, and scrolling persists
 * the current offset under the location key. It also asserts the only thing that matters for a non-visual
 * controller surface — that mounting it contributes NO announceable node, so a screen-reader user is never
 * presented with a phantom control — and that the one-shot `view.opened` diagnostic fires. The offline
 * `testReleaseUnitTest` gate covers the pure decisions; this runs under `connectedAndroidTest`.
 */
class ScrollRestorationUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
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

    private val hasContentDescription =
        SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription)
    private val hasText = SemanticsMatcher.keyIsDefined(SemanticsProperties.Text)

    @Composable
    private fun TallScrollHost(
        scrollState: ScrollState,
        tag: String,
    ) {
        Column(
            modifier =
                Modifier
                    .testTag(tag)
                    .fillMaxWidth()
                    .height(HOST_HEIGHT_DP.dp)
                    .verticalScroll(scrollState),
        ) {
            for (index in 0 until ROW_COUNT) {
                Text(
                    text = index.toString(),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .height(ROW_HEIGHT_DP.dp)
                            .padding(ROW_PADDING_DP.dp),
                )
            }
        }
    }

    @Test
    fun pushResetsScrollToTopEvenWithASavedOffset() {
        val key = ScrollRestorationProjection.keyFor("dashboard", "")
        val store = ScrollPositionStore().apply { save(key, LARGE_OFFSET) }
        lateinit var scrollState: ScrollState

        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                scrollState = rememberScrollState()
                TallScrollHost(scrollState, HOST_TAG)
                ScrollRestoration(
                    routeKey = key,
                    navigationType = NavigationType.Push,
                    scrollState = scrollState,
                    store = store,
                    logger = NoopLogger,
                )
            }
        }
        compose.waitForIdle()

        compose.runOnIdle {
            assertEquals("a fresh PUSH starts at the top", 0, scrollState.value)
        }
    }

    @Test
    fun popRestoresThePreviouslySavedOffset() {
        val key = ScrollRestorationProjection.keyFor("dashboard", "")
        val store = ScrollPositionStore().apply { save(key, LARGE_OFFSET) }
        lateinit var scrollState: ScrollState

        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                scrollState = rememberScrollState()
                TallScrollHost(scrollState, HOST_TAG)
                ScrollRestoration(
                    routeKey = key,
                    navigationType = NavigationType.Pop,
                    scrollState = scrollState,
                    store = store,
                    logger = NoopLogger,
                )
            }
        }
        compose.waitForIdle()

        compose.runOnIdle {
            assertTrue("a POP restores the saved scroll offset", scrollState.value > 0)
        }
    }

    @Test
    fun scrollingPersistsTheOffsetUnderTheLocationKey() {
        val key = ScrollRestorationProjection.keyFor("vehicles", "")
        val store = ScrollPositionStore()
        lateinit var scrollState: ScrollState

        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                scrollState = rememberScrollState()
                TallScrollHost(scrollState, HOST_TAG)
                ScrollRestoration(
                    routeKey = key,
                    navigationType = NavigationType.Push,
                    scrollState = scrollState,
                    store = store,
                    logger = NoopLogger,
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(HOST_TAG).performTouchInput { swipeUp() }
        compose.waitForIdle()

        compose.runOnIdle {
            val saved = store.restore(key)
            assertTrue("scrolling persists a non-null offset", saved != null)
            assertTrue("the persisted offset reflects the scroll", (saved ?: 0) > 0)
        }
    }

    @Test
    fun mountingTheControllerContributesNoAnnounceableNode() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScrollRestoration(
                    routeKey = ScrollRestorationProjection.keyFor("dashboard", ""),
                    navigationType = NavigationType.Push,
                    scrollState = ScrollState(0),
                    store = ScrollPositionStore(),
                    logger = NoopLogger,
                )
            }
        }
        compose.waitForIdle()

        // A non-visual controller must add nothing for assistive tech to land on.
        compose.onAllNodes(hasContentDescription).assertCountEquals(0)
        compose.onAllNodes(hasText).assertCountEquals(0)
    }

    @Test
    fun mountingEmitsTheViewOpenedDiagnostic() {
        val logger = RecordingLogger()

        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScrollRestoration(
                    routeKey = ScrollRestorationProjection.keyFor("dashboard", ""),
                    navigationType = NavigationType.Push,
                    scrollState = ScrollState(0),
                    store = ScrollPositionStore(),
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ScrollRestoration"), opened.single().second)
    }

    private companion object {
        const val HOST_TAG = "scroll-restoration-host"
        const val HOST_HEIGHT_DP = 150
        const val ROW_COUNT = 40
        const val ROW_HEIGHT_DP = 48
        const val ROW_PADDING_DP = 12
        const val LARGE_OFFSET = 100_000
    }
}
