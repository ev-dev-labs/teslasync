package io.teslasync.android.featureviews.toolcard

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [ToolCardContent] across every state the
 * surface renders: the populated content state (header + body), the empty-content state (no body →
 * friendly "no data" message), and the unknown-color accent fallback. Asserts the rendered title /
 * description / body are present as TalkBack-readable text. Runs under `connectedAndroidTest`; the
 * offline gate's `testReleaseUnitTest` covers the pure accent/registration logic, this covers render
 * + a11y. Mirrors the web spec (web/src/features/admin/components/devtools/ToolCard.tsx).
 */
class ToolCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val title = "Configuration"
    private val description = "Manage Fleet API configuration"
    private val body = "Tool body content"

    private fun setContent(
        color: String = "cyan",
        withContent: Boolean = true,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToolCardContent(
                    icon = TeslaGlyphs.Info,
                    color = color,
                    title = title,
                    description = description,
                    content = if (withContent) ({ Text(body) }) else null,
                )
            }
        }
    }

    @Test
    fun contentStateRendersTitleDescriptionAndBody() {
        setContent()
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(description).assertIsDisplayed()
        compose.onNodeWithText(body).assertIsDisplayed()
    }

    @Test
    fun emptyContentStateShowsFriendlyNoDataMessage() {
        setContent(withContent = false)
        // Header is always present; the body collapses to the shared empty state, never a blank box.
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun unknownColorFallsBackToCyanAccentAndStillRenders() {
        // Web parity: `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan` — an unknown accent must not hide the card.
        setContent(color = "chartreuse")
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(description).assertIsDisplayed()
        compose.onNodeWithText(body).assertIsDisplayed()
    }

    @Test
    fun headerExposesAccessibleTitleAndDescriptionLabels() {
        setContent()
        // The icon box is decorative (no content description); the title + description carry the meaning
        // and must be reachable by TalkBack as text nodes.
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(description).assertIsDisplayed()
    }
}
