package io.teslasync.android.sharedsurfaces.routeplayback

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [RoutePlayback] surface — the parity port of the web `RoutePlayback`
 * (web/src/components/maps/RoutePlayback.tsx). Covers what the offline model/ViewModel tests cannot: each
 * map-free chrome state (loading skeleton / empty / hard error / offline) renders its expected, localized
 * surface; the retry affordances expose TalkBack labels; and the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) fires on mount. The interactive live-map content branch is delegated to the shared atomic widget
 * (covered by the P3 component-library bundle); these tests drive the surface chrome the shared surface owns.
 */
class RoutePlaybackUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: loading → skeleton chrome with a TalkBack "Loading" landmark ───────────────────────────────

    @Test
    fun loadingRendersSkeletonChrome() {
        mountContent(RoutePlaybackState.loading())

        compose.onNodeWithContentDescription(STRINGS.loadingLabel).assertExists()
    }

    // ── State: empty → the friendly localized "no GPS points" line, never a blank box ─────────────────────

    @Test
    fun emptyRendersTheFriendlyLocalizedMessage() {
        mountContent(RoutePlaybackState(phase = UiPhase.Empty, track = RoutePlaybackTrack.EMPTY))

        compose.onNodeWithText(STRINGS.emptyMessage).assertExists().assertIsDisplayed()
    }

    // ── State: hard error → the shared QueryError with a retry affordance ─────────────────────────────────

    @Test
    fun hardErrorRendersQueryErrorWithRetry() {
        mountContent(
            RoutePlaybackState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = SERVER_ERROR),
        )

        // A 5xx folds to the shared "Server error" QueryError landmark + a Retry button.
        compose.onNodeWithContentDescription(SERVER_ERROR_TITLE).assertExists()
        compose.onNodeWithText(STRINGS.retryLabel).assertExists()
    }

    // ── State: offline (stale) → an Offline pill + retry over the still-friendly empty body ───────────────

    @Test
    fun offlineRendersTheOfflinePillRetryAndBody() {
        mountContent(
            RoutePlaybackState(
                phase = UiPhase.Empty,
                track = RoutePlaybackTrack.EMPTY,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )

        compose.onNodeWithText(STRINGS.offlineLabel).assertExists()
        compose.onNodeWithText(STRINGS.retryLabel).assertExists()
        compose.onNodeWithText(STRINGS.emptyMessage).assertExists()
    }

    // ── Accessibility: the retry affordance is a single labelled, interactive node ────────────────────────

    @Test
    fun theRetryAffordanceExposesExactlyOneLabelledNode() {
        mountContent(
            RoutePlaybackState(
                phase = UiPhase.Empty,
                track = RoutePlaybackTrack.EMPTY,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )

        compose.onAllNodesWithText(STRINGS.retryLabel).assertCountEquals(1)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires once on mount ───────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RoutePlayback(
                    viewModel = RoutePlaybackViewModel(staticRoutePlaybackSource(RoutePlaybackTrack.EMPTY), logger),
                )
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        val record = opened.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "RoutePlayback"), record.fields)
    }

    private fun mountContent(state: RoutePlaybackState) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RoutePlaybackContent(state = state, strings = STRINGS)
            }
        }
        compose.waitForIdle()
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
        const val SERVER_ERROR = 503
        const val SERVER_ERROR_TITLE = "Server error"

        // Deterministic labels passed straight to the stateless content so the assertions are locale-stable;
        // the stateful entry point resolves the real P1/S10 catalog keys (verified by the diagnostics mount).
        val STRINGS =
            RoutePlaybackStrings(
                emptyMessage = "No GPS points to replay for this route.",
                mapLabel = "Route playback map",
                resourceName = "Route playback map",
                summaryLabel = "Route",
                startLabel = "Start",
                endLabel = "End",
                offlineLabel = "Offline",
                loadingLabel = "Loading",
                retryLabel = "Retry",
            )
    }
}
