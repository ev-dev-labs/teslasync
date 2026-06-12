package io.teslasync.android.featureviews.incidentscard

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentListResponse
import io.teslasync.shared.core.presentation.incidents.IncidentUpdateEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant

/**
 * On-device Compose UI + accessibility verification of [IncidentsCardContent] across every state the surface
 * renders: the loading skeleton, the hard-error retry surface, the friendly empty state, the loaded card, and
 * the stale/offline cached views. Asserts the rendered strings, that the row + CTA fire their callbacks, and
 * that each interactive element exposes a TalkBack-readable action. Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure logic, this covers render + a11y. Mirrors the web spec
 * (web/src/features/system/components/status/IncidentsCard.tsx).
 */
class IncidentsCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now: Instant = Instant.parse("2026-04-04T15:00:00Z")

    private fun activeIncident(): Incident =
        Incident(
            id = 1,
            title = "Wall connector restart",
            description = "Operator-reported restart.",
            severity = "major",
            status = "investigating",
            source = "manual",
            affectedComponents = listOf("tesla", "telemetry"),
            updates =
                List(3) {
                    IncidentUpdateEntry(at = "2026-04-04T14:30:00Z", status = "investigating", message = "update")
                },
            startedAt = "2026-04-04T14:30:00Z",
            createdAt = "2026-04-04T14:30:00Z",
            updatedAt = "2026-04-04T14:45:00Z",
        )

    private fun activeResponse(): IncidentListResponse = IncidentListResponse(incidents = listOf(activeIncident()), count = 1)

    private fun setContent(
        state: UiState<IncidentListResponse>,
        actions: IncidentsCardActions = IncidentsCardActions(),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                IncidentsCardContent(state = state, actions = actions, onRetry = onRetry, now = now)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoIncidentsMessage() {
        setContent(UiState(UiPhase.Empty, data = IncidentListResponse()))
        compose.onNodeWithText("No active incidents").assertIsDisplayed()
    }

    @Test
    fun contentRendersHeaderCountAndIncidentRow() {
        setContent(UiState(UiPhase.Content, data = activeResponse()))
        compose.onNodeWithText("Active incidents").assertIsDisplayed()
        compose.onNodeWithText("1").assertIsDisplayed()
        compose.onNodeWithText("Log incident").assertIsDisplayed()
        compose.onNodeWithText("Wall connector restart").assertIsDisplayed()
        compose.onNodeWithText("investigating").assertIsDisplayed()
        compose.onNodeWithText("major").assertIsDisplayed()
        compose.onNodeWithText("Affects: tesla, telemetry").assertIsDisplayed()
        compose.onNodeWithText("30m ago", substring = true).assertIsDisplayed()
        compose.onNodeWithText("3 updates", substring = true).assertIsDisplayed()
    }

    @Test
    fun logIncidentCtaInvokesCallback() {
        var logged = false
        setContent(
            state = UiState(UiPhase.Content, data = activeResponse()),
            actions = IncidentsCardActions(onLogIncident = { logged = true }),
        )
        compose.onNodeWithText("Log incident").performClick()
        assertTrue(logged)
    }

    @Test
    fun openingARowInvokesOnOpenIncidentWithItsId() {
        var openedId = -1L
        setContent(
            state = UiState(UiPhase.Content, data = activeResponse()),
            actions = IncidentsCardActions(onOpenIncident = { openedId = it }),
        )
        compose.onNodeWithText("Wall connector restart").performClick()
        assertEquals(1L, openedId)
    }

    @Test
    fun incidentRowExposesAnAccessibleClickAction() {
        setContent(UiState(UiPhase.Content, data = activeResponse()))
        compose.onNodeWithText("Wall connector restart").assertHasClickAction()
        compose.onNodeWithText("Log incident").assertHasClickAction()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = activeResponse(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Wall connector restart").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = activeResponse(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Wall connector restart").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
