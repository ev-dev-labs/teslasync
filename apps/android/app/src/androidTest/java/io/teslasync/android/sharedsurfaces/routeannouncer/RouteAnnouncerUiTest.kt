package io.teslasync.android.sharedsurfaces.routeannouncer

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionContains
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of the RouteAnnouncer shared surface across the states
 * the web component renders (web/src/components/a11y/RouteAnnouncer.tsx): the silent region (pre-first-route /
 * blank title) and an announced route title. It also asserts the only thing that matters for a screen-reader
 * surface — that the node is a POLITE live region and exposes its announcement as its accessibility label —
 * and exercises the stateful flow end-to-end: the first route is suppressed, a subsequent navigation is
 * announced. The offline `testReleaseUnitTest` gate covers the pure reduction; this runs under
 * `connectedAndroidTest`.
 */
class RouteAnnouncerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private val politeLiveRegion =
        SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)

    @Test
    fun announcedMessageExposesAPoliteLiveRegionLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RouteAnnouncerContent(message = "Dashboard")
            }
        }

        compose
            .onNodeWithTag(ROUTE_ANNOUNCER_TEST_TAG)
            .assertExists()
            .assert(politeLiveRegion)
            .assertContentDescriptionContains("Dashboard", substring = true)
    }

    @Test
    fun emptyMessageRendersASilentLiveRegion() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RouteAnnouncerContent(message = "")
            }
        }

        compose
            .onNodeWithTag(ROUTE_ANNOUNCER_TEST_TAG)
            .assertExists()
            .assert(politeLiveRegion)
            .assertContentDescriptionEquals("")
    }

    @Test
    fun firstRouteIsSuppressedThenLaterRouteIsAnnounced() {
        val routeKey = mutableStateOf("dashboard")
        val title = mutableStateOf("Dashboard")

        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RouteAnnouncer(
                    routeKey = routeKey.value,
                    title = title.value,
                    delayMs = 0L,
                    logger = NoopLogger,
                )
            }
        }

        // The first observed route primes the announcer but speaks nothing (web `firstRender`).
        compose
            .onNodeWithTag(ROUTE_ANNOUNCER_TEST_TAG)
            .assert(politeLiveRegion)
            .assertContentDescriptionEquals("")

        // Navigating to a new route announces the new screen's title.
        compose.runOnIdle {
            routeKey.value = "vehicles"
            title.value = "Vehicles"
        }
        compose.waitForIdle()

        compose
            .onNodeWithTag(ROUTE_ANNOUNCER_TEST_TAG)
            .assertContentDescriptionContains("Vehicles", substring = true)
    }
}
