package io.teslasync.android.dashboard.widgets.tirepressurevisual

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [TirePressureVisualWidgetContent] across every state
 * the web component renders (loading skeleton, content diagram + per-corner values + status badge, empty,
 * hard error with retry, stale/offline cached). Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present, and that the refresh/retry control fires. Runs under `connectedAndroidTest` (a
 * device/emulator) — the offline gate's `testReleaseUnitTest` covers the projection/state logic; this
 * covers the render.
 */
class TirePressureVisualWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val formatter = UnitFormatter.default()

    private fun tires(
        fl: Double,
        fr: Double,
        rl: Double,
        rr: Double,
    ): JsonElement =
        buildJsonObject {
            put("front_left", fl)
            put("front_right", fr)
            put("rear_left", rl)
            put("rear_right", rr)
        }

    private fun setWidget(
        state: UiState<JsonElement>,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                TirePressureVisualWidgetContent(state = state, formatter = formatter, onRefresh = onRefresh)
            }
        }
    }

    private fun normalState(): UiState<JsonElement> = UiState(phase = UiPhase.Content, data = tires(2.5, 2.6, 2.7, 2.8), fetchedAt = 1L)

    @Test
    fun loadingShowsSkeletonNotContent() {
        setWidget(UiState.loading())
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        compose.onNodeWithText("Tire Pressure").assertDoesNotExist()
        compose.onNodeWithText("No tire pressure data").assertDoesNotExist()
    }

    @Test
    fun contentShowsCornersAndAllNormalBadge() {
        setWidget(normalState())
        compose.onNodeWithText("FL").assertIsDisplayed()
        compose.onNodeWithText("FR").assertIsDisplayed()
        compose.onNodeWithText("RL").assertIsDisplayed()
        compose.onNodeWithText("RR").assertIsDisplayed()
        compose.onNodeWithText("All Normal").assertIsDisplayed()
    }

    @Test
    fun headerExposesTitleAndRefreshAccessibility() {
        setWidget(normalState())
        compose.onNodeWithText("Tire Pressure").assertIsDisplayed()
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun warningSnapshotShowsCheckPressureBadge() {
        setWidget(UiState(phase = UiPhase.Content, data = tires(2.5, 2.1, 3.2, 2.6), fetchedAt = 1L))
        compose.onNodeWithText("Check Pressure").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoTireData() {
        setWidget(UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L))
        compose.onNodeWithText("No tire pressure data").assertIsDisplayed()
        compose.onNodeWithText("FL").assertDoesNotExist()
    }

    @Test
    fun errorShowsQueryErrorWithWorkingRetry() {
        var retried = false
        setWidget(
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedDiagramVisible() {
        setWidget(
            UiState(
                phase = UiPhase.Content,
                data = tires(2.5, 2.6, 2.7, 2.8),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("FL").assertIsDisplayed()
        compose.onNodeWithText("All Normal").assertIsDisplayed()
    }
}
