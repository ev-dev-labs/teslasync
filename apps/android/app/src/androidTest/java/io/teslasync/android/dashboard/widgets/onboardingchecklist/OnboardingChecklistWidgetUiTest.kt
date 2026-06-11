package io.teslasync.android.dashboard.widgets.onboardingchecklist

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [OnboardingChecklistWidgetContent] /
 * [OnboardingChecklistBody] across every state the web component renders: the loading skeleton, the hard
 * error + retry surface, the progress header + task list with per-row CTAs, the dismiss affordance, the
 * 100%-complete celebration footer, the hidden/dismissed restart surface, the offline freshness chip, and
 * the "No setup steps" empty branch. Asserts the rendered i18n strings, the CTA navigation target, the
 * dismiss/restart callbacks, and the accessible labels on every interactive control. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the logic, this covers the
 * render.
 */
class OnboardingChecklistWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun incompleteInputs(dismissed: Boolean = false) =
        OnboardingChecklistInputs(0, 0, 0, "neon-cyan", false, false, false, dismissed, null)

    private fun completeInputs() = OnboardingChecklistInputs(1, 1, 1, "tesla-red", true, true, true, false, null)

    private fun testStrings() =
        OnboardingChecklistStrings(
            title = "Get started",
            dismiss = "Dismiss",
            completeMessage = "You're all set!",
            dismissedTitle = "Setup checklist hidden",
            dismissedMessage = "Restart or remove this widget.",
            restart = "Restart checklist",
            emptyMessage = "No setup steps available right now.",
            offlineLabel = "Offline",
            refreshingLabel = "Loading...",
            progress = { done, total -> "$done/$total complete" },
            formatRelative = { if (it is FreshnessAge.Unknown) "" else "now" },
            tasks =
                OnboardingTaskId.entries.associateWith {
                    OnboardingTaskCopy(it.slug, it.slug, "Go")
                },
        )

    private fun setContent(
        state: UiState<OnboardingChecklistInputs>,
        onDismiss: () -> Unit = {},
        onRestart: () -> Unit = {},
        onRefresh: () -> Unit = {},
        onNavigate: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingChecklistWidgetContent(
                    state = state,
                    onDismiss = onDismiss,
                    onRestart = onRestart,
                    onRefresh = onRefresh,
                    onNavigate = onNavigate,
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
    fun errorShowsRetryAffordanceAndInvokesRefresh() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertEquals(true, retried)
    }

    @Test
    fun contentShowsProgressTasksAndCta() {
        setContent(UiState(UiPhase.Content, data = incompleteInputs(), fetchedAt = 1L))
        compose.onNodeWithText("Get started").assertIsDisplayed()
        compose.onNodeWithText("0/7 complete").assertIsDisplayed()
        compose.onNodeWithText("Connect your Tesla").assertIsDisplayed()
        // Incomplete rows expose their CTA (the connect-vehicle CTA label).
        compose.onNodeWithText("Connect").assertIsDisplayed()
    }

    @Test
    fun tappingTaskCtaNavigatesToItsRoute() {
        var route: String? = null
        setContent(state = UiState(UiPhase.Content, data = incompleteInputs(), fetchedAt = 1L), onNavigate = { route = it })
        compose.onNodeWithText("Connect").performClick()
        assertEquals("/tesla-account", route)
    }

    @Test
    fun dismissButtonInvokesCallback() {
        var dismissed = false
        setContent(state = UiState(UiPhase.Content, data = incompleteInputs(), fetchedAt = 1L), onDismiss = { dismissed = true })
        compose.onNodeWithContentDescription("Dismiss").performClick()
        assertEquals(true, dismissed)
    }

    @Test
    fun allCompleteShowsCelebrationFooter() {
        setContent(UiState(UiPhase.Content, data = completeInputs(), fetchedAt = 1L))
        compose.onNodeWithText("all set", substring = true).assertExists()
    }

    @Test
    fun hiddenStateShowsRestartAffordanceAndInvokesRestart() {
        var restarted = false
        setContent(
            state = UiState(UiPhase.Content, data = incompleteInputs(dismissed = true), fetchedAt = 1L),
            onRestart = { restarted = true },
        )
        compose.onNodeWithText("Setup checklist hidden").assertIsDisplayed()
        compose.onNodeWithText("Restart checklist").performClick()
        assertEquals(true, restarted)
    }

    @Test
    fun offlineStateShowsFreshnessChip() {
        setContent(
            UiState(UiPhase.Content, data = incompleteInputs(), fetchedAt = 100L, stale = true, errorKind = ErrorKind.Network),
        )
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
        // The checklist still renders fully while offline (never blanks).
        compose.onNodeWithText("Connect your Tesla").assertIsDisplayed()
    }

    @Test
    fun emptyBodyShowsNoSetupStepsMessage() {
        val emptyData =
            OnboardingChecklistData(
                tasks = emptyList(),
                completeCount = 0,
                totalCount = 0,
                allComplete = false,
                progressPct = 0,
                dismissed = false,
                completedAt = null,
                hidden = false,
            )
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingChecklistBody(
                    data = emptyData,
                    state = UiState(UiPhase.Content, data = incompleteInputs(), fetchedAt = 1L),
                    strings = testStrings(),
                    onDismiss = {},
                    onRestart = {},
                    onNavigate = {},
                )
            }
        }
        compose.onNodeWithText("No setup steps available right now.").assertIsDisplayed()
    }
}
