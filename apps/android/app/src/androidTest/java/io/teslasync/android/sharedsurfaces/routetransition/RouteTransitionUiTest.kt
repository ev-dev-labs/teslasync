package io.teslasync.android.sharedsurfaces.routetransition

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the RouteTransition surface across every state the web
 * component plays (web/src/components/motion/RouteTransition.tsx): the current page body renders, a navigation
 * swaps the rendered route (the cross-fade), a list↔detail navigation still lands on its target (the skipped,
 * instant swap), the location-binding overload keys by pathname, the one-shot PII-safe `view.opened` diagnostic
 * fires once carrying only the surface slug, and the wrapped page's label stays reachable to TalkBack (the
 * wrapper is semantically transparent). Forces [LocalReducedMotion] = true so each navigation settles instantly
 * and assertions never wait on a real animation. Runs under `connectedAndroidTest`; the `testReleaseUnitTest`
 * gate covers the pure projection + diagnostics logic.
 */
class RouteTransitionUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── the current route's page body renders ─────────────────────────────────────────────────────────────────

    @Test
    fun rendersTheCurrentRoutePageBody() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    RouteTransition(routeKey = DASHBOARD, logger = RecordingLogger()) { route -> BodyText(route) }
                }
            }
        }

        compose.onNodeWithText(DASHBOARD).assertIsDisplayed()
    }

    // ── a navigation swaps the rendered route (the cross-fade); the outgoing page leaves ──────────────────────

    @Test
    fun navigatingSwapsTheRenderedRoute() {
        var route by mutableStateOf(DASHBOARD)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    RouteTransition(routeKey = route, logger = RecordingLogger()) { current -> BodyText(current) }
                }
            }
        }

        compose.onNodeWithText(DASHBOARD).assertIsDisplayed()

        compose.runOnIdle { route = ANALYTICS }
        compose.waitForIdle()

        compose.onNodeWithText(ANALYTICS).assertIsDisplayed()
        compose.onAllNodesWithText(DASHBOARD).assertCountEquals(0)
    }

    // ── a list↔detail navigation skips the fade yet still lands on the detail page (instant swap) ─────────────

    @Test
    fun listDetailNavigationStillRendersTheTarget() {
        var route by mutableStateOf(DRIVES_LIST)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    RouteTransition(routeKey = route, logger = RecordingLogger()) { current -> BodyText(current) }
                }
            }
        }

        compose.runOnIdle { route = DRIVE_DETAIL }
        compose.waitForIdle()

        compose.onNodeWithText(DRIVE_DETAIL).assertIsDisplayed()
    }

    // ── the location-binding overload keys by pathname — the page renders for the supplied location ───────────

    @Test
    fun locationBindingOverloadRendersThePathname() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    RouteTransition(pathname = DASHBOARD, search = "?tab=range", logger = RecordingLogger()) { route ->
                        BodyText(route)
                    }
                }
            }
        }

        compose.onNodeWithText(DASHBOARD).assertIsDisplayed()
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ──────────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    RouteTransition(routeKey = DASHBOARD, logger = logger) { route -> BodyText(route) }
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("RouteTransition", opened.single().fields["surface"])
        assertEquals(setOf("surface"), opened.single().fields.keys)
    }

    // ── accessibility: the wrapper is transparent — the wrapped page's label stays reachable to TalkBack ──────

    @Test
    fun wrappedPageLabelIsReachableToAccessibility() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    RouteTransition(routeKey = SETTINGS, logger = RecordingLogger()) { _ -> BodyText(PAGE_LABEL) }
                }
            }
        }

        compose.onNodeWithText(PAGE_LABEL).assertIsDisplayed()
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        private const val DASHBOARD = "/dashboard"
        private const val ANALYTICS = "/analytics"
        private const val DRIVES_LIST = "/drives"
        private const val DRIVE_DETAIL = "/drives/123"
        private const val SETTINGS = "/settings"
        private const val PAGE_LABEL = "Battery health summary"
    }
}
