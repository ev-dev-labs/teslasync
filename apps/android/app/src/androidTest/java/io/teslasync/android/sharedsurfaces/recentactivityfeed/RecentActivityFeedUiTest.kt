package io.teslasync.android.sharedsurfaces.recentactivityfeed

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [RecentActivityFeed] view — the parity port of the web `RecentActivityFeed`
 * component (web/src/components/data-display/RecentActivityFeed.tsx). Covers what the offline model test cannot:
 * each lifecycle state renders the right surface (loading skeleton, hard-error retry, empty message, content
 * rows, offline chip), a routable row is an accessible tappable target wired to the navigator (the native
 * analogue of the web `<Link>`), a non-routable row is inert, the retry affordance carries its localized name,
 * and the one-shot PII-safe `view.opened` diagnostic fires. The offline `:android:testReleaseUnitTest` gate
 * covers the pure registry + routing + projection + state holder + diagnostics.
 */
class RecentActivityFeedUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_780_000_000_000L

    // ── State: content -> one timeline row per entry, with title + subtitle ────────────────────────────

    @Test
    fun contentRendersATitleAndSubtitlePerEntry() {
        mountContent(UiState(phase = UiPhase.Content, data = sampleEntries()))

        compose.onNodeWithText(WAKE, substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(SIGNED_IN, substring = true, useUnmergedTree = true).assertIsDisplayed()
        // The entity/detail subtitle is rendered verbatim (web `entity_type · entity_id — detail`).
        compose
            .onNodeWithText("vehicle \u00B7 3 \u2014 Model 3", substring = true, useUnmergedTree = true)
            .assertIsDisplayed()
    }

    // ── State: empty -> the friendly message, never a blank box (web `<EmptyState>`) ───────────────────

    @Test
    fun emptyRendersTheLocalizedMessage() {
        mountContent(UiState(phase = UiPhase.Empty, data = emptyList()))

        compose.onNodeWithText(EMPTY, substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── State: loading -> the skeleton chrome ──────────────────────────────────────────────────────────

    @Test
    fun loadingRendersTheSkeletonSurface() {
        mountContent(UiState.loading())

        compose.onNodeWithTag(RECENT_ACTIVITY_LOADING_TAG).assertExists()
    }

    // ── State: hard error -> a retry surface wired to onRetry ──────────────────────────────────────────

    @Test
    fun errorRendersAccessibleRetryThatFiresTheCallback() {
        var retries = 0
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentActivityFeedContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http),
                    onOpenEntity = {},
                    onRetry = { retries++ },
                    nowMillis = now,
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText(ERROR_TITLE, substring = true, useUnmergedTree = true).assertExists()
        // The retry button carries its localized accessible name and drives the callback.
        compose.onNodeWithText(RETRY, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(RETRY).performClick()
        compose.waitForIdle()
        assertEquals(1, retries)
    }

    // ── State: offline -> cached rows stay visible behind an "Offline" chip ────────────────────────────

    @Test
    fun offlineKeepsTheRowsAndShowsTheOfflineChip() {
        mountContent(
            UiState(
                phase = UiPhase.Content,
                data = sampleEntries(),
                stale = true,
                errorKind = ErrorKind.Network,
                fetchedAt = now - 5 * 60_000L,
            ),
        )

        compose.onNodeWithText(WAKE, substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(OFFLINE, substring = true).assertExists()
    }

    // ── Interaction: a routable row navigates through onOpenEntity (web `<Link to={href}>`) ─────────────

    @Test
    fun tappingARoutableRowForwardsItsRoute() {
        val opened = mutableListOf<String>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentActivityFeedContent(
                    state = UiState(phase = UiPhase.Content, data = listOf(routableEntry())),
                    onOpenEntity = { opened += it },
                    onRetry = {},
                    nowMillis = now,
                )
            }
        }
        compose.waitForIdle()

        // Exactly one clickable row (the routable entry); tapping it forwards the web `entityHref` route.
        compose.onAllNodes(hasClickAction()).assertCountEquals(1)
        compose.onAllNodes(hasClickAction()).onFirst().performClick()
        compose.waitForIdle()

        assertEquals(listOf("/vehicles/3"), opened)
    }

    // ── Interaction: a non-routable row is inert (web renders the title as plain text) ─────────────────

    @Test
    fun aNonRoutableRowExposesNoClickAction() {
        mountContent(UiState(phase = UiPhase.Content, data = listOf(nonRoutableEntry())))

        compose.onNodeWithText(SIGNED_IN, substring = true, useUnmergedTree = true).assertIsDisplayed()
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentActivityFeed(entries = sampleEntries(), onOpenEntity = {}, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "RecentActivityFeed"), fields)
    }

    private fun mountContent(state: UiState<List<UserActivityEntry>>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentActivityFeedContent(
                    state = state,
                    onOpenEntity = {},
                    onRetry = {},
                    nowMillis = now,
                )
            }
        }
        compose.waitForIdle()
    }

    private fun sampleEntries(): List<UserActivityEntry> = listOf(routableEntry(), nonRoutableEntry())

    private fun routableEntry(): UserActivityEntry =
        UserActivityEntry(
            id = 1,
            ts = "2026-06-14T12:29:30Z",
            action = "vehicle.command.wake",
            entityType = "vehicle",
            entityId = "3",
            detail = "Model 3",
        )

    private fun nonRoutableEntry(): UserActivityEntry =
        UserActivityEntry(
            id = 2,
            ts = "2026-06-14T12:00:00Z",
            action = "auth.login",
            entityType = null,
            entityId = null,
            detail = null,
        )

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        // The en catalog values (instrumentation default locale) the surface renders.
        const val WAKE = "Wake vehicle"
        const val SIGNED_IN = "Signed in"
        const val EMPTY = "No recent activity in this window."
        const val ERROR_TITLE = "Could not load activity"
        const val RETRY = "Retry"
        const val OFFLINE = "Offline"
    }
}
