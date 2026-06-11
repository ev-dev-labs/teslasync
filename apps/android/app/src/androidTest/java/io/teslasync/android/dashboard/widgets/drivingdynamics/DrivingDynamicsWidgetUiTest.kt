package io.teslasync.android.dashboard.widgets.drivingdynamics

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DrivingDynamicsWidgetContent] across every state
 * the web component renders (loading skeleton, empty "No dynamics data", hard error + retry, the
 * standard three-gauge view + severity badge, the wide view + histogram, the compact max-g hero, and a
 * stale/offline cached view). Asserts the rendered i18n strings + the TalkBack content descriptions are
 * present. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the logic,
 * this covers the render.
 */
class DrivingDynamicsWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun dynamics(): JsonElement =
        buildJsonObject {
            put("max_acceleration_g", 0.32)
            put("max_braking_g", 0.28)
            put("max_cornering_g", 0.21)
            put("avg_acceleration_g", 0.18)
            put("avg_braking_g", 0.12)
            put("smoothness_score", 78.0)
        }

    private fun distribution(): JsonElement =
        buildJsonObject {
            put(
                "values",
                buildJsonArray {
                    add(3.0)
                    add(8.0)
                    add(14.0)
                    add(9.0)
                },
            )
        }

    private fun bundle(): DrivingDynamicsBundle = DrivingDynamicsBundle(dynamics(), distribution())

    private fun setContent(
        state: UiState<DrivingDynamicsBundle>,
        size: DrivingDynamicsSize = DrivingDynamicsRegistration.DEFAULT_SIZE,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DrivingDynamicsWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoDynamicsDataMessage() {
        setContent(UiState(UiPhase.Empty, data = DrivingDynamicsBundle(JsonNull, null), fetchedAt = 1L))
        compose.onNodeWithText("No dynamics data").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardShowsTitleGaugesAndSeverityBadge() {
        setContent(UiState(UiPhase.Content, data = bundle(), fetchedAt = 1L))
        compose.onNodeWithText("Driving Dynamics").assertIsDisplayed()
        // Each radial gauge exposes one folded TalkBack phrase "<label>: <value>".
        compose.onNodeWithContentDescription("Accel: 0.18").assertIsDisplayed()
        compose.onNodeWithContentDescription("Brake: 0.12").assertIsDisplayed()
        compose.onNodeWithContentDescription("Lateral: 0.21").assertIsDisplayed()
        // Severity badge — avg (0.18+0.12)/2 = 0.15 → Normal → success-half word "Smooth".
        compose.onNodeWithText("Smooth").assertIsDisplayed()
    }

    @Test
    fun standardHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = bundle(), fetchedAt = 1L))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideShowsHistogramLabel() {
        setContent(
            state = UiState(UiPhase.Content, data = bundle(), fetchedAt = 1L),
            size = DrivingDynamicsSize(cols = 4, rows = 6),
        )
        compose.onNodeWithText("G-Force Distribution").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = bundle(), fetchedAt = 1L),
            size = DrivingDynamicsSize(cols = 1, rows = 2),
        )
        // maxG = max(0.32, 0.28, 0.21) = 0.32 (< 0.4 → Smooth).
        compose.onNodeWithContentDescription("Max g 0.32, Smooth").assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedGaugesVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = bundle(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached gauges stay visible (never blanked) when offline/stale.
        compose.onNodeWithContentDescription("Accel: 0.18").assertIsDisplayed()
    }
}
