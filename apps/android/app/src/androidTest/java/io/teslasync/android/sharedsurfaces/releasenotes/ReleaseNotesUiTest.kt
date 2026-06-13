package io.teslasync.android.sharedsurfaces.releasenotes

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogBadge
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogChange
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogChangeType
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogRelease
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ReleaseNotesContent] across every state the surface
 * renders — the parity branches of the web component (web/src/components/feedback/ReleaseNotes.tsx): the
 * single-open accordion (version + badge + date header over the "What's New" change list), the default-first-open
 * behaviour, the single-open toggle (opening one collapses the other), and the native Empty branch (a friendly
 * empty state, never a blank box). Also asserts each header is a TalkBack button whose state description carries
 * the web `aria-expanded`. Runs under connectedAndroidTest; the offline testReleaseUnitTest gate covers the pure
 * projection logic.
 */
class ReleaseNotesUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ReleaseNotesStrings(
            heading = HEADING,
            emptyMessage = EMPTY_MESSAGE,
            badgeLabels =
                mapOf(
                    ChangelogBadge.Latest to "Latest",
                    ChangelogBadge.Stable to "Stable",
                    ChangelogBadge.Beta to "Beta",
                ),
            affordances =
                ReleaseNotesEntryAffordances(
                    expandAction = "Expand",
                    collapseAction = "Collapse",
                    expandedState = EXPANDED_STATE,
                    collapsedState = COLLAPSED_STATE,
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
                changes = listOf(ChangelogChange(ChangelogChangeType.Security, BETA_CHANGE)),
            ),
            ChangelogRelease(
                version = "0.5.0",
                date = "2026-03-23",
                badge = ChangelogBadge.Stable,
                changes = listOf(ChangelogChange(ChangelogChangeType.Removed, GAMMA_CHANGE)),
            ),
        )

    private fun setContent(items: List<ChangelogRelease>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ReleaseNotesContent(releases = items, strings = strings)
            }
        }
    }

    @Test
    fun firstReleaseRendersHeaderBadgeDateAndIsExpandedByDefault() {
        setContent(releases())
        compose.onNodeWithText("v0.7.0", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Latest").assertIsDisplayed()
        compose.onNodeWithText("2026-03-29").assertIsDisplayed()
        // The first release opens by default (web `useState(releases[0]?.version)`): its heading + change show.
        compose.onNodeWithText(HEADING.uppercase(), substring = true).assertIsDisplayed()
        compose.onNodeWithText(ALPHA_CHANGE, substring = true).assertIsDisplayed()
        // The others stay collapsed, so their changes are not mounted.
        compose.onNodeWithText(BETA_CHANGE, substring = true).assertDoesNotExist()
        compose.onNodeWithText(GAMMA_CHANGE, substring = true).assertDoesNotExist()
    }

    @Test
    fun openingAnotherReleaseCollapsesTheFirst() {
        setContent(releases())
        // Single-open: tapping 0.6.0 reveals its change ...
        compose.onNodeWithText("v0.6.0", substring = true).performClick()
        compose.onNodeWithText(BETA_CHANGE, substring = true).assertIsDisplayed()
        // ... and collapses the previously-open 0.7.0 (web `setExpanded(version)`).
        compose.onNodeWithText(ALPHA_CHANGE, substring = true).assertDoesNotExist()
    }

    @Test
    fun tappingTheOpenHeaderCollapsesIt() {
        setContent(releases())
        compose.onNodeWithText(ALPHA_CHANGE, substring = true).assertIsDisplayed()
        // Tapping the open header toggles it shut (web `setExpanded(isExpanded ? null : version)`).
        compose.onNodeWithText("v0.7.0", substring = true).performClick()
        compose.onNodeWithText(ALPHA_CHANGE, substring = true).assertDoesNotExist()
    }

    @Test
    fun emptyShowsFriendlyEmptyState() {
        setContent(emptyList())
        // Never a blank box: the friendly empty hint renders in place of the accordion.
        compose.onNodeWithText(EMPTY_MESSAGE, substring = true).assertIsDisplayed()
        compose.onNodeWithText("v0.7.0", substring = true).assertDoesNotExist()
    }

    @Test
    fun expandedHeaderIsAButtonExposingItsStateToTalkBack() {
        setContent(releases())
        compose
            .onNodeWithText("v0.7.0", substring = true)
            // The merged header is announced as a button (web `aria-expanded` host) ...
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            // ... carrying the expanded state description (web `aria-expanded={true}`).
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, EXPANDED_STATE))
    }

    @Test
    fun collapsedHeaderAdvertisesCollapsedStateThenFlipsOnTap() {
        setContent(releases())
        // The collapsed 0.6.0 header advertises the collapsed state ...
        compose
            .onNodeWithText("v0.6.0", substring = true)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, COLLAPSED_STATE))
        // ... and flips to expanded after a tap (web `aria-expanded` toggle).
        compose.onNodeWithText("v0.6.0", substring = true).performClick()
        compose
            .onNodeWithText("v0.6.0", substring = true)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, EXPANDED_STATE))
    }

    private companion object {
        const val HEADING = "What's New"
        const val EMPTY_MESSAGE = "No data available"
        const val EXPANDED_STATE = "Expanded"
        const val COLLAPSED_STATE = "Collapsed"
        const val ALPHA_CHANGE = "Energy Flow page with pack voltage and BMS status"
        const val BETA_CHANGE = "Hardened the command whitelist to known commands"
        const val GAMMA_CHANGE = "Dropped the deprecated v0 export route"
    }
}
