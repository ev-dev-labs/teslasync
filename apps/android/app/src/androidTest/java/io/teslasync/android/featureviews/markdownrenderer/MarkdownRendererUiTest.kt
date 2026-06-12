package io.teslasync.android.featureviews.markdownrenderer

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the MarkdownRenderer across every state the web tool
 * renders (web/src/features/system/components/chatbot/MarkdownRenderer.tsx): the friendly empty surface for
 * blank input, the `<Suspense fallback>` raw-text view, and the parsed markdown tree (headings, paragraphs,
 * lists, links, the delegated code block, and a GFM table). Asserts the rendered i18n strings and the TalkBack
 * content descriptions (the empty message, the code-block copy affordance). Runs under `connectedAndroidTest`;
 * the offline gate's `testReleaseUnitTest` covers the pure parse + diagnostics logic, this covers render + a11y.
 */
class MarkdownRendererUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        markdown: String,
        loading: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MarkdownRendererContent(markdown = markdown, loading = loading)
            }
        }
    }

    @Test
    fun blankInputShowsFriendlyEmptyState() {
        setContent("   ")
        // Never a blank box — the shared empty surface (its message is also its TalkBack label).
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun loadingShowsRawWhitespacePreservedFallback() {
        setContent(markdown = "first line\nsecond line", loading = true)
        compose.onNodeWithTag(MARKDOWN_FALLBACK_TAG).assertIsDisplayed()
        compose.onNodeWithText("first line", substring = true).assertIsDisplayed()
    }

    @Test
    fun renderedShowsHeadingParagraphAndListItems() {
        setContent("# Heading\n\nBody text here\n\n- alpha\n- beta")
        compose.onNodeWithTag(MARKDOWN_CONTENT_TAG).assertIsDisplayed()
        compose.onNodeWithText("Heading").assertIsDisplayed()
        compose.onNodeWithText("Body text here").assertIsDisplayed()
        compose.onNodeWithText("alpha").assertIsDisplayed()
        compose.onNodeWithText("beta").assertIsDisplayed()
    }

    @Test
    fun renderedLinkTextIsDisplayed() {
        setContent("Visit [Tesla](https://tesla.com) now")
        // The link label renders as a tappable span exposed to TalkBack as a link.
        compose.onNodeWithText("Visit Tesla now", substring = true).assertIsDisplayed()
    }

    @Test
    fun codeBlockShowsLanguageTagAndAccessibleCopyButton() {
        setContent("```go\nfmt.Println(\"hi\")\n```")
        compose.onNodeWithText("GO").assertIsDisplayed()
        // The copy affordance carries an accessible name (web CopyButton `common.copyButton.copy`).
        compose.onNodeWithContentDescription("Copy").assertIsDisplayed()
    }

    @Test
    fun tableRendersHeaderAndBodyCells() {
        setContent("| Metric | Value |\n| --- | --- |\n| Range | 300 |")
        compose.onNodeWithText("Metric").assertIsDisplayed()
        compose.onNodeWithText("Value").assertIsDisplayed()
        compose.onNodeWithText("Range").assertIsDisplayed()
        compose.onNodeWithText("300").assertIsDisplayed()
    }

    @Test
    fun statefulEntryRendersAndEmitsViewOpened() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MarkdownRenderer(children = "# Hello", logger = logger)
            }
        }
        compose.waitForIdle()

        compose.onNodeWithText("Hello").assertIsDisplayed()
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "MarkdownRenderer"), opened.single().second)
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }
}
