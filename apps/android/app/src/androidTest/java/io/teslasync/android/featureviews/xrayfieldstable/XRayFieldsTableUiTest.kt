package io.teslasync.android.featureviews.xrayfieldstable

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
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [XRayFieldsTableContent] across every branch the
 * web component renders (loading / hard-error + retry / empty / content with a sortable header), plus the
 * lifecycle chrome the shared feed implies. Asserts the rendered strings, that the empty state announces an
 * accessibility label, that the retry affordance exposes an accessible click action and fires its callback,
 * and that the sortable header is interactive. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure projection.
 */
class XRayFieldsTableUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        XRayFieldsTableStrings(
            field = "Field",
            samples = "Samples",
            lastSeen = "Last seen",
            kind = "Kind",
            empty = "No samples in this window. Try widening the window.",
            loading = "Loading\u2026",
        )

    private val rows =
        listOf(
            IngestXRayFieldStat(field = "VehicleSpeed", sampleCount = 12_345, lastSeenAt = "2026-06-11T14:21:30Z", valueKind = 5),
            IngestXRayFieldStat(field = "ChargeState", sampleCount = 5, lastSeenAt = "2026-06-10T09:00:00Z", valueKind = 1),
        )

    private fun setContent(
        state: UiState<List<IngestXRayFieldStat>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    XRayFieldsTableContent(
                        state = state,
                        onRetry = onRetry,
                        locale = Locale.US,
                        zoneId = ZoneId.of("UTC"),
                        strings = strings,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsLoadingMessageAndHeader() {
        setContent(UiState.loading())
        compose.onNodeWithText(strings.loading).assertIsDisplayed()
        compose.onNodeWithText(strings.field).assertIsDisplayed()
    }

    @Test
    fun emptyShowsMessageAndAnnouncesAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(strings.empty).assertIsDisplayed()
        // a11y: the empty region exposes its message as a content description so it is announced.
        compose.onNodeWithContentDescription(strings.empty).assertExists()
    }

    @Test
    fun errorShowsAccessibleRetryThatFires() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error), onRetry = { retried = true })
        // The retry affordance carries an accessible click action; activating it runs the host's refetch.
        compose
            .onNodeWithText("Retry")
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()
        assertTrue(retried)
    }

    @Test
    fun contentShowsRowsKindBadgeAndGroupedCount() {
        setContent(UiState(phase = UiPhase.Content, data = rows))
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
        // value_kind 5 → "float32" via formatValueKind; sample_count 12_345 → grouped "12,345" via fmtInt.
        compose.onNodeWithText("float32").assertIsDisplayed()
        compose.onNodeWithText("12,345").assertIsDisplayed()
    }

    @Test
    fun sortableHeaderIsInteractiveAndKeepsContent() {
        setContent(UiState(phase = UiPhase.Content, data = rows))
        // Tapping the sortable "Field" header re-sorts without dropping the rows (web `onSort`).
        compose.onNodeWithText(strings.field).performClick()
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
        compose.onNodeWithText("ChargeState").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 720.dp
    }
}
