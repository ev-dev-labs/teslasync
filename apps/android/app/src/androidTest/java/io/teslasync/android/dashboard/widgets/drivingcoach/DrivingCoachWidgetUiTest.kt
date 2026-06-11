package io.teslasync.android.dashboard.widgets.drivingcoach

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DrivingCoachWidgetContent] across every state the
 * web component renders (loading skeleton, empty, hard error + retry, full score header + tip, compact
 * score hero, compact inline empty, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest` (a device/emulator) — the
 * offline gate's `testReleaseUnitTest` covers the logic; this covers the render.
 */
class DrivingCoachWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fixedNow = 1_780_000_000_000L

    private fun fullReport(): DrivingCoachReport =
        DrivingCoachReport.fromJson(
            buildJsonObject {
                put("overall_score", 87)
                put("efficiency_wh_km", 160)
                put("best_efficiency_wh_km", 140)
                put(
                    "recommendations",
                    buildJsonArray {
                        add(
                            buildJsonObject {
                                put("category", "Highway speed")
                                put("tip", "Slow down on highways")
                                put("impact", "high")
                            },
                        )
                    },
                )
            },
        )

    private fun noTipsReport(): DrivingCoachReport =
        DrivingCoachReport.fromJson(
            buildJsonObject {
                put("overall_score", 92)
                put("efficiency_wh_km", 150)
                put("best_efficiency_wh_km", 150)
            },
        )

    private fun setContent(
        state: UiState<DrivingCoachReport>,
        size: DrivingCoachSize = DrivingCoachRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DrivingCoachWidgetContent(
                    state = state,
                    size = size,
                    onRefresh = onRefresh,
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
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = DrivingCoachReport.Empty, fetchedAt = fixedNow))
        compose.onNodeWithText("No tips available").assertIsDisplayed()
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
    fun fullBodyShowsScoreSavingsBadgeAndTip() {
        setContent(UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow))
        compose.onNodeWithText("87").assertIsDisplayed()
        compose.onNodeWithText("/ 100").assertIsDisplayed()
        compose.onNodeWithText("Potential savings: 13%").assertIsDisplayed()
        // Tip card folds its title/impact/detail into one TalkBack phrase.
        compose.onNodeWithContentDescription("Highway speed", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesFoldedAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow),
            size = DrivingCoachSize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("87", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactInlineEmptyShownWhenNoSavingsAndNoTips() {
        setContent(
            state = UiState(UiPhase.Content, data = noTipsReport(), fetchedAt = fixedNow),
            size = DrivingCoachSize(cols = 1, rows = 2),
        )
        // The compact hero folds the inline empty into its accessible name.
        compose.onNodeWithContentDescription("No tips available", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                UiPhase.Content,
                data = fullReport(),
                fetchedAt = fixedNow,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached score stays visible (never blanked) when offline/stale.
        compose.onNodeWithText("87").assertIsDisplayed()
    }

    @Test
    fun contentHeaderExposesRefreshAction() {
        setContent(UiState(UiPhase.Content, data = fullReport(), fetchedAt = fixedNow))
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }
}
