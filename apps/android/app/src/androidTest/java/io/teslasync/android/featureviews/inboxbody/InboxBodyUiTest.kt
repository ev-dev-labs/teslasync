package io.teslasync.android.featureviews.inboxbody

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [InboxBodyContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the inbox / grouped / archived empty
 * states, the populated grouped + flat lists, the stale/offline cached view, and the grouped/flat view toggle.
 * Asserts the rendered i18n strings and the TalkBack content descriptions (the select-all + per-row select
 * checkboxes, the archive/restore row action, the freshness chip). The offline gate's `testReleaseUnitTest`
 * covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/notifications/components/InboxBody.tsx).
 */
class InboxBodyUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val zone: ZoneId = ZoneId.of("UTC")
    private val now: Long = Instant.parse("2025-01-15T12:00:00Z").toEpochMilli()

    private fun row(
        id: Long,
        title: String,
        read: Boolean,
        severity: String,
    ): InboxNotification =
        InboxNotification(
            id = id,
            title = title,
            message = "Detail for $title",
            severity = severity,
            createdAtMillis = now - id * 3_600_000L,
            isRead = read,
            isArchived = false,
            canViewContext = true,
            ruleName = "Rule $id",
            vehicleName = "Model 3",
        )

    private fun rows(): List<InboxNotification> =
        listOf(
            row(1, "Charging complete", read = false, severity = "info"),
            row(2, "Tire pressure low", read = false, severity = "warn"),
            row(3, "Sentry event detected", read = true, severity = "critical"),
        )

    private fun groups(): List<InboxGroup> = rows().map { InboxGroup(groupKey = "g${it.id}", latest = it, count = it.id + 1) }

    @Suppress("LongParameterList") // Test harness mirrors the content composable's required callbacks.
    private fun setContent(
        archived: Boolean = false,
        flatState: UiState<List<InboxNotification>>,
        groupState: UiState<List<InboxGroup>>,
        onRefresh: () -> Unit = {},
        onMarkAllRead: () -> Unit = {},
        onConfigureRules: (() -> Unit)? = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InboxBodyContent(
                    archived = archived,
                    flatState = flatState,
                    groupState = groupState,
                    onRefresh = onRefresh,
                    onMarkRead = {},
                    onMarkUnread = {},
                    onArchive = {},
                    onUnarchive = {},
                    onDelete = {},
                    onBulkMarkRead = {},
                    onMarkAllRead = onMarkAllRead,
                    markOnOpen = false,
                    onConfigureRules = onConfigureRules,
                    nowMillis = now,
                    zone = zone,
                    locale = Locale.US,
                )
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setContent(flatState = UiState(UiPhase.Loading), groupState = UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsTitleAndRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            flatState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            groupState = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Could not load notifications").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyGroupedShowsNoThreadsMessage() {
        setContent(flatState = UiState(UiPhase.Empty, data = emptyList()), groupState = UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No notification threads").assertIsDisplayed()
    }

    @Test
    fun emptyArchivedShowsArchivedMessage() {
        setContent(
            archived = true,
            flatState = UiState(UiPhase.Empty, data = emptyList()),
            groupState = UiState(UiPhase.Empty, data = emptyList()),
            onConfigureRules = null,
        )
        compose.onNodeWithText("No archived notifications").assertIsDisplayed()
    }

    @Test
    fun togglingToFlatShowsInboxEmptyStateWithCta() {
        setContent(flatState = UiState(UiPhase.Empty, data = emptyList()), groupState = UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Flat").performClick()
        compose.onNodeWithText("No notifications").assertIsDisplayed()
        compose.onNodeWithText("Configure alert rules").assertIsDisplayed()
    }

    @Test
    fun groupedContentShowsThreadHeadsAndCount() {
        setContent(
            flatState = UiState(UiPhase.Content, data = rows()),
            groupState = UiState(UiPhase.Content, data = groups()),
        )
        compose.onNodeWithText("Charging complete").assertIsDisplayed()
        compose.onNodeWithText("3 notifications").assertIsDisplayed()
    }

    @Test
    fun archivedFlatContentExposesSelectionAndRestoreA11yLabels() {
        setContent(
            archived = true,
            flatState = UiState(UiPhase.Content, data = rows()),
            groupState = UiState(UiPhase.Content, data = groups()),
        )
        compose.onNodeWithText("Tire pressure low").assertIsDisplayed()
        compose.onNodeWithContentDescription("Select all visible").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Select notification").onFirst().assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Restore").onFirst().assertIsDisplayed()
    }

    @Test
    fun togglingToFlatRevealsMarkAllReadAndInvokesIt() {
        var markedAll = false
        setContent(
            flatState = UiState(UiPhase.Content, data = rows()),
            groupState = UiState(UiPhase.Content, data = groups()),
            onMarkAllRead = { markedAll = true },
        )
        compose.onNodeWithText("Flat").performClick()
        compose.onNodeWithText("Mark all read").performClick()
        assertTrue(markedAll)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            flatState = UiState(UiPhase.Content, data = rows()),
            groupState =
                UiState(
                    phase = UiPhase.Content,
                    data = groups(),
                    stale = true,
                    fetchedAt = now,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onNodeWithText("Charging complete").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            flatState = UiState(UiPhase.Content, data = rows()),
            groupState =
                UiState(
                    phase = UiPhase.Content,
                    data = groups(),
                    stale = true,
                    fetchedAt = now,
                ),
            onRefresh = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging complete").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
