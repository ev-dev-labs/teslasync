package io.teslasync.android.featureviews.backendstatussection

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [BackendStatusSectionContent] across every branch
 * the web component renders (loading skeletons / content sections) plus the lifecycle states the shared feed
 * adds (hard error + retry, empty, offline "last known" + chip). Asserts the rendered strings, that the
 * header Refresh and the error Retry expose accessible click actions and invoke the callback, and that the
 * loading region + offline chip carry TalkBack labels. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection + view-model.
 */
class BackendStatusSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        BackendStatusSectionStrings(
            title = "Backend Status",
            description = "Component health, database pool, and runtime info",
            healthy = "healthy",
            componentHealth = "Component Health",
            databaseConnectionPool = "Database Connection Pool",
            systemRuntime = "System Runtime",
            noComponentsFound = "No components found",
            colStatus = "Status",
            colComponent = "Component",
            colLatency = "Latency",
            colFailures = "Failures",
            colLastCheck = "Last Check",
            maxOpen = "Max Open",
            open = "Open",
            inUse = "In Use",
            idle = "Idle",
            waitCount = "Wait Count",
            goVersion = "Go Version",
            uptime = "Uptime",
            goroutines = "Goroutines",
            osArch = "OS / Arch",
            refresh = "Refresh",
            refreshing = "Loading…",
            offline = "Offline",
            loading = "Loading…",
            emptyMessage = "No data available",
        )

    private val data =
        BackendStatusData(
            health =
                HealthSnapshot(
                    components =
                        listOf(
                            ComponentRow("database", "ok", 1.4, 0, ""),
                            ComponentRow("tesla_api", "degraded", 142.0, 3, ""),
                            ComponentRow("fleet_telemetry", "down", 0.0, 11, ""),
                        ),
                    system = SystemRuntime("go1.25", 271_440, 84),
                ),
            pool = PoolSnapshot(maxOpen = 25, open = 7, inUse = 2, idle = 5, waitCount = 0),
            version = VersionSnapshot(goVersion = "go1.25", os = "linux", arch = "amd64", uptimeSeconds = null, goroutines = null),
        )

    private fun setContent(
        state: UiState<BackendStatusData>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    BackendStatusSectionContent(
                        state = state,
                        onRefresh = onRefresh,
                        locale = Locale.US,
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsHeaderAndLabeledSkeletonRegion() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.loading).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryWithAccessibleClickAction() {
        var retried = false
        setContent(
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRefresh = { retried = true },
        )
        // QueryError resolves the server-error copy + retry affordance for a 5xx failure.
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = BackendStatusData(null, null, null)))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
    }

    @Test
    fun contentShowsBadgeTableAndAllThreeSections() {
        setContent(UiState(phase = UiPhase.Content, data = data, fetchedAt = 1_000L))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Healthy-count badge: only `database` is ok of three.
        compose.onNodeWithText("1/3 healthy").assertIsDisplayed()
        // Component Health table.
        compose.onNodeWithText(strings.componentHealth).assertIsDisplayed()
        compose.onNodeWithText("database").assertIsDisplayed()
        compose.onNodeWithText("1.4 ms").assertIsDisplayed()
        // Connection-pool tiles.
        compose.onNodeWithText(strings.databaseConnectionPool).assertIsDisplayed()
        compose.onNodeWithText(strings.maxOpen).assertIsDisplayed()
        // Runtime KVList with the version ?? system fallback chain.
        compose.onNodeWithText(strings.systemRuntime).assertIsDisplayed()
        compose.onNodeWithText("linux / amd64").assertIsDisplayed()
        compose.onNodeWithText("3d 3h 24m").assertIsDisplayed()
    }

    @Test
    fun refreshControlHasAccessibleClickActionAndRefetches() {
        var refreshed = false
        setContent(UiState(phase = UiPhase.Content, data = data, fetchedAt = 1_000L), onRefresh = { refreshed = true })
        compose.onNodeWithContentDescription(strings.refresh).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(strings.refresh).performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineShowsCachedContentAndOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data,
                fetchedAt = 1_000L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        // Cached "last known" value stays visible …
        compose.onNodeWithText("database").assertIsDisplayed()
        // … alongside the offline freshness chip (announced via its content description).
        compose.onNodeWithContentDescription(strings.offline).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}
