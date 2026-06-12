package io.teslasync.android.featureviews.collapsiblecommandgroup

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the CollapsibleCommandGroup across every state the
 * surface renders (web/src/features/system/components/CollapsibleCommandGroup.tsx): collapsed (header only,
 * grid hidden), expanded (header + grid of children), the toggle interaction, and the header's accessibility
 * contract (a labeled, clickable node carrying an expand/collapse `stateDescription` — the native analogue of
 * the web `aria-expanded`). Reduced motion is forced so the FadeIn / chevron settle instantly. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure model logic.
 */
class CollapsibleCommandGroupUiTest {
    @get:Rule
    val compose = createComposeRule()

    private class NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private class FakeStore : CommandGroupCollapseStore {
        private val backing = mutableMapOf<String, String>()

        override fun read(key: String): String? = backing[key]

        override fun write(
            key: String,
            value: String,
        ) {
            backing[key] = value
        }
    }

    private fun setStateless(
        category: CommandCategory,
        count: Int,
        expanded: Boolean,
        content: @Composable () -> Unit = { Caption(CONTENT_LABEL) },
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    CollapsibleCommandGroupContent(
                        category = category,
                        count = count,
                        expanded = expanded,
                        onToggle = {},
                        content = content,
                    )
                }
            }
        }
    }

    @Test
    fun collapsedShowsTheHeaderButHidesTheGrid() {
        setStateless(CommandCategory.Security, count = 4, expanded = false)
        compose.onNodeWithText(SECURITY_LABEL, substring = true).assertIsDisplayed()
        compose.onAllNodesWithText(CONTENT_LABEL).assertCountEquals(0)
    }

    @Test
    fun expandedRevealsTheGridChildren() {
        setStateless(CommandCategory.Security, count = 4, expanded = true)
        compose.onNodeWithText(SECURITY_LABEL, substring = true).assertIsDisplayed()
        compose.onNodeWithText(CONTENT_LABEL).assertIsDisplayed()
    }

    @Test
    fun headerExposesTheLabelAndCountOnOneClickableNode() {
        setStateless(CommandCategory.Security, count = 4, expanded = false)
        compose
            .onNode(hasClickAction() and hasText(SECURITY_LABEL, substring = true))
            .assertIsDisplayed()
        compose.onNodeWithText("(4)", substring = true).assertIsDisplayed()
    }

    @Test
    fun headerStateDescriptionReflectsTheExpandAffordance() {
        setStateless(CommandCategory.Security, count = 4, expanded = false)
        compose
            .onNode(hasClickAction())
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, EXPAND_AFFORDANCE))
    }

    @Test
    fun collapsedHeaderStateDescriptionFlipsWhenExpanded() {
        setStateless(CommandCategory.Security, count = 4, expanded = true)
        compose
            .onNode(hasClickAction())
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, COLLAPSE_AFFORDANCE))
    }

    @Test
    fun tappingTheHeaderTogglesTheGrid() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    CollapsibleCommandGroup(
                        category = CommandCategory.Charging,
                        vehicleId = 1L,
                        count = 2,
                        store = FakeStore(),
                        logger = NoopLogger(),
                    ) {
                        Caption(CONTENT_LABEL)
                    }
                }
            }
        }

        compose.onAllNodesWithText(CONTENT_LABEL).assertCountEquals(0)
        compose.onNode(hasClickAction()).performClick()
        compose.onNodeWithText(CONTENT_LABEL).assertIsDisplayed()
        compose.onNode(hasClickAction()).performClick()
        compose.onAllNodesWithText(CONTENT_LABEL).assertCountEquals(0)
    }

    private companion object {
        const val SECURITY_LABEL = "SECURITY & ACCESS"
        const val CONTENT_LABEL = "Sentry"
        const val EXPAND_AFFORDANCE = "Click to expand"
        const val COLLAPSE_AFFORDANCE = "Click to collapse"
    }
}
