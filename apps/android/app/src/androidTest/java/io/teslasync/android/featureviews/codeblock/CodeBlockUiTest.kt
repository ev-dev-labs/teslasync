package io.teslasync.android.featureviews.codeblock

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [CodeBlockContent] across every state the surface
 * renders — the two reachable branches of the web component
 * (web/src/features/system/components/chatbot/CodeBlock.tsx): a Content block (the monospace language tag,
 * the verbatim code, and the copy affordance) and an Empty body (a friendly empty state, never a blank box,
 * with the copy affordance still present but disabled). Asserts the rendered language tag, code, empty hint
 * and the copy button's accessible name are TalkBack-readable. Runs under `connectedAndroidTest`; the
 * offline `testReleaseUnitTest` gate covers the pure projection logic.
 */
class CodeBlockUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        CodeBlockStrings(
            copyLabel = "Copy",
            copiedLabel = "Copied",
            emptyHint = "No code to display",
        )

    private fun setContent(
        state: CodeBlockState,
        copyText: String,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CodeBlockContent(state = state, copyText = copyText, strings = strings)
            }
        }
    }

    @Test
    fun contentStateShowsLanguageTagCodeAndCopyAffordance() {
        val code = "val answer = 42"
        setContent(CodeBlockState.Content(languageLabel = "kotlin", code = code), copyText = code)
        // The language tag renders uppercased (web `uppercase` style) ...
        compose.onNodeWithText("KOTLIN").assertIsDisplayed()
        // ... the code renders verbatim ...
        compose.onNodeWithText(code, substring = true).assertIsDisplayed()
        // ... and the icon-only copy button's label is its accessible name.
        compose.onNodeWithContentDescription(strings.copyLabel).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsFriendlyHintAndKeepsTheHeader() {
        setContent(CodeBlockState.Empty(languageLabel = "text"), copyText = "")
        // Never a blank box: the friendly empty hint renders in place of the code body ...
        compose.onNodeWithText(strings.emptyHint, substring = true).assertIsDisplayed()
        // ... while the header (language tag) stays present, mirroring the web's always-on header.
        compose.onNodeWithText("TEXT").assertIsDisplayed()
        // The copy affordance is still present (TalkBack-labelled) even though it is disabled when empty.
        compose.onNodeWithContentDescription(strings.copyLabel).assertExists()
    }

    @Test
    fun copyAffordanceExposesItsAccessibleName() {
        val code = "package main"
        setContent(CodeBlockState.Content(languageLabel = "go", code = code), copyText = code)
        // The only interactive element carries an explicit TalkBack name (acceptance: a11y on every control).
        compose.onNodeWithContentDescription(strings.copyLabel).assertExists()
        compose.onNodeWithText("GO").assertIsDisplayed()
    }

    @Test
    fun languageTagFallsBackToTextWhenRendered() {
        // The model resolves a blank hint to "text"; the header renders it uppercased across states.
        setContent(CodeBlockModel.stateFor(language = "  ", text = "x = 1"), copyText = "x = 1")
        compose.onNodeWithText("TEXT").assertIsDisplayed()
        compose.onNodeWithText("x = 1", substring = true).assertIsDisplayed()
    }
}
