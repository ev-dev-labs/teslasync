package io.teslasync.android.sharedsurfaces.daterangefilter

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [DateRangeFilterContent] across every state the web
 * component renders plus the URL-state read's lifecycle: the filled control (dates + preset chips + Apply),
 * the empty control with its "pick a range" prompt, the loading skeleton, the classified error + retry, and
 * the stale / offline freshness chips. Asserts the rendered i18n strings, the TalkBack content description on
 * the date fields, and the preset group label. Runs under `connectedAndroidTest`; the `testReleaseUnitTest`
 * gate covers the logic, this covers the render.
 */
class DateRangeFilterUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DateRangeFilterStrings(
            startLabel = "Start date",
            endLabel = "End date",
            apply = "Apply",
            presetGroupLabel = "Quick date range",
            pickRange = "Pick a date range",
            selectStart = "Select start date",
            selectEnd = "Select end date",
            confirm = "Confirm",
            cancel = "Cancel",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
            title = "Date range",
            presetLabels =
                mapOf(
                    "today" to "Today",
                    "7d" to "Last 7 days",
                    "30d" to "Last 30 days",
                    "mtd" to "Month to date",
                    "ytd" to "Year to date",
                    "all" to "All time",
                ),
        )

    private fun setContent(
        display: DateRangeFilterDisplay,
        showApply: Boolean = true,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DateRangeFilterContent(
                    display = display,
                    strings = strings,
                    presetIds = DEFAULT_PRESET_IDS,
                    showApply = showApply,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun contentShowsDatesPresetsAndApply() {
        setContent(
            DateRangeFilterDisplay(
                phase = UiPhase.Content,
                start = "2026-06-07",
                end = "2026-06-13",
                activePresetId = "7d",
            ),
        )
        compose.onNodeWithContentDescription("Start date: 2026-06-07").assertIsDisplayed()
        compose.onNodeWithContentDescription("End date: 2026-06-13").assertIsDisplayed()
        compose.onNodeWithText("Last 7 days").assertIsDisplayed()
        compose.onNodeWithText("Apply").assertIsDisplayed()
    }

    @Test
    fun presetRowExposesGroupLabel() {
        setContent(DateRangeFilterDisplay(phase = UiPhase.Content, start = "2026-06-07", end = "2026-06-13"))
        compose.onNodeWithContentDescription("Quick date range").assertIsDisplayed()
    }

    @Test
    fun emptyShowsPickRangePrompt() {
        setContent(DateRangeFilterDisplay(phase = UiPhase.Empty), showApply = false)
        compose.onNodeWithText("Pick a date range").assertIsDisplayed()
        compose.onNodeWithText("Today").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(DateRangeFilterDisplay(phase = UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            display =
                DateRangeFilterDisplay(
                    phase = UiPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = HTTP_SERVER_ERROR,
                ),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleShowsStaleChip() {
        setContent(
            DateRangeFilterDisplay(
                phase = UiPhase.Content,
                start = "2026-06-07",
                end = "2026-06-13",
                stale = true,
            ),
        )
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChip() {
        setContent(
            DateRangeFilterDisplay(
                phase = UiPhase.Content,
                start = "2026-06-07",
                end = "2026-06-13",
                offline = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    private companion object {
        const val HTTP_SERVER_ERROR = 503
    }
}
