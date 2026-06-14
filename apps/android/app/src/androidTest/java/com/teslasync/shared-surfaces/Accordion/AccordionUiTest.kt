// Instrumented Compose UI + accessibility verification of [AccordionContent] across the states the web
// Accordion renders: the collapsed header (title + chevron, no body), the expanded reveal (every header slot —
// leading icon, badge, headerExtra — plus the body), the expanded empty-body fallback (a friendly caption, never
// a blank box), the tap-to-toggle action, and the header's `<button aria-expanded>` contract (one Role.Button
// carrying the title as its accessible name, the Expand/Collapse click label, and the Collapsed/Expanded state
// description). Runs under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest`
// covers the pure model (the classifier, the controlled-open resolution, the affordance selectors, the
// `t(key, default)` resolver, and the diagnostics) in AccordionModelTest.
//
// `assertExists` / `assertDoesNotExist` are SemanticsNodeInteraction MEMBERS (called on the result, not
// imported); only the matcher form `assert(SemanticsMatcher)` is the real top-level `androidx.compose.ui.test`
// extension, which is imported below. `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Accordion) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.accordion

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AccordionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Test
    fun collapsedRendersHeaderAndHidesBody() {
        host {
            AccordionContent(
                title = TITLE,
                expanded = false,
                onToggle = {},
                content = { Text(BODY) },
            )
        }
        compose.onNodeWithText(TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ACCORDION_CHEVRON_TAG, useUnmergedTree = true).assertExists()
        // The collapsed body is not composed (web `AnimatePresence` mounts the panel only while open).
        compose.onNodeWithTag(ACCORDION_BODY_TAG, useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText(BODY, useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun expandedRevealsBodyAndEverySlot() {
        host {
            AccordionContent(
                title = TITLE,
                expanded = true,
                onToggle = {},
                icon = { Text(ICON) },
                badge = { Text(BADGE) },
                headerExtra = { Text(EXTRA) },
                content = { Text(BODY) },
            )
        }
        compose.onNodeWithText(TITLE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(ICON, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(BADGE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(EXTRA, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ACCORDION_BODY_TAG, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(BODY, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun expandedWithoutBodyShowsTheEmptyFallback() {
        host {
            AccordionContent(title = TITLE, expanded = true, onToggle = {})
        }
        // A friendly empty caption, never a blank box (the prompt's empty-state contract).
        compose.onNodeWithTag(ACCORDION_EMPTY_TAG, useUnmergedTree = true).assertExists()
    }

    @Test
    fun tappingTheHeaderInvokesTheToggle() {
        var toggled = false
        host {
            AccordionContent(
                title = TITLE,
                expanded = false,
                onToggle = { toggled = true },
                content = { Text(BODY) },
            )
        }
        compose.onNodeWithTag(ACCORDION_HEADER_TAG).assertHasClickAction().performClick()
        assertTrue(toggled)
    }

    @Test
    fun collapsedHeaderIsAButtonAnnouncingTheExpandAffordances() {
        host {
            AccordionContent(title = TITLE, expanded = false, onToggle = {}, content = { Text(BODY) })
        }
        compose
            .onNodeWithTag(ACCORDION_HEADER_TAG)
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, COLLAPSED))
            // The merged button folds the title into its spoken name (web `<button>` inner text).
            .assert(hasText(TITLE, substring = true))
    }

    @Test
    fun expandedHeaderAnnouncesTheCollapseStateDescription() {
        host {
            AccordionContent(title = TITLE, expanded = true, onToggle = {}, content = { Text(BODY) })
        }
        compose
            .onNodeWithTag(ACCORDION_HEADER_TAG)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, EXPANDED))
    }

    private companion object {
        const val TITLE = "Battery health"
        const val BODY = "Degradation 4.2% over 28k mi"
        const val ICON = "icon-slot"
        const val BADGE = "Beta"
        const val EXTRA = "header-extra"

        // The English fallbacks resolved when the (absent) translation_accordion_* keys miss the catalog.
        const val COLLAPSED = "Collapsed"
        const val EXPANDED = "Expanded"
    }
}
