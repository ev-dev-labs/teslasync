package io.teslasync.android.featureviews.accordionsection

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
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AccordionSectionContent] across every state the
 * surface renders — the three reachable branches of the web component
 * (web/src/features/system/components/status/AccordionSection.tsx): Collapsed (header only, no body),
 * ExpandedContent (header + the caller's body, faded in) and ExpandedEmpty (header + a friendly empty state,
 * never a blank box, when no body is supplied). Also exercises the open/closed toggle (web
 * `setOpen(prev => !prev)`) and asserts the header is a TalkBack button whose state description carries the
 * web `aria-expanded`. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the
 * pure projection logic.
 */
class AccordionSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        AccordionSectionStrings(
            expandAction = "Expand",
            collapseAction = "Collapse",
            expandedState = "Expanded",
            collapsedState = "Collapsed",
            emptyHint = "Nothing to show",
        )

    private fun setContent(open: Boolean) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AccordionSectionContent(
                    title = TITLE,
                    description = DESCRIPTION,
                    open = open,
                    onToggle = {},
                    strings = strings,
                    icon = { Icon(TeslaGlyphs.Info, contentDescription = null, size = IconSize.Lg) },
                ) {
                    BodyText(BODY_TEXT)
                }
            }
        }
    }

    @Test
    fun collapsedShowsHeaderAndHidesBody() {
        setContent(open = false)
        // The header (title + description) is always present ...
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(DESCRIPTION).assertIsDisplayed()
        // ... and the body is unmounted while collapsed (web `{open && (...)}`).
        compose.onNodeWithText(BODY_TEXT, substring = true).assertDoesNotExist()
    }

    @Test
    fun expandedShowsBodyContent() {
        setContent(open = true)
        // The caller's body renders beneath the header while open ...
        compose.onNodeWithText(BODY_TEXT, substring = true).assertIsDisplayed()
        // ... and the header stays present above it.
        compose.onNodeWithText(TITLE).assertIsDisplayed()
    }

    @Test
    fun expandedWithoutBodyShowsFriendlyEmptyState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AccordionSectionContent(
                    title = TITLE,
                    description = DESCRIPTION,
                    open = true,
                    onToggle = {},
                    strings = strings,
                    icon = { Icon(TeslaGlyphs.Info, contentDescription = null, size = IconSize.Lg) },
                    content = null,
                )
            }
        }
        // Never a blank box: the friendly empty hint renders in place of the body ...
        compose.onNodeWithText(strings.emptyHint, substring = true).assertIsDisplayed()
        // ... while the header stays present.
        compose.onNodeWithText(TITLE).assertIsDisplayed()
    }

    @Test
    fun clickingHeaderTogglesTheBody() {
        compose.setContent {
            var open by remember { mutableStateOf(false) }
            TeslaSyncTheme(dynamicColor = false) {
                AccordionSectionContent(
                    title = TITLE,
                    description = DESCRIPTION,
                    open = open,
                    onToggle = { open = !open },
                    strings = strings,
                    icon = { Icon(TeslaGlyphs.Info, contentDescription = null, size = IconSize.Lg) },
                ) {
                    BodyText(BODY_TEXT)
                }
            }
        }
        // Starts collapsed: body absent.
        compose.onNodeWithText(BODY_TEXT, substring = true).assertDoesNotExist()
        // A tap on the header expands it (web click handler) ...
        compose.onNodeWithText(TITLE).performClick()
        compose.onNodeWithText(BODY_TEXT, substring = true).assertIsDisplayed()
        // ... and the state description flips to "Expanded" (web `aria-expanded`).
        compose.onNodeWithText(TITLE).assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, strings.expandedState),
        )
    }

    @Test
    fun headerIsAButtonExposingItsStateToTalkBack() {
        setContent(open = false)
        compose
            .onNodeWithText(TITLE)
            // The merged header is announced as a button (web `role="button"` + `tabIndex={0}`) ...
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            // ... carrying the collapsed state description (web `aria-expanded={false}`).
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, strings.collapsedState))
    }

    private companion object {
        const val TITLE = "Diagnostics"
        const val DESCRIPTION = "Pipeline health and live signal counters"
        const val BODY_TEXT = "Streaming 42 signals across 3 vehicles."
    }
}
