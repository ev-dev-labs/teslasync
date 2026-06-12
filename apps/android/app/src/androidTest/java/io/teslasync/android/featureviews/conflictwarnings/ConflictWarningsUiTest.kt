package io.teslasync.android.featureviews.conflictwarnings

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ConflictWarningsContent] across every state the
 * surface renders: the populated state (one titled banner per conflict), the warning and info single-row
 * variants, and the empty state (no conflicts -> renders nothing, web `return null`). Also asserts the
 * banner body + title are exposed to the accessibility tree so TalkBack announces them — the surface has no
 * interactive elements (the AlertBanners here are passive status callouts), so the informational text is the
 * a11y contract. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection, this covers render + a11y. Mirrors the web spec
 * (web/src/features/automations/pages/ConflictWarnings.tsx).
 */
class ConflictWarningsUiTest {
    @get:Rule
    val compose = createComposeRule()

    // The default-locale value of R.string.translation_automations_builder_conflict
    // (web `t('automations.builder.conflict', 'Potential Conflict')`).
    private val title = "Potential Conflict"

    private val warning =
        AutomationConflict(
            automationId = 1,
            automationName = "Morning precondition",
            reason = "Overlaps with the evening charge window.",
            severity = "warning",
        )

    private val info =
        AutomationConflict(
            automationId = 2,
            automationName = "Arrive-home lights",
            reason = "Shares a geofence trigger.",
            severity = "info",
        )

    private fun bodyOf(conflict: AutomationConflict): String =
        ConflictWarningsProjection.formatMessage(conflict.automationName, conflict.reason)

    private fun setContent(conflicts: List<AutomationConflict>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ConflictWarningsContent(conflicts = conflicts)
            }
        }
    }

    @Test
    fun populatedStateRendersATitledBannerPerConflict() {
        setContent(listOf(warning, info))

        // Web: one `<AlertBanner title="Potential Conflict">` per conflict.
        compose.onAllNodesWithText(title).assertCountEquals(2)
        compose.onNodeWithText(bodyOf(warning)).assertIsDisplayed()
        compose.onNodeWithText(bodyOf(info)).assertIsDisplayed()
    }

    @Test
    fun warningConflictRendersItsTitleAndBody() {
        setContent(listOf(warning))

        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(bodyOf(warning)).assertIsDisplayed()
    }

    @Test
    fun infoConflictRendersItsTitleAndBody() {
        setContent(listOf(info))

        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(bodyOf(info)).assertIsDisplayed()
    }

    @Test
    fun emptyConflictsRenderNothing() {
        // Web `if (conflicts.length === 0) return null` — no banner, no title, never a blank box.
        setContent(emptyList())

        compose.onAllNodesWithText(title).assertCountEquals(0)
    }

    @Test
    fun conflictBannerExposesItsTextToAccessibility() {
        // No interactive element exists on this surface; the title + body text are the accessibility
        // contract (a SemanticsNode that exists is read by TalkBack). Verify both are in the a11y tree.
        setContent(listOf(warning))

        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(bodyOf(warning)).assertIsDisplayed()
    }
}
