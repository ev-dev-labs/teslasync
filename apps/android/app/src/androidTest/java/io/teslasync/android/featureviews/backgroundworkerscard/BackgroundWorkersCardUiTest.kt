package io.teslasync.android.featureviews.backgroundworkerscard

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [BackgroundWorkersCardContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state (with the
 * title header still visible — never a blank box), the populated panel (summary grid, grouped instance rows,
 * scale-hint callout, API-logs link), and the stale/offline cached views. Asserts the rendered i18n strings and
 * the TalkBack content descriptions (the accessible loading label, the per-dot status descriptions, the offline
 * freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y.
 * Mirrors the web spec (web/src/features/system/components/status/__tests__/BackgroundWorkersCard.test.tsx).
 */
class BackgroundWorkersCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun row(
        name: String,
        host: String,
        status: WorkerInstanceStatus = WorkerInstanceStatus.Healthy,
        latencyMs: Double? = 12.0,
        error: String? = null,
    ) = WorkerInstance(name = name, host = host, status = status, latencyMs = latencyMs, error = error)

    private fun singleInstance() =
        WorkersHealthData(
            listOf(
                row("notification-worker", "http://notification-worker:8081/healthz"),
                row("export-worker", "http://export-worker:8082/healthz"),
                row("automation-worker", "http://automation-worker:8083/healthz"),
            ),
        )

    private fun scaled() =
        WorkersHealthData(
            listOf(
                row("notification-worker", "http://nw-1:8081/healthz", latencyMs = 8.0),
                row("notification-worker", "http://nw-2:8081/healthz", latencyMs = 14.0),
                row("notification-worker", "http://nw-3:8081/healthz", latencyMs = 9.0),
                row("export-worker", "http://export-worker:8082/healthz"),
                row("automation-worker", "http://automation-worker:8083/healthz"),
            ),
        )

    private fun setContent(
        state: UiState<WorkersHealthData>,
        onRetry: () -> Unit = {},
        onOpenApiLogs: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BackgroundWorkersCardContent(
                    state = state,
                    onRetry = onRetry,
                    onOpenApiLogs = onOpenApiLogs,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
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
    fun emptyShowsTitleHeaderAndFriendlyNoWorkersMessage() {
        setContent(UiState(UiPhase.Empty))
        // The title header still renders (never a blank box) …
        compose.onNodeWithText("Background workers").assertIsDisplayed()
        // … above the friendly empty message.
        compose.onNodeWithText("No background workers reporting", substring = true).assertIsDisplayed()
    }

    @Test
    fun singleInstanceRendersNamesSummaryShortHostsAndScaleHint() {
        setContent(UiState(UiPhase.Content, data = singleInstance()))

        compose.onNodeWithText("notification-worker").assertIsDisplayed()
        compose.onNodeWithText("export-worker").assertIsDisplayed()
        compose.onNodeWithText("automation-worker").assertIsDisplayed()

        // Top-line summary uses the unique "of" phrasing so it never collides with the "/" rollup chips.
        compose.onNodeWithText("3 of 3 types").assertIsDisplayed()
        compose.onNodeWithText("3 of 3 instances").assertIsDisplayed()

        // Three groups, each marked "1 instance".
        compose.onAllNodesWithText("1 instance").assertCountEquals(3)

        // Hosts are rendered short (no scheme prefix, no /healthz suffix).
        compose.onNodeWithText("notification-worker:8081").assertIsDisplayed()
        compose.onNodeWithText("export-worker:8082").assertIsDisplayed()
        compose.onNodeWithText("automation-worker:8083").assertIsDisplayed()

        // The "set *_HOSTS to scale" callout is shown when no group is replicated.
        compose.onNodeWithText("Running multiple instances of a worker", substring = true).assertIsDisplayed()
    }

    @Test
    fun scaledGroupsInstancesRendersRollupAndHidesScaleHint() {
        setContent(UiState(UiPhase.Content, data = scaled()))

        // Each replica's host renders as a separate row.
        compose.onNodeWithText("nw-1:8081").assertIsDisplayed()
        compose.onNodeWithText("nw-2:8081").assertIsDisplayed()
        compose.onNodeWithText("nw-3:8081").assertIsDisplayed()

        // The notification group shows "3 instances" and a "3 / 3 healthy" rollup chip.
        compose.onNodeWithText("3 instances").assertIsDisplayed()
        compose.onNodeWithText("3 / 3 healthy").assertIsDisplayed()

        // Top-line summary + replicated count.
        compose.onNodeWithText("5 of 5 instances").assertIsDisplayed()
        compose.onNodeWithText("1 of 3 types").assertIsDisplayed()

        // The scale callout is hidden once at least one group is replicated.
        compose.onNodeWithText("Running multiple instances of a worker", substring = true).assertDoesNotExist()
    }

    @Test
    fun escalatesTheGroupRollupToDegradedWhenOneInstanceIsUnhealthy() {
        setContent(
            UiState(
                UiPhase.Content,
                data =
                    WorkersHealthData(
                        listOf(
                            row("notification-worker", "http://nw-1:8081/healthz", WorkerInstanceStatus.Healthy),
                            row("notification-worker", "http://nw-2:8081/healthz", WorkerInstanceStatus.Unhealthy),
                        ),
                    ),
            ),
        )
        compose.onNodeWithText("1 / 2 healthy").assertIsDisplayed()
        compose.onNodeWithText("unhealthy").assertIsDisplayed()
    }

    @Test
    fun showsTheDownSeverityWhenEveryInstanceIsDown() {
        setContent(
            UiState(
                UiPhase.Content,
                data =
                    WorkersHealthData(
                        listOf(
                            row("export-worker", "http://e1:8082/healthz", WorkerInstanceStatus.Down),
                            row("export-worker", "http://e2:8082/healthz", WorkerInstanceStatus.Down),
                        ),
                    ),
            ),
        )
        compose.onNodeWithText("0 / 2 healthy").assertIsDisplayed()
        // Both per-instance chips read "down".
        compose.onAllNodesWithText("down").assertCountEquals(2)
    }

    @Test
    fun rendersThePerInstanceErrorMessageWhenAProbeFails() {
        setContent(
            UiState(
                UiPhase.Content,
                data =
                    WorkersHealthData(
                        listOf(
                            row(
                                "automation-worker",
                                "http://aw-1:8083/healthz",
                                WorkerInstanceStatus.Down,
                                latencyMs = null,
                                error = "dial tcp: connection refused",
                            ),
                        ),
                    ),
            ),
        )
        compose.onNodeWithText("dial tcp: connection refused", substring = true).assertIsDisplayed()
    }

    @Test
    fun rendersLatencyAndFallsBackToEmDashForMissingValues() {
        setContent(
            UiState(
                UiPhase.Content,
                data =
                    WorkersHealthData(
                        listOf(
                            row("notification-worker", "http://nw-1:8081/healthz", latencyMs = 23.0),
                            row("export-worker", "http://export-worker:8082/healthz", latencyMs = null),
                        ),
                    ),
            ),
        )
        compose.onNodeWithText("23 ms").assertIsDisplayed()
        // The em-dash placeholder appears once, for the missing-latency row.
        compose.onAllNodesWithText("\u2014").assertCountEquals(1)
    }

    @Test
    fun apiLogsFooterLinkInvokesTheCallback() {
        var opened = false
        setContent(state = UiState(UiPhase.Content, data = singleInstance()), onOpenApiLogs = { opened = true })
        compose.onNodeWithText("API logs").performClick()
        assertTrue(opened)
    }

    @Test
    fun offlineShowsCachedPanelWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = singleInstance(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Background workers").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = singleInstance(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Background workers").assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun statusDotsExposeGroupAndInstanceAccessibilityLabels() {
        setContent(UiState(UiPhase.Content, data = singleInstance()))
        // The group-header dot carries the combined "{name} status: {severity}" TalkBack label.
        compose.onNodeWithContentDescription("automation-worker status: all healthy").assertExists()
        // Each healthy instance dot carries the per-instance status label (three healthy instances).
        compose.onAllNodesWithContentDescription("instance status: healthy").assertCountEquals(3)
    }
}
