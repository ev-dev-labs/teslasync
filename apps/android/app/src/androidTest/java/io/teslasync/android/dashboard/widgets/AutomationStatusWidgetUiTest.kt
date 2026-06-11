package io.teslasync.android.dashboard.widgets

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.automations.Automation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for `AutomationStatusWidget` — one per render state from the web
 * source (full / compact / empty / error) plus the accessibility label on the inline toggle.
 * They run on a device/emulator (connectedDebugAndroidTest); the framework-free projection logic
 * is covered by the no-device [AutomationStatusWidgetTest]. State changes are observed through the
 * `onToggle` / `onRetry` callbacks so assertions never depend on internal state.
 */
class AutomationStatusWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun automation(
        id: Long,
        name: String,
    ): Automation =
        Automation(
            id = id,
            name = name,
            enabled = true,
            lastSuccessAt = "2026-06-11T01:00:00Z",
            lastTriggeredAt = "2026-06-11T01:30:00Z",
            nextFireTime = "2026-06-11T03:00:00Z",
        )

    private fun sample(): List<Automation> =
        listOf(
            automation(1, "Precondition at 7am"),
            automation(2, "Charge to 80%").copy(consecutiveFailures = 2),
            automation(3, "Notify on arrival").copy(enabled = false),
            automation(4, "Sentry near home").copy(autoDisabled = true, lastSuccessAt = null),
        )

    private fun content(items: List<Automation>): UiState<List<Automation>> =
        UiState(phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content, data = items, fetchedAt = 1L)

    @Test
    fun fullViewRendersNamesSummaryAndStatuses() {
        rule.setContent {
            TeslaSyncTheme {
                AutomationStatusWidgetContent(
                    state = content(sample()),
                    size = DashboardWidgetSize(cols = 3, rows = 4),
                    onToggle = { _, _ -> },
                )
            }
        }
        rule.onNodeWithText("Precondition at 7am").assertIsDisplayed()
        rule.onNodeWithText("2 Active").assertIsDisplayed()
        rule.onNodeWithText("1 Failing").assertIsDisplayed()
        rule.onNodeWithText("1 Auto-disabled").assertIsDisplayed()
    }

    @Test
    fun wideViewExposesToggleA11yLabelAndFires() {
        var toggledId = -1L
        var toggledEnabled = true
        rule.setContent {
            TeslaSyncTheme {
                AutomationStatusWidgetContent(
                    state = content(sample()),
                    size = DashboardWidgetSize(cols = 3, rows = 4),
                    onToggle = { id, enabled ->
                        toggledId = id
                        toggledEnabled = enabled
                    },
                )
            }
        }
        rule.onNodeWithContentDescription("Toggle Precondition at 7am").assertIsDisplayed()
        rule.onNodeWithContentDescription("Toggle Precondition at 7am").performClick()
        assertEquals(1L, toggledId)
        // Row 1 starts enabled, so the flip requests "disable".
        assertEquals(false, toggledEnabled)
    }

    @Test
    fun emptyStateShowsConfiguredMessage() {
        rule.setContent {
            TeslaSyncTheme {
                AutomationStatusWidgetContent(
                    state = content(emptyList()),
                    size = DashboardWidgetSize(cols = 2, rows = 4),
                    onToggle = { _, _ -> },
                )
            }
        }
        rule.onNodeWithText("No automations configured").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFires() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                AutomationStatusWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    size = DashboardWidgetSize(cols = 2, rows = 4),
                    onToggle = { _, _ -> },
                    onRetry = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun compactViewShowsCountAndActiveLabel() {
        rule.setContent {
            TeslaSyncTheme {
                AutomationStatusWidgetContent(
                    state = content(sample()),
                    size = DashboardWidgetSize(cols = 1, rows = 1),
                    onToggle = { _, _ -> },
                )
            }
        }
        rule.onNodeWithText("2/4").assertIsDisplayed()
        rule.onNodeWithText("Active").assertIsDisplayed()
    }
}
