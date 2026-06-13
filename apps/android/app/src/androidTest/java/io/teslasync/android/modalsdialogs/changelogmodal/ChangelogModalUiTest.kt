package io.teslasync.android.modalsdialogs.changelogmodal

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ChangelogModalContent] across every state the
 * surface renders — the parity branches of the web component (web/src/components/feedback/ChangelogModal.tsx):
 * the first-visit / since-last-visit subtitle, the list of collapsible release entries (badge + version +
 * date header over the grouped, dotted change list), the View-full / Got-it actions, and the native Empty
 * branch (a friendly empty state, never a blank box). Also exercises the per-entry expand/collapse toggle and
 * asserts each header is a TalkBack button whose state description carries the web `aria-expanded`. Runs under
 * connectedAndroidTest; the offline testReleaseUnitTest gate covers the pure projection logic.
 */
class ChangelogModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ChangelogStrings(
            title = "What's new in TeslaSync",
            viewFull = "View full changelog",
            gotIt = "Got it",
            closeLabel = "Close dialog",
            emptyMessage = ChangelogDefaults.EMPTY_MESSAGE,
            badgeLabels =
                mapOf(
                    ChangelogBadge.Latest to "Latest",
                    ChangelogBadge.Stable to "Stable",
                    ChangelogBadge.Beta to "Beta",
                ),
            sectionLabels =
                mapOf(
                    ChangelogChangeType.Added to "Added",
                    ChangelogChangeType.Changed to "Changed",
                    ChangelogChangeType.Fixed to "Fixed",
                    ChangelogChangeType.Removed to "Removed",
                    ChangelogChangeType.Deprecated to "Deprecated",
                    ChangelogChangeType.Security to "Security",
                ),
        )

    private fun releases(): List<ChangelogRelease> =
        listOf(
            ChangelogRelease(
                version = "0.7.0",
                date = "2026-03-29",
                badge = ChangelogBadge.Latest,
                changes = listOf(ChangelogChange(ChangelogChangeType.Added, ALPHA_CHANGE)),
            ),
            ChangelogRelease(
                version = "0.6.0",
                date = "2026-03-28",
                badge = ChangelogBadge.Stable,
                changes = listOf(ChangelogChange(ChangelogChangeType.Fixed, BETA_CHANGE)),
            ),
            ChangelogRelease(
                version = "0.5.0",
                date = "2026-03-23",
                badge = ChangelogBadge.Stable,
                changes = listOf(ChangelogChange(ChangelogChangeType.Security, GAMMA_CHANGE)),
            ),
        )

    private fun setContent(
        items: List<ChangelogRelease>,
        subtitle: String,
        onGotIt: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChangelogModalContent(
                    releases = items,
                    subtitle = subtitle,
                    strings = strings,
                    onClose = {},
                    onViewFull = {},
                    onGotIt = onGotIt,
                )
            }
        }
    }

    @Test
    fun firstVisitShowsSubtitleEntriesAndActions() {
        setContent(releases(), SUBTITLE_FIRST)
        compose.onNodeWithText(SUBTITLE_FIRST).assertIsDisplayed()
        compose.onNodeWithText("v0.7.0", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Latest").assertIsDisplayed()
        // The two default-open entries reveal their changes (web `defaultOpen={idx < 2}`).
        compose.onNodeWithText(ALPHA_CHANGE, substring = true).assertIsDisplayed()
        compose.onNodeWithText(BETA_CHANGE, substring = true).assertIsDisplayed()
        // Both actions are present (web ghost "View full changelog" + primary "Got it").
        compose.onNodeWithText(strings.viewFull).assertIsDisplayed()
        compose.onNodeWithText(strings.gotIt).assertIsDisplayed()
    }

    @Test
    fun emptyShowsFriendlyEmptyState() {
        setContent(emptyList(), SUBTITLE_SINCE)
        // Never a blank box: the friendly empty hint renders in place of the list.
        compose.onNodeWithText(ChangelogDefaults.EMPTY_MESSAGE, substring = true).assertIsDisplayed()
        // The actions still render so the user can dismiss.
        compose.onNodeWithText(strings.gotIt).assertIsDisplayed()
    }

    @Test
    fun collapsedEntryRevealsChangesOnlyAfterExpand() {
        setContent(releases(), SUBTITLE_FIRST)
        // The third entry (index 2) starts collapsed, so its change is not mounted ...
        compose.onNodeWithText(GAMMA_CHANGE, substring = true).assertDoesNotExist()
        // ... tapping its header expands it (web entry click handler).
        compose.onNodeWithText("v0.5.0", substring = true).performClick()
        compose.onNodeWithText(GAMMA_CHANGE, substring = true).assertIsDisplayed()
    }

    @Test
    fun gotItInvokesCallback() {
        var clicked = false
        setContent(releases(), SUBTITLE_FIRST, onGotIt = { clicked = true })
        compose.onNodeWithText(strings.gotIt).performClick()
        compose.runOnIdle { assert(clicked) }
    }

    @Test
    fun expandedEntryHeaderIsAButtonExposingItsStateToTalkBack() {
        setContent(releases(), SUBTITLE_FIRST)
        compose
            .onNodeWithText("v0.7.0", substring = true)
            // The merged header is announced as a button (web `role="button"`) ...
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            // ... carrying the expanded state description (web `aria-expanded={true}`).
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, ChangelogDefaults.EXPANDED_STATE))
    }

    @Test
    fun togglingAnEntryFlipsItsStateDescription() {
        compose.setContent {
            var items by remember { mutableStateOf(releases()) }
            TeslaSyncTheme(dynamicColor = false) {
                ChangelogModalContent(
                    releases = items,
                    subtitle = SUBTITLE_FIRST,
                    strings = strings,
                    onClose = {},
                    onViewFull = {},
                    onGotIt = { items = emptyList() },
                )
            }
        }
        // The collapsed third entry advertises the collapsed state ...
        compose
            .onNodeWithText("v0.5.0", substring = true)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, ChangelogDefaults.COLLAPSED_STATE))
        // ... and flips to expanded after a tap (web `aria-expanded` toggle).
        compose.onNodeWithText("v0.5.0", substring = true).performClick()
        compose
            .onNodeWithText("v0.5.0", substring = true)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, ChangelogDefaults.EXPANDED_STATE))
    }

    private companion object {
        const val SUBTITLE_FIRST = "Welcome! Here's a quick tour of what TeslaSync ships with right now."
        const val SUBTITLE_SINCE = "0 new release(s) since your last visit."
        const val ALPHA_CHANGE = "Energy Flow page with pack voltage and BMS status"
        const val BETA_CHANGE = "Disconnect now clears the stored token cleanly"
        const val GAMMA_CHANGE = "Hardened the command whitelist to known commands"
    }
}
