package io.teslasync.android.featureviews.quiethourspanel

import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the QuietHours surface across every state it renders: the
 * loading spinner (with its accessible label), the hard-error retry surface, the no-windows empty state, the
 * populated rows (enabled/disabled badges + edit/delete actions), the stale/offline cached view with its chip +
 * auto-refresh, the inline create form (fields + weekday/severity chips + actions), the validation error, and the
 * create form opened from the Add affordance. The offline gate's `testReleaseUnitTest` covers the pure logic +
 * view-model; this covers render + a11y. Mirrors the web spec
 * (web/src/features/settings/components/QuietHoursPanel.tsx).
 */
class QuietHoursPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun windows(): List<QuietHoursWindow> =
        listOf(
            QuietHoursWindow(
                id = 1,
                enabled = true,
                startLocal = "23:00",
                endLocal = "07:00",
                timezone = "Europe/London",
                weekdays = ALL_WEEKDAYS,
                bypassSeverities = listOf("critical"),
            ),
            QuietHoursWindow(
                id = 2,
                enabled = false,
                startLocal = "12:00",
                endLocal = "13:00",
                timezone = "America/New_York",
                weekdays = 62,
                bypassSeverities = emptyList(),
            ),
        )

    private fun setContent(
        windowsState: UiState<List<QuietHoursWindow>>,
        draft: DraftWindow? = null,
        validationError: QuietHoursValidationError? = null,
        onEdit: (QuietHoursWindow) -> Unit = {},
        onDelete: (QuietHoursWindow) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                QuietHoursPanelContent(
                    windowsState = windowsState,
                    draft = draft,
                    validationError = validationError,
                    saving = false,
                    deletingIds = emptySet(),
                    onAddClick = {},
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onDraftChange = {},
                    onCancel = {},
                    onSubmit = {},
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun loadingShowsAddAffordanceAndAccessibleSpinnerNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Add window").assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading quiet-hours windows\u2026").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoWindowsMessage() {
        val emptyMessage =
            "No quiet-hours windows yet. Add one to defer non-critical notifications during sleep or meetings."
        setContent(UiState(UiPhase.Empty, emptyList()))
        compose.onNodeWithText(emptyMessage).assertIsDisplayed()
        compose.onNodeWithText("Add window").assertIsDisplayed()
    }

    @Test
    fun contentRendersRowsAndBadges() {
        setContent(UiState(UiPhase.Content, windows()))
        compose.onNodeWithText("Europe/London", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Enabled").assertIsDisplayed()
        compose.onNodeWithText("Disabled").assertIsDisplayed()
    }

    @Test
    fun rowActionsInvokeCallbacksAndHaveAccessibleLabels() {
        var edited: Long? = null
        var deleted: Long? = null
        val single =
            listOf(
                QuietHoursWindow(
                    id = 9,
                    enabled = true,
                    startLocal = "23:00",
                    endLocal = "07:00",
                    timezone = "UTC",
                    weekdays = ALL_WEEKDAYS,
                    bypassSeverities = listOf("critical"),
                ),
            )
        setContent(
            windowsState = UiState(UiPhase.Content, single),
            onEdit = { edited = it.id },
            onDelete = { deleted = it.id },
        )
        compose.onNodeWithText("Edit").assertIsDisplayed()
        compose.onNodeWithText("Delete").assertIsDisplayed()
        compose.onNodeWithText("Edit").performClick()
        compose.onNodeWithText("Delete").performClick()
        assertTrue(edited == 9L && deleted == 9L)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = windows(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Europe/London", substring = true).assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            windowsState =
                UiState(
                    phase = UiPhase.Content,
                    data = windows(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Europe/London", substring = true).assertIsDisplayed()
        assertTrue(refreshed)
    }

    @Test
    fun formRendersFieldsWeekdayAndSeverityChipsWhenDraftOpen() {
        setContent(UiState(UiPhase.Empty, emptyList()), draft = makeDraft(defaultTimezone = "Europe/London"))
        compose.onNodeWithText("New quiet-hours window").assertIsDisplayed()
        compose.onNodeWithText("Start").assertIsDisplayed()
        compose.onNodeWithText("End").assertIsDisplayed()
        compose.onNodeWithText("Mon").assertIsDisplayed()
        compose.onNodeWithText("Critical").assertIsDisplayed()
        compose.onNodeWithText("Create").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
    }

    @Test
    fun formShowsValidationError() {
        setContent(
            windowsState = UiState(UiPhase.Empty, emptyList()),
            draft = makeDraft(defaultTimezone = "UTC"),
            validationError = QuietHoursValidationError.EndEqual,
        )
        compose.onNodeWithText("End must differ from start.").assertIsDisplayed()
    }

    @Test
    fun addAffordanceOpensCreateForm() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                val vm = remember { QuietHoursPanelViewModel(FakeUiSource(), SilentLogger, null) }
                QuietHoursPanel(viewModel = vm)
            }
        }
        compose.onNodeWithText("Add window").performClick()
        compose.onNodeWithText("New quiet-hours window").assertIsDisplayed()
        compose.onNodeWithText("Create").assertIsDisplayed()
    }

    private object SilentLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeUiSource : QuietHoursPanelSource {
        override fun windows(): Flow<Resource<List<QuietHoursWindow>>> = flowOf(Resource.Success(emptyList(), 1L, false))

        override suspend fun saveWindow(
            input: QuietHoursWindowInput,
            id: Long?,
        ): Result<QuietHoursWindow> = Result.success(QuietHoursWindow(id = 1))

        override suspend fun deleteWindow(id: Long): Result<Unit> = Result.success(Unit)
    }
}
