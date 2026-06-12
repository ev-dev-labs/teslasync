package io.teslasync.android.featureviews.automationcard

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [AutomationCardContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the populated
 * card (name, status badge, vehicle, stats), the firing indicator, the auto-disabled reason + conflict
 * banners, and the stale/offline cached view. Also exercises the interactive contract — the accessible toggle
 * (enable vs re-enable), the actions menu (Test Run), and the delete confirmation flow. Mirrors the web spec
 * (web/src/features/automations/pages/AutomationCard.tsx).
 */
class AutomationCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Suppress("LongParameterList") // test data builder; production AutomationView is a data class
    private fun automation(
        id: Long = 1,
        name: String = "Precondition before commute",
        description: String? = "Warm the cabin on weekday mornings",
        enabled: Boolean = true,
        vehicleId: Long? = null,
        lastTriggeredAt: String? = null,
        executionCount: Long = 142,
        failureCount: Long = 0,
        autoDisabled: Boolean = false,
        autoDisabledReason: String? = null,
        nextFireTime: String? = null,
        conflicts: List<AutomationConflictView> = emptyList(),
    ): AutomationView =
        AutomationView(
            id = id,
            name = name,
            description = description,
            enabled = enabled,
            vehicleId = vehicleId,
            lastTriggeredAt = lastTriggeredAt,
            executionCount = executionCount,
            failureCount = failureCount,
            autoDisabled = autoDisabled,
            autoDisabledReason = autoDisabledReason,
            nextFireTime = nextFireTime,
            conflicts = conflicts,
        )

    private fun setContent(
        state: UiState<AutomationView>,
        isFiring: Boolean = false,
        vehicleName: String? = null,
        onToggle: (Long, Boolean) -> Unit = { _, _ -> },
        onReEnable: (Long) -> Unit = {},
        onDelete: (Long) -> Unit = {},
        onTestRun: (Long) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AutomationCardContent(
                    state = state,
                    onToggle = onToggle,
                    onReEnable = onReEnable,
                    onDelete = onDelete,
                    onTestRun = onTestRun,
                    onRetry = onRetry,
                    isFiring = isFiring,
                    vehicleName = vehicleName,
                    zone = ZoneId.of("UTC"),
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
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersNameStatusVehicleAndRuns() {
        setContent(UiState(UiPhase.Content, data = automation(name = "Nightly charge")))
        compose.onNodeWithText("Nightly charge").assertIsDisplayed()
        compose.onNodeWithText("Active").assertIsDisplayed()
        compose.onNodeWithText("All vehicles").assertIsDisplayed()
        compose.onNodeWithText("Runs: 142", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentWithVehicleNameRendersItInsteadOfAllVehicles() {
        setContent(UiState(UiPhase.Content, data = automation()), vehicleName = "Model 3")
        compose.onNodeWithText("Model 3").assertIsDisplayed()
    }

    @Test
    fun firingShowsThePulsingIndicator() {
        setContent(UiState(UiPhase.Content, data = automation()), isFiring = true)
        compose.onNodeWithText("Firing").assertIsDisplayed()
    }

    @Test
    fun toggleExposesAccessibleLabelAndInvokesOnToggle() {
        var toggledId = -1L
        var toggledTo = true
        setContent(
            state = UiState(UiPhase.Content, data = automation(id = 5, enabled = true)),
            onToggle = { id, enabled ->
                toggledId = id
                toggledTo = enabled
            },
        )
        compose.onNodeWithContentDescription("Toggle automation").assertIsDisplayed()
        compose.onNodeWithContentDescription("Toggle automation").performClick()
        assertEquals(5L, toggledId)
        assertEquals(false, toggledTo)
    }

    @Test
    fun togglingAnAutoDisabledAutomationOnInvokesReEnable() {
        var reEnabledId = -1L
        setContent(
            state = UiState(UiPhase.Content, data = automation(id = 8, enabled = false, autoDisabled = true)),
            onReEnable = { reEnabledId = it },
        )
        compose.onNodeWithContentDescription("Toggle automation").performClick()
        assertEquals(8L, reEnabledId)
    }

    @Test
    fun actionsMenuOpensAndTestRunInvokesCallback() {
        var testRunId = -1L
        setContent(
            state = UiState(UiPhase.Content, data = automation(id = 11)),
            onTestRun = { testRunId = it },
        )
        compose.onNodeWithContentDescription("Actions menu").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Test Run").performClick()
        assertEquals(11L, testRunId)
    }

    @Test
    fun deleteFlowOpensConfirmationAndInvokesDelete() {
        var deletedId = -1L
        setContent(
            state = UiState(UiPhase.Content, data = automation(id = 14)),
            onDelete = { deletedId = it },
        )
        compose.onNodeWithContentDescription("Actions menu").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Delete").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Delete Automation").assertIsDisplayed()
        compose.onNodeWithText("Delete").performClick()
        assertEquals(14L, deletedId)
    }

    @Test
    fun autoDisabledReasonAndConflictBannersRender() {
        setContent(
            UiState(
                UiPhase.Content,
                data =
                    automation(
                        enabled = false,
                        autoDisabled = true,
                        autoDisabledReason = "Disabled after 3 consecutive failures",
                        failureCount = 3,
                        conflicts =
                            listOf(
                                AutomationConflictView(2, "Charge to 90%", "Overlapping limit", "warning"),
                            ),
                    ),
            ),
        )
        compose.onNodeWithText("Auto-Disabled").assertIsDisplayed()
        compose.onNodeWithText("Disabled after 3 consecutive failures").assertIsDisplayed()
        compose.onNodeWithText("Fails: 3", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Charge to 90%", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = automation(name = "Cached automation"),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Cached automation").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }
}
