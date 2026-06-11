package io.teslasync.android.featureviews.jsonformatter

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [JsonFormatterContent] across every state the
 * surface renders — the three branches of the web `useMemo`
 * (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx): empty input (only the labelled
 * field, never a blank box), a parse error (rose message), and a valid document (the `Formatted` caption,
 * the copy affordance, and the pretty-printed JSON). Asserts the rendered title / description / input
 * label / error / output and the copy button's accessible name are present as TalkBack-readable text. Runs
 * under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure reduction logic.
 */
class JsonFormatterUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        JsonFormatterStrings(
            title = "Json Formatter",
            description = "Json Formatter Desc",
            inputLabel = "Json Input",
            inputExample = "{\"key\":\"value\"}",
            invalidFallback = "Invalid Json",
            formattedLabel = "Formatted",
            copyLabel = "Copy",
            copiedLabel = "Copied",
        )

    private val sampleJson = "{\n  \"id\": 7\n}"

    private fun setContent(
        result: JsonFormatResult,
        input: String = "",
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                JsonFormatterContent(
                    input = input,
                    onInputChange = {},
                    result = result,
                    strings = strings,
                )
            }
        }
    }

    @Test
    fun emptyStateShowsOnlyTheLabelledInput() {
        setContent(JsonFormatResult.Empty)
        // The card header + the input are always present (never a blank box); nothing renders below it.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.inputLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.inputExample, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.formattedLabel).assertDoesNotExist()
    }

    @Test
    fun invalidStateShowsTheParseErrorMessage() {
        val message = "Unexpected character at offset 0"
        setContent(JsonFormatResult.Invalid(message))
        compose.onNodeWithText(message).assertIsDisplayed()
        // The error branch shows no formatted panel.
        compose.onNodeWithText(strings.formattedLabel).assertDoesNotExist()
        compose.onNodeWithText(strings.inputLabel).assertIsDisplayed()
    }

    @Test
    fun formattedStateShowsOutputCaptionAndCopyAffordance() {
        setContent(JsonFormatResult.Formatted(sampleJson))
        compose.onNodeWithText(strings.formattedLabel).assertIsDisplayed()
        compose.onNodeWithText("\"id\": 7", substring = true).assertIsDisplayed()
        // The copy button's visible label doubles as its accessible name.
        compose.onNodeWithText(strings.copyLabel).assertIsDisplayed()
    }

    @Test
    fun headerExposesAccessibleTitleAndDescription() {
        setContent(JsonFormatResult.Empty)
        // The icon box is decorative; the title + description carry the meaning for TalkBack.
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.description).assertIsDisplayed()
    }

    @Test
    fun inputFieldExposesItsLabelAcrossStates() {
        // The floating label is the field's accessible name and must persist into the formatted state.
        setContent(JsonFormatResult.Formatted(sampleJson), input = sampleJson)
        compose.onNodeWithText(strings.inputLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.copyLabel).assertIsDisplayed()
    }
}
