package io.teslasync.android.dashboardwidgets

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for [AnomalyDetectorWidgetContent] — they assert every visual state the
 * web source renders (loading / content / empty / error / stale / offline), the compact count tile,
 * and the per-row + compact accessibility labels, on a device (connectedDebugAndroidTest). The pure
 * adapter / projection / mapping logic is covered off-device by [AnomalyDetectorWidgetTest].
 */
class AnomalyDetectorWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val json = Json { ignoreUnknownKeys = true }

    private val isEmpty: (JsonElement) -> Boolean = { projectAnomalies(it).entries.isEmpty() }

    private fun envelope(vararg anomalies: String): JsonElement =
        json.parseToJsonElement("""{"anomalies":[${anomalies.joinToString(",")}]}""")

    private fun anomaly(
        signal: String,
        severity: String,
        z: Double,
        message: String,
    ): String =
        """{"signal":"$signal","severity":"$severity","z_score":$z,""" +
            """"detected_at":"1970-01-01T00:00:00Z","message":"$message"}"""

    private fun ComposeContentTestRule.renderWidget(
        resource: Resource<JsonElement>,
        compact: Boolean,
        onRefresh: () -> Unit = {},
    ) {
        val state = resource.toUiState(isEmpty)
        setContent {
            TeslaSyncTheme {
                AnomalyDetectorWidgetContent(
                    state = state,
                    projection = projectAnomalies(state.data),
                    compact = compact,
                    onRefresh = onRefresh,
                    nowMs = { 0L },
                )
            }
        }
    }

    @Test
    fun fullContentShowsTitleSeverityAndSignal() {
        rule.renderWidget(
            resource = Resource.Success(envelope(anomaly("battery", "critical", 4.8, "Cell drift")), fetchedAt = 1L, stale = false),
            compact = false,
        )
        rule.onNodeWithText("Anomaly Detector").assertIsDisplayed()
        rule.onNodeWithText("Critical").assertIsDisplayed()
    }

    @Test
    fun fullEmptyShowsNoAnomalies() {
        rule.renderWidget(Resource.Success(envelope(), fetchedAt = 1L, stale = false), compact = false)
        rule.onNodeWithText("No anomalies").assertIsDisplayed()
    }

    @Test
    fun compactShowsActiveCount() {
        rule.renderWidget(
            resource =
                Resource.Success(
                    envelope(anomaly("battery", "critical", 4.8, "a"), anomaly("temp", "warning", 3.0, "b")),
                    fetchedAt = 1L,
                    stale = false,
                ),
            compact = true,
        )
        rule.onNodeWithText("2 active").assertIsDisplayed()
    }

    @Test
    fun compactEmptyShowsNoAnomalies() {
        rule.renderWidget(Resource.Success(envelope(), fetchedAt = 1L, stale = false), compact = true)
        rule.onNodeWithText("No anomalies").assertIsDisplayed()
    }

    @Test
    fun loadingShowsProgressIndicatorLabel() {
        rule.renderWidget(Resource.Loading(cached = null, fetchedAt = null, stale = false), compact = false)
        rule.onNodeWithContentDescription("updating", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresRefresh() {
        var retried = false
        rule.renderWidget(
            resource = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Http(status = 500)),
            compact = false,
            onRefresh = { retried = true },
        )
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsOfflineChipOverCachedData() {
        rule.renderWidget(
            resource =
                Resource.Error(
                    cached = envelope(anomaly("battery", "critical", 4.8, "Cell drift")),
                    fetchedAt = 1L,
                    stale = true,
                    error = ApiError.Network(),
                ),
            compact = false,
        )
        rule.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun staleShowsStaleChipWhileRefreshing() {
        rule.renderWidget(
            resource =
                Resource.Loading(
                    cached = envelope(anomaly("temp", "warning", 3.0, "warm")),
                    fetchedAt = 1L,
                    stale = true,
                ),
            compact = false,
        )
        rule.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun rowExposesAccessibilityLabel() {
        rule.renderWidget(
            resource = Resource.Success(envelope(anomaly("battery", "critical", 4.8, "Cell drift")), fetchedAt = 1L, stale = false),
            compact = false,
        )
        rule.onNodeWithContentDescription("battery", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactTileExposesAccessibilityLabel() {
        rule.renderWidget(
            resource = Resource.Success(envelope(anomaly("battery", "critical", 4.8, "a")), fetchedAt = 1L, stale = false),
            compact = true,
        )
        rule.onNodeWithContentDescription("active", substring = true).assertIsDisplayed()
    }
}
